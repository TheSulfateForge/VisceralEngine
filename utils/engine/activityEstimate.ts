// ────────────────────────────────────────────────────────────────────────────
// v1.57: ACTIVITY TIME BY MEANING, NOT BY KEYWORD.
//
// v1.51–v1.56 floored the clock with a regex per activity ("dress in", "sit
// and read", "to pass the time"). Every new phrasing needed a new rule, and a
// typo ("I finde a boom to read") slipped through. This replaces that list as
// the activity floor: the player's input is split into actions, each action is
// embedded with the same local model the RAG uses (bge-small), and matched to
// the nearest of a few dozen example actions with known durations. One example
// covers a whole family of phrasings.
//
// It is a FLOOR, not the clock: the model's itemised time_beats remain the
// primary source. The floor only stops a turn from collapsing to +1m when the
// model under-counts or sends nothing.
// ────────────────────────────────────────────────────────────────────────────

export interface ActivityAnchor { text: string; minutes: number; label: string }

/**
 * Example actions → minutes. Phrased the way players write them. Trivial
 * gestures are anchors too (0m) so a glance matches "glance", not "meal".
 */
export const ACTIVITY_ANCHORS: ActivityAnchor[] = [
    // trivial — the beat itself
    { text: 'I glance at her', minutes: 0, label: 'glance' },
    { text: 'I nod and say something', minutes: 0, label: 'gesture' },
    { text: 'I cock my head and look at him', minutes: 0, label: 'gesture' },
    { text: 'I turn around', minutes: 0, label: 'gesture' },
    { text: 'I open the door', minutes: 0, label: 'gesture' },
    { text: 'I hand her the cup', minutes: 0, label: 'gesture' },
    { text: 'I stand up', minutes: 0, label: 'gesture' },
    { text: 'I ask him a question', minutes: 0, label: 'speech' },
    // short
    { text: 'I pour another cup of coffee', minutes: 3, label: 'pour a drink' },
    { text: 'I rinse the cup and put it in the basin', minutes: 2, label: 'tidy up' },
    { text: 'I walk into the next room', minutes: 1, label: 'cross the house' },
    { text: 'I head downstairs to the kitchen', minutes: 2, label: 'cross the house' },
    { text: 'I sip my coffee', minutes: 3, label: 'drink' },
    { text: 'I put on my boots and belt', minutes: 3, label: 'dressing' },
    { text: 'I wash my face and hands', minutes: 3, label: 'washing' },
    // routine
    { text: 'I get dressed in my clothes', minutes: 8, label: 'dressing' },
    { text: 'I shave and groom myself', minutes: 10, label: 'grooming' },
    { text: 'I take a quick shower', minutes: 10, label: 'shower' },
    { text: 'I start a pot of coffee', minutes: 10, label: 'brewing' },
    { text: 'I slice some bread and butter it', minutes: 5, label: 'prepare food' },
    { text: 'I eat my bread', minutes: 10, label: 'eating' },
    { text: 'I eat breakfast', minutes: 20, label: 'meal' },
    { text: 'I sit down and eat dinner', minutes: 30, label: 'meal' },
    { text: 'I cook a meal', minutes: 30, label: 'cooking' },
    { text: 'I take a long bath', minutes: 25, label: 'bath' },
    { text: 'I go through a series of stretches', minutes: 15, label: 'exercise' },
    { text: 'I work out and train with weights', minutes: 40, label: 'training' },
    { text: 'I practice sword forms in the yard', minutes: 30, label: 'practice' },
    { text: 'I spar with him', minutes: 20, label: 'sparring' },
    { text: 'I walk slowly around the garden', minutes: 15, label: 'stroll' },
    { text: 'I walk across the district to the market', minutes: 25, label: 'walk across town' },
    { text: 'I ride across the city', minutes: 30, label: 'ride across town' },
    { text: 'I shop at the market stalls', minutes: 30, label: 'shopping' },
    { text: 'I read a letter', minutes: 3, label: 'read a letter' },
    { text: 'I write a letter', minutes: 15, label: 'write a letter' },
    { text: 'I sit and read a book', minutes: 30, label: 'reading' },
    { text: 'I study the rule book and familiarize myself with it', minutes: 40, label: 'study' },
    { text: 'I go over the accounts and ledgers', minutes: 45, label: 'paperwork' },
    { text: 'I relax and wait for her to wake up', minutes: 30, label: 'waiting' },
    { text: 'I read to pass the time', minutes: 30, label: 'passing time' },
    { text: 'I sit by the window and think for a while', minutes: 10, label: 'idling' },
    { text: 'I lie back and relax', minutes: 15, label: 'resting' },
    { text: 'I stretch out and read until she wakes up', minutes: 30, label: 'waiting' },
    { text: 'I walk out into the garden', minutes: 5, label: 'cross the grounds' },
    { text: 'I clean and sharpen my weapons', minutes: 20, label: 'maintenance' },
    { text: 'I search the room thoroughly', minutes: 10, label: 'search' },
    { text: 'I tend to his wounds', minutes: 15, label: 'first aid' },
];

/** Below this cosine a clause matches nothing (bge-small, normalized). */
export const ACTIVITY_MATCH_THRESHOLD = 0.72;
/** Anchors this close to a clause's best match count as ties. */
export const ACTIVITY_TIE_MARGIN = 0.04;
/** Ceiling on the summed floor; the model's own figure may exceed it. */
export const ACTIVITY_SIMILARITY_CAP_MINUTES = 90;
const MAX_CLAUSES = 8;

/**
 * Split a player turn into actions: drop quoted speech and [notes], then cut
 * on sentence ends and sequencing words.
 */
export const splitActions = (input: string): string[] => {
    const text = (input ?? '')
        .replace(/\[[^\]]*\]?/g, ' ')                 // [OOC …], [It is 5:29AM]
        .replace(/["“][^"”]*["”]?/g, ' ')             // what they SAY
        .replace(/\s+/g, ' ');
    return text
        .split(/[.;!?\n]+|\s*,?\s*\b(?:and then|then|while|after that|afterwards|once done|when done|finished \w+ing)\b\s*|,\s*(?:and\s+)?(?=i\b)|\s+and\s+(?=i\b)/i)
        .map(s => (s ?? '').trim().replace(/^(?:and|then|so)\s+/i, ''))
        .filter(s => s.split(/\s+/).length >= 2)
        .slice(0, MAX_CLAUSES);
};

export interface ActivityMatch { clause: string; label: string; minutes: number; score: number }
export interface ActivityEstimate { minutes: number; matches: ActivityMatch[] }

type EncodeBatch = (texts: string[]) => Promise<Float32Array[]>;

const dot = (a: Float32Array, b: Float32Array): number => {
    let s = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) s += a[i] * b[i];
    return s;
};

// Anchor vectors are computed once per encoder and reused.
let anchorCache: { encoder: EncodeBatch; vectors: Promise<Float32Array[]> } | null = null;
const anchorVectors = (encode: EncodeBatch): Promise<Float32Array[]> => {
    if (!anchorCache || anchorCache.encoder !== encode) {
        const vectors = encode(ACTIVITY_ANCHORS.map(a => a.text));
        anchorCache = { encoder: encode, vectors };
        vectors.catch(() => { if (anchorCache?.vectors === vectors) anchorCache = null; });
    }
    return anchorCache.vectors;
};

/**
 * Estimate the minutes the player's declared actions take.
 * Each clause takes its nearest anchor's minutes when the match clears the
 * threshold; clauses are summed and capped.
 */
export const estimateActivityBySimilarity = async (
    playerInput: string,
    encode: EncodeBatch,
): Promise<ActivityEstimate> => {
    const clauses = splitActions(playerInput);
    if (clauses.length === 0) return { minutes: 0, matches: [] };
    const [anchors, vecs] = await Promise.all([anchorVectors(encode), encode(clauses)]);
    const matches: ActivityMatch[] = [];
    clauses.forEach((clause, i) => {
        const scores = anchors.map(av => dot(vecs[i], av));
        const best = Math.max(...scores);
        if (!(best >= ACTIVITY_MATCH_THRESHOLD)) return;
        // A clause can hold two activities ("sit and read while sipping my
        // coffee"); among anchors scoring within the margin of the best, the
        // longest wins, so the reading is not lost to the sipping.
        let pick = -1;
        scores.forEach((s, j) => {
            if (s >= ACTIVITY_MATCH_THRESHOLD && s >= best - ACTIVITY_TIE_MARGIN
                && (pick < 0 || ACTIVITY_ANCHORS[j].minutes > ACTIVITY_ANCHORS[pick].minutes)) pick = j;
        });
        const a = ACTIVITY_ANCHORS[pick];
        matches.push({ clause, label: a.label, minutes: a.minutes, score: Math.round(scores[pick] * 1000) / 1000 });
    });
    const minutes = Math.min(matches.reduce((s, m) => s + m.minutes, 0), ACTIVITY_SIMILARITY_CAP_MINUTES);
    return { minutes, matches };
};

/** Test hook: forget cached anchor vectors. */
export const _resetActivityAnchorCache = () => { anchorCache = null; };
