/**
 * nameResolver.ts — v1.7 NEW FILE
 *
 * Deterministic banned-name resolution system. Instead of wrapping violations
 * in [RENAME:X] markers and hoping the AI resolves them, this module:
 *
 *   1. Maintains a persistent map (bannedNameMap) from banned names → replacements
 *   2. Auto-generates compliant replacement names on first encounter
 *   3. Resolves both raw banned names AND [RENAME:X] markers in any string
 *   4. Provides deep-sanitisation for entire state trees (on save load)
 *
 * The map is stored in GameWorld.bannedNameMap and persists across saves.
 */

import { BANNED_NAMES } from '../constants';
import type {
    GameWorld, GameHistory, Character, ChatMessage,
    KnownEntity, MemoryItem, LoreItem
} from '../types';

// ---------------------------------------------------------------------------
// Replacement Name Generation
// ---------------------------------------------------------------------------

/**
 * Pool of replacement name roots. These are pre-vetted to NOT share a 4-char
 * prefix with any name on the BANNED_NAMES list. The pool is large enough
 * to cover all current and future banned names without collisions.
 *
 * Selection is deterministic: hash the banned name to pick a root, then
 * apply a suffix from the suffix pool for uniqueness.
 */
const NAME_ROOTS: readonly string[] = [
    'Brannoc', 'Corvin', 'Desmond', 'Elowen', 'Faelan', 'Grisha',
    'Hadric', 'Iorwen', 'Jorik', 'Kestrin', 'Luned', 'Morwen',
    'Niamh', 'Oswin', 'Petar', 'Quillen', 'Rosslyn', 'Seren',
    'Tamsin', 'Ulric', 'Vasek', 'Wren', 'Yvaine', 'Zorabel',
    'Aldwen', 'Brigid', 'Cadoc', 'Dervla', 'Emrys', 'Ffion',
    'Gareth', 'Hestia', 'Idris', 'Jessamy', 'Kennet', 'Liadan',
    'Maddox', 'Nerys', 'Oisin', 'Prosper', 'Rhodri', 'Sibyl',
    'Tegwen', 'Uthred', 'Vesper', 'Wynne', 'Xanthe', 'Ygritte',
] as const;

/**
 * Generates a simple hash from a string. Used to deterministically select
 * a replacement name root for a given banned name, so the same banned name
 * always maps to the same replacement within a session.
 */
const simpleHash = (str: string): number => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // Convert to 32-bit integer
    }
    return Math.abs(hash);
};

/**
 * Checks if a candidate replacement name shares its first 4 characters
 * with any name on the banned list (case-insensitive).
 */
const sharesBannedPrefix = (candidate: string): boolean => {
    const prefix = candidate.substring(0, 4).toLowerCase();
    return BANNED_NAMES.some(banned =>
        banned.substring(0, 4).toLowerCase() === prefix
    );
};

/**
 * Checks if a candidate name is already in use as a replacement.
 */
const isAlreadyUsed = (candidate: string, existingMap: Record<string, string>): boolean => {
    return Object.values(existingMap).some(v =>
        v.toLowerCase() === candidate.toLowerCase()
    );
};

/**
 * Generates a compliant replacement name for a banned name.
 *
 * Rules enforced:
 *   1. Must NOT share first 4 chars with any banned name
 *   2. Must NOT be a numbered variant (e.g. "Name-6")
 *   3. Must NOT already be in the map as another replacement
 *   4. Must be a single, clean name (no brackets, no markers)
 */
export const generateReplacementName = (
    bannedName: string,
    existingMap: Record<string, string>
): string => {
    const hash = simpleHash(bannedName);

    // Try roots in hash-order until we find a compliant one
    for (let attempt = 0; attempt < NAME_ROOTS.length; attempt++) {
        const idx = (hash + attempt) % NAME_ROOTS.length;
        const candidate = NAME_ROOTS[idx];

        if (!sharesBannedPrefix(candidate) && !isAlreadyUsed(candidate, existingMap)) {
            return candidate;
        }
    }

    // Fallback: generate a completely novel name by combining roots
    const a = NAME_ROOTS[hash % NAME_ROOTS.length].substring(0, 3);
    const b = NAME_ROOTS[(hash + 7) % NAME_ROOTS.length].substring(2);
    const fallback = a + b;
    return fallback;
};

// ---------------------------------------------------------------------------
// Core Resolution
// ---------------------------------------------------------------------------

/**
 * The regex that matches [RENAME:X] markers in text.
 * Captures the banned name inside the marker.
 */
const RENAME_MARKER_REGEX = /\[RENAME:([^\]]+)\]/gi;

/**
 * Resolves all banned names in a string — both raw occurrences and [RENAME:X]
 * markers — using the provided replacement map. Mutates the map to add new
 * entries for any banned names encountered for the first time.
 *
 * @param text      The text to sanitise
 * @param nameMap   The mutable replacement map (will be extended if new names found)
 * @returns         The cleaned text with all banned names replaced
 */
export const resolveAllBannedNames = (
    text: string,
    nameMap: Record<string, string>
): string => {
    if (!text) return text;

    let result = text;

    // Phase 1: Resolve [RENAME:X] markers first
    result = result.replace(RENAME_MARKER_REGEX, (_match, captured: string) => {
        const trimmed = captured.trim();
        // The captured name might itself be a banned name, or it might be
        // something like "Kaelen" inside [RENAME:Kaelen]
        if (!nameMap[trimmed]) {
            nameMap[trimmed] = generateReplacementName(trimmed, nameMap);
        }
        return nameMap[trimmed];
    });

    // Phase 2: Replace raw banned names (word-boundary matched)
    for (const name of BANNED_NAMES) {
        const pattern = new RegExp(`\\b${name}\\b`, 'g');
        if (pattern.test(result)) {
            if (!nameMap[name]) {
                nameMap[name] = generateReplacementName(name, nameMap);
            }
            result = result.replace(new RegExp(`\\b${name}\\b`, 'g'), nameMap[name]);
        }
    }

    return result;
};

/**
 * Convenience: resolve banned names and return both the cleaned text
 * and any violations found (for debug logging).
 */
export const resolveWithTracking = (
    text: string,
    nameMap: Record<string, string>
): { result: string; violations: string[] } => {
    const violations: string[] = [];

    // Check for violations before resolving
    for (const name of BANNED_NAMES) {
        if (new RegExp(`\\b${name}\\b`).test(text)) {
            violations.push(name);
        }
    }
    const markerMatches = text.match(RENAME_MARKER_REGEX);
    if (markerMatches) {
        markerMatches.forEach(m => {
            const inner = m.replace(/\[RENAME:|]/g, '').trim();
            if (!violations.includes(inner)) violations.push(`MARKER:${inner}`);
        });
    }

    const result = resolveAllBannedNames(text, nameMap);
    return { result, violations };
};

// ---------------------------------------------------------------------------
// Deep State Sanitisation (on save load / import)
// ---------------------------------------------------------------------------

/**
 * Deep-sanitises all string fields in the game world, character, and history.
 * Called once on save load/import to clean up legacy contamination.
 *
 * This is the nuclear option — it walks every string field in the entire
 * state tree and resolves banned names. After this, no [RENAME:X] markers
 * or raw banned names should exist anywhere in state.
 *
 * @returns The sanitised state and the (possibly expanded) name map
 */
export const sanitiseStateOnLoad = (
    world: GameWorld,
    character: Character,
    history: GameHistory
): { world: GameWorld; character: Character; history: GameHistory } => {
    // Initialise or use existing map
    const nameMap: Record<string, string> = { ...(world.bannedNameMap ?? {}) };

    const resolve = (text: string): string => resolveAllBannedNames(text, nameMap);

    // --- World ---
    const cleanWorld = { ...world };

    // Entities
    cleanWorld.knownEntities = (world.knownEntities ?? []).map(entity => ({
        ...entity,
        name: resolve(entity.name),
        role: resolve(entity.role),
        impression: resolve(entity.impression),
        leverage: resolve(entity.leverage),
        ledger: (entity.ledger ?? []).map(resolve),
    }));

    // Memory
    cleanWorld.memory = (world.memory ?? []).map(mem => ({
        ...mem,
        fact: resolve(mem.fact),
    }));

    // Lore
    cleanWorld.lore = (world.lore ?? []).map(lore => ({
        ...lore,
        keyword: resolve(lore.keyword),
        content: resolve(lore.content),
    }));

    // Hidden Registry
    cleanWorld.hiddenRegistry = resolve(world.hiddenRegistry ?? '');

    // Scenarios
    cleanWorld.scenarios = (world.scenarios ?? []).map(s => ({
        ...s,
        title: resolve(s.title),
        description: resolve(s.description),
        opening_line: resolve(s.opening_line),
    }));

    // Active Threats
    cleanWorld.activeThreats = (world.activeThreats ?? []).map(t => ({
        ...t,
        name: resolve(t.name),
        condition: resolve(t.condition),
        current_action: resolve(t.current_action),
    }));

    // Dormant Hooks
    if (cleanWorld.dormantHooks) {
        cleanWorld.dormantHooks = cleanWorld.dormantHooks.map(hook => ({
            ...hook,
            summary: resolve(hook.summary),
            activationConditions: resolve(hook.activationConditions ?? ''),
            involvedEntities: (hook.involvedEntities ?? []).map(resolve),
        }));
    }

    // Persist the updated map
    cleanWorld.bannedNameMap = nameMap;

    // --- Character ---
    const cleanChar = { ...character };
    cleanChar.backstory = resolve(character.backstory ?? '');
    cleanChar.appearance = resolve(character.appearance ?? '');
    cleanChar.notableFeatures = resolve(character.notableFeatures ?? '');
    cleanChar.conditions = (character.conditions ?? []).map(resolve);
    cleanChar.relationships = (character.relationships ?? []).map(resolve);
    cleanChar.inventory = (character.inventory ?? []).map(resolve);
    cleanChar.goals = (character.goals ?? []).map(resolve);

    // --- History ---
    const cleanHistory = { ...history };
    cleanHistory.history = (history.history ?? []).map(msg => ({
        ...msg,
        text: resolve(msg.text),
    }));

    return { world: cleanWorld, character: cleanChar, history: cleanHistory };
};

// ---------------------------------------------------------------------------
// Context-Time Sanitisation (per-turn, lightweight)
// ---------------------------------------------------------------------------

/**
 * Sanitises a single string using the world's existing name map.
 * Does NOT generate new replacements — only applies existing mappings.
 * Used for quick inline sanitisation during prompt construction.
 */
export const applyExistingMap = (
    text: string,
    nameMap: Record<string, string>
): string => {
    if (!text || !nameMap || Object.keys(nameMap).length === 0) return text;

    let result = text;

    // Resolve markers
    result = result.replace(RENAME_MARKER_REGEX, (_match, captured: string) => {
        return nameMap[captured.trim()] ?? captured;
    });

    // Resolve raw names (only those we already have mappings for)
    for (const [banned, replacement] of Object.entries(nameMap)) {
        const pattern = new RegExp(`\\b${banned}\\b`, 'g');
        result = result.replace(pattern, replacement);
    }

    return result;
};

/**
 * Sanitises the conversation history array using the existing name map.
 * Returns a new array with cleaned text fields.
 * Called by geminiClient before sending history to the API.
 */
export const sanitiseHistory = (
    history: ChatMessage[],
    nameMap: Record<string, string>
): ChatMessage[] => {
    if (!nameMap || Object.keys(nameMap).length === 0) return history;

    return history.map(msg => ({
        ...msg,
        text: applyExistingMap(msg.text, nameMap),
    }));
};
