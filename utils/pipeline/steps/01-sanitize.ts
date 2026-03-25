import type { PipelineStep, TurnContext } from '../types';
import { sanitiseAllFields } from '../../contentValidation';
import { DENIAL_SUPPRESSION_THRESHOLD } from '../../../config/engineConfig';
import type { ThreatDenialTracker } from '../../../types';

/**
 * Step 0: Full-response field sanitisation
 *
 * Replaces the old validateResponse() call which only scanned narrative.
 * All string fields — conditions, memory, lore, NPC names — are now
 * scanned and sanitised before any state is written.
 *
 * v1.4: Also filters out lore with [RENAME:X] markers and entity updates
 * with unresolved names before they reach state.
 * v1.7: Uses nameMap for immediate resolution.
 */
export const sanitizeStep: PipelineStep = {
    name: '01-sanitize',
    execute: (ctx: TurnContext): TurnContext => {
        const { sanitisedResponse: response_sanitised, allViolations } = sanitiseAllFields(
            ctx.response,
            ctx.nameMap,
            ctx.usedNames
        );

        ctx.sanitisedResponse = response_sanitised;

        if (allViolations.length > 0) {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[⚠ BANNED NAME VIOLATION] AI used forbidden name(s): ${allViolations.join(', ')} — all fields sanitised`,
                type: 'warning'
            });
        }

        // v1.17: Initialize Global Cooldown & Suppression State
        ctx.globalCooldownUntil = ctx.previousWorld.threatCooldownUntilTurn ?? 0;
        ctx.sessionDenialCount = ctx.previousWorld.sessionDenialCount ?? 0;
        ctx.lastThreatArcEndTurn = ctx.previousWorld.lastThreatArcEndTurn ?? 0;
        ctx.denialTracker = {
            ...(ctx.previousWorld.threatDenialTracker ?? {})
        } as ThreatDenialTracker;

        ctx.suppressedEntityNames.clear();
        for (const [name, entry] of Object.entries(ctx.denialTracker)) {
            // v1.18: Only suppress on multi-word entity names. Single-word fragments
            // ("nathan", "mana", "high", "city") caused catastrophic collateral blocking.
            // Existing single-word entries in saved tracker data become inert.
            if (entry.denialCount >= DENIAL_SUPPRESSION_THRESHOLD && name.includes(' ')) {
                ctx.suppressedEntityNames.add(name);
            }
        }

        return ctx;
    }
};
