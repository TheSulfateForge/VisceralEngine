import type { PipelineStep, TurnContext } from '../types';
import { calculateTimeDelta, updateTime } from '../../engine';

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
            isSocial
        );

        if (timeLog) {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: timeLog,
                type: 'info'
            });
        }

        ctx.newTime = updateTime(ctx.previousWorld.time?.totalMinutes ?? 0, delta);

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

        return ctx;
    }
};
