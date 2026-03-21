import { WorldTime } from '../../types';
import { TIME_CAPS, MAX_REGISTRY_LINES, TIME_FLOOR_MINUTES } from '../../config/engineConfig';

export const updateTime = (currentMinutes: number, delta: number): WorldTime => {
    const totalMinutes = currentMinutes + delta;
    const day = Math.floor(totalMinutes / 1440) + 1;
    const hour = Math.floor((totalMinutes % 1440) / 60);
    const minute = totalMinutes % 60;
    const display = `Day ${day}, ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    return { totalMinutes, day, hour, minute, display };
};

export const trimHiddenRegistry = (registry: string): string => {
    if (!registry) return "";
    const lines = registry.split('\n').filter(l => l.trim());
    if (lines.length <= MAX_REGISTRY_LINES) return registry;
    return lines.slice(-MAX_REGISTRY_LINES).join('\n');
};

/**
 * v1.19.1: Scene-mode-aware time clamping.
 *
 * Priority order:
 *   1. Sleep → SLEEP_MAX (540)
 *   2. Combat → COMBAT_MAX (30)
 *   3. Social → SOCIAL_MAX (15)
 *   4. Default → AWAKE_MAX (120)
 *
 * Also applies TIME_FLOOR_MINUTES (1) so non-sleep turns always advance
 * at least 1 minute — prevents time-frozen loops.
 */
export const calculateTimeDelta = (
    requestedMinutes: number | undefined,
    hasSleep: boolean,
    isCombat: boolean,
    isSocial: boolean = false    // v1.19.1: new parameter
): { delta: number, log?: string } => {
    const rawDelta = requestedMinutes ?? 0;

    let maxAllowed: number;
    let capLabel: string;
    if (hasSleep) {
        maxAllowed = TIME_CAPS.SLEEP_MAX;
        capLabel = 'SLEEP';
    } else if (isCombat) {
        maxAllowed = TIME_CAPS.COMBAT_MAX;
        capLabel = 'COMBAT';
    } else if (isSocial) {
        maxAllowed = TIME_CAPS.SOCIAL_MAX;
        capLabel = 'SOCIAL';
    } else {
        maxAllowed = TIME_CAPS.AWAKE_MAX;
        capLabel = 'AWAKE';
    }

    // v1.19.1: Apply floor for non-sleep turns so time never freezes
    const floor = hasSleep ? 0 : TIME_FLOOR_MINUTES;
    const delta = Math.min(Math.max(floor, rawDelta), maxAllowed);

    const logs: string[] = [];
    if (rawDelta > maxAllowed) {
        logs.push(`[TIME-CLAMP] AI requested +${rawDelta}m, clamped to +${delta}m (${capLabel} cap: ${maxAllowed})`);
    }

    return { delta, ...(logs.length ? { log: logs.join(' | ') } : {}) };
};
