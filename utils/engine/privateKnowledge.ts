// ============================================================================
// PRIVATE_KNOWLEDGE.TS — v1.39
//
// NPCs who had just met the player character were citing her private history
// back to her — a research facility in the Sunken Courts, resonant milk — while
// ignoring what their own sheets said about them.
//
// The player had already forbidden it. Carissa Vorn's `backstory` field
// contains, in the author's own words, on its own line:
//
//     [ALL BELOW INFORMATION IS GM KNOWLEDGE ONLY. NO NPC IS AWARE OF IT.]
//
// and everything after it is the secret half. The engine took that entire
// 7,185-character string — marker included — and rendered it as:
//
//     **Primary Directive: Player Character Identity**
//     This is the player character. This data is ABSOLUTE TRUTH.
//     - **Backstory:** <all of it>
//
// "ABSOLUTE TRUTH" reads as true-in-the-world, i.e. common knowledge. The field
// label is a bare `**Backstory:**` with no scoping. The author's marker is one
// unparsed line buried mid-field, and nothing in the codebase looked for it.
// `character.hiddenNotes` existed on the type and was never rendered at all.
//
// There was also no general rule anywhere about what an NPC knows. The engine's
// only information-chain check lives in `threatPipelineCore` — "no plausible
// information chain — the actor could not know what this threat assumes they
// know" — which is exactly the right idea, wired to the threat pipeline and
// nothing else. Dialogue had no equivalent.
//
// The asymmetry the player noticed is structural: the PC's secrets travelled in
// the CACHED STATIC PREFIX under "ABSOLUTE TRUTH", while the NPC's own sheet sat
// mid-prompt in [ACTIVE ENTITIES] as scene context, competing with ~11k of
// character state. The engine was telling the model the player's secrets
// outranked the characters' sheets.
//
// This module does three jobs:
//   M1  split the private half out of the backstory, on the author's marker
//   M2  render it under a real prohibition, plus the general NPC-knowledge rule
//   M3  detect a leak in what NPCs actually SAY, and log it
// ============================================================================

import type { Character, KnownEntity } from '../../types';

// ---------------------------------------------------------------------------
// M1 — split on the author's marker
// ---------------------------------------------------------------------------

/**
 * A bracketed line declaring that what follows is GM-only.
 *
 * Deliberately generous about phrasing and strict about shape: it must be a
 * bracketed span, and it must contain a secrecy word. Authors write these by
 * hand and will not all write them the same way, but nobody writes "[GM
 * KNOWLEDGE ONLY]" inside ordinary prose by accident.
 */
const GM_MARKER_RE =
    /^[ \t]*[\[(]{1,2}[^\]\n)]*\b(?:gm[ -]?(?:knowledge|only|eyes)|secret|hidden|private|not known to|no npc|npcs? (?:are|is) not aware|player only|ooc only)\b[^\]\n)]*[\])]{1,2}[ \t]*$/im;

export interface SplitBackstory {
    /** The half any NPC could plausibly have heard. */
    publicHalf: string;
    /** The half the author marked GM-only. Empty when no marker is present. */
    privateHalf: string;
    /** The marker line itself, for the debug log. */
    marker: string | null;
}

/**
 * Split a backstory on the first GM-only marker line.
 *
 * With no marker the whole field is public — that is the pre-v1.39 behaviour
 * and the correct default, since an unmarked backstory carries no claim of
 * secrecy and silently hiding half of it would be worse than the bug.
 */
export const splitPrivateBackstory = (backstory: string | undefined | null): SplitBackstory => {
    const text = (backstory ?? '').trim();
    if (!text) return { publicHalf: '', privateHalf: '', marker: null };

    const m = text.match(GM_MARKER_RE);
    if (!m || m.index === undefined) {
        return { publicHalf: text, privateHalf: '', marker: null };
    }

    return {
        publicHalf: text.slice(0, m.index).trim(),
        privateHalf: text.slice(m.index + m[0].length).trim(),
        marker: m[0].trim(),
    };
};

// ---------------------------------------------------------------------------
// M2 — render it with a prohibition that outranks the identity block's framing
// ---------------------------------------------------------------------------

/**
 * The private block, plus the general NPC-knowledge rule.
 *
 * Returns '' when there is nothing private, so a character without secrets pays
 * nothing. The knowledge rule rides with the private block deliberately: it is
 * the rule that makes the block mean something, and stating it in the abstract
 * on turns where nothing is at stake is how a rule becomes wallpaper.
 */
export const buildPrivateKnowledgeBlock = (
    privateText: string,
    hiddenNotes?: string,
): string => {
    const parts = [privateText?.trim(), hiddenNotes?.trim()].filter(Boolean);
    if (parts.length === 0) return '';

    return `[GM-ONLY — TRUE, AND KNOWN TO NO ONE IN THE WORLD]
The author marked what follows as GM knowledge. It is true — it happened, it
shaped this character, and it may drive her own thoughts, dreams, reflexes and
fears. It is NOT public, and the "ABSOLUTE TRUTH" framing on the identity block
above means true-of-her, not known-to-others.

NO NPC KNOWS ANY OF THIS. Not the well-connected ones, not the ones whose sheets
say they read people, not the faction with informants, not a character who
"would have heard something". No NPC may state it, hint at it, allude to it,
ask a question that presumes it, or act on it. An NPC who has just met her knows
what she looks like and what she has said out loud in this scene — nothing else.

If a character is ever to learn a piece of this, it must happen ON THE PAGE:
someone tells them, they read it, they witness it, they extract it. Then it goes
in that NPC's ledger and it is theirs from that turn forward. Until that
happens, it does not exist for them.

${parts.join('\n\n')}`;
};

/**
 * The general rule, for characters with no marked secrets.
 *
 * Shorter, and it carries the half that is not about secrecy at all: the
 * complaint that produced this module was TWO failures at once — NPCs knowing
 * what they could not know, and NPCs ignoring what they demonstrably do know
 * because it is on their own sheet.
 */
export const NPC_KNOWLEDGE_RULE = `[WHAT NPCS KNOW]
An NPC's knowledge is bounded and specific. It is exactly:
- what they have observed in a scene they were present for;
- what someone told them, on the page, in play — their Ledger is that record;
- what their role, faction, trade and location would plainly give them.

That is the whole list. Being perceptive, well-connected, or written as
"several moves ahead" is a description of how they USE what they know; it is
not a licence to know more. An NPC does not get the player's history, motives,
or private facts because the narrator has them.

The same boundary runs the other way, and it is the more common failure: an NPC
DOES know their own sheet. Their canonical personality, their appetites, their
methods and their history are theirs, in full, at all times. Do not have a
character be vague about, or act against, what their own record says they are.`;

// ---------------------------------------------------------------------------
// M3 — leak detection, on what NPCs SAY
// ---------------------------------------------------------------------------
// Scanning the whole narrative would be wrong. The narration is the GM's voice
// and the PC's interiority: Carissa remembering the facility is correct and
// good. The defect is an NPC saying it. So this reads dialogue only.

/** Words too common to be evidence of anything. */
const STOPWORDS = new Set([
    'the', 'and', 'her', 'his', 'she', 'him', 'they', 'them', 'that', 'this',
    'with', 'from', 'into', 'onto', 'for', 'was', 'were', 'has', 'had', 'have',
    'been', 'their', 'there', 'which', 'when', 'what', 'who', 'whom', 'not',
    'but', 'all', 'any', 'are', 'its', 'she', 'own', 'one', 'two', 'six',
    'after', 'before', 'about', 'above', 'below', 'over', 'under', 'than',
    'then', 'these', 'those', 'some', 'such', 'only', 'very', 'more', 'most',
    'other', 'others', 'young', 'old', 'little', 'never', 'ever', 'still',
]);

const words = (s: string): string[] =>
    s.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];

/**
 * Distinctive phrases from the private half — the things that, said aloud by
 * someone who should not know them, identify a leak.
 *
 * Two sources, both requiring at least two words so a single ordinary noun can
 * never trip it:
 *   - capitalised multi-word names ("Sunken Courts")
 *   - content-word bigrams present in the private half and absent from the
 *     public half ("resonant milk")
 *
 * Anything that also appears in the PUBLIC backstory is dropped: that is
 * material the world may legitimately know, and it is the single largest source
 * of false positives.
 */
export const extractPrivateTerms = (
    privateText: string,
    publicText: string = '',
    excludeNames: string[] = [],
): string[] => {
    const priv = (privateText ?? '').trim();
    if (!priv) return [];

    const publicLower = (publicText ?? '').toLowerCase();
    const excluded = new Set<string>();
    for (const n of excludeNames) {
        for (const part of (n ?? '').toLowerCase().split(/\s+/)) {
            if (part.length >= 3) excluded.add(part);
        }
    }

    const terms = new Set<string>();

    // 1. Capitalised multi-word proper nouns.
    for (const m of priv.matchAll(/\b([A-Z][a-z]{2,}(?:\s+(?:of|the|de)?\s*[A-Z][a-z]{2,})+)/g)) {
        const term = m[1].trim();
        const lower = term.toLowerCase();
        if (publicLower.includes(lower)) continue;
        if (lower.split(/\s+/).some(w => excluded.has(w))) continue;
        terms.add(term);
    }

    // 2. Content-word bigrams unique to the private half.
    const toks = words(priv);
    for (let i = 0; i < toks.length - 1; i++) {
        const a = toks[i];
        const b = toks[i + 1];
        if (STOPWORDS.has(a) || STOPWORDS.has(b)) continue;
        if (excluded.has(a) || excluded.has(b)) continue;
        if (a.length < 4 || b.length < 4) continue;
        const bigram = `${a} ${b}`;
        if (publicLower.includes(bigram)) continue;
        terms.add(bigram);
    }

    return [...terms];
};

/**
 * Pull out what was actually SPOKEN — quoted spans, plus the structured
 * dialogue field when the model supplied one.
 *
 * Handles straight and curly double quotes and the single-quote style this
 * engine's narrator favours ('Oh, you poor thing,' she says).
 */
export const extractSpokenText = (
    narrative: string | undefined | null,
    npcDialogue?: string | null,
): string => {
    const out: string[] = [];
    if (npcDialogue?.trim()) out.push(npcDialogue.trim());

    const text = narrative ?? '';
    // Straight and curly DOUBLE quotes are unambiguous.
    for (const re of [/"([^"]{2,400})"/g, /“([^”]{2,400})”/g]) {
        for (const m of text.matchAll(re)) out.push(m[1]);
    }
    // Single quotes are not: prose is full of apostrophes, and "Sania's hand"
    // followed later by a real quote will pair the apostrophe with the opening
    // quote and swallow the actual dialogue. So an opening quote must start a
    // word (preceded by start-of-line, whitespace or an opening bracket/dash)
    // and a closing quote must end a clause (followed by punctuation,
    // whitespace or end) — which an apostrophe inside a word never does.
    for (const re of [
        /(?:^|[\s(\[—-])'([^'\n]{6,400})'(?=[\s.,!?;:)\]—]|$)/g,
        /(?:^|[\s(\[—-])‘([^’\n]{6,400})’(?=[\s.,!?;:)\]—]|$)/g,
    ]) {
        for (const m of text.matchAll(re)) out.push(m[1]);
    }
    return out.join('\n');
};

export interface PrivateLeakReport {
    leaked: boolean;
    /** The private phrases that were spoken aloud. */
    terms: string[];
    /** A short excerpt of the offending speech, for the log. */
    excerpt: string | null;
}

/**
 * Did an NPC say something only the GM should know?
 *
 * Never blocks or resamples a turn — a false positive must not cost the player
 * a beat, and the phrase list is heuristic. It writes a line to the debug log
 * so a leak is visible at the moment it happens rather than only on a reread.
 */
export const detectPrivateKnowledgeLeak = (
    narrative: string | undefined | null,
    npcDialogue: string | null | undefined,
    privateTerms: string[],
): PrivateLeakReport => {
    const empty: PrivateLeakReport = { leaked: false, terms: [], excerpt: null };
    if (privateTerms.length === 0) return empty;

    const spoken = extractSpokenText(narrative, npcDialogue);
    if (!spoken.trim()) return empty;
    const spokenLower = spoken.toLowerCase();

    const hits = privateTerms.filter(t => spokenLower.includes(t.toLowerCase()));
    if (hits.length === 0) return empty;

    const first = hits[0].toLowerCase();
    const at = spokenLower.indexOf(first);
    const excerpt = spoken.slice(Math.max(0, at - 60), at + first.length + 60).replace(/\s+/g, ' ').trim();

    return { leaked: true, terms: hits, excerpt };
};

/** Convenience: the private terms for a character, ready for the detector. */
export const privateTermsForCharacter = (
    character: Character,
    entities: KnownEntity[] = [],
): string[] => {
    const { publicHalf, privateHalf } = splitPrivateBackstory(character.backstory);
    const priv = [privateHalf, character.hiddenNotes ?? ''].filter(Boolean).join('\n\n');
    if (!priv.trim()) return [];
    return extractPrivateTerms(priv, publicHalf, [
        character.name ?? '',
        ...entities.map(e => e.name).filter(Boolean),
    ]);
};
