// ============================================================================
// NPC_RHETORIC.TS — v1.35
//
// Two saves from 2026-08-31 (Bellwether/Maribel, 35 turns; lower district/
// Elspeth, 18 turns) showed five reported symptoms — circular reasoning,
// idea-laundering, fallacy-only argument, metaphor saturation, and an
// innocuous question being read as a bid for something grander — that are
// ONE failure:
//
//   Every NPC turn was built as a RHETORICAL FIGURE ABOUT THE PLAYER rather
//   than as a person answering what was said.
//
// A figure needs a proposition to turn, so the NPC first invents a motive for
// the player. Having invented it, conceding it reads as the player's own idea
// handed back. The figure stands in for an argument, so what surfaces is a
// tautology or a false dilemma rather than a reason. And the figure needs an
// image, so the metaphors pile up.
//
// Measured in save A: five of the last six consecutive NPC turns open "You
// think / you talk as if / you speak as if <something the player never said>",
// and twelve of the last thirteen close on a question at the player, six of
// them consecutive two-horn dilemmas the NPC authored.
//
// ---------------------------------------------------------------------------
// The root cause was the engine teaching itself the tic.
// ---------------------------------------------------------------------------
// `voice_sample` (v1.24) is injected into [ACTIVE ENTITIES] every turn as
// "write their dialogue in THIS register". What the engine had captured:
//
//   Maribel  "If the tools are what you need, then they are what you shall
//             have."                                    <- a tautology
//   Elspeth  "You don't glide. You disappear."           <- a two-horn
//                                                          assertion ABOUT
//                                                          the player
//
// It sampled a rhetorical FORM, filed it as a VOICE, and then made it a
// standing instruction. That is why the tic is locked, and why it takes a
// different shape per character under identical static instruction: Maribel's
// captured tautology produced tautologies for thirty-five turns, Elspeth's
// captured "not X, but Y" produced "you think X... but that isn't it" and a
// closing dilemma every single turn.
//
// So this module does two jobs with one shared vocabulary of patterns:
//
//   M1  isDegenerateVoiceSample() — refuse to CAPTURE a rhetorical figure as
//       a character's voice, and scrub the ones already captured.
//   M2  detectRhetoricTics() — notice the figure in the model's own previous
//       output and arm the NPC_RHETORIC reminder for the next turn.
//
// Both are deliberately conservative. A false positive on M1 costs one
// character one voice sample (the engine keeps the previous one, or none). A
// false positive on M2 costs one reminder slot on one turn. Neither touches
// generated prose — see the rejected-approaches section of
// VRE_NPC_RHETORIC_DIAGNOSIS.md for why this is not a resampler.
// ============================================================================

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

/**
 * The NPC asserting what the player thinks, wants, or is really after.
 *
 * Every one of these verbs takes the player's interior as its object, which is
 * the move that manufactures the strawman. Deliberately NOT included: "you
 * know", "you said", "you asked", "you did" — those refer to things the player
 * actually put on the table, which is exactly what we want NPCs doing more of.
 */
export const MOTIVE_ATTRIBUTION_RE =
    /\byou(?:'re|\s+are)?\s+(?:think|thought|believe|assume|assuming|reckon|want|wanted|mean|meant|came\s+here|are\s+after|looking\s+for|hunting\s+for|hoping|trying\s+to|talk\s+as\s+if|talking\s+as\s+if|speak\s+as\s+if|speaking\s+as\s+if|sound\s+as\s+if|act\s+as\s+if|say\s+it\s+like|said\s+it\s+like)\b/i;

/** "Don't go looking for more meaning than that." — the pigeonhole, plainly. */
export const MEANING_ASSIGNMENT_RE =
    /\b(?:looking|searching|hunting|reaching)\s+for\s+(?:more|some|a|any)\s+(?:meaning|purpose|grand|greater|deeper)\b|\b(?:grand|greater|deeper)\s+(?:search|searches|design|meaning|purpose)\b/i;

/** Figurative comparisons. Counted, not banned — the density is the tell. */
const FIGURATIVE_RE = /\b(?:like\s+(?:a|an|the)\b|as\s+if\b|as\s+though\b|the\s+way\s+(?:a|an)\b)/gi;

/** Words that mark a sentence as being about a person present, not a maxim. */
const PERSONAL_RE = /\b(?:I|I'm|I've|I'll|me|my|mine|we|we're|us|our|you|you're|you've|your|yours|he|he's|him|his|she|she's|her|hers|they|they're|them|their)\b/i;

const STOPWORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'that', 'this', 'these',
    'those', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do',
    'does', 'did', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'as', 'by',
    'it', 'its', "it's", 'so', 'not', 'no', 'you', 'your', 'i', 'my', 'we',
    'our', 'he', 'she', 'they', 'them', 'his', 'her', 'their', 'what', 'who',
    'when', 'where', 'will', 'shall', 'would', 'should', 'can', 'could', 'have',
    'has', 'had', 'just', 'only', 'very', 'all', 'any', 'more', 'much',
]);

const words = (s: string): string[] =>
    s.toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').split(/\s+/).filter(Boolean);

const contentWords = (s: string): string[] => words(s).filter(w => !STOPWORDS.has(w));

/** Sentence split that tolerates the quote marks the model wraps dialogue in. */
export const splitSentences = (text: string): string[] =>
    text
        .split(/(?<=[.?!])["'’”]?\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

// ---------------------------------------------------------------------------
// Tautology / self-echo
// ---------------------------------------------------------------------------

/**
 * Do the two halves share a word n-gram that carries actual content?
 *
 * The n-gram must contain at least one non-stopword. Without that guard,
 * ordinary parallel construction reads as tautology — "If you've the ink and
 * the patience for it, I've the coin and the room" shares the bigram "and
 * the", and it is a perfectly good line. Parallelism is a virtue; repetition
 * of the SAME CLAIM is the defect.
 */
const sharesNgram = (a: string, b: string, n: number): boolean => {
    const wa = words(a);
    const wb = words(b);
    if (wa.length < n || wb.length < n) return false;
    const meaningful = (gram: string[]) => gram.some(w => !STOPWORDS.has(w));
    const grams = new Set<string>();
    for (let i = 0; i + n <= wa.length; i++) {
        const gram = wa.slice(i, i + n);
        if (meaningful(gram)) grams.add(gram.join(' '));
    }
    for (let i = 0; i + n <= wb.length; i++) {
        const gram = wb.slice(i, i + n);
        if (meaningful(gram) && grams.has(gram.join(' '))) return true;
    }
    return false;
};

/** The trailing n words of a clause, lowercased. */
const tailWords = (s: string, n: number): string[] => {
    const w = words(s);
    return w.length >= n ? w.slice(-n) : [];
};

/**
 * Both clauses end on the same predicate — "…is set, …is set".
 *
 * This is the sharpest tautology signal available structurally, because a
 * clause pair that arrives at an identical ending has not moved. Requires the
 * shared ending to carry a content word so that "…for it, …for it" alone is
 * not enough.
 */
const sharesPredicateEnding = (a: string, b: string): boolean => {
    for (const n of [3, 2]) {
        const ta = tailWords(a, n);
        const tb = tailWords(b, n);
        if (ta.length === n && tb.length === n
            && ta.join(' ') === tb.join(' ')
            && ta.some(w => !STOPWORDS.has(w))) return true;
    }
    return false;
};

/** Longest run of consecutive stopwords shared by both clauses, length >= n. */
const sharesFunctionSkeleton = (a: string, b: string, n: number): boolean => {
    const runs = (s: string): Set<string> => {
        const out = new Set<string>();
        const w = words(s);
        let run: string[] = [];
        for (const word of [...w, ' ']) {
            if (STOPWORDS.has(word)) { run.push(word); continue; }
            for (let i = 0; i + n <= run.length; i++) out.add(run.slice(i, i + n).join(' '));
            run = [];
        }
        return out;
    };
    const ra = runs(a);
    if (ra.size === 0) return false;
    for (const gram of runs(b)) if (ra.has(gram)) return true;
    return false;
};

/**
 * A claim whose second half restates its first.
 *
 *   "If it needs to be remade, then it needs to be remade."
 *   "If the brass is set, the gate is set."
 *      -> both clauses end on the same predicate
 *   "If the tools are what you need, then they are what you shall have."
 *      -> both clauses run through the same function skeleton, "are what you",
 *         with the content swapped for a pronoun. Nothing is added.
 *   "A gate that creaks in the dark is a gate that invites trouble."
 *      -> subject and predicate share the phrase "a gate that"
 *
 * The test is structural rather than semantic: a sentence that traverses its
 * own hinge and arrives back where it started is saying one thing twice with
 * the cadence of an inference. That is the circular reasoning Ryan reported,
 * and "If the tools are what you need, then they are what you shall have" is
 * the line the engine had filed as Maribel's canonical voice.
 *
 * Deliberately NOT caught — parallel construction, which is a virtue:
 *   "If you've the ink and the patience, I've the coin and the room."
 *   "If you're willing to set it, we're willing to give you the time."
 * Both offer a trade. Their halves rhyme; they do not repeat.
 */
export const isSelfEchoingClaim = (sentence: string): boolean => {
    const s = sentence.trim();
    if (words(s).length < 6) return false;

    // Conditional hinge: "if <A>, (then) <B>" / "when <A>, <B>".
    const cond = s.match(/^\W*(?:if|when|once)\s+(.{6,}?)(?:,\s*(?:then\s+)?|\s+then\s+)(.{6,})$/i);
    if (cond) {
        const [, antecedent, consequent] = cond;
        if (sharesPredicateEnding(antecedent, consequent)) return true;
        if (sharesFunctionSkeleton(antecedent, consequent, 3)) return true;
        if (sharesNgram(antecedent, consequent, 3)) return true;
        const ca = new Set(contentWords(antecedent));
        const cc = contentWords(consequent);
        if (cc.length >= 2 && cc.filter(w => ca.has(w)).length / cc.length >= 0.6) return true;
    }

    // Copular hinge: "<A> is <B>" where B echoes A. Restricted to a single
    // copula and a short subject, so a long sentence that merely happens to
    // contain "is" is not split at an arbitrary point and matched against
    // itself.
    if ((s.match(/\b(?:is|are|was|were)\b/gi) ?? []).length === 1 && !s.includes(';')) {
        const cop = s.match(/^\W*(.{6,}?)\s+(?:is|are|was|were)\s+(.{6,})$/i);
        if (cop) {
            const [, subject, predicate] = cop;
            if (words(subject).length <= 8 && sharesNgram(subject, predicate, 3)) return true;
        }
    }

    return false;
};

// ---------------------------------------------------------------------------
// Maxim
// ---------------------------------------------------------------------------

/** "X is just/only/nothing but/another name for Y" — the reducing aphorism. */
const REDUCING_MAXIM_RE =
    /\b(?:is|are|was|were)\s+(?:just|only|merely|simply|nothing\s+but|no\s+more\s+than|another\s+name\s+for|the\s+name|the\s+price\s+of|the\s+only\s+thing)\b/i;

/**
 * A bare abstract subject in a copular equation: "Maintenance is the price
 * of…", "Caution is just another name for…", "Ceremony is for those who…".
 *
 * The predicate must open a noun phrase or a preposition. Restricting it that
 * way is what separates an aphorism from an ordinary observation: "Maintenance
 * is the price of water" equates two abstractions, while "Elspeth is tired"
 * and "the gate is stuck" simply report something.
 */
const BARE_SUBJECT_MAXIM_RE =
    /^\W*[A-Z][a-z]{3,}\s+(?:is|are|isn't|aren't)\s+(?:a|an|the|just|only|merely|simply|nothing|no|not|for|what|where|how|another|its\s+own)\b/;

/**
 * A generalised claim delivered as wisdom, with nobody in it.
 *
 *   "Maintenance is the price of water."
 *   "Caution is just another name for respect."
 *   "Grace is just the name the courtiers give to someone who…"
 *   "Ceremony is for those with walls to hide behind."
 *
 * Requires the sentence to contain no first- or second-person reference and no
 * mid-sentence proper noun, so an NPC talking about a person, a place or the
 * player is never caught. `names` additionally protects a sentence whose
 * SUBJECT is a character in play — without it, "Elspeth is the only one who…"
 * reads as an aphorism to a regex.
 *
 * This is what makes every Maribel line land as a proverb instead of an answer.
 */
export const isMaxim = (sentence: string, names: string[] = []): boolean => {
    const s = sentence.trim().replace(/^["'‘“]+/, '');
    if (words(s).length < 5 || s.length > 170) return false;
    if (s.endsWith('?')) return false;
    if (PERSONAL_RE.test(s)) return false;
    // A capitalised word after the first is a name or a place — not a maxim.
    if (/\s[A-Z][a-z]{2,}/.test(s.replace(/^\W*\w+/, ''))) return false;
    // A named character as the subject is a statement about a person.
    const firstWord = s.match(/^\W*([A-Za-z][\w'-]*)/)?.[1]?.toLowerCase();
    if (firstWord && names.some(n => n.toLowerCase().split(/\s+/).includes(firstWord))) return false;

    if (REDUCING_MAXIM_RE.test(s)) return true;
    if (BARE_SUBJECT_MAXIM_RE.test(s) && !/^\W*(?:The|A|An|This|That|These|Those|It|There|But|And)\b/.test(s)) return true;
    if (/^\W*(?:A|An)\s+\w+.{0,60}\s+is\s+(?:only|just|always|never)\s/i.test(s)) return true;
    return false;
};

// ---------------------------------------------------------------------------
// Two-horn question
// ---------------------------------------------------------------------------

/**
 * "Is that a challenge, or have you just forgotten how to play the game?"
 *
 * Both horns are authored by the NPC, so the player cannot answer without
 * accepting a frame he did not set. Six of these landed consecutively in save
 * A. Note that an ordinary question is fine and wanted — it is the DISJUNCTION
 * that pins the player.
 */
export const isTwoHornQuestion = (sentence: string): boolean => {
    const s = sentence.trim();
    if (!/\?["'’”]?$/.test(s)) return false;
    return /,\s*or\s+\w/i.test(s) || /\?\s*Or\s+\w/i.test(s) || /\bor\s+(?:is\s+it|was\s+it|do\s+you|did\s+you|have\s+you|are\s+you|were\s+you)\b/i.test(s);
};

// ============================================================================
// M1 — voice-sample hygiene
// ============================================================================

export type VoiceSampleRejection =
    | 'tautology'
    | 'about-the-player'
    | 'two-horn-question'
    | 'maxim';

/**
 * True when a candidate `voice_sample` captures a RHETORICAL FIGURE rather
 * than a character's diction and rhythm.
 *
 * A voice sample is meant to anchor how someone SOUNDS — vocabulary, cadence,
 * tics. A line that is shaped as an argument teaches the model to keep making
 * that argument, forever, every turn, because the sample is re-injected as
 * "write their dialogue in THIS register". That is the feedback loop this
 * function exists to break.
 *
 * Returns the reason, or null when the sample is fine.
 */
export const voiceSampleRejection = (
    sample: string | null | undefined,
    names: string[] = [],
): VoiceSampleRejection | null => {
    const raw = (sample ?? '').trim();
    if (!raw) return null;
    // Very short samples are diction, not argument. "Aye, and mind the step."
    if (words(raw).length < 5) return null;

    const sentences = splitSentences(raw);

    if (sentences.some(isSelfEchoingClaim)) return 'tautology';
    if (sentences.some(isTwoHornQuestion)) return 'two-horn-question';

    // About the player: either an explicit motive attribution, or a run of
    // consecutive second-person assertions ("You don't glide. You disappear.").
    if (MOTIVE_ATTRIBUTION_RE.test(raw)) return 'about-the-player';
    const secondPerson = sentences.filter(s => /^\W*you\b/i.test(s));
    if (sentences.length >= 2 && secondPerson.length >= 2) return 'about-the-player';
    if (/\byou(?:'re|\s+are)\s+not\s+.{2,60}?,\s*you(?:'re|\s+are)\b/i.test(raw)) return 'about-the-player';
    if (/\byou\s+don'?t\s+\w+\.\s*you\s+\w+/i.test(raw)) return 'about-the-player';

    if (sentences.some(s => isMaxim(s, names))) return 'maxim';

    return null;
};

export const isDegenerateVoiceSample = (
    sample: string | null | undefined,
    names: string[] = [],
): boolean => voiceSampleRejection(sample, names) !== null;

// ============================================================================
// M2 — tic detection on the previous model turn
// ============================================================================

export type RhetoricTic =
    | 'motive-attribution'
    | 'two-horn-close'
    | 'maxim-close'
    | 'figurative-density'
    | 'meaning-assignment';

export interface RhetoricTicReport {
    tics: RhetoricTic[];
    /** Fire the NPC_RHETORIC reminder next turn. */
    armed: boolean;
    /** Short quotes for the debug log, so the trigger is always inspectable. */
    samples: string[];
}

/** Two or more markers in one turn is a pattern; one is a sentence. */
export const RHETORIC_TIC_THRESHOLD = 2;

/** Metaphors per turn above which the images are doing an argument's job. */
export const FIGURATIVE_DENSITY_LIMIT = 4;

/**
 * Scan a completed model turn for the figure. Runs on the model's OWN previous
 * output — the same shape of self-inspection the v1.30 repetition guard uses,
 * except this one warns on the next prompt instead of resampling, because
 * "you think" and "or?" appear in perfectly good dialogue and a false positive
 * must never cost a regenerate.
 */
export const detectRhetoricTics = (
    narrative: string | null | undefined,
    names: string[] = [],
): RhetoricTicReport => {
    const text = (narrative ?? '').trim();
    if (!text) return { tics: [], armed: false, samples: [] };

    const tics: RhetoricTic[] = [];
    const samples: string[] = [];
    const sentences = splitSentences(text);

    const attribution = text.match(MOTIVE_ATTRIBUTION_RE);
    if (attribution) {
        tics.push('motive-attribution');
        const host = sentences.find(s => MOTIVE_ATTRIBUTION_RE.test(s));
        samples.push((host ?? attribution[0]).slice(0, 120));
    }

    const meaning = text.match(MEANING_ASSIGNMENT_RE);
    if (meaning) {
        tics.push('meaning-assignment');
        samples.push(meaning[0].slice(0, 120));
    }

    // The CLOSE is what pins the player, so look at the tail of the turn.
    const tail = text.slice(-450);
    const tailSentences = splitSentences(tail);
    const twoHorn = tailSentences.find(isTwoHornQuestion);
    if (twoHorn) {
        tics.push('two-horn-close');
        samples.push(twoHorn.slice(0, 140));
    }
    const maximClose = tailSentences.find(s => isMaxim(s, names));
    if (maximClose) {
        tics.push('maxim-close');
        samples.push(maximClose.slice(0, 140));
    }

    const figurative = text.match(FIGURATIVE_RE)?.length ?? 0;
    if (figurative >= FIGURATIVE_DENSITY_LIMIT) {
        tics.push('figurative-density');
        samples.push(`${figurative} figurative comparisons in one turn`);
    }

    return {
        tics,
        armed: tics.length >= RHETORIC_TIC_THRESHOLD,
        samples,
    };
};
