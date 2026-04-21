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
        const module = moduleFile.adventure_module || moduleFile.module || moduleFile;
        const character = characterFile.character || characterFile;

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

    // validate() does cross-reference checks across all archetypes. The full pass
    // lands in a follow-up chunk; this stub catches the cheapest guardrail (character
    // pack id must match manifest id) so 1b can boot end-to-end before 1b-ii.
    function validate(gameData) {
        if (gameData.character.game_pack_id && gameData.manifest.id &&
            gameData.character.game_pack_id !== gameData.manifest.id) {
            throw new PackLoadError(
                `Character game_pack_id "${gameData.character.game_pack_id}" does not match manifest id "${gameData.manifest.id}"`,
                { field: 'character.game_pack_id' }
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
