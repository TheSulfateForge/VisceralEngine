import type { PipelineStep, TurnContext } from '../types';

/**
 * Step 3: Reproduction Pipeline
 *
 * Handles conception and pregnancy tracking.
 */
export const reproductionStep: PipelineStep = {
    name: '04-reproduction',
    execute: (ctx: TurnContext): TurnContext => {
        const r = ctx.sanitisedResponse;

        // Get time delta
        const oldMinutes = ctx.previousWorld.time?.totalMinutes ?? 0;
        const newMinutes = ctx.newTime.totalMinutes;
        const delta = newMinutes - oldMinutes;

        let currentPregnancies = [...(ctx.previousWorld.pregnancies ?? [])];

        if (r.biological_event && delta > 0) {
            const conceptionRoll = Math.random();
            if (conceptionRoll < 0.3) {
                ctx.debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[CONCEPTION] Biological event triggered. Roll: ${conceptionRoll.toFixed(3)} — Conception occurred.`,
                    type: 'warning'
                });
            } else {
                ctx.debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[CONCEPTION] Biological event triggered. Roll: ${conceptionRoll.toFixed(3)} — Conception failed (RNG).`,
                    type: 'info'
                });
            }
        }

        ctx.worldUpdate = {
            ...ctx.worldUpdate,
            pregnancies: currentPregnancies
        };

        return ctx;
    }
};
