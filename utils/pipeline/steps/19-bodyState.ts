import type { PipelineStep, TurnContext } from '../types';
import { applyBodyEvents, tickBodyState } from '../../engine/bodyModel';

/**
 * Step 19 (v1.48): Body state.
 *
 * Folds the model's `body_events` into the PC's and NPCs' BodyState, then
 * advances healing on the world clock: injuries heal, fluids clear, stretch
 * recovers one level per 12 hours. Virginity, once taken, is permanent.
 *
 * Runs after 12-assembleState so it works on the final entity list and the
 * final clock, and so 12's rebuild of characterUpdate cannot drop what it
 * writes.
 */
export const bodyStateStep: PipelineStep = {
    name: '19-bodyState',
    execute: (ctx: TurnContext): TurnContext => {
        const now = ctx.newTime?.totalMinutes ?? ctx.previousWorld.time?.totalMinutes ?? 0;
        const stamp = () => new Date().toISOString();

        const applied = applyBodyEvents(
            ctx.sanitisedResponse.body_events,
            ctx.characterUpdate,
            ctx.worldUpdate.knownEntities ?? [],
            ctx.currentTurn,
            now,
            ctx.worldUpdate.playerCanon ?? ctx.previousWorld.playerCanon ?? [],
        );
        for (const line of applied.logs) {
            ctx.debugLogs.push({ timestamp: stamp(), message: line, type: 'info' });
        }

        let character = applied.character;
        const pcTick = tickBodyState(character.bodyState, now);
        if (pcTick.state) character = { ...character, bodyState: pcTick.state };
        for (const h of pcTick.healed) {
            ctx.debugLogs.push({ timestamp: stamp(), message: `[BODY] ${character.name}: ${h}.`, type: 'info' });
        }

        const entities = applied.entities.map(e => {
            if (!e.bodyState) return e;
            const t = tickBodyState(e.bodyState, now);
            for (const h of t.healed) {
                ctx.debugLogs.push({ timestamp: stamp(), message: `[BODY] ${e.name}: ${h}.`, type: 'info' });
            }
            return { ...e, bodyState: t.state };
        });

        ctx.characterUpdate = character;
        ctx.worldUpdate = { ...ctx.worldUpdate, knownEntities: entities };
        ctx.updatedKnownEntities = entities;
        return ctx;
    },
};
