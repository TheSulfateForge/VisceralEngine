import { describe, it, expect } from 'vitest';
import {
    advanceSocialGraph,
    buildSocialWebBlock,
    selectVisibleTies,
    selectSocialHookTie,
    tieKey,
} from '../utils/engine/socialGraph';
import { DEFAULT_PIPELINE, buildPipeline } from '../utils/pipeline/pipelineConfig';
import { socialGraphStep } from '../utils/pipeline/steps/18-socialGraph';
import { MAX_SOCIAL_TIES, SOCIAL_TIE_DECAY_TURNS } from '../config/engineConfig';
import type { TurnContext } from '../utils/pipeline/types';
import type {
    KnownEntity,
    Faction,
    SocialTie,
    RelationshipLevel,
    EntityStatus,
    GameWorld,
    ModelResponseSchema,
    DebugLogEntry,
    TimeMode,
} from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const npc = (
    id: string,
    overrides: Partial<KnownEntity> = {},
): KnownEntity => ({
    id,
    name: overrides.name ?? id,
    role: 'retainer',
    location: 'the hall',
    impression: '',
    relationship_level: 'NEUTRAL',
    leverage: '',
    ledger: [],
    status: 'present',
    ...overrides,
});

const tie = (
    from: string,
    to: string,
    overrides: Partial<SocialTie> = {},
): SocialTie => ({
    from,
    to,
    standing: 'NEUTRAL',
    basis: '',
    origin: 'derived',
    charge: 0,
    salience: 40,
    firstSeenTurn: 0,
    lastMovedTurn: 0,
    lastContactTurn: 0,
    ...overrides,
});

/** Run the pass n times, feeding ties forward, starting at `startTurn`. */
const runTurns = (
    n: number,
    entities: KnownEntity[],
    opts: {
        contention?: number;
        factions?: Faction[];
        ties?: SocialTie[];
        startTurn?: number;
    } = {},
): SocialTie[] => {
    let ties = opts.ties ?? [];
    const start = opts.startTurn ?? 1;
    for (let i = 0; i < n; i++) {
        ties = advanceSocialGraph({
            entities,
            factions: opts.factions ?? [],
            ties,
            turn: start + i,
            contention: opts.contention ?? 0,
        }).ties;
    }
    return ties;
};

const find = (ties: SocialTie[], from: string, to: string): SocialTie | undefined =>
    ties.find(t => tieKey(t.from, t.to) === tieKey(from, to));

// ---------------------------------------------------------------------------

describe('socialGraph — charge and the ratchet', () => {
    it('does not move a rung on a single turn of ordinary pressure', () => {
        const cast = [
            npc('mira', { relationship_level: 'WARM' }),
            npc('anwen', { relationship_level: 'WARM' }),
        ];
        const ties = runTurns(1, cast);
        const t = find(ties, 'mira', 'anwen');

        expect(t).toBeDefined();
        expect(t!.standing).toBe('NEUTRAL');
        expect(t!.charge).toBeGreaterThan(0);
        expect(t!.charge).toBeLessThan(1);
    });

    it('moves exactly one rung once charge accumulates past 1', () => {
        const cast = [
            npc('mira', { relationship_level: 'WARM' }),
            npc('anwen', { relationship_level: 'WARM' }),
        ];
        // +0.10/turn from alignment: ten turns is one rung, not two.
        const ties = runTurns(10, cast);
        const t = find(ties, 'mira', 'anwen')!;

        expect(t.standing).toBe('WARM');
        expect(t.charge).toBeLessThan(1);
    });

    it('never moves more than one rung in a single turn, however long the run', () => {
        const cast = [
            npc('mira', { relationship_level: 'DEVOTED' }),
            npc('anwen', { relationship_level: 'NEMESIS' }),
        ];
        let ties: SocialTie[] = [];
        const seen: RelationshipLevel[] = [];
        for (let turn = 1; turn <= 40; turn++) {
            ties = advanceSocialGraph({
                entities: cast,
                factions: [],
                ties,
                turn,
                contention: 0,
            }).ties;
            const t = find(ties, 'mira', 'anwen');
            if (t) seen.push(t.standing);
        }
        const ladder = ['NEMESIS', 'HOSTILE', 'COLD', 'NEUTRAL', 'WARM', 'ALLIED', 'DEVOTED'];
        for (let i = 1; i < seen.length; i++) {
            const jump = Math.abs(ladder.indexOf(seen[i]) - ladder.indexOf(seen[i - 1]));
            expect(jump).toBeLessThanOrEqual(1);
        }
    });

    it('clamps a multi-rung declared jump to one rung and logs it', () => {
        const cast = [npc('mira'), npc('anwen')];
        const { ties, logs } = advanceSocialGraph({
            entities: cast,
            factions: [],
            ties: [],
            turn: 5,
            contention: 0,
            declared: [
                { from: 'mira', to: 'anwen', standing: 'NEMESIS', basis: 'she saw the letter' },
            ],
        });
        const t = find(ties, 'mira', 'anwen')!;

        expect(t.standing).toBe('COLD');            // NEUTRAL → COLD, not → NEMESIS
        expect(t.basis).toBe('she saw the letter');
        expect(t.origin).toBe('declared');
        expect(logs.some(l => l.includes('RATCHET'))).toBe(true);
    });
});

describe('socialGraph — contention (F2)', () => {
    const devotedPair = () => [
        npc('mira', { relationship_level: 'DEVOTED' }),
        npc('anwen', { relationship_level: 'DEVOTED' }),
    ];

    it('at contention 0, two devoted co-located allies warm to each other', () => {
        const ties = runTurns(12, devotedPair(), { contention: 0 });
        const t = find(ties, 'mira', 'anwen')!;
        expect(t.standing).toBe('WARM');
    });

    it('at full contention, the same pair cools instead — and faster', () => {
        // Contention pressure is twice alignment's, so the same 12 turns that
        // buy one rung of warmth at contention 0 buy two rungs of cooling here.
        const ties = runTurns(12, devotedPair(), { contention: 1 });
        const t = find(ties, 'mira', 'anwen')!;
        expect(t.standing).toBe('HOSTILE');
    });

    it('does not contend when the pair is not in the same room', () => {
        const cast = [
            npc('mira', { relationship_level: 'DEVOTED' }),
            npc('anwen', { relationship_level: 'DEVOTED', location: 'the north road', status: 'distant' }),
        ];
        const ties = runTurns(12, cast, { contention: 1 });
        expect(find(ties, 'mira', 'anwen')).toBeUndefined();
    });

    it('does not contend below the contention floor', () => {
        const cast = [
            npc('mira', { relationship_level: 'WARM' }),
            npc('anwen', { relationship_level: 'WARM' }),
        ];
        const ties = runTurns(12, cast, { contention: 1 });
        const t = find(ties, 'mira', 'anwen')!;
        expect(t.standing).toBe('WARM');   // common cause, not rivalry
    });
});

describe('socialGraph — contact gate (F0)', () => {
    it('creates no tie between strangers in different places', () => {
        const cast = [
            npc('mira', { relationship_level: 'WARM' }),
            npc('anwen', { relationship_level: 'WARM', location: 'the far coast', status: 'distant' }),
        ];
        expect(runTurns(20, cast)).toHaveLength(0);
    });

    it('keeps an established tie drifting even at distance, at half rate', () => {
        const cast = [
            npc('mira', { relationship_level: 'WARM' }),
            npc('anwen', { relationship_level: 'WARM', location: 'the far coast', status: 'distant' }),
        ];
        const established = [tie('mira', 'anwen', { salience: 60 })];
        const near = runTurns(10, [cast[0], npc('anwen', { relationship_level: 'WARM' })]);
        const far = runTurns(10, cast, { ties: established });

        expect(find(near, 'mira', 'anwen')!.standing).toBe('WARM');
        expect(find(far, 'mira', 'anwen')!.standing).toBe('NEUTRAL');
        expect(find(far, 'mira', 'anwen')!.charge).toBeGreaterThan(0);
    });

    it('drops ties whose endpoints have left play', () => {
        const cast = [npc('mira'), npc('anwen', { status: 'dead' as EntityStatus })];
        const ties = runTurns(1, cast, { ties: [tie('mira', 'anwen', { standing: 'HOSTILE' })] });
        expect(ties).toHaveLength(0);
    });
});

describe('socialGraph — faction disposition (F3)', () => {
    const factions: Faction[] = [
        {
            id: 'f_hall', name: 'The Hall', description: '', territory: [], influence: 50,
            disposition: { f_atelier: 'war' }, resources: [], memberEntityIds: ['mira'],
            playerStanding: { reputation: 0, knownActions: [] },
        },
        {
            id: 'f_atelier', name: 'The Atelier', description: '', territory: [], influence: 40,
            disposition: {}, resources: [], memberEntityIds: ['anwen'],
            playerStanding: { reputation: 0, knownActions: [] },
        },
    ];

    it('drives two members of warring factions apart, and names why', () => {
        const cast = [
            npc('mira', { relationship_level: 'WARM' }),
            npc('anwen', { relationship_level: 'WARM' }),
        ];
        const ties = runTurns(10, cast, { factions });
        const t = find(ties, 'mira', 'anwen')!;

        expect(t.standing).toBe('COLD');
        expect(t.basis).toContain('at war');
    });

    it('reads a one-sided disposition from either direction', () => {
        const cast = [npc('mira'), npc('anwen')];
        const ties = runTurns(10, cast, { factions });
        expect(find(ties, 'anwen', 'mira')!.standing).toBe('COLD');
    });
});

describe('socialGraph — decay (F6)', () => {
    it('walks a stale grudge back toward NEUTRAL and sheds salience', () => {
        const cast = [
            npc('mira'),
            npc('anwen', { location: 'the far coast', status: 'distant' }),
        ];
        // Salience below the persistence floor, so only decay is in play.
        const stale = [tie('mira', 'anwen', { standing: 'HOSTILE', salience: 12, lastContactTurn: 0 })];
        const ties = runTurns(4, cast, { ties: stale, startTurn: SOCIAL_TIE_DECAY_TURNS + 1 });
        const t = find(ties, 'mira', 'anwen')!;

        expect(t.standing).toBe('COLD');       // one rung back toward NEUTRAL
        expect(t.salience).toBeLessThan(12);
    });

    it('prunes a tie once it is NEUTRAL with no salience left', () => {
        const cast = [
            npc('mira'),
            npc('anwen', { location: 'the far coast', status: 'distant' }),
        ];
        const stale = [tie('mira', 'anwen', { standing: 'NEUTRAL', salience: 3, lastContactTurn: 0 })];
        const ties = runTurns(2, cast, { ties: stale, startTurn: SOCIAL_TIE_DECAY_TURNS + 1 });
        expect(ties).toHaveLength(0);
    });
});

describe('socialGraph — bounds', () => {
    it('prunes to MAX_SOCIAL_TIES, keeping the most salient', () => {
        const cast = Array.from({ length: 12 }, (_, i) =>
            npc(`n${i}`, { location: 'the far coast', status: 'distant' }),
        );
        const many: SocialTie[] = [];
        let salience = 1;
        for (let i = 0; i < 12 && many.length < MAX_SOCIAL_TIES + 8; i++) {
            for (let j = 0; j < 12 && many.length < MAX_SOCIAL_TIES + 8; j++) {
                if (i === j) continue;
                many.push(tie(`n${i}`, `n${j}`, { salience: salience++, lastContactTurn: 100 }));
            }
        }
        const ties = runTurns(1, cast, { ties: many, startTurn: 100 });

        expect(ties.length).toBeLessThanOrEqual(MAX_SOCIAL_TIES);
        expect(Math.min(...ties.map(t => t.salience))).toBeGreaterThan(1);
    });
});

describe('socialGraph — declared updates are validated', () => {
    it('rejects self-ties and unknown entities, and says so', () => {
        const { ties, logs } = advanceSocialGraph({
            entities: [npc('mira')],
            factions: [],
            ties: [],
            turn: 3,
            contention: 0,
            declared: [
                { from: 'mira', to: 'mira', standing: 'HOSTILE' },
                { from: 'mira', to: 'a stranger who does not exist', standing: 'HOSTILE' },
            ],
        });
        expect(ties).toHaveLength(0);
        expect(logs.filter(l => l.includes('Rejected declared tie'))).toHaveLength(2);
    });

    it('resolves an endpoint given by name rather than id', () => {
        const cast = [npc('e_mira', { name: 'Mira' }), npc('e_anwen', { name: 'Anwen Sarath' })];
        const { ties } = advanceSocialGraph({
            entities: cast,
            factions: [],
            ties: [],
            turn: 3,
            contention: 0,
            declared: [{ from: 'Mira', to: 'Anwen Sarath', standing: 'WARM' }],
        });
        expect(find(ties, 'e_mira', 'e_anwen')!.standing).toBe('WARM');
    });
});

describe('socialGraph — surfacing', () => {
    const cast = [
        npc('mira', { name: 'Mira' }),
        npc('anwen', { name: 'Anwen' }),
        npc('coran', { name: 'Coran', location: 'the far coast', status: 'distant' }),
    ];

    it('shows only non-NEUTRAL ties between people actually in the room', () => {
        const ties = [
            tie('mira', 'anwen', { standing: 'COLD', salience: 70 }),
            tie('anwen', 'mira', { standing: 'NEUTRAL', salience: 70 }),
            tie('mira', 'coran', { standing: 'HOSTILE', salience: 90 }),
        ];
        const visible = selectVisibleTies(ties, cast);
        expect(visible).toHaveLength(1);
        expect(visible[0].to).toBe('anwen');
    });

    it('renders a block that forbids stating the standing outright', () => {
        const block = buildSocialWebBlock(
            [tie('mira', 'anwen', { standing: 'COLD', basis: 'they read the player the same way' })],
            cast,
        );
        expect(block).toContain('[SOCIAL WEB');
        expect(block).toContain('Mira → Anwen: COLD');
        expect(block).toContain('they read the player the same way');
        expect(block).toMatch(/Never state a standing/i);
    });

    it('costs nothing when the graph is quiet', () => {
        expect(buildSocialWebBlock([], cast)).toBe('');
        expect(buildSocialWebBlock([tie('mira', 'anwen')], cast)).toBe('');
    });

    it('offers an ambient hook only for a strong, salient tie', () => {
        expect(selectSocialHookTie([tie('mira', 'anwen', { standing: 'WARM', salience: 90 })], cast)).toBeNull();
        expect(selectSocialHookTie([tie('mira', 'anwen', { standing: 'HOSTILE', salience: 10 })], cast)).toBeNull();

        const picked = selectSocialHookTie(
            [tie('mira', 'anwen', { standing: 'HOSTILE', salience: 80 })],
            cast,
        );
        expect(picked?.fromName).toBe('Mira');
        expect(picked?.toName).toBe('Anwen');
    });
});

// ---------------------------------------------------------------------------
// Pipeline wiring
// ---------------------------------------------------------------------------

describe('socialGraphStep — pipeline placement', () => {
    it('runs after assembleState and factionConflicts, and before sceneContinuity', () => {
        const names = DEFAULT_PIPELINE.map(s => s.name);
        const social = names.indexOf('18-socialGraph');

        expect(social).toBeGreaterThan(names.indexOf('12-assembleState'));
        expect(social).toBeGreaterThan(names.indexOf('factionConflicts'));
        expect(social).toBeLessThan(names.indexOf('17-sceneContinuity'));
    });

    it('is gated off inside a combat tick, and runs in every other time mode', () => {
        expect(buildPipeline('TICK').some(s => s.name === '18-socialGraph')).toBe(false);
        for (const mode of ['SCENE', 'ACTIVITY', 'REST', 'MONTAGE'] as TimeMode[]) {
            expect(buildPipeline(mode).some(s => s.name === '18-socialGraph'), mode).toBe(true);
        }
    });

    it('writes the graph onto worldUpdate and logs what moved', () => {
        const cast = [
            npc('mira', { name: 'Mira', relationship_level: 'WARM' }),
            npc('anwen', { name: 'Anwen', relationship_level: 'WARM' }),
        ];
        const previousWorld = {
            turnCount: 11,
            knownEntities: cast,
            factions: [],
            // Pre-charged to the edge of a rung so one turn of alignment tips it.
            socialGraph: [tie('mira', 'anwen', { charge: 0.95 })],
        } as unknown as GameWorld;

        const ctx = socialGraphStep.execute({
            previousWorld,
            worldUpdate: { ...previousWorld },
            updatedKnownEntities: cast,
            sanitisedResponse: {} as ModelResponseSchema,
            debugLogs: [] as DebugLogEntry[],
        } as unknown as TurnContext);

        const graph = ctx.worldUpdate.socialGraph!;
        const moved = graph.find(t => t.from === 'mira' && t.to === 'anwen')!;
        expect(moved.standing).toBe('WARM');
        // The reverse direction is tracked separately — ties are directed.
        expect(graph.find(t => t.from === 'anwen' && t.to === 'mira')).toBeDefined();
        expect(ctx.debugLogs.map(l => l.message).join('\n')).toContain('Mira → Anwen');
    });

    it('survives a save with no social graph at all (pre-v1.34)', () => {
        const previousWorld = { turnCount: 3, knownEntities: [] } as unknown as GameWorld;
        const ctx = socialGraphStep.execute({
            previousWorld,
            worldUpdate: { ...previousWorld },
            updatedKnownEntities: [],
            sanitisedResponse: {} as ModelResponseSchema,
            debugLogs: [] as DebugLogEntry[],
        } as unknown as TurnContext);

        expect(ctx.worldUpdate.socialGraph).toEqual([]);
    });
});
