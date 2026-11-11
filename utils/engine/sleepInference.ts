// ────────────────────────────────────────────────────────────────────────────
// v1.54: SLEEP IS THE PLAYER'S CALL, NOT THE MODEL'S.
//
// The 2026-11-11 Westcross save: "I go to sleep and then I wake up." The
// prompt detected the sleep (SLEEP_KEYWORDS → sleep pacing block) and the
// model wrote a whole night ending at first light — but returned no
// biological_inputs.sleep_hours and time_passed_minutes 0. The time step only
// treats a turn as sleep when sleep_hours > 0, so the turn fell through to the
// 1-minute floor: 19:43 → 19:44. Regenerating produced the same thing every
// time, because nothing on the engine side ever looked at what the player
// said. Stamina never restored and lastSleep stayed 0 for the same reason.
//
// The time/montage design already moved authority over duration-bearing
// actions (sleep, study, travel) to the player/engine. This is that, for
// sleep: when the player declares sleep and the narration shows the night
// passing, the engine supplies sleep_hours itself, waking at the hour the
// prose (or the player) names, and marks the turn REST.
// ────────────────────────────────────────────────────────────────────────────

import type { ModelResponseSchema, SceneTimePhase } from '../../types';
import { TIME_CAPS } from '../../config/engineConfig';

/** First-person sleep declaration. "Liora is asleep" does not count. */
const SLEEP_INTENT_RE = /\b(?:i|we)\b([^.!?\n]{0,60}?)\b(?:go(?:es|ing)?\s+to\s+(?:sleep|bed)|went\s+to\s+(?:sleep|bed)|get\s+into\s+bed|fall(?:s|ing)?\s+asleep|fell\s+asleep|sleep|slept|turn\s+in|doze\s+off|drift\s+off|bed\s+down|lie\s+down\s+(?:to\s+sleep|for\s+the\s+night)|lay\s+down\s+(?:to\s+sleep|for\s+the\s+night)|rest\s+(?:through|for)\s+the\s+night|retire\s+for\s+the\s+night|nap|take\s+a\s+nap)\b/gi;

/** Words between "I" and the sleep verb that hand the sleep to someone else:
 *  "I tell her to sleep", "I let Liora sleep", "I watch them doze off". */
const OTHER_SLEEPER_GAP_RE = /\b(?:tell|tells|told|ask|asks|asked|let|lets|help|helps|helped|watch|watches|watched|put|puts|send|sends|sent|wish|wishes|bid|bids|leave|leaves|left|her|him|them|you|she|he|they|it)\b/i;

/** "I can't sleep", "I don't go to bed yet", "I pretend to sleep". */
const SLEEP_NEGATION_RE = /\b(?:can(?:'|’)?t|cannot|couldn(?:'|’)?t|don(?:'|’)?t|do\s+not|won(?:'|’)?t|will\s+not|not\s+(?:yet|going)|pretend(?:s|ing)?\s+to|refuse\s+to|try\s+not\s+to)\b[^.!?\n]{0,20}\b(?:sleep|asleep|bed|turn\s+in|doze)\b/i;

/** The narration has to show the sleep actually happening. */
const NARRATED_SLEEP_RE = /\b(?:slept|asleep|sleeping|woke|wake|waking|awoke|awake(?:ned)?|went\s+under|dozed|drifted\s+off|dreamed|dreamt|the\s+night\s+pass(?:ed|es)|morning\s+came)\b/i;

const NAP_RE = /\b(?:nap|naps|napped|doze\s+for|short\s+rest|an?\s+hour(?:'s)?\s+(?:sleep|rest))\b/i;

/** Wake cues, earliest first. Minute-of-day the sleeper wakes at. */
const WAKE_CUES: Array<{ re: RegExp; minuteOfDay: number; label: string }> = [
    { re: /\b(?:before\s+dawn|pre-?dawn|very\s+early|still\s+dark|dead\s+of\s+night|small\s+hours)\b/i, minuteOfDay: 4 * 60 + 45, label: 'before dawn' },
    { re: /\b(?:first\s+light|gr[ae]y\s+light|dawn|daybreak|sunrise|cock-?crow|before\s+the\s+sun|early\s+(?:light|morning)|birds?\s+(?:were|was|began|started))\b/i, minuteOfDay: 5 * 60 + 45, label: 'first light' },
    { re: /\b(?:late\s+morning|slept\s+(?:in|late)|sleep\s+(?:in|late)|overslept|noon|midday)\b/i, minuteOfDay: 10 * 60, label: 'late morning' },
    { re: /\b(?:morning|sun\s+(?:was|had)\s+up|full\s+daylight)\b/i, minuteOfDay: 7 * 60, label: 'morning' },
];

/** The model's own phase tag is a wake cue too (before the engine corrects it). */
const PHASE_WAKE_MINUTE: Partial<Record<SceneTimePhase, number>> = {
    pre_dawn: 4 * 60 + 45,
    dawn: 6 * 60 + 15,
    morning: 8 * 60,
    midday: 11 * 60 + 30,
};

const DEFAULT_NIGHT_MINUTES = 8 * 60;
const DEFAULT_NAP_MINUTES = 90;
const MIN_SLEEP_MINUTES = 60;

export interface SleepInference {
    minutes: number;
    reason: string;
}

export const isSleepDeclaration = (playerInput: string): boolean => {
    const t = playerInput ?? '';
    if (!t.trim() || /^\s*\[?\s*ooc\b/i.test(t)) return false;
    if (SLEEP_NEGATION_RE.test(t)) return false;
    SLEEP_INTENT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SLEEP_INTENT_RE.exec(t)) !== null) {
        const gap = m[1] ?? '';
        // a capitalised word in the gap is another person ("I tell Liora to …")
        if (OTHER_SLEEPER_GAP_RE.test(gap) || /\b[A-Z][a-z]{2,}/.test(gap)) continue;
        return true;
    }
    return false;
};

/**
 * Minutes of sleep this turn should cover, or null when the engine should not
 * step in (the model already reported sleep, the player didn't declare it, the
 * prose doesn't show it, or the night was cut short by a fight).
 */
export const inferSleep = (
    response: Pick<ModelResponseSchema, 'biological_inputs' | 'narrative' | 'scene_mode' | 'scene_time_phase' | 'time_passed_minutes'>,
    playerInput: string,
    startTotalMinutes: number,
    minutesPerDay = 1440,
): SleepInference | null => {
    if ((response.biological_inputs?.sleep_hours ?? 0) > 0) return null;
    if (!isSleepDeclaration(playerInput)) return null;
    // A night attack is the model's to time (sleep pacing rule 4).
    if (response.scene_mode === 'COMBAT' || response.scene_mode === 'TENSION') return null;
    const narrative = response.narrative ?? '';
    if (!NARRATED_SLEEP_RE.test(narrative)) return null;

    const day = minutesPerDay > 0 ? minutesPerDay : 1440;
    const startOfDay = ((startTotalMinutes % day) + day) % day;
    const nap = NAP_RE.test(playerInput);

    // Player's words first (they own the call), then the prose, then the tag.
    let target: { minute: number; label: string } | null = null;
    for (const src of [playerInput, narrative]) {
        const cue = WAKE_CUES.find(c => c.re.test(src));
        if (cue) { target = { minute: cue.minuteOfDay, label: `${cue.label} (${src === playerInput ? 'player' : 'narration'})` }; break; }
    }
    if (!target && response.scene_time_phase && PHASE_WAKE_MINUTE[response.scene_time_phase] !== undefined) {
        target = { minute: PHASE_WAKE_MINUTE[response.scene_time_phase]!, label: `model phase ${response.scene_time_phase}` };
    }

    let minutes: number;
    let reason: string;
    if (target && !nap) {
        minutes = (target.minute - startOfDay + day) % day;
        reason = `wake at ${target.label}`;
    } else {
        // Respect a model figure that is plausibly a sleep, else the default.
        const asked = response.time_passed_minutes ?? 0;
        const fallback = nap ? DEFAULT_NAP_MINUTES : DEFAULT_NIGHT_MINUTES;
        minutes = asked >= MIN_SLEEP_MINUTES ? asked : fallback;
        reason = asked >= MIN_SLEEP_MINUTES ? `model's +${asked}m` : (nap ? 'nap default' : 'night default');
    }
    minutes = Math.min(Math.max(minutes, MIN_SLEEP_MINUTES), TIME_CAPS.SLEEP_MAX);
    return { minutes, reason };
};

/**
 * Apply the inference to the response in place. Returns a debug line when it
 * changed anything. Idempotent: a second call sees sleep_hours and does nothing.
 */
export const applySleepInference = (
    response: ModelResponseSchema,
    playerInput: string,
    startTotalMinutes: number,
    minutesPerDay = 1440,
): string | null => {
    const inf = inferSleep(response, playerInput, startTotalMinutes, minutesPerDay);
    if (!inf) return null;
    const asked = response.time_passed_minutes ?? 0;
    response.biological_inputs = {
        ...(response.biological_inputs ?? {}),
        sleep_hours: Math.max(1, Math.round(inf.minutes / 60)),
    };
    response.time_passed_minutes = inf.minutes;
    response.time_mode = 'REST';
    return `[SLEEP — v1.54] Player declared sleep; model sent no sleep_hours (asked +${asked}m). Engine set +${inf.minutes}m (${inf.reason}), time_mode REST.`;
};
