import type { PipelineStep, TurnContext } from '../types';
import { calculateTimeDelta, updateTime, deriveTimePhase } from '../../engine';

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

        const { delta, log: timeLog } = calculateTimeDelta(
            r.time_passed_minutes,
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

        ctx.newTime = updateTime(ctx.previousWorld.time?.totalMinutes ?? 0, delta, ctx.previousWorld.calendar);

        if (delta > 0) {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `Time Advancement: +${delta}m -> ${ctx.newTime.display}`,
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
