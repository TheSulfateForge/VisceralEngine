// ============================================================================
// v1.53 — single-quoted dialogue, pauses between lines, inferred moves,
// practice activity. Fixtures are real turns from
// visceral_backup_ryan_westcross_2026_11_08.json (deepseek-v4.1-flash), where
// every turn advanced the clock exactly +1m.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normaliseSingleQuotedDialogue, countSingleQuotedSpans } from '../utils/engine/dialogueQuotes';
import { estimateTimeFloor, estimateActivityMinutes, countUtterances } from '../utils/engine/timeUtils';
import { inferLocationMove } from '../utils/engine/locationGraph';
import { timeProgressionStep } from '../utils/pipeline/steps/02-timeProgression';
import { deriveWorldTime } from '../utils/engine/timeUtils';
import type { LocationGraph } from '../types';

const FX: Record<string, any> = JSON.parse(
    readFileSync(new URL('./fixtures_v153_westcross.json', import.meta.url), 'utf8'),
);
const GRAPH = FX.GRAPH as LocationGraph;

describe('v1.53 — single-quoted dialogue', () => {
    it('the garden-party opening is rewritten to double quotes', () => {
        expect(FX.T2).not.toMatch(/"/);
        expect(countSingleQuotedSpans(FX.T2)).toBeGreaterThanOrEqual(10);
        const out = normaliseSingleQuotedDialogue(FX.T2);
        expect(out).toMatch(/"Duke Westcross\. You actually came\."/);
        expect(countUtterances(out)).toBeGreaterThanOrEqual(10);
    });

    it('apostrophes inside words survive', () => {
        const out = normaliseSingleQuotedDialogue(`'I don't know,' she said. 'It's Westcross's land.'`);
        expect(out).toBe(`"I don't know," she said. "It's Westcross's land."`);
    });

    it('leaves narration with double-quoted dialogue alone', () => {
        const t = `"Come in," she said. The boy's 'friend' waited.`;
        expect(normaliseSingleQuotedDialogue(t)).toBe(t);
    });

    it('a lone scare-quote is not dialogue', () => {
        const t = `The garden was smaller than the word 'party' had suggested.`;
        expect(normaliseSingleQuotedDialogue(t)).toBe(t);
    });
});

describe('v1.53 — conversation time includes the pauses', () => {
    it('opening turn: 15 lines → 4m (was 0 with single quotes, 0 at 150wpm alone)', () => {
        const f = estimateTimeFloor(normaliseSingleQuotedDialogue(FX.T2), '', undefined, 'Caerveld');
        expect(f.floor).toBe(4);
    });

    it('the long table argument: 27 lines → 9m', () => {
        const f = estimateTimeFloor(normaliseSingleQuotedDialogue(FX.T18), '', undefined, 'Caerveld');
        expect(f.floor).toBe(9);
    });
});

describe('v1.53 — inferred moves', () => {
    it('"head back to the town house" → The Westcross Townhouse, not Aldwyn House', () => {
        const m = inferLocationMove(GRAPH, FX.T28, FX.U27, 'Caerveld');
        expect(m?.location_name).toBe('The Westcross Townhouse');
        expect(m?.travelled).toBe(true);
    });

    it('an unset location is filled from the narration, without travel', () => {
        const m = inferLocationMove(GRAPH, FX.T2, '', '');
        expect(m?.location_name).toBe('Caerveld');
        expect(m?.travelled).toBe(false);
    });

    it('no known destination → no move ("head down to the back of the property")', () => {
        expect(inferLocationMove(GRAPH, FX.T32, FX.U31, 'The Westcross Townhouse')).toBeNull();
    });

    it('weak cues are not trips', () => {
        expect(inferLocationMove(GRAPH, 'I cross to the window.', 'I go to the window.', 'The Westcross Townhouse')).toBeNull();
    });

    it('the time step writes the move back and applies the travel floor', () => {
        const ctx: any = {
            sanitisedResponse: { narrative: FX.T28, time_passed_minutes: 1, scene_mode: 'NARRATIVE' },
            playerInput: FX.U27,
            previousWorld: { time: deriveWorldTime(9 * 60 + 14), location: 'Caerveld', locationGraph: GRAPH },
            worldUpdate: {},
            debugLogs: [],
        };
        const out = timeProgressionStep.execute(ctx) as any;
        expect(out.sanitisedResponse.location_update.location_name).toBe('The Westcross Townhouse');
        expect(out.newTime.totalMinutes - (9 * 60 + 14)).toBeGreaterThanOrEqual(15);
        expect(out.debugLogs.map((l: any) => l.message).join('\n')).toMatch(/LOCATION INFERRED/);
    });
});

describe('v1.53 — practice is an activity', () => {
    it('"take up my bow and quiver… loose some arrows" ≥ 30m', () => {
        expect(estimateActivityMinutes(FX.U31).labels).toContain('practice');
        expect(estimateActivityMinutes(FX.U31).minutes).toBe(30);
    });
});
