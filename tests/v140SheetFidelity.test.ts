import { describe, it, expect } from 'vitest';
import {
    parseSheetSections,
    getSection,
    isLayeredSheet,
    capSheetBySections,
    describeSheetSections,
    CORE_LABEL,
} from '../utils/engine/sheetSections';
import {
    parseRestatements,
    checkRestatement,
    checkVoiceLock,
} from '../utils/engine/voiceLockCheck';
import { selectSectionReminders, makeReminderContext } from '../sectionReminders';
import type { KnownEntity } from '../types';

// ============================================================================
// v1.40 — sheets become addressable, and the voice lock's promised check
// becomes real.
//
// sectionReminders has told the model since v1.33: "The engine parses this line
// and checks it against the record." It did not. Meanwhile every Blackmoor turn
// in the 2026-09-07 Carissa save restated the Performed Surface verbatim and
// nothing else, while the Actual Core sat in the prompt unread.
//
// The record and thought lines below are verbatim from that save.
// ============================================================================

/** Verbatim, abridged only in the middle of each section's prose. */
const SANIA_RECORD =
    'Performed Surface: Warm, socially fluent, and confidently maternal. She remembers names, ' +
    'repairs awkward conversations, and makes newcomers feel included. ' +
    'Subtext Bleed-through: Inclusion under Sania’s direction comes with assigned roles. ' +
    'Actual Core: Sania organizes people as living components of her household and ' +
    'entertainments. She can nurse someone through exhaustion while arranging their next use. ' +
    'The Kinks: Bestiality, oviposition, public use, extreme whoring, and breeding displays. ' +
    'The Approach: Precise staging, controlled witnesses, reliable handlers. ' +
    'Body Over Mind: She rejects mind control and psychological conditioning.';

/** Verbatim from the save's debug log, turn 23. */
const MASK_ONLY_THOUGHT =
    'Rendering Sania per canonical traits: Warm, socially fluent, confidently maternal. ' +
    'This turn those traits manifest as: soothing physical touch.';

const entity = (over: Partial<KnownEntity> = {}): KnownEntity => ({
    id: 'npc_duchess_sania_blackmoor',
    name: 'Duchess Sania Blackmoor',
    role: 'Matriarch of House Blackmoor',
    location: 'Blackmoor Townhouse',
    impression: '', relationship_level: 'NEUTRAL', leverage: '', ledger: [],
    personality: SANIA_RECORD,
    ...over,
} as KnownEntity);

describe('v1.40 — sheets parse into addressable sections', () => {
    it('finds every section the author wrote, in order', () => {
        const { labels, isSectioned } = parseSheetSections(SANIA_RECORD);
        expect(isSectioned).toBe(true);
        expect(labels).toEqual([
            'Performed Surface', 'Subtext Bleed-through', 'Actual Core',
            'The Kinks', 'The Approach', 'Body Over Mind',
        ]);
    });

    it('returns a section body by label', () => {
        expect(getSection(SANIA_RECORD, CORE_LABEL)).toContain('living components of her household');
        expect(getSection(SANIA_RECORD, 'The Kinks')).toContain('oviposition');
        expect(getSection(SANIA_RECORD, 'Nonexistent Section')).toBe('');
    });

    it('normalises alternate spellings to the canonical label', () => {
        const alt = parseSheetSections('Surface: pleasant. Core: furious. Kinks: rope.');
        expect(alt.labels).toEqual(['Performed Surface', 'Actual Core', 'The Kinks']);
    });

    it('treats an unsectioned record as unsectioned rather than failing', () => {
        // Liora Calder's actual record shape.
        const plain = parseSheetSections('Curious but cautious. She wants to learn magic.');
        expect(plain.isSectioned).toBe(false);
        expect(plain.labels).toEqual([]);
        expect(plain.preamble).toContain('Curious but cautious');
    });

    it('does not open a section on a colon inside ordinary prose', () => {
        const p = parseSheetSections('She has one rule: never be the last to leave a room.');
        expect(p.isSectioned).toBe(false);
    });

    it('identifies a layered sheet', () => {
        expect(isLayeredSheet(SANIA_RECORD)).toBe(true);
        expect(isLayeredSheet('Curious but cautious.')).toBe(false);
    });
});

describe('v1.40 — capping never emits half a section', () => {
    const capped = capSheetBySections(SANIA_RECORD, 460);

    it('stays within its budget', () => {
        expect(capped.length).toBeLessThanOrEqual(460);
    });

    it('keeps the Actual Core first, whole', () => {
        expect(capped).toContain('Actual Core:');
        expect(capped).toContain('living components of her household');
    });

    it('NAMES what it left out instead of dropping it silently', () => {
        // The old cap emitted "The Kinks: Severe genital and breast torture,
        // whipping to blood […]" — a wrong record that reads as a complete one.
        expect(capped).toMatch(/NOT SHOWN THIS TURN \(present in the record, omitted for space\)/);
    });

    it('never emits a truncated section body', () => {
        // Every label that appears with a body must carry that body in full.
        for (const s of parseSheetSections(capped).sections) {
            if (s.label === 'Actual Core' || s.label === 'Performed Surface') {
                expect(getSection(SANIA_RECORD, s.label)).toContain(s.body.split(' [NOT SHOWN')[0].trim());
            }
        }
    });

    it('returns a short record untouched', () => {
        expect(capSheetBySections('Curious but cautious.', 460)).toBe('Curious but cautious.');
        expect(capSheetBySections('', 100)).toBe('');
    });
});

describe('v1.40 — section enumeration answers "does she even have one?"', () => {
    it('lists exactly the sections a record has', () => {
        const d = describeSheetSections(SANIA_RECORD);
        expect(d).toContain('The Kinks');
        expect(d).toMatch(/does not exist for this character/);
    });

    it('says plainly when a record has no sections at all', () => {
        const d = describeSheetSections('Curious but cautious. She wants to learn magic.');
        expect(d).toMatch(/Sections present: NONE/);
        expect(d).toMatch(/no Actual Core, no kink list/);
    });
});

describe('v1.40 — the restatement is parsed back out of thought_process', () => {
    it('parses the shape the voice lock mandates', () => {
        const [r] = parseRestatements(MASK_ONLY_THOUGHT);
        expect(r.name).toBe('Sania');
        expect(r.traits).toEqual(['Warm', 'socially fluent', 'confidently maternal']);
    });

    it('parses the bracketed variant the model also emits', () => {
        const [r] = parseRestatements(
            'Rendering [Duke Corrith Blackmoor] per canonical traits: [patient, hospitable, exacting].',
        );
        expect(r.name).toBe('Duke Corrith Blackmoor');
        expect(r.traits).toEqual(['patient', 'hospitable', 'exacting']);
    });

    it('parses several in one turn', () => {
        expect(parseRestatements(
            'Rendering Sania per canonical traits: warm, maternal. ' +
            'Rendering Corrith per canonical traits: patient, exacting.',
        )).toHaveLength(2);
    });

    it('returns nothing when the model skipped the restatement', () => {
        expect(parseRestatements('Establishing scene atmosphere. No threats.')).toEqual([]);
        expect(parseRestatements('')).toEqual([]);
    });
});

describe('v1.40 — the check catches the mask-mode failure', () => {
    it('flags the verbatim Carissa restatement as surface-only', () => {
        const [r] = parseRestatements(MASK_ONLY_THOUGHT);
        const finding = checkRestatement(r, entity());
        expect(finding).not.toBeNull();
        expect(finding!.surfaceOnly).toBe(true);
        expect(finding!.issues).toContain('surface-only');
        expect(finding!.detail).toMatch(/restated ONLY the Performed Surface/);
    });

    it('passes a restatement that draws on the Actual Core', () => {
        const [r] = parseRestatements(
            'Rendering Sania per canonical traits: maternal, organizing, arranging. ' +
            'This turn those traits manifest as: she assigns the guest a room without asking.',
        );
        const finding = checkRestatement(r, entity());
        expect(finding?.surfaceOnly ?? false).toBe(false);
    });

    it('flags an archetype substituted for the record', () => {
        // The voice lock's own forbidden example: a harsh canonical rendered
        // through a generic social-class register.
        const [r] = parseRestatements(
            'Rendering Sania per canonical traits: aristocratic, courteous, refined.',
        );
        const finding = checkRestatement(r, entity());
        expect(finding).not.toBeNull();
        expect(finding!.issues).toContain('ungrounded-traits');
        expect(finding!.ungrounded).toContain('aristocratic');
    });

    it('does not flag a record-grounded trait that merely reads soft', () => {
        const [r] = parseRestatements('Rendering Sania per canonical traits: warm, maternal, arranging.');
        const finding = checkRestatement(r, entity());
        expect(finding?.ungrounded ?? []).toEqual([]);
    });

    it('does not apply the layer check to an unlayered record', () => {
        const liora = entity({
            name: 'Liora Calder',
            personality: 'Curious but cautious. She wants to learn magic and learn to fight.',
        });
        const [r] = parseRestatements('Rendering Liora Calder per canonical traits: curious, cautious.');
        expect(checkRestatement(r, liora)?.surfaceOnly ?? false).toBe(false);
    });

    it('returns null for an entity with no record to check against', () => {
        const [r] = parseRestatements(MASK_ONLY_THOUGHT);
        expect(checkRestatement(r, entity({ personality: '' }))).toBeNull();
    });
});

describe('v1.40 — checkVoiceLock resolves the shortened names the model uses', () => {
    it('matches "Sania" to "Duchess Sania Blackmoor"', () => {
        const findings = checkVoiceLock(MASK_ONLY_THOUGHT, [entity()]);
        expect(findings).toHaveLength(1);
        expect(findings[0].name).toBe('Duchess Sania Blackmoor');
    });

    it('ignores a restatement for a character the engine has no record of', () => {
        expect(checkVoiceLock('Rendering Nobody per canonical traits: brisk, tidy.', [entity()])).toEqual([]);
    });

    it('is silent on a clean turn', () => {
        expect(checkVoiceLock(
            'Rendering Sania per canonical traits: maternal, arranging, organizing.',
            [entity()],
        )).toEqual([]);
    });
});

describe('v1.40 — findings reach the next turn as a named trailer', () => {
    it('quotes the finding back into the voice lock', () => {
        const sel = selectSectionReminders(makeReminderContext({
            turnCount: 24, worldTurn: 24, mode: 'SOCIAL', tensionLevel: 15,
            canonicalPersonalityNpcPresent: true,
            restatementIssues: ['Duchess Sania Blackmoor: restated ONLY the Performed Surface.'],
        }));
        const lock = sel.reminders.find(r => r.includes('CANONICAL VOICE LOCK'));
        expect(lock).toBeDefined();
        expect(lock!).toContain('[RESTATEMENT FAILED THE RECORD CHECK — LAST TURN]');
        expect(lock!).toContain('Duchess Sania Blackmoor');
        expect(lock!).toMatch(/names nothing from their\s+Actual Core has already failed/);
    });

    it('adds nothing on an ordinary turn', () => {
        const sel = selectSectionReminders(makeReminderContext({
            turnCount: 24, worldTurn: 24, mode: 'SOCIAL', tensionLevel: 15,
            canonicalPersonalityNpcPresent: true,
        }));
        const lock = sel.reminders.find(r => r.includes('CANONICAL VOICE LOCK'));
        expect(lock!).not.toContain('[RESTATEMENT FAILED');
    });
});
