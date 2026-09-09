import { describe, it, expect } from 'vitest';
import { findAliasMatchedEntities, ALIAS_MATCH_LIMIT } from '../utils/ragEngine';
import { getResponseSchema } from '../schemas/responseSchema';
import { capSheetBySections } from '../utils/engine/sheetSections';
import {
    isSceneScopedDirective,
    expireSceneScopedDirectives,
    ingestOocDirective,
    buildOocDirectivesBlock,
} from '../utils/engine/sceneContinuity';
import { selectSectionReminders, makeReminderContext, SCENE_EXHAUSTED_TURNS } from '../sectionReminders';
import type { KnownEntity } from '../types';

// ============================================================================
// v1.42 — the 2026-09-09 review (Ryan Bloodfeather, 67 turns).
//
// Four defects, all measured from that save:
//
//   1. The token "house" force-activated 21 of 51 entities. Entities block ran
//      to a median of 23,804 chars and a max of 58,886; 61% of turns exceeded
//      20,000.
//   2. `location_update` was deleted from the SOCIAL schema variant. 47 of 65
//      turns ran SOCIAL, the location never changed in 49 turns, and a standing
//      directive to move the scene to the garden went unfulfilled for 14 turns.
//   3. That directive — scoped to one scene — was binding forever.
//   4. `capSheetBySections` returned 1291 chars against a 460 cap.
// ============================================================================

const entity = (name: string, role: string, personality = 'Actual Core: a person.'): KnownEntity => ({
    id: name.toLowerCase().replace(/\s+/g, '_'), name, role,
    location: '', impression: '', relationship_level: 'NEUTRAL', leverage: '', ledger: [],
    personality,
} as KnownEntity);

/** Roles verbatim from that save's roster. */
const ROSTER: KnownEntity[] = [
    entity('Mirabel Calder', 'matriarch of house calder'),
    entity('Liora Calder', 'noble heir; rare second-generation hucow'),
    entity('Lord Prosper Calder', 'patriarch of house calder; minor noble'),
    entity('Duke Corrith Blackmoor', 'duke of wolfsmere; head of house blackmoor'),
    entity('Duchess Sania Blackmoor', 'duchess of wolfsmere; matriarch of house blackmoor'),
    entity('Lord Aldreth Blackmoor', 'middle son of house blackmoor'),
    entity('Lord Veyric Blackmoor', 'eldest son of house blackmoor; heir apparent'),
    entity('Lord Nicor Blackmoor', 'youngest son of house blackmoor'),
    entity('Count Aster Verancourt', 'count of sablebrook; head of house verancourt'),
    entity('Countess Lyrelle Verancourt', 'matriarch of house verancourt'),
    entity('Cassian Verancourt', 'eldest son of house verancourt; heir apparent'),
    entity('Lirien Verancourt', 'middle son of house verancourt'),
    entity('Theron Verancourt', 'youngest son of house verancourt'),
    entity('King Osric Drevast', 'king of house drevast; ceremonial head of state of the verdant compact'),
    entity('Queen Ondine Drevast', 'queen of house drevast; mother of callan, anwen, and vianne'),
    entity('Anwen Drevast', 'crown princess of house drevast; elder twin sister to callan'),
    entity('Callan Drevast', 'crown prince of house drevast; heir to a ceremonial throne'),
    entity('Vianne Drevast', 'crown princess of house drevast; younger sister to the twins'),
    entity('Vesna Kamenova', 'head of house kamenova; earth mage; widow'),
    entity('Dragomir Kamenova', 'second in line to house kamenova; light mage'),
    entity('Tihana Kamenova', 'formal heir to house kamenova; wind mage'),
    entity('Dervla Quill', 'licensed dancer and companion at a regulated pleasure house'),
];

/** The player input, verbatim, that matched 21 of them. */
const THE_INPUT = 'Inside my home Aldwyn House, on my couch inside my common room inside my home';

describe('v1.42 — one common word no longer floods the prompt', () => {
    it('does not match the roster on the word "house"', () => {
        const matched = findAliasMatchedEntities(THE_INPUT, [], ROSTER);
        expect(matched.length).toBeLessThanOrEqual(2);
        expect(matched.map(e => e.name)).not.toContain('King Osric Drevast');
        expect(matched.map(e => e.name)).not.toContain('Dervla Quill');
    });

    it('leaves the other structural words inert too', () => {
        for (const input of [
            'I take my lady to the great hall and speak with the guard at the door.',
            'The noble heir of my own line is my concern, not theirs.',
            'I am the head of my own household and the master of this estate.',
        ]) {
            expect(findAliasMatchedEntities(input, [], ROSTER).length, input).toBeLessThanOrEqual(2);
        }
    });

    it('STILL matches when the player names someone', () => {
        const matched = findAliasMatchedEntities('I turn to Mirabel and to Liora.', [], ROSTER);
        const names = matched.map(e => e.name);
        expect(names).toContain('Mirabel Calder');
        expect(names).toContain('Liora Calder');
    });

    it('still matches a role stated as a real phrase', () => {
        const matched = findAliasMatchedEntities(
            'I ask to speak with the matriarch of house verancourt.', [], ROSTER,
        );
        expect(matched.map(e => e.name)).toContain('Countess Lyrelle Verancourt');
    });

    it('still matches on two distinct distinctive role tokens', () => {
        const matched = findAliasMatchedEntities(
            'Word reaches me of the duchess of wolfsmere.', [], ROSTER,
        );
        expect(matched.map(e => e.name)).toContain('Duchess Sania Blackmoor');
    });

    it('caps force-activation as a backstop, keeping named matches first', () => {
        const named = 'Mirabel Liora Prosper Corrith Sania Aldreth Veyric Nicor Aster Lyrelle Cassian Lirien';
        const matched = findAliasMatchedEntities(named, [], ROSTER);
        expect(matched.length).toBeLessThanOrEqual(ALIAS_MATCH_LIMIT);
    });
});

describe('v1.42 — a SOCIAL scene can report that it moved', () => {
    it('keeps location_update in SOCIAL', () => {
        expect((getResponseSchema('SOCIAL') as any).properties.location_update).toBeDefined();
    });

    it('keeps it in NARRATIVE and TENSION, and still drops it in COMBAT', () => {
        expect((getResponseSchema('NARRATIVE') as any).properties.location_update).toBeDefined();
        expect((getResponseSchema('TENSION') as any).properties.location_update).toBeDefined();
        expect((getResponseSchema('COMBAT') as any).properties.location_update).toBeUndefined();
    });
});

describe('v1.42 — scene-scoped directives expire with the scene', () => {
    const SCENE_DIRECTIVE =
        'Narrate the scene as taking place in the garden or backyard of the Verancourt Estate.';
    const STANDING_DIRECTIVE =
        'Do not repeat or loop previously generated dialogue or narrative segments.';

    it('recognises the directive from the save as scene-scoped', () => {
        expect(isSceneScopedDirective(SCENE_DIRECTIVE)).toBe(true);
    });

    it('leaves a genuine standing rule permanent', () => {
        expect(isSceneScopedDirective(STANDING_DIRECTIVE)).toBe(false);
        expect(isSceneScopedDirective('Do not use garden or gardener metaphors.')).toBe(false);
        expect(isSceneScopedDirective(
            'Portray the Blackmoors as predatory and manipulative.',
        )).toBe(false);
    });

    it('stamps the scope at ingest', () => {
        let n = 0;
        const { directives } = ingestOocDirective([], SCENE_DIRECTIVE, 53, () => `d${n++}`);
        expect(directives[0].sceneScoped).toBe(true);
    });

    it('drops only the scene-scoped one when the scene changes', () => {
        const dirs = [
            { id: 'a', text: STANDING_DIRECTIVE, turn: 29 },
            { id: 'b', text: SCENE_DIRECTIVE, turn: 53, sceneScoped: true },
        ];
        const { directives, expired } = expireSceneScopedDirectives(dirs, true);
        expect(directives).toHaveLength(1);
        expect(directives[0].text).toBe(STANDING_DIRECTIVE);
        expect(expired).toEqual([SCENE_DIRECTIVE]);
    });

    it('keeps everything while the scene continues', () => {
        const dirs = [{ id: 'b', text: SCENE_DIRECTIVE, turn: 53, sceneScoped: true }];
        expect(expireSceneScopedDirectives(dirs, false).directives).toHaveLength(1);
    });

    it('reads pre-v1.42 directives back as permanent', () => {
        const dirs = [{ id: 'a', text: SCENE_DIRECTIVE, turn: 53 }];
        expect(expireSceneScopedDirectives(dirs, true).expired).toEqual([]);
    });

    it('marks the scope in the prompt block', () => {
        const block = buildOocDirectivesBlock([
            { id: 'b', text: SCENE_DIRECTIVE, turn: 53, sceneScoped: true },
        ]);
        expect(block).toMatch(/THIS SCENE — expires when the scene changes/);
    });
});

describe('v1.42 — a single oversized section is trimmed, not multiplied', () => {
    // Ophelia Slattery's shape: one section far longer than the mentioned cap.
    const LONG = 'Actual Core: ' + 'She keeps a ledger of every favour owed to her in the district. '.repeat(20);

    it('respects the cap', () => {
        expect(capSheetBySections(LONG, 460).length).toBeLessThanOrEqual(460);
    });

    it('says the section is only partial', () => {
        const out = capSheetBySections(LONG, 460);
        expect(out).toMatch(/SECTION TRIMMED — this is the opening of "Actual Core", not the whole of it/);
    });

    it('leaves a record that fits alone', () => {
        expect(capSheetBySections('Actual Core: brief.', 460)).toBe('Actual Core: brief.');
    });
});

describe('v1.42 — an exhausted scene is told to end', () => {
    const ctx = (over = {}) => makeReminderContext({
        turnCount: 60, worldTurn: 60, mode: 'SOCIAL', tensionLevel: 10,
        canonicalPersonalityNpcPresent: true, ...over,
    });

    it('fires after a long unchanged location', () => {
        const sel = selectSectionReminders(ctx({ sceneStaticTurns: SCENE_EXHAUSTED_TURNS }));
        const text = sel.reminders.join('\n');
        expect(sel.shown).toContain('SCENE_EXHAUSTED');
        expect(text).toContain('THIS SCENE HAS RUN ITS COURSE');
        expect(text).toMatch(/\[SCENE STATIC\] no location change in 12 consecutive turns/);
    });

    it('fires immediately after a repetition re-roll', () => {
        const sel = selectSectionReminders(ctx({ sceneStaticTurns: 2, repeatedLastTurn: true }));
        expect(sel.shown).toContain('SCENE_EXHAUSTED');
        expect(sel.reminders.join('\n')).toMatch(/previous turn repeated itself/);
    });

    it('tells the model to REPORT a move, not just narrate one', () => {
        const text = selectSectionReminders(ctx({ sceneStaticTurns: 49 })).reminders.join('\n');
        expect(text).toContain('location_update');
        expect(text).toMatch(/a move you narrate but do not\s+report/);
    });

    it('does not fire on an ordinary scene', () => {
        const sel = selectSectionReminders(ctx({ sceneStaticTurns: 3 }));
        expect(sel.shown).not.toContain('SCENE_EXHAUSTED');
    });
});
