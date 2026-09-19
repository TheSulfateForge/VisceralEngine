// ============================================================================
// PLAYER_ACTION_CHECK.TS — v1.45
//
// Did this turn answer the player, or the turn before it?
//
// THE MEASUREMENT (four saves, 2026-09-19, 157 measurable turns)
//
// 50 of 157 turns produced a narrative with essentially no lexical engagement
// with the input that triggered it. Three of them, read end to end:
//
//   - The player proposes marriage ("Princess Anwen Drevast, will you marry
//     me?") and removes his arm from another NPC's grip. Anwen never answers;
//     she "repeats" his line from the PREVIOUS turn, and the other NPC's hand
//     is still on his forearm.
//   - The player invites two NPCs to his townhouse. The model re-renders his
//     dialogue from TWO messages earlier, verbatim, as his current speech. The
//     player re-sent the identical message and got the correct response.
//   - The player makes a direct accusation. The beat goes to an ambient hook
//     the engine had just surfaced — a courier, a kitchen maid's rumour — and
//     the accusation is answered two turns later.
//
// The structural causes are fixed elsewhere in v1.45 (player action moved to
// the tail of the request in geminiClient, thought_process ordering in
// systemInstructions/§13, ledger pre-suppression in sceneContinuity). This
// module is the enforcement layer for the same failure, on the principle that
// has held for every other one of these: a behavioural constraint that lives
// only in the prompt is a suggestion. The engine already re-rolls a turn for
// sanitization drift, mask-mode voice and near-verbatim repetition. Ignoring
// the player outranks all three.
//
// WHY THE DETECTOR LOOKS THE WAY IT DOES
//
// It measures only words the player INTRODUCED this turn — significant words
// in their input minus those already present in their previous input and in
// the previous narrative. Words carried over from the scene prove nothing: a
// turn that merely re-describes the room will echo them. What a turn cannot
// fake is picking up vocabulary the player just brought into play.
//
// Thresholds are deliberately conservative — a false positive costs a
// generation, and the observed split is wide (0.00 on dropped turns against a
// 0.14 mean). At these values the four reviewed saves flag ~8% of turns, and
// every hand-verified drop above is among them.
// ============================================================================

const STOP_WORDS = new Set([
    'a','an','the','and','or','but','in','on','at','to','for','of','with',
    'his','her','their','its','is','are','was','were','has','have','had',
    'that','this','it','he','she','they','we','i','you','be','been','being',
    'not','no','do','does','did','as','so','if','then','than','from','by',
    'my','me','him','them','our','your','what','who','how','why','when',
    'will','would','can','could','should','say','said','says',
]);

/** Below this many genuinely new words the input is unmeasurable — skip it. */
export const MIN_NEW_WORDS = 6;
/** At or below this share of new words echoed, the turn did not engage. */
export const ENGAGEMENT_RATIO_FLOOR = 0.06;
/** ...and no more than this many new words may appear, regardless of ratio. */
export const ENGAGEMENT_MATCH_FLOOR = 1;

const significant = (text: string): Set<string> =>
    new Set(
        (text ?? '')
            .toLowerCase()
            .replace(/[^a-z0-9 ]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    );

export interface PlayerActionFinding {
    /** False only when the turn demonstrably failed to pick the input up. */
    engaged: boolean;
    /** False when the input carried too little new vocabulary to judge. */
    measurable: boolean;
    /** New words the narrative echoed. */
    matched: number;
    /** matched / newWordCount. */
    ratio: number;
    newWordCount: number;
    /** A few unanswered words, for the debug log. */
    sample: string[];
}

const SKIPPED: PlayerActionFinding = {
    engaged: true, measurable: false, matched: 0, ratio: 0, newWordCount: 0, sample: [],
};

/**
 * Compare a narrative against the input that produced it.
 *
 * `previousPlayerInput` and `previousNarrative` are what make the "new words"
 * set meaningful; both are optional and the check simply becomes stricter
 * without them (more words count as new), which is the safe direction on the
 * opening turns of a session.
 */
export const checkPlayerActionEngagement = (
    playerInput: string,
    narrative: string,
    previousPlayerInput?: string,
    previousNarrative?: string,
): PlayerActionFinding => {
    if (!playerInput?.trim() || !narrative?.trim()) return SKIPPED;

    const newWords = significant(playerInput);
    for (const w of significant(previousPlayerInput ?? '')) newWords.delete(w);
    for (const w of significant(previousNarrative ?? '')) newWords.delete(w);

    if (newWords.size < MIN_NEW_WORDS) return SKIPPED;

    const inNarrative = significant(narrative);
    const unanswered: string[] = [];
    let matched = 0;
    for (const w of newWords) {
        if (inNarrative.has(w)) matched++;
        else if (unanswered.length < 6) unanswered.push(w);
    }
    const ratio = matched / newWords.size;

    return {
        engaged: !(ratio <= ENGAGEMENT_RATIO_FLOOR && matched <= ENGAGEMENT_MATCH_FLOOR),
        measurable: true,
        matched,
        ratio,
        newWordCount: newWords.size,
        sample: unanswered,
    };
};

/**
 * The resample trailer.
 *
 * It quotes the input back rather than describing the failure abstractly: the
 * same lever as the v1.30 repetition reminder, for the same reason — the model
 * cannot route around a prompt that contains the actual text it skipped.
 */
export const buildPlayerActionReminder = (playerInput: string): string =>
    `[SYSTEM REFRESH — YOU ANSWERED THE WRONG TURN]
Your narrative did not engage what the player just did. It carried the
previous beat forward instead, which ends the conversation the player is
actually having.

This is what they did, and it is the only new event in this request:

"""
${playerInput.trim()}
"""

Write this turn again. Show the world answering THAT:
- If they spoke, the person addressed replies to what was actually said.
- If they acted physically, the state they changed is changed — now, in the
  first lines, not implied later.
- If they asked, offered, demanded or proposed, the person it was put to
  answers, refuses, or visibly deflects. Continuing past it is not an answer.
Do not restage the previous beat. Do not treat this as already covered because
a state block above describes something similar — those blocks are stale and
this is not.`;
