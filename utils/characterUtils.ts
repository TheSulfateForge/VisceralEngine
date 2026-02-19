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
        // Step 1: Derive the base condition name by truncating at the first
        // colon or em-dash separator. This collapses pairs like:
        //   "Treated Infection (Fragile)"
        //   "Treated Infection (Fragile): The sepsis is halted, but the tissue is raw..."
        // into the same key, keeping the longer/more descriptive version.
        const base = condition
            .split(/[:\u2014\u2013]/)[0]  // split at ':', em-dash, or en-dash
            .toLowerCase()
            .replace(/\b(agonizing|severe|mild|critical|continuous|active)\b/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        // Step 2: Keep the longer (more specific) version of any duplicate key
        const existing = normalized.get(base);
        if (!existing || condition.length > existing.length) {
            normalized.set(base, condition);
        }
    }

    return Array.from(normalized.values());
};