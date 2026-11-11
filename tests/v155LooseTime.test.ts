import { describe, it, expect } from 'vitest';
import { parseLooseDuration } from '../utils/engine/looseNumber';
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
