import { describe, it, expect } from 'vitest';
import {
    PromptProfiler,
    beginPromptProfile,
    endPromptProfile,
    profileSpan,
    profileSync,
    profileNote,
    formatPromptProfile,
} from '../utils/promptProfiler';

// ============================================================================
// v1.43 — instrumenting the ~20s prompt build.
//
// Measured across three saves, "Sending Request" is logged before the prompt is
// built and "[THINKING FLOOR]" after it, so the gap is client-side construction:
// 18s / 21s / 20s median, against a 5-12s model call. It does NOT track prompt
// size — 19s median on turns whose entities block exceeded 20,000 chars, 22s on
// turns under it — which rules out "the prompt is big" and points at a specific
// call. A headless benchmark of the pure-CPU lexical scorer over the real
// roster (43 lore + 51 entities) came back at 13.4ms, so it is not that either.
// ============================================================================

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('v1.43 — the profiler measures what it is given', () => {
    it('times an async phase', async () => {
        const p = new PromptProfiler();
        await p.span('slow', () => sleep(30));
        const out = p.finish();
        expect(out.spans).toHaveLength(1);
        expect(out.spans[0].label).toBe('slow');
        expect(out.spans[0].ms).toBeGreaterThanOrEqual(20);
    });

    it('times a synchronous phase and carries its note', () => {
        const p = new PromptProfiler();
        const v = p.sync('score', () => [1, 2, 3], r => `${r.length} items`);
        expect(v).toEqual([1, 2, 3]);
        expect(p.finish().spans[0].note).toBe('3 items');
    });

    it('records the span even when the phase throws, and rethrows', async () => {
        const p = new PromptProfiler();
        await expect(p.span('boom', async () => { throw new Error('x'); })).rejects.toThrow('x');
        // A phase that fails is exactly the one worth seeing in the log.
        expect(p.finish().spans[0].label).toContain('threw');
    });
});

describe('v1.43 — the ambient profiler reaches nested code', () => {
    it('captures a span recorded from deep in the call tree', async () => {
        const p = beginPromptProfile();
        await profileSpan('embed:encodeQuery', () => sleep(20), () => '2 vector(s)');
        profileSync('rag:scoreLexical', () => null);
        profileNote('embed:modelFilter', '4 row(s) dropped as stale-model');
        const out = p.finish();
        endPromptProfile();

        expect(out.spans.map(s => s.label)).toContain('embed:encodeQuery');
        expect(out.spans.find(s => s.label === 'embed:encodeQuery')?.note).toBe('2 vector(s)');
        expect(out.spans.find(s => s.label === 'embed:modelFilter')?.ms).toBe(0);
    });

    it('is inert outside a build — instrumented code stays callable', async () => {
        endPromptProfile();
        await expect(profileSpan('x', async () => 42)).resolves.toBe(42);
        expect(profileSync('y', () => 7)).toBe(7);
        expect(() => profileNote('z', 'note')).not.toThrow();
    });

    it('a new build discards a profiler a thrown turn left behind', async () => {
        beginPromptProfile();
        await profileSpan('orphan', async () => 1);
        const fresh = beginPromptProfile();
        await profileSpan('current', async () => 1);
        const labels = fresh.finish().spans.map(s => s.label);
        expect(labels).toContain('current');
        expect(labels).not.toContain('orphan');
        endPromptProfile();
    });
});

describe('v1.43 — the log line answers "what should I fix"', () => {
    const profile = {
        totalMs: 20000,
        spans: [
            { label: 'rag:scoreLexical', ms: 13, note: '6 lore, 4 entities' },
            { label: 'embed:encodeQuery', ms: 15600, note: '2 vector(s)' },
            { label: 'embed:loadRows', ms: 4200, note: '109 rows read from IndexedDB' },
            { label: 'memory:select', ms: 2 },
            { label: 'embed:modelFilter', ms: 0, note: '4 row(s) dropped as stale-model' },
        ],
    };
    const line = formatPromptProfile(profile);

    it('names the dominant phase first', () => {
        expect(line).toContain('SLOWEST: embed:encodeQuery at 15600ms of 20000ms');
        expect(line.indexOf('embed:encodeQuery=')).toBeLessThan(line.indexOf('embed:loadRows='));
    });

    it('gives each phase a share of the total', () => {
        expect(line).toContain('embed:encodeQuery=15600ms(78%)');
        expect(line).toContain('embed:loadRows=4200ms(21%)');
    });

    it('keeps the diagnostic notes', () => {
        expect(line).toContain('109 rows read from IndexedDB');
        expect(line).toContain('4 row(s) dropped as stale-model');
    });

    it('folds trivia into "rest" rather than burying the finding', () => {
        expect(line).toContain('rest=2ms');
        expect(line).not.toContain('memory:select=');
    });

    it('reports time the spans do not account for', () => {
        // 20000 - 19815 = 185ms unaccounted; if that number is ever large, the
        // cost is somewhere nothing is measuring and the spans need extending.
        expect(line).toMatch(/untimed=\d+ms/);
    });

    it('does not crash on an empty profile', () => {
        expect(formatPromptProfile({ totalMs: 0, spans: [] }))
            .toContain('no phase exceeded the reporting floor');
    });
});
