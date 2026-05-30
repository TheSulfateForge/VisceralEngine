// ============================================================================
// declaredActions.ts — Declared-Action Duration Engine (v0.13, Step 5)
// ----------------------------------------------------------------------------
// Time authority for duration-bearing actions shifts from the AI to the
// player/engine. The UI picker hands the engine a verb + unit + quantity; this
// module converts that into a deterministic duration (minutes) and resolves the
// resulting time-velocity mode (ACTIVITY / REST / MONTAGE). The AI then narrates
// against the engine-advanced clock instead of inventing the elapsed time.
//
// See TIME_AND_MONTAGE_DESIGN.md System 4.
// ============================================================================

import type {
    DeclaredAction,
    DeclaredActionType,
    DeclaredActionUnit,
    MontageType,
    SceneMode,
    TimeMode,
} from '../../types';
import { MONTAGE_TYPES } from '../../types';
import {
    DECLARED_ACTION_UNIT_MINUTES,
    MONTAGE_MIN_MINUTES,
} from '../../config/engineConfig';

/** Result of resolving a player's declared action into engine state. */
export interface ResolvedDeclaredAction {
    /** The fully-built declared action (with durationMinutes populated). */
    declaredAction: DeclaredAction;
    /** Time-velocity mode the turn should run in. */
    timeMode: TimeMode;
    /** Tone mode. Declared actions are always non-combat → NARRATIVE. */
    sceneMode: SceneMode;
    /** Present iff timeMode === 'MONTAGE'; drives the montage prompt + block. */
    montageType?: MontageType;
}

/** Convert a unit × quantity pick into whole minutes (never negative). */
export const declaredActionToMinutes = (
    unit: DeclaredActionUnit,
    quantity: number,
): number => {
    const perUnit = DECLARED_ACTION_UNIT_MINUTES[unit] ?? 0;
    const q = Number.isFinite(quantity) ? quantity : 0;
    return Math.max(0, Math.round(perUnit * q));
};

/** True for the explicit `montage:*` verbs. */
export const isMontageAction = (actionType: DeclaredActionType): boolean =>
    actionType.startsWith('montage:');

/** Extract the MontageType from a `montage:*` verb. Unknown suffix → 'training'. */
export const montageTypeFromAction = (
    actionType: DeclaredActionType,
): MontageType | undefined => {
    if (!isMontageAction(actionType)) return undefined;
    const suffix = actionType.slice('montage:'.length);
    return (MONTAGE_TYPES as readonly string[]).includes(suffix)
        ? (suffix as MontageType)
        : 'training';
};

/**
 * Map a BARE verb (sleep/study/train/travel/work) to the montage type used when
 * a long-duration bare verb is auto-promoted to a montage (see resolve logic).
 */
const bareVerbToMontageType = (actionType: DeclaredActionType): MontageType => {
    switch (actionType) {
        case 'sleep':  return 'rest';
        case 'travel': return 'travel';
        case 'work':   return 'work';
        case 'study':
        case 'train':
        default:       return 'training';
    }
};

/**
 * Resolve a declared action into the duration + modes the pipeline should use.
 *
 * Routing rules (TIME_AND_MONTAGE_DESIGN.md System 4):
 *  - `montage:*` verbs always run in MONTAGE mode. If the player picked a
 *    sub-day duration with a montage verb, the duration is raised to the
 *    one-day montage minimum (a montage is a multi-day construct by definition).
 *  - A BARE verb whose duration reaches ≥ 1 day is auto-promoted to a montage
 *    of the matching type. Without this, ACTIVITY's 1440m cap would silently
 *    truncate "train for 2 years" down to a single day — a footgun. (Lean:
 *    auto-promote; the proposal model still gives the player full veto.)
 *  - A sub-day `sleep` → REST; any other sub-day bare verb → ACTIVITY.
 */
export const resolveDeclaredAction = (
    actionType: DeclaredActionType,
    unit: DeclaredActionUnit,
    quantity: number,
    focus?: string,
): ResolvedDeclaredAction => {
    const rawMinutes = declaredActionToMinutes(unit, quantity);
    const base: DeclaredAction = { actionType, unit, quantity, focus, durationMinutes: rawMinutes };

    if (isMontageAction(actionType)) {
        const durationMinutes = Math.max(rawMinutes, MONTAGE_MIN_MINUTES);
        return {
            declaredAction: { ...base, durationMinutes },
            timeMode: 'MONTAGE',
            sceneMode: 'NARRATIVE',
            montageType: montageTypeFromAction(actionType),
        };
    }

    if (rawMinutes >= MONTAGE_MIN_MINUTES) {
        return {
            declaredAction: base,
            timeMode: 'MONTAGE',
            sceneMode: 'NARRATIVE',
            montageType: bareVerbToMontageType(actionType),
        };
    }

    const timeMode: TimeMode = actionType === 'sleep' ? 'REST' : 'ACTIVITY';
    return { declaredAction: base, timeMode, sceneMode: 'NARRATIVE' };
};

/**
 * Human-readable label for a declared duration, e.g. "3 weeks", "1 year".
 * Used by the picker preview and the montage clock-range display.
 */
export const formatDeclaredDuration = (unit: DeclaredActionUnit, quantity: number): string => {
    const q = Math.max(0, Math.round(quantity));
    const singular = unit.endsWith('s') ? unit.slice(0, -1) : unit;
    return `${q} ${q === 1 ? singular : singular + 's'}`;
};
