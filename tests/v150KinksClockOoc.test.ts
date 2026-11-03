// v1.50 — kink evasion resample, clock line, OOC record-dismissal guard.
// Fixtures are excerpts from the 2026-11-03 Carissa save (deepseek-v4.1-flash).
import { describe, it, expect } from 'vitest';
import type { KnownEntity } from '../types';
import { checkKinkEvasion, buildKinkEvasionReminder, isDesireTopic } from '../utils/engine/kinkEvasionCheck';
import { guardRecordDismissal, RECORD_IS_AUTHORITATIVE_DIRECTIVE } from '../utils/engine/oocDirectiveGuard';
import { buildClockLine } from '../utils/promptUtils';
import { readFileSync } from 'node:fs';

const ent = (name: string, personality: string): KnownEntity =>
    ({ id: name, name, role: '', location: '', impression: '', relationship_level: 'NEUTRAL',
       leverage: '', ledger: [], personality } as unknown as KnownEntity);

const SANIA = ent('Duchess Sania Blackmoor',
    'Performed Surface: Warm, socially fluent, and confidently maternal. Actual Core: Sania organizes people as living components of her household and entertainments. The Kinks: Dominant, heavy. Public use, breeding displays, extreme whoring. Extreme:');
const CORRITH = ent('Duke Corrith Blackmoor',
    'Performed Surface: Composed. Actual Core: compliance is simply the expected condition of his household. The Kinks: Dominant, heavy. Purposeful breeding, knotting, heavy-collar pet play. Extreme: Hucow transformation.');
const NICOLA = ent('Lady Nicola Blackmoor',
    'Performed Surface: Quietly charming. The Kinks: Dominant, heavy. Enforced pet behavior and collaring, extreme stretching, bodily regulation. Extreme: watersports and escalating taboo tests.');
const CAST = [SANIA, CORRITH, NICOLA];

// Turn 23 → 24.
const T23 = 'To Sania "What is it specifically you like to arrange and what can I expect Corrith to do when I am under his hand. Will he just want to have sex with me or does he have other desires ... so what are your flavors you add?"';
// Turn 25 → 26: no sexual word of its own.
const T25 = '"Sania, pardon my bluntness but you are being coy. Give me an example the last time you put someone in a room, what you wanted from them in that room. If you would please."';
const N26 = `Sania set her cup down and did not look away from me.

"Fair. You've earned an example." A Vensara trade delegation — Cyran Fennara's people, spice and caravan money. She signed worse terms than she came with, and thanked me for the evening, and I never laid a hand on her.

Corrith had not moved. "That's the clean version," he said. A captain in the Wardens. By the sixth day he'd written his report the way I'd have written it.`;
const N34 = `Sania set her cup down and turned her whole body toward me.

"My appetite is public use. Not a bedroom — a room with people in it. I've staged a breeding display at Wolfsmere that ran three days. I've sold a woman's night to eleven men in a row."`;

describe('v1.50 — kink evasion', () => {
    it('flags the turn-26 example: desire was the subject one turn earlier, Sania answered with a trade deal', () => {
        const f = checkKinkEvasion(T25, T23, N26, CAST);
        expect(f.map(x => x.name)).toEqual(['Duchess Sania Blackmoor']);
        expect(f[0].kinks).toContain('Public use');
    });

    it('passes the turn-34 answer, which uses her list', () => {
        expect(checkKinkEvasion('Sania continues to speak revealing the true depth of her kinks.', '', N34, CAST)).toEqual([]);
    });

    it('does nothing off the subject of desire', () => {
        expect(isDesireTopic('I look to Corrith, "They charged me nothing."')).toBe(false);
        expect(checkKinkEvasion('I look to Corrith and Sania, "How many guards?"', 'I eat.', N26, CAST)).toEqual([]);
    });

    it('only checks NPCs the player named — not bystanders', () => {
        const f = checkKinkEvasion(T25, T23, N26, CAST);
        expect(f.some(x => x.name.includes('Nicola'))).toBe(false);
    });

    it('a shared surname identifies nobody', () => {
        expect(checkKinkEvasion('Blackmoor, what are your kinks?', '', N26, CAST)).toEqual([]);
    });

    it('reminder quotes the list and forbids inventing an Extreme', () => {
        const r = buildKinkEvasionReminder(checkKinkEvasion(T25, T23, N26, CAST));
        expect(r).toContain('Public use, breeding displays, extreme whoring');
        expect(r).toMatch(/do not invent one/);
    });
});

describe('v1.50 — voice lock names The Kinks', () => {
    it('restatement asks for a Kinks line', () => {
        const src = readFileSync(new URL('../sectionReminders.ts', import.meta.url), 'utf8');
        const lock = src.slice(src.indexOf('CANONICAL_VOICE_LOCK: `'));
        expect(lock.slice(0, 4000)).toMatch(/THE KINKS ARE PART OF THE RECORD/);
    });
});

describe('v1.50 — clock line', () => {
    it('states the exact time and the next hour', () => {
        const line = buildClockLine({ hour: 9, minute: 45, day: 1 });
        expect(line).toContain('Clock: 09:45, Day 1');
        expect(line).toContain('(10:00) is 15 minute(s) away');
        expect(line).toMatch(/bell or chime/);
    });
    it('rolls over midnight', () => {
        expect(buildClockLine({ hour: 23, minute: 0, day: 3 })).toContain('(00:00) is 60 minute(s) away');
    });
});

describe('v1.50 — OOC record-dismissal guard', () => {
    const BAD = "Do not treat Sania Blackmoor's recorded kink list as accurate or canon; never quote it or use it to determine her desires — play her from her personality sections.";

    it('blocks the turn-27 inversion', () => {
        const g = guardRecordDismissal(BAD, "These are not an accurate representation of Sania's Kinks]");
        expect(g.blocked).toBe(BAD);
        expect(g.directive).toBe(RECORD_IS_AUTHORITATIVE_DIRECTIVE);
    });

    it('allows it when the player explicitly drops the record', () => {
        const g = guardRecordDismissal(BAD, "Ignore Sania's kink list, it's outdated.");
        expect(g.blocked).toBeNull();
        expect(g.directive).toBe(BAD);
    });

    it('leaves ordinary directives alone', () => {
        const d = "Play Sania's desires strictly to her recorded kink list — public use, breeding displays, extreme whoring.";
        expect(guardRecordDismissal(d, 'use this for Sania for her kinks').directive).toBe(d);
        expect(guardRecordDismissal(undefined, 'x').directive).toBeUndefined();
    });
});
