// ============================================================================
// config/tuning.ts — v1.26
//
// Runtime tone dials. engineConfig.ts constants are compile-time; these are
// the handful of pacing knobs worth adjusting per-player-mood without
// recompiling. Backed by localStorage ('visceral_tuning'), read through a
// cached getter so hot paths (prompt build, reminder selection) pay one
// object read, not a JSON.parse per turn.
//
// Add a knob here ONLY if it changes play-feel; internal thresholds stay in
// engineConfig where they belong.
// ============================================================================

import { DREAM_TRAUMA_THRESHOLD } from './engineConfig';

export interface TuningValues {
    /** Minimum turns between ambient hook nudges (jitter is added on top). */
    hookCadenceMin: number;
    /** Random extra turns added to each hook interval (0..jitter). */
    hookCadenceJitter: number;
    /** Turns without a Devil's Bargain before the mandatory-offer clock fires. */
    bargainClockTurns: number;
    /** Trauma value at/above which sleeping can trigger a dream/nightmare. */
    dreamTraumaThreshold: number;
    /** Background world-pulse cadence (every N turns; downtime also triggers). */
    worldPulseCadence: number;
    /**
     * v1.33 — WORLD PRESSURE (0–100). The single tone dial for how adversarial
     * the world is, applied consistently everywhere pressure is generated:
     *
     *   - hook extraction: the threat : opportunity : obligation ratio both
     *     extractors are asked for (Slice 3).
     *   - ambient nudges: how strongly `selectAmbientHook` prefers an
     *     opportunity over a threat foreshadow (Slice 3).
     *   - reminder cadence: how often the calming rotation entries
     *     (WORLD_NORMALCY, PROPORTIONALITY) are allowed to repeat — low
     *     pressure surfaces them more often.
     *   - relationship warming: how fast the engine-side warming driver
     *     accrues (Slice 4).
     *
     * 50 is neutral. The default is deliberately BELOW neutral: the engine is
     * being corrected out of a measured adversarial bias (see
     * VRE_HOSTILITY_AND_MISSING_THREATS_DIAGNOSIS.md), and a calm default is
     * the safer place to re-baseline from. Raise it once play feels flat.
     */
    worldPressure: number;
}

export const TUNING_DEFAULTS: TuningValues = {
    hookCadenceMin: 8,
    hookCadenceJitter: 4,
    bargainClockTurns: 25,
    dreamTraumaThreshold: DREAM_TRAUMA_THRESHOLD,
    worldPulseCadence: 10,
    worldPressure: 40,
};

/** Normalised 0..1 world-pressure, clamped. 0 = placid, 1 = relentless. */
export const worldPressureUnit = (): number =>
    Math.min(1, Math.max(0, (getTuning().worldPressure ?? 40) / 100));

const STORAGE_KEY = 'visceral_tuning';

let cached: TuningValues | null = null;

export const getTuning = (): TuningValues => {
    if (cached) return cached;
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
        cached = raw ? { ...TUNING_DEFAULTS, ...JSON.parse(raw) } : { ...TUNING_DEFAULTS };
    } catch {
        cached = { ...TUNING_DEFAULTS };
    }
    return cached;
};

export const setTuning = (partial: Partial<TuningValues>): TuningValues => {
    const next = { ...getTuning(), ...partial };
    cached = next;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* quota */ }
    return next;
};

export const resetTuning = (): TuningValues => {
    cached = { ...TUNING_DEFAULTS };
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    return cached;
};
