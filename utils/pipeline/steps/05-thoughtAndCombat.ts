import type { PipelineStep, TurnContext } from '../types';

/**
 * Step 4+5: Thought Process Log & Combat Context Pipeline
 *
 * Logs the AI's thought process and extracts combat context
 * (threats and environment from combat_context field).
 */
export const thoughtAndCombatStep: PipelineStep = {
    name: '05-thoughtAndCombat',
    execute: (ctx: TurnContext): TurnContext => {
        const r = ctx.sanitisedResponse;

        // Log thought process
        if (r.thought_process) {
            ctx.debugLogs.unshift({
                timestamp: new Date().toISOString(),
                message: `[AI THOUGHT]: ${r.thought_process}`,
                type: 'info'
            });
        }

        // Extract combat context
        let nextThreats = ctx.previousWorld.activeThreats;
        let nextEnv = ctx.previousWorld.environment;

        if (r.combat_context) {
            nextThreats = r.combat_context.active_threats;
            nextEnv = r.combat_context.environment;
        } else if (r.scene_mode === 'SOCIAL' || r.scene_mode === 'NARRATIVE') {
            nextThreats = [];
        }

        ctx.nextThreats = nextThreats;
        ctx.nextEnv = nextEnv;

        return ctx;
    }
};
