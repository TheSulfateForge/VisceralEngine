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

import type { Pregnancy, Character, BodyEvent, KnownEntity } from '../types';
import { matchRegisterNpc, createRegister } from './engine/npcRegister';

const BASE_PREGNANCY_CHANCE = 0.30; // 30% chance per event
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

/** Engine-owned register state key. The register pass may not write it. */
export const PREGNANCY_STATE_KEY = 'pregnancy';

/**
 * v1.61: one-line description of a pregnancy at the current in-game minute,
 * from the mother's side. Shared by the PC state block and NPC registers.
 */
export const describePregnancy = (p: Pregnancy, nowMinutes: number): string => {
    const week = Math.floor(Math.max(0, nowMinutes - p.conceptionTime) / MINUTES_PER_WEEK);
    const father = p.fatherName && p.fatherName !== 'Unknown' ? `by ${p.fatherName}` : 'father unknown';
    if (p.status === 'birth' || week >= TERM_WEEK) {
        return `pregnant ${father} — full term (week ${Math.max(week, TERM_WEEK)} of ${TERM_WEEK}); labor is imminent`;
    }
    const trimester = week < 13 ? 'first' : week < 27 ? 'second' : 'third';
    const showing = week >= VISIBLE_WEEK ? 'showing' : 'not yet showing';
    const due = TERM_WEEK - week;
    return `pregnant ${father} — week ${week} of ${TERM_WEEK} (${trimester} trimester), ${showing}, due in about ${due} week${due === 1 ? '' : 's'}`;
};

const isActive = (p: Pregnancy): boolean => p.status === 'gestating' || p.status === 'birth';

/** The PC's own active pregnancy, if she is female and has one. */
export const pcPregnancy = (
    pregnancies: readonly Pregnancy[] | undefined,
    character: Pick<Character, 'name' | 'gender'>,
): Pregnancy | undefined => {
    if (!isFemale(character)) return undefined;
    const pc = norm(character.name);
    return (pregnancies ?? []).find(p => isActive(p) && norm(p.motherName) === pc);
};

/**
 * v1.61: write each NPC mother's pregnancy into her living record (register
 * state, key `pregnancy`). Opens a register if she has none. Returns the same
 * array when nothing changed.
 */
export const syncPregnancyRegisters = (
    entities: KnownEntity[],
    pregnancies: readonly Pregnancy[] | undefined,
    pcName: string,
    nowMinutes: number,
    turn: number,
): KnownEntity[] => {
    let out = entities;
    for (const p of pregnancies ?? []) {
        if (!isActive(p)) continue;
        const mother = norm(p.motherName);
        if (!mother || mother === 'unknown' || mother === norm(pcName)) continue;
        const idx = matchRegisterNpc(out, p.motherName);
        if (idx < 0) continue;
        const e = out[idx];
        const reg = e.register ?? createRegister(turn);
        const value = describePregnancy(p, nowMinutes);
        const at = reg.state.findIndex(s => s.key === PREGNANCY_STATE_KEY);
        if (at >= 0 && reg.state[at].value === value) continue;
        const state = reg.state.filter(s => s.key !== PREGNANCY_STATE_KEY);
        state.push({ key: PREGNANCY_STATE_KEY, value, turn: at >= 0 ? reg.state[at].turn : turn });
        if (out === entities) out = [...entities];
        out[idx] = { ...e, register: { ...reg, state, updatedTurn: turn } };
    }
    return out;
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
     * otherwise the father.
     */
    initiatePregnancy: (character: Character, turnCount: number, conceptionTime: number, partnerName: string = 'Unknown'): Pregnancy => {
        const female = isFemale(character);
        return {
            id: `preg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            motherName: female ? character.name : partnerName,
            fatherName: female ? partnerName : character.name,
            conceptionTurn: turnCount,
            conceptionTime: conceptionTime,
            currentWeek: 0,
            isVisible: false,
            status: 'gestating'
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
     * Advances all active pregnancies to the in-game clock.
     * Returns the updated list and any notable status updates (logs).
     */
    advancePregnancies: (pregnancies: readonly Pregnancy[], nowMinutes: number): { updated: Pregnancy[], logs: string[] } => {
        const logs: string[] = [];

        const updated = pregnancies.map(p => {
            if (p.status !== 'gestating') return p;

            const elapsed = Math.max(0, nowMinutes - p.conceptionTime);
            const newWeek = Math.floor(elapsed / MINUTES_PER_WEEK);

            const changes: Partial<Pregnancy> = {};

            if (newWeek >= VISIBLE_WEEK && !p.isVisible) {
                changes.isVisible = true;
                logs.push(`[BIO-ALERT] ${p.motherName}'s condition is now visibly noticeable (Week ${VISIBLE_WEEK}).`);
            }

            if (newWeek >= TERM_WEEK) {
                changes.status = 'birth';
                logs.push(`[BIO-ALERT] ${p.motherName} has reached full term (Week ${TERM_WEEK}). Labor imminent.`);
            }

            return { ...p, currentWeek: newWeek, ...changes };
        });

        return { updated, logs };
    }
};
