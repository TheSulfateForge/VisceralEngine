import { describe, it, expect } from 'vitest';
import {
    detectRhetoricTics,
    speechBySpeaker,
    countFigurative,
    isFigurativeVoiceSample,
    voiceSampleRejection,
    FIGURATIVE_DENSITY_LIMIT,
} from '../utils/engine/npcRhetoric';
import { SYSTEM_INSTRUCTIONS } from '../systemInstructions';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// REMINDERS is module-private; read the source text instead of widening exports.
const REMINDER_SOURCE = readFileSync(resolve(__dirname, '../sectionReminders.ts'), 'utf-8');
import { RESAMPLE_REMINDER } from '../utils/driftDetector';

// v1.46 — Plain Register. The figurative-density check now counts comparisons
// inside quoted dialogue, per speaker, at the stated one-per-NPC limit, and
// arms the NPC_RHETORIC reminder by itself.

describe('v1.46 figurative detection', () => {
    it('ignores the verb "like"', () => {
        expect(countFigurative("I'd like the ale, and you like the room.")).toBe(0);
        expect(countFigurative('He would like a word.')).toBe(0);
    });

    it('counts real comparisons', () => {
        expect(countFigurative('She moved like a cat, as if the floor were ice.')).toBe(2);
    });

    it('groups quoted speech by the first known name in the paragraph', () => {
        const narrative =
            'Maribel set the cup down. "It sits like a stone in the belly."\n\n' +
            'Maribel wiped her hands. "And the gate creaks as if it knows."';
        const bySpeaker = speechBySpeaker(narrative, ['Maribel Thorn']);
        expect([...bySpeaker.keys()]).toEqual(['Maribel']);
        expect(countFigurative(bySpeaker.get('Maribel')!)).toBe(2);
    });

    it('handles straight single-quoted dialogue without breaking on apostrophes', () => {
        const narrative = "Elspeth shrugged. 'You don't glide like a thief. You walk as if you own it.'";
        const bySpeaker = speechBySpeaker(narrative, ['Elspeth']);
        expect(countFigurative(bySpeaker.get('Elspeth')!)).toBe(2);
    });

    it('does not count comparisons in narration', () => {
        const narrative =
            'Rain came down like a curtain, as if the sky had split. ' +
            'Maribel said, "The well is dry."';
        const report = detectRhetoricTics(narrative, ['Maribel']);
        expect(report.tics).not.toContain('figurative-density');
    });

    it('arms on its own when one speaker reaches the limit', () => {
        expect(FIGURATIVE_DENSITY_LIMIT).toBe(2);
        const narrative = 'Maribel leaned in. "The cellar smells like a tomb, and the stairs sag as if they were tired."';
        const report = detectRhetoricTics(narrative, ['Maribel']);
        expect(report.tics).toEqual(['figurative-density']);
        expect(report.armed).toBe(true);
        expect(report.samples[0]).toContain('Maribel');
    });

    it('does not arm on one comparison per speaker', () => {
        const narrative =
            'Maribel said, "It fits like a glove."\n' +
            'Oskar grunted. "Hangs like a sack on me."';
        const report = detectRhetoricTics(narrative, ['Maribel', 'Oskar']);
        expect(report.armed).toBe(false);
    });
});

describe('v1.46 voice samples', () => {
    it('flags a figurative sample, however short', () => {
        expect(isFigurativeVoiceSample('Like a hog at a trough.')).toBe(true);
        expect(isFigurativeVoiceSample("Aye, and mind the step.")).toBe(false);
    });

    it('keeps figurative out of voiceSampleRejection so stored samples are not scrubbed', () => {
        expect(voiceSampleRejection('That boy runs like a scalded cat every morning.')).toBeNull();
    });
});

describe('v1.46 prompt text', () => {
    const allText = [
        SYSTEM_INSTRUCTIONS,
        REMINDER_SOURCE.slice(REMINDER_SOURCE.indexOf('INTIMATE: `'), REMINDER_SOURCE.indexOf('NARRATIVE_INTEGRITY: `')),
        REMINDER_SOURCE.slice(REMINDER_SOURCE.indexOf('VISCERAL_RENDER: `'), REMINDER_SOURCE.indexOf('CONDITION_AUDIT: `')),
        RESAMPLE_REMINDER,
    ].join('\n');

    it('no longer anchors on the figurative stylists', () => {
        for (const name of ['McCarthy', 'Delany', 'Selby', 'Blood Meridian', 'body in a body']) {
            expect(allText).not.toContain(name);
        }
    });

    it('carries the always-on anchors and the dialogue rule in §10', () => {
        for (const name of ['Richard Stark', 'Bernard Cornwell', 'Donald Ray Pollock', 'Elmore Leonard', 'Eddie Coyle']) {
            expect(SYSTEM_INSTRUCTIONS).toContain(name);
        }
        expect(SYSTEM_INSTRUCTIONS).toContain('**Dialogue.**');
    });

    it('names Ryu Murakami in full, never bare Murakami', () => {
        expect(allText).not.toMatch(/(?<!Ryu )Murakami/);
    });

    it('puts the plain noun list in Appendix A and drops "invented" description', () => {
        const appendix = SYSTEM_INSTRUCTIONS.slice(SYSTEM_INSTRUCTIONS.indexOf('APPENDIX A'));
        expect(appendix).toContain('**Plain nouns');
        expect(SYSTEM_INSTRUCTIONS).not.toContain('invented visceral description');
    });
});
