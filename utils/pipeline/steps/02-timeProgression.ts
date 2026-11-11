import type { PipelineStep, TurnContext } from '../types';
import { calculateTimeDelta, updateTime, deriveTimePhase, estimateTimeFloor, estimateActivityMinutes, checkNarratedClock } from '../../engine';
import { inferLocationMove } from '../../engine/locationGraph';

/**
 * Step 1: Time Pipeline (v1.19.1: scene-mode-aware clamping)
 *
 * Calculates time delta based on scene mode and sleep inputs,
 * then updates the world time.
 */
export const timeProgressionStep: PipelineStep = {
    name: '02-timeProgression',
    execute: (ctx: TurnContext): TurnContext => {
        const r = ctx.sanitisedResponse;
        const hasSleep = (r.biological_inputs?.sleep_hours ?? 0) > 0;
        const isCombat = r.scene_mode === 'COMBAT';
        const isSocial = r.scene_mode === 'SOCIAL';

        // v1.53: the model often never reports a move. Infer it from the
        // player's input and the narration against the location graph, and
        // write it back as the turn's location_update so this step's travel
        // floor and step 06's graph/presence logic both see it.
        if (!r.location_update?.location_name?.trim() && !hasSleep) {
            const move = inferLocationMove(
                ctx.previousWorld.locationGraph,
                r.narrative ?? '',
                ctx.playerInput ?? '',
                ctx.previousWorld.location ?? '',
            );
            if (move) {
                r.location_update = {
                    location_name: move.location_name,
                    ...(move.travelled && ctx.previousWorld.location ? { traveled_from: ctx.previousWorld.location } : {}),
                };
                ctx.debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[LOCATION INFERRED — v1.53] No location_update from the model; ${move.reason}.`,
                    type: 'info'
                });
            }
        }

        // v1.51: raise the model's figure to what the turn actually contained
        // (speech at ~150 wpm, real travel). Sleep turns keep their own path.
        let requested = r.time_passed_minutes;
        if (r.time_passed_raw !== undefined) {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[TIME — v1.55] Model sent time_passed_minutes as ${r.time_passed_raw} (not a number); read as +${requested ?? 0}m.`,
                type: 'info'
            });
        }
        // v1.54: sleep_hours set but time_passed_minutes left at 0/short used
        // to advance the clock by nothing (the sleep floor is 0). The hours
        // slept ARE the elapsed time.
        if (hasSleep) {
            const sleptMinutes = Math.round((r.biological_inputs?.sleep_hours ?? 0) * 60);
            if ((requested ?? 0) < sleptMinutes / 2) {
                ctx.debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[SLEEP — v1.54] sleep_hours=${r.biological_inputs?.sleep_hours} but time_passed_minutes=${requested ?? 0}; clock follows the hours slept (+${sleptMinutes}m).`,
                    type: 'info'
                });
                requested = sleptMinutes;
            }
        }
        if (!hasSleep) {
            const { floor, reasons } = estimateTimeFloor(
                r.narrative ?? '',
                ctx.playerInput ?? '',
                r.location_update,
                ctx.previousWorld.location ?? ''
            );
            if (floor > (requested ?? 0)) {
                ctx.debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[TIME FLOOR — v1.51] AI asked +${requested ?? 0}m; raised to +${floor}m (${reasons.join('; ')})`,
                    type: 'info'
                });
                requested = floor;
            }
        }

        const { delta, log: timeLog } = calculateTimeDelta(
            requested,
            hasSleep,
            isCombat,
            isSocial,
            ctx.effectiveTimeMode    // v1.21: time_mode cap takes precedence
        );

        if (timeLog) {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: timeLog,
                type: 'info'
            });
        }

        // v1.52: EVIDENCE OVERRIDES THE SCENE CAP. Activities the player named
        // (a bath, a meal) and a time the narration itself put on the clock
        // are facts about this turn, not the model's estimate — so they may
        // exceed the SOCIAL/COMBAT cap. Never on sleep turns; never past
        // NARRATED_CLOCK_MAX_ADVANCE.
        let finalDelta = delta;
        let clockConflict: string | undefined;
        if (!hasSleep) {
            const act = estimateActivityMinutes(ctx.playerInput ?? '');
            if (act.minutes > finalDelta) {
                ctx.debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[TIME — v1.52] Activities (${act.labels.join(', ')}) need ≥${act.minutes}m; +${finalDelta}m raised to +${act.minutes}m.`,
                    type: 'info'
                });
                finalDelta = act.minutes;
            }
            const startTotal = ctx.previousWorld.time?.totalMinutes ?? 0;
            const narrated = checkNarratedClock(
                r.narrative ?? '',
                startTotal,
                finalDelta,
                ctx.previousWorld.calendar?.minutesPerDay ?? 1440,
            );
            if (narrated.floor > finalDelta) {
                ctx.debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[TIME — v1.52] Clock moved to match the prose: ${narrated.reason}; +${finalDelta}m raised to +${narrated.floor}m.`,
                    type: 'info'
                });
                finalDelta = narrated.floor;
            }
            if (narrated.conflict) {
                clockConflict = narrated.conflict;
                ctx.debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[TIME — v1.52] Prose/clock conflict: ${narrated.conflict} The clock stands; next turn is told so.`,
                    type: 'warning'
                });
            }
        }
        // Read by buildClockLine next turn, then replaced (undefined clears it).
        ctx.worldUpdate.clockConflictNote = clockConflict;

        ctx.newTime = updateTime(ctx.previousWorld.time?.totalMinutes ?? 0, finalDelta, ctx.previousWorld.calendar);

        if (finalDelta > 0) {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `Time Advancement: +${finalDelta}m -> ${ctx.newTime.display}`,
                type: 'info'
            });
        } else {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[BIO] No time passed.`,
                type: 'info'
            });
        }

        // v1.20: Clock-drift annotation. Compare the AI-declared scene_time_phase
        // against the phase derived from the post-advancement clock. Regeneration
        // (max 2 retries) happens at the call site before processTurn; by the time
        // we reach the pipeline the response is being accepted, so this is the
        // "accept with annotation" path — record any residual mismatch for debug.
        const declaredPhase = ctx.sanitisedResponse.scene_time_phase;
        if (declaredPhase) {
            const clockPhase = deriveTimePhase(ctx.newTime.hour);
            if (declaredPhase !== clockPhase) {
                ctx.debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[CLOCK_DRIFT] AI declared phase=${declaredPhase}, clock phase=${clockPhase} (${ctx.newTime.display})`,
                    type: 'warning'
                });
            }
        }

        return ctx;
    }
};
