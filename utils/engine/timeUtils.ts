import { WorldTime } from '../../types';
import { TIME_CAPS, MAX_REGISTRY_LINES } from '../../config/engineConfig';

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

export const calculateTimeDelta = (
    requestedMinutes: number | undefined,
    hasSleep: boolean,
    isCombat: boolean
): { delta: number, log?: string } => {
    const rawDelta = requestedMinutes ?? 0;

    let maxAllowed: number;
    if (hasSleep) maxAllowed = TIME_CAPS.SLEEP_MAX;
    else if (isCombat) maxAllowed = TIME_CAPS.COMBAT_MAX;
    else maxAllowed = TIME_CAPS.AWAKE_MAX;

    const delta = Math.min(Math.max(0, rawDelta), maxAllowed);

    if (rawDelta > maxAllowed) {
        return {
            delta,
            log: `[TIME-CLAMP] AI requested +${rawDelta}m, clamped to +${delta}m (cap: ${maxAllowed})`
        };
    }
    return { delta };
};
