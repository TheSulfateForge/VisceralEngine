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

export const trimHiddenRegistry = (registry: string): string => {
    if (!registry) return "";
    const lines = registry.split('\n').filter(l => l.trim());
    if (lines.length <= MAX_REGISTRY_LINES) return registry;
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
