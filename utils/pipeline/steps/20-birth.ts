import type { PipelineStep, TurnContext } from '../types';
import { processBirths, syncPregnancyRegisters } from '../../reproductionSystem';

/**
 * Step 20 (v1.61): Birth.
 *
 * Delivers every pregnancy that has reached its due week (rolled 37-42 at
 * conception): creates the child as a KnownEntity with the engine's gender
 * roll and its other traits pending, and applies birth to the mother —
 * postpartum recovery, lactation, stretch and a birth count for the PC; body
 * state for an NPC mother. Then writes NPC mothers' pregnancy, postpartum and
 * children lines into their living records.
 *
 * Runs after 19-bodyState so 12's rebuild of characterUpdate and 19's body
 * tick cannot undo what it writes. The child's race, hair, eyes and name come
 * from the post-turn trait pass (hooks/childTraitPass.ts).
 */
export const birthStep: PipelineStep = {
    name: '20-birth',
    execute: (ctx: TurnContext): TurnContext => {
        const now = ctx.newTime?.totalMinutes ?? ctx.previousWorld.time?.totalMinutes ?? 0;
        const turn = ctx.worldUpdate.turnCount ?? ctx.currentTurn;
        const res = processBirths({
            character: ctx.characterUpdate,
            entities: ctx.worldUpdate.knownEntities ?? [],
            pregnancies: ctx.worldUpdate.pregnancies ?? ctx.previousWorld.pregnancies ?? [],
            now,
            turn,
            location: ctx.worldUpdate.location ?? ctx.previousWorld.location ?? '',
        });
        for (const message of res.logs) {
            ctx.debugLogs.push({ timestamp: new Date().toISOString(), message, type: 'warning' });
        }
        const entities = syncPregnancyRegisters(res.entities, res.pregnancies, res.character.name, now, turn);
        ctx.characterUpdate = res.character;
        ctx.worldUpdate = { ...ctx.worldUpdate, knownEntities: entities, pregnancies: res.pregnancies };
        ctx.updatedKnownEntities = entities;
        return ctx;
    },
};
