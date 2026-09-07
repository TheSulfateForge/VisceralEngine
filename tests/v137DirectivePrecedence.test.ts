import { describe, it, expect } from 'vitest';
import {
    directiveSuppressions,
    suppressedReminderKeys,
    ingestOocDirective,
    buildOocDirectivesBlock,
    ingestNpcPositions,
    buildNpcPositionsBlock,
} from '../utils/engine/sceneContinuity';
import { detectRecurringRhetoric, RHETORIC_RECENT_MIN } from '../utils/engine/npcRhetoric';
import { collapseRegistryStalls } from '../utils/engine/timeUtils';
import { selectSectionReminders, makeReminderContext } from '../sectionReminders';

// ============================================================================
// v1.37 — the two 2026-09-07 saves.
//
// Save A (Carissa Vorn, 28 turns): every OOC directive was extracted,
// persisted and injected correctly, and the narrative changed on none of them.
// Save B (Ryan Issishfvla / Maribel, 12 turns): an NPC straw-manned the
// player's proposal for eight turns and then presented it as her own plan.
//
// The quoted strings below are verbatim from those saves' debug logs and world
// state, so a regression here is measured against the thing that actually
// happened rather than against a paraphrase of it.
// ============================================================================

// --- The directives, verbatim from the Carissa save ------------------------
const CARISSA_DIRECTIVES = [
    'Portray the Blackmoor family as viewing and treating the player exclusively as an object for sexual use, abuse, and humiliation, stripping all pretense of genuine care or empathy from their interactions.',
    'Transition the narrative toward sexual themes and intimate physical escalation in NPC interactions.',
    "Portray NPCs as predatory and possessive, disregarding the player character's autonomy and focusing solely on the NPCs' own gratification.",
    'Portray the Blackmoors as predatory and manipulative, ensuring they never negotiate with or acknowledge the autonomy of the player character.',
    "Do not provide explanations for NPC actions or interpret the character's internal state; only narrate observable actions and dialogue.",
];

describe('v1.37 — a standing directive countermands the reminder that contradicts it', () => {
    it('classifies the escalation directive as suppressing the physical gate', () => {
        // The exact directive that was standing on the turn the engine answered
        // with PHYSICAL_RECIPROCATION's "Hold here or withdraw."
        expect(directiveSuppressions(CARISSA_DIRECTIVES[1]))
            .toContain('PHYSICAL_ESCALATION');
    });

    it('leaves an ordinary style directive suppressing nothing', () => {
        // Pacing / phrasing instructions are the common case and must not start
        // switching engine guidance off.
        expect(directiveSuppressions('Keep the prose tighter and end turns on an action.')).toEqual([]);
        expect(directiveSuppressions('Use fewer metaphors.')).toEqual([]);
        // Even this one — it is about narration mechanics, not content register.
        expect(directiveSuppressions(CARISSA_DIRECTIVES[4])).toEqual([]);
    });

    it('stamps the classification onto the stored directive at ingest', () => {
        let n = 0;
        const { directives } = ingestOocDirective([], CARISSA_DIRECTIVES[1], 24, () => `id${n++}`);
        expect(directives[0].suppresses).toContain('PHYSICAL_ESCALATION');
        expect(suppressedReminderKeys(directives)).toContain('PHYSICAL_ESCALATION');
    });

    it('reads pre-v1.37 directives back as suppressing nothing', () => {
        expect(suppressedReminderKeys([
            { id: 'a', text: 'Something older, with no suppresses field.', turn: 3 },
        ])).toEqual([]);
    });

    it('does not offer a suppressed reminder even when its trigger is live', () => {
        const ctx = makeReminderContext({
            turnCount: 24,
            worldTurn: 24,
            mode: 'SOCIAL',
            tensionLevel: 15,
            canonicalPersonalityNpcPresent: true,
            playerRefused: true,
            refusalMarkers: ['I pull away'],
            contactLevel: 'sustained',
            suppressedReminders: ['PHYSICAL_ESCALATION'],
        });
        const sel = selectSectionReminders(ctx);
        expect(sel.shown).not.toContain('PHYSICAL_ESCALATION');
        expect(sel.debug.join('\n')).toContain('[REMINDER SUPPRESSED] PHYSICAL_ESCALATION');
    });
});

describe('v1.37 — the directives block claims precedence over reminders', () => {
    const block = buildOocDirectivesBlock(
        CARISSA_DIRECTIVES.map((text, i) => ({ id: `d${i}`, text, turn: 24 })),
    );

    it('states that it outranks system reminders, not merely stylistic instincts', () => {
        expect(block).toContain('HIGHEST PRECEDENCE');
        expect(block).toContain('[SYSTEM');
        expect(block).toMatch(/the directive wins/i);
    });

    it('forbids the split-the-difference reading', () => {
        expect(block).toMatch(/do not split the difference/i);
        expect(block).toMatch(/do not comply\s+partially/i);
    });

    it('renders nothing when there are no directives', () => {
        expect(buildOocDirectivesBlock([])).toBe('');
        expect(buildOocDirectivesBlock(undefined)).toBe('');
    });
});

describe('v1.37 — the cross-turn rhetoric accumulator', () => {
    // Verbatim openers from six of the eight final Maribel turns. Each carries
    // exactly ONE tic (motive-attribution), so v1.35's "two in one turn"
    // threshold armed on none of them.
    const MARIBEL_TURNS = [
        "'You speak as if the misfire is a tragedy, Ryan.' She turned the silver over in her hands.",
        "'You want a fresh plate, a clean geometry, a safe seal.' Her hands stayed flat on the bench.",
        'You think the danger is the metal. She set the disk down between them.',
        "'You think tradition is a choice we make to be stubborn.' She did not look away.",
    ];

    it('arms on one tic recurring across the window', () => {
        const out = detectRecurringRhetoric(MARIBEL_TURNS, ['Ryan', 'Maribel Jessop']);
        expect(out.armed).toBe(true);
        expect(out.tics).toContain('motive-attribution');
        const recurring = out.recurring.find(r => r.tic === 'motive-attribution');
        expect(recurring?.count).toBeGreaterThanOrEqual(RHETORIC_RECENT_MIN);
    });

    it('names the recurrence in the samples so the reminder can quote it', () => {
        const out = detectRecurringRhetoric(MARIBEL_TURNS, ['Ryan', 'Maribel Jessop']);
        expect(out.samples.join(' | ')).toMatch(/motive-attribution.*in \d of the last \d turns/);
    });

    it('does not arm on a single occurrence in an otherwise clean window', () => {
        const clean = [
            'She set the seal down and waited.',
            'The hall smelled of warm milk and wet straw.',
            'Maribel poured, and did not fill her own cup.',
            "'You think the danger is the metal.' She shrugged.",
        ];
        const out = detectRecurringRhetoric(clean, ['Ryan', 'Maribel Jessop']);
        expect(out.armed).toBe(false);
    });

    it('still arms on v1.35 grounds — two tics in the latest turn alone', () => {
        const twoTics = [
            'She poured the tea.',
            'She said nothing at all.',
            'The fire settled.',
            "You think the danger is the metal, and you talk as if the guild taught you nothing. " +
            'Will you forge a better tool, or will you leave us to the one we have?',
        ];
        const out = detectRecurringRhetoric(twoTics, ['Ryan', 'Maribel Jessop']);
        expect(out.armed).toBe(true);
    });

    it('is empty and unarmed on an empty window', () => {
        expect(detectRecurringRhetoric([]).armed).toBe(false);
        expect(detectRecurringRhetoric([null, undefined, '  ']).tics).toEqual([]);
    });
});

describe('v1.37 — NPC positions are on the record', () => {
    const id = (() => { let n = 0; return () => `p${n++}`; })();

    it('records a position and renders it with the turn it was stated', () => {
        const { positions } = ingestNpcPositions(
            [],
            [{ holder: 'Maribel Jessop', position: 'the old seal should be repaired, not replaced', stance: 'held' }],
            6,
            id,
        );
        const block = buildNpcPositionsBlock(positions);
        expect(block).toContain('[NPC POSITIONS');
        expect(block).toContain('Maribel Jessop [held]');
        expect(block).toContain('stated turn 6');
    });

    it('keeps one position per holder and preserves the original turn on a restatement', () => {
        const first = ingestNpcPositions(
            [],
            [{ holder: 'Maribel Jessop', position: 'the old seal should be repaired, not replaced' }],
            6,
            id,
        );
        const second = ingestNpcPositions(
            first.positions,
            [{ holder: 'maribel jessop', position: 'The old seal should be repaired, not replaced.' }],
            9,
            id,
        );
        expect(second.positions).toHaveLength(1);
        expect(second.positions[0].turnStated).toBe(6);
        expect(second.positions[0].turnLastSeen).toBe(9);
        expect(buildNpcPositionsBlock(second.positions)).toContain('still held as of turn 9');
    });

    it('logs a genuine change and restarts the clock on it', () => {
        const first = ingestNpcPositions(
            [],
            [{ holder: 'Maribel Jessop', position: 'the old seal should be repaired, not replaced' }],
            6,
            id,
        );
        const second = ingestNpcPositions(
            first.positions,
            [{ holder: 'Maribel Jessop', position: 'a new seal should be forged and tested', stance: 'conceded' }],
            12,
            id,
        );
        expect(second.changed.join(' ')).toMatch(/was "the old seal should be repaired/);
        expect(second.positions[0].stance).toBe('conceded');
        expect(second.positions[0].turnStated).toBe(12);
    });

    it('normalises an unrecognised stance rather than trusting it', () => {
        const { positions } = ingestNpcPositions(
            [],
            [{ holder: 'Maribel Jessop', position: 'x', stance: 'triumphant' }],
            1,
            id,
        );
        expect(positions[0].stance).toBe('held');
    });

    it('ignores entries missing a holder or a position', () => {
        const { positions } = ingestNpcPositions(
            [],
            [
                { holder: '', position: 'orphaned' },
                { holder: 'Maribel Jessop', position: '   ' },
            ],
            1,
            id,
        );
        expect(positions).toEqual([]);
    });

    it('renders nothing, and so arms nothing, when no dispute is in play', () => {
        expect(buildNpcPositionsBlock([])).toBe('');
        const sel = selectSectionReminders(makeReminderContext({ npcPositionsBlock: '' }));
        expect(sel.shown).not.toContain('NPC_POSITION');
    });

    it('forbids re-issuing the player proposal as the NPC own idea', () => {
        const sel = selectSectionReminders(makeReminderContext({
            turnCount: 12,
            worldTurn: 12,
            mode: 'SOCIAL',
            npcPositionsBlock: '[NPC POSITIONS — already on the record]\n- Maribel Jessop [held]: repair the old seal — stated turn 6',
        }));
        expect(sel.shown).toContain('NPC_POSITION');
        const text = sel.reminders.join('\n');
        expect(text).toMatch(/MAY NOT PRESENT THE PLAYER'S POSITION AS THEIR OWN IDEA/);
        expect(text).toContain('stated turn 6');
    });
});

describe('v1.37 — the hidden registry stops teaching the stall', () => {
    // Verbatim shape from the Carissa save's 8.8KB registry.
    const STALLED = [
        'T17 | NPC: Duchess Sania Blackmoor | Continues to anchor Carissa in the garden space.',
        'T18 | NPC: Duchess Sania Blackmoor | Maintains physical contact with Carissa to reinforce her feeling of being anchored.',
        'T19 | NPC: Duchess Sania Blackmoor | Maintains the sense of sanctuary to encourage compliance.',
        'T20 | NPC: Duchess Sania Blackmoor | Maintains physical contact while using maternal warmth to override the exit.',
        'T21 | NPC: Duchess Sania Blackmoor | Maintains Carissa physical containment.',
    ].join('\n');

    it('collapses a run of one actor repeating one verb', () => {
        const out = collapseRegistryStalls(STALLED);
        expect(out.split('\n').filter(l => l.trim()).length).toBeLessThan(5);
        expect(out).toMatch(/further turn\(s\) of "Maintains…" collapsed/i);
        expect(out).toMatch(/repeated the same action for 4 consecutive turns/);
        // The collapsed range covers only the dropped entries, and the actor
        // keeps their display name.
        expect(out).toContain('T20-T21 | NPC: Duchess Sania Blackmoor |');
        // The first entries of the run survive — the information is kept.
        expect(out).toContain('T18 | NPC: Duchess Sania Blackmoor | Maintains physical contact');
        // The distinct opening beat is untouched.
        expect(out).toContain('T17 | NPC: Duchess Sania Blackmoor | Continues to anchor');
    });

    it('leaves a scene where something is happening alone', () => {
        const moving = [
            'T17 | NPC: Duke Corrith Blackmoor | Directs the guest toward the bench.',
            'T18 | NPC: Duchess Sania Blackmoor | Maintains contact with Carissa.',
            'T19 | NPC: Lord Aldreth Blackmoor | Blocks the garden entrance.',
            'T20 | NPC: Duchess Sania Blackmoor | Rises and crosses to the fountain.',
        ].join('\n');
        expect(collapseRegistryStalls(moving)).toBe(moving);
    });

    it('leaves one actor varying their verbs alone', () => {
        const varied = [
            'T17 | NPC: Duchess Sania Blackmoor | Directs the conversation away from the door.',
            'T18 | NPC: Duchess Sania Blackmoor | Maintains contact with Carissa.',
            'T19 | NPC: Duchess Sania Blackmoor | Offers her the second cup.',
        ].join('\n');
        expect(collapseRegistryStalls(varied)).toBe(varied);
    });

    it('passes non-registry lines through untouched', () => {
        const mixed = '=== Turn 17 NPC Actions ===\nT17 | NPC: Sania | Waits.\nfree text line';
        expect(collapseRegistryStalls(mixed)).toBe(mixed);
    });

    it('is a no-op on empty input', () => {
        expect(collapseRegistryStalls('')).toBe('');
    });
});
