/* AI Dungeon Crawler — UI.hazards
 *
 * Stage 4: hazard dispatcher. All four v1 hazard shapes route through this
 * module — detect-then-avoid, pure-avoidance, automatic, interaction-gated.
 * The engine (RulesEngine.evaluateHazard) produces a dispatch plan; this
 * module drives the dice-section UI step by step, applies rewards / damage /
 * conditions, and tracks per-hazard state.
 *
 * State model (lives on gameState so it round-trips with the save):
 *   gameState.hazardState[id] = { state, times_fired }
 *   gameState.hazardQueue     = [plan, plan, ...]   // pending hazards to run
 *   gameState.activeHazard    = { plan, stepIndex } // currently-firing hazard
 *
 * Dispatch lifecycle:
 *   triggerHazards(roomId, triggerType) — evaluates every hazard in the room
 *     whose trigger matches; queues plans and begins processing if idle.
 *   For each plan, dispatchStep() advances through plan.steps:
 *     - automatic  : apply narration + outcome, move to next step.
 *     - detection  : open dice section with the detection check. On
 *       resolution (via onCheckResolved), apply reward, respect
 *       resolved_by_detection, then advance.
 *     - avoidance  : open dice section with the avoidance check. On
 *       resolution, apply reward or damage + conditions, then advance.
 *
 * Integration points:
 *   - processDiceRoll (scripts/ui-dice.js) detects pendingRollContext.dice
 *     .hazardDispatch and routes back here via onCheckResolved instead of
 *     pushing to conversation history.
 *   - response-parser.js fires triggerHazards on room-change detection.
 *   - main.js fires triggerHazards at game start for the starting room.
 *
 * Attaches to window.UI.hazards.
 */
(function (global) {
    'use strict';

    const gs = () => global.gameState;
    const gd = () => global.gameData;
    const doc = () => global.document;

    // ---- v1 data accessors -------------------------------------------------

    function v1() { return gd()._v1 || null; }
    function v1Character() { return (v1() && v1().character) || null; }
    function v1Rules()     { return (v1() && v1().rules)     || null; }
    function v1ItemsIndex() {
        const v = v1();
        if (!v) return {};
        const shared   = (v.items && v.items.items) || {};
        const modItems = (v.module && v.module.module_items && v.module.module_items.items) || {};
        return Object.assign({}, shared, modItems);
    }

    // ---- Hazard state store ------------------------------------------------

    function ensureStore() {
        if (!gs().hazardState) gs().hazardState = {};
        return gs().hazardState;
    }

    function getHazardState(id) {
        const store = ensureStore();
        if (!store[id]) store[id] = { state: 'undetected', times_fired: 0 };
        return store[id];
    }

    function setHazardState(id, patch) {
        const cur = getHazardState(id);
        Object.assign(cur, patch);
    }

    function getHazardsForRoom(roomId) {
        const rooms = gd().module && gd().module.rooms;
        const room = rooms && rooms[roomId];
        if (!room || !Array.isArray(room.hazards)) return [];
        return room.hazards;
    }

    // ---- Trigger + queue ---------------------------------------------------

    /**
     * Fire any hazards in `roomId` whose trigger.type matches. Stage 4 treats
     * `on_traverse` hazards the same as `on_enter` for room entry (since the
     * player walks through the hazard's room the moment they enter it);
     * Stage 5 will refine this when connection clicks become structured.
     */
    function triggerHazards(roomId, triggerType) {
        if (!roomId || !triggerType) return;
        const hazards = getHazardsForRoom(roomId);
        if (hazards.length === 0) return;

        const queued = new Set(((gs().hazardQueue || []).map(p => p && p.id)).filter(Boolean));
        const active = gs().activeHazard && gs().activeHazard.plan && gs().activeHazard.plan.id;
        for (const hz of hazards) {
            const authored = (hz.trigger && hz.trigger.type) || 'on_enter';
            const match = authored === triggerType
                || (triggerType === 'on_enter' && authored === 'on_traverse');
            if (!match) continue;
            // De-dupe: skip if this hazard is already queued or currently active.
            // Protects against double-trigger paths (e.g. simultaneous
            // on_enter + on_traverse fires, or a future caller that calls
            // triggerHazards twice for the same event).
            if (queued.has(hz.id) || active === hz.id) {
                if (global.debugLog) global.debugLog('HAZARD', `skip ${hz.id}: already queued/active`);
                continue;
            }
            const state = getHazardState(hz.id);
            const plan = RulesEngine.evaluateHazard(hz, state);
            if (!plan || plan.suppress) continue;
            enqueue(plan);
            queued.add(hz.id);
        }
        // Only start processing when the player isn't mid-roll and no hazard is active.
        if (!gs().activeHazard && !gs().waitingForRoll) advanceQueue();
    }

    function enqueue(plan) {
        if (!gs().hazardQueue) gs().hazardQueue = [];
        gs().hazardQueue.push(plan);
    }

    function advanceQueue() {
        const q = gs().hazardQueue || [];
        while (q.length) {
            const plan = q.shift();
            if (!plan || plan.suppress) continue;
            startHazard(plan);
            return;
        }
        gs().activeHazard = null;
    }

    function startHazard(plan) {
        gs().activeHazard = { plan, stepIndex: 0 };
        if (global.debugLog) global.debugLog('HAZARD', `start ${plan.id} (${plan.triggerType}; steps: ${plan.steps.map(s => s.kind).join('+')})`);
        // Opener: one mechanics-callout line so the designer reads it separately
        // from the GM's room narration. Full description sits on the
        // authored hazard; ui-hazards surfaces just the hazard name + a
        // cue that the engine is dispatching.
        if (global.addMechanicsCallout) {
            global.addMechanicsCallout(`⚠ ${plan.name || plan.id} — ${plan.triggerType}`);
        }
        dispatchStep();
    }

    function dispatchStep() {
        const active = gs().activeHazard;
        if (!active) return advanceQueue();
        const step = active.plan.steps[active.stepIndex];
        if (!step) {
            finishHazard();
            return;
        }
        if (step.kind === 'automatic') {
            runAutomaticStep(step);
            return;
        }
        if (step.kind === 'detection' || step.kind === 'avoidance') {
            const ok = openCheckPrompt(step);
            if (!ok) {
                // Couldn't build a check context (missing v1 data) — skip step.
                advancePastStep();
            }
            return;
        }
        // Unknown step kind → skip.
        advancePastStep();
    }

    function advancePastStep() {
        const active = gs().activeHazard;
        if (!active) return advanceQueue();
        active.stepIndex++;
        dispatchStep();
    }

    function finishHazard() {
        const active = gs().activeHazard;
        if (!active) return advanceQueue();
        // One increment per full run (regardless of which steps fired),
        // so times_fired matches "how many times the hazard has resolved".
        // nextState was set per-step by the onCheckResolved / runAutomatic
        // paths; we just persist times_fired here.
        const id = active.plan.id;
        const cur = getHazardState(id);
        setHazardState(id, { times_fired: (cur.times_fired || 0) + 1 });
        if (global.saveGame) global.saveGame();
        if (global.debugLog) global.debugLog('HAZARD', `finish ${id}: state=${cur.state}, times_fired=${(cur.times_fired || 0) + 1}`);
        gs().activeHazard = null;
        advanceQueue();
    }

    // ---- Check step: opens the dice section --------------------------------

    function openCheckPrompt(step) {
        const char = v1Character();
        const rules = v1Rules();
        if (!char || !rules) return false;
        const items = v1ItemsIndex();
        const check = step.check || {};
        const tier = check.dc_tier || null;

        // Build check context. Prefer the authored skill; fall back to the
        // authored ability.
        let ctx = null;
        if (check.skill) {
            ctx = RulesEngine.checkInputsFor(char, rules, items, 'skill', check.skill);
        }
        if (!ctx && check.ability) {
            ctx = RulesEngine.checkInputsFor(char, rules, items, 'ability', check.ability);
        }
        if (!ctx) return false;

        // Resolve DC (roll-high) or target adjustment (roll-under).
        let dc = null;
        let target = ctx.target;
        if (ctx.method === 'roll_under_score') {
            const adjust = RulesEngine.tierTargetAdjust(tier, rules);
            if (target != null) target = target + adjust;
        } else {
            dc = RulesEngine.dcForTier(tier, rules);
        }

        const active = gs().activeHazard;
        const hazardDispatch = { hazardId: active.plan.id, stepIndex: active.stepIndex };
        const stepLabel = step.kind === 'detection' ? 'Detection' : 'Avoidance';
        const tierLabel = tier ? ` (${tier})` : '';

        const diceCtx = {
            type: 'd20',
            ability: ctx._label || check.skill || check.ability,
            advantage: false,
            disadvantage: false,
            v1Check: {
                method: ctx.method,
                modifier: ctx.modifier || 0,
                target: target,
                dc: dc,
                label: ctx._label,
                abbr: ctx._abbr,
                adEnabled: ctx.adEnabled,
                critSuccessOn: ctx.critSuccessOn,
                critFailureOn: ctx.critFailureOn
            },
            hazardDispatch
        };

        // System-style callout lets the designer see what the app is asking.
        if (global.addMechanicsCallout) {
            const tierHint = ctx.method === 'roll_under_score'
                ? (tier ? ` (target adjust: ${signed(RulesEngine.tierTargetAdjust(tier, rules))})` : '')
                : (dc != null ? ` vs DC ${dc}` : '');
            global.addMechanicsCallout(`${stepLabel} check: ${ctx._label}${tierLabel}${tierHint}`);
        }
        if (global.debugLog) {
            global.debugLog('HAZARD', `${stepLabel} step for ${active.plan.id}: ${ctx._label} (${ctx.method}, tier=${tier}, ${ctx.method === 'roll_under_score' ? 'target=' + target : 'dc=' + dc})`);
        }

        // Populate the dice section directly — avoid getDiceForRollRequest so
        // our pre-built v1Check isn't re-derived.
        const diceSection = doc().getElementById('diceSection');
        const rollPrompt = doc().getElementById('rollPrompt');
        const rollBtn = doc().getElementById('rollBtn');
        const diceInput = doc().getElementById('diceInput');
        if (ctx.method === 'roll_under_score') {
            rollPrompt.textContent = `${stepLabel}: roll for ${ctx._label} (1d20 ≤ ${target}).`;
            rollBtn.textContent = `Roll 1d20 (≤ ${target})`;
        } else {
            const modStr = signed(ctx.modifier || 0);
            const dcTail = dc != null ? ` vs DC ${dc}` : '';
            rollPrompt.textContent = `${stepLabel}: roll for ${ctx._label} (1d20 ${modStr})${dcTail}.`;
            rollBtn.textContent = `Roll 1d20 (${modStr})`;
        }
        diceInput.placeholder = '1-20';
        diceInput.min = '1';
        diceInput.max = '20';
        diceSection.classList.add('active');
        gs().waitingForRoll = true;
        gs().pendingRollContext = { dice: diceCtx, rollType: 'ability', abilityName: ctx._label };
        if (global.disableInput) global.disableInput(true);
        return true;
    }

    // ---- Check step resolution (called from ui-dice.js) --------------------

    /**
     * Invoked from processDiceRoll when pendingRollContext.dice.hazardDispatch
     * is set. `resolved` is the RulesEngine.resolveCheck output; the ability
     * branch of processDiceRoll has already emitted the callout. This handler
     * applies the step's outcome, advances the plan, and lets the queue run.
     */
    function onCheckResolved(resolved, diceCtx) {
        const active = gs().activeHazard;
        if (!active) return advanceQueue();
        const step = active.plan.steps[active.stepIndex];
        if (!step) { finishHazard(); return; }
        if (global.debugLog) {
            global.debugLog('HAZARD', `${step.kind} resolved for ${active.plan.id}: natural=${resolved && resolved.natural} success=${resolved && resolved.success} crit=${resolved && resolved.isCrit} fumble=${resolved && resolved.isFumble}`);
        }

        const outcome = resolved && resolved.success ? step.onSuccess : step.onFailure;
        // Narrate the outcome prose (engine's already emitted the callout).
        if (outcome && outcome.narration && global.addNarration) {
            global.addNarration(outcome.narration);
        }
        applyOutcome(outcome || {});

        // Detection success with resolved_by_detection: skip avoidance.
        if (step.kind === 'detection' && resolved && resolved.success && step.onSuccess && step.onSuccess.skipAvoidance) {
            setHazardState(active.plan.id, {
                state: step.onSuccess.nextState || 'detected_resolved'
            });
            finishHazard();
            return;
        }

        // Otherwise: record per-step state, advance to the next step. Final
        // state + times_fired roll up once in finishHazard so a multi-step
        // plan counts as a single firing of the hazard.
        const nextState = (outcome && outcome.nextState) || (resolved && resolved.success ? 'avoided' : 'triggered');
        setHazardState(active.plan.id, { state: nextState });
        active.stepIndex++;
        dispatchStep();
    }

    // ---- Outcome application (automatic + post-check) ----------------------

    function runAutomaticStep(step) {
        if (step.narration && global.addNarration) global.addNarration(step.narration);
        applyOutcome({ damage: step.damage, conditions: step.conditions });
        const active = gs().activeHazard;
        setHazardState(active.plan.id, { state: step.nextState || 'triggered' });
        active.stepIndex++;
        dispatchStep();
    }

    function applyOutcome(outcome) {
        if (!outcome) return;
        if (global.debugLog) {
            const parts = [];
            if (outcome.reward && outcome.reward.xp) parts.push(`xp=${outcome.reward.xp}`);
            if (outcome.damage) parts.push(`damage=${outcome.damage.amount}${outcome.damage.type ? ' ' + outcome.damage.type : ''}`);
            if (Array.isArray(outcome.conditions) && outcome.conditions.length) parts.push(`conditions=${outcome.conditions.join(',')}`);
            if (parts.length) global.debugLog('HAZARD', `outcome: ${parts.join(' ')}`);
        }

        // XP reward. Narration (if the reward carried its own line) is already
        // surfaced by the step's onSuccess/onFailure narration up-stream.
        if (outcome.reward && typeof outcome.reward.xp === 'number' && outcome.reward.xp > 0) {
            if (global.addXP) global.addXP(outcome.reward.xp);
            if (global.addMechanicsCallout) global.addMechanicsCallout(`Reward: +${outcome.reward.xp} XP`);
        }

        // Damage — resolve the formula, emit a callout, apply via modifyHP.
        if (outcome.damage && outcome.damage.amount) {
            const roll = RulesEngine.rollFormula(outcome.damage.amount);
            const typeSuffix = outcome.damage.type ? ` ${outcome.damage.type}` : '';
            if (global.addMechanicsCallout) {
                global.addMechanicsCallout(`Hazard damage: ${roll.breakdown}${typeSuffix}`);
            }
            if (roll.total > 0 && global.modifyHP) global.modifyHP(-roll.total);
        }

        // Conditions — addCondition validates against the rules.conditions[] list.
        if (Array.isArray(outcome.conditions)) {
            for (const cid of outcome.conditions) {
                if (!cid) continue;
                if (global.addCondition) global.addCondition(cid);
                if (global.addMechanicsCallout) global.addMechanicsCallout(`Condition added: ${cid}`);
            }
        }
    }

    function signed(n) { const x = Number(n) || 0; return x >= 0 ? `+${x}` : `${x}`; }

    // ---- Exports -----------------------------------------------------------

    global.UI = global.UI || {};
    global.UI.hazards = {
        triggerHazards,
        onCheckResolved,
        advanceQueue,
        getHazardState
    };

    // Legacy globals for still-inline callers.
    global.triggerHazardsForRoom = triggerHazards;
})(typeof window !== 'undefined' ? window : globalThis);
