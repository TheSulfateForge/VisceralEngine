// ============================================================================
// utils/worldSeedBodies.ts — v1.48: NPC Body blocks straight from the source
// ============================================================================
//
// The seed builder hands the whole seed document to Gemini, which returns NPC
// records with description/personality/goals. A "Body:" block (Format Spec
// Rule 7D) is exact, labeled data — exactly the kind of thing an extraction
// model paraphrases, folds into the description, or drops. So the engine
// reads it itself: split the SOURCE on its "=== Name ===" dividers, find each
// NPC's own section by name, and parse the labeled block with plain code.
//
// Precedence: a body the author already edited in the seed editor wins over
// the source, which wins over nothing.
// ============================================================================

import type { BodyProfile, WorldSeedNPC } from '../types';
import { parseLabeledBody } from './engine/bodyModel';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Every "=== Name ===" section of a seed document, keyed by normalised name. */
export const splitSeedSections = (source: string): Map<string, string> => {
    const out = new Map<string, string>();
    const re = /^===\s*(.+?)\s*===\s*$/gm;
    const hits = [...source.matchAll(re)];
    hits.forEach((m, i) => {
        const start = (m.index ?? 0) + m[0].length;
        const end = i + 1 < hits.length ? hits[i + 1].index ?? source.length : source.length;
        const name = m[1].replace(/^rule\s*:\s*/i, '');
        out.set(norm(name), source.slice(start, end));
    });
    return out;
};

const hasAny = (b: BodyProfile) => Object.keys(b).length > 0;

/**
 * Attach each NPC's labeled Body block from `source`. Also carries forward any
 * body an earlier version of the seed already had (an expand pass returns
 * fresh records from Gemini, which would otherwise lose them).
 */
export const attachNpcBodies = (
    npcs: WorldSeedNPC[],
    source: string,
    previous: WorldSeedNPC[] = [],
): { npcs: WorldSeedNPC[]; attached: string[] } => {
    const sections = splitSeedSections(source ?? '');
    const prevByName = new Map(previous.map(n => [norm(n.name), n]));
    const attached: string[] = [];
    const out = npcs.map(npc => {
        const key = norm(npc.name);
        // Exact header first; else a header that contains / is contained by the
        // extracted name ("Lady Elsabet Hartwell" vs "Elsabet Hartwell").
        let section = sections.get(key);
        if (section === undefined) {
            for (const [k, v] of sections) {
                if (k && (k.includes(key) || key.includes(k))) { section = v; break; }
            }
        }
        const fromSource = section ? parseLabeledBody(section) : {};
        // The extractor may also have copied the block into description.
        const fromDescription = parseLabeledBody(npc.description ?? '');
        const prev = prevByName.get(key);
        const merged: BodyProfile = { ...fromDescription, ...fromSource, ...(prev?.body ?? {}), ...(npc.body ?? {}) };
        const appearance = npc.appearance ?? prev?.appearance;
        if (!hasAny(merged)) return appearance ? { ...npc, appearance } : npc;
        if (hasAny(fromSource) || hasAny(fromDescription)) attached.push(npc.name);
        return { ...npc, body: merged, ...(appearance ? { appearance } : {}) };
    });
    return { npcs: out, attached };
};
