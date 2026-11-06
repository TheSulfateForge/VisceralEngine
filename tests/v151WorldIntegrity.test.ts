// v1.51 — off-screen presence, location sync, time floors, tic tracker, voice lock
// grounding. Fixtures are from the 2026-11-06 Ryan Westcross saves (deepseek-v4.1-flash).
import { describe, it, expect } from 'vitest';
import {
    updateEntityPresence,
    applyStatusTransitions,
    isRemoteAction,
    isDepartureAction,
} from '../utils/engine/entityLifecycle';
import { syncEntityLocationsFromWorldTick, extractActionLocation } from '../utils/engine/npcCoherence';
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

// Cases lifted from the 2026-11-06 Ryan Westcross saves.
describe('v1.51 presence — off-screen actors stay where they are', () => {
    const HALL = 'Westcross Townhouse, Great Hall';

    it('Vesna acting ~90 mi away is NOT placed in the Great Hall', () => {
        const [e] = updateEntityPresence(
            [mk({ name: 'Vesna Kamenova', status: 'distant', location: 'Kamenova Hold' })],
            'Iskra set the letter down.',
            [{ npc_name: 'Vesna Kamenova', action: 'At Kamenova Hold, sent a sealed inquiry to her assayers (~90 mi from Caerveld).', player_visible: false }],
            undefined, 12, HALL, logs(), HALL);
        expect(e.status).toBe('distant');
        expect(e.location).toBe('Kamenova Hold');
        expect(e.lastSeenTurn).toBe(12);
    });

    it('a player_visible action tagged with a distance is still remote', () => {
        const [e] = updateEntityPresence(
            [mk({ name: 'Cyran Fennara', status: 'distant', location: 'Rivergate warehouse' })],
            '',
            [{ npc_name: 'Cyran Fennara', action: 'His runner reached the townhouse door (~1 mi from the Great Hall).', player_visible: true }],
            undefined, 13, HALL, logs(), HALL);
        expect(e.status).toBe('distant');
    });

    it('a present NPC who acts off screen drops to nearby (Iskra at the ledger while Ryan is at the tailor)', () => {
        const SHOP = "Nesta Mercer's Tailor Shop, Threadneedle Street";
        const [e] = updateEntityPresence(
            [mk({ name: 'Iskra Renne', status: 'present', location: SHOP })],
            'Nesta did not turn around.',
            [{ npc_name: 'Iskra Renne', action: 'Returns to the household ledger after seeing Ryan out.', player_visible: false }],
            undefined, 6, SHOP, logs(), SHOP);
        expect(e.status).toBe('nearby');
        expect(e.location).not.toBe(SHOP);
    });

    it('a visible departure takes the NPC out of the room (Clara walking home)', () => {
        const [e] = updateEntityPresence(
            [mk({ name: 'Clara Lorrimer', status: 'present', location: HALL })],
            'And then she was gone.',
            [{ npc_name: 'Clara Lorrimer', action: 'Left the Westcross Townhouse and walked back toward the Academy.', player_visible: true }],
            undefined, 20, HALL, logs(), HALL);
        expect(e.status).toBe('nearby');
    });

    it('an on-screen speaker is present with the player', () => {
        const [e] = updateEntityPresence(
            [mk({ name: 'Maela Fennara', status: 'distant', location: 'Rivergate' })],
            'Maela smiled.',
            [{ npc_name: 'Maela Fennara', action: 'Took the negotiation from her brother.', player_visible: true }],
            undefined, 12, HALL, logs(), HALL);
        expect(e.status).toBe('present');
        expect(e.location).toBe(HALL);
    });

    it('a bare mention does not carry a present NPC when the player moves', () => {
        const SHOP = 'Silver Thimble';
        let ents = updateEntityPresence(
            [mk({ name: 'Iskra Renne', status: 'present', location: 'Westcross Townhouse' })],
            'I thought about what Iskra had said.',
            [], undefined, 5, SHOP, logs(), 'Westcross Townhouse');
        expect(ents[0].location).toBe('Westcross Townhouse');
        ents = applyStatusTransitions(ents, 5, SHOP, 'Westcross Townhouse', [], logs());
        expect(ents[0].status).toBe('nearby');
    });

    it('a companion who acts on screen moves with the player', () => {
        const ANTLER = 'The Gilded Antler';
        let ents = updateEntityPresence(
            [mk({ name: 'Iskra Renne', status: 'present', location: 'Westcross Townhouse' })],
            'Iskra sat across from me in the carriage.',
            [{ npc_name: 'Iskra Renne', action: 'Rides with Ryan and tells him the rules of the evening.', player_visible: true }],
            undefined, 24, ANTLER, logs(), 'Westcross Townhouse');
        ents = applyStatusTransitions(ents, 24, ANTLER, 'Westcross Townhouse', [], logs());
        expect(ents[0].status).toBe('present');
        expect(ents[0].location).toBe(ANTLER);
    });

    it('helpers', () => {
        expect(isRemoteAction('At the Rivergate warehouse, laid out the manifest.', HALL)).toBe(true);
        expect(isRemoteAction('At the Westcross Townhouse, refilled the pot.', HALL)).toBe(false);
        expect(isRemoteAction('Refilled the teapot.', HALL)).toBe(false);
        expect(isDepartureAction('Left the Great Hall with her brother.')).toBe(true);
        expect(isDepartureAction('Corrected her own framing.')).toBe(false);
    });
});

describe('v1.51 location sync — no more "th-AT the Duke has accepted"', () => {
    const cast = [
        mk({ name: 'Lirien Verancourt', location: 'Verancourt townhouse' }),
        mk({ name: 'Nesta Mercer', location: 'Silver Thimble' }),
        mk({ name: 'Iskra Renne', location: 'Westcross Townhouse' }),
        mk({ name: 'Clara Lorrimer', location: 'Lorrimer Academy' }),
        mk({ name: 'Vesna Kamenova', location: 'Caerveld' }),
    ];
    const run = (name: string, action: string) =>
        syncEntityLocationsFromWorldTick(cast, [{ npc_name: name, action, player_visible: false }], '', logs(), 'Ryan Westcross')
            .find(e => e.name === name)!.location;

    it('ignores mid-sentence capitalised words that are not places', () => {
        expect(run('Lirien Verancourt', 'Sends a short follow-up note to each of the six women and adds a line that the Duke has accepted.')).toBe('Verancourt townhouse');
        expect(run('Iskra Renne', 'Closes the planning and flags the one risk in Ryan handling the lamps without telling the steward.')).toBe('Westcross Townhouse');
        expect(run('Nesta Mercer', "Speaks plainly about her daughter Moira's contract in the Greenglass Marches and her own decision not to write.")).toBe('Silver Thimble');
    });

    it('takes leading locatives and movement destinations', () => {
        expect(run('Vesna Kamenova', 'At Kamenova Hold (~90 mi), locked the tally books in her strongroom.')).toBe('Kamenova Hold');
        expect(run('Clara Lorrimer', 'Walked from the Lorrimer Academy to the Westcross Townhouse and had a card carried up.')).toBe('Westcross Townhouse');
    });

    it('extractActionLocation returns null for non-located actions', () => {
        expect(extractActionLocation('Returns to the household ledger.', cast)).toBeNull();
        expect(extractActionLocation('Arrived at the Duke of Westcross.', cast, 'Ryan Westcross')).toBeNull();
    });
});

// ────────────────────────────────────────────────────────────────────────────
// v1.51 time floor
// ────────────────────────────────────────────────────────────────────────────
import { estimateTimeFloor, countSpokenWords, calculateTimeDelta } from '../utils/engine/timeUtils';

describe('v1.51 time floor', () => {
    const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');

    it('counts quoted speech and italic text read aloud', () => {
        expect(countSpokenWords(`She said, "${words(10)}" and then *${words(5)}*.`)).toBe(15);
        expect(countSpokenWords(`“${words(4)},” he said.`)).toBe(4);
    });

    it('a 750-word conversation is at least 5 minutes', () => {
        const f = estimateTimeFloor(`"${words(750)}"`, 'I listen.', undefined, 'Hall');
        expect(f.floor).toBe(5);
    });

    it('the long-route walk home is at least 30 minutes (was +1m)', () => {
        const f = estimateTimeFloor(
            'I came out of Threadneedle and did not turn toward the townhouse.',
            'I walk back to my townhouse taking my time and taking the long route',
            { location_name: 'Westcross Townhouse', traveled_from: 'Threadneedle Street' },
            'Silver Thimble, Threadneedle Street');
        expect(f.floor).toBe(30);
    });

    it('a carriage ride counts as travel; staying put does not', () => {
        expect(estimateTimeFloor('', 'Iskra and I ride in my carriage to the gilded antler',
            { location_name: 'The Gilded Antler' }, 'Westcross Townhouse').floor).toBe(15);
        expect(estimateTimeFloor('', 'I walk to the window',
            undefined, 'Westcross Townhouse').floor).toBe(0);
    });

    it('the model\'s own travel_time_minutes is honoured', () => {
        expect(estimateTimeFloor('', 'We go.', { location_name: 'Wolfsmere', travel_time_minutes: 240 }, 'Caerveld').floor).toBe(240);
    });

    it('caps still apply after the floor', () => {
        expect(calculateTimeDelta(40, false, false, true).delta).toBe(15);   // SOCIAL cap
    });
});

// ────────────────────────────────────────────────────────────────────────────
// v1.51 tic tracker
// ────────────────────────────────────────────────────────────────────────────
import { findOverusedPhrases, buildOverusedPhrasesBlock } from '../utils/engine/ticTracker';

describe('v1.51 tic tracker', () => {
    const turns = [
        'Iskra turned her cup a quarter turn. "That\'s the whole of it," she said.',
        'Maela turned her cup a quarter turn on the table. "Market day."',
        '"That\'s the whole of it, and I\'ll see myself out," Clara said. She turned her cup a quarter turn.',
        '"I would rather be refused by a man who looked at me than accepted by one who read a page."',
    ];

    it('flags gestures and catchphrases recurring across turns', () => {
        const found = findOverusedPhrases(turns, ['Iskra Renne', 'Maela Fennara', 'Clara Lorrimer']);
        const text = found.map(f => f.phrase).join(' | ');
        expect(text).toMatch(/quarter turn/);
        expect(text).toMatch(/whole of it/);
    });

    it('needs at least three turns and real recurrence', () => {
        expect(findOverusedPhrases(turns.slice(0, 2))).toEqual([]);
        expect(findOverusedPhrases(['a b c', 'd e f', 'g h i'])).toEqual([]);
    });

    it('excludes names', () => {
        const t = ['Lady Nicola Blackmoor wrote.', 'Lady Nicola Blackmoor wrote.', 'Lady Nicola Blackmoor wrote.'];
        expect(findOverusedPhrases(t, ['Lady Nicola Blackmoor'])).toEqual([]);
    });

    it('renders a block only when there is something to say', () => {
        expect(buildOverusedPhrasesBlock([], 10)).toBe('');
        expect(buildOverusedPhrasesBlock([{ phrase: 'x y z w', turns: 3 }], 10)).toContain('[OVERUSED PHRASES');
    });
});

// ────────────────────────────────────────────────────────────────────────────
// v1.51 voice lock reads the player's sheet
// ────────────────────────────────────────────────────────────────────────────
import { checkRestatement, playerSheetLines, playerSheetLinesAbout } from '../utils/engine/voiceLockCheck';

describe('v1.51 voice lock grounding', () => {
    const iskra = mk({
        name: 'Iskra Renne',
        role: 'Independent trade negotiator and broker',
        personality: 'Performed Surface: Warm, flattering, effortlessly likable. Actual Core: counts every coin.',
    });
    const sheet = playerSheetLines({
        relationships: ['Iskra Renne - House Steward, friend, and frequent romantic sexual partner.'],
        backstory: 'Restored the Swordfields. Unrelated sentence about Hesta.',
    });

    it('selects only sheet lines naming the NPC', () => {
        expect(playerSheetLinesAbout('Iskra Renne', sheet)).toHaveLength(1);
    });

    it('"steward" and "friend" are grounded by the player sheet', () => {
        const r = { name: 'Iskra Renne', traits: ['steward', 'friend', 'warm'], raw: '' };
        expect(checkRestatement(r as never, iskra, sheet)?.ungrounded ?? []).toEqual([]);
        expect(checkRestatement(r as never, iskra)?.ungrounded).toEqual(['steward', 'friend']);
    });
});
