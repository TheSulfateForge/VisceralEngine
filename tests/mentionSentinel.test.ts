import { describe, it, expect } from 'vitest';
import {
    findNarrativeMentionedEntities,
    findExactKeywordLore,
    buildWorldRoster,
    buildLoreTopicIndex,
} from '../utils/mentionSentinel';
import {
    updateEntityPresence,
    detectEntityDeaths,
    detectLoreDeaths,
} from '../utils/engine/entityLifecycle';
import type { KnownEntity, DebugLogEntry } from '../types';

const mk = (over: Partial<KnownEntity>): KnownEntity => ({
    id: over.id ?? `npc_${(over.name ?? 'x').toLowerCase().replace(/\s+/g, '_')}`,
    name: 'Test NPC',
    role: 'villager',
    location: 'the square',
    impression: '',
    relationship_level: 'NEUTRAL',
    leverage: '',
    ledger: [],
    ...over,
});

const logs = (): DebugLogEntry[] => [];

// ────────────────────────────────────────────────────────────────────────────
// v1.27 Mention Sentinel
// ────────────────────────────────────────────────────────────────────────────
describe('findNarrativeMentionedEntities (v1.27)', () => {
    const cast = [
        mk({ name: 'Guildmaster Halric Vance', status: 'missing' }),
        mk({ name: 'Lyrelle Verancourt', status: 'distant' }),
        mk({ name: 'Cassian Verancourt', status: 'present' }),   // active — not sentinel's job
        mk({ name: 'Old Maren', status: 'dead' }),               // dead — never hydrated
    ];

    it('hydrates dormant NPCs mentioned by first name in the last model turn', () => {
        const hits = findNarrativeMentionedEntities(
            'Rumor says Halric raised the tariffs again.', cast, new Set(), 4);
        expect(hits.map(e => e.name)).toEqual(['Guildmaster Halric Vance']);
    });

    it('ignores active, dead, and already-retrieved entities; respects limit', () => {
        const hits = findNarrativeMentionedEntities(
            'Cassian spoke of Lyrelle, Halric, and Maren.', cast,
            new Set([cast[1].id]), 1);
        expect(hits.map(e => e.name)).toEqual(['Guildmaster Halric Vance']);
    });
});

describe('findExactKeywordLore (v1.27)', () => {
    const lore = [
        { id: 'l1', keyword: 'The Sundering', content: 'The cataclysm that split the realm.', timestamp: '' },
        { id: 'l2', keyword: 'Ash', content: 'too-short keyword must not match', timestamp: '' },
    ];

    it('force-injects lore on an exact keyword hit, bypassing similarity', () => {
        const hits = findExactKeywordLore('I ask the priest about the sundering.', lore, new Set(), 3);
        expect(hits.map(l => l.id)).toEqual(['l1']);
    });

    it('skips short keywords and already-retrieved entries', () => {
        expect(findExactKeywordLore('ash falls', lore, new Set(), 3)).toEqual([]);
        expect(findExactKeywordLore('the sundering', lore, new Set(['l1']), 3)).toEqual([]);
    });
});

describe('world roster + lore index (v1.27, cache-stable)', () => {
    it('lists every living NPC sorted, excludes the dead, and is state-free', () => {
        const roster = buildWorldRoster([
            mk({ name: 'Zeph', role: 'smuggler', status: 'missing' }),
            mk({ name: 'Aster Verancourt', role: 'countess', status: 'present' }),
            mk({ name: 'Old Maren', role: 'herbalist', status: 'dead' }),
        ]);
        expect(roster).toContain('Aster Verancourt (countess); Zeph (smuggler)');
        expect(roster).not.toContain('Maren');
        expect(roster).not.toContain('missing');   // no per-turn state → byte-stable
    });

    it('renders sorted lore keywords only', () => {
        const idx = buildLoreTopicIndex([
            { id: 'l1', keyword: 'Verancourt Succession', content: 'secret', timestamp: '' },
            { id: 'l2', keyword: 'The Sundering', content: 'secret', timestamp: '' },
        ]);
        expect(idx).toContain('The Sundering; Verancourt Succession');
        expect(idx).not.toContain('secret');
    });
});

// ────────────────────────────────────────────────────────────────────────────
// v1.27 Presence: first-name refresh without teleport
// ────────────────────────────────────────────────────────────────────────────
describe('updateEntityPresence (v1.27)', () => {
    it('refreshes lastSeenTurn on a first-name mention', () => {
        const [e] = updateEntityPresence(
            [mk({ name: 'Guildmaster Halric Vance', status: 'present', lastSeenTurn: 3 })],
            'Halric pours two ales and slides one over.', [], undefined, 9, 'the tavern', logs());
        expect(e.lastSeenTurn).toBe(9);
        expect(e.status).toBe('present');
    });

    it('does NOT teleport a distant NPC who is merely talked about', () => {
        const [e] = updateEntityPresence(
            [mk({ name: 'Lyrelle Verancourt', status: 'distant', location: 'the capital', lastSeenTurn: 2 })],
            'She thought of Lyrelle, far away in the capital.', [], undefined, 9, 'the tavern', logs());
        expect(e.lastSeenTurn).toBe(9);      // decay halted
        expect(e.status).toBe('distant');    // not promoted
        expect(e.location).toBe('the capital'); // not relocated
    });
});

// ────────────────────────────────────────────────────────────────────────────
// v1.27 Death detection tightening
// ────────────────────────────────────────────────────────────────────────────
describe('detectEntityDeaths (v1.27)', () => {
    it('no longer kills on proximity keywords ("corpse", bare "dead")', () => {
        const [e] = detectEntityDeaths(
            [mk({ name: 'Halric Vance' })],
            [mk({ name: 'Halric Vance', impression: 'shaken after finding the corpse, dead tired' })],
            'Halric stares at the corpse on the dock.', logs());
        expect(e.status).not.toBe('dead');
    });

    it('still kills on an explicit narrative statement, first-name included', () => {
        const [e] = detectEntityDeaths(
            [mk({ name: 'Guildmaster Halric Vance' })], undefined,
            'The mercenary killed Halric before anyone could move.', logs());
        expect(e.status).toBe('dead');
    });
});

describe('detectLoreDeaths (v1.27)', () => {
    it('no longer kills an NPC over an unrelated death phrase in the same entry', () => {
        const [e] = detectLoreDeaths(
            [mk({ name: 'Halric Vance' })],
            [{ keyword: 'Harbor War', content:
                'Halric brokered the truce that ended the Harbor War. ' +
                'x'.repeat(150) +
                ' Hundreds perished when the eastern bridge fell in battle.' }],
            logs());
        expect(e.status).not.toBe('dead');
    });

    it('kills when the death phrase sits next to the name', () => {
        const [e] = detectLoreDeaths(
            [mk({ name: 'Halric Vance' })],
            [{ keyword: 'Harbor War', content: 'Halric was killed by the tide-cult in the third winter.' }],
            logs());
        expect(e.status).toBe('dead');
    });

    it('canonical NPCs never die on keyword-only inference', () => {
        const [e] = detectLoreDeaths(
            [mk({ name: 'Halric Vance', canonical: true })],
            [{ keyword: 'Halric', content: 'Many perished in the riots that followed.' }],
            logs());
        expect(e.status).not.toBe('dead');
    });
});
