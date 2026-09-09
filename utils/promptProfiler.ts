// ============================================================================
// PROMPT_PROFILER.TS — v1.43
//
// `constructGeminiPrompt` takes ~20 seconds per turn and nobody knows which
// part.
//
// Measured across three saves: "Sending Request" is logged BEFORE the prompt is
// built, and the "[THINKING FLOOR]" line lands after it, so the gap between
// them is client-side prompt construction. It ran 18s (2026-09-07), 21s
// (2026-09-08) and 20s (2026-09-09) — against a model call of 5-12s. It is
// roughly 60% of every turn the player waits through, it has been that way for
// as long as the logs go back, and it does NOT correlate with the size of what
// the prompt ends up containing: build time was 19s median on turns whose
// entities block exceeded 20,000 chars and 22s on turns under it.
//
// That non-correlation is the whole reason for this module. It rules out "the
// prompt is big" and leaves a fixed per-turn cost, which means the answer is a
// specific call, not a general inefficiency — and guessing which one has
// already been wrong once. The candidates, from reading the path:
//
//   - `embeddingService.encodeQuery` ×2, transformers.js inference, which falls
//     back to IN-THREAD execution whenever the Worker is unavailable or has
//     failed once (`workerFailed`);
//   - `embeddingsRepo.listForCampaign`, which loads EVERY embedding row for the
//     campaign out of IndexedDB on every turn and filters by model in JS;
//   - the lexical scorers over the full lore/entity corpus;
//   - `db.loadWorldSeed` on turn 0 only.
//
// This measures all of them in the real app on real turns, because that is the
// only place the embedder, the Worker and IndexedDB all behave as they actually
// behave. A synthetic benchmark in Node would exercise none of them.
//
// Overhead is a handful of `performance.now()` calls per turn against a 20,000ms
// baseline, so it stays on rather than hiding behind a flag nobody turns on.
// ============================================================================

export interface ProfileSpan {
    label: string;
    ms: number;
    /** Optional detail — row counts, item counts, cache state. */
    note?: string;
}

export interface PromptProfile {
    spans: ProfileSpan[];
    totalMs: number;
}

/**
 * A single turn's timer.
 *
 * Nested code (inside `buildHybridContext`, for example) records spans through
 * the module-level `activeProfiler` rather than by threading a parameter down
 * through every signature. That is safe here because a turn is a single
 * awaited sequence on one thread: there is never a second prompt build in
 * flight. `begin()` clears any profiler a thrown turn left behind.
 */
export class PromptProfiler {
    private readonly spans: ProfileSpan[] = [];
    private readonly startedAt: number;

    constructor() {
        this.startedAt = now();
    }

    /** Time an async phase. */
    async span<T>(label: string, fn: () => Promise<T>, note?: (result: T) => string): Promise<T> {
        const t0 = now();
        try {
            const result = await fn();
            this.spans.push({ label, ms: now() - t0, note: note?.(result) });
            return result;
        } catch (e) {
            this.spans.push({ label: `${label} (threw)`, ms: now() - t0 });
            throw e;
        }
    }

    /** Time a synchronous phase. */
    sync<T>(label: string, fn: () => T, note?: (result: T) => string): T {
        const t0 = now();
        const result = fn();
        this.spans.push({ label, ms: now() - t0, note: note?.(result) });
        return result;
    }

    /** Record a span measured elsewhere. */
    record(label: string, ms: number, note?: string): void {
        this.spans.push({ label, ms, note });
    }

    finish(): PromptProfile {
        return { spans: [...this.spans], totalMs: now() - this.startedAt };
    }
}

const now = (): number =>
    (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();

// ---------------------------------------------------------------------------
// Ambient profiler, for code too deep to thread a parameter into
// ---------------------------------------------------------------------------

let activeProfiler: PromptProfiler | null = null;

/** Start a turn's profile. Replaces any profiler a failed turn left behind. */
export const beginPromptProfile = (): PromptProfiler => {
    activeProfiler = new PromptProfiler();
    return activeProfiler;
};

export const endPromptProfile = (): void => {
    activeProfiler = null;
};

/**
 * Record a span from nested code. A no-op when no build is in flight, so the
 * instrumented functions stay callable from tests and background paths.
 */
export const profileSpan = async <T>(
    label: string,
    fn: () => Promise<T>,
    note?: (result: T) => string,
): Promise<T> => {
    const p = activeProfiler;
    if (!p) return fn();
    return p.span(label, fn, note);
};

/** Synchronous counterpart. */
export const profileSync = <T>(label: string, fn: () => T, note?: (result: T) => string): T => {
    const p = activeProfiler;
    if (!p) return fn();
    return p.sync(label, fn, note);
};

/** Note a fact about this turn's build without timing anything. */
export const profileNote = (label: string, note: string): void => {
    activeProfiler?.record(label, 0, note);
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Spans below this are folded into "rest" — the log line is for finding the fat. */
const REPORT_FLOOR_MS = 5;

/**
 * One log line, ordered by cost, with the dominant phase called out.
 *
 * Ordered by cost rather than by execution order on purpose: the question this
 * exists to answer is "what should I fix", and that is the first entry.
 */
export const formatPromptProfile = (profile: PromptProfile): string => {
    const timed = profile.spans.filter(s => s.ms >= REPORT_FLOOR_MS);
    const restMs = profile.spans
        .filter(s => s.ms < REPORT_FLOOR_MS)
        .reduce((a, s) => a + s.ms, 0);

    const ranked = [...timed].sort((a, b) => b.ms - a.ms);
    const parts = ranked.map(s => {
        const pct = profile.totalMs > 0 ? Math.round((s.ms / profile.totalMs) * 100) : 0;
        return `${s.label}=${Math.round(s.ms)}ms(${pct}%)${s.note ? ` [${s.note}]` : ''}`;
    });

    // Untimed notes still carry information — embedding row counts, worker state.
    const notes = profile.spans
        .filter(s => s.ms === 0 && s.note)
        .map(s => `${s.label}: ${s.note}`);

    const unaccounted = Math.max(0, profile.totalMs - profile.spans.reduce((a, s) => a + s.ms, 0));

    const headline = ranked.length > 0
        ? `SLOWEST: ${ranked[0].label} at ${Math.round(ranked[0].ms)}ms of ${Math.round(profile.totalMs)}ms`
        : 'no phase exceeded the reporting floor';

    return `[PROMPT PROFILE] total=${Math.round(profile.totalMs)}ms — ${headline}. `
        + `${parts.join(' · ')}`
        + (restMs >= 1 ? ` · rest=${Math.round(restMs)}ms` : '')
        + (unaccounted >= REPORT_FLOOR_MS ? ` · untimed=${Math.round(unaccounted)}ms` : '')
        + (notes.length > 0 ? ` || ${notes.join(' · ')}` : '');
};
