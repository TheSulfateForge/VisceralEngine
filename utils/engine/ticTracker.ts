// ============================================================================
// TIC_TRACKER.TS — v1.51
//
// Every NPC in the 2026-11-06 saves spoke with the same handful of moves:
// "turned her cup a quarter turn" (11×, across Iskra, Maela and the PC
// himself), "that's the whole of it / the whole evening" (16×, four
// speakers), "I'll be plain", "that's not X. That's Y.", "either X or Y".
// Different letter-writers shared whole sentences ("I have buried a
// husband", "Bring no gifts. Bring your judgment").
//
// The v1.30 shingle guard catches a turn copying an earlier TURN. It does not
// catch a short phrase that recurs a little in every turn — which is exactly
// how a narrator tic forms. This tracker counts recurring word n-grams across
// recent model turns and names them in the next prompt so the model stops
// reaching for them. It is engine-side (no model call), seed-agnostic, and
// self-clearing: a phrase drops off once it stops recurring.
// ============================================================================

export interface OverusedPhrase {
    phrase: string;
    turns: number;      // how many of the scanned turns contain it
}

const STOP = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from',
    'by', 'as', 'is', 'was', 'were', 'be', 'been', 'it', 'its', "it's", 'that', 'this', 'he',
    'she', 'they', 'him', 'her', 'them', 'his', 'hers', 'their', 'i', 'me', 'my', 'you', 'your',
    'we', 'our', 'us', 'had', 'has', 'have', 'did', 'do', 'not', 'no', 'so', 'if', 'then', 'there',
    'what', 'which', 'who', 'when', 'where', 'into', 'out', 'up', 'down', 'over', 'off', 'than',
    'would', 'will', 'could', 'can', 'just', 'one', 'all', 'about', 'said', 'says', 'say',
    "i'm", "i'll", "you're", "don't", "didn't", "she'd", "he'd", "i'd", 'are', 'am', 'too',
]);

/** Known tic shapes from reviewed saves. Counted per turn like n-grams, and
 *  reported with a readable label. A shape must still RECUR to be reported. */
const SEED_TICS: Array<{ label: string; re: RegExp }> = [
    { label: 'turning a cup/notebook "a quarter turn"', re: /quarter[- ]turn/i },
    { label: '"that\'s the whole of it / the whole evening / the whole point"', re: /\b(?:that'?s|that is) the whole\b|\bthe whole of (?:it|what)\b/i },
    { label: 'announcing plainness ("I\'ll be plain", "I\'ll say it plainly", "plain with you")', re: /\b(?:i'?ll|i will|let me)\s+(?:be|say|tell|answer)[^.!?"”]{0,25}\b(?:plain|plainly|direct|straight)\b|\bplain with (?:me|you)\b|\banswer plain\b/i },
    { label: '"That\'s not X. That\'s Y." reframes', re: /\bthat'?s not [^.!?"”]{3,80}[.!?]\s*that'?s\b/i },
    { label: '"either X or Y — usually both"', re: /\beither [^.!?"”]{3,60}\bor\b[^.!?"”]{0,60}\b(?:both|usually)\b/i },
    { label: 'letting a silence "sit"', re: /\blet (?:the silence|that|it|the question|the moment|a beat) (?:sit|hold|land)\b/i },
    { label: '"without heat"', re: /\bwithout heat\b/i },
    { label: '"which from her/him was a great deal"', re: /which from (?:her|him) was a great deal/i },
    { label: '"on the record"', re: /\bon the record\b/i },
    { label: '"my counsel"', re: /\bmy counsel\b/i },
];

const tokenize = (text: string): string[] =>
    text
        .toLowerCase()
        .replace(/[’‘]/g, "'")
        .replace(/[^a-z0-9'\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);

const significant = (gram: string[]): number => gram.filter(w => !STOP.has(w) && w.length > 2).length;

/**
 * Find phrases that recur across recent turns.
 *
 * @param recentNarratives  model narratives, oldest → newest (8–12 is right)
 * @param excludeNames      entity/player names — names repeat legitimately
 */
export const findOverusedPhrases = (
    recentNarratives: string[],
    excludeNames: string[] = [],
    maxResults = 8,
): OverusedPhrase[] => {
    const turns = recentNarratives.filter(t => (t ?? '').trim().length > 0);
    if (turns.length < 3) return [];

    const nameTokens = new Set(
        excludeNames
            .flatMap(n => tokenize(n.replace(/\([^)]*\)/g, '')))
            .filter(t => t.length >= 3)
    );

    // Dialogue: recurring 4–7 word phrases inside quotes (speech habits).
    // Narration: recurring GESTURE phrases only — those that start with an
    // actor pronoun ("she turned her cup…", "he did not answer…"). Plot
    // nouns that legitimately recur ("the face-down stack", "no house
    // colors") are not mined from narration.
    const ACTOR = new Set(['she', 'he', 'i', 'they', 'her', 'his']);
    const seen = new Map<string, Set<number>>();
    const add = (key: string, ti: number) => {
        let set = seen.get(key);
        if (!set) { set = new Set(); seen.set(key, set); }
        set.add(ti);
    };
    turns.forEach((text, ti) => {
        const quotes: string[] = [];
        const narration = text.replace(/["“]([^"“”]{1,4000})["”]/g, (_m, q: string) => { quotes.push(q); return ' | '; });
        for (const q of quotes) {
            const toks = tokenize(q);
            for (let n = 4; n <= 7; n++) {
                for (let i = 0; i + n <= toks.length; i++) {
                    const gram = toks.slice(i, i + n);
                    if (significant(gram) < 2) continue;
                    if (gram.some(w => nameTokens.has(w))) continue;
                    add(gram.join(' '), ti);
                }
            }
        }
        for (const sentence of narration.split(/[.!?;|\n]+/)) {
            const toks = tokenize(sentence);
            for (let i = 0; i < toks.length; i++) {
                if (!ACTOR.has(toks[i])) continue;
                for (let n = 4; n <= 7 && i + n <= toks.length; n++) {
                    const gram = toks.slice(i, i + n);
                    if (significant(gram) < 2) continue;
                    if (gram.some(w => nameTokens.has(w))) continue;
                    add(gram.join(' '), ti);
                }
            }
        }
    });

    const candidates: OverusedPhrase[] = [];
    for (const [phrase, set] of seen) {
        const len = phrase.split(' ').length;
        const needed = len >= 5 ? 2 : 3;
        if (set.size >= needed) candidates.push({ phrase, turns: set.size });
    }

    // Keep the longest form of overlapping phrases: drop a phrase contained in
    // a longer kept phrase that recurs at least as often.
    candidates.sort((a, b) => b.phrase.length - a.phrase.length);
    const kept: OverusedPhrase[] = [];
    const overlaps = (a: string, b: string): boolean => {
        // Sliding fragments of one phrase ("into a private hall with" /
        // "a private hall with six") share all but one word.
        const aw = a.split(' '), bw = b.split(' ');
        const shared = aw.filter(w => bw.includes(w)).length;
        const m = Math.min(aw.length, bw.length);
        return shared >= (m >= 5 ? m - 2 : m - 1);
    };
    for (const c of candidates) {
        if (SEED_TICS.some(t => t.re.test(c.phrase))) continue;   // reported by label below
        if (kept.some(k => (k.phrase.includes(c.phrase) || overlaps(k.phrase, c.phrase)) && k.turns >= c.turns)) continue;
        kept.push(c);
    }

    // Seed tics, counted per turn.
    for (const tic of SEED_TICS) {
        const n = turns.filter(t => tic.re.test(t)).length;
        if (n >= 2) kept.push({ phrase: tic.label, turns: n });
    }

    kept.sort((a, b) => b.turns - a.turns || b.phrase.length - a.phrase.length);
    return kept.slice(0, maxResults);
};

export const buildOverusedPhrasesBlock = (phrases: OverusedPhrase[], scanned: number): string => {
    if (phrases.length === 0) return '';
    const lines = phrases.map(p => `- ${p.phrase}  (${p.turns} of last ${scanned} turns)`);
    return `[OVERUSED PHRASES — v1.51]
These words and gestures keep recurring across recent turns, in different
characters' mouths and hands. They have become the narrator's habits, not
anyone's voice. Do not use them or close paraphrases this turn — give each
character their own words, from their own record.
${lines.join('\n')}`;
};
