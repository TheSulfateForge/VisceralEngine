
// ────────────────────────────────────────────────────────────────────────────
// v1.59: THE NPC REGISTER — a living record per named NPC.
//
// The authored sheet says who an NPC IS. The register records what has
// HAPPENED to them in this game: what they know and how they learned it, what
// they currently are (keyed state that replaces, never piles up), promises in
// both directions, how they feel about people, their intimate history, and —
// rarely — a sustained change in how they behave. Where the register and the
// sheet disagree, the register wins.
//
// Created only for named NPCs the player has had a scene with. Written by the
// post-turn register pass (services/registerService.ts) as validated diffs;
// the engine applies them here, keyed and capped, so a bad pass can add a
// wrong entry (the player can delete it) but can never corrupt the record.
// ────────────────────────────────────────────────────────────────────────────

import type {
    KnownEntity, NpcRegister, RegisterKnowledge, RegisterSource, RegisterPromise, RegisterIntimacy,
} from '../../types';
import { generateUUID } from '../../idUtils';
import { identifyingNames } from './npcMemory';

export const REGISTER_CAPS = {
    knowledge: 60,
    state: 24,
    promises: 20,
    feelings: 12,
    firsts: 30,
    acts: 30,
    wants: 24,
    kinksShown: 20,
    developments: 6,
} as const;

/** Per NPC, per turn — a pass that tries to write more is truncated. */
export const REGISTER_TURN_LIMITS = { knowledge: 4, state: 3, promises: 2, feelings: 2, wants: 3, acts: 6, kinksShown: 3 } as const;

/** Prompt budget for an in-scene NPC. */
export const REGISTER_PROMPT = { knowledgeRelevant: 6, knowledgeRecent: 2, promises: 5, wants: 8 } as const;

export const emptyIntimacy = (): RegisterIntimacy => ({ firsts: [], acts: [], wants: [], kinksShown: [] });

export const createRegister = (turn: number): NpcRegister => ({
    createdTurn: turn,
    updatedTurn: turn,
    knowledge: [],
    state: [],
    promises: [],
    feelings: [],
    intimacy: emptyIntimacy(),
    developments: [],
});

// ── text helpers ────────────────────────────────────────────────────────────
const STOP = new Set(['the', 'and', 'that', 'with', 'from', 'this', 'have', 'has', 'had', 'was', 'were', 'his', 'her',
    'him', 'she', 'they', 'them', 'their', 'for', 'not', 'but', 'are', 'you', 'your', 'into', 'what', 'when', 'will',
    'would', 'about', 'after', 'before', 'then', 'than', 'been', 'also', 'just', 'said', 'told', 'knows', 'know']);
const words = (s: string): string[] =>
    (s ?? '').toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').split(/\s+/)
        .map(w => w.replace(/^'+|'+$/g, '').replace(/'s$/, ''))
        .filter(w => w.length >= 3 && !STOP.has(w));
const similar = (a: string, b: string): boolean => {
    const wa = new Set(words(a)), wb = new Set(words(b));
    if (wa.size === 0 || wb.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
    let n = 0;
    for (const w of wa) if (wb.has(w)) n++;
    return n / Math.min(wa.size, wb.size) >= 0.7;
};
const clip = (s: unknown, max = 220): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const keyOf = (s: unknown): string =>
    clip(s, 40).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const actOf = (s: unknown): string => clip(s, 48).toLowerCase().replace(/[.;:!?]+$/, '');
const capTail = <T,>(arr: T[], max: number): T[] => (arr.length > max ? arr.slice(arr.length - max) : arr);

// ── diff shape (what the register pass returns, after validation) ──────────
export interface RegisterDiff {
    npc: string;
    knowledge?: Array<{ text: string; source: RegisterSource; from?: string }>;
    state?: Array<{ key: string; value: string }>;
    promises?: Array<{ text: string; by: 'player' | 'npc'; status?: 'open' | 'kept' | 'broken' }>;
    feelings?: Array<{ toward: string; text: string }>;
    intimacy?: {
        acts?: string[];
        wants?: Array<{ text: string; kind: 'want' | 'limit' | 'not_yet' }>;
        kinks_shown?: string[];
    };
    development?: { text: string; turns?: number[] };
}

const SOURCES: RegisterSource[] = ['witnessed', 'told', 'rumor', 'record'];
const WANT_KINDS = ['want', 'limit', 'not_yet'] as const;
const PROMISE_STATUS = ['open', 'kept', 'broken'] as const;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Validate the raw pass output into diffs. Anything malformed is dropped. */
export const parseRegisterDiffs = (raw: unknown): RegisterDiff[] => {
    const updates = isObj(raw) ? arr(raw.updates) : arr(raw);
    const out: RegisterDiff[] = [];
    for (const u of updates) {
        if (!isObj(u) || !clip(u.npc, 120)) continue;
        const d: RegisterDiff = { npc: clip(u.npc, 120) };
        const k = arr(u.knowledge).filter(isObj)
            .map(x => ({ text: clip(x.text), source: (SOURCES as string[]).includes(String(x.source)) ? x.source as RegisterSource : 'witnessed' as RegisterSource, from: clip(x.from, 80) || undefined }))
            .filter(x => x.text).slice(0, REGISTER_TURN_LIMITS.knowledge);
        if (k.length) d.knowledge = k;
        const st = arr(u.state).filter(isObj).map(x => ({ key: keyOf(x.key), value: clip(x.value, 160) }))
            .filter(x => x.key && x.value).slice(0, REGISTER_TURN_LIMITS.state);
        if (st.length) d.state = st;
        const pr = arr(u.promises).filter(isObj)
            .map(x => ({ text: clip(x.text), by: x.by === 'npc' ? 'npc' as const : 'player' as const, status: (PROMISE_STATUS as readonly string[]).includes(String(x.status)) ? x.status as 'open' | 'kept' | 'broken' : undefined }))
            .filter(x => x.text).slice(0, REGISTER_TURN_LIMITS.promises);
        if (pr.length) d.promises = pr;
        const fe = arr(u.feelings).filter(isObj).map(x => ({ toward: clip(x.toward, 80), text: clip(x.text, 160) }))
            .filter(x => x.toward && x.text).slice(0, REGISTER_TURN_LIMITS.feelings);
        if (fe.length) d.feelings = fe;
        if (isObj(u.intimacy)) {
            const i = u.intimacy;
            const acts = arr(i.acts).map(actOf).filter(Boolean).slice(0, REGISTER_TURN_LIMITS.acts);
            const wants = arr(i.wants).filter(isObj)
                .map(x => ({ text: clip(x.text, 160), kind: (WANT_KINDS as readonly string[]).includes(String(x.kind)) ? x.kind as 'want' | 'limit' | 'not_yet' : 'want' as const }))
                .filter(x => x.text).slice(0, REGISTER_TURN_LIMITS.wants);
            const kinks = arr(i.kinks_shown).map(x => clip(x, 120)).filter(Boolean).slice(0, REGISTER_TURN_LIMITS.kinksShown);
            if (acts.length || wants.length || kinks.length) {
                d.intimacy = {
                    ...(acts.length ? { acts } : {}),
                    ...(wants.length ? { wants } : {}),
                    ...(kinks.length ? { kinks_shown: kinks } : {}),
                };
            }
        }
        if (isObj(u.development) && clip(u.development.text)) {
            d.development = {
                text: clip(u.development.text),
                turns: arr(u.development.turns).filter((t): t is number => typeof t === 'number' && Number.isFinite(t)).slice(0, 8),
            };
        }
        if (Object.keys(d).length > 1) out.push(d);
    }
    return out;
};

/**
 * Apply one diff. Knowledge/promises/wants de-duplicate by meaning; state and
 * feelings replace by key; acts count up and record the first time; every
 * list is capped. Returns the new register and a short change summary.
 */
export const applyRegisterDiff = (reg: NpcRegister, d: RegisterDiff, turn: number): { register: NpcRegister; changes: string[] } => {
    const r: NpcRegister = {
        ...reg,
        knowledge: [...reg.knowledge],
        state: [...reg.state],
        promises: [...reg.promises],
        feelings: [...reg.feelings],
        intimacy: {
            firsts: [...reg.intimacy.firsts],
            acts: reg.intimacy.acts.map(a => ({ ...a })),
            wants: [...reg.intimacy.wants],
            kinksShown: [...reg.intimacy.kinksShown],
        },
        developments: [...reg.developments],
    };
    const changes: string[] = [];

    for (const k of d.knowledge ?? []) {
        const at = r.knowledge.findIndex(x => similar(x.text, k.text));
        const entry: RegisterKnowledge = { id: at >= 0 ? r.knowledge[at].id : generateUUID(), text: k.text, source: k.source, from: k.from, turn };
        if (at >= 0) {
            // A confirmed belief upgrades; a rumour never downgrades what was seen.
            const rank = (s: RegisterSource) => ({ record: 0, rumor: 1, told: 2, witnessed: 3 }[s]);
            if (rank(k.source) < rank(r.knowledge[at].source)) continue;
            r.knowledge.splice(at, 1);
        } else changes.push(`knows: ${k.text.slice(0, 60)}`);
        r.knowledge.push(entry);
    }
    for (const s of d.state ?? []) {
        const at = r.state.findIndex(x => x.key === s.key);
        if (at >= 0 && r.state[at].value === s.value) continue;
        if (at >= 0) r.state.splice(at, 1);
        r.state.push({ key: s.key, value: s.value, turn });
        changes.push(`${s.key}: ${s.value.slice(0, 40)}`);
    }
    for (const p of d.promises ?? []) {
        const at = r.promises.findIndex(x => x.by === p.by && similar(x.text, p.text));
        if (at >= 0) {
            const status = p.status ?? r.promises[at].status;
            if (status !== r.promises[at].status) changes.push(`promise ${status}: ${p.text.slice(0, 40)}`);
            r.promises[at] = { ...r.promises[at], status };
            continue;
        }
        const entry: RegisterPromise = { id: generateUUID(), text: p.text, by: p.by, status: p.status ?? 'open', turn };
        r.promises.push(entry);
        changes.push(`promise: ${p.text.slice(0, 50)}`);
    }
    for (const f of d.feelings ?? []) {
        const at = r.feelings.findIndex(x => x.toward.toLowerCase() === f.toward.toLowerCase());
        if (at >= 0) r.feelings.splice(at, 1);
        r.feelings.push({ toward: f.toward, text: f.text, turn });
        changes.push(`feels toward ${f.toward}`);
    }
    for (const act of d.intimacy?.acts ?? []) {
        const at = r.intimacy.acts.findIndex(a => a.act === act);
        if (at >= 0) {
            if (r.intimacy.acts[at].lastTurn === turn) continue; // once per turn
            r.intimacy.acts[at] = { ...r.intimacy.acts[at], count: r.intimacy.acts[at].count + 1, lastTurn: turn };
        } else {
            r.intimacy.acts.push({ act, count: 1, lastTurn: turn });
            r.intimacy.firsts.push({ act, turn });
            changes.push(`first: ${act}`);
        }
    }
    for (const w of d.intimacy?.wants ?? []) {
        const at = r.intimacy.wants.findIndex(x => similar(x.text, w.text));
        if (at >= 0) r.intimacy.wants.splice(at, 1);
        r.intimacy.wants.push({ id: generateUUID(), text: w.text, kind: w.kind, turn });
        changes.push(`${w.kind}: ${w.text.slice(0, 40)}`);
    }
    for (const k of d.intimacy?.kinks_shown ?? []) {
        if (r.intimacy.kinksShown.some(x => similar(x.text, k))) continue;
        r.intimacy.kinksShown.push({ text: k, turn });
        changes.push(`shown: ${k.slice(0, 40)}`);
    }
    if (d.development) {
        const at = r.developments.findIndex(x => similar(x.text, d.development!.text));
        if (at >= 0) r.developments.splice(at, 1);
        r.developments.push({ id: generateUUID(), text: d.development.text, turns: d.development.turns ?? [], turn });
        changes.push(`developed: ${d.development.text.slice(0, 50)}`);
    }

    // caps — knowledge drops the oldest 'record' entries first
    while (r.knowledge.length > REGISTER_CAPS.knowledge) {
        const rec = r.knowledge.findIndex(x => x.source === 'record');
        r.knowledge.splice(rec >= 0 ? rec : 0, 1);
    }
    r.state = capTail(r.state, REGISTER_CAPS.state);
    r.promises = capTail(r.promises, REGISTER_CAPS.promises);
    r.feelings = capTail(r.feelings, REGISTER_CAPS.feelings);
    r.intimacy.firsts = capTail(r.intimacy.firsts, REGISTER_CAPS.firsts);
    r.intimacy.acts = capTail(r.intimacy.acts, REGISTER_CAPS.acts);
    r.intimacy.wants = capTail(r.intimacy.wants, REGISTER_CAPS.wants);
    r.intimacy.kinksShown = capTail(r.intimacy.kinksShown, REGISTER_CAPS.kinksShown);
    r.developments = capTail(r.developments, REGISTER_CAPS.developments);
    if (changes.length) r.updatedTurn = turn;
    return { register: r, changes };
};

/** Copy filed story facts (v1.58 `witnessed`) into the register as 'record' knowledge. */
export const syncRecordFacts = (reg: NpcRegister, facts: string[], turn: number): NpcRegister => {
    const add = facts.filter(f => f?.trim() && !reg.knowledge.some(k => similar(k.text, f)));
    if (add.length === 0) return reg;
    return applyRegisterDiff(reg, { npc: '', knowledge: add.map(text => ({ text: clip(text), source: 'record' as const })) }, turn).register;
};

/** Find the entity a pass named, by exact name, then given name. */
export const matchRegisterNpc = (entities: KnownEntity[], name: string): number => {
    const exact = entities.findIndex(e => e.name === name);
    if (exact >= 0) return exact;
    const lower = name.toLowerCase();
    const loose = entities.findIndex(e => e.name.toLowerCase() === lower || e.name.toLowerCase().startsWith(lower));
    if (loose >= 0) return loose;
    const given = identifyingNames(name)[0]?.toLowerCase();
    if (!given) return -1;
    const hits = entities.map((e, i) => ({ i, g: identifyingNames(e.name)[0]?.toLowerCase() })).filter(x => x.g === given);
    return hits.length === 1 ? hits[0].i : -1;
};

/**
 * Create registers for named NPCs in a direct scene this turn: present, named
 * in the player's input or the narration, and not dead. Older saves: a
 * one-time pass also opens registers for NPCs whose ledger shows past
 * interaction. Either way the register starts with the NPC's filed facts.
 */
export const openRegisters = (
    entities: KnownEntity[],
    playerInput: string,
    narrative: string,
    turn: number,
    migrateOlderSave: boolean,
): { entities: KnownEntity[]; opened: string[] } => {
    const opened: string[] = [];
    const text = `${playerInput ?? ''}\n${narrative ?? ''}`;
    const next = entities.map(e => {
        if (e.register || e.status === 'dead' || e.status === 'retired') return e;
        const names = identifyingNames(e.name);
        if (names.length === 0) return e;
        const named = names.some(n => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text));
        const inScene = e.status === 'present' && named;
        const pastScene = migrateOlderSave && (e.ledger?.length ?? 0) > 0;
        if (!inScene && !pastScene) return e;
        opened.push(e.name);
        return { ...e, register: syncRecordFacts(createRegister(turn), e.witnessed ?? [], turn) };
    });
    return { entities: next, opened };
};

// ── prompt rendering ───────────────────────────────────────────────────────
const relevance = (text: string, q: Set<string>): number => {
    let n = 0;
    for (const w of new Set(words(text))) if (q.has(w)) n++;
    return n;
};
const sourceLabel = (k: RegisterKnowledge): string =>
    k.source === 'witnessed' ? `saw, t${k.turn}`
        : k.source === 'told' ? `told${k.from ? ` by ${k.from}` : ''}, t${k.turn} — believes it`
            : k.source === 'rumor' ? `rumour, t${k.turn} — unconfirmed`
                : `on record`;

/** The register block for an in-scene NPC. Empty string when there is nothing to say. */
export const renderRegisterForPrompt = (reg: NpcRegister | undefined, query: string): string => {
    if (!reg) return '';
    const lines: string[] = [];
    if (reg.state.length) lines.push(`  Current: ${reg.state.map(s => `${s.key.replace(/_/g, ' ')}: ${s.value}`).join('; ')}`);
    if (reg.knowledge.length) {
        const q = new Set(words(query));
        const ranked = reg.knowledge.map((k, i) => ({ i, score: relevance(k.text, q) }))
            .filter(x => x.score > 0).sort((a, b) => b.score - a.score || b.i - a.i)
            .slice(0, REGISTER_PROMPT.knowledgeRelevant).map(x => x.i);
        const recent = reg.knowledge.map((_, i) => i).slice(-REGISTER_PROMPT.knowledgeRecent);
        const keep = new Set([...ranked, ...recent]);
        const shown = reg.knowledge.filter((_, i) => keep.has(i));
        lines.push(`  Knows (${shown.length} of ${reg.knowledge.length} shown): ${shown.map(k => `• ${k.text} (${sourceLabel(k)})`).join(' ')}`);
    }
    const open = reg.promises.filter(p => p.status === 'open').slice(-REGISTER_PROMPT.promises);
    if (open.length) lines.push(`  Open promises: ${open.map(p => `• ${p.by === 'player' ? 'player → them' : 'them → player'}: ${p.text}`).join(' ')}`);
    if (reg.feelings.length) lines.push(`  Feels: ${reg.feelings.map(f => `toward ${f.toward}: ${f.text}`).join('; ')}`);
    const i = reg.intimacy;
    if (i.acts.length || i.wants.length || i.kinksShown.length) {
        const parts: string[] = [];
        if (i.acts.length) parts.push(`done together: ${i.acts.map(a => `${a.act} ×${a.count} (first t${i.firsts.find(f => f.act === a.act)?.turn ?? a.lastTurn}, last t${a.lastTurn})`).join(', ')}`);
        const wants = i.wants.slice(-REGISTER_PROMPT.wants);
        if (wants.length) parts.push(`their stated terms (honour these): ${wants.map(w => `${w.kind === 'not_yet' ? 'not yet' : w.kind}: ${w.text}`).join('; ')}`);
        if (i.kinksShown.length) parts.push(`sheet kinks shown on the page so far: ${i.kinksShown.map(k => k.text).join(', ')} (anything else on the sheet has NOT surfaced yet)`);
        lines.push(`  Intimacy — ${parts.join(' | ')}`);
    }
    // No "nothing has happened" line: a register opened on an older save
    // starts with no intimate history even when there is one, and asserting
    // absence would overrule the story's own record.

    if (reg.developments.length) lines.push(`  Has changed: ${reg.developments.map(d => `• ${d.text}${d.turns.length ? ` (t${d.turns.join(', t')})` : ''}`).join(' ')}`);
    return lines.length ? `\n REGISTER (what has happened in THIS game — where it differs from the sheet above, the register wins):\n${lines.join('\n')}` : '';
};

/** Compact register summary for the register pass's own input. */
export const registerBrief = (reg: NpcRegister): string => {
    const parts: string[] = [];
    if (reg.state.length) parts.push(`state: ${reg.state.map(s => `${s.key}=${s.value}`).join('; ')}`);
    if (reg.knowledge.length) parts.push(`knows: ${reg.knowledge.slice(-20).map(k => k.text).join(' | ')}`);
    const open = reg.promises.filter(p => p.status === 'open');
    if (open.length) parts.push(`open promises: ${open.map(p => `[${p.by}] ${p.text}`).join(' | ')}`);
    if (reg.feelings.length) parts.push(`feelings: ${reg.feelings.map(f => `${f.toward}: ${f.text}`).join(' | ')}`);
    if (reg.intimacy.acts.length) parts.push(`acts so far: ${reg.intimacy.acts.map(a => a.act).join(', ')}`);
    if (reg.intimacy.wants.length) parts.push(`stated terms: ${reg.intimacy.wants.map(w => `${w.kind}: ${w.text}`).join(' | ')}`);
    if (reg.intimacy.kinksShown.length) parts.push(`kinks shown: ${reg.intimacy.kinksShown.map(k => k.text).join(', ')}`);
    if (reg.developments.length) parts.push(`developments: ${reg.developments.map(d => d.text).join(' | ')}`);
    return parts.join('\n') || '(empty)';
};
