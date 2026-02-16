
export const MODIFIER_CAPS = {
    MIN: 0.25,
    MAX: 4.0,
};

export const clampModifier = (value: number | undefined, current: number): number => {
    if (value === undefined) return current;
    return Math.min(MODIFIER_CAPS.MAX, Math.max(MODIFIER_CAPS.MIN, value));
};

export const deduplicateConditions = (conditions: string[]): string[] => {
    const normalized = new Map<string, string>();
    
    for (const condition of conditions) {
        // Create a rough key by lowercasing and removing severity words
        const key = condition.toLowerCase()
            .replace(/\b(agonizing|severe|mild|critical|continuous|active)\b/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        
        // Keep the longer/more specific version
        const existing = normalized.get(key);
        if (!existing || condition.length > existing.length) {
            normalized.set(key, condition);
        }
    }
    
    return Array.from(normalized.values());
};
