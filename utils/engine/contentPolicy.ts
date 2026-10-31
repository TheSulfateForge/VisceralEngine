// ============================================================================
// utils/engine/contentPolicy.ts — v1.48: content rules set once, enforced always
// ============================================================================
//
// The 2026-10-31 Nissa save opened with four OOC turns that were not about the
// scene at all — they were the player's standing rules for every game he
// plays: NPCs may initiate anything, everything explicit, no fade-to-black, no
// character written as cold/calculating/clinical/predatory. He typed them
// again at turn 36 and the five-slot directive FIFO evicted the originals.
//
// These now live in Settings. They render at the tail with the standing
// directives (so they carry the same precedence the player's OOC directives
// earned in v1.37), and the descriptor ban is enforced on the OUTPUT — the
// engine's standing principle is that a constraint living only in the prompt
// is a suggestion.
// ============================================================================

import type { Character, ContentPolicy, GameWorld, KnownEntity } from '../../types';

export const CONTENT_POLICY_STORAGE_KEY = 'visceral_content_policy';

export const DEFAULT_CONTENT_POLICY: ContentPolicy = {
    npcSexualInitiative: 'default',
    explicitness: 'default',
    bannedDescriptors: [],
    anatomicalRealism: true,
    narrationPerson: 'match',
};

/** Fill any missing fields — stored policies predate later fields. */
export const normalizeContentPolicy = (p: Partial<ContentPolicy> | null | undefined): ContentPolicy => ({
    npcSexualInitiative: p?.npcSexualInitiative === 'consensual' || p?.npcSexualInitiative === 'any'
        ? p.npcSexualInitiative : 'default',
    explicitness: p?.explicitness === 'explicit' ? 'explicit' : 'default',
    bannedDescriptors: Array.isArray(p?.bannedDescriptors)
        ? Array.from(new Set(p!.bannedDescriptors.map(s => String(s).trim().toLowerCase()).filter(Boolean)))
        : [],
    anatomicalRealism: p?.anatomicalRealism !== false,
    narrationPerson: p?.narrationPerson === 'first' || p?.narrationPerson === 'second' || p?.narrationPerson === 'third'
        ? p.narrationPerson : 'match',
});

export const loadDefaultContentPolicy = (): ContentPolicy => {
    try {
        if (typeof localStorage === 'undefined') return { ...DEFAULT_CONTENT_POLICY };
        const raw = localStorage.getItem(CONTENT_POLICY_STORAGE_KEY);
        return raw ? normalizeContentPolicy(JSON.parse(raw)) : { ...DEFAULT_CONTENT_POLICY };
    } catch {
        return { ...DEFAULT_CONTENT_POLICY };
    }
};

export const saveDefaultContentPolicy = (p: ContentPolicy): void => {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(CONTENT_POLICY_STORAGE_KEY, JSON.stringify(normalizeContentPolicy(p)));
    } catch { /* storage full or blocked — the campaign copy still holds */ }
};

/** The campaign's own policy, else the Settings default. */
export const effectiveContentPolicy = (world: Pick<GameWorld, 'contentPolicy'> | undefined): ContentPolicy =>
    world?.contentPolicy ? normalizeContentPolicy(world.contentPolicy) : loadDefaultContentPolicy();

/**
 * The policy as standing-directive lines. Rendered FIRST inside the
 * [STANDING DIRECTIVES] block, so they sit in the final position with the same
 * precedence sentence the player's own OOC directives get.
 *
 * The banned list is named exactly once, here. The static prompt used to name
 * these four words more than forty times while telling the model not to use
 * them.
 */
export const contentPolicyLines = (p: ContentPolicy): string[] => {
    const lines: string[] = [];
    if (p.npcSexualInitiative === 'any') {
        lines.push('NPCs may initiate any sexual act on their own authority — consensual or non-consensual, tame to explicitly taboo — exactly as their own sheets dictate. They do not wait for the player to reciprocate or invite it.');
    } else if (p.npcSexualInitiative === 'consensual') {
        lines.push('NPCs may initiate sexual contact on their own authority, as their sheets dictate, but only consensually: a refusal from the player stops them.');
    }
    if (p.explicitness === 'explicit') {
        lines.push('All sexual content is explicit, vulgar, raunchy and graphic. Plain anatomical nouns, full mechanical detail, no euphemism, no softening, no fade-to-black, no time-skip past it.');
    }
    if (p.bannedDescriptors.length > 0) {
        lines.push(`No character is ever written as ${p.bannedDescriptors.map(d => `"${d}"`).join(', ')}, or any synonym, or behaviour that implies them. Write each character's actions and dialogue expressively, from the traits on their own sheet. The engine scans every turn for these words and makes you rewrite a turn that uses them.`);
    }
    return lines;
};

// ---------------------------------------------------------------------------
// Descriptor enforcement
// ---------------------------------------------------------------------------

/**
 * Close synonyms the player meant by "or their synonyms". Matched only in a
 * characterising context (see AMBIGUOUS) because most of them have literal
 * uses — a detached house, surgical steel, an icy road.
 */
const SYNONYMS: Record<string, string[]> = {
    cold: ['icy', 'frosty', 'frigid', 'glacial', 'chilly'],
    calculating: ['scheming', 'conniving', 'cunning'],
    calculated: ['scheming', 'conniving', 'cunning'],
    clinical: ['detached', 'analytical', 'surgical', 'dispassionate'],
    predatory: ['predator', 'predators', 'predation', 'wolfish'],
};

/**
 * Words with ordinary physical meanings. These are flagged only when they are
 * said OF a person (their voice, eyes, manner — or "he was X"). Anything not
 * in this set is flagged wherever it appears, which is what the player asked
 * for: "do not use these words".
 */
const AMBIGUOUS = new Set([
    'cold', 'icy', 'frosty', 'frigid', 'glacial', 'chilly', 'detached', 'surgical',
    'hard', 'sharp', 'flat', 'dark', 'steady', 'smooth', 'cool',
]);

const PERSON_NOUNS = [
    'voice', 'voices', 'tone', 'eyes', 'eye', 'gaze', 'stare', 'smile', 'grin', 'smirk', 'look', 'looks',
    'expression', 'face', 'manner', 'demeanor', 'demeanour', 'precision', 'efficiency', 'detachment',
    'interest', 'amusement', 'patience', 'calm', 'focus', 'assessment', 'appraisal', 'intent', 'hunger',
    'gleam', 'glint', 'edge', 'words', 'way', 'man', 'woman', 'bastard', 'bitch', 'laugh', 'reply',
    'answer', 'mind', 'heart', 'fury', 'anger', 'satisfaction', 'pleasure', 'certainty', 'control',
    'approval', 'appetite', 'attention', 'curiosity', 'regard', 'silence', 'menace', 'command', 'correction',
];

const COPULAS = '(?:is|was|were|are|am|been|being|sounded|sounds|looked|looks|seemed|seems|grew|grows|turned|turns|went|goes|felt|feels|remained|remains|stayed|stays|became|becomes|stood|sat)';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Morphological variants of a banned word: cold → cold, coldly, coldness. */
export const descriptorVariants = (word: string): string[] => {
    const w = word.trim().toLowerCase();
    if (!w) return [];
    const out = new Set<string>([w]);
    if (w.endsWith('y')) {
        out.add(`${w.slice(0, -1)}ily`);
        out.add(`${w.slice(0, -1)}iness`);
    } else if (w.endsWith('ic')) {
        out.add(`${w}ally`);
    } else if (w.endsWith('al')) {
        out.add(`${w}ly`);
    } else {
        out.add(`${w}ly`);
        out.add(`${w}ness`);
    }
    if (w === 'calculating' || w === 'calculated') {
        ['calculating', 'calculated', 'calculatingly', 'calculatedly'].forEach(v => out.add(v));
    }
    if (w === 'predatory') ['predatorily', 'predator', 'predators', 'predation'].forEach(v => out.add(v));
    return [...out];
};

export interface DescriptorViolation {
    term: string;
    /** The banned word the term derives from. */
    banned: string;
    snippet: string;
}

/**
 * Every banned descriptor in `text`, with a short snippet of where.
 * Adverbs ("coldly") always count — an adverb on a verb is characterisation.
 */
export const findDescriptorViolations = (
    text: string,
    banned: string[],
    /** `names`: character names, so "Ivo was cold" counts as said OF a person. */
    options: { includeSynonyms?: boolean; names?: string[] } = {},
): DescriptorViolation[] => {
    if (!text || banned.length === 0) return [];
    const includeSynonyms = options.includeSynonyms !== false;
    const out: DescriptorViolation[] = [];
    const seen = new Set<string>();
    const personNouns = PERSON_NOUNS.join('|');
    const nameParts = (options.names ?? [])
        .flatMap(n => [n, ...n.split(/\s+/)])
        .filter(p => p.length >= 3)
        .map(esc);
    // A copula only characterises when its subject is a person: "he was X",
    // "her voice went X", "Ivo was X" — not "the floor was X".
    const SUBJECT = `(?:he|she|they|i|you|we|him|her|his|their|my|your${nameParts.length ? `|${nameParts.join('|')}` : ''})`;

    for (const b of banned) {
        const base = b.trim().toLowerCase();
        if (!base) continue;
        const terms = new Set(descriptorVariants(base));
        if (includeSynonyms) for (const syn of SYNONYMS[base] ?? []) terms.add(syn);

        for (const term of terms) {
            const isAdverb = term.endsWith('ly') && term !== base;
            const ambiguous = AMBIGUOUS.has(term) && !isAdverb;
            const patterns: RegExp[] = ambiguous
                ? [
                    // "cold eyes", "cold, flat voice"
                    new RegExp(`\\b${esc(term)}\\b(?:[\\s,-]+\\w+){0,2}?[\\s,-]+(?:${personNouns})\\b`, 'gi'),
                    // "he was cold", "her voice went utterly cold"
                    new RegExp(`\\b${SUBJECT}\\b(?:\\s+\\w+){0,2}?\\s+${COPULAS}\\s+(?:\\w+\\s+){0,2}?${esc(term)}\\b`, 'gi'),
                ]
                : [new RegExp(`\\b${esc(term)}\\b`, 'gi')];
            for (const re of patterns) {
                for (const m of text.matchAll(re)) {
                    const at = m.index ?? 0;
                    const key = `${term}@${at}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const start = Math.max(0, at - 40);
                    const end = Math.min(text.length, at + m[0].length + 40);
                    out.push({
                        term,
                        banned: base,
                        snippet: `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`,
                    });
                }
            }
        }
    }
    return out;
};

/** The resample reminder. Quotes the offending phrases back. */
export const buildDescriptorReminder = (violations: DescriptorViolation[]): string => {
    const quoted = violations.slice(0, 8).map(v => `- "${v.snippet}" (${v.term})`).join('\n');
    return `[SYSTEM REMINDER: BANNED DESCRIPTORS — REWRITE THIS TURN — v1.48]
The previous draft of this turn described characters in terms the player has
banned in the content policy:
${quoted}

Write the same events again. Each character acts and speaks from the traits on
their own sheet — expressive, specific, in their own voice. Do not swap in a
synonym; change what the character DOES and SAYS so the trait shows without
the label.`;
};

export interface SheetLintFinding {
    /** Character or NPC name. */
    owner: string;
    /** Field the word was found in. */
    field: string;
    term: string;
    snippet: string;
}

/**
 * Banned words already written on the sheets. A sheet that calls a character's
 * corrections "calculated" primes exactly the word the player banned — the
 * model reads the sheet as canon. The engine never edits canon; it reports.
 */
export const lintSheetsForDescriptors = (
    character: Pick<Character, 'name' | 'appearance' | 'backstory' | 'notableFeatures'>,
    entities: Pick<KnownEntity, 'name' | 'personality' | 'appearance' | 'voice_sample'>[],
    banned: string[],
): SheetLintFinding[] => {
    if (banned.length === 0) return [];
    const out: SheetLintFinding[] = [];
    const scan = (owner: string, field: string, text: string | undefined) => {
        if (!text) return;
        for (const v of findDescriptorViolations(text, banned, { includeSynonyms: false })) {
            out.push({ owner, field, term: v.term, snippet: v.snippet });
        }
    };
    scan(character.name, 'appearance', character.appearance);
    scan(character.name, 'backstory', character.backstory);
    scan(character.name, 'notable features', character.notableFeatures);
    for (const e of entities) {
        scan(e.name, 'personality', e.personality);
        scan(e.name, 'appearance', e.appearance);
        scan(e.name, 'voice sample', e.voice_sample);
    }
    return out;
};
