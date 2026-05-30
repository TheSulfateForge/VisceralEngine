import type { PipelineStep, TurnContext } from '../types';
import { applyUsageAdvancement } from '../../skillSystem';

/**
 * Step 16: Usage-Driven Skill Advancement (Path B — normal-play workhorse)
 *
 * When the model set `roll_request.relevant_skill` this turn, record one use of
 * that skill on the player character:
 *  - Unknown skill → auto-created at `untrained` (this reference is use #1).
 *  - Known skill → usageCount++ and, when it crosses the level threshold,
 *    advances exactly one tier.
 *
 * This runs whether the roll succeeds or fails — the act of attempting the
 * challenge is the practice. Advancement is surfaced as a debug-log beat that
 * the UI can promote to an inline narrative note / toast (open question #2).
 *
 * NOTE: disabled in MONTAGE mode (see pipeline selector) — montages use Path A
 * exclusively and do not touch usageCount.
 */
export const usageAdvancementStep: PipelineStep = {
    name: '16-usageAdvancement',
    execute: (ctx: TurnContext): TurnContext => {
        const roll = ctx.sanitisedResponse.roll_request;
        const skillName = roll?.relevant_skill?.trim();
        if (!skillName) return ctx;

        const { character, event } = applyUsageAdvancement(
            ctx.characterUpdate,
            skillName,
            ctx.currentTurn,
            roll?.relevant_skill_category
        );
        ctx.characterUpdate = character;

        if (event?.kind === 'usage_advance') {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[ADVANCEMENT:USAGE] ${event.skillName} ${event.fromLevel} → ${event.toLevel} (${event.reason})`,
                type: 'info',
            });
        } else if (event?.kind === 'created') {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[SKILL:NEW] "${event.skillName}" acquired at untrained (first use)`,
                type: 'info',
            });
        }

        return ctx;
    }
};
