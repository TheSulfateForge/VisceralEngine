// ============================================================================
// SCENE_CONTINUITY.TS — v1.31
//
// Three mechanisms that attack the same root cause: the prompt described STATE
// but never CHANGE, and the player could not write to state at all.
//
// Measured on the reviewed save (Codi Whitmore, 2026-08-19), the delta between
// two consecutive prompts was ~180 chars of new player text inside ~110k chars
// of context — every other block byte-identical. Two identical snapshots
// produce two identical outputs; that is the correct response to the input, not
// a model defect.
//
//   1. SCENE LEDGER   — what this scene has already spent, so the model can see
//                       what is used up and advancing becomes mechanically
//                       possible.
//   2. PLAYER CANON   — facts the player asserted, promoted into state instead
//                       of left in chat history to compete with 110k of context.
//   3. TURN DIGEST    — an end-of-turn snapshot, diffed next turn into a
//                       [SINCE LAST TURN] block, including the explicit
//                       "nothing changed" case.
// ============================================================================

import type {
    GameWorld,
    Character,
    KnownEntity,
    OocDirective,
    NpcPosition,
    NpcPositionUpdate,
    PlayerCanonEntry,
    SceneLedgerEntry,
    TurnDigest,
    WorldTickAction,
    WorldTickEvent,
} from '../../types';

// ---------------------------------------------------------------------------
// 1. SCENE LEDGER
// ---------------------------------------------------------------------------

/** Ledger depth. Long enough to cover a real conversation, short enough to stay cheap. */
export const SCENE_LEDGER_MAX = 12;

/** Per-turn cap on model-declared `established` clauses, so it can't flood the block. */
export const ESTABLISHED_PER_TURN_MAX = 2;

/** Clause length cap — the ledger is an index, not a transcript. */
const BEAT_MAX_CHARS = 160;

const trimBeat = (s: string): string => {
    const clean = s.replace(/\s+/g, ' ').trim();
    return clean.length > BEAT_MAX_CHARS ? clean.slice(0, BEAT_MAX_CHARS - 1) + '…' : clean;
};

/** Loose equality so a rephrased restatement doesn't create a second entry. */
const beatKey = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean).slice(0, 10).join(' ');

/**
 * True when the scene has changed and the ledger must be dropped.
 *
 * A ledger that survives a scene change is worse than no ledger: it tells the
 * model not to re-establish things that are no longer true.
 */
export const sceneChanged = (
    previousLocation: string | undefined,
    nextLocation: string | undefined,
    previousMode: string | undefined,
    nextMode: string | undefined,
): boolean => {
    const locChanged = (previousLocation ?? '') !== (nextLocation ?? '');
    const modeChanged = (previousMode ?? '') !== (nextMode ?? '');
    return locChanged || modeChanged;
};

export interface SceneLedgerUpdate {
    ledger: SceneLedgerEntry[];
    /** True when the previous ledger was discarded because the scene turned over. */
    reset: boolean;
    /** Number of new beats recorded this turn. */
    added: number;
}

/**
 * Fold this turn's beats into the ledger.
 *
 * Sources, in order of trust:
 *   - `npcActions` filtered to player_visible — these already exist in the
 *     response and describe exactly the offers/promises that get re-made.
 *   - `established` — 0-2 short clauses the model declares directly, for beats
 *     that are not NPC actions (a fact observed, a decision taken).
 */
export const updateSceneLedger = (
    previous: SceneLedgerEntry[] | undefined,
    npcActions: WorldTickAction[] | undefined,
    established: string[] | undefined,
    turn: number,
    didSceneChange: boolean,
    idFactory: (n: number) => string = (n) => `slg_${turn}_${n}`,
): SceneLedgerUpdate => {
    const base = didSceneChange ? [] : [...(previous ?? [])];
    const seen = new Set(base.map(e => beatKey(e.beat)));

    const incoming: Array<{ beat: string; source: 'npc' | 'model' }> = [];

    for (const a of npcActions ?? []) {
        if (!a?.player_visible) continue;
        const beat = trimBeat(`${a.npc_name}: ${a.action}`);
        if (beat) incoming.push({ beat, source: 'npc' });
    }

    for (const raw of (established ?? []).slice(0, ESTABLISHED_PER_TURN_MAX)) {
        if (typeof raw !== 'string') continue;
        const beat = trimBeat(raw);
        if (beat) incoming.push({ beat, source: 'model' });
    }

    let added = 0;
    for (const item of incoming) {
        const key = beatKey(item.beat);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        base.push({ id: idFactory(added), beat: item.beat, turn, source: item.source });
        added++;
    }

    // FIFO — the oldest beats in a long scene are the ones safest to forget.
    const ledger = base.length > SCENE_LEDGER_MAX ? base.slice(base.length - SCENE_LEDGER_MAX) : base;
    return { ledger, reset: didSceneChange, added };
};

/** Render the ledger for the prompt. Empty string when there is nothing to say. */
export const buildSceneLedgerBlock = (ledger: SceneLedgerEntry[] | undefined): string => {
    if (!ledger || ledger.length === 0) return '';
    const lines = ledger.map(e => `- ${e.beat} (T${e.turn})`).join('\n');
    return `[SCENE LEDGER — already established in this scene]
This ground is COVERED. Do not re-offer, re-propose, re-observe or restage any
of it. If a line below is still unresolved, ADVANCE it — carry it out, have it
refused, or have something interrupt it. Repeating it is the one thing it
cannot do.
${lines}`;
};

// ---------------------------------------------------------------------------
// 2. PLAYER CANON
// ---------------------------------------------------------------------------

/** Cap. Old assertions age out; the important ones get restated or become conditions. */
export const PLAYER_CANON_MAX = 20;

const FACT_MAX_CHARS = 200;

/**
 * Reject assertions that reach outside the player's own character.
 *
 * The player owns their body, gear, abilities and history, and owns
 * corrections to anything the engine previously narrated about them. They do
 * NOT own NPC interiority or world events — without this boundary a player can
 * narrate the world out from under the engine, and every threat, faction and
 * relationship becomes unfalsifiable.
 */
const MENTAL_STATE_VERB = String.raw`(?:wants?|loves?|hates?|fears?|plans?|intends?|believes?|thinks?|feels?|knows?|trusts?|suspects?)`;

const OUT_OF_SCOPE_RE = [
    // Third-party mind-reading. The subject is a pronoun, a "the X" phrase, or a
    // capitalised name — deliberately NOT bare "I"/"my", which is the player
    // talking about themselves and is exactly what this channel is for.
    new RegExp(String.raw`\b(?:he|she|they|the\s+\w+|[A-Z][a-z]+)\s+(?:secretly\s+|actually\s+|really\s+)?${MENTAL_STATE_VERB}\b`),
    // "X is secretly/actually …" — same claim, different shape.
    /\b(?:he|she|they|the\s+\w+|[A-Z][a-z]+)\s+(?:is|are|was|were)\s+(?:secretly|actually|really)\b/,
    /\bevery(?:one|body)\s+(?:in|at|here)\b.*\b(?:is|are|wants?|will)\b/i,
    /\b(?:the\s+)?(?:world|kingdom|empire|faction|guild|army|city|region)\s+(?:is|has|was|will)\b/i,
    /\bthere\s+(?:is|are)\s+no\s+(?:more\s+)?(?:threats?|danger|enemies|pursuers?)\b/i,
    /\bno\s+one\s+(?:is|will|has)\b/i,
];

export interface CanonIngestResult {
    canon: PlayerCanonEntry[];
    accepted: string[];
    rejected: string[];
}

/**
 * Fold player assertions into canon, dropping duplicates and out-of-scope claims.
 */
export const ingestPlayerAssertions = (
    previous: PlayerCanonEntry[] | undefined,
    assertions: string[] | undefined,
    turn: number,
    viaOoc: boolean,
    idFactory: (n: number) => string = (n) => `pc_${turn}_${n}`,
): CanonIngestResult => {
    const canon = [...(previous ?? [])];
    const seen = new Set(canon.map(e => beatKey(e.fact)));
    const accepted: string[] = [];
    const rejected: string[] = [];

    for (const raw of assertions ?? []) {
        if (typeof raw !== 'string') continue;
        const fact = raw.replace(/\s+/g, ' ').trim().slice(0, FACT_MAX_CHARS);
        if (!fact) continue;

        if (OUT_OF_SCOPE_RE.some(re => re.test(fact))) {
            rejected.push(fact);
            continue;
        }
        const key = beatKey(fact);
        if (!key || seen.has(key)) continue;

        seen.add(key);
        canon.push({ id: idFactory(accepted.length), fact, turnAsserted: turn, viaOoc });
        accepted.push(fact);
    }

    const capped = canon.length > PLAYER_CANON_MAX ? canon.slice(canon.length - PLAYER_CANON_MAX) : canon;
    return { canon: capped, accepted, rejected };
};

/** Render player canon for the prompt. */
export const buildPlayerCanonBlock = (canon: PlayerCanonEntry[] | undefined): string => {
    if (!canon || canon.length === 0) return '';
    const lines = canon.map(e => `- ${e.fact}`).join('\n');
    return `[PLAYER CANON — stated by the player, binding]
These are true. The player established them; you do not get to re-litigate,
soften, or contradict them, and you must not write a line that assumes their
opposite.
${lines}`;
};

// ---------------------------------------------------------------------------
// 2b. OOC DIRECTIVES → [STANDING DIRECTIVES]  (v1.35)
// ---------------------------------------------------------------------------
// v1.31 built the OOC channel and had the model condense each OOC turn into a
// `directive`. `useGeminiClient` then wrote it to the DEBUG LOG and nowhere
// else — not to world state, not to any prompt block. In the 2026-08-31 save
// the extraction was exactly right:
//
//   [OOC DIRECTIVE] Ensure NPCs respond literally to the player's dialogue and
//   cease projecting hidden meanings or intentions onto the character.
//
// and it reached nothing. Combined with v1.31 filtering OOC replies out of the
// history sent to the model (correct on its own terms — an OOC reply sitting in
// history as a MODEL turn primes it to break character), the channel took the
// player's complaint, produced a reply promising a change, and then guaranteed
// that the next narrative prompt had never heard of any of it.
//
// That is the mechanical answer to "I address it and nothing changes".

/** How many standing directives ride in the prompt. FIFO beyond this. */
export const OOC_DIRECTIVE_MAX = 5;

// ---------------------------------------------------------------------------
// 2c. DIRECTIVE → REMINDER SUPPRESSION  (v1.37)
// ---------------------------------------------------------------------------
// v1.35 made directives binding in the prompt. It did not make them binding
// over the ENGINE's own standing reminders, which are appended after the whole
// dynamic context under "[SYSTEM REFRESH — MANDATORY COMPLIANCE]".
//
// The 2026-09-07 Carissa save is the whole argument. The player issued, over
// OOC, "Transition the narrative toward sexual themes and intimate physical
// escalation in NPC interactions." It was extracted, persisted and injected
// correctly. The next request carried PHYSICAL_RECIPROCATION, whose trailer
// read "Hold here or withdraw", in the last position in the prompt. The engine
// spent that turn telling the model to do the opposite of what the player had
// just ordered, and it won, because it spoke last.
//
// Two changes close that. The block now moves to the tail, AFTER the reminders
// (see promptUtils / useGeminiClient). And a directive that plainly countermands
// a specific reminder now removes it from the running instead of arguing with
// it. Classification happens ONCE, at ingest — this is a keyword pass and it
// belongs nowhere near the per-turn path.
//
// Deliberately narrow: only reminders that DAMPEN are suppressible, only on an
// unambiguous phrasing, and the suppression is logged.

/** Reminder keys a standing directive is allowed to countermand. */
const SUPPRESSIBLE: Record<string, RegExp[]> = {
    // The v1.29 dampeners. A player asking for escalation, predation, or
    // NPC-driven initiative is asking for exactly what these two brake.
    PHYSICAL_ESCALATION: [
        /\b(?:escalat|intimac|intimate|sexual|seduc|grope|molest|prey|predat|assault|forc\w*\s+(?:use|contact)|breed|rape)\w*/i,
        /\b(?:advance|initiate|push|progress)\w*\b[^.]{0,40}\b(?:physical|contact|touch|intimac|sexual)\w*/i,
        /\bdo\s+not\s+(?:wait|require|ask)\b[^.]{0,40}\b(?:reciprocat|permission|consent|invitation)\w*/i,
    ],
    PROPORTIONALITY: [
        /\bescalat\w*/i,
        /\b(?:do\s+not|don'?t|stop)\b[^.]{0,30}\b(?:de-?escalat|soften|sanitiz|sanitis|tone\s+down|hold\s+back)\w*/i,
    ],
    // A directive demanding characters be portrayed as written is a directive
    // against the world-normalcy dampener flattening them to background people.
    WORLD_NORMALCY: [
        /\b(?:predat|monstrous|monster|hostile|depraved|violent|cruel)\w*/i,
        /\bas\s+(?:they\s+are\s+)?written\b/i,
    ],
};

/**
 * Which reminders a directive countermands. Returns [] for the ordinary case —
 * most directives are about pacing, tone or phrasing and suppress nothing.
 */
export const directiveSuppressions = (text: string): string[] => {
    const t = (text ?? '').trim();
    if (!t) return [];
    return Object.entries(SUPPRESSIBLE)
        .filter(([, patterns]) => patterns.some(re => re.test(t)))
        .map(([key]) => key);
};

/**
 * Append a directive, de-duplicated against what is already standing.
 *
 * Deliberately keeps the model's condensed phrasing rather than the player's
 * raw OOC text: the raw text is a complaint ("why do you keep doing X"), and
 * what belongs in a prompt is the instruction it implies.
 */
export const ingestOocDirective = (
    existing: OocDirective[] | undefined,
    directive: string | undefined | null,
    turn: number,
    idFactory: () => string,
): { directives: OocDirective[]; added: boolean } => {
    const text = (directive ?? '').trim();
    const current = existing ? [...existing] : [];
    if (!text) return { directives: current, added: false };

    const key = beatKey(text);
    if (!key || current.some(d => beatKey(d.text) === key)) {
        return { directives: current, added: false };
    }

    const suppresses = directiveSuppressions(text);
    current.push({
        id: idFactory(),
        text,
        turn,
        ...(suppresses.length > 0 ? { suppresses } : {}),
    });
    const capped = current.length > OOC_DIRECTIVE_MAX
        ? current.slice(current.length - OOC_DIRECTIVE_MAX)
        : current;
    return { directives: capped, added: true };
};

/** Every reminder key countermanded by any standing directive. */
export const suppressedReminderKeys = (directives: OocDirective[] | undefined): string[] =>
    Array.from(new Set((directives ?? []).flatMap(d => d.suppresses ?? [])));

/**
 * Render standing directives for the prompt.
 *
 * v1.37: this block is no longer part of the dynamic context. The caller
 * appends it to the very END of the user message, after the section reminders,
 * so the player's instructions are the last thing the model reads. The
 * precedence sentence below is what makes that placement mean something.
 */
export const buildOocDirectivesBlock = (directives: OocDirective[] | undefined): string => {
    if (!directives || directives.length === 0) return '';
    const lines = directives.map(d => `- ${d.text}`).join('\n');
    return `[STANDING DIRECTIVES — from the player, binding, HIGHEST PRECEDENCE]
The player gave these instructions about HOW to narrate, out of character.
They apply to every turn from now on, not just the turn they were given.

PRECEDENCE: these outrank your own stylistic instincts AND every [SYSTEM
REMINDER] above. A system reminder is the engine's standing guidance; a
standing directive is the player telling you what they want from their own
game. Where the two conflict, the directive wins and the reminder is set
aside for that conflict — do not split the difference, do not comply
partially, and do not acknowledge the conflict in the narrative.
${lines}`;
};

// ---------------------------------------------------------------------------
// 2d. NPC POSITIONS → [NPC POSITIONS]  (v1.37)
// ---------------------------------------------------------------------------
// The idea-laundering failure. In the 2026-09-07 Maribel save an NPC argued
// against the player's proposal for eight consecutive turns, shifting the
// objection every time the previous one was answered, and then adopted the
// proposal and presented it as her own plan.
//
// `npcRhetoric.ts` (v1.35) names this in its own header — "having invented it,
// conceding it reads as the player's own idea handed back" — and has no
// detector for it, because detecting it needs memory the engine did not keep.
// Maribel's `ledger` after twelve turns of sustained argument read, in full:
//
//     ["Invited Ryan to mediate a dispute regarding an heirloom seal."]
//
// Her position on the seal — the entire dispute — was recorded nowhere, so
// every turn re-derived it from personality adjectives plus the last narrative
// and it drifted toward whoever had argued most recently.
//
// This is the minimum state that makes "you argued the opposite on turn 6" a
// fact the prompt can carry.

/** How many positions ride in the prompt. FIFO beyond this. */
export const NPC_POSITION_MAX = 6;

/** Recognised stances; anything else is normalised to 'held'. */
const STANCES = new Set(['held', 'changed', 'conceded']);

const normaliseStance = (s: string | undefined): string => {
    const v = (s ?? '').trim().toLowerCase();
    return STANCES.has(v) ? v : 'held';
};

/**
 * Fold this turn's reported positions into the record.
 *
 * One position per holder: an NPC has one stance on the dispute at a time, and
 * keeping a stack of them per character would reproduce the drift this exists
 * to stop. A new report for a holder REPLACES their line and keeps the original
 * `turnStated`, so the prompt can show how long they have held it.
 */
export const ingestNpcPositions = (
    existing: NpcPosition[] | undefined,
    updates: NpcPositionUpdate[] | undefined,
    turn: number,
    idFactory: () => string,
): { positions: NpcPosition[]; changed: string[] } => {
    const current = existing ? [...existing] : [];
    const changed: string[] = [];
    if (!updates || updates.length === 0) return { positions: current, changed };

    for (const u of updates) {
        const holder = (u?.holder ?? '').trim();
        const position = (u?.position ?? '').trim();
        if (!holder || !position) continue;

        const stance = normaliseStance(u?.stance);
        const idx = current.findIndex(p => p.holder.toLowerCase() === holder.toLowerCase());

        if (idx === -1) {
            current.push({
                id: idFactory(),
                holder,
                position,
                stance,
                turnStated: turn,
                turnLastSeen: turn,
            });
            changed.push(`${holder}: "${position}" (${stance})`);
            continue;
        }

        const prev = current[idx];
        const samePosition = beatKey(prev.position) === beatKey(position);
        current[idx] = {
            ...prev,
            position,
            stance,
            // A restatement keeps the original turn; a genuine change restarts
            // the clock, because that is a new position with its own history.
            turnStated: samePosition ? prev.turnStated : turn,
            turnLastSeen: turn,
        };
        if (!samePosition || prev.stance !== stance) {
            changed.push(`${holder}: "${position}" (${stance}, was "${prev.position}" / ${prev.stance})`);
        }
    }

    const capped = current.length > NPC_POSITION_MAX
        ? current.slice(current.length - NPC_POSITION_MAX)
        : current;
    return { positions: capped, changed };
};

/**
 * Render the record for the prompt.
 *
 * Returns '' when there is nothing on the record, which is also what keeps
 * NPC_POSITION from firing — a scene with no dispute in it pays nothing.
 */
export const buildNpcPositionsBlock = (positions: NpcPosition[] | undefined): string => {
    if (!positions || positions.length === 0) return '';
    const lines = positions
        .map(p => {
            const held = p.turnLastSeen > p.turnStated
                ? ` — stated turn ${p.turnStated}, still held as of turn ${p.turnLastSeen}`
                : ` — stated turn ${p.turnStated}`;
            return `- ${p.holder} [${p.stance}]: ${p.position}${held}`;
        })
        .join('\n');
    return `[NPC POSITIONS — already on the record]\n${lines}`;
};

// ---------------------------------------------------------------------------
// 3. TURN DIGEST → [SINCE LAST TURN]
// ---------------------------------------------------------------------------

const presentNames = (entities: KnownEntity[] | undefined): string[] =>
    (entities ?? [])
        .filter(e => !e.status || e.status === 'present' || e.status === 'nearby')
        .map(e => e.name)
        .sort();

/**
 * Snapshot the volatile state to diff a later turn against.
 *
 * v1.36: this MUST be called with the state as it stood at the START of a turn
 * (`ctx.previousWorld` / `ctx.previousCharacter`), never the post-pipeline
 * world. Passing the outgoing world makes the next turn compare that world
 * against itself, and the diff is then empty on every field forever — see the
 * note in `17-sceneContinuity.ts`. `turn` is the turn the digest is a baseline
 * FOR, not the turn whose state it holds.
 */
export const buildTurnDigest = (
    world: GameWorld,
    character: Character,
    turn: number,
    liveThreats?: WorldTickEvent[],
): TurnDigest => ({
    turn,
    location: world.location ?? '',
    totalMinutes: world.time?.totalMinutes ?? 0,
    sceneMode: world.sceneMode ?? 'NARRATIVE',
    tensionLevel: world.tensionLevel ?? 0,
    presentEntities: presentNames(world.knownEntities),
    threatCount: (liveThreats ?? world.emergingThreats ?? []).filter(t => t.status !== 'unvalidated').length,
    conditionCount: (character.conditions ?? []).length,
});

const minutesToClause = (delta: number): string => {
    if (delta <= 0) return 'no time passed';
    if (delta < 60) return `+${delta}min`;
    const h = Math.floor(delta / 60);
    const m = delta % 60;
    return m === 0 ? `+${h}h` : `+${h}h${m}m`;
};

/**
 * Diff the previous digest against the current state.
 *
 * The null case is the important one. When nothing has changed, saying so
 * EXPLICITLY is far stronger than letting the model infer it from a snapshot
 * identical to the one it saw last turn — the inference it actually makes from
 * an identical snapshot is "produce the same output".
 */
export const buildSinceLastTurnBlock = (
    previous: TurnDigest | undefined,
    world: GameWorld,
    character: Character,
    newCanonThisTurn: string[] = [],
): string => {
    if (!previous) return '';

    const lines: string[] = [];

    const minutesDelta = (world.time?.totalMinutes ?? 0) - previous.totalMinutes;
    if (minutesDelta !== 0) lines.push(`Clock: ${minutesToClause(minutesDelta)} → ${world.time?.display ?? ''}`.trim());

    const loc = world.location ?? '';
    if (loc !== previous.location) lines.push(`Location: ${previous.location || 'unknown'} → ${loc || 'unknown'}`);

    const mode = world.sceneMode ?? 'NARRATIVE';
    if (mode !== previous.sceneMode) lines.push(`Scene mode: ${previous.sceneMode} → ${mode}`);

    const tension = world.tensionLevel ?? 0;
    if (tension !== previous.tensionLevel) lines.push(`Tension: ${previous.tensionLevel} → ${tension}`);

    const now = presentNames(world.knownEntities);
    const before = new Set(previous.presentEntities);
    const arrived = now.filter(n => !before.has(n));
    const left = previous.presentEntities.filter(n => !now.includes(n));
    if (arrived.length) lines.push(`Arrived: ${arrived.join(', ')}`);
    if (left.length) lines.push(`No longer present: ${left.join(', ')}`);

    const threats = (world.emergingThreats ?? []).filter(t => t.status !== 'unvalidated').length;
    if (threats !== previous.threatCount) lines.push(`Live threats: ${previous.threatCount} → ${threats}`);

    const conditions = (character.conditions ?? []).length;
    if (conditions !== previous.conditionCount) lines.push(`Conditions: ${previous.conditionCount} → ${conditions}`);

    for (const fact of newCanonThisTurn) lines.push(`Player established: ${fact}`);

    if (lines.length === 0) {
        return `[SINCE LAST TURN]
NOTHING IN THE WORLD STATE CHANGED. Same place, same clock, same people, same
stakes. You are not being asked to re-establish the situation — the player can
still read your last message. Do not restate it, re-describe the room, or
re-stage the beat you just wrote. Something must be different by the end of
this turn: someone acts, someone arrives or leaves, a fact is revealed, or a
choice closes.`;
    }

    return `[SINCE LAST TURN]\n${lines.map(l => `- ${l}`).join('\n')}`;
};
