import { describe, it, expect } from 'vitest';
import {
    voiceSampleRejection,
    isDegenerateVoiceSample,
    detectRhetoricTics,
    isSelfEchoingClaim,
    isMaxim,
    isTwoHornQuestion,
    RHETORIC_TIC_THRESHOLD,
} from '../utils/engine/npcRhetoric';
import { detectPlayerFraming } from '../utils/engine/playerFraming';
import {
    ingestOocDirective,
    buildOocDirectivesBlock,
    OOC_DIRECTIVE_MAX,
} from '../utils/engine/sceneContinuity';
import { selectSectionReminders, makeReminderContext } from '../sectionReminders';

// ---------------------------------------------------------------------------
// Fixtures — verbatim from the two 2026-08-31 saves.
// ---------------------------------------------------------------------------

/** What the engine had actually filed as these characters' canonical voices. */
const MARIBEL_SAMPLE = 'If the tools are what you need, then they are what you shall have.';
const ELSPETH_SAMPLE = "You don't glide. You disappear.";

/** Elspeth, save A — the run of six consecutive figures. */
const ELSPETH_TURN_A = `Elspeth holds your gaze, the sketches pressed against her cloak. 'You think I listen well because I am desperate for a conversation,' she says, her voice low and devoid of the royal chime. 'But that isn't it. I listen because I have spent my entire life surrounded by people who speak in pre-arranged patterns.' She shifts her weight, mirroring your stance. 'If you want to show me how the mechanism works, start with the one thing you haven't explained: is that a challenge, or have you just forgotten how to play the game?'`;

const ELSPETH_TURN_B = `She reaches out, her hand trembling just a fraction as she touches your sleeve. 'You speak as if fear is a tool,' she murmurs, her voice low, raspy. 'Most people fear failing; you fear the shaking.' She lets out a soft, jagged breath. 'Tell me, Ryan — does it ever stop? Or do you just get better at lying to the rest of the world about it?'`;

/** Maribel/Pell, save B, turn 32 — the pigeonhole the player called out. */
const MARIBEL_TURN = `I work the lye-soap into my beard, the scent sharp and clean against the steam. Maribel remains motionless, her back to me. Pell stays close to the rim, her eyes tracking the movement of my hands as I scrub my hair. 'You think like a hunter,' Pell says, her voice a soft, vibrating hum. 'Always looking for the path, always measuring the distance. But in a steading, the distance is just what you walk.' Maribel turns her head slightly, the lantern light catching the curve of her horn. 'The work doesn't care if you're a witch or a traveler, Ryan,' she says, her tone calm and final. 'It only cares if you're present when it needs doing. You've proven that today. Don't go looking for more meaning than that.'`;

/** A clean turn from the same save — the seal repair, which was good. */
const CLEAN_TURN = `Maribel leaned against the cool stone wall of the cistern house, her hands resting comfortably on her hips. She watched you divest yourself of your cloak and gear. When you produced the tools — the small copper pan, the mortar, and the precise, worn nibs — she didn't lean in to inspect them. 'The smiths call it a tremor,' she said, her voice remaining low and steady. 'They think the stone is shifting under the weight of the water. I think it's just forgotten how to hold a steady pulse, but I've been told that's a farmer's logic, not a witch's.' She gestured toward the glowing glyphs at your feet. 'Do what you need to do, Ryan. The water won't stop flowing for an hour or two, and the herd is patient.'`;

/** The player's actual corrections. None matched the v1.29 pattern list. */
const CORRECTION_BATHHOUSE = `I pause with my hands still in my beard and give Maribel a sidelong look, more amused than bothered. "Maribel, you're getting awfully fond of deciding what I mean before I've decided it myself." I rinse the soap from my beard. "I asked because I was curious. I like understanding the people and places I find myself around. Doesn't mean I'm trying to turn every pleasant evening into some grand search for home, meaning, or whatever else you've decided I'm hunting for." A small grin tugs at my mouth. "Sometimes I'm just enjoying good company, asking questions, and seeing where the conversation goes. You don't have to fit me into a neat little box quite yet."`;

// ---------------------------------------------------------------------------
// M1 — voice-sample hygiene
// ---------------------------------------------------------------------------

describe('voiceSampleRejection — the samples the engine had actually captured', () => {
    it('rejects the tautology it filed as Maribel’s voice', () => {
        expect(voiceSampleRejection(MARIBEL_SAMPLE)).toBe('tautology');
    });

    it('rejects the assertion-about-the-player it filed as Elspeth’s voice', () => {
        expect(voiceSampleRejection(ELSPETH_SAMPLE)).toBe('about-the-player');
    });

    it('rejects a detached maxim', () => {
        expect(voiceSampleRejection('Maintenance is the price of water, and the herd knows it.')).toBe('maxim');
        expect(voiceSampleRejection('Caution is just another name for respect.')).toBe('maxim');
    });

    it('rejects a two-horn question', () => {
        expect(voiceSampleRejection('Is that a challenge, or have you just forgotten how to play the game?'))
            .toBe('two-horn-question');
    });

    it('rejects an explicit motive attribution', () => {
        expect(voiceSampleRejection('You think I listen because I am desperate for conversation.'))
            .toBe('about-the-player');
    });
});

describe('voiceSampleRejection — leaves real voices alone', () => {
    const good = [
        "Aye, and don't you go tracking that mud across my clean floor.",
        'Six coppers for the lot, and I’ll not haggle over it twice.',
        "The gate's been complaining for a week now, and grease hasn't touched it.",
        'If you’ve the ink and the patience for it, I’ve the coin and the room.',
        "If you're willing to set it, we're willing to give you the time.",
        'The forge will be cold by dawn, but we have heat left to beat the brass today.',
        "I've buried two husbands and a brother in that yard, and I still keep the ledger straight.",
        'Mind the third step, it gives.',
    ];

    for (const sample of good) {
        it(`keeps: ${sample.slice(0, 46)}…`, () => {
            expect(voiceSampleRejection(sample)).toBeNull();
        });
    }

    it('ignores empty and very short samples', () => {
        expect(voiceSampleRejection('')).toBeNull();
        expect(voiceSampleRejection(null)).toBeNull();
        expect(voiceSampleRejection('Aye, right enough.')).toBeNull();
    });

    it('does not mistake a statement about a named character for a maxim', () => {
        expect(voiceSampleRejection('Maribel is the only one who keeps that ledger honest.', ['Maribel Jessop']))
            .toBeNull();
    });

    it('isDegenerateVoiceSample agrees with voiceSampleRejection', () => {
        expect(isDegenerateVoiceSample(MARIBEL_SAMPLE)).toBe(true);
        expect(isDegenerateVoiceSample('Mind the third step, it gives.')).toBe(false);
    });
});

describe('component predicates', () => {
    it('isSelfEchoingClaim catches the circular constructions', () => {
        expect(isSelfEchoingClaim('If it needs to be remade, then it needs to be remade.')).toBe(true);
        expect(isSelfEchoingClaim('If the brass is set, the gate is set.')).toBe(true);
        expect(isSelfEchoingClaim(MARIBEL_SAMPLE)).toBe(true);
        expect(isSelfEchoingClaim('A gate that creaks in the dark is a gate that invites trouble.')).toBe(true);
    });

    it('isSelfEchoingClaim leaves parallel construction alone — it is a virtue', () => {
        expect(isSelfEchoingClaim("If you've the ink and the patience for it, I've the coin and the room to host you.")).toBe(false);
        expect(isSelfEchoingClaim("If you're willing to set it, we're willing to give you the time.")).toBe(false);
        expect(isSelfEchoingClaim('If you are looking for the next caravan, the morning run leaves in two days.')).toBe(false);
    });

    it('isMaxim wants an abstraction equated to an abstraction', () => {
        expect(isMaxim('Maintenance is the price of water.')).toBe(true);
        expect(isMaxim('Ceremony is for those with walls to hide behind.')).toBe(true);
        expect(isMaxim('Grace is just the name the courtiers give to a useful silence.')).toBe(true);
        expect(isMaxim('Elspeth is tired of the whole business.')).toBe(false);
        expect(isMaxim('The gate is stuck again.')).toBe(false);
        expect(isMaxim('Elspeth is the only one who noticed.', ['Elspeth Ferrand'])).toBe(false);
    });

    it('isTwoHornQuestion wants a disjunction, not merely a question', () => {
        expect(isTwoHornQuestion('Is that a challenge, or have you just forgotten how to play the game?')).toBe(true);
        expect(isTwoHornQuestion('Does the mask fall off, or do I keep wearing it while I learn?')).toBe(true);
        expect(isTwoHornQuestion('Why do you ask?')).toBe(false);
        expect(isTwoHornQuestion('What did you find down there?')).toBe(false);
        expect(isTwoHornQuestion('Bring the brass and the chisel, or whatever else you need.')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// M2 — tic detection
// ---------------------------------------------------------------------------

describe('detectRhetoricTics', () => {
    it('arms on the Elspeth turns from the reviewed save', () => {
        const a = detectRhetoricTics(ELSPETH_TURN_A);
        expect(a.armed).toBe(true);
        expect(a.tics).toContain('motive-attribution');
        expect(a.tics).toContain('two-horn-close');

        const b = detectRhetoricTics(ELSPETH_TURN_B);
        expect(b.armed).toBe(true);
        expect(b.tics).toContain('two-horn-close');
    });

    it('arms on the Maribel turn the player objected to', () => {
        const r = detectRhetoricTics(MARIBEL_TURN);
        expect(r.armed).toBe(true);
        expect(r.tics).toContain('meaning-assignment');
    });

    it('stays silent on a good turn from the same save', () => {
        const r = detectRhetoricTics(CLEAN_TURN);
        expect(r.armed).toBe(false);
    });

    it('requires two markers — one is a sentence, two is a pattern', () => {
        expect(RHETORIC_TIC_THRESHOLD).toBe(2);
        // A single ordinary two-horn question is noted but does not arm.
        const r = detectRhetoricTics(
            "She set the cup down and looked at him steadily. 'Are you staying the night, or riding on?'",
        );
        expect(r.tics).toEqual(['two-horn-close']);
        expect(r.armed).toBe(false);
    });

    it('handles empty input', () => {
        expect(detectRhetoricTics('').armed).toBe(false);
        expect(detectRhetoricTics(undefined).tics).toEqual([]);
    });

    it('reports samples so the trigger is inspectable in the debug log', () => {
        const r = detectRhetoricTics(ELSPETH_TURN_A);
        expect(r.samples.length).toBeGreaterThan(0);
        expect(r.samples.join(' ')).toMatch(/You think|challenge/i);
    });
});

describe('NPC_RHETORIC reminder wiring', () => {
    it('is offered when tics are present and not otherwise', () => {
        const armed = selectSectionReminders(makeReminderContext({
            turnCount: 12,
            rhetoricTics: ['motive-attribution', 'two-horn-close'],
            rhetoricSamples: ['You think I listen well because…'],
        }));
        expect(armed.shown).toContain('NPC_RHETORIC');
        expect(armed.reminders.join('\n')).toContain('[RHETORIC]');

        const quiet = selectSectionReminders(makeReminderContext({ turnCount: 12 }));
        expect(quiet.shown).not.toContain('NPC_RHETORIC');
    });

    it('does not displace the correction protocol, which returns alone', () => {
        const sel = selectSectionReminders(makeReminderContext({
            turnCount: 12,
            playerCorrected: true,
            correctionMarkers: ["you're doing it again"],
            rhetoricTics: ['motive-attribution', 'two-horn-close'],
        }));
        expect(sel.shown).toContain('PLAYER_CORRECTION_PROTOCOL');
        expect(sel.shown).not.toContain('NPC_RHETORIC');
    });
});

// ---------------------------------------------------------------------------
// M3 — correction detection
// ---------------------------------------------------------------------------

describe('detectPlayerFraming — v1.35 widening', () => {
    it('catches the correction that matched nothing in v1.29', () => {
        const f = detectPlayerFraming(CORRECTION_BATHHOUSE);
        expect(f.corrected).toBe(true);
        expect(f.correctionMarkers.length).toBeGreaterThan(0);
    });

    const nowCaught = [
        "Doesn't mean I'm trying to start anything.",
        "You're deciding what I mean before I've decided it myself.",
        "You don't have to fit me into a neat little box.",
        'I asked because I was curious, nothing more than that.',
        "I'm just asking questions.",
        "I only asked because the door was open.",
        "You're putting words in my mouth.",
        'Stop trying to turn this into a crusade.',
    ];
    for (const input of nowCaught) {
        it(`catches: ${input.slice(0, 44)}…`, () => {
            expect(detectPlayerFraming(input).corrected).toBe(true);
        });
    }

    it('still ignores ordinary input and ordinary disagreement', () => {
        expect(detectPlayerFraming('I nod and take another drink of coffee.').corrected).toBe(false);
        expect(detectPlayerFraming('I draw my bow and sight down the ridge.').corrected).toBe(false);
        expect(detectPlayerFraming('"No, the gate post is the problem, not the seal."').corrected).toBe(false);
        expect(detectPlayerFraming('I think the Compact is wrong about the tithe.').corrected).toBe(false);
    });

    it('keeps the v1.29 phrasings working', () => {
        expect(detectPlayerFraming("Princess, you're doing it again.").corrected).toBe(true);
        expect(detectPlayerFraming("That's not what I said.").corrected).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// M4 — durable OOC directives
// ---------------------------------------------------------------------------

describe('ingestOocDirective', () => {
    let n = 0;
    const id = () => `d${n++}`;

    it('stores a directive so it can reach a prompt', () => {
        const { directives, added } = ingestOocDirective(
            undefined,
            "Ensure NPCs respond literally and cease projecting hidden meanings onto the character.",
            35,
            id,
        );
        expect(added).toBe(true);
        expect(directives).toHaveLength(1);
        expect(directives[0].turn).toBe(35);
    });

    it('ignores empty directives', () => {
        expect(ingestOocDirective([], undefined, 3, id).added).toBe(false);
        expect(ingestOocDirective([], '   ', 3, id).added).toBe(false);
    });

    it('de-duplicates a repeated instruction', () => {
        const first = ingestOocDirective(undefined, 'Do not have NPCs read hidden motives into my questions.', 10, id);
        const second = ingestOocDirective(first.directives, 'Do not have NPCs read hidden motives into my questions.', 14, id);
        expect(second.added).toBe(false);
        expect(second.directives).toHaveLength(1);
    });

    it('caps FIFO, keeping the most recent', () => {
        let acc = ingestOocDirective(undefined, 'directive number zero here', 0, id).directives;
        for (let i = 1; i <= OOC_DIRECTIVE_MAX + 2; i++) {
            acc = ingestOocDirective(acc, `directive number ${i} here`, i, id).directives;
        }
        expect(acc).toHaveLength(OOC_DIRECTIVE_MAX);
        expect(acc[acc.length - 1].text).toContain(`number ${OOC_DIRECTIVE_MAX + 2}`);
        expect(acc.some(d => d.text.includes('number zero'))).toBe(false);
    });
});

describe('buildOocDirectivesBlock', () => {
    it('is empty when there is nothing standing', () => {
        expect(buildOocDirectivesBlock(undefined)).toBe('');
        expect(buildOocDirectivesBlock([])).toBe('');
    });

    it('renders the directives as binding', () => {
        const block = buildOocDirectivesBlock([
            { id: 'a', text: 'Do not project hidden meanings onto the player.', turn: 35 },
        ]);
        expect(block).toContain('[STANDING DIRECTIVES');
        expect(block).toContain('binding');
        expect(block).toContain('Do not project hidden meanings onto the player.');
        // The whole point: it applies beyond the turn it was given on.
        expect(block).toContain('every turn');
    });
});
