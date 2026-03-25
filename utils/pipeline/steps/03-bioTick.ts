import type { PipelineStep, TurnContext } from '../types';
import { BioEngine } from '../../bioEngine';

/**
 * Step 2: Bio Pipeline
 *
 * Runs the biological simulation engine to process character state
 * (fatigue, hunger, injuries, etc.)
 */
export const bioTickStep: PipelineStep = {
    name: '03-bioTick',
    execute: (ctx: TurnContext): TurnContext => {
        const r = ctx.sanitisedResponse;

        // Get time delta from previous step
        // For now, we need to recalculate it since we don't have it stored
        // This is a limitation — in a real refactor, calculate once and store.
        const hasSleep = (r.biological_inputs?.sleep_hours ?? 0) > 0;
        const isCombat = r.scene_mode === 'COMBAT';
        const isSocial = r.scene_mode === 'SOCIAL';

        // Use the new time's display to infer delta (approximation)
        // Better: pass delta through ctx
        const oldMinutes = ctx.previousWorld.time?.totalMinutes ?? 0;
        const newMinutes = ctx.newTime.totalMinutes;
        const delta = newMinutes - oldMinutes;

        ctx.tensionLevel = r.tension_level ?? ctx.previousWorld.tensionLevel ?? 10;

        ctx.bioResult = BioEngine.tick(
            ctx.previousCharacter,
            delta,
            ctx.tensionLevel,
            r.biological_inputs,
            [...ctx.playerRemovedConditions],
            r.scene_mode ?? 'NARRATIVE'
        );

        ctx.bioResult.logs.forEach((log: string) => {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[BIO] ${log}`,
                type: 'info'
            });
        });

        return ctx;
    }
};
