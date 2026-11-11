import { describe, it, expect } from 'vitest';
import { parseLooseDuration } from '../utils/engine/looseNumber';
import { estimateActivityMinutes } from '../utils/engine/timeUtils';
import { GeminiClient } from '../services/geminiClient';

describe('v1.55 — loose durations from the model', () => {
    it('reads what a person meant', () => {
        const cases: Array<[unknown, number | undefined]> = [
            [20, 20], ['20', 20], ['~20', 20], ['about 30', 30], ['15-20', 17.5], ['15 to 25 minutes', 20],
            ['20 minutes', 20], ['an hour', 60], ['1.5 hours', 90], ['half an hour', 30], ['an hour and a half', 90],
            ['twenty minutes', 20], ['', undefined], ['none', undefined], [null, undefined],
        ];
        for (const [v, want] of cases) expect(parseLooseDuration(v, 'minutes'), String(v)).toBe(want);
        expect(parseLooseDuration('7-8 hours', 'hours')).toBe(7.5);
        expect(parseLooseDuration('~8', 'hours')).toBe(8);
    });

    it('validateResponse no longer zeroes text durations', () => {
        class Probe extends GeminiClient { check(d: unknown) { return this.validateResponse(d); } }
        const probe = Object.create(Probe.prototype) as Probe;
        const r = probe.check({
            narrative: 'x', thought_process: '', scene_mode: 'NARRATIVE', tension_level: 5,
            time_passed_minutes: '15-20',
            biological_inputs: { sleep_hours: '~8' },
            location_update: { location_name: 'X', travel_time_minutes: 'about 30 minutes' },
        });
        expect(r.time_passed_minutes).toBe(18);
        expect(r.biological_inputs?.sleep_hours).toBe(8);
        expect(r.location_update?.travel_time_minutes).toBe(30);
    });
});

describe('v1.55 — the Westcross dawn turns have a time floor', () => {
    const turns: Array<[string, number]> = [
        ['I rise and dress in loose thick black linen trousers, I put on a light cotton tunic, my belt with knife and remain barefoot. I head down stairs to the kitchen and start a pot of coffee.', 15],
        ['I take my mug of coffee and walk out into the back garden and slowly walk it enjoying the fact that the noble quarter was still asleep and the city was asleep. And walked it while sipping my coffee.', 15],
        ['I head back into the kitchen to pour another cup of coffee.', 5],
        ['I head into the solarium to sit and read while sipping my coffee', 30],
    ];
    for (const [input, atLeast] of turns) {
        it(input.slice(0, 50), () => {
            expect(estimateActivityMinutes(input).minutes).toBeGreaterThanOrEqual(atLeast);
        });
    }
    it('a line of speech is not an activity', () => {
        expect(estimateActivityMinutes('"Have you read the book?" I ask.').minutes).toBe(0);
    });
});
