import { describe, it, expect } from 'vitest';
import { detectInventedTrigger } from '../utils/driftDetector';
import { selectSectionReminders, makeReminderContext } from '../sectionReminders';

// ============================================================================
// v1.37 — the inverse invented trigger.
//
// CANONICAL_VOICE_LOCK has said "DO NOT INVENT A TRIGGER" since v1.29, and its
// worked examples all describe inventing a PERMANENTLY ACTIVE one — the failure
// where every exchange becomes a revelation. The 2026-09-07 Carissa save is the
// mirror image and was not covered: the model invented a permanently INACTIVE
// trigger and deferred five characters' Actual Core for the whole session.
//
// The thought lines below are verbatim from that save's debug log, and the
// personality fragments are verbatim from its knownEntities.
// ============================================================================

/** Verbatim from the Carissa save, turn 23. */
const CARISSA_THOUGHT =
    'Rendering Sania per canonical traits: Warm, socially fluent, confidently maternal. ' +
    'This turn those traits manifest as: soothing physical touch, using maternal language to ' +
    'frame control as care. The trigger for her core is inactive (the scene is social and the ' +
    'environment controlled), so she continues to perform the warm surface effectively.';

/** Verbatim opening and closing of Duchess Sania Blackmoor's personality field. */
const SANIA_PERSONALITY =
    'Performed Surface: Warm, socially fluent, and confidently maternal. She remembers names, ' +
    'repairs awkward conversations, and makes newcomers feel included without becoming saccharine. ' +
    'Subtext Bleed-through: Inclusion under Sania’s direction comes with assigned roles. ' +
    'Actual Core: Sania organizes people as living components of her household and entertainments. ' +
    'She can nurse someone through exhaustion while arranging their next use, seeing tenderness as ' +
    'maintenance rather than absolution.';

/** The shape §10 actually specifies — a written trigger clause. */
const TRIGGERED_PERSONALITY =
    'Performed surface: doting, loving. Actual core (surfaces when the target is in his ' +
    'territory): predatory, exploitative, commodifying.';

const entity = (name: string, personality: string) => ({ name, personality });

describe('v1.37 — detecting a trigger declared against a record that has none', () => {
    it('catches the verbatim Carissa thought line', () => {
        const out = detectInventedTrigger(CARISSA_THOUGHT, [
            entity('Duchess Sania Blackmoor', SANIA_PERSONALITY),
        ]);
        expect(out.detected).toBe(true);
        expect(out.direction).toBe('inactive');
        expect(out.names).toContain('Duchess Sania Blackmoor');
        expect(out.sample).toMatch(/trigger for her core is inactive/i);
    });

    it('catches the v1.29 direction too', () => {
        const out = detectInventedTrigger(
            'Rendering Sania per canonical traits. Trigger condition: active this turn, so the ' +
            'core surfaces at full register.',
            [entity('Duchess Sania Blackmoor', SANIA_PERSONALITY)],
        );
        expect(out.detected).toBe(true);
        expect(out.direction).toBe('active');
    });

    it('does NOT fire when the record actually states a trigger', () => {
        // A declaration about a genuinely conditional character is the reminder
        // working as designed, not a finding.
        const out = detectInventedTrigger(CARISSA_THOUGHT, [
            entity('Lord Vharen', TRIGGERED_PERSONALITY),
        ]);
        expect(out.detected).toBe(false);
    });

    it('does not fire on a flat, unlayered personality', () => {
        const out = detectInventedTrigger(CARISSA_THOUGHT, [
            entity('Maribel Jessop', 'Unhurried, unshockable, and physically incapable of being rushed.'),
        ]);
        expect(out.detected).toBe(false);
    });

    it('does not fire on a thought line that declares no trigger status', () => {
        const out = detectInventedTrigger(
            'Rendering Sania per canonical traits: warm, socially fluent, maternal. This turn those ' +
            'traits manifest as: she arranges the guest’s afternoon without asking.',
            [entity('Duchess Sania Blackmoor', SANIA_PERSONALITY)],
        );
        expect(out.detected).toBe(false);
    });

    it('is safe on empty and missing input', () => {
        expect(detectInventedTrigger('', []).detected).toBe(false);
        expect(detectInventedTrigger(undefined, [entity('X', SANIA_PERSONALITY)]).detected).toBe(false);
        expect(detectInventedTrigger(CARISSA_THOUGHT, []).detected).toBe(false);
        expect(detectInventedTrigger(CARISSA_THOUGHT, [entity('X', '')]).detected).toBe(false);
    });
});

/** The voice-lock text as the selector actually emits it. */
const voiceLock = (partial = {}): string => {
    const sel = selectSectionReminders(makeReminderContext({
        turnCount: 24,
        worldTurn: 24,
        mode: 'SOCIAL',
        tensionLevel: 15,
        canonicalPersonalityNpcPresent: true,
        ...partial,
    }));
    const found = sel.reminders.find(r => r.includes('CANONICAL VOICE LOCK'));
    if (!found) throw new Error('CANONICAL_VOICE_LOCK was not selected');
    return found;
};

describe('v1.37 — the voice lock covers both directions', () => {
    const lock = voiceLock();

    it('keeps the v1.29 rule', () => {
        expect(lock).toContain('DO NOT INVENT A TRIGGER');
        expect(lock).toContain('If no trigger is written down, there is no');
    });

    it('names the inactive direction and forbids it explicitly', () => {
        expect(lock).toMatch(/INVENTED-INACTIVE/);
        expect(lock).toMatch(/MAY NOT DECLARE A TRIGGER INACTIVE ON A RECORD THAT NAMES NO TRIGGER/);
        // The observed failure is quoted, so the model sees the exact shape.
        expect(lock).toMatch(/the scene is social and the\s+environment\s+controlled/);
    });

    it('says an untriggered core is live rather than deferred', () => {
        expect(lock).toMatch(/is not gated behind anything/);
        expect(lock).toMatch(/never of a switch position/);
    });

    it('rejects a restatement that names only the surface layer', () => {
        expect(lock).toMatch(/names nothing from the\s+Actual Core is a failed restatement/);
    });
});

describe('v1.37 — the finding arms the voice lock for one turn', () => {
    const ctxWith = (names: string[], direction = 'inactive') => makeReminderContext({
        turnCount: 24,
        worldTurn: 24,
        mode: 'SOCIAL',
        tensionLevel: 15,
        canonicalPersonalityNpcPresent: true,
        inventedTriggerNames: names,
        inventedTriggerDirection: direction,
    });

    it('appends the offenders by name when the flag is set', () => {
        const sel = selectSectionReminders(ctxWith(['Duchess Sania Blackmoor', 'Duke Corrith Blackmoor']));
        const lock = sel.reminders.find(r => r.includes('CANONICAL VOICE LOCK'));
        expect(lock).toBeDefined();
        expect(lock!).toContain('[INVENTED TRIGGER — LAST TURN]');
        expect(lock!).toContain('Duchess Sania Blackmoor, Duke Corrith Blackmoor');
        expect(lock!).toContain('There is no switch on these characters');
    });

    it('adds nothing on an ordinary turn', () => {
        const sel = selectSectionReminders(ctxWith([]));
        const lock = sel.reminders.find(r => r.includes('CANONICAL VOICE LOCK'));
        expect(lock).toBeDefined();
        expect(lock!).not.toContain('[INVENTED TRIGGER');
    });
});
