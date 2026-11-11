import { WorldTime, CalendarConfig, SceneTimePhase, SceneMode, TimeMode, ModelResponseSchema } from '../../types';
import { TIME_CAPS, TIME_MODE_CAPS, MAX_REGISTRY_LINES, TIME_FLOOR_MINUTES, DEFAULT_CALENDAR } from '../../config/engineConfig';

/**
 * v1.21: Legacy mapping from scene_mode → a default time_mode, used when the AI
 * doesn't declare time_mode (older responses, loaded saves). scene_mode is about
 * tone/danger; this picks the time-velocity bucket that best matches it.
 */
export const deriveTimeModeFromScene = (sceneMode: SceneMode | undefined): TimeMode => {
    switch (sceneMode) {
        case 'COMBAT':  return 'TICK';   // seconds–minutes, AI-owned clock
        case 'SOCIAL':  return 'SCENE';
        case 'TENSION': return 'SCENE';
        case 'NARRATIVE':
        default:        return 'SCENE';
    }
};

/**
 * v1.21: Resolve the effective time_mode for a turn. Prefer the AI's explicit
 * declaration; fall back to the scene_mode-derived default.
 */
export const resolveTimeMode = (response: Pick<ModelResponseSchema, 'time_mode' | 'scene_mode'>): TimeMode => {
    return response.time_mode ?? deriveTimeModeFromScene(response.scene_mode);
};

/**
 * v1.20: Derive the narrative time phase from the clock hour (0–23).
 * Nine phases spanning the day; boundaries chosen so each phase maps to a
 * distinct ambient feel. Defensive modulo handles out-of-range hours.
 */
export const deriveTimePhase = (hour: number): SceneTimePhase => {
    const h = ((Math.floor(hour) % 24) + 24) % 24;
    if (h < 4) return 'deep_night';   // 00:00–03:59
    if (h < 6) return 'pre_dawn';     // 04:00–05:59
    if (h < 8) return 'dawn';         // 06:00–07:59
    if (h < 11) return 'morning';     // 08:00–10:59
    if (h < 14) return 'midday';      // 11:00–13:59
    if (h < 17) return 'afternoon';   // 14:00–16:59
    if (h < 19) return 'dusk';        // 17:00–18:59
    if (h < 22) return 'evening';     // 19:00–21:59
    return 'night';                   // 22:00–23:59
};

/**
 * Review item 4: authoritative time phase AFTER a beat advances the clock.
 * Deterministic — start hour/minute plus elapsed minutes, wrapped to 0–23,
 * mapped through deriveTimePhase. Used to overwrite a model-declared
 * scene_time_phase instead of paying for a regeneration.
 */
export const phaseAfterElapsed = (
    startHour: number,
    startMinute: number,
    elapsedMinutes: number,
): SceneTimePhase => {
    const totalMin = startHour * 60 + startMinute + (elapsedMinutes || 0);
    const endHour = ((Math.floor(totalMin / 60) % 24) + 24) % 24;
    return deriveTimePhase(endHour);
};

/**
 * v1.20: One-line ambient cue (light level + typical sounds) for a phase,
 * injected into the system prompt to anchor the AI's sensory rendering.
 */
const AMBIENT_CUES: Record<SceneTimePhase, string> = {
    deep_night: 'Pitch dark; the world silent but for wind and far-off nocturnal calls. Lamps or none.',
    pre_dawn:   'Lightless but stirring; air at its coldest, the first birds testing the dark.',
    dawn:       'First light spilling low and gold across surfaces; dew, waking birdsong, long thin shadows.',
    morning:    'Bright and climbing; clear shadows, full daily activity, cool warming air.',
    midday:     'Harsh overhead sun; shortest shadows, peak warmth and bustle, glare.',
    afternoon:  'Warm slanting light; lengthening shadows, a languid, heavy pace.',
    dusk:       'Failing amber light; long shadows, cooling air, sounds settling toward quiet.',
    evening:    'Dark with lamp- or firelight; quieter streets, indoor warmth, muffled life.',
    night:      'Full dark; sparse movement, muffled sounds, cold air, pools of artificial light.',
};

export const getAmbientCue = (phase: SceneTimePhase): string => AMBIENT_CUES[phase];

/**
 * Derive a full WorldTime (clock + calendar fields) from an absolute
 * `totalMinutes` value. `totalMinutes` is the canonical substrate; year /
 * month / dayOfMonth / dayOfYear / season are derived via the supplied
 * CalendarConfig (DEFAULT_CALENDAR unless a world overrides it). Negative
 * totals are handled defensively so clamped/edge cases never produce NaN.
 */
export const deriveWorldTime = (
    totalMinutes: number,
    calendar: CalendarConfig = DEFAULT_CALENDAR
): WorldTime => {
    const minutesPerDay = calendar.minutesPerDay ?? 1440;
    const absoluteDayIndex = Math.floor(totalMinutes / minutesPerDay); // 0-based
    const day = absoluteDayIndex + 1;                                  // 1-based absolute
    const minuteOfDay = ((totalMinutes % minutesPerDay) + minutesPerDay) % minutesPerDay;
    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;

    const daysPerYear = calendar.daysPerYear;
    const dayOfYearIndex = ((absoluteDayIndex % daysPerYear) + daysPerYear) % daysPerYear; // 0-based
    const year = Math.floor(absoluteDayIndex / daysPerYear) + 1;
    const month = Math.floor(dayOfYearIndex / calendar.daysPerMonth) + 1;
    const dayOfMonth = (dayOfYearIndex % calendar.daysPerMonth) + 1;
    const dayOfYear = dayOfYearIndex + 1;
    const seasonIdx = Math.floor(dayOfYearIndex / calendar.daysPerSeason) % calendar.seasonsPerYear;
    const season = calendar.seasonNames[seasonIdx] ?? calendar.seasonNames[0] ?? 'spring';

    const clock = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    const monthLabel = calendar.monthNames?.[month - 1];
    const display = monthLabel
        ? `Year ${year}, ${monthLabel} ${dayOfMonth}, ${clock}`
        : `Year ${year}, Month ${month}, Day ${dayOfMonth}, ${clock}`;

    return { totalMinutes, day, hour, minute, year, month, dayOfMonth, dayOfYear, season, display };
};

export const updateTime = (
    currentMinutes: number,
    delta: number,
    calendar: CalendarConfig = DEFAULT_CALENDAR
): WorldTime => deriveWorldTime(currentMinutes + delta, calendar);

// ---------------------------------------------------------------------------
// v1.37: registry stall collapse
// ---------------------------------------------------------------------------
// The hidden registry is injected WHOLE into every prompt as a record of what
// NPCs have been doing. In the 2026-09-07 Carissa save it was 8.8KB of this:
//
//   T19 | Duchess Sania Blackmoor | Reinforces the sense of sanctuary and
//         belonging to encourage Carissa's continued compliance.
//   T20 | Duke Corrith Blackmoor  | Redirects the conversation to discourage
//         the guest's departure...
//   T21 | Duchess Sania Blackmoor | Reinforces Carissa's physical containment...
//
// Twenty turns of maintain / observe / reinforce / assess, handed back to the
// model every turn as a description of who these characters are. It is the same
// feedback loop v1.35 found in `voice_sample`: the engine recorded a stall and
// then taught it.
//
// So a run of same-actor, same-verb entries collapses to the first and a count.
// The information ("Sania has been maintaining contact since T17") survives;
// the twenty worked examples of writing another holding beat do not.

/** Consecutive same-actor, same-verb entries before a run is collapsed. */
const REGISTRY_RUN_LIMIT = 2;

/** `T21 | NPC: Name | Verb rest of line` → the parts worth comparing. */
const REGISTRY_LINE_RE = /^\s*T(\d+)\s*\|\s*(?:NPC:\s*)?([^|]+?)\s*\|\s*(\S+)/i;

/**
 * Collapse runs of a single actor repeating a single leading verb.
 *
 * Lines that do not parse as registry entries pass through untouched, and a run
 * is only collapsed when the SAME actor uses the SAME verb on consecutive
 * entries — an actor alternating verbs, or two actors interleaving, is a scene
 * doing something and is left alone.
 */
export const collapseRegistryStalls = (registry: string): string => {
    if (!registry) return '';
    const lines = registry.split('\n');
    const out: string[] = [];

    let runActor: string | null = null;
    let runActorLabel = '';
    let runVerb: string | null = null;
    let runVerbLabel = '';
    let runCount = 0;
    let collapsedFrom = '';
    let collapsedTo = '';
    let placeholderAt = -1;

    const flush = () => {
        if (placeholderAt >= 0 && runCount > REGISTRY_RUN_LIMIT) {
            const dropped = runCount - REGISTRY_RUN_LIMIT;
            out[placeholderAt] =
                `T${collapsedFrom}-T${collapsedTo} | NPC: ${runActorLabel} | ` +
                `[${dropped} further turn(s) of "${runVerbLabel}…" collapsed — this actor has now ` +
                `repeated the same action for ${runCount} consecutive turns and it is no longer new]`;
        }
        runActor = null; runVerb = null; runCount = 0; placeholderAt = -1;
    };

    for (const line of lines) {
        const m = line.match(REGISTRY_LINE_RE);
        if (!m) { flush(); out.push(line); continue; }

        const [, turn, actor, verb] = m;
        const actorKey = actor.trim().toLowerCase();
        const verbKey = verb.trim().toLowerCase().replace(/[^a-z]/g, '');

        if (actorKey === runActor && verbKey === runVerb) {
            runCount++;
            if (runCount <= REGISTRY_RUN_LIMIT) {
                out.push(line);
            } else if (placeholderAt < 0) {
                out.push('');
                placeholderAt = out.length - 1;
                collapsedFrom = turn;
                collapsedTo = turn;
            } else {
                // Beyond the placeholder the line is dropped; only its turn
                // number survives, as the end of the collapsed range.
                collapsedTo = turn;
            }
            continue;
        }

        flush();
        runActor = actorKey;
        runActorLabel = actor.trim();
        runVerb = verbKey;
        runVerbLabel = verb.trim();
        runCount = 1;
        out.push(line);
    }
    flush();

    return out.join('\n');
};

export const trimHiddenRegistry = (registry: string): string => {
    if (!registry) return "";
    // v1.37: collapse stalls BEFORE the line cap, so a stalled scene does not
    // consume the whole window with restatements of one beat and push the
    // genuinely distinct entries out of it.
    const collapsed = collapseRegistryStalls(registry);
    const lines = collapsed.split('\n').filter(l => l.trim());
    if (lines.length <= MAX_REGISTRY_LINES) return lines.join('\n');
    return lines.slice(-MAX_REGISTRY_LINES).join('\n');
};

/**
 * v1.19.1: Scene-mode-aware time clamping.
 *
 * Priority order:
 *   1. Sleep → SLEEP_MAX (540)
 *   2. Combat → COMBAT_MAX (30)
 *   3. Social → SOCIAL_MAX (15)
 *   4. Default → AWAKE_MAX (120)
 *
 * Also applies TIME_FLOOR_MINUTES (1) so non-sleep turns always advance
 * at least 1 minute — prevents time-frozen loops.
 */
// ────────────────────────────────────────────────────────────────────────────
// v1.51: TIME FLOOR FROM WHAT ACTUALLY HAPPENED.
//
// The model under-reports time_passed_minutes. In the 2026-11-06 saves the
// clock moved 48 minutes across 21 turns that covered a tailor's fitting, a
// walk home "taking the long route" past the river and the market (+1m), and a
// full gift-planning session; reading a three-page letter aloud was +1m. No
// clamp fired — the model asked for 1–4 minutes. The schema told it to "pick
// the lowest" and default to 2.
//
// Two mechanical floors the narrative can't argue with:
//   • Speech: words spoken aloud (quoted dialogue + italic text read out)
//     take time at ~150 words per minute.
//   • Travel: when the player actually changed location, the trip takes at
//     least the model's own travel_time_minutes, and at least a district walk
//     when the player's input describes going somewhere on foot/horse/coach.
// The floor only RAISES the model's number; caps still apply afterwards.
// ────────────────────────────────────────────────────────────────────────────

export const SPOKEN_WORDS_PER_MINUTE = 150;
/**
 * v1.53: each line of dialogue also costs a pause — the beat before a reply,
 * a look, a sip. 150 wpm alone timed a 16-turn garden party (2,795 spoken
 * words) at under 19 minutes. 15 s per line puts the same party near an hour.
 */
export const UTTERANCE_PAUSE_MINUTES = 0.25;
export const TRAVEL_FLOOR_MINUTES = 15;
export const LONG_ROUTE_FLOOR_MINUTES = 30;

const QUOTED_RE = /["“]([^"“”]{1,4000})["”]/g;
const ITALIC_RE = /(?:^|[^*])\*([^*\n]{3,4000})\*(?!\*)/g;

const countWords = (s: string): number => (s.match(/[A-Za-z0-9'’-]+/g) ?? []).length;

/** v1.53: number of separate spoken lines (quoted spans) in this narrative. */
export const countUtterances = (narrative: string): number => {
    QUOTED_RE.lastIndex = 0;
    return ((narrative ?? '').match(QUOTED_RE) ?? []).length;
};

/** Words spoken aloud or read out in this narrative. */
export const countSpokenWords = (narrative: string): number => {
    let n = 0;
    let m: RegExpExecArray | null;
    QUOTED_RE.lastIndex = 0;
    while ((m = QUOTED_RE.exec(narrative)) !== null) n += countWords(m[1]);
    ITALIC_RE.lastIndex = 0;
    while ((m = ITALIC_RE.exec(narrative)) !== null) n += countWords(m[1]);
    return n;
};

const TRAVEL_INPUT_RE = /\b(?:walk|walks|walked|walking|ride|rides|riding|rode|drive|drives|travel|travels|travelling|traveling|head(?:s|ed|ing)?\s+(?:back|home|out|over|off|down|up|to|toward|towards|for)|go(?:es|ing)?\s+(?:back|home|out|over|to|toward|towards)|leave(?:s)?\s+for|set(?:s|ting)?\s+off|carriage|coach|cart)\b/i;
const LONG_ROUTE_RE = /\b(?:long\s+(?:route|way)|taking\s+my\s+time|take\s+my\s+time|the\s+scenic|wander(?:s|ing)?|stroll(?:s|ing)?)\b/i;

export interface TimeFloor {
    floor: number;
    reasons: string[];
}

export const estimateTimeFloor = (
    narrative: string,
    playerInput: string,
    locationUpdate: { location_name?: string; traveled_from?: string; travel_time_minutes?: number } | undefined,
    previousLocation: string,
): TimeFloor => {
    const reasons: string[] = [];
    let floor = 0;

    const spoken = countSpokenWords(narrative ?? '');
    const lines = countUtterances(narrative ?? '');
    const speechMin = Math.floor(spoken / SPOKEN_WORDS_PER_MINUTE + lines * UTTERANCE_PAUSE_MINUTES);
    if (speechMin > 0) {
        floor = speechMin;
        reasons.push(`${spoken} words in ${lines} spoken line(s) ≈ ${speechMin}m`);
    }

    // v1.52: what the player said they're doing takes time too.
    const act = estimateActivityMinutes(playerInput ?? '');
    if (act.minutes > floor) {
        floor = act.minutes;
        reasons.push(`activities (${act.labels.join(', ')}) ≥ ${act.minutes}m`);
    }

    // v1.54: room to room inside one building is not a trip.
    const rootOf = (l: string) => (l ?? '').split(/\s+[—–]\s+/)[0].trim().replace(/^the\s+/i, '').toLowerCase();
    const moved = !!locationUpdate?.location_name
        && locationUpdate.location_name.trim() !== ''
        && locationUpdate.location_name !== previousLocation
        && !(/\s[—–]\s/.test(locationUpdate.location_name) && rootOf(locationUpdate.location_name) === rootOf(previousLocation ?? ''));
    if (moved) {
        const declared = Math.max(0, locationUpdate?.travel_time_minutes ?? 0);
        let travel = declared;
        if (TRAVEL_INPUT_RE.test(playerInput ?? '')) {
            const cue = LONG_ROUTE_RE.test(playerInput ?? '') ? LONG_ROUTE_FLOOR_MINUTES : TRAVEL_FLOOR_MINUTES;
            travel = Math.max(travel, cue);
        }
        if (travel > 0) {
            // Talk on the way happens during the trip, not after it.
            const combined = Math.max(travel, speechMin, act.minutes);
            if (combined > floor) {
                floor = combined;
                reasons.push(`travel ${previousLocation || '?'} → ${locationUpdate!.location_name} ≥ ${travel}m`);
            }
        }
    }

    return { floor, reasons };
};

// ────────────────────────────────────────────────────────────────────────────
// v1.52: TIME FROM ACTIVITIES, FROM THE NARRATION'S OWN CLOCK, AND FROM THE
// PLAYER'S STATED TIME.
//
// The 2026-11-07 Westcross save (deepseek-v4.1-flash, temp 0.70): breakfast in
// the garden asked +1m while the narration had the corner bell strike seven at
// 06:05; a bath, hair and shave asked +1m while the narration read "a quarter
// to seven" off the hall clock at 06:07. The v1.51 floor counts only speech and
// travel, so neither turn tripped it — and the player's own "[IT is 6:06AM]"
// was ignored.
//
// Three more floors, all mechanical:
//   • Activities: things the player says they do take a known minimum time.
//   • Narrated clock: when the narration has a bell strike an hour or a clock
//     show a time, the world clock moves to that time (forward only, ≤6h).
//     The prose is what the player read; the clock follows it. If the prose
//     puts the time EARLIER than the clock, it's recorded and the next prompt
//     is told the clock was right.
//   • Player time note: "[It is 6:06 AM]" in the player's input sets the clock
//     before the turn is built (see parsePlayerTimeNote, used by the client).
// ────────────────────────────────────────────────────────────────────────────

interface ActivityRule { re: RegExp; minutes: number; label: string; }

/** Minimum minutes for ordinary activities named in the player's input. */
export const ACTIVITY_RULES: ActivityRule[] = [
    { re: /\b(?:bath(?:e|es|ed|ing)?|soak(?:s|ed|ing)?\s+in\s+the\s+tub)\b/i, minutes: 20, label: 'bath' },
    { re: /\b(?:shower(?:s|ed|ing)?)\b/i, minutes: 10, label: 'shower' },
    { re: /\bshav(?:e|es|ed|ing)\b/i, minutes: 5, label: 'shave' },
    { re: /\b(?:groom(?:s|ed|ing)?|do(?:es)?\s+my\s+hair|brush(?:es|ed|ing)?\s+my\s+hair)\b/i, minutes: 10, label: 'grooming' },
    { re: /\b(?:get(?:s|ting)?\s+dressed|dress(?:es|ed)?\s+(?:myself|for)|put(?:s|ting)?\s+on\s+(?:my|the)\s+(?:clothes|armou?r|coat|boots|uniform))\b/i, minutes: 5, label: 'dressing' },
    { re: /\b(?:breakfast|lunch|luncheon|dinner|supper|(?:eat|eats|ate|eating)\s+(?:a|my|the|some)\s+(?:meal|food|breakfast|lunch|dinner|supper))\b/i, minutes: 20, label: 'meal' },
    { re: /\b(?:wash(?:es|ed|ing)?\s+(?:up|myself|my\s+face|my\s+hands))\b/i, minutes: 5, label: 'washing' },
    // v1.55: the 2026-11-11 Westcross dawn sequence — dressing "in" clothes,
    // making coffee, walking the garden, sitting down to read — matched none
    // of the rules above, so the floor never caught the model's +0m.
    { re: /\b(?:(?:rise|rises|rose|get\s+up|gets\s+up)\s+and\s+dress|dress(?:es|ed|ing)?\s+in\b)/i, minutes: 5, label: 'dressing' },
    { re: /\b(?:(?:start|starts|started|make|makes|made|brew|brews|brewed|put\s+on|puts\s+on)\s+(?:a\s+|the\s+|some\s+)?(?:pot|kettle|cup|mug|batch)?\s*(?:of\s+)?(?:coffee|tea)|cook(?:s|ed|ing)?\s+(?:a|my|the|some)\b)/i, minutes: 10, label: 'brewing/cooking' },
    { re: /\b(?:sip(?:s|ped|ping)?|drink(?:s|ing)?|drank)\b[^.]{0,30}\b(?:coffee|tea|cup|mug)\b|\b(?:pour(?:s|ed|ing)?)\s+(?:myself\s+)?(?:another|a\s+second|a)\s+(?:cup|mug)\b/i, minutes: 5, label: 'drink' },
    { re: /\b(?:walk(?:s|ed|ing)?\s+(?:it|around|about|the\s+(?:garden|grounds|perimeter|yard|courtyard|halls?))|stroll(?:s|ed|ing)?|pac(?:e|es|ed|ing)\s+(?:the|around))\b/i, minutes: 15, label: 'walk' },
    { re: /\b(?:sit(?:s|ting)?\s+(?:and|to)\s+read|settle(?:s|d)?\s+in\s+(?:to|with)\s+(?:a|the)\s+book|read(?:s|ing)?\s+(?:a|my|the)\s+(?:book|ledgers?|reports?|letters))\b/i, minutes: 30, label: 'reading' },
    // v1.53: practice sessions ("take up my bow and quiver… head down to the back to shoot").
    { re: /\b(?:practi[cs](?:e|es|ed|ing)|train(?:s|ed|ing)?|drill(?:s|ed|ing)?|spar(?:s|red|ring)?|shoot(?:s|ing)?\s+(?:at\s+)?(?:targets?|butts|arrows)|(?:take|takes|took|taking)\s+up\s+my\s+(?:bow|sword|blade|spear|staff))\b/i, minutes: 30, label: 'practice' },
];

/** Cap on the activity floor so a long list of chores can't eat a day. */
export const ACTIVITY_FLOOR_CAP_MINUTES = 90;

export const estimateActivityMinutes = (playerInput: string): { minutes: number; labels: string[] } => {
    const text = (playerInput ?? '').replace(/["“][^"”]*["”]/g, ' ');   // what they DO, not what they say
    const labels: string[] = [];
    let minutes = 0;
    for (const r of ACTIVITY_RULES) {
        if (r.re.test(text)) { minutes += r.minutes; labels.push(r.label); }
    }
    return { minutes: Math.min(minutes, ACTIVITY_FLOOR_CAP_MINUTES), labels };
};

const HOUR_WORDS: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
    noon: 12, midnight: 12,
};
const MINUTE_WORDS: Record<string, number> = {
    five: 5, ten: 10, twenty: 20, 'twenty-five': 25, 'twenty five': 25,
};
const HOUR_TOKEN = String.raw`(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|noon|midnight)`;
const TIME_EXPR = String.raw`(?:(?:a\s+)?quarter\s+(?:to|past|after)\s+${HOUR_TOKEN}|half\s+past\s+${HOUR_TOKEN}|(?:\d{1,2}|five|ten|twenty|twenty[- ]five)\s+(?:minutes\s+)?(?:to|past|after)\s+${HOUR_TOKEN}|\d{1,2}:\d{2}|${HOUR_TOKEN}(?:\s+o'?clock)?)`;

const toHour = (tok: string): number | null => {
    const t = tok.toLowerCase();
    if (/^\d+$/.test(t)) { const n = parseInt(t, 10); return n >= 0 && n <= 24 ? n : null; }
    return HOUR_WORDS[t] ?? null;
};

/** Parse one time expression into minutes past midnight on a 12-hour face (0..719), or 24h when given as hh:mm ≥ 13. */
export const parseTimeExpression = (expr: string): number | null => {
    const e = expr.toLowerCase().trim();
    let m: RegExpMatchArray | null;
    if ((m = e.match(/^(\d{1,2}):(\d{2})$/))) {
        const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
        return h < 24 && mi < 60 ? h * 60 + mi : null;
    }
    if ((m = e.match(new RegExp(String.raw`^(?:a\s+)?quarter\s+(to|past|after)\s+(${HOUR_TOKEN})$`)))) {
        const h = toHour(m[2]); if (h === null) return null;
        return m[1] === 'to' ? ((h * 60 - 15) + 720) % 720 : (h % 12) * 60 + 15;
    }
    if ((m = e.match(new RegExp(String.raw`^half\s+past\s+(${HOUR_TOKEN})$`)))) {
        const h = toHour(m[1]); if (h === null) return null;
        return (h % 12) * 60 + 30;
    }
    if ((m = e.match(new RegExp(String.raw`^(\d{1,2}|five|ten|twenty|twenty[- ]five)\s+(?:minutes\s+)?(to|past|after)\s+(${HOUR_TOKEN})$`)))) {
        const mins = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : MINUTE_WORDS[m[1].replace('-', ' ')] ?? MINUTE_WORDS[m[1]];
        const h = toHour(m[3]); if (h === null || mins === undefined || mins >= 60) return null;
        return m[2] === 'to' ? ((h * 60 - mins) + 720) % 720 : (h % 12) * 60 + mins;
    }
    if ((m = e.match(new RegExp(String.raw`^(${HOUR_TOKEN})(?:\s+o'?clock)?$`)))) {
        const h = toHour(m[1]); if (h === null) return null;
        if (h > 12) return h * 60;
        return (h % 12) * 60;
    }
    return null;
};

export interface NarratedClock { minutes: number; text: string; }

// A bell/clock that struck or shows a time, or "it was a quarter to seven".
const STRIKE_RE = new RegExp(String.raw`\b(?:bells?|clocks?|chimes?|carillon|watch-?bell)\b[^.!?\n]{0,60}?\b(?:struck|strikes|striking|chimed|chimes|chiming|rang|rings|ringing|tolled|tolls|tolling|sounded|sounds|counted)\s+(?:out\s+)?(?:the\s+)?(${TIME_EXPR})(?:\s+hour|\s+bell)?\b`, 'gi');
const READ_RE = new RegExp(String.raw`\bclocks?\b[^.!?\n]{0,40}?\b(?:said|says|read|reads|showed|shows|stood\s+at|stands\s+at|pointed\s+to|points\s+to|was\s+at|showing|reading)\s+(?:it\s+was\s+)?(${TIME_EXPR})\b`, 'gi');
const ITWAS_RE = new RegExp(String.raw`\b(?:it\s+was|it's|it\s+is)\s+(?:now\s+)?((?:a\s+)?quarter\s+(?:to|past|after)\s+${HOUR_TOKEN}|half\s+past\s+${HOUR_TOKEN}|${HOUR_TOKEN}\s+o'?clock)\b`, 'gi');
// A clock time inside a subordinate/future clause is not the present time.
const NOT_NOW_RE = /\b(?:when|until|till|before|after|by|once|if|wants?|wanted|expects?|at)\s+(?:the\s+)?(?:\w+\s+){0,3}$/i;

/**
 * Every time the narration states as the CURRENT time, in order of appearance.
 * Dialogue is excluded — characters talk about appointments and plans.
 */
export const extractNarratedClockTimes = (narrative: string): NarratedClock[] => {
    const text = (narrative ?? '').replace(/["“][^"”]*["”]/g, m => ' '.repeat(m.length));
    const hits: { index: number; minutes: number; text: string }[] = [];
    for (const re of [STRIKE_RE, READ_RE, ITWAS_RE]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            const before = text.slice(Math.max(0, m.index - 30), m.index);
            if (NOT_NOW_RE.test(before)) continue;
            const minutes = parseTimeExpression(m[1]);
            if (minutes === null) continue;
            hits.push({ index: m.index, minutes, text: m[0].trim() });
        }
    }
    hits.sort((a, b) => a.index - b.index);
    return hits.map(h => ({ minutes: h.minutes, text: h.text }));
};

/** Narration may move the clock this far forward on its own word, no further. */
export const NARRATED_CLOCK_MAX_ADVANCE = 360;
/** Narration this far behind the clock is a contradiction worth flagging. */
export const NARRATED_CLOCK_BEHIND_TOLERANCE = 10;

/**
 * Place a 12-hour-face reading on the absolute timeline: the occurrence (am/pm,
 * yesterday/today/tomorrow) nearest to `anchorTotal`.
 */
export const resolveClockReading = (minutes: number, anchorTotal: number, minutesPerDay = 1440): number => {
    const dayStart = Math.floor(anchorTotal / minutesPerDay) * minutesPerDay;
    const faces = minutes >= 720 ? [minutes] : [minutes, minutes + 720];
    let best = dayStart + faces[0];
    for (const d of [-1, 0, 1]) {
        for (const f of faces) {
            const cand = dayStart + d * minutesPerDay + f;
            if (Math.abs(cand - anchorTotal) < Math.abs(best - anchorTotal)) best = cand;
        }
    }
    return best;
};

export interface NarratedClockCheck {
    /** Minutes the turn must advance for the clock to agree with the prose (0 if none). */
    floor: number;
    /** Set when the prose stated a time earlier than the clock already was. */
    conflict?: string;
    reason?: string;
}

/**
 * Compare the LAST time the narration states against the clock.
 * startTotal = clock before the turn; proposedDelta = minutes the turn would
 * advance without this check.
 */
export const checkNarratedClock = (
    narrative: string,
    startTotal: number,
    proposedDelta: number,
    minutesPerDay = 1440,
): NarratedClockCheck => {
    const times = extractNarratedClockTimes(narrative);
    if (times.length === 0) return { floor: 0 };
    const last = times[times.length - 1];
    const proposedEnd = startTotal + Math.max(0, proposedDelta);
    const at = resolveClockReading(last.minutes, proposedEnd, minutesPerDay);
    const hhmm = (t: number) => {
        const md = ((t % minutesPerDay) + minutesPerDay) % minutesPerDay;
        return `${String(Math.floor(md / 60)).padStart(2, '0')}:${String(md % 60).padStart(2, '0')}`;
    };
    if (at > proposedEnd) {
        const need = at - startTotal;
        if (need <= NARRATED_CLOCK_MAX_ADVANCE) {
            return { floor: need, reason: `narration says "${last.text}" (${hhmm(at)})` };
        }
        return {
            floor: 0,
            conflict: `The narration said "${last.text}" (${hhmm(at)}), but the clock was ${hhmm(proposedEnd)} — too far ahead to be this turn.`,
        };
    }
    if (at < startTotal - NARRATED_CLOCK_BEHIND_TOLERANCE) {
        return {
            floor: 0,
            conflict: `The narration said "${last.text}" (${hhmm(at)}), but the clock was already ${hhmm(startTotal)}.`,
        };
    }
    return { floor: 0 };
};

/**
 * A player's bracketed statement of the time: "[It is 6:06 AM]", "[time: 18:30]",
 * "[the time is half past six]". Returns minutes past midnight, with am/pm
 * applied when given (null am/pm → caller resolves nearest occurrence).
 */
export const parsePlayerTimeNote = (input: string): { minutes: number; meridiem: 'am' | 'pm' | null; text: string } | null => {
    const re = /\[\s*(?:it\s*(?:is|'s)|the\s+time\s+is|time\s*(?:is|:)|clock\s*(?:is|:))\s*(?:now\s+)?([^\]]{1,40}?)\s*\]/i;
    const m = (input ?? '').match(re);
    if (!m) return null;
    let body = m[1].trim().toLowerCase().replace(/\./g, '');
    let meridiem: 'am' | 'pm' | null = null;
    const mer = body.match(/\s*(am|pm|in the morning|in the evening|at night|in the afternoon)\s*$/);
    if (mer) {
        meridiem = /am|morning/.test(mer[1]) ? 'am' : 'pm';
        body = body.slice(0, mer.index).trim();
    }
    body = body.replace(/^(\d{1,2})(\d{2})$/, '$1:$2');           // 0606 → 06:06
    if (/^\d{1,2}$/.test(body)) body = `${body}:00`;
    const minutes = parseTimeExpression(body);
    if (minutes === null) return null;
    let total = minutes;
    if (meridiem) {
        const h = Math.floor(minutes / 60) % 12;
        total = (meridiem === 'pm' ? h + 12 : h) * 60 + (minutes % 60);
    } else if (minutes >= 720) {
        meridiem = 'pm';
    }
    return { minutes: total, meridiem, text: m[0] };
};

/** Absolute clock for a player time note: the nearest occurrence to now. */
export const resolvePlayerTimeNote = (
    note: { minutes: number; meridiem: 'am' | 'pm' | null },
    currentTotal: number,
    minutesPerDay = 1440,
): number => {
    if (note.meridiem !== null) {
        const dayStart = Math.floor(currentTotal / minutesPerDay) * minutesPerDay;
        let best = dayStart + note.minutes;
        for (const d of [-1, 1]) {
            const cand = dayStart + d * minutesPerDay + note.minutes;
            if (Math.abs(cand - currentTotal) < Math.abs(best - currentTotal)) best = cand;
        }
        return best;
    }
    return resolveClockReading(note.minutes, currentTotal, minutesPerDay);
};

export const calculateTimeDelta = (
    requestedMinutes: number | undefined,
    hasSleep: boolean,
    isCombat: boolean,
    isSocial: boolean = false,    // v1.19.1: new parameter
    timeMode?: TimeMode           // v1.21: orthogonal time-velocity override
): { delta: number, log?: string } => {
    const rawDelta = requestedMinutes ?? 0;

    let maxAllowed: number;
    let capLabel: string;
    // v1.21: Sleep always wins (a sleep turn is a REST turn by definition).
    // Otherwise, an explicit time_mode takes precedence over scene-mode-derived
    // caps; fall back to the legacy combat/social/awake ladder when absent.
    if (hasSleep) {
        maxAllowed = TIME_CAPS.SLEEP_MAX;
        capLabel = 'SLEEP';
    } else if (timeMode) {
        maxAllowed = TIME_MODE_CAPS[timeMode] ?? TIME_CAPS.AWAKE_MAX;
        capLabel = timeMode;
    } else if (isCombat) {
        maxAllowed = TIME_CAPS.COMBAT_MAX;
        capLabel = 'COMBAT';
    } else if (isSocial) {
        maxAllowed = TIME_CAPS.SOCIAL_MAX;
        capLabel = 'SOCIAL';
    } else {
        maxAllowed = TIME_CAPS.AWAKE_MAX;
        capLabel = 'AWAKE';
    }

    // v1.19.1: Apply floor for non-sleep turns so time never freezes
    const floor = hasSleep ? 0 : TIME_FLOOR_MINUTES;
    const delta = Math.min(Math.max(floor, rawDelta), maxAllowed);

    const logs: string[] = [];
    if (rawDelta > maxAllowed) {
        logs.push(`[TIME-CLAMP] AI requested +${rawDelta}m, clamped to +${delta}m (${capLabel} cap: ${maxAllowed})`);
    }

    return { delta, ...(logs.length ? { log: logs.join(' | ') } : {}) };
};
