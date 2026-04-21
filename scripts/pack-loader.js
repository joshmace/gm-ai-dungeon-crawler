/* AI Dungeon Crawler — PackLoader
 *
 * Loads a v1 Game Pack: manifest -> 6 archetype files -> optional sidecar .md guidance.
 * Resolves cross-references and throws a structured PackLoadError on any failure.
 *
 * Usage:
 *   const gameData = await PackLoader.loadPack('./game_pack.json', onStatus);
 *
 * The onStatus callback (optional) receives short progress strings; the bootstrap
 * wires it to the #loadingStatus element in templates/loading-overlay.html.
 *
 * Attaches to window.PackLoader.
 */
(function (global) {
    'use strict';

    const ARCHETYPE_FIELDS = [
        'rules',             // rules_<name>.json
        'setting',           // setting_<name>.json
        'bestiary',          // bestiary_<name>.json
        'items',             // items_<name>.json
        'adventure_module',  // module_<name>.json
        'character'          // character_<name>.json
    ];

    class PackLoadError extends Error {
        constructor(message, details) {
            super(message);
            this.name = 'PackLoadError';
            this.details = details || {};
        }
    }

    async function fetchJson(url) {
        let response;
        try {
            response = await fetch(url);
        } catch (networkErr) {
            throw new PackLoadError(`Network error fetching ${url}`, { url, cause: networkErr.message });
        }
        if (!response.ok) {
            throw new PackLoadError(`HTTP ${response.status} fetching ${url}`, { url, status: response.status });
        }
        try {
            return await response.json();
        } catch (parseErr) {
            throw new PackLoadError(`Invalid JSON in ${url}`, { url, cause: parseErr.message });
        }
    }

    async function fetchText(url) {
        let response;
        try {
            response = await fetch(url);
        } catch (networkErr) {
            throw new PackLoadError(`Network error fetching ${url}`, { url, cause: networkErr.message });
        }
        if (!response.ok) {
            throw new PackLoadError(`HTTP ${response.status} fetching ${url}`, { url, status: response.status });
        }
        return response.text();
    }

    // Manifest paths may be relative. Resolve them against the manifest's own URL
    // so packs can live in subdirectories without rewriting paths.
    function resolveRelative(baseUrl, relativePath) {
        return new URL(relativePath, new URL(baseUrl, global.location.href)).toString();
    }

    async function loadPack(manifestUrl, onStatus) {
        const notify = typeof onStatus === 'function' ? onStatus : () => {};

        notify('Loading manifest…');
        const manifest = await fetchJson(manifestUrl);

        if (!manifest || typeof manifest !== 'object') {
            throw new PackLoadError('Manifest is not a JSON object', { url: manifestUrl });
        }

        // Every archetype field is required and must point at a JSON file.
        for (const field of ARCHETYPE_FIELDS) {
            if (!manifest[field] || typeof manifest[field] !== 'string') {
                throw new PackLoadError(
                    `Manifest is missing required field "${field}"`,
                    { url: manifestUrl, field }
                );
            }
        }

        notify('Loading pack files…');
        const archetypePromises = ARCHETYPE_FIELDS.map(field =>
            fetchJson(resolveRelative(manifestUrl, manifest[field]))
        );
        const archetypes = await Promise.all(archetypePromises);

        const [rulesFile, settingFile, bestiaryFile, itemsFile, moduleFile, characterFile] = archetypes;

        // Archetype files wrap their payload under a top-level key per the v1 schema.
        // Accept either shape (wrapped OR bare) so tolerant validation catches mistakes later.
        const rules = rulesFile.rules || rulesFile;
        const setting = settingFile.setting || settingFile;
        const character = characterFile.character || characterFile;

        // Module files are structurally different: the envelope and the content are
        // peers at the top level. Compose one object so downstream code can read
        // module.starting_room and module.rooms without knowing the file layout.
        const moduleEnvelope = moduleFile.module || {};
        const module = {
            ...moduleEnvelope,
            rooms:                moduleFile.rooms || {},
            module_bestiary:      moduleFile.module_bestiary || null,
            module_items:         moduleFile.module_items || null,
            completion_condition: moduleFile.completion_condition || null
        };

        // Sidecar markdown files — each archetype MAY declare a path on its root object.
        // Path is relative to the manifest, same as the archetype files themselves.
        const sidecarSpecs = [
            { key: 'rulesGuidance', path: rules.guidance },
            { key: 'settingLore', path: setting.content },
            { key: 'moduleGuidance', path: module.guidance },
            { key: 'characterGuidance', path: character.guidance }
        ].filter(spec => spec.path);

        let sidecarResults = {};
        if (sidecarSpecs.length) {
            notify('Loading guidance…');
            const sidecarPromises = sidecarSpecs.map(spec =>
                fetchText(resolveRelative(manifestUrl, spec.path))
            );
            const sidecarTexts = await Promise.all(sidecarPromises);
            sidecarSpecs.forEach((spec, i) => { sidecarResults[spec.key] = sidecarTexts[i]; });
        }

        const gameData = {
            manifest,
            manifestUrl,
            rules,
            setting,
            bestiary: bestiaryFile.bestiary || bestiaryFile,
            items: itemsFile.items_library || itemsFile,
            module,
            character,
            settingLore: sidecarResults.settingLore || '',
            rulesGuidance: sidecarResults.rulesGuidance || '',
            moduleGuidance: sidecarResults.moduleGuidance || '',
            characterGuidance: sidecarResults.characterGuidance || ''
        };

        notify('Validating pack…');
        validate(gameData);

        notify('Pack loaded.');
        return gameData;
    }

    // validate() does cross-reference checks across all archetypes. Accumulates
    // errors and throws a single aggregate PackLoadError so a broken pack reports
    // every bad reference at once, not just the first.
    function validate(gameData) {
        const errors = [];
        const push = (loc, msg) => errors.push({ loc, msg });

        const { manifest, rules, bestiary, items, module, character } = gameData;

        // --- manifest <-> character ---
        if (manifest.id && character.game_pack_id && manifest.id !== character.game_pack_id) {
            push('character.game_pack_id',
                `is "${character.game_pack_id}" but manifest.id is "${manifest.id}"`);
        }

        // --- rooms + starting_room ---
        const rooms = module.rooms || {};
        const roomIds = new Set(Object.keys(rooms));
        if (module.starting_room && !roomIds.has(module.starting_room)) {
            push('module.starting_room',
                `"${module.starting_room}" is not a room id in rooms{}`);
        }

        // --- monster resolution: module_bestiary first, shared bestiary second ---
        const moduleMonsters = (module.module_bestiary && module.module_bestiary.monsters) || {};
        const sharedMonsters = (bestiary && bestiary.monsters) || {};
        const monsterExists = id => Object.prototype.hasOwnProperty.call(moduleMonsters, id)
            || Object.prototype.hasOwnProperty.call(sharedMonsters, id);

        // --- item resolution: module_items first, shared items library second ---
        const moduleItems = (module.module_items && module.module_items.items) || {};
        const sharedItems = (items && items.items) || {};
        const itemExists = id => Object.prototype.hasOwnProperty.call(moduleItems, id)
            || Object.prototype.hasOwnProperty.call(sharedItems, id);

        // --- feature id index (for activate_feature / feature_state prereqs) ---
        const featureIds = new Set();
        for (const room of Object.values(rooms)) {
            for (const f of (room.features || [])) {
                if (f && f.id) featureIds.add(f.id);
            }
        }

        // --- encounter id index (for encounter_defeated prereqs / completion) ---
        const encounterIds = new Set();
        for (const room of Object.values(rooms)) {
            for (const e of (room.encounters || [])) {
                if (e && e.id) encounterIds.add(e.id);
            }
        }

        // --- connection key index (for unlock_connection / reveal_connection) ---
        const connectionKeys = new Set();
        for (const room of Object.values(rooms)) {
            for (const key of Object.keys(room.connections || {})) {
                connectionKeys.add(key);
            }
        }

        // Walk rooms and validate every reference.
        for (const [roomId, room] of Object.entries(rooms)) {
            // Connections: structured form {to, state, label} or simple string
            for (const [key, conn] of Object.entries(room.connections || {})) {
                const target = typeof conn === 'string' ? conn : conn && conn.to;
                if (!target) {
                    push(`rooms.${roomId}.connections.${key}`, 'missing target (expected string or {to})');
                } else if (!roomIds.has(target)) {
                    push(`rooms.${roomId}.connections.${key}.to`, `"${target}" is not a declared room`);
                }
            }

            // Encounters: monster_ref on each group; effect refs on on_defeat_effects
            for (const enc of (room.encounters || [])) {
                for (const g of (enc.groups || [])) {
                    if (g && g.monster_ref && !monsterExists(g.monster_ref)) {
                        push(`rooms.${roomId}.encounters[${enc.id}].groups`,
                            `monster_ref "${g.monster_ref}" not found in module_bestiary or bestiary`);
                    }
                }
                validateEffects(enc.on_defeat_effects, `rooms.${roomId}.encounters[${enc.id}].on_defeat_effects`);
                validateRewards(enc.rewards, `rooms.${roomId}.encounters[${enc.id}].rewards`);
            }

            // Features: rewards on searchable, effects on interactive actions + puzzle on_success
            for (const f of (room.features || [])) {
                const base = `rooms.${roomId}.features[${f.id || '?'}]`;
                if (f.reward)      validateRewards(f.reward, `${base}.reward`);
                if (f.on_success)  validateEffects(f.on_success.effects, `${base}.on_success.effects`);
                if (f.on_success)  validateRewards(f.on_success.reward, `${base}.on_success.reward`);
                if (Array.isArray(f.actions)) {
                    for (let i = 0; i < f.actions.length; i++) {
                        validateEffects(f.actions[i].effects, `${base}.actions[${i}].effects`);
                    }
                } else if (f.actions && typeof f.actions === 'object') {
                    for (const [state, spec] of Object.entries(f.actions)) {
                        validateEffects(spec && spec.effects, `${base}.actions.${state}.effects`);
                    }
                }
                validatePrerequisites(f.prerequisites, `${base}.prerequisites`);
            }

            // Hazards: reward_on_detection / reward_on_avoidance may grant items/xp/gold
            for (const h of (room.hazards || [])) {
                const base = `rooms.${roomId}.hazards[${h.id || '?'}]`;
                if (h.detection) validateRewards(h.detection.reward_on_detection, `${base}.detection.reward_on_detection`);
                if (h.avoidance) validateRewards(h.avoidance.reward_on_avoidance, `${base}.avoidance.reward_on_avoidance`);
            }
        }

        // Character equipment/pack must reference resolvable items.
        for (const eq of (character.equipment || [])) {
            if (eq && eq.item_id && !itemExists(eq.item_id)) {
                push('character.equipment', `item_id "${eq.item_id}" not found in module_items or items_library`);
            }
        }
        for (const p of (character.pack || [])) {
            if (p && p.item_id && !itemExists(p.item_id)) {
                push('character.pack', `item_id "${p.item_id}" not found in module_items or items_library`);
            }
        }

        // Completion condition — may reference an encounter or a room.
        const cc = module.completion_condition;
        if (cc && typeof cc === 'object') {
            if (cc.type === 'defeat_encounter' && cc.target && !encounterIds.has(cc.target)) {
                push('module.completion_condition.target',
                    `"${cc.target}" is not a declared encounter id`);
            }
            if (cc.type === 'reach_room' && cc.target && !roomIds.has(cc.target)) {
                push('module.completion_condition.target',
                    `"${cc.target}" is not a declared room`);
            }
        }

        function validateEffects(effects, loc) {
            if (!Array.isArray(effects)) return;
            effects.forEach((eff, i) => {
                const elocation = `${loc}[${i}]`;
                if (!eff || typeof eff !== 'object') return;
                if (eff.type === 'unlock_connection' || eff.type === 'reveal_connection') {
                    if (eff.target && !connectionKeys.has(eff.target)) {
                        push(`${elocation}.target`, `connection "${eff.target}" not declared in any room`);
                    }
                }
                if (eff.type === 'activate_feature') {
                    if (eff.target && !featureIds.has(eff.target)) {
                        push(`${elocation}.target`, `feature "${eff.target}" not declared in any room`);
                    }
                }
            });
        }

        function validateRewards(reward, loc) {
            if (reward === null || reward === undefined) return;
            const list = Array.isArray(reward) ? reward : [reward];
            list.forEach((r, i) => {
                if (!r || typeof r !== 'object') return;
                const rloc = Array.isArray(reward) ? `${loc}[${i}]` : loc;
                if (r.type === 'item' && r.item_id && !itemExists(r.item_id)) {
                    push(`${rloc}.item_id`, `"${r.item_id}" not found in module_items or items_library`);
                }
            });
        }

        function validatePrerequisites(prereqs, loc) {
            if (!prereqs) return;
            if (Array.isArray(prereqs.encounter_defeated)) {
                prereqs.encounter_defeated.forEach((id, i) => {
                    if (id && !encounterIds.has(id)) {
                        push(`${loc}.encounter_defeated[${i}]`, `"${id}" is not a declared encounter`);
                    }
                });
            }
            if (prereqs.feature_state && typeof prereqs.feature_state === 'object') {
                for (const fid of Object.keys(prereqs.feature_state)) {
                    if (!featureIds.has(fid)) {
                        push(`${loc}.feature_state.${fid}`, `"${fid}" is not a declared feature`);
                    }
                }
            }
        }

        if (errors.length) {
            const summary = errors.map(e => `  - ${e.loc}: ${e.msg}`).join('\n');
            throw new PackLoadError(
                `Pack validation failed with ${errors.length} issue${errors.length === 1 ? '' : 's'}:\n${summary}`,
                { errors }
            );
        }
    }

    global.PackLoader = {
        loadPack,
        PackLoadError,
        _validate: validate,
        _fetchJson: fetchJson,
        _resolveRelative: resolveRelative
    };
})(typeof window !== 'undefined' ? window : globalThis);
