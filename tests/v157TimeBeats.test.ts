import { describe, it, expect, beforeEach } from 'vitest';
import { splitActions, estimateActivityBySimilarity, _resetActivityAnchorCache, ACTIVITY_ANCHORS } from '../utils/engine/activityEstimate';
import { timeProgressionStep } from '../utils/pipeline/steps/02-timeProgression';
import { deriveWorldTime, estimateTimeFloor } from '../utils/engine/timeUtils';
import { GeminiClient } from '../services/geminiClient';

class Probe extends GeminiClient { check(d: unknown) { return this.validateResponse(d); } }
const probe = Object.create(Probe.prototype) as Probe;
const base = { narrative: 'x', thought_process: '', scene_mode: 'NARRATIVE', tension_level: 5 };

describe('v1.57 — time_beats are the primary time source', () => {
    it('beats are summed into time_passed_minutes', () => {
        const r = probe.check({ ...base, time_beats: [{ beat: 'dress', minutes: 8 }, { beat: 'brew coffee', minutes: '10' }, { beat: 'walk the garden', minutes: '~15' }] });
        expect(r.time_passed_minutes).toBe(33);
        expect(r.time_beats?.map(b => b.beat)).toEqual(['dress', 'brew coffee', 'walk the garden']);
        expect(r.time_passed_raw).toBeUndefined();
    });
    it('beats win over a disagreeing single figure', () => {
        expect(probe.check({ ...base, time_passed_minutes: 1, time_beats: [{ beat: 'meal', minutes: 25 }] }).time_passed_minutes).toBe(25);
    });
    it('junk beats are dropped; none left → the single figure', () => {
        const r = probe.check({ ...base, time_passed_minutes: 4, time_beats: [{ beat: '', minutes: 5 }, { beat: 'x', minutes: 'soon' }, 'nope'] });
        expect(r.time_beats).toBeUndefined();
        expect(r.time_passed_minutes).toBe(4);
    });
    it('the time step logs the beats', () => {
        const ctx: any = {
            sanitisedResponse: { narrative: 'I did it.', scene_mode: 'NARRATIVE', time_passed_minutes: 18, time_beats: [{ beat: 'dress', minutes: 8 }, { beat: 'coffee', minutes: 10 }] },
            playerInput: 'I dress and make coffee.', previousWorld: { time: deriveWorldTime(300), location: 'A — Kitchen' },
            worldUpdate: {}, debugLogs: [], effectiveTimeMode: 'SCENE',
        };
        const out = timeProgressionStep.execute(ctx) as any;
        expect(out.newTime.totalMinutes - 300).toBe(18);
        expect(ctx.debugLogs.map((l: any) => l.message).join('\n')).toMatch(/TIME BEATS — v1.57\] dress 8m · coffee 10m = \+18m/);
    });
});

describe('v1.57 — the embedding activity floor replaces the regex table when present', () => {
    it('estimateTimeFloor uses the supplied estimate, not the regex', () => {
        const f = estimateTimeFloor('', 'I finde a boom to read to pass the time.', undefined, 'A', { minutes: 30, labels: ['passing time 30m'] });
        expect(f.floor).toBe(30);
        const zero = estimateTimeFloor('', 'I take a bath.', undefined, 'A', { minutes: 0, labels: ['glance 0m'] });
        expect(zero.floor).toBe(0); // the matcher said trivial; the regex is not consulted
    });
    it('without an estimate the regex fallback still works', () => {
        expect(estimateTimeFloor('', 'I take a bath.', undefined, 'A').floor).toBeGreaterThanOrEqual(20);
    });
    it('the time step applies the estimate as a floor', () => {
        const ctx: any = {
            sanitisedResponse: { narrative: 'I read.', scene_mode: 'NARRATIVE', time_passed_minutes: 1, activity_estimate: { minutes: 30, labels: ['passing time 30m'] } },
            playerInput: 'I finde a boom to read to pass the time.', previousWorld: { time: deriveWorldTime(300), location: 'A — Solarium' },
            worldUpdate: {}, debugLogs: [], effectiveTimeMode: 'SCENE',
        };
        const out = timeProgressionStep.execute(ctx) as any;
        expect(out.newTime.totalMinutes - 300).toBe(30);
    });
});

describe('v1.57 — splitting a turn into actions', () => {
    it('cuts on sentences, sequencing words and "while"; drops speech and [notes]', () => {
        expect(splitActions('[It is 5:29AM] "Later, Miri." I put the book back and then I head to the kitchen. I slice bread while humming.'))
            .toEqual(['I put the book back', 'I head to the kitchen', 'I slice bread']); // one-word fragments dropped
    });
    it('the reported turn', () => {
        expect(splitActions('I head into the solarium to sit and read while sipping my coffee'))
            .toEqual(['I head into the solarium to sit and read', 'sipping my coffee']);
    });
});

// Deterministic stand-in encoder: one dimension per anchor; a clause lights
// up the anchor whose label word it contains. Exercises the plumbing
// (threshold, tie margin, sum, cap, cache) without the real model.
const fakeEncoder = () => {
    let calls = 0;
    const dim = ACTIVITY_ANCHORS.length;
    const vecFor = (t: string): Float32Array => {
        const v = new Float32Array(dim);
        const idx = ACTIVITY_ANCHORS.findIndex(a => a.text === t);
        if (idx >= 0) { v[idx] = 1; return v; }
        const words = t.toLowerCase();
        ACTIVITY_ANCHORS.forEach((a, j) => { if (words.includes(a.label.split(' ')[0])) v[j] = 0.9; });
        const n = Math.hypot(...v) || 1;
        return v.map(x => x / n) as Float32Array;
    };
    const enc = async (texts: string[]) => { calls++; return texts.map(vecFor); };
    return { enc, calls: () => calls };
};

describe('v1.57 — similarity estimate plumbing', () => {
    beforeEach(() => _resetActivityAnchorCache());
    it('unmatched clauses add nothing; anchors are embedded once', async () => {
        const f = fakeEncoder();
        const a = await estimateActivityBySimilarity('I frobnicate the widget.', f.enc);
        expect(a).toEqual({ minutes: 0, matches: [] });
        await estimateActivityBySimilarity('I frobnicate again.', f.enc);
        expect(f.calls()).toBe(3); // anchors once + one clause batch per turn
    });
    it('empty input makes no encoder call', async () => {
        const f = fakeEncoder();
        expect(await estimateActivityBySimilarity('"Hello."', f.enc)).toEqual({ minutes: 0, matches: [] });
        expect(f.calls()).toBe(0);
    });
});

// Real-model check (downloads bge-small, ~30 MB). Opt-in: VRE_EMBED_TESTS=1
describe.runIf(!!process.env.VRE_EMBED_TESTS)('v1.57 — bge-small on the Westcross save', () => {
    it('matches the reported turns', async () => {
        const { pipeline, env } = await import('@huggingface/transformers');
        env.allowLocalModels = false;
        const p: any = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5');
        const enc = async (t: string[]) => {
            const o = await p(t, { pooling: 'mean', normalize: true });
            const d = o.data as Float32Array; const k = d.length / t.length;
            return t.map((_, i) => new Float32Array(d.subarray(i * k, (i + 1) * k)));
        };
        const cases: Array<[string, number, number]> = [
            ['I rise and dress in loose thick black linen trousers, I put on a light cotton tunic, my belt with knife and remain barefoot. I head down stairs to the kitchen and start a pot of coffee.', 15, 40],
            ['I head into the solarium to sit and read while sipping my coffee', 30, 60],
            ['I turn and begin to eat my bread.', 10, 20],
            ['I finde a boom to read to pass the time.', 30, 45],
            ['Stretched I head back inside to my solarium to stretch out and read until Liora is up.', 30, 45],
            ['I cock my head at Miri after she has just spent time telling me what I am expected to do in regards of my personal life and time.', 0, 0],
            ['I think later I will go to the Lorrimer Academy. And then I will beat their students and champions.', 0, 0],
            ['I draw my knife and step toward him.', 0, 1],
        ];
        for (const [input, lo, hi] of cases) {
            const e = await estimateActivityBySimilarity(input, enc);
            expect(e.minutes, `${input} → ${JSON.stringify(e.matches)}`).toBeGreaterThanOrEqual(lo);
            expect(e.minutes, input).toBeLessThanOrEqual(hi);
        }
    }, 180000);
});
