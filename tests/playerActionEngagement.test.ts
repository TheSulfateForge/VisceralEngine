import { describe, it, expect } from 'vitest';
import {
    checkPlayerActionEngagement,
    buildPlayerActionReminder,
    MIN_NEW_WORDS,
} from '../utils/engine/playerActionCheck';
import { updateSceneLedger, buildSceneLedgerBlock } from '../utils/engine/sceneContinuity';

// ---------------------------------------------------------------------------
// v1.45 regression suite.
//
// Fixtures are the verbatim turns from the 2026-09-19 saves
// (visceral_backup_ryan_westcross_2026_09_19*.json) where the engine answered
// the wrong turn. Each one is the shape the player reported: the model writes
// a competent beat that has nothing to do with what was just typed, and the
// content surfaces one to three turns later.
// ---------------------------------------------------------------------------

// Save _1, h31 — the player proposes. h32 never answers; Anwen "repeats" his
// h29 line and the NPC he just disengaged from still has hold of his arm.
const PROPOSAL_INPUT = `I gently remove my arm from Lirien's grasp and lean slightly toward Anwen, keeping my eyes on hers.
"Princess Anwen Drevast, will you marry me?"
I pause, then add quietly, "Will you become Anwen Westcross, Duchess of Westcross, and stand beside me as my equal in all things?"`;

const PROPOSAL_PREV_INPUT = `I hold Anwen's gaze. "No. I don't need you to keep the wolves away. I already know you're capable of it."
"I don't want to cage you, cull you, or direct your life. I want a woman who chooses to stand beside me."`;

const PROPOSAL_PREV_NARRATIVE = `Anwen doesn't blink at my rejection of the 'cage,' nor does the crystal-blue calm of her gaze falter. 'A partner, then,' she says. Beside me, Lirien's grip on my forearm remains firm.`;

// The turn that actually shipped: it answers the PREVIOUS turn.
const PROPOSAL_NARRATIVE_BAD = `Anwen does not look away, nor does she reach for the performative mask of the Princess. 'A life built beside someone,' she repeats, her voice low, steady. 'Not behind. Not beneath. You are asking for a partnership of two people who both understand the weight of a throne.' Beside me, Lirien's hand remains on my forearm, her fingers digging in with a sharp, possessive pressure.`;

// What answering the player looks like.
const PROPOSAL_NARRATIVE_GOOD = `Anwen's eyes hold his as he lifts his arm free of Lirien's grasp. 'Yes,' she says. 'I will marry you, Ryan Westcross. I will become Anwen Westcross, Duchess of Westcross, and I will stand beside you as your equal in all things — and I will hold you to every word of it.'`;

describe('checkPlayerActionEngagement', () => {
    it('flags the turn that answered the previous message (save _1, h31→h32)', () => {
        const f = checkPlayerActionEngagement(
            PROPOSAL_INPUT,
            PROPOSAL_NARRATIVE_BAD,
            PROPOSAL_PREV_INPUT,
            PROPOSAL_PREV_NARRATIVE,
        );
        expect(f.measurable).toBe(true);
        expect(f.engaged).toBe(false);
        expect(f.sample.length).toBeGreaterThan(0);
    });

    it('passes a turn that answers what the player actually did', () => {
        const f = checkPlayerActionEngagement(
            PROPOSAL_INPUT,
            PROPOSAL_NARRATIVE_GOOD,
            PROPOSAL_PREV_INPUT,
            PROPOSAL_PREV_NARRATIVE,
        );
        expect(f.engaged).toBe(true);
        expect(f.matched).toBeGreaterThan(1);
    });

    it('does not count vocabulary the player carried over from the last beat', () => {
        // Every significant word here is already in the previous input and the
        // previous narrative, so the turn is unmeasurable rather than failing.
        const f = checkPlayerActionEngagement(
            'I want a woman who chooses to stand beside me, not behind me.',
            'The room is quiet. Someone coughs.',
            PROPOSAL_PREV_INPUT,
            PROPOSAL_PREV_NARRATIVE,
        );
        expect(f.measurable).toBe(false);
        expect(f.engaged).toBe(true);
    });

    it('skips inputs too short to judge rather than burning a resample', () => {
        expect(checkPlayerActionEngagement('I nod.', 'A long unrelated paragraph.').measurable).toBe(false);
        expect(checkPlayerActionEngagement('', 'anything').measurable).toBe(false);
        expect(checkPlayerActionEngagement('anything', '').measurable).toBe(false);
    });

    it('needs MIN_NEW_WORDS of genuinely new vocabulary before it will judge', () => {
        const input = Array.from({ length: MIN_NEW_WORDS - 1 }, (_, i) => `wordnumber${i}`).join(' ');
        expect(checkPlayerActionEngagement(input, 'unrelated prose entirely').measurable).toBe(false);
    });

    it('quotes the player back in the resample reminder', () => {
        const reminder = buildPlayerActionReminder(PROPOSAL_INPUT);
        expect(reminder).toContain('will you marry me?');
        expect(reminder).toContain('YOU ANSWERED THE WRONG TURN');
    });
});

// ---------------------------------------------------------------------------
// Ledger grounding. Save _1's ledger carried, at turn 13,
//   "Ryan formally proposed marriage to Anwen Drevast, bypassing the Verancourts."
// The player proposed on turn 14, into a block that says the ground is covered.
// ---------------------------------------------------------------------------

let seq = 0;
const ids = () => `pa_${seq++}`;

describe('scene ledger — player-beat grounding (v1.45)', () => {
    const ANTICIPATED = 'Ryan formally proposed marriage to Anwen Drevast, bypassing the Verancourts.';

    it('drops a player-subject beat the player has not played', () => {
        const rejected: string[] = [];
        const r = updateSceneLedger([], [], [ANTICIPATED], 13, false, ids, {
            playerName: 'Ryan Westcross',
            playerInput: PROPOSAL_PREV_INPUT,
            onRejected: (b) => rejected.push(b),
        });
        expect(r.added).toBe(0);
        expect(rejected).toHaveLength(1);
    });

    it('keeps a player-subject beat the player did play', () => {
        const r = updateSceneLedger([], [], [ANTICIPATED], 14, false, ids, {
            playerName: 'Ryan Westcross',
            playerInput: PROPOSAL_INPUT,
        });
        expect(r.added).toBe(1);
    });

    it('leaves NPC beats alone — the model owns its own cast', () => {
        const r = updateSceneLedger([], [], ['Anwen Drevast set her goblet down and waited.'], 14, false, ids, {
            playerName: 'Ryan Westcross',
            playerInput: 'I say nothing at all about goblets or waiting or anything else.',
        });
        expect(r.added).toBe(1);
    });

    it('accepts everything when no player input is supplied (legacy callers)', () => {
        const r = updateSceneLedger([], [], [ANTICIPATED], 13, false, ids);
        expect(r.added).toBe(1);
    });
});

describe('buildSceneLedgerBlock — the player action outranks the ledger (v1.45)', () => {
    const ledger = [
        { id: 'a', beat: ANTICIPATED_BEAT(), turn: 13, source: 'model' as const },
        { id: 'b', beat: 'Lirien Verancourt: Kept a possessive grip on Ryan\'s forearm.', turn: 13, source: 'npc' as const },
    ];
    function ANTICIPATED_BEAT() {
        return 'Ryan formally proposed marriage to Anwen Drevast, bypassing the Verancourts.';
    }

    it('hides the beat the player is playing right now', () => {
        const block = buildSceneLedgerBlock(ledger, PROPOSAL_INPUT);
        expect(block).not.toContain('formally proposed marriage');
        expect(block).toContain('possessive grip');
    });

    it('lists everything when the player is doing something else', () => {
        const block = buildSceneLedgerBlock(ledger, 'I walk to the window and look out over the courtyard.');
        expect(block).toContain('formally proposed marriage');
    });

    it('still says the player action outranks it', () => {
        expect(buildSceneLedgerBlock(ledger)).toContain('does NOT outrank [PLAYER ACTION]');
    });

    it('returns empty when suppression empties the list', () => {
        const single = [{ id: 'a', beat: ANTICIPATED_BEAT(), turn: 13, source: 'model' as const }];
        expect(buildSceneLedgerBlock(single, PROPOSAL_INPUT)).toBe('');
    });
});
