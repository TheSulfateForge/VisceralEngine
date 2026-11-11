import { describe, it, expect } from 'vitest';
import { deriveWorldTime } from '../utils/engine/timeUtils';
import { timeProgressionStep } from '../utils/pipeline/steps/02-timeProgression';
import { getResponseSchema } from '../schemas/responseSchema';

const run = (r: any, input: string, start = 5 * 60 + 36) => {
    const ctx: any = {
        sanitisedResponse: { narrative: 'I did it.', scene_mode: 'NARRATIVE', ...r },
        playerInput: input,
        previousWorld: { time: deriveWorldTime(start), location: 'Westcross Townhouse — Solarium' },
        worldUpdate: {}, debugLogs: [], effectiveTimeMode: 'SCENE',
    };
    const out = timeProgressionStep.execute(ctx) as any;
    return { minutes: out.newTime.totalMinutes - start, log: ctx.debugLogs.map((l: any) => l.message).join('\n') };
};

describe('v1.56 — an omitted time figure is not zero', () => {
    it('omitted → the scene beat (NARRATIVE +5m)', () => {
        const { minutes, log } = run({ time_passed_minutes: 0, time_passed_raw: 'null' }, 'I cock my head at Miri.');
        expect(minutes).toBe(5);
        expect(log).toMatch(/TIME — v1.56/);
    });
    it('an explicit 0 or 1 from the model is still respected', () => {
        expect(run({ time_passed_minutes: 1 }, 'I cock my head at Miri.').minutes).toBe(1);
    });
    it('time_beats (v1.57) is required in every mode schema', () => {
        for (const mode of ['NARRATIVE', 'SOCIAL', 'TENSION', 'COMBAT'] as const)
            expect((getResponseSchema(mode as any) as any).required).toContain('time_beats');
    });
});
