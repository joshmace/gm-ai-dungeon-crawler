/* AI Dungeon Crawler — UI.features
 *
 * Stage 5: feature cards for the four v1 sub-types (lore / searchable /
 * interactive / puzzle). Renders into #featureCards on room entry and on
 * any state change (applyEffect fires → re-render). Shares the Stage 4
 * dispatcher pattern: produce a plan from the authored feature + runtime
 * state, drive the UI step by step, apply rewards/effects via the
 * RulesEngine + GameState helpers.
 *
 * State model (delta-only; lives on gameState so it rides with the save):
 *   gs().featureState[id] = {
 *     current_state?,   // interactive: authored current_state; activate_feature writes here
 *     solved?,          // puzzle: narrative or check-gated solve
 *     succeeded?,       // searchable: last search succeeded
 *     searched?,        // searchable: player has searched at least once
 *     unlocked?         // Convention A: generic flag set when activate_feature's state is "unlocked"
 *   }
 *
 * Scope this commit (C6): dispatcher shell + lore card + searchable card.
 *   - lore:       description + Examine button (reveals on_examine prose).
 *   - searchable: description + Search button. Check-gated via featureDispatch
 *                 (ui-dice routes resolved check back to onCheckResolved).
 *                 On success, fire reward[] + effects[]; respect persists.
 *
 * Interactive + puzzle cards render a minimal "coming in C7" placeholder
 * so the iterator still shows the card (and its prereq_hint, if any).
 *
 * Integration points:
 *   - ui-dice.js: when pendingRollContext.dice.featureDispatch is set, route
 *     the resolved check here via onCheckResolved instead of the GM round-trip.
 *     (C8 wires that branch.)
 *   - main.js + response-parser.js: call renderForRoom(roomId) on every
 *     room entry. (C10 wires that.)
 *
 * Attaches to window.UI.features.
 */
(function (global) {
    'use strict';

    const gs  = () => global.gameState;
    const gd  = () => global.gameData;
    const doc = () => global.document;
    const debugLog = (...a) => { if (global.debugLog) global.debugLog(...a); };

    // ---- v1 accessors -----------------------------------------------------

    function v1()          { return gd()._v1 || null; }
    function v1Character() { return (v1() && v1().character) || null; }
    function v1Rules()     { return (v1() && v1().rules)     || null; }
    function v1ItemsIndex() {
        const v = v1();
        if (!v) return {};
        const shared   = (v.items && v.items.items) || {};
        const modItems = (v.module && v.module.module_items && v.module.module_items.items) || {};
        return Object.assign({}, shared, modItems);
    }

    function moduleState() {
        return (global.GameState && global.GameState.buildModuleState)
            ? global.GameState.buildModuleState()
            : { features: gs().featureState || {}, connectionsModified: gs().connectionsModified || {}, visitedRooms: gs().visitedRooms || [], encounters: {} };
    }

    function featureRuntimeState(id) {
        if (!gs().featureState) gs().featureState = {};
        if (!gs().featureState[id]) gs().featureState[id] = {};
        return gs().featureState[id];
    }

    function featuresForRoom(roomId) {
        if (!roomId) return [];
        const rooms = (gd().module && gd().module.rooms) || {};
        const room = rooms[roomId];
        if (!room || !Array.isArray(room.features)) return [];
        return room.features;
    }

    // ---- Card render ------------------------------------------------------

    /**
     * Render the current room's feature cards into #featureCards. Idempotent —
     * re-rendering replaces the cards wholesale. Called on room entry, after
     * any applyEffect, and after any feature-dispatch resolution.
     */
    function renderForRoom(roomId) {
        const host = doc().getElementById('featureCards');
        if (!host) return;
        host.innerHTML = '';

        const feats = featuresForRoom(roomId);
        const ms = moduleState();

        const visible = [];
        let hidden = 0;
        for (const f of feats) {
            if (!f) continue;
            const met = RulesEngine.prereqsMet(f, ms);
            if (!met && !f.prereq_hint) { hidden++; continue; }
            visible.push({ feature: f, prereqsMet: met });
        }
        debugLog('FEATURE', `render room=${roomId}: ${visible.length} cards (${hidden} hidden)`);

        for (const entry of visible) {
            const card = renderCard(entry.feature, entry.prereqsMet);
            if (card) host.appendChild(card);
        }
    }

    /**
     * Build one card for a feature. Dispatches by feature.type; returns the
     * root DOM node (ready to append) or null when the feature shouldn't
     * surface (e.g. prereqs unmet AND no prereq_hint authored — the iterator
     * filters those out; this is defense-in-depth).
     */
    function renderCard(feature, prereqsMet) {
        const type = (feature.type || 'lore').toLowerCase();
        const rt = featureRuntimeState(feature.id);

        const card = doc().createElement('div');
        card.className = `feature-card feature-${type}`;
        card.dataset.featureId = feature.id;
        card.dataset.featureType = type;
        if (!prereqsMet) card.classList.add('feature-locked');

        // Header: title + type tag.
        const header = doc().createElement('div');
        header.className = 'feature-card-header';
        header.innerHTML = `<span class="feature-card-title">${escapeHtml(feature.name || feature.id)}</span>`
            + `<span class="feature-card-type">${escapeHtml(type)}</span>`;
        card.appendChild(header);

        // Description (always shown).
        if (feature.description) {
            const desc = doc().createElement('div');
            desc.className = 'feature-card-desc';
            desc.textContent = feature.description;
            card.appendChild(desc);
        }

        // Prereq hint (shown only when prereqs unmet AND authored).
        if (!prereqsMet) {
            if (feature.prereq_hint) {
                const hint = doc().createElement('div');
                hint.className = 'feature-card-hint';
                hint.textContent = feature.prereq_hint;
                card.appendChild(hint);
            }
            // Do not render action buttons when locked.
            return card;
        }

        // Actions.
        if (type === 'lore')       renderLoreActions(card, feature, rt);
        else if (type === 'searchable') renderSearchableActions(card, feature, rt);
        else if (type === 'interactive') renderInteractivePlaceholder(card, feature, rt);
        else if (type === 'puzzle')      renderPuzzlePlaceholder(card, feature, rt);
        else renderLoreActions(card, feature, rt); // unknown type → safe lore shape.

        return card;
    }

    // ---- Lore sub-type ----------------------------------------------------

    function renderLoreActions(card, feature, rt) {
        if (!feature.on_examine) return;
        const btn = doc().createElement('button');
        btn.type = 'button';
        btn.className = 'feature-card-action';
        btn.textContent = rt.examined ? 'Examine again' : 'Examine';
        btn.addEventListener('click', () => {
            if (gs().waitingForRoll || gs().activeHazard) return;
            debugLog('FEATURE', `lore examine: ${feature.id}`);
            if (global.addNarration) global.addNarration(feature.on_examine);
            rt.examined = true;
            if (global.saveGame) global.saveGame();
            refreshCardAfterAction(feature);
        });
        card.appendChild(btn);
    }

    // ---- Searchable sub-type ----------------------------------------------

    function renderSearchableActions(card, feature, rt) {
        const persists = !!feature.persists;
        const done = rt.succeeded && !persists;
        const btn = doc().createElement('button');
        btn.type = 'button';
        btn.className = 'feature-card-action';

        if (done) {
            // Feature already succeeded + authored non-persistent: render a
            // done-state chip so the card stays visible but can't re-fire.
            btn.textContent = 'Searched';
            btn.disabled = true;
        } else {
            btn.textContent = rt.searched ? 'Search again' : 'Search';
            btn.addEventListener('click', () => onSearchClick(feature, rt));
        }
        card.appendChild(btn);
    }

    function onSearchClick(feature, rt) {
        if (gs().waitingForRoll || gs().activeHazard) return;
        debugLog('FEATURE', `searchable click: ${feature.id}`);
        rt.searched = true;
        if (global.saveGame) global.saveGame();

        // If the feature authors a check, route through the dice section with
        // featureDispatch; ui-dice's C8 branch calls onCheckResolved when the
        // player rolls. Otherwise apply the authored outcome directly (no check).
        if (feature.check) {
            const ok = openFeatureCheck(feature, /*kind*/ 'searchable');
            if (ok) return;
        }
        // Auto-resolve: no check authored. Treat as success.
        applySearchableOutcome(feature, rt, /*success*/ true, feature.on_success);
    }

    function applySearchableOutcome(feature, rt, success, prose) {
        if (prose && global.addNarration) global.addNarration(prose);

        if (success) {
            rt.succeeded = true;
            if (Array.isArray(feature.reward)) {
                if (global.applyReward) global.applyReward(feature.reward, gd());
            } else if (feature.reward) {
                if (global.applyReward) global.applyReward(feature.reward, gd());
            }
            if (feature.on_success && Array.isArray(feature.on_success.effects)) {
                dispatchEffects(feature.on_success.effects);
            }
            if (feature.effects && Array.isArray(feature.effects)) {
                dispatchEffects(feature.effects);
            }
        }
        if (global.saveGame) global.saveGame();
        refreshCardAfterAction(feature);
    }

    // ---- Check routing (searchable + puzzle) ------------------------------

    /**
     * Open the dice section for a feature-gated check. Parallel to
     * ui-hazards.openCheckPrompt: assembles v1Check ctx, stashes a
     * featureDispatch payload so ui-dice routes the result back here.
     *
     * `kind` is 'searchable' or 'puzzle' so onCheckResolved knows which
     * outcome branch to fire.
     */
    function openFeatureCheck(feature, kind) {
        const char = v1Character();
        const rules = v1Rules();
        if (!char || !rules) return false;
        const items = v1ItemsIndex();
        const ctx = RulesEngine.featureCheckInputs(feature, char, rules, items);
        if (!ctx) return false;

        const tier = ctx.tier;
        const dc = ctx.method === 'roll_under_score' ? null : ctx.dc;
        const target = ctx.target;

        // Apply condition-driven adv/disadv for packs that support it.
        let applyAdv = false, applyDisadv = false;
        if (ctx.adEnabled) {
            const flags = RulesEngine.conditionAdvDisadvFor(char, rules, 'ability_check');
            applyAdv = !!flags.advantage;
            applyDisadv = !!flags.disadvantage;
        }

        const featureDispatch = { featureId: feature.id, kind };
        const stepLabel = kind === 'puzzle' ? 'Puzzle' : 'Search';

        const diceCtx = {
            type: 'd20',
            ability: ctx._label || feature.id,
            advantage: applyAdv,
            disadvantage: applyDisadv,
            v1Check: {
                method: ctx.method,
                modifier: ctx.modifier || 0,
                target,
                dc,
                label: ctx._label,
                abbr: ctx._abbr,
                adEnabled: ctx.adEnabled,
                critSuccessOn: ctx.critSuccessOn,
                critFailureOn: ctx.critFailureOn
            },
            featureDispatch
        };

        const diceSection = doc().getElementById('diceSection');
        const rollPrompt  = doc().getElementById('rollPrompt');
        const rollBtn     = doc().getElementById('rollBtn');
        const diceInput   = doc().getElementById('diceInput');
        if (!diceSection || !rollPrompt || !rollBtn || !diceInput) return false;

        const adLabel = applyAdv ? ' (advantage)' : applyDisadv ? ' (disadvantage)' : '';
        const diceCountLabel = (applyAdv || applyDisadv) ? 'Roll 2d20' : 'Roll 1d20';
        if (ctx.method === 'roll_under_score') {
            rollPrompt.textContent = `${stepLabel}: roll for ${ctx._label} (1d20 ≤ ${target})${adLabel}.`;
            rollBtn.textContent = `${diceCountLabel} (≤ ${target})`;
        } else {
            const modStr = signed(ctx.modifier || 0);
            const dcTail = dc != null ? ` vs DC ${dc}` : '';
            rollPrompt.textContent = `${stepLabel}: roll for ${ctx._label} (1d20 ${modStr})${dcTail}${adLabel}.`;
            rollBtn.textContent = `${diceCountLabel} (${modStr})`;
        }
        diceInput.placeholder = '1-20';
        diceInput.min = '1';
        diceInput.max = '20';
        diceSection.classList.add('active');
        gs().waitingForRoll = true;
        gs().pendingRollContext = { dice: diceCtx, rollType: 'ability', abilityName: ctx._label };
        if (global.disableInput) global.disableInput(true);

        if (global.addMechanicsCallout) {
            const tierHint = ctx.method === 'roll_under_score'
                ? (tier ? ` (target adjust: ${signed(RulesEngine.tierTargetAdjust(tier, rules))})` : '')
                : (dc != null ? ` vs DC ${dc}` : '');
            global.addMechanicsCallout(`${stepLabel} check: ${ctx._label}${tier ? ` (${tier})` : ''}${tierHint}`);
        }
        debugLog('FEATURE', `${kind} check opened: ${feature.id} (${ctx._label}, ${ctx.method}, tier=${tier})`);
        return true;
    }

    /**
     * Invoked from ui-dice when pendingRollContext.dice.featureDispatch fires.
     * `resolved` is the RulesEngine.resolveCheck output; dispatch the right
     * outcome based on feature sub-type + success.
     */
    function onCheckResolved(resolved, diceCtx) {
        const disp = diceCtx && diceCtx.featureDispatch;
        if (!disp) return;
        const feature = RulesEngine.findFeatureById(gd(), disp.featureId);
        if (!feature) {
            debugLog('FEATURE', `onCheckResolved: feature ${disp.featureId} not found`);
            return;
        }
        const rt = featureRuntimeState(feature.id);
        const success = !!(resolved && resolved.success);

        if (disp.kind === 'searchable') {
            const prose = success ? feature.on_success : feature.on_failure;
            applySearchableOutcome(feature, rt, success, prose);
            return;
        }
        if (disp.kind === 'puzzle') {
            applyPuzzleOutcome(feature, rt, success);
            return;
        }
    }

    // ---- Effect dispatch --------------------------------------------------

    function dispatchEffects(effects) {
        if (!Array.isArray(effects)) return;
        const ms = moduleState();
        for (const e of effects) {
            const result = RulesEngine.applyEffect(e, ms, gd());
            debugLog('EFFECT', `${result.type || 'unknown'} target=${result.target || '?'} applied=${result.applied}${result.reason ? ` reason=${result.reason}` : ''}${result.found === false ? ' (target not found in module)' : ''}`);
        }
        if (global.saveGame) global.saveGame();
        // Re-render both cards + connections since an effect may unlock a
        // connection or activate another feature's state.
        if (global.UI && global.UI.connections && global.UI.connections.renderForRoom) {
            global.UI.connections.renderForRoom(gs().currentRoom);
        }
    }

    // ---- Interactive sub-type ---------------------------------------------
    //
    // Authoring shape:
    //   { type: "interactive", states: ["unlit", "lit"], initial_state: "unlit",
    //     actions: { "<state>": { label, result, effects, next_state? } } }
    //
    // One button per action authored for the current state. After firing:
    //  1. Narrate `result` in the narrative panel.
    //  2. Dispatch `effects[]` through RulesEngine.applyEffect.
    //  3. Transition state: use action.next_state if authored, else the next
    //     entry in states[] (wraps on the final state — stays terminal).

    function currentInteractiveState(feature, rt) {
        if (rt.current_state) return rt.current_state;
        const initial = feature.initial_state || ((Array.isArray(feature.states) && feature.states[0]) || 'default');
        rt.current_state = initial;
        return initial;
    }

    function nextInteractiveState(feature, currentState, authoredNext) {
        if (authoredNext) return authoredNext;
        const states = Array.isArray(feature.states) ? feature.states : [];
        const idx = states.indexOf(currentState);
        if (idx === -1 || idx >= states.length - 1) return currentState;  // stay terminal
        return states[idx + 1];
    }

    function renderInteractivePlaceholder(card, feature, rt) {
        // Name retained from C6 for call-site continuity; fully implemented now.
        const actions = feature.actions || {};
        const cur = currentInteractiveState(feature, rt);
        const action = actions[cur];

        const stateLine = doc().createElement('div');
        stateLine.className = 'feature-card-substate';
        stateLine.textContent = `State: ${cur}`;
        card.appendChild(stateLine);

        if (!action) {
            // No action authored for this state — pure-description terminal.
            return;
        }
        const btn = doc().createElement('button');
        btn.type = 'button';
        btn.className = 'feature-card-action';
        btn.textContent = action.label || `Act (${cur})`;
        // Terminal state with no effects → render as disabled chip; still show the label.
        const terminal = (!action.effects || action.effects.length === 0)
            && !action.next_state
            && (function () {
                const states = Array.isArray(feature.states) ? feature.states : [];
                return states.indexOf(cur) === states.length - 1;
            })();
        if (terminal) btn.disabled = true;
        btn.addEventListener('click', () => onInteractiveClick(feature, rt, cur, action));
        card.appendChild(btn);
    }

    function onInteractiveClick(feature, rt, fromState, action) {
        if (gs().waitingForRoll || gs().activeHazard) return;
        debugLog('FEATURE', `interactive click: ${feature.id} state=${fromState} → action="${action.label || ''}"`);
        if (action.result && global.addNarration) global.addNarration(action.result);
        if (Array.isArray(action.effects) && action.effects.length) {
            dispatchEffects(action.effects);
        }
        const toState = nextInteractiveState(feature, fromState, action.next_state);
        rt.current_state = toState;
        rt[toState] = true;   // Convention A: flag set alongside current_state.
        debugLog('FEATURE', `interactive transition: ${feature.id} ${fromState} → ${toState}`);
        if (global.saveGame) global.saveGame();
        refreshCardAfterAction(feature);
    }

    // ---- Puzzle sub-type --------------------------------------------------
    //
    // Two solve paths:
    //  1. Pure-narrative ("Propose a solution" text input): sends "I try: <text>"
    //     as a player action. The GM judges per the feature.solution.description
    //     (which ships in LAYOUT_BLOCK) and emits [FEATURE_SOLVED: <id>] on a
    //     correct solve. response-parser routes the tag to UI.features.markSolved.
    //  2. Check-gated ("Try a roll"): available when solution.check is authored.
    //     Opens openFeatureCheck with kind=puzzle → onCheckResolved routes to
    //     applyPuzzleOutcome.

    function renderPuzzlePlaceholder(card, feature, rt) {
        // Name retained from C6 for call-site continuity; fully implemented now.
        const solution = feature.solution || {};
        if (rt.solved) {
            const solvedLine = doc().createElement('div');
            solvedLine.className = 'feature-card-substate feature-card-solved';
            solvedLine.textContent = 'Solved';
            card.appendChild(solvedLine);
            return;
        }

        const row = doc().createElement('div');
        row.className = 'feature-card-puzzle-row';

        const input = doc().createElement('input');
        input.type = 'text';
        input.className = 'feature-card-puzzle-input';
        input.placeholder = 'Propose a solution…';
        input.maxLength = 200;
        input.addEventListener('keypress', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); proposePuzzleSolution(feature, input.value); input.value = ''; }
        });
        row.appendChild(input);

        const proposeBtn = doc().createElement('button');
        proposeBtn.type = 'button';
        proposeBtn.className = 'feature-card-action';
        proposeBtn.textContent = 'Propose';
        proposeBtn.addEventListener('click', () => {
            proposePuzzleSolution(feature, input.value);
            input.value = '';
        });
        row.appendChild(proposeBtn);

        card.appendChild(row);

        if (solution.check) {
            const rollBtn = doc().createElement('button');
            rollBtn.type = 'button';
            rollBtn.className = 'feature-card-action feature-card-action-secondary';
            rollBtn.textContent = 'Try a roll';
            rollBtn.addEventListener('click', () => {
                if (gs().waitingForRoll || gs().activeHazard) return;
                debugLog('FEATURE', `puzzle try-a-roll: ${feature.id}`);
                openFeatureCheck(feature, 'puzzle');
            });
            card.appendChild(rollBtn);
        }
    }

    function proposePuzzleSolution(feature, text) {
        if (gs().waitingForRoll || gs().activeHazard) return;
        const trimmed = String(text || '').trim();
        if (!trimmed) return;
        debugLog('FEATURE', `puzzle propose: ${feature.id} → "${trimmed.slice(0, 60)}"`);
        const playerInput = doc().getElementById('playerInput');
        if (!playerInput) return;
        playerInput.value = `I try: ${trimmed} (attempting to solve ${feature.name || feature.id})`;
        if (global.submitAction) global.submitAction();
    }

    /**
     * Apply the puzzle outcome for a check-gated attempt. Success: fire
     * on_success prose + effects + rewards + mark solved. Failure: narrate
     * on_failure; the player can retry.
     */
    function applyPuzzleOutcome(feature, rt, success) {
        const onSuccess = feature.on_success || {};
        const onFailure = feature.on_failure || {};
        if (success) {
            markSolved(feature.id, { narrateFromAuthored: true });
        } else {
            if (onFailure.narration && global.addNarration) global.addNarration(onFailure.narration);
            else if (typeof onFailure === 'string' && global.addNarration) global.addNarration(onFailure);
            if (global.saveGame) global.saveGame();
            refreshCardAfterAction(feature);
        }
    }

    /**
     * Public entry point for a puzzle solve — called by onCheckResolved (check
     * path) AND by response-parser when it sees [FEATURE_SOLVED: <id>]
     * (narrative path). Fires on_success narration + effects + rewards,
     * flips rt.solved, and re-renders.
     *
     * `opts.narrateFromAuthored` controls whether to narrate feature.on_success.narration.
     * For narrative solves, the GM's own prose already covered the solve, so the
     * app shouldn't duplicate it — but for check-gated solves, the engine
     * does not produce prose, so narration: true.
     */
    function markSolved(featureId, opts) {
        const feature = RulesEngine.findFeatureById(gd(), featureId);
        if (!feature) {
            debugLog('FEATURE', `markSolved: feature ${featureId} not found`);
            return false;
        }
        const rt = featureRuntimeState(featureId);
        if (rt.solved) {
            debugLog('FEATURE', `markSolved: ${featureId} already solved (no-op)`);
            return false;
        }
        rt.solved = true;
        rt.current_state = 'solved';   // Convention A: current_state + flag both set.
        const onSuccess = feature.on_success || {};
        const narrateFromAuthored = !!(opts && opts.narrateFromAuthored);
        if (narrateFromAuthored && onSuccess.narration && global.addNarration) {
            global.addNarration(onSuccess.narration);
        }
        if (Array.isArray(onSuccess.effects) && onSuccess.effects.length) {
            dispatchEffects(onSuccess.effects);
        }
        if (onSuccess.reward) {
            if (global.applyReward) global.applyReward(onSuccess.reward, gd());
        }
        debugLog('FEATURE', `solved: ${featureId}${narrateFromAuthored ? ' (check)' : ' (narrative)'}`);
        if (global.saveGame) global.saveGame();
        refreshCardAfterAction(feature);
        return true;
    }

    // ---- Helpers ----------------------------------------------------------

    /** After a click that changes featureState, re-render so the card reflects it. */
    function refreshCardAfterAction(feature) {
        renderForRoom(gs().currentRoom);
    }

    function signed(n) { const x = Number(n) || 0; return x >= 0 ? `+${x}` : `${x}`; }

    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, ch =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    global.UI = global.UI || {};
    global.UI.features = {
        renderForRoom,
        onCheckResolved,
        featureRuntimeState,
        dispatchEffects,
        // C7:
        markSolved,
        proposePuzzleSolution
    };
})(typeof window !== 'undefined' ? window : globalThis);
