// ============================================================================
// UTILS/REPRODUCTIONSYSTEM.TS
// Independent Biological Tracking System
// ============================================================================
//
// v1.61: wired in for the first time. Before this, step 04 rolled the chance
// and logged "Conception occurred" but never created a record, and nothing
// called advancePregnancies — the pregnancies list was always empty.
//
// Rules (Ryan, 2026-11-20):
//   - Only pregnancies that involve the player character are tracked.
//   - Gestation is counted from the in-game clock, not from turn count, so a
//     montage advances a pregnancy by the time it covers.

import type { Pregnancy, Character, BodyEvent, KnownEntity, BodyState, EntityStatus } from '../types';
import { matchRegisterNpc, createRegister } from './engine/npcRegister';

const BASE_PREGNANCY_CHANCE = 0.30; // 30% chance per event
/** v1.61: the engine delivers at a week rolled in this range at conception. */
export const DUE_WEEK_MIN = 37;
export const DUE_WEEK_MAX = 42;
export const POSTPARTUM_WEEKS = 6;
export const POSTPARTUM_CONDITION = 'Postpartum recovery';
export const LACTATING_CONDITION = 'Lactating';
export const MINUTES_PER_WEEK = 7 * 24 * 60;
export const VISIBLE_WEEK = 12;
export const TERM_WEEK = 40;

const norm = (s: string | undefined): string => (s ?? '').trim().toLowerCase();

/** Full-name or first-name match against the PC's name. */
const isPc = (name: string | undefined, pcName: string): boolean => {
    const n = norm(name);
    const pc = norm(pcName);
    if (!n || !pc) return false;
    return n === pc || n === pc.split(/\s+/)[0];
};

const isFemale = (character: Pick<Character, 'gender'>): boolean => {
    const g = norm(character.gender);
    return g.includes('female') || g.includes('woman');
};

/** A body event that can cause conception: insemination, or penile vaginal penetration. */
const isConceptive = (e: BodyEvent): boolean => {
    const kind = norm(e.kind);
    const orifice = norm(e.orifice);
    if (kind === 'insemination') return orifice === '' || orifice === 'vaginal';
    if (kind === 'penetration') return orifice === 'vaginal' && norm(e.with) === 'penis';
    return false;
};

export interface ConceptionParticipants {
    /** False when body_events show the act did not involve the PC. */
    involvesPc: boolean;
    /** The other participant's name, or 'Unknown'. */
    partnerName: string;
}

/**
 * Decide from this turn's body_events whether the conceptive act involved the
 * PC, and who the partner was. When there are no body_events (the field is
 * only sent in sexual/combat scenes) the flag is trusted — its description
 * restricts it to acts involving the PC — and the partner is 'Unknown'.
 */
export const resolveConceptionParticipants = (
    events: readonly BodyEvent[] | undefined,
    pcName: string,
): ConceptionParticipants => {
    const conceptive = (events ?? []).filter(isConceptive);
    if (!(events ?? []).length) return { involvesPc: true, partnerName: 'Unknown' };
    for (const e of conceptive) {
        if (isPc(e.who, pcName)) return { involvesPc: true, partnerName: e.by?.trim() || 'Unknown' };
        if (isPc(e.by, pcName)) return { involvesPc: true, partnerName: e.who?.trim() || 'Unknown' };
    }
    // body_events were reported but none of the conceptive ones were the PC's.
    // If no conceptive event was reported at all, trust the flag.
    return conceptive.length ? { involvesPc: false, partnerName: 'Unknown' } : { involvesPc: true, partnerName: 'Unknown' };
};

/** Engine-owned register state keys. The register pass may not write them. */
export const PREGNANCY_STATE_KEY = 'pregnancy';
export const POSTPARTUM_STATE_KEY = 'postpartum';
export const CHILDREN_STATE_KEY = 'children';
export const ENGINE_OWNED_STATE_KEY_RE = /pregnan|postpartum|^children$/i;

const MINUTES_PER_DAY = 24 * 60;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const dueWeekOf = (p: Pregnancy): number => p.dueWeek ?? TERM_WEEK;
const weekAt = (p: Pregnancy, now: number): number =>
    Math.floor(Math.max(0, now - p.conceptionTime) / MINUTES_PER_WEEK);

export const childNoun = (g: 'female' | 'male'): string => (g === 'female' ? 'daughter' : 'son');
export const childKid = (g: 'female' | 'male'): string => (g === 'female' ? 'girl' : 'boy');

/** v1.61: age from the in-game clock — hours, days, weeks, months, years. */
export const describeAge = (birthMinute: number, now: number): string => {
    const mins = Math.max(0, now - birthMinute);
    const days = Math.floor(mins / MINUTES_PER_DAY);
    if (days < 1) {
        const hours = Math.floor(mins / 60);
        return hours < 1 ? 'newborn' : `${plural(hours, 'hour')} old`;
    }
    if (days < 14) return `${plural(days, 'day')} old`;
    const weeks = Math.floor(days / 7);
    if (weeks < 9) return `${plural(weeks, 'week')} old`;
    const months = Math.floor(days / 30.44);
    if (months < 24) return `${plural(months, 'month')} old`;
    return `${plural(Math.floor(days / 365.25), 'year')} old`;
};

const agoText = (minute: number, now: number): string => {
    const days = Math.floor(Math.max(0, now - minute) / MINUTES_PER_DAY);
    if (days < 1) return 'today';
    if (days < 14) return `${plural(days, 'day')} ago`;
    return `${plural(Math.floor(days / 7), 'week')} ago`;
};

/** "race X; hair Y; eyes Z", or a pending note. */
export const childTraitsText = (e: KnownEntity): string => {
    const c = e.child;
    if (!c) return '';
    if (c.traitsPending) return 'traits not yet set';
    return [c.race ? `race ${c.race}` : '', c.hair ? `hair ${c.hair}` : '', c.eyes ? `eyes ${c.eyes}` : '']
        .filter(Boolean).join('; ');
};

/** One-line description of a child for the prompt. */
export const describeChild = (e: KnownEntity, now: number): string => {
    const c = e.child;
    if (!c) return e.name;
    const traits = childTraitsText(e);
    return `${e.name} (${childKid(c.gender)}, ${describeAge(c.birthMinute, now)}${traits ? `; ${traits}` : ''}; mother ${c.motherName}, father ${c.fatherName})`;
};

/**
 * v1.61: one-line description of a GESTATING pregnancy at the current in-game
 * minute, from the mother's side.
 */
export const describePregnancy = (p: Pregnancy, nowMinutes: number): string => {
    const week = weekAt(p, nowMinutes);
    const father = p.fatherName && p.fatherName !== 'Unknown' ? `by ${p.fatherName}` : 'father unknown';
    const trimester = week < 13 ? 'first' : week < 27 ? 'second' : 'third';
    const due = dueWeekOf(p) - week;
    if (due <= 1) return `pregnant ${father} — week ${week} (${trimester} trimester), heavily pregnant; labor could start any day`;
    const showing = week >= VISIBLE_WEEK ? 'showing' : 'not yet showing';
    return `pregnant ${father} — week ${week} of ${TERM_WEEK} (${trimester} trimester), ${showing}, due in about ${plural(due, 'week')}`;
};

export const isPostpartum = (p: Pregnancy, now: number): boolean =>
    p.status === 'birth' && p.birthTime !== undefined && now - p.birthTime < POSTPARTUM_WEEKS * MINUTES_PER_WEEK;

/**
 * v1.61: the mother's state after delivery, during the postpartum window.
 * `latestTurn` is the world's turn count; a birth on that turn has not been
 * narrated yet, so the line says so.
 */
export const describePostpartum = (p: Pregnancy, child: KnownEntity | undefined, now: number, latestTurn?: number): string => {
    const gender = child?.child?.gender;
    const what = gender ? `a ${childNoun(gender)}${child && !child.child?.traitsPending ? ` (${child.name})` : ''}` : 'a child';
    const father = p.fatherName && p.fatherName !== 'Unknown' ? ` by ${p.fatherName}` : '';
    const just = latestTurn !== undefined && p.birthTurn === latestTurn
        ? ' — this has just happened; narrate the labor and birth if the story has not shown it'
        : '';
    return `gave birth ${agoText(p.birthTime ?? now, now)} to ${what}${father}; postpartum recovery, lactating${just}`;
};

/** The PC's own GESTATING pregnancy, if she is female and has one. */
export const pcPregnancy = (
    pregnancies: readonly Pregnancy[] | undefined,
    character: Pick<Character, 'name' | 'gender'>,
): Pregnancy | undefined => {
    if (!isFemale(character)) return undefined;
    return (pregnancies ?? []).find(p => p.status === 'gestating' && isPc(p.motherName, character.name));
};

/** The PC's delivery still inside the postpartum window, if any. */
export const pcPostpartum = (
    pregnancies: readonly Pregnancy[] | undefined,
    character: Pick<Character, 'name' | 'gender'>,
    now: number,
): Pregnancy | undefined => {
    if (!isFemale(character)) return undefined;
    return (pregnancies ?? []).find(p => isPostpartum(p, now) && isPc(p.motherName, character.name));
};

/** Every child born in play (all of them are the PC's). */
export const childrenOf = (entities: readonly KnownEntity[] | undefined): KnownEntity[] =>
    (entities ?? []).filter(e => !!e.child);

/** Mother lookup that never lands on a child. Indexes match `entities`. */
const findAdult = (entities: KnownEntity[], name: string): number => {
    const masked = entities.map(e => (e.child ? { ...e, name: '\u0000' } : e));
    return matchRegisterNpc(masked, name);
};

/**
 * v1.61: write each NPC mother's engine-owned facts into her living record
 * (register state): `pregnancy` while gestating, `postpartum` for six weeks
 * after delivery, `children` for every child she has with the PC. Keys that
 * no longer apply are removed. Opens a register when one is needed. Returns
 * the same array when nothing changed.
 */
export const syncPregnancyRegisters = (
    entities: KnownEntity[],
    pregnancies: readonly Pregnancy[] | undefined,
    pcName: string,
    nowMinutes: number,
    turn: number,
): KnownEntity[] => {
    const desired = new Map<number, Record<string, string>>();
    const want = (idx: number) => {
        const d = desired.get(idx) ?? {};
        desired.set(idx, d);
        return d;
    };
    const isNpcMother = (name: string) => {
        const m = norm(name);
        return !!m && m !== 'unknown' && !isPc(name, pcName);
    };

    for (const p of pregnancies ?? []) {
        if (!isNpcMother(p.motherName)) continue;
        const idx = findAdult(entities, p.motherName);
        if (idx < 0) continue;
        if (p.status === 'gestating') want(idx)[PREGNANCY_STATE_KEY] = describePregnancy(p, nowMinutes);
        else if (isPostpartum(p, nowMinutes)) {
            const child = entities.find(e => e.id === p.childId);
            want(idx)[POSTPARTUM_STATE_KEY] = describePostpartum(p, child, nowMinutes);
        }
    }
    for (const c of childrenOf(entities)) {
        if (!isNpcMother(c.child!.motherName)) continue;
        const idx = findAdult(entities, c.child!.motherName);
        if (idx < 0) continue;
        const d = want(idx);
        const line = `${c.name} (${childKid(c.child!.gender)}, ${describeAge(c.child!.birthMinute, nowMinutes)}, father ${c.child!.fatherName})`;
        d[CHILDREN_STATE_KEY] = d[CHILDREN_STATE_KEY] ? `${d[CHILDREN_STATE_KEY]}; ${line}` : line;
    }

    let out = entities;
    entities.forEach((e, idx) => {
        const d = desired.get(idx);
        const hasEngineKeys = !!e.register?.state.some(s => ENGINE_OWNED_STATE_KEY_RE.test(s.key));
        if (!d && !hasEngineKeys) return;
        const reg = e.register ?? createRegister(turn);
        const kept = reg.state.filter(s => !ENGINE_OWNED_STATE_KEY_RE.test(s.key));
        const engine = Object.entries(d ?? {}).map(([key, value]) => {
            const prior = reg.state.find(s => s.key === key);
            return { key, value, turn: prior && prior.value === value ? prior.turn : (prior?.turn ?? turn) };
        });
        const next = [...kept, ...engine];
        const same = next.length === reg.state.length
            && next.every(n => reg.state.some(s => s.key === n.key && s.value === n.value));
        if (same && e.register) return;
        if (out === entities) out = [...entities];
        out[idx] = { ...e, register: { ...reg, state: next, updatedTurn: turn } };
    });
    return out;
};

const bodyAfterBirth = (state: BodyState | undefined, now: number): BodyState => ({
    ...(state ?? {}),
    vaginalStretch: 3,
    stretchUpdatedAtMinute: now,
    birthsGiven: (state?.birthsGiven ?? 0) + 1,
});

export interface BirthInput {
    character: Character;
    entities: KnownEntity[];
    pregnancies: Pregnancy[];
    now: number;
    turn: number;
    /** Where the PC is — a child born to the PC is here. */
    location: string;
    rand?: () => number;
    newId?: () => string;
}

export interface BirthOutput {
    character: Character;
    entities: KnownEntity[];
    pregnancies: Pregnancy[];
    logs: string[];
    /** Ids of children born this call. */
    bornIds: string[];
}

/**
 * v1.61: deliver every pregnancy that has reached its due week, create the
 * child, and apply birth to the mother. Also keeps the PC's postpartum
 * condition in step with the six-week window.
 *
 * The child is created with gender set (the engine's roll) and its other
 * traits pending; the post-birth trait pass fills race, hair, eyes and name.
 */
export const processBirths = (input: BirthInput): BirthOutput => {
    const rand = input.rand ?? Math.random;
    const newId = input.newId ?? (() => `child_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    let character = input.character;
    let entities = input.entities;
    const logs: string[] = [];
    const bornIds: string[] = [];

    const pregnancies = input.pregnancies.map(p => {
        if (p.status !== 'gestating') return p;
        const week = weekAt(p, input.now);
        if (week < dueWeekOf(p)) return p;

        const gender: 'female' | 'male' = rand() < 0.5 ? 'female' : 'male';
        const id = newId();
        const motherIsPc = isPc(p.motherName, character.name);
        const motherIdx = motherIsPc ? -1 : findAdult(entities, p.motherName);
        const mother = motherIdx >= 0 ? entities[motherIdx] : undefined;
        const status: EntityStatus = motherIsPc ? 'present' : (mother?.status ?? 'distant');

        const child: KnownEntity = {
            id,
            name: `Newborn ${childNoun(gender)} of ${p.motherName}`,
            role: `infant ${childNoun(gender)} of ${p.motherName} and ${p.fatherName}`,
            location: motherIsPc ? input.location : (mother?.location ?? input.location),
            impression: 'Newborn.',
            relationship_level: 'NEUTRAL',
            leverage: '',
            ledger: [`Born on turn ${input.turn} to ${p.motherName} and ${p.fatherName}.`],
            appearance: `Newborn ${childKid(gender)}.`,
            status,
            firstSeenTurn: input.turn,
            lastSeenTurn: input.turn,
            statusChangedTurn: input.turn,
            child: {
                gender,
                motherName: p.motherName,
                fatherName: p.fatherName,
                birthMinute: input.now,
                birthTurn: input.turn,
                pregnancyId: p.id,
                traitsPending: true,
            },
        };
        entities = [...entities, child];
        bornIds.push(id);

        if (motherIsPc) {
            const conditions = [...(character.conditions ?? [])];
            for (const c of [POSTPARTUM_CONDITION, LACTATING_CONDITION]) if (!conditions.includes(c)) conditions.push(c);
            const bio = character.bio
                ? { ...character.bio, metabolism: { ...character.bio.metabolism, stamina: Math.min(character.bio.metabolism?.stamina ?? 100, 30) } }
                : character.bio;
            character = { ...character, conditions, bio, bodyState: bodyAfterBirth(character.bodyState, input.now) };
        } else if (mother) {
            entities = entities.map((e, i) => (i === motherIdx ? { ...e, bodyState: bodyAfterBirth(e.bodyState, input.now) } : e));
        }

        logs.push(`[BIRTH] ${p.motherName} gave birth to a ${childNoun(gender)} (father ${p.fatherName}) at week ${week} — traits pending.`);
        return { ...p, status: 'birth' as const, currentWeek: week, birthTime: input.now, birthTurn: input.turn, childId: id };
    });

    // The PC's postpartum condition follows the six-week window.
    if (isFemale(character)) {
        const inWindow = pregnancies.some(p => isPostpartum(p, input.now) && isPc(p.motherName, character.name));
        const has = (character.conditions ?? []).includes(POSTPARTUM_CONDITION);
        if (inWindow && !has) character = { ...character, conditions: [...(character.conditions ?? []), POSTPARTUM_CONDITION] };
        if (!inWindow && has) {
            character = { ...character, conditions: (character.conditions ?? []).filter(c => c !== POSTPARTUM_CONDITION) };
            logs.push(`[BIRTH] ${character.name}: postpartum recovery has ended.`);
        }
    }

    return { character, entities, pregnancies, logs, bornIds };
};

export const ReproductionSystem = {
    /**
     * Calculates if conception occurs based on chance.
     */
    rollForConception: (chance: number = BASE_PREGNANCY_CHANCE, roll: number = Math.random()): boolean => {
        return roll < chance;
    },

    /**
     * Creates a new pregnancy record. The PC is the mother when female,
     * otherwise the father. v1.61: the due week is rolled here (37-42).
     */
    initiatePregnancy: (character: Character, turnCount: number, conceptionTime: number, partnerName: string = 'Unknown', rand: () => number = Math.random): Pregnancy => {
        const female = isFemale(character);
        return {
            id: `preg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            motherName: female ? character.name : partnerName,
            fatherName: female ? partnerName : character.name,
            conceptionTurn: turnCount,
            conceptionTime: conceptionTime,
            currentWeek: 0,
            isVisible: false,
            status: 'gestating',
            dueWeek: DUE_WEEK_MIN + Math.floor(rand() * (DUE_WEEK_MAX - DUE_WEEK_MIN + 1)),
        };
    },

    /**
     * True when this mother already has a gestating pregnancy (so a second
     * conception roll is meaningless). An 'Unknown' mother never matches.
     */
    alreadyPregnant: (pregnancies: readonly Pregnancy[], motherName: string): boolean => {
        const m = norm(motherName);
        if (!m || m === 'unknown') return false;
        return pregnancies.some(p => p.status === 'gestating' && norm(p.motherName) === m);
    },

    /**
     * Advances gestating pregnancies to the in-game clock (week + visibility).
     * Delivery is processBirths' job.
     */
    advancePregnancies: (pregnancies: readonly Pregnancy[], nowMinutes: number): { updated: Pregnancy[], logs: string[] } => {
        const logs: string[] = [];
        const updated = pregnancies.map(p => {
            if (p.status !== 'gestating') return p;
            const newWeek = weekAt(p, nowMinutes);
            const changes: Partial<Pregnancy> = {};
            if (newWeek >= VISIBLE_WEEK && !p.isVisible) {
                changes.isVisible = true;
                logs.push(`[BIO-ALERT] ${p.motherName}'s condition is now visibly noticeable (Week ${VISIBLE_WEEK}).`);
            }
            return { ...p, currentWeek: newWeek, ...changes };
        });
        return { updated, logs };
    }
};

// ── v1.61: child traits (post-birth pass + OOC corrections) ───────────────

export interface ParentInfo {
    name: string;
    race?: string;
    appearance?: string;
    notes?: string;
}

export interface ChildTraits {
    name?: string;
    race?: string;
    hair?: string;
    eyes?: string;
    appearance?: string;
}

/** What the trait pass knows about a parent. NPCs have no race field — their role often names it. */
export const parentInfo = (name: string, character: Character, entities: KnownEntity[]): ParentInfo => {
    if (isPc(name, character.name)) {
        return {
            name: character.name,
            race: character.race || undefined,
            appearance: character.appearance || undefined,
            notes: character.body?.notes || undefined,
        };
    }
    const idx = norm(name) && norm(name) !== 'unknown' ? findAdult(entities, name) : -1;
    if (idx < 0) return { name: name || 'Unknown' };
    const e = entities[idx];
    return {
        name: e.name,
        appearance: e.appearance || undefined,
        notes: [e.role, e.body?.notes].filter(Boolean).join('; ') || undefined,
    };
};

const clean = (v: unknown, max = 200): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

/** Validate a raw trait-pass / correction payload. */
export const parseChildTraits = (raw: unknown): ChildTraits | null => {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const t: ChildTraits = {
        name: clean(r.name, 80),
        race: clean(r.race, 120),
        hair: clean(r.hair, 120),
        eyes: clean(r.eyes, 120),
        appearance: clean(r.appearance, 400),
    };
    return Object.values(t).some(Boolean) ? t : null;
};

const composeAppearance = (e: KnownEntity, given?: string): string => {
    const c = e.child!;
    if (given) return given;
    const parts = [`${childKid(c.gender)}`, c.race, c.hair ? `${c.hair} hair` : '', c.eyes ? `${c.eyes} eyes` : ''].filter(Boolean);
    return `${parts.join(', ')}.`.replace(/^./, ch => ch.toUpperCase());
};

/**
 * Apply traits to a child. Gender is never changed here (that is a
 * correction's job, via `gender`). Clears traitsPending.
 */
export const applyChildTraits = (
    entities: KnownEntity[],
    childId: string,
    traits: ChildTraits & { gender?: 'female' | 'male' },
): { entities: KnownEntity[]; changed: string[] } => {
    const idx = entities.findIndex(e => e.id === childId && e.child);
    if (idx < 0) return { entities, changed: [] };
    const e = entities[idx];
    const c = { ...e.child! };
    const changed: string[] = [];
    if (traits.gender && traits.gender !== c.gender) { c.gender = traits.gender; changed.push(`gender ${traits.gender}`); }
    if (traits.race && traits.race !== c.race) { c.race = traits.race; changed.push(`race ${traits.race}`); }
    if (traits.hair && traits.hair !== c.hair) { c.hair = traits.hair; changed.push(`hair ${traits.hair}`); }
    if (traits.eyes && traits.eyes !== c.eyes) { c.eyes = traits.eyes; changed.push(`eyes ${traits.eyes}`); }
    c.traitsPending = false;
    let name = e.name;
    if (traits.name && traits.name !== e.name) { name = traits.name; changed.push(`name ${traits.name}`); }
    const next: KnownEntity = {
        ...e,
        name,
        role: `${e.role.startsWith('infant') ? 'infant' : 'child'} ${childNoun(c.gender)} of ${c.motherName} and ${c.fatherName}`,
        child: c,
    };
    // A traits change without a new appearance rebuilds the line from the traits.
    const hairEyesRace = !!(traits.race || traits.hair || traits.eyes || traits.gender);
    if (traits.appearance || hairEyesRace || e.child!.traitsPending) next.appearance = composeAppearance(next, traits.appearance);
    if (traits.appearance && traits.appearance !== e.appearance) changed.push('appearance');
    const out = [...entities];
    out[idx] = next;
    return { entities: out, changed };
};

export type ChildCorrectionField = 'name' | 'gender' | 'race' | 'hair' | 'eyes' | 'appearance';
export interface ChildCorrection { child: string; field: ChildCorrectionField; value: string }
const CORRECTION_FIELDS: readonly ChildCorrectionField[] = ['name', 'gender', 'race', 'hair', 'eyes', 'appearance'];

export const parseChildCorrections = (raw: unknown): ChildCorrection[] =>
    (Array.isArray(raw) ? raw : [])
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map(x => ({ child: clean(x.child, 120) ?? '', field: String(x.field ?? '').toLowerCase() as ChildCorrectionField, value: clean(x.value, 400) ?? '' }))
        .filter(x => x.child && x.value && CORRECTION_FIELDS.includes(x.field));

/** Find a child by name (current name, placeholder, or given name). */
export const matchChild = (entities: KnownEntity[], name: string): number => {
    const masked = entities.map(e => (e.child ? e : { ...e, name: '\u0000' }));
    return matchRegisterNpc(masked, name);
};

/**
 * v1.61: apply OOC corrections to children. Only entities with a child record
 * can be touched. Returns per-correction log lines, including misses.
 */
export const applyChildCorrections = (
    entities: KnownEntity[],
    corrections: readonly ChildCorrection[],
): { entities: KnownEntity[]; logs: string[] } => {
    let out = entities;
    const logs: string[] = [];
    for (const k of corrections) {
        const idx = matchChild(out, k.child);
        if (idx < 0) { logs.push(`[CHILD] OOC correction for "${k.child}" — no child by that name; not applied.`); continue; }
        const before = out[idx].name;
        let traits: ChildTraits & { gender?: 'female' | 'male' };
        if (k.field === 'gender') {
            const g = /^(f|female|girl|daughter|woman)$/i.test(k.value) ? 'female' : /^(m|male|boy|son|man)$/i.test(k.value) ? 'male' : undefined;
            if (!g) { logs.push(`[CHILD] OOC gender "${k.value}" for ${before} not understood; not applied.`); continue; }
            traits = { gender: g };
        } else traits = { [k.field]: k.value };
        const res = applyChildTraits(out, out[idx].id, traits);
        out = res.entities;
        logs.push(res.changed.length
            ? `[CHILD] OOC correction applied to ${before}: ${res.changed.join('; ')}.`
            : `[CHILD] OOC correction for ${before}: ${k.field} already "${k.value}".`);
    }
    return { entities: out, logs };
};

/** Records block for the OOC channel — every child, with the fields a correction can change. */
export const buildChildRecordsBlock = (entities: readonly KnownEntity[], now: number): string => {
    const kids = childrenOf(entities);
    if (!kids.length) return '';
    return `[CHILDREN — born in play; fields you may correct: name, gender, race, hair, eyes, appearance]\n${kids.map(k => {
        const c = k.child!;
        return `- ${k.name}: ${c.gender}, ${describeAge(c.birthMinute, now)}; race ${c.race ?? '(not set)'}; hair ${c.hair ?? '(not set)'}; eyes ${c.eyes ?? '(not set)'}; mother ${c.motherName}; father ${c.fatherName}; appearance: ${k.appearance ?? ''}`;
    }).join('\n')}`;
};
