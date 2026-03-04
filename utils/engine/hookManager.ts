import { DormantHook, WorldTickEvent, ThreatArcHistory, DebugLogEntry, LoreItem } from '../../types';
import { HOOK_COOLDOWN_BASE, HOOK_COOLDOWN_ESCALATION, HOOK_COOLDOWN_MAX, RESEED_BLOCK_TURNS } from './threatPipeline';

/**
 * v1.11 FIX 2: After processing threats, check for hooks whose threat arcs
 * have concluded (all threats sourced from the hook are now expired/resolved).
 * Apply cooldown to prevent immediate re-seeding. Also records expired threats
 * in threatArcHistory for re-seed detection (FIX 5).
 */
export const updateHookCooldowns = (
    hooks: DormantHook[],
    previousThreats: WorldTickEvent[],
    currentThreats: WorldTickEvent[],
    currentTurn: number,
    threatArcHistory: ThreatArcHistory,
    debugLogs: DebugLogEntry[]
): { updatedHooks: DormantHook[]; updatedArcHistory: ThreatArcHistory } => {
    const updatedHistory = { ...threatArcHistory };

    // Find threats that existed last turn but are gone now
    const currentIds = new Set(currentThreats.map(t => t.id).filter(Boolean));
    const expiredThreats = previousThreats.filter(t => t.id && !currentIds.has(t.id));

    // Record expired threats in arc history
    for (const expired of expiredThreats) {
        const sourceKey = expired.originHookId ?? expired.dormantHookId ?? 'unknown';
        if (!updatedHistory[sourceKey]) updatedHistory[sourceKey] = [];
        updatedHistory[sourceKey].push({
            entityNames: expired.entitySourceNames ?? [],
            expiredTurn: currentTurn,
            descriptionSnippet: expired.description.substring(0, 80),
        });
        if (updatedHistory[sourceKey].length > 10) {
            updatedHistory[sourceKey] = updatedHistory[sourceKey].slice(-10);
        }
    }

    // Prune stale arc history entries
    const pruneThreshold = currentTurn - (RESEED_BLOCK_TURNS * 2);
    for (const key of Object.keys(updatedHistory)) {
        updatedHistory[key] = updatedHistory[key].filter(e => e.expiredTurn > pruneThreshold);
        if (updatedHistory[key].length === 0) delete updatedHistory[key];
    }

    // Check each activated hook — if ALL its sourced threats are gone, apply cooldown
    const updatedHooks = hooks.map(hook => {
        if (hook.status !== 'activated') return hook;

        const hasActiveThreats = currentThreats.some(t =>
            (t.originHookId === hook.id || t.dormantHookId === hook.id)
        );
        if (hasActiveThreats) return hook;

        const justExpired = expiredThreats.some(t =>
            (t.originHookId === hook.id || t.dormantHookId === hook.id)
        );
        if (!justExpired) return hook;

        const prevCount = hook.totalThreatsSourced ?? 0;
        const cooldownDuration = Math.min(
            HOOK_COOLDOWN_MAX,
            HOOK_COOLDOWN_BASE + (prevCount * HOOK_COOLDOWN_ESCALATION)
        );
        const cooldownUntil = currentTurn + cooldownDuration;

        debugLogs.push({
            timestamp: new Date().toISOString(),
            message: `[HOOK COOLDOWN — v1.11] Hook "${hook.id}" — all sourced threats ` +
                `have expired/resolved. Applying ${cooldownDuration}-turn cooldown ` +
                `(until turn ${cooldownUntil}). Previous threats sourced: ${prevCount}.`,
            type: 'warning'
        });

        return {
            ...hook,
            cooldownUntilTurn: cooldownUntil,
            lastThreatExpiredTurn: currentTurn,
            totalThreatsSourced: prevCount + 1,
        };
    });

    return { updatedHooks, updatedArcHistory: updatedHistory };
};

/**
 * v1.12 FIX SE-4: When a dormant hook is consumed (status = 'resolved' or all
 * its sourced threats have concluded), generate 1-2 consequent hooks derived
 * from the narrative outcome. This prevents the dormantHooks array from being
 * permanently exhausted.
 *
 * Consequent hooks are derived from the original hook's summary + the threat
 * outcome, creating new but related tension vectors.
 */
export const regenerateConsequentHooks = (
    hooks: DormantHook[],
    resolvedThreats: WorldTickEvent[],
    currentTurn: number,
    debugLogs: DebugLogEntry[],
    lore: LoreItem[] = []
): DormantHook[] => {
    const updatedHooks = [...hooks];
    const activatedHooks = hooks.filter(h => h.status === 'activated');

    for (const hook of activatedHooks) {
        // Check if all threats from this hook have expired
        const hasActiveThreats = resolvedThreats.some(t =>
            t.originHookId === hook.id || t.dormantHookId === hook.id
        );
        // We only regenerate for hooks where the threat arc concluded
        // (handled by cooldown system) — check if hook just got cooldown applied
        if (hook.cooldownUntilTurn && hook.cooldownUntilTurn === currentTurn + (hook.totalThreatsSourced ?? 1) * 3 + 5) {
            // This hook JUST had cooldown applied — generate consequent hooks

            // Derive consequent tension from the hook's context
            const consequentHooks: DormantHook[] = [];

            // Consequent 1: Retaliation vector — the faction responds to the outcome
            const retaliationHook: DormantHook = {
                id: `hook_consequent_${hook.id}_retaliation_t${currentTurn}`,
                summary: `Consequences of resolving "${hook.summary}" — affected parties may respond`,
                category: 'backstory',
                sourceField: 'consequent_hook',
                involvedEntities: [...(hook.involvedEntities ?? [])],
                activationConditions: `Player returns to related area or encounters related faction members`,
                status: 'dormant',
            };
            consequentHooks.push(retaliationHook);

            // Consequent 2: Reputation vector — word spreads about what happened
            if ((hook.totalThreatsSourced ?? 0) >= 2) {
                const reputationHook: DormantHook = {
                    id: `hook_consequent_${hook.id}_reputation_t${currentTurn}`,
                    summary: `Word of the player's actions regarding "${hook.summary}" has spread`,
                    category: 'relationship',
                    sourceField: 'consequent_hook',
                    involvedEntities: [],
                    activationConditions: `New NPCs recognize the player or reference past events`,
                    status: 'dormant',
                };
                consequentHooks.push(reputationHook);
            }

            for (const ch of consequentHooks) {
                updatedHooks.push(ch);
                debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[HOOK REGEN — v1.12] Generated consequent hook "${ch.id}" from resolved "${hook.id}": "${ch.summary.substring(0, 80)}"`,
                    type: 'info'
                });
            }
        }
    }

    return updatedHooks;
};
