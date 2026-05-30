import type { PipelineStep, TurnContext } from '../types';
import { applySkillUpdates } from '../../skillSystem';

/**
 * Step 15: AI-Driven Skill Updates (Path A)
 *
 * Consumes `character_updates.skill_updates` from the model response and applies
 * explicit, narratively-decisive skill changes. No-downgrades and level
 * validation are enforced inside `applySkillUpdates`; invalid levels are skipped.
 *
 * In normal play the AI is instructed to use this sparingly (the schema says so);
 * routine practice flows through Path B (usage advancement) instead. In montage
 * mode this will become the ONLY advancement path.
 */
export const aiSkillUpdatesStep: PipelineStep = {
    name: '15-aiSkillUpdates',
    execute: (ctx: TurnContext): TurnContext => {
        const updates = ctx.sanitisedResponse.character_updates?.skill_updates;
        if (!updates || updates.length === 0) return ctx;

        const { character, events } = applySkillUpdates(ctx.characterUpdate, updates, ctx.currentTurn);
        ctx.characterUpdate = character;

        for (const e of events) {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[ADVANCEMENT:AI] ${e.skillName} ${e.fromLevel ?? 'NEW'} → ${e.toLevel} (${e.reason})`,
                type: 'info',
            });
        }

        return ctx;
    }
};
