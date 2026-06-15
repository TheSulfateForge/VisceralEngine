import { describe, it, expect } from 'vitest';
import { deriveTimePhase, phaseAfterElapsed } from '../utils/engine/timeUtils';

describe('deriveTimePhase', () => {
  it('maps representative hours to the right phase', () => {
    expect(deriveTimePhase(2)).toBe('deep_night');
    expect(deriveTimePhase(5)).toBe('pre_dawn');
    expect(deriveTimePhase(7)).toBe('dawn');
    expect(deriveTimePhase(9)).toBe('morning');
    expect(deriveTimePhase(12)).toBe('midday');
    expect(deriveTimePhase(15)).toBe('afternoon');
    expect(deriveTimePhase(18)).toBe('dusk');
    expect(deriveTimePhase(20)).toBe('evening');
    expect(deriveTimePhase(23)).toBe('night');
  });

  it('handles out-of-range / negative hours defensively', () => {
    expect(deriveTimePhase(24)).toBe('deep_night');
    expect(deriveTimePhase(-1)).toBe('night');
    expect(deriveTimePhase(26)).toBe('dawn');
  });
});

describe('phaseAfterElapsed (review item 4 — deterministic clock correction)', () => {
  it('returns the start phase when no time passes', () => {
    expect(phaseAfterElapsed(9, 0, 0)).toBe('morning');
  });

  it('advances across a phase boundary when minutes accumulate', () => {
    // 10:30 + 120m = 12:30 → midday
    expect(phaseAfterElapsed(10, 30, 120)).toBe('midday');
  });

  it('wraps past midnight correctly', () => {
    // 23:00 + 180m = 02:00 → deep_night
    expect(phaseAfterElapsed(23, 0, 180)).toBe('deep_night');
  });

  it('treats a missing/zero elapsed as no advance', () => {
    expect(phaseAfterElapsed(20, 15, 0)).toBe('evening');
  });
});
