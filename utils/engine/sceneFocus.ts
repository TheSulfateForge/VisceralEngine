// ============================================================================
// utils/engine/sceneFocus.ts — v1.48: steer a scene once, not every turn
// ============================================================================
//
// In the 2026-10-31 Nissa save the player appended the same bracketed note to
// six consecutive turns: "[Continue with the anatomical realism of Ivo Kerrick
// fucking me, what he does, what he says, how my body responds ...]". The note
// was about the SCENE, not the turn, and nothing could hold it.
//
// A scene focus is that note, kept. It is set by hand in the input bar or
// captured from a bracketed instruction in the player's input, rendered in the
// tail every turn, and cleared when the location changes (not on a scene-MODE
// flip — SOCIAL→NARRATIVE happens mid-scene constantly).
// ============================================================================

import type { SceneFocus } from '../../types';

const INSTRUCTION_VERBS = [
    'continue', 'provide', 'use', 'describe', 'keep', 'show', 'make', 'write', 'focus', 'include',
    'maintain', 'narrate', 'render', 'portray', 'detail', 'give', 'have', 'let', 'stay', 'be',
];

/** Bracket contents that are the player's thoughts or engine traffic, not steering. */
const NOT_STEERING = /^\s*(?:thinking|thought|thoughts|ooc|system|dice|bargain|strict|note to self|whisper)/i;

/**
 * The bracketed narration instruction in a player's input, if there is one.
 * "**[Thinking to myself: ...]**" is not one; "[Continue with ...]" is.
 */
export const extractBracketFocus = (text: string): string | null => {
    if (!text) return null;
    const found: string[] = [];
    for (const m of text.matchAll(/\[([^[\]]{15,})\]/g)) {
        const body = m[1].trim();
        if (NOT_STEERING.test(body)) continue;
        const first = body.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
        if (!INSTRUCTION_VERBS.includes(first)) continue;
        found.push(body);
    }
    return found.length > 0 ? found.join(' ') : null;
};

export const buildSceneFocusBlock = (focus: SceneFocus | undefined): string => {
    if (!focus?.text?.trim()) return '';
    return `[SCENE FOCUS — set by the player for this scene (turn ${focus.setTurn}), binding until the scene changes]
${focus.text.trim()}
This is how the player wants THIS scene written. It applies to every turn of
the scene, including this one, without being repeated.`;
};

/** Clear when the player leaves the place the focus was set in. */
export const shouldClearSceneFocus = (focus: SceneFocus | undefined, newLocation: string | undefined): boolean => {
    if (!focus || focus.keepAcrossScenes) return false;
    return (focus.location ?? '') !== (newLocation ?? '');
};

/**
 * The player typing a regenerate request as a turn. In the reviewed save
 * "Regenerate response", "Response cut off regenerate." and "Regenerate
 * response in full" were all sent as in-character actions and fed to the model
 * as story.
 */
export const isRegenerateRequest = (text: string): boolean => {
    const t = (text ?? '').trim();
    if (!t || t.length > 60) return false;
    return /^\[?\s*(?:(?:the\s+)?response\s+(?:was\s+)?cut\s+off[\s,.]*)?(?:please\s+)?(?:regenerate|re-?generate|reroll|re-?roll|retry)(?:\s+(?:the\s+)?(?:last\s+)?(?:response|turn|reply))?(?:\s+in\s+full)?\s*\]?[.!]*$/i.test(t);
};
