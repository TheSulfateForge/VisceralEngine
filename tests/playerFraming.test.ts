import { describe, it, expect } from 'vitest';
import {
    detectPlayerFraming,
    containsMatureContent,
    physicalContactLevel,
    levelIndex,
} from '../utils/engine/playerFraming';
import { getSectionReminders } from '../sectionReminders';

/**
 * v1.29 regression suite.
 *
 * Cases are taken verbatim from the reported save (Ryan Bloodfeather, T16) —
 * a single calm SOCIAL scene at tension 10 in which an offhand remark about
 * courier working conditions was inflated, across five turns and two explicit
 * player corrections, into the player being "the most dangerous person in the
 * room", while NPC-initiated physical contact ratcheted from a hovering hand
 * to a knee pressed firm without a single reciprocating gesture.
 */

describe('v1.29 — mature-content detection must not fire on proper nouns', () => {
    const NAMES = ['Ryan Bloodfeather', 'Anwen Drevast', 'Marigold Underhill'];

    it('does not treat the PC surname "Bloodfeather" as mature content', () => {
        // The exact string every one of the 16 model turns contained.
        expect(containsMatureContent("'It is a quiet evening, Master Bloodfeather,' she says.", NAMES)).toBe(false);
        expect(containsMatureContent('Ryan Bloodfeather sits on the bench.', NAMES)).toBe(false);
    });

    it('does not fire on other name-shaped false positives', () => {
        for (const s of [
            'Lord Bloodworth bowed.',
            'Killian poured the tea.',
            'Severin adjusted his cuffs.',
            'She met Gutmann at the market.',
        ]) {
            expect(containsMatureContent(s, ['Lord Bloodworth', 'Killian', 'Severin', 'Gutmann']), s).toBe(false);
        }
    });

    it('still detects genuine mature content', () => {
        expect(containsMatureContent('Blood sheets down his forearm.', NAMES)).toBe(true);
        expect(containsMatureContent('The wound will not close.', NAMES)).toBe(true);
        expect(containsMatureContent('She was naked beneath the linen.', NAMES)).toBe(true);
        expect(containsMatureContent('He is bleeding badly.', NAMES)).toBe(true);
    });

    it('detects mature content even when a name is nearby', () => {
        expect(
            containsMatureContent('Bloodfeather stared at the wound in his side.', NAMES),
        ).toBe(true);
    });
});

describe('v1.29 — player correction detection', () => {
    // The player's actual words from turns 27 and 29 of the save.
    const T27 = `I raise an eyebrow over the rim of my coffee, more amused than offended.
"Princess, I think you've gotten about three steps ahead of me there. I said if I were in a position to make policy. I'm not planning to force the watch to do anything."`;
    const T29 = `I stare at her for a second, then chuckle into my coffee.
"Princess, you're doing it again."
I shake my head, still amused rather than irritated.
"I'm not an agitator for policy or practice, and I certainly don't think I'm the only man in Caerveld looking at things properly."`;

    it('catches both corrections the player actually made', () => {
        expect(detectPlayerFraming(T27).corrected).toBe(true);
        expect(detectPlayerFraming(T29).corrected).toBe(true);
    });

    it('does not fire on ordinary conversation', () => {
        const ordinary = `I grin. "A bit of all of it honestly. It is good defensible ground with clear sightlines. I do genuinely like the peace."`;
        expect(detectPlayerFraming(ordinary).corrected).toBe(false);
    });

    it('does not fire on an opinion that merely disagrees about the world', () => {
        const opinion = `"The taxes, I suppose. The nobility contributes less than the fishmongers do. That seems backwards to me."`;
        expect(detectPlayerFraming(opinion).corrected).toBe(false);
    });
});

describe('v1.29 — reciprocation requires the player to be the actor', () => {
    it('does not count the NPC touching the player as reciprocation', () => {
        expect(detectPlayerFraming('She rests her hand on my forearm.').reciprocated).toBe(false);
        expect(detectPlayerFraming('Her knee presses against mine.').reciprocated).toBe(false);
    });

    it('does not count mere politeness or continued conversation', () => {
        expect(detectPlayerFraming('I nod and take another drink of coffee.').reciprocated).toBe(false);
        expect(detectPlayerFraming('"Perhaps," I say, letting the silence linger.').reciprocated).toBe(false);
    });

    it('counts an actual player-initiated gesture', () => {
        expect(detectPlayerFraming('I take her hand.').reciprocated).toBe(true);
        expect(detectPlayerFraming('I lean in closer.').reciprocated).toBe(true);
        expect(detectPlayerFraming('I rest my hand on her shoulder.').reciprocated).toBe(true);
    });

    it('detects deflection', () => {
        expect(detectPlayerFraming('I pull back and change the subject.').deflected).toBe(true);
        expect(detectPlayerFraming('I lean away, putting some distance between us.').deflected).toBe(true);
    });
});

describe('v1.29 — physical contact ladder tracks the save\'s escalation', () => {
    // The five NPC narratives in order, abbreviated to the contact clause.
    const BEATS: [string, string][] = [
        ['T24', 'She reaches out, her hand hovering for a second before she rests it lightly on your forearm.'],
        ['T26', 'She leans closer, the scent of her skin drifting across the narrow gap between you.'],
        ['T30', 'Her knee brushes the rough fabric of your trousers—a contact that is deliberate.'],
        ['T32', 'She shifts, her knee pressing firm against yours, a grounding, steady point of contact.'],
    ];

    it('reads a contact level from every beat that had one', () => {
        for (const [label, text] of BEATS) {
            expect(physicalContactLevel(text), label).not.toBe('none');
        }
    });

    it('reads none from a beat with no physical contact', () => {
        expect(physicalContactLevel('She looks out at the park, watching the squirrels in the oak branches.')).toBe('none');
    });

    it('orders the ladder correctly', () => {
        expect(levelIndex('proximity')).toBeLessThan(levelIndex('incidental'));
        expect(levelIndex('incidental')).toBeLessThan(levelIndex('sustained'));
        expect(levelIndex('sustained')).toBeLessThan(levelIndex('intimate'));
    });
});

/**
 * getSectionReminders for a calm SOCIAL beat at tension 10, with the four
 * v1.29 player-framing arguments supplied per case.
 */
const remindersFor = (
    corrected: boolean,
    markers: string[],
    reciprocated: boolean,
    contactLevel: string,
    turnCount = 16,
    canonicalPersonality = true,
) => getSectionReminders(
    turnCount, 'SOCIAL', 0, turnCount,
    9, 44, 2, 0,
    false,
    false, false, false,
    false,
    10,
    canonicalPersonality,
    [], [],
    corrected, markers, reciprocated, contactLevel,
);

describe('v1.29 — reminder selection responds to player pushback', () => {
    it('fires the correction protocol and proportionality when the player pushes back', () => {
        const out = remindersFor(true, ["you're doing it again"], false, 'incidental');
        expect(out.join('\n')).toContain('THE PLAYER JUST CORRECTED YOU');
        expect(out.join('\n')).toContain('PROPORTIONALITY');
        expect(out.join('\n')).toContain("you're doing it again");
    });

    it('fires the physical gate when contact is live and unreciprocated', () => {
        const out = remindersFor(false, [], false, 'incidental');
        const joined = out.join('\n');
        expect(joined).toContain('ADVANCE ONLY ON RECIPROCATION');
        expect(joined).toContain('[CONTACT LEVEL] incidental');
    });

    it('does not fire the physical gate once the player reciprocates', () => {
        const out = remindersFor(false, [], true, 'incidental');
        expect(out.join('\n')).not.toContain('ADVANCE ONLY ON RECIPROCATION');
    });

    it('does not fire the physical gate when there is no contact', () => {
        const out = remindersFor(false, [], false, 'none');
        expect(out.join('\n')).not.toContain('ADVANCE ONLY ON RECIPROCATION');
    });

    it('surfaces proportionality on calm social beats even with no correction', () => {
        // turnCount 15 is divisible by 3 → the calm-social cadence fires.
        const out = remindersFor(false, [], false, 'none', 15, false);
        expect(out.join('\n')).toContain('PROPORTIONALITY');
    });
});

describe('v1.29 — canonical voice lock no longer demands an invented trigger', () => {
    it('tells the model not to invent a trigger condition', () => {
        const out = remindersFor(false, [], false, 'none');
        const lock = out.find(r => r.includes('CANONICAL VOICE LOCK'));
        expect(lock).toBeDefined();
        expect(lock!).toContain('DO NOT INVENT A TRIGGER');
        expect(lock!).toContain('If no trigger is written down, there is no');
    });
});
