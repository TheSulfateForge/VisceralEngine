// ============================================================================
// utils/engine/socialGraph.ts — v1.34
//
// THE SOCIAL WEB. Directed, ratcheted NPC→NPC standing, derived from state the
// engine already owns. See VRE_SOCIAL_WEB_DESIGN.md.
//
// Before this module the engine had exactly one relationship axis — NPC→player.
// Two NPCs who shared every scene held no recorded opinion of each other, so
// rivalry and alliance survived only as long as one turn's prose, and the
// player had to narrate the social graph by hand for any of it to persist.
//
// Seed-agnostic by construction (VRE_SEED_AGNOSTIC_REMEDIATION_DESIGN.md): every
// force below is an operation on `relationship_level`, `status`, `location`,
// `ledger`, faction membership, or the typed `FactionDisposition` union. No
// English word lists, no genre nouns, no content vocabulary.
//
// Pure arithmetic — no LLM call. Everything the model is bad at (timing,
// rate-limiting, non-repetition) is decided here in code, per the hookNudge
// precedent.
// ============================================================================

import {
    RELATIONSHIP_LEVELS,
    type RelationshipLevel,
    type KnownEntity,
    type Faction,
    type SocialTie,
    type DeclaredSocialUpdate,
} from '../../types';
import {
    SOCIAL_CONTENTION_FLOOR,
    SOCIAL_TIE_DECAY_TURNS,
    SOCIAL_TIE_PERSIST_SALIENCE,
    MAX_SOCIAL_ACTORS,
    MAX_SOCIAL_TIES,
    SOCIAL_WEB_PROMPT_LIMIT,
} from '../../config/engineConfig';
import { ENTITY_EXTRACTION_BLACKLIST } from './threatPipeline';

const NEUTRAL_INDEX = RELATIONSHIP_LEVELS.indexOf('NEUTRAL');
const CONTENTION_FLOOR_INDEX = RELATIONSHIP_LEVELS.indexOf(SOCIAL_CONTENTION_FLOOR);

/** Ladder index, NEUTRAL for anything unrecognised. */
const rung = (level: RelationshipLevel | undefined): number => {
    const i = RELATIONSHIP_LEVELS.indexOf(level as RelationshipLevel);
    return i < 0 ? NEUTRAL_INDEX : i;
};

const norm = (s: string | undefined): string => (s ?? '').trim().toLowerCase();

/** Statuses that put an entity in social range of another. */
const IN_CONTACT_STATUSES = new Set(['present', 'nearby']);
const inContactRange = (e: KnownEntity): boolean =>
    IN_CONTACT_STATUSES.has(e.status ?? 'present');

/** Statuses that remove an entity from the graph entirely. */
const OUT_OF_PLAY_STATUSES = new Set(['dead', 'retired']);
const isInPlay = (e: KnownEntity): boolean =>
    !OUT_OF_PLAY_STATUSES.has(e.status ?? 'present');

/**
 * Significant name tokens — parens stripped, short/blacklisted tokens dropped.
 * Same standard the entity dedup matcher uses (v1.23), so "Anwen" alone will
 * not claim "Anwen Sarath" and honorifics never match.
 */
const significantNameParts = (name: string): string[] =>
    name
        .replace(/\([^)]*\)/g, '')
        .split(/\s+/)
        .map(p => p.toLowerCase().trim())
        .filter(p => p.length >= 3 && !ENTITY_EXTRACTION_BLACKLIST.has(p));

export const tieKey = (from: string, to: string): string => `${from}→${to}`;

// ---------------------------------------------------------------------------
// Ratchet
// ---------------------------------------------------------------------------

/**
 * Apply accumulated charge to a tie. Movement is capped at ONE rung per turn —
 * the same law as the v1.28 relationship ratchet on the player axis. Charge is
 * clamped so a tie parked at the end of the ladder cannot bank unbounded
 * pressure and then unwind it all at once when conditions reverse.
 */
const applyCharge = (tie: SocialTie, turn: number): boolean => {
    tie.charge = Math.max(-1.5, Math.min(1.5, tie.charge));
    // Epsilon, not a bare `< 1`: ten turns of +0.10 sums to 0.9999999999999999
    // in IEEE-754, and without this a relationship that has plainly earned its
    // rung sits one turn short of it forever.
    if (Math.abs(tie.charge) < 1 - 1e-9) return false;

    const direction = tie.charge > 0 ? 1 : -1;
    const from = rung(tie.standing);
    const to = Math.max(0, Math.min(RELATIONSHIP_LEVELS.length - 1, from + direction));
    tie.charge = 0;
    if (to === from) return false;   // already at the end of the ladder

    tie.standing = RELATIONSHIP_LEVELS[to];
    tie.lastMovedTurn = turn;
    tie.salience = Math.min(100, tie.salience + 8);
    return true;
};

// ---------------------------------------------------------------------------
// Forces
// ---------------------------------------------------------------------------

interface Pressure {
    /** Signed pressure toward the next rung this turn. */
    value: number;
    /** Human-readable why-line for the dominant contributor. */
    basis: string;
}

/**
 * F1 Alignment + F2 Contention.
 *
 * F1: two NPCs who read the player the same way find common cause; two who read
 * the player oppositely find each other across a line.
 *
 * F2: at the top of the ladder that inverts — when both hold high standing with
 * the player AND share a room, the player's attention is a scarce contested
 * thing and common cause becomes competition. `contention` (0..1) is the only
 * dial. At 0 the force is off and two devoted allies are simply comrades.
 */
const alignmentPressure = (
    a: KnownEntity,
    b: KnownEntity,
    coLocated: boolean,
    contention: number,
): Pressure => {
    const ra = rung(a.relationship_level);
    const rb = rung(b.relationship_level);
    const delta = Math.abs(ra - rb);

    if (
        contention > 0 &&
        coLocated &&
        ra >= CONTENTION_FLOOR_INDEX &&
        rb >= CONTENTION_FLOOR_INDEX
    ) {
        return {
            value: -0.20 * contention,
            basis: 'both hold high standing with the player, and share the room',
        };
    }
    if (delta <= 1) {
        return { value: 0.10, basis: 'they read the player the same way' };
    }
    if (delta >= 4) {
        return { value: -0.15, basis: 'they stand on opposite sides of the player' };
    }
    return { value: 0, basis: '' };
};

/** F3 — faction membership and the typed disposition between factions. */
const factionPressure = (
    a: KnownEntity,
    b: KnownEntity,
    factions: Faction[],
): Pressure => {
    const factionOf = (e: KnownEntity): Faction | undefined =>
        factions.find(f => (f.memberEntityIds ?? []).includes(e.id));

    const fa = factionOf(a);
    const fb = factionOf(b);
    if (!fa || !fb) return { value: 0, basis: '' };

    if (fa.id === fb.id) {
        return { value: 0.10, basis: `both of ${fa.name}` };
    }

    const disposition = fa.disposition?.[fb.id] ?? fb.disposition?.[fa.id];
    switch (disposition) {
        case 'allied':
            return { value: 0.12, basis: `${fa.name} and ${fb.name} are allied` };
        case 'rival':
            return { value: -0.12, basis: `${fa.name} and ${fb.name} are rivals` };
        case 'war':
            return { value: -0.25, basis: `${fa.name} and ${fb.name} are at war` };
        default:
            return { value: 0, basis: '' };
    }
};

/**
 * F4 — shared history. Salience only, NO valence: the engine cannot know whether
 * a shared event was good or bad. That reading is the narrator's job (F5).
 */
const sharedHistory = (a: KnownEntity, b: KnownEntity): string | null => {
    const tokens = significantNameParts(b.name);
    if (!tokens.length) return null;
    for (const entry of a.ledger ?? []) {
        const hay = entry.toLowerCase();
        if (tokens.some(t => hay.includes(t))) {
            return entry.length > 90 ? `${entry.slice(0, 89).trimEnd()}…` : entry;
        }
    }
    return null;
};

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

export interface SocialGraphInput {
    entities: KnownEntity[];
    factions: Faction[];
    ties: SocialTie[];
    turn: number;
    /** 0..1 — how strongly the top of the ladder competes. See F2. */
    contention: number;
    declared?: DeclaredSocialUpdate[];
}

export interface SocialGraphResult {
    ties: SocialTie[];
    logs: string[];
}

/**
 * Rank actors so a crowded room does not blow the pair budget. Canonical (seed)
 * NPCs first, then whoever is furthest from NEUTRAL with the player, then most
 * recently seen. Mirrors the world-pulse brief's filter: the cast that matters
 * is the cast with a non-neutral standing or established business.
 */
const rankActors = (entities: KnownEntity[]): KnownEntity[] =>
    [...entities].sort((x, y) => {
        const canon = Number(!!y.canonical) - Number(!!x.canonical);
        if (canon) return canon;
        const dist =
            Math.abs(rung(y.relationship_level) - NEUTRAL_INDEX) -
            Math.abs(rung(x.relationship_level) - NEUTRAL_INDEX);
        if (dist) return dist;
        return (y.lastSeenTurn ?? 0) - (x.lastSeenTurn ?? 0);
    });

/**
 * A pair is worth materialising a tie for when at least one endpoint already
 * matters: a seed-canonical NPC, a non-neutral standing with the player, an
 * existing tie, or a faction relationship between them. Without this gate a busy
 * tavern would mint dozens of inert NEUTRAL edges that only churn the prune list.
 *
 * Faction relatedness counts on its own: two members of warring houses who share
 * a room have opinions of each other whether or not either has yet formed one
 * about the player.
 */
const pairIsInteresting = (
    a: KnownEntity,
    b: KnownEntity,
    existing: boolean,
    factionRelated: boolean,
): boolean =>
    existing ||
    factionRelated ||
    !!a.canonical ||
    !!b.canonical ||
    a.relationship_level !== 'NEUTRAL' ||
    b.relationship_level !== 'NEUTRAL';

const newTie = (
    from: string,
    to: string,
    turn: number,
    basis: string,
    origin: 'derived' | 'declared',
): SocialTie => ({
    from,
    to,
    standing: 'NEUTRAL',
    basis,
    origin,
    charge: 0,
    salience: 20,
    firstSeenTurn: turn,
    lastMovedTurn: turn,
    lastContactTurn: turn,
});

/**
 * Advance the social graph one turn.
 *
 * Order matters: declared updates land first (the narrator staged something
 * on-screen and that outranks inference), then derived pressure, then decay,
 * then pruning.
 */
export const advanceSocialGraph = (input: SocialGraphInput): SocialGraphResult => {
    const { entities, factions, turn, contention } = input;
    const logs: string[] = [];

    const live = entities.filter(isInPlay);
    const byId = new Map(live.map(e => [e.id, e]));
    const byName = new Map(live.map(e => [norm(e.name), e]));

    // Drop ties whose endpoints left play, and rebuild the working index.
    const ties = new Map<string, SocialTie>();
    for (const t of input.ties ?? []) {
        if (byId.has(t.from) && byId.has(t.to)) {
            ties.set(tieKey(t.from, t.to), { ...t });
        }
    }

    const resolve = (ref: string): KnownEntity | undefined =>
        byId.get(ref) ?? byName.get(norm(ref));

    // ─── F5: declared updates ────────────────────────────────────────────────
    for (const d of input.declared ?? []) {
        const from = resolve(d.from);
        const to = resolve(d.to);
        if (!from || !to || from.id === to.id) {
            logs.push(
                `[SOCIAL WEB] Rejected declared tie ${d.from} → ${d.to}: ` +
                `${!from || !to ? 'unknown or out-of-play entity' : 'self-tie'}.`,
            );
            continue;
        }
        const key = tieKey(from.id, to.id);
        const tie =
            ties.get(key) ?? newTie(from.id, to.id, turn, d.basis?.trim() || '', 'declared');

        const proposed = RELATIONSHIP_LEVELS.includes(d.standing as RelationshipLevel)
            ? (d.standing as RelationshipLevel)
            : tie.standing;
        const current = rung(tie.standing);
        const target = rung(proposed);

        if (target !== current) {
            const direction = target > current ? 1 : -1;
            const next = RELATIONSHIP_LEVELS[current + direction];
            if (Math.abs(target - current) > 1) {
                logs.push(
                    `[SOCIAL WEB — RATCHET] ${from.name} → ${to.name}: model proposed ` +
                    `${tie.standing} → ${proposed} (${Math.abs(target - current)} steps). ` +
                    `Clamped to ${next}.`,
                );
            }
            tie.standing = next;
            tie.lastMovedTurn = turn;
            tie.charge = 0;
            tie.salience = Math.min(100, tie.salience + 10);
        }
        if (d.basis?.trim()) tie.basis = d.basis.trim();
        tie.origin = 'declared';
        tie.lastContactTurn = turn;
        ties.set(key, tie);
    }

    // ─── F0–F4: derived pressure ─────────────────────────────────────────────
    const actors = rankActors(live).slice(0, MAX_SOCIAL_ACTORS);

    for (const a of actors) {
        for (const b of actors) {
            if (a.id === b.id) continue;

            const key = tieKey(a.id, b.id);
            const existing = ties.get(key);

            const coLocated =
                !!norm(a.location) &&
                norm(a.location) === norm(b.location) &&
                inContactRange(a) &&
                inContactRange(b);
            const faction = factionPressure(a, b, factions);
            const factionRelated = faction.value !== 0;
            const persistent =
                !!existing && existing.salience >= SOCIAL_TIE_PERSIST_SALIENCE;

            // F0 — contact gate. No opportunity, no opinion.
            if (!coLocated && !factionRelated && !persistent) continue;
            if (!pairIsInteresting(a, b, !!existing, factionRelated)) continue;

            const align = alignmentPressure(a, b, coLocated, contention);
            const history = sharedHistory(a, b);

            let pressure = align.value + faction.value;
            // Distant-but-remembered pairs drift at half rate: they are working
            // from reputation, not from the room.
            if (!coLocated) pressure *= 0.5;

            if (pressure === 0 && !history) continue;

            const dominant =
                Math.abs(align.value) >= Math.abs(faction.value) ? align.basis : faction.basis;
            const tie =
                existing ??
                newTie(a.id, b.id, turn, dominant || history || '', 'derived');

            tie.charge += pressure;
            if (coLocated) {
                tie.lastContactTurn = turn;
                tie.salience = Math.min(100, tie.salience + 4);
            }
            if (history) {
                tie.salience = Math.min(100, tie.salience + 6);
                if (!tie.basis) tie.basis = `shared history: ${history}`;
            }
            // A derived basis is refreshed by whatever force is currently
            // dominant; a declared one is the narrator's and is left alone.
            if (dominant && tie.origin === 'derived') tie.basis = dominant;

            if (applyCharge(tie, turn)) {
                logs.push(
                    `[SOCIAL WEB] ${a.name} → ${b.name} moved to ${tie.standing} ` +
                    `(${tie.basis || 'no stated basis'}).`,
                );
            }
            ties.set(key, tie);
        }
    }

    // ─── F6: decay ───────────────────────────────────────────────────────────
    for (const [key, tie] of ties) {
        if (turn - tie.lastContactTurn < SOCIAL_TIE_DECAY_TURNS) continue;

        const current = rung(tie.standing);
        if (current !== NEUTRAL_INDEX) {
            tie.charge += current > NEUTRAL_INDEX ? -0.25 : 0.25;
            applyCharge(tie, turn);
        }
        tie.salience = Math.max(0, tie.salience - 3);
        if (tie.standing === 'NEUTRAL' && tie.salience <= 0) ties.delete(key);
    }

    // ─── Prune to budget ─────────────────────────────────────────────────────
    let out = [...ties.values()];
    if (out.length > MAX_SOCIAL_TIES) {
        out.sort((x, y) => y.salience - x.salience || y.lastMovedTurn - x.lastMovedTurn);
        const dropped = out.length - MAX_SOCIAL_TIES;
        out = out.slice(0, MAX_SOCIAL_TIES);
        logs.push(`[SOCIAL WEB] Pruned ${dropped} lowest-salience tie(s) to stay under budget.`);
    }

    return { ties: out, logs };
};

// ---------------------------------------------------------------------------
// Surfacing
// ---------------------------------------------------------------------------

const displayName = (entities: KnownEntity[], id: string): string =>
    entities.find(e => e.id === id)?.name ?? id;

/** Ties worth showing: non-NEUTRAL, both endpoints in the room, top by salience. */
export const selectVisibleTies = (
    ties: SocialTie[],
    entities: KnownEntity[],
    limit: number = SOCIAL_WEB_PROMPT_LIMIT,
): SocialTie[] => {
    const present = new Set(
        entities.filter(e => isInPlay(e) && inContactRange(e)).map(e => e.id),
    );
    return (ties ?? [])
        .filter(t => t.standing !== 'NEUTRAL' && present.has(t.from) && present.has(t.to))
        .sort((x, y) => y.salience - x.salience)
        .slice(0, limit);
};

/**
 * The [SOCIAL WEB] prompt block.
 *
 * The instruction line is load-bearing. Without it the model states standings
 * outright ("Mira clearly resents Anwen") instead of playing them, which turns
 * an engine-tracked relationship into an exposition dump — the same failure the
 * entity `impression` field guards against.
 */
export const buildSocialWebBlock = (
    ties: SocialTie[],
    entities: KnownEntity[],
    limit: number = SOCIAL_WEB_PROMPT_LIMIT,
): string => {
    const visible = selectVisibleTies(ties, entities, limit);
    if (!visible.length) return '';

    const lines = visible.map(t => {
        const why = t.basis ? ` — ${t.basis}` : '';
        return `- ${displayName(entities, t.from)} → ${displayName(entities, t.to)}: ${t.standing}${why}`;
    });

    return [
        '[SOCIAL WEB — how these NPCs stand toward EACH OTHER]',
        ...lines,
        'These are the NPCs’ opinions of one another, independent of the player and',
        'tracked by the engine across turns. Play them as behavior — who sits where, who',
        'answers for whom, who goes quiet when the other speaks. Never state a standing',
        'outright, never have a character announce it, and do not narrate the label.',
    ].join('\n');
};

/** Compact lines for the offscreen world-pulse brief. */
export const summariseTiesForPulse = (
    ties: SocialTie[],
    entities: KnownEntity[],
    limit: number = 5,
): string[] =>
    (ties ?? [])
        .filter(t => t.standing !== 'NEUTRAL')
        .sort((x, y) => y.salience - x.salience)
        .slice(0, limit)
        .map(
            t =>
                `- ${displayName(entities, t.from)} → ${displayName(entities, t.to)}: ${t.standing}`,
        );

/**
 * A tie eligible to surface as an ambient overheard beat. Deliberately narrow:
 * strong standing, real salience, and both parties reachable — the hookNudge
 * cadence and rate limiting do the rest.
 */
export const selectSocialHookTie = (
    ties: SocialTie[],
    entities: KnownEntity[],
): { tie: SocialTie; fromName: string; toName: string } | null => {
    const strong = (ties ?? [])
        .filter(t => {
            const d = Math.abs(rung(t.standing) - NEUTRAL_INDEX);
            return d >= 2 && t.salience >= SOCIAL_TIE_PERSIST_SALIENCE;
        })
        .sort((x, y) => y.salience - x.salience);

    const inPlay = new Set(entities.filter(isInPlay).map(e => e.id));
    const pick = strong.find(t => inPlay.has(t.from) && inPlay.has(t.to));
    if (!pick) return null;

    return {
        tie: pick,
        fromName: displayName(entities, pick.from),
        toName: displayName(entities, pick.to),
    };
};
