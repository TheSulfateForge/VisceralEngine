import type { PipelineStep, TurnContext } from '../types';
import type { KnownEntity, Faction, SocialTie } from '../../../types';
import { advanceSocialGraph } from '../../engine/socialGraph';
import { socialContentionUnit } from '../../../config/tuning';

/**
 * Step 18: The Social Web (v1.34)
 *
 * Advances directed NPC→NPC standing. See VRE_SOCIAL_WEB_DESIGN.md.
 *
 * Runs LATE by design — after 12-assembleState (entity statuses and the player
 * location settle there) and after 14-factionConflicts (faction membership and
 * disposition settle there), so the pass reads final state rather than a
 * half-updated world. It runs before 17-sceneContinuity, which must stay last
 * because it snapshots everything for next turn's [SINCE LAST TURN] diff.
 *
 * Pure arithmetic, no LLM call, no network. Cost is a bounded O(n²) sweep over
 * at most MAX_SOCIAL_ACTORS entities.
 */
export const socialGraphStep: PipelineStep = {
    name: '18-socialGraph',
    execute: (ctx: TurnContext): TurnContext => {
        const entities: KnownEntity[] =
            ctx.updatedKnownEntities ?? ctx.worldUpdate.knownEntities ?? [];
        const factions: Faction[] =
            ctx.worldUpdate.factions ?? ctx.previousWorld.factions ?? [];
        const previousTies: SocialTie[] =
            ctx.previousWorld.socialGraph ?? [];

        // The turn number the rest of the world will see once this turn lands.
        const turn = (ctx.previousWorld.turnCount ?? 0) + 1;

        const { ties, logs } = advanceSocialGraph({
            entities,
            factions,
            ties: previousTies,
            turn,
            contention: socialContentionUnit(),
            declared: ctx.sanitisedResponse?.social_updates ?? [],
        });

        ctx.worldUpdate.socialGraph = ties;

        for (const message of logs) {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message,
                type: 'info',
            });
        }

        return ctx;
    },
};
