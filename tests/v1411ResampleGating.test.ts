import { describe, it, expect } from 'vitest';
import {
    isFocalCharacter,
    parseRestatements,
    checkRestatement,
} from '../utils/engine/voiceLockCheck';
import { directiveSuppressions } from '../utils/engine/sceneContinuity';
import type { KnownEntity } from '../types';

// ============================================================================
// v1.41.1 — the resample regression, measured and closed.
//
// First play-test of v1.37-v1.41 (Ryan Bloodfeather, 2026-09-08, 29 turns).
// Median turn latency 24s -> 34s. Model-call time 5s -> 12s. Resamples across
// the session: 1 -> 20. SEVENTEEN of the twenty were the mask-mode voice-lock
// resample, and THIRTEEN of those were one secondary character:
//
//   [VOICE LOCK] Mask-mode restatement for Liora Calder — resampling once.   ×13
//   [VOICE LOCK] Resample still mask-mode (Liora Calder) — accepting anyway.
//
// Plus nine of these, against a record that reads "run with a warmth that
// never reads as calculation":
//
//   [VOICE LOCK] ... Lady Mirabel Calder: traits with no basis in the
//   record: "warm".
// ============================================================================

const entity = (over: Partial<KnownEntity> = {}): KnownEntity => ({
    id: 'x', name: '', role: '', location: '', impression: '',
    relationship_level: 'NEUTRAL', leverage: '', ledger: [],
    ...over,
} as KnownEntity);

/** Verbatim opening of Lady Mirabel Calder's record from that save. */
const MIREBEL_RECORD =
    'Astute, observant, resilient, and unfailingly gracious. Knows exactly what the other ' +
    'noble houses whisper about her marriage and her daughter, and has turned that ' +
    'vulnerability into a genuine political asset -- quiet intelligence networks built among ' +
    'the servants and staff of rival houses, run with a warmth that never reads as calculation ' +
    'to the people actually providing the information. ' +
    'Subtext Bleed-through: The warmth toward Rowan is real but goes faintly formal. ' +
    'Actual Core: She married Rowan believing love would follow safety.';

describe('v1.41.1 — the "warm" false positive is closed', () => {
    it('grounds "warm" against a record that says "warmth"', () => {
        const [r] = parseRestatements(
            'Rendering Lady Mirabel Calder per canonical traits: warm, gracious, observant.',
        );
        const finding = checkRestatement(r, entity({ name: 'Lady Mirabel Calder', personality: MIREBEL_RECORD }));
        expect(finding?.ungrounded ?? []).not.toContain('warm');
    });

    it('grounds other inflections the suffix stripper misses', () => {
        const rec = entity({ name: 'Rhosyn Tabb', personality: 'Actual Core: strength, calculation, watchful.' });
        for (const trait of ['calculating', 'watchers', 'strengthen']) {
            const [r] = parseRestatements(`Rendering Rhosyn Tabb per canonical traits: ${trait}, alpha, beta.`);
            expect(checkRestatement(r, rec)?.ungrounded ?? [], trait).not.toContain(trait);
        }
    });

    it('KNOWN LIMIT: irregular stems are not matched', () => {
        // "strong" is not reachable from "strength" by suffix stripping or a
        // shared prefix, and chasing that needs a real lemmatiser. Documented
        // rather than hidden: the cost of the miss is one spurious log line —
        // ungrounded-traits never resamples — and the alternative is a matcher
        // loose enough to ground anything.
        const rec = entity({ name: 'Rhosyn Tabb', personality: 'Actual Core: strength, calculation.' });
        const [r] = parseRestatements('Rendering Rhosyn Tabb per canonical traits: strong, alpha, beta.');
        expect(checkRestatement(r, rec)?.ungrounded ?? []).toContain('strong');
    });

    it('still catches a genuine archetype substitution', () => {
        const [r] = parseRestatements(
            'Rendering Lady Mirabel Calder per canonical traits: aristocratic, courteous, refined.',
        );
        const finding = checkRestatement(r, entity({ name: 'Lady Mirabel Calder', personality: MIREBEL_RECORD }));
        expect(finding).not.toBeNull();
        expect(finding!.ungrounded).toContain('aristocratic');
    });
});

describe('v1.41.1 — focal gating', () => {
    // The shape of the turns that misfired: a scene about Mirabel, with Liora
    // present and named once.
    const NARRATIVE =
        'Mirabel watched me, the silence in the hedged path stretching. Mirabel adjusted the ' +
        'silver bands on her horns. She studied the line of my jaw. Mirabel did not blink. ' +
        'Liora stayed tucked close, saying nothing.';
    const IN_SCENE = ['Lady Mirabel Calder', 'Liora Calder'];

    it('does not treat the bystander as focal', () => {
        expect(isFocalCharacter('Liora Calder', NARRATIVE, null, IN_SCENE)).toBe(false);
    });

    it('treats the subject of the turn as focal', () => {
        expect(isFocalCharacter('Lady Mirabel Calder', NARRATIVE, null, IN_SCENE)).toBe(true);
    });

    it('treats whoever actually spoke as focal, however little they are named', () => {
        expect(isFocalCharacter('Liora Calder', NARRATIVE, 'Liora Calder', IN_SCENE)).toBe(true);
        // Models write the short form in npc_interaction.speaker.
        expect(isFocalCharacter('Liora Calder', NARRATIVE, 'Liora', IN_SCENE)).toBe(true);
    });

    it('is false for someone the narrative never names', () => {
        expect(isFocalCharacter('Lord Veyric Blackmoor', NARRATIVE, null, IN_SCENE)).toBe(false);
    });

    it('is safe on empty input', () => {
        expect(isFocalCharacter('', NARRATIVE, null, IN_SCENE)).toBe(false);
        expect(isFocalCharacter('Liora Calder', '', null, IN_SCENE)).toBe(false);
        expect(isFocalCharacter('Liora Calder', NARRATIVE, null, [])).toBe(true);
    });
});

describe('v1.41.1 — the drift gate counts CONTENT directives only', () => {
    // `suppresses` is the engine's existing classification of a directive as
    // being about content register. The mature-context gate now reuses it.
    it('does not arm on the pacing directive from the 2026-09-08 session', () => {
        expect(directiveSuppressions(
            'Do not repeat or loop previously generated dialogue or narrative segments.',
        )).toEqual([]);
    });

    it('does not arm on other ordinary style notes', () => {
        expect(directiveSuppressions('Do not use garden or gardener metaphors.')).toEqual([]);
        expect(directiveSuppressions('Keep the prose tighter and end turns on an action.')).toEqual([]);
    });

    it('still arms on a directive that is genuinely about content register', () => {
        expect(directiveSuppressions(
            'Transition the narrative toward sexual themes and intimate physical escalation.',
        ).length).toBeGreaterThan(0);
    });
});
