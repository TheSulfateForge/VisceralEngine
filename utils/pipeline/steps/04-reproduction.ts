import type { PipelineStep, TurnContext } from '../types';
import { ReproductionSystem, resolveConceptionParticipants } from '../../reproductionSystem';

/**
 * Step 3: Reproduction Pipeline
 *
 * Handles conception and pregnancy tracking.
 *
 * v1.61: a successful roll now CREATES a pregnancy (it only logged before),
 * existing pregnancies advance by the in-game clock every turn, and only
 * pregnancies involving the player character are tracked.
 */
export const reproductionStep: PipelineStep = {
    name: '04-reproduction',
    execute: (ctx: TurnContext): TurnContext => {
        const r = ctx.sanitisedResponse;
        const now = ctx.newTime.totalMinutes;
        const log = (message: string, type: 'info' | 'warning' = 'info') =>
            ctx.debugLogs.push({ timestamp: new Date().toISOString(), message, type });

        const advanced = ReproductionSystem.advancePregnancies(ctx.previousWorld.pregnancies ?? [], now);
        const currentPregnancies = advanced.updated;
        advanced.logs.forEach(m => log(m, 'warning'));

        if (r.biological_event) {
            const pc = ctx.previousCharacter;
            const { involvesPc, partnerName } = resolveConceptionParticipants(r.body_events, pc.name);
            if (!involvesPc) {
                log('[CONCEPTION] Biological event did not involve the player character — not tracked.');
            } else {
                const candidate = ReproductionSystem.initiatePregnancy(pc, ctx.currentTurn, now, partnerName);
                if (ReproductionSystem.alreadyPregnant(currentPregnancies, candidate.motherName)) {
                    log(`[CONCEPTION] ${candidate.motherName} is already pregnant — no roll.`);
                } else {
                    const roll = Math.random();
                    if (ReproductionSystem.rollForConception(undefined, roll)) {
                        currentPregnancies.push(candidate);
                        log(`[CONCEPTION] Biological event triggered. Roll: ${roll.toFixed(3)} — Conception occurred (mother ${candidate.motherName}, father ${candidate.fatherName}).`, 'warning');
                    } else {
                        log(`[CONCEPTION] Biological event triggered. Roll: ${roll.toFixed(3)} — Conception failed (RNG).`);
                    }
                }
            }
        }

        ctx.worldUpdate = {
            ...ctx.worldUpdate,
            pregnancies: currentPregnancies
        };

        return ctx;
    }
};
