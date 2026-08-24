import { describe, it, expect } from 'vitest';
import {
    selectSectionReminders,
    makeReminderContext,
    ROTATION_KEYS,
    type ReminderKey,
    type ReminderContext,
} from '../sectionReminders';
import type { SceneMode } from '../types';

/**
 * v1.33 (M6/M7) regression suite.
 *
 * Written against a measured failure, not a hypothetical one. In the Tidegate
 * save (T54) and the Bloodfeather save (T16) the reminder selector emitted
 * FOUR distinct reminders across the entire campaign, identical from T25
 * onward, because two always-on conditions consumed a two-slot budget before
 * the rotation was ever consulted. Separately, `WORLD_NORMALCY` — the reminder
 * that says "70% of people are ordinary civilians; suspicion and hostility
 * must be EARNED" — had never been injected in the history of the engine,
 * because its trigger `(t - 4) % 8 === 0` is a strict subset of the
 * `t % 4 === 0` branch two positions above it in the old else-if chain.
 *
 * The first test below is the one that matters: it fails if ANY registered
 * rotation entry becomes unreachable again.
 */

/** Runs the selector across `turns`, stamping the scheduler as the app does. */
const runCampaign = (
    turns: number,
    partial: Partial<ReminderContext> = {},
): { shown: ReminderKey[][]; keys: Set<ReminderKey>; lastShown: Record<string, number> } => {
    const lastShown: Record<string, number> = {};
    const shown: ReminderKey[][] = [];
    const keys = new Set<ReminderKey>();

    for (let turn = 1; turn <= turns; turn++) {
        const sel = selectSectionReminders(makeReminderContext({
            ...partial,
            turnCount: turn,
            worldTurn: turn,
            reminderLastShown: { ...lastShown },
        }));
        shown.push(sel.shown);
        for (const key of sel.shown) {
            lastShown[key] = turn;
            keys.add(key);
        }
    }
    return { shown, keys, lastShown };
};

describe('v1.33 — every rotation entry is reachable', () => {
    it('reaches every registered rotation key across a realistic sweep', () => {
        // The sweep varies only the things a real campaign varies. If an entry
        // needs a flag no campaign ever sets, that is itself a bug worth
        // failing on.
        const modes: SceneMode[] = ['NARRATIVE', 'SOCIAL', 'TENSION', 'COMBAT'];
        const reached = new Set<ReminderKey>();

        for (const mode of modes) {
            for (const tensionLevel of [0, 10, 45, 70]) {
                for (const liveThreatCount of [0, 2]) {
                    for (const flags of [
                        {},
                        { intimacyInScene: true },
                        { violenceInScene: true },
                        { goalCount: 1 },
                        { conditionsCount: 24 },
                    ]) {
                        const { keys } = runCampaign(60, {
                            mode,
                            tensionLevel,
                            liveThreatCount,
                            entityCount: 26,
                            canonicalPersonalityNpcPresent: true,
                            ...flags,
                        });
                        for (const k of keys) reached.add(k);
                    }
                }
            }
        }

        const unreachable = ROTATION_KEYS.filter(k => !reached.has(k));
        expect(
            unreachable,
            `Unreachable rotation entries: ${unreachable.join(', ')}. ` +
            `An entry that can never fire is dead prompt text — this is the ` +
            `WORLD_NORMALCY / GENRE_CONSISTENCY / FACTION_PARITY bug returning.`,
        ).toEqual([]);
    });

    it('reaches WORLD_NORMALCY on the exact state the Tidegate save was stuck in', () => {
        // SOCIAL, tension 10, 26 entities, canonical personalities present,
        // no live threats, bargain clock long expired. The old selector
        // returned CANONICAL_VOICE_LOCK + VISCERAL_RENDER (and later
        // BARGAIN_CHECK) on every one of these turns, forever.
        const { keys } = runCampaign(20, {
            mode: 'SOCIAL',
            tensionLevel: 10,
            entityCount: 26,
            goalCount: 7,
            conditionsCount: 7,
            canonicalPersonalityNpcPresent: true,
            lastBargainTurn: 0,
        });

        expect(keys.has('WORLD_NORMALCY')).toBe(true);
        expect(keys.has('PROPORTIONALITY')).toBe(true);
        expect(keys.has('GENRE_CONSISTENCY')).toBe(true);
    });

    it('emits far more than four distinct reminders over a long campaign', () => {
        const { keys } = runCampaign(54, {
            mode: 'SOCIAL',
            tensionLevel: 10,
            entityCount: 26,
            goalCount: 7,
            conditionsCount: 7,
            canonicalPersonalityNpcPresent: true,
        });
        // The measured pre-fix number was exactly 4.
        expect(keys.size).toBeGreaterThan(6);
    });
});

describe('v1.33 — the rotation is not starved by standing conditions', () => {
    it('gives the rotation its own slot even when both conditional slots are taken', () => {
        const { shown } = runCampaign(20, {
            mode: 'COMBAT',
            tensionLevel: 80,
            liveThreatCount: 2,
            entityCount: 26,
            canonicalPersonalityNpcPresent: true,
            hostileEntityNames: ['Lord Veyric'],
        });

        // Both conditionals are certainly firing here.
        const conditionalKeys: ReminderKey[] = ['HOSTILE_NPC_PROTOCOL', 'CANONICAL_VOICE_LOCK', 'VISCERAL_RENDER'];
        for (let i = 2; i < shown.length; i++) {
            const turn = i + 1;
            const hasConditional = shown[i].some(k => conditionalKeys.includes(k));
            expect(hasConditional, `turn ${turn} should carry a standing condition`).toBe(true);
        }

        // …and the rotation still runs. COMBAT_REALISM was unreachable in
        // COMBAT mode before this change, which is where it was needed.
        const allKeys = new Set(shown.flat());
        const rotationReached = ROTATION_KEYS.filter(k => allKeys.has(k));
        expect(rotationReached.length).toBeGreaterThan(0);
        expect(allKeys.has('COMBAT')).toBe(true);
    });

    it('respects each entry minimum interval', () => {
        const lastShown: Record<string, number> = {};
        for (let turn = 1; turn <= 40; turn++) {
            const sel = selectSectionReminders(makeReminderContext({
                turnCount: turn,
                worldTurn: turn,
                mode: 'SOCIAL',
                tensionLevel: 10,
                entityCount: 26,
                canonicalPersonalityNpcPresent: true,
                reminderLastShown: { ...lastShown },
            }));
            for (const key of sel.shown) {
                if (ROTATION_KEYS.includes(key) && lastShown[key] !== undefined) {
                    // Nothing in the rotation should repeat on consecutive turns.
                    expect(turn - lastShown[key], `${key} repeated too soon`).toBeGreaterThan(1);
                }
                lastShown[key] = turn;
            }
        }
    });
});

describe('v1.33 (M9) — the Devil\'s Bargain clock cannot stand open forever', () => {
    const calmOverdue = (turn: number, lastShown: Record<string, number>) =>
        selectSectionReminders(makeReminderContext({
            turnCount: turn,
            worldTurn: turn,
            mode: 'SOCIAL',
            tensionLevel: 10,      // the Tidegate save's actual tension
            lastBargainTurn: 0,    // never satisfied in 54 turns
            entityCount: 26,
            canonicalPersonalityNpcPresent: true,
            reminderLastShown: lastShown,
        }));

    it('does not demand a death-or-irreversible-loss bargain on a calm beat', () => {
        const lastShown: Record<string, number> = {};
        for (let turn = 26; turn <= 54; turn++) {
            const sel = calmOverdue(turn, { ...lastShown });
            expect(sel.shown, `turn ${turn}`).not.toContain('BARGAIN_CHECK');
            for (const key of sel.shown) lastShown[key] = turn;
        }
    });

    it('explains the suppression in the debug log rather than failing silently', () => {
        const sel = calmOverdue(40, {});
        expect(sel.debug.join('\n')).toContain('[BARGAIN CLOCK]');
        expect(sel.debug.join('\n')).toContain('suppressed');
    });

    it('still fires when the scene could actually contain a qualifying roll', () => {
        const sel = selectSectionReminders(makeReminderContext({
            turnCount: 40,
            worldTurn: 40,
            mode: 'TENSION',
            tensionLevel: 55,
            lastBargainTurn: 0,
            reminderLastShown: {},
        }));
        expect(sel.shown).toContain('BARGAIN_CHECK');
    });

    it('does not re-fire every turn once shown', () => {
        const base = {
            mode: 'TENSION' as SceneMode,
            tensionLevel: 55,
            lastBargainTurn: 0,
        };
        const first = selectSectionReminders(makeReminderContext({
            ...base, turnCount: 40, worldTurn: 40, reminderLastShown: {},
        }));
        expect(first.shown).toContain('BARGAIN_CHECK');

        const next = selectSectionReminders(makeReminderContext({
            ...base, turnCount: 41, worldTurn: 41, reminderLastShown: { BARGAIN_CHECK: 40 },
        }));
        expect(next.shown).not.toContain('BARGAIN_CHECK');
    });
});

describe('v1.33 (M11) — the visceral register follows content, not scene mode', () => {
    const socialTurn = (extra: Partial<ReminderContext>) =>
        selectSectionReminders(makeReminderContext({
            turnCount: 12,
            worldTurn: 12,
            mode: 'SOCIAL',
            tensionLevel: 10,
            entityCount: 26,
            canonicalPersonalityNpcPresent: true,
            ...extra,
        }));

    it('does not fire on a quiet conversation', () => {
        // Two men waiting for dawn in a hunters' hall — the actual scene the
        // old `mode === 'SOCIAL'` trigger described as containing "intimacy,
        // violence, fear, hunger, or bodily extremity".
        expect(socialTurn({}).shown).not.toContain('VISCERAL_RENDER');
    });

    it('fires when intimacy is detected in the preceding narrative', () => {
        const sel = socialTurn({ intimacyInScene: true });
        expect(sel.shown).toContain('VISCERAL_RENDER');
        expect(sel.reminders.join('\n')).toContain('[REGISTER TRIGGER]');
        expect(sel.reminders.join('\n')).toContain('intimacy detected');
    });

    it('fires when violence is detected in the preceding narrative', () => {
        const sel = socialTurn({ violenceInScene: true });
        expect(sel.shown).toContain('VISCERAL_RENDER');
        expect(sel.reminders.join('\n')).toContain('violence detected');
    });

    it('fires on genuinely high tension regardless of detection', () => {
        expect(socialTurn({ tensionLevel: 70 }).shown).toContain('VISCERAL_RENDER');
    });
});

describe('v1.33 — overrides still return alone', () => {
    it('dream turns are self-contained', () => {
        const sel = selectSectionReminders(makeReminderContext({
            turnCount: 20, worldTurn: 20, dreamSeedActive: true,
            canonicalPersonalityNpcPresent: true, mode: 'SOCIAL',
        }));
        expect(sel.shown).toEqual(['DREAM_PROTOCOL']);
    });

    it('a player correction outranks everything below it', () => {
        const sel = selectSectionReminders(makeReminderContext({
            turnCount: 20, worldTurn: 20,
            playerCorrected: true,
            correctionMarkers: ["you're doing it again"],
            canonicalPersonalityNpcPresent: true,
            mode: 'SOCIAL',
            tensionLevel: 80,
            hostileEntityNames: ['Someone'],
        }));
        expect(sel.shown).toEqual(['PLAYER_CORRECTION_PROTOCOL', 'PROPORTIONALITY']);
    });
});
