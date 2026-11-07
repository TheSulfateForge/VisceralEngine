// ============================================================================
// v1.52 — time from activities / prose / player notes, verbatim echo,
// record check, NPC appearance in the prompt, narrator "match", DEFAULT_TIME.
// Fixtures are real turns from visceral_backup_ryan_westcross_2026_11_07_1.json
// (deepseek-v4.1-flash via OpenRouter, temperature 0.70).
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    estimateActivityMinutes,
    estimateTimeFloor,
    extractNarratedClockTimes,
    checkNarratedClock,
    parseTimeExpression,
    parsePlayerTimeNote,
    resolvePlayerTimeNote,
    deriveWorldTime,
} from '../utils/engine/timeUtils';
import { timeProgressionStep } from '../utils/pipeline/steps/02-timeProgression';
import { detectVerbatimEcho, ECHO_MIN_WORDS } from '../utils/driftDetector';
import { strictNameIn, findUngroundedIntroductions } from '../utils/mentionSentinel';
import { appearanceForPrompt, buildEntityContext, buildRecordCheckReminder, buildClockLine, ESTABLISHED_EVENTS_HEADER } from '../utils/promptUtils';
import { resolveNarrationPerson } from '../utils/engine/narrationPov';
import { DEFAULT_TIME } from '../slices/gameSlice';
import { buildMontageInstruction } from '../utils/montagePrompt';
import type { KnownEntity, GameWorld, Character } from '../types';

const FX: Record<string, string> = JSON.parse(
    readFileSync(new URL('./fixtures_v152_westcross.json', import.meta.url), 'utf8'),
);

/** Absolute minutes for Day 20, hh:mm — where the save's morning took place. */
const day20 = (h: number, m: number) => 19 * 1440 + h * 60 + m;

describe('v1.52 — activity floors', () => {
    it('"bathe and groom" is at least 30 minutes', () => {
        const a = estimateActivityMinutes(FX.U102);
        expect(a.minutes).toBe(30);
        expect(a.labels).toEqual(['bath', 'grooming']);
    });

    it('"I\'ll take breakfast in the garden" is a meal — even inside a quote', () => {
        // The meal is named inside the player's quoted line in this save, so
        // check the non-quoted half carries it too.
        expect(estimateActivityMinutes('I throw on linen pants and take breakfast in the garden.').minutes).toBe(20);
    });

    it('speech in quotes is not an activity', () => {
        expect(estimateActivityMinutes('"I bathed yesterday," I say.').minutes).toBe(0);
    });

    it('feeds the existing floor', () => {
        const f = estimateTimeFloor('', FX.U102, undefined, 'The Westcross Townhouse');
        expect(f.floor).toBe(30);
        expect(f.reasons.join(' ')).toMatch(/activities/);
    });
});

describe('v1.52 — the narration\'s own clock', () => {
    it('parses the time expressions the model actually uses', () => {
        expect(parseTimeExpression('a quarter to seven')).toBe(6 * 60 + 45);
        expect(parseTimeExpression('half past six')).toBe(6 * 60 + 30);
        expect(parseTimeExpression('seven')).toBe(7 * 60);
        expect(parseTimeExpression('ten minutes past four')).toBe(4 * 60 + 10);
        expect(parseTimeExpression('18:30')).toBe(18 * 60 + 30);
    });

    it('breakfast turn: "the bell at the corner of the lane struck seven" at 06:05 → +55m', () => {
        const times = extractNarratedClockTimes(FX.T101);
        expect(times.at(-1)?.minutes).toBe(7 * 60);
        const c = checkNarratedClock(FX.T101, day20(6, 5), 1);
        expect(c.floor).toBe(55);
    });

    it('bath turn: "the hall clock said a quarter to seven" at 06:07 → +38m', () => {
        const c = checkNarratedClock(FX.T103, day20(6, 7), 30);
        expect(c.floor).toBe(38);
    });

    it('appointments are not the current time ("wants you at the tenth bell")', () => {
        expect(extractNarratedClockTimes('The palace wants you at the tenth bell for the rehearsal.')).toEqual([]);
        expect(extractNarratedClockTimes('"Be back when the bell strikes ten," she said.')).toEqual([]);
    });

    it('waking turn: "the bell at the corner struck six" at 06:05 needs nothing', () => {
        expect(checkNarratedClock(FX.T99, day20(6, 5), 0).floor).toBe(0);
    });

    it('prose behind the clock is a conflict, not a rewind', () => {
        const c = checkNarratedClock('The bell struck six.', day20(7, 30), 2);
        expect(c.floor).toBe(0);
        expect(c.conflict).toMatch(/06:00/);
    });

    it('the time step applies it even past the SOCIAL cap, and records conflicts', () => {
        const run = (narrative: string, start: number, input: string, mode = 'SOCIAL') => {
            const ctx: any = {
                sanitisedResponse: { narrative, time_passed_minutes: 1, scene_mode: mode },
                playerInput: input,
                previousWorld: { time: deriveWorldTime(start), location: 'The Westcross Townhouse' },
                worldUpdate: {},
                debugLogs: [],
            };
            return timeProgressionStep.execute(ctx) as any;
        };
        const breakfast = run(FX.T101, day20(6, 5), FX.U100);
        expect(breakfast.newTime.hour).toBe(7);
        expect(breakfast.newTime.minute).toBe(0);
        const bath = run(FX.T103, day20(6, 7), FX.U102);
        expect(`${bath.newTime.hour}:${bath.newTime.minute}`).toBe('6:45');
        const behind = run('The bell struck six.', day20(7, 30), 'I wait.');
        expect(behind.worldUpdate.clockConflictNote).toMatch(/06:00/);
    });

    it('the next clock line carries the correction', () => {
        expect(buildClockLine({ hour: 7, minute: 31, day: 20 }, 'The narration said "struck six" (06:00).'))
            .toMatch(/CLOCK CORRECTION/);
        expect(buildClockLine({ hour: 7, minute: 31, day: 20 })).not.toMatch(/CLOCK CORRECTION/);
    });
});

describe('v1.52 — player time notes', () => {
    it('reads "[IT is 6:06AM]"', () => {
        const n = parsePlayerTimeNote(FX.U102);
        expect(n).not.toBeNull();
        expect(n!.minutes).toBe(6 * 60 + 6);
        expect(n!.meridiem).toBe('am');
    });

    it('reads other spellings and ignores plain brackets', () => {
        expect(parsePlayerTimeNote('[time: 18:30] I go out')?.minutes).toBe(18 * 60 + 30);
        expect(parsePlayerTimeNote('[It is half past six in the evening]')?.minutes).toBe(18 * 60 + 30);
        expect(parsePlayerTimeNote('[OOC: stop repeating yourself]')).toBeNull();
    });

    it('lands on the nearest occurrence', () => {
        // Clock had run ahead to 07:00; the player says 6:06 AM → back to 06:06 today.
        expect(resolvePlayerTimeNote({ minutes: 366, meridiem: 'am' }, day20(7, 0))).toBe(day20(6, 6));
        // No am/pm at 05:50 → 06:06 the same morning, not 18:06.
        expect(resolvePlayerTimeNote({ minutes: 366, meridiem: null }, day20(5, 50))).toBe(day20(6, 6));
    });
});

describe('v1.52 — verbatim echo', () => {
    it('catches Vesna\'s line repeated two turns later', () => {
        const e = detectVerbatimEcho(FX.T10, [FX.T6, FX.T26]);
        expect(e.echoed).toBe(true);
        expect(e.words).toBeGreaterThanOrEqual(ECHO_MIN_WORDS);
        expect(e.fragment).toMatch(/we have reached terms/);
    });

    it('catches Tihana\'s "I came down those stairs" in back-to-back turns', () => {
        const e = detectVerbatimEcho(FX.T64, [FX.T62]);
        expect(e.echoed).toBe(true);
        expect(e.distance).toBe(1);
        expect(e.words).toBeGreaterThanOrEqual(30);
    });

    it('catches Ordric\'s note quoted again at breakfast', () => {
        expect(detectVerbatimEcho(FX.T101, [FX.T99]).echoed).toBe(true);
    });

    it('leaves stock gestures alone ("she looked at me the way she had looked at the")', () => {
        expect(detectVerbatimEcho(FX.T26, [FX.T24]).echoed).toBe(false);
        expect(detectVerbatimEcho(FX.T84, [FX.T82]).echoed).toBe(false);
    });

    it('does not count words the player wrote', () => {
        const player = 'I would have been fine with a simple service instead of all the pageantry and the procession and the whole of it';
        const prior = `He said: ${player}.`;
        expect(detectVerbatimEcho(`I told him: ${player}. Then I went out.`, [prior], [player]).echoed).toBe(false);
    });
});

const mk = (over: Partial<KnownEntity>): KnownEntity => ({
    id: over.id ?? `npc_${(over.name ?? 'x').toLowerCase().replace(/\s+/g, '_')}`,
    name: 'Test NPC',
    role: 'villager',
    location: 'the square',
    impression: '',
    relationship_level: 'NEUTRAL',
    leverage: '',
    ledger: [],
    ...over,
} as KnownEntity);

const SARATH = mk({
    id: 'npc_sarath', name: 'Elowen Sarath', role: 'Archivist at the Drevast Archive', status: 'missing',
    appearance: FX.SARATH_APPEARANCE, personality: 'Performed Surface: exact. Actual Core: curious.',
});
const DRAGOMIR = mk({ id: 'npc_drag', name: 'Dragomir Kamenova', role: 'heir', status: 'distant', personality: 'Warm.' });
const VESNA = mk({ id: 'npc_vesna', name: 'Vesna Kamenova', role: 'Head of House Kamenova', status: 'distant', personality: 'Composed.' });

describe('v1.52 — record check for same-turn introductions', () => {
    it('strict names: full name or capitalised given name, never a shared surname', () => {
        expect(strictNameIn('Elowen Sarath is at the Archive', 'Elowen Sarath')).toBe(true);
        expect(strictNameIn('Elowen arrived', 'Elowen Sarath')).toBe(true);
        expect(strictNameIn('the Kamenova townhouse', 'Dragomir Kamenova')).toBe(false);
        expect(strictNameIn('Captain Maude Stonepaw', 'Captain Maude Stonepaw')).toBe(true);
    });

    it('Sarath brought on by Ordric with no record in the prompt → flagged', () => {
        const found = findUngroundedIntroductions(FX.T28, [SARATH, VESNA, DRAGOMIR], new Set(), [FX.T26, FX.U27]);
        expect(found.map(e => e.name)).toEqual(['Elowen Sarath']);
    });

    it('not flagged when her record was in the prompt, or she was named recently', () => {
        expect(findUngroundedIntroductions(FX.T28, [SARATH], new Set(['npc_sarath']), [FX.T26])).toEqual([]);
        expect(findUngroundedIntroductions(FX.T28, [SARATH], new Set(), ['Ask Elowen Sarath about it.'])).toEqual([]);
    });

    it('the resample reminder carries her recorded looks', () => {
        const r = buildRecordCheckReminder([SARATH]);
        expect(r).toMatch(/an elf of thirty-three/);
        expect(r).not.toMatch(/Naked/);
    });
});

describe('v1.52 — NPC appearance reaches the prompt', () => {
    it('clothed description only', () => {
        const a = appearanceForPrompt(FX.SARATH_APPEARANCE, 420);
        expect(a).toMatch(/elf of thirty-three/);
        expect(a).not.toMatch(/Naked/);
    });

    it('active and mentioned tiers render it', () => {
        const present = { ...SARATH, status: 'present' as const };
        expect(buildEntityContext([present])).toMatch(/Appearance \(CANONICAL[^)]*\): Willowy/);
        const ctx = buildEntityContext([SARATH], new Set(['npc_sarath']), new Set(['npc_sarath']));
        expect(ctx).toMatch(/\[MENTIONED[\s\S]*Appearance: Willowy/);
    });
});

describe('v1.52 — memories are labelled as settled history', () => {
    it('header forbids re-staging', () => {
        expect(ESTABLISHED_EVENTS_HEADER).toMatch(/already happened/);
        expect(ESTABLISHED_EVENTS_HEADER).toMatch(/re-sign, re-file/);
    });

    it('montages see the latest memories as already on record', () => {
        const world = {
            knownEntities: [],
            memory: [{ id: 'm1', fact: 'Filed the Westcross entail with the Crown chancery.', timestamp: '' }],
        } as unknown as GameWorld;
        const text = buildMontageInstruction(
            { unit: 'weeks', quantity: 2 } as any, 'work', { skills: [] } as unknown as Character, world,
        );
        expect(text).toMatch(/ALREADY ON RECORD[\s\S]*Filed the Westcross entail/);
    });
});

describe('v1.52 — narrator "match"', () => {
    it('the save\'s dialogue-heavy openings now resolve to first person', () => {
        expect(resolveNarrationPerson('match', [FX.U3], 'Ryan Westcross')).toBe('first');
        expect(resolveNarrationPerson('match', [FX.U3, FX.U5], 'Ryan Westcross')).toBe('first');
    });

    it('a player who names their character still gets third person', () => {
        expect(resolveNarrationPerson('match', ['Ryan walks to the door.', 'Ryan says nothing.'], 'Ryan Westcross')).toBe('third');
    });
});

describe('v1.52 — DEFAULT_TIME', () => {
    it('has every calendar field and the current display format', () => {
        expect(DEFAULT_TIME.totalMinutes).toBe(540);
        expect(DEFAULT_TIME.year).toBe(1);
        expect(DEFAULT_TIME.month).toBe(1);
        expect(DEFAULT_TIME.dayOfMonth).toBe(1);
        expect(DEFAULT_TIME.dayOfYear).toBe(1);
        expect(typeof DEFAULT_TIME.season).toBe('string');
        expect(DEFAULT_TIME.season.length).toBeGreaterThan(0);
        expect(DEFAULT_TIME.display).toMatch(/^Year 1, .*09:00$/);
    });
});
