import { describe, it, expect } from 'vitest';
import {
    mergeLedger, identifyingNames, fileWitnessedFacts, selectLedgerForPrompt, selectWitnessedForPrompt,
    LEDGER_MAX,
} from '../utils/engine/npcMemory';
import { inferTransitArrival, inferLocationMove } from '../utils/engine/locationGraph';
import { buildEntityContext } from '../utils/promptUtils';
import { MODEL_CONTEXT_PROFILES as CONTEXT_PROFILES } from '../config/engineConfig';
import type { KnownEntity, LocationGraph, MemoryItem } from '../types';

const mem = (fact: string, i = 0): MemoryItem => ({ id: `m${i}`, fact, timestamp: '', salience: 3, turnCreated: i } as MemoryItem);
const ent = (name: string, extra: Partial<KnownEntity> = {}): KnownEntity => ({
    id: name, name, role: 'noble', location: 'Calder Townhouse', impression: '', relationship_level: 'WARM',
    leverage: '', ledger: [], status: 'present', lastSeenTurn: 68, ...extra,
} as KnownEntity);

describe('v1.58 — ledgers extend, never replace', () => {
    it('the model sends only the latest beats; the old ones stay', () => {
        const court = ['Stood with Ryan before the court and demanded the bride price.', 'Backed Ryan when he refused the Crown\'s purse.'];
        const later = ['Decided to ride in the carriage.', 'Warned Ryan that Mirabel will push the good wine.'];
        expect(mergeLedger(court, later)).toEqual([...court, ...later]);
    });
    it('a restatement replaces the older wording and moves to the end', () => {
        const out = mergeLedger(['Warned Ryan Mirabel pushes the good wine before food.', 'Rode in the carriage.'],
            ['Warned Ryan that Mirabel will push the good wine before the food.']);
        expect(out).toEqual(['Rode in the carriage.', 'Warned Ryan that Mirabel will push the good wine before the food.']);
    });
    it('caps at LEDGER_MAX, dropping the oldest; blanks ignored', () => {
        const many = Array.from({ length: 30 }, (_, i) => `${'abcdefghijklmnopqrstuvwxyzABCD'[i]}alpha${i} beta${i} gamma${i}`);
        const out = mergeLedger([], [...many, '', '  ']);
        expect(out.length).toBe(LEDGER_MAX);
        expect(out[out.length - 1]).toBe(many[29]);
        expect(mergeLedger(['a kept entry here'], undefined)).toEqual(['a kept entry here']);
    });
});

describe('v1.58 — story facts filed on the NPCs they name', () => {
    it('identifying names: the given name, never a shared surname or title', () => {
        expect(identifyingNames('Lord Prosper Calder (Patriarch of House Calder)')).toEqual(['Prosper']);
        expect(identifyingNames('Liora Calder (Duchess Westcross)')).toEqual(['Liora']);
        expect(identifyingNames('Lady Mirabel Calder')).toEqual(['Mirabel']);
    });
    it('back-fills an older save once from the whole store (Prosper gets the court)', () => {
        const all = [
            mem("Prosper Calder approved of Ryan's public complaint and refusal of the Crown's purse, and the Calder townhouse will host a feast.", 1),
            mem('Lord Prosper Calder publicly accepted the marriage before the court, though his look at Ryan was a measuring one.', 2),
            mem('Liora undressed for Ryan and stood naked in the light.', 3),
            mem('House Calder was not consulted.', 4),
        ];
        const { entities, filed } = fileWitnessedFacts([ent('Lord Prosper Calder (Patriarch of House Calder)'), ent('Liora Calder (Duchess Westcross)'), ent('Lady Mirabel Calder')], [], all);
        expect(entities[0].witnessed).toHaveLength(2);
        expect(entities[1].witnessed).toEqual([all[2].fact]);
        expect(entities[2].witnessed).toEqual([]); // nothing names her; field set so no re-scan
        expect(filed.map(f => f.name)).toEqual(['Lord Prosper Calder (Patriarch of House Calder)', 'Liora Calder (Duchess Westcross)']);
    });
    it('after the back-fill only this turn\'s facts are added', () => {
        const e = ent('Lady Mirabel Calder', { witnessed: [] });
        const { entities } = fileWitnessedFacts([e], [mem('Mirabel took Ryan into her counting-room and asked what he made of her daughter.')], [mem('old fact naming Mirabel')]);
        expect(entities[0].witnessed).toEqual(['Mirabel took Ryan into her counting-room and asked what he made of her daughter.']);
    });
});

describe('v1.58 — prompt selection', () => {
    const ledger = Array.from({ length: 12 }, (_, i) => `Beat ${i}: ordinary thing ${i}`);
    ledger[1] = 'Beat 1: stood with Ryan at court over the bride price';
    it('ledger: last 5 plus older entries the turn touches, in order', () => {
        const out = selectLedgerForPrompt(ledger, 'What did you think of the bride price at court?');
        expect(out).toContain(ledger[1]);
        expect(out.slice(-5)).toEqual(ledger.slice(-5));
        expect(out.length).toBeLessThanOrEqual(8);
    });
    it('witnessed: relevant first, capped at 5', () => {
        const w = Array.from({ length: 9 }, (_, i) => `Fact ${i} about the stables`);
        w[0] = 'Prosper backed Ryan before the court';
        const out = selectWitnessedForPrompt(w, 'the court');
        expect(out).toContain(w[0]);
        expect(out.length).toBe(5);
    });
    it('the in-scene entity block carries what the NPC has been part of', () => {
        const ctx = buildEntityContext([ent('Lord Prosper Calder', { witnessed: ['Prosper backed Ryan before the court.'] })], new Set(), new Set(), 'I nod.');
        expect(ctx).toMatch(/Has been part of \(they remember this\): • Prosper backed Ryan before the court\./);
    });
});

describe('v1.58 — arriving somewhere while travelling', () => {
    const places = ['The Westcross Townhouse', 'Westcross Townhouse, Library', 'Calder Townhouse', 'Calder Townhouse, Noble Quarter', 'Sablebrook Manor', 'Drevast Palace'];
    const T128 = 'The carriage came off the long straight and turned onto the Calder approach, and the gravel under the wheels changed the sound of the whole ride. Through the window I could see the house up ahead with its lamps lit along the front walk.';
    it('the reported turn: "the Calder approach" → Calder Townhouse', () => {
        const m = inferTransitArrival(places, T128, 'I wait for Liora to parse what I have said', 'Westcross Townhouse, Library');
        expect(m?.location_name).toBe('Calder Townhouse');
        expect(m?.travelled).toBe(true);
    });
    it('no travel, no move: naming Liora Calder at home changes nothing', () => {
        expect(inferTransitArrival(places, 'Liora Calder came down the steps of the library.', 'I nod.', 'Westcross Townhouse, Library')).toBeNull();
    });
    it('a surname without a place word is not an arrival', () => {
        expect(inferTransitArrival(places, 'In the carriage, Liora Calder looked at me.', 'I sit.', 'Westcross Townhouse, Library')).toBeNull();
    });
    it('not where you already are', () => {
        expect(inferTransitArrival(places, 'The carriage pulled up at the Westcross gate.', '', 'Westcross Townhouse, Library')).toBeNull();
    });
    it('inferLocationMove reaches it', () => {
        const graph = { nodes: Object.fromEntries(places.map((p, i) => [String(i), { id: String(i), displayName: p }])), edges: [], playerLocationId: '1' } as unknown as LocationGraph;
        expect(inferLocationMove(graph, T128, 'I wait.', 'Westcross Townhouse, Library')?.location_name).toBe('Calder Townhouse');
    });
});

describe('v1.58 — DeepSeek history window', () => {
    it('50 messages, newest 20 in full', () => {
        expect(CONTEXT_PROFILES['deepseek/deepseek-v4.1-flash'].maxHistory).toBe(50);
        expect(CONTEXT_PROFILES['deepseek/deepseek-v4.1-flash'].recentFullMessages).toBe(20);
    });
});
