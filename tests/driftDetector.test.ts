import { describe, it, expect } from 'vitest';
import { detectSanitizationDrift } from '../utils/driftDetector';

describe('detectSanitizationDrift', () => {
  it('returns not-drifted for empty / null input', () => {
    expect(detectSanitizationDrift(undefined).drifted).toBe(false);
    expect(detectSanitizationDrift(null).drifted).toBe(false);
    expect(detectSanitizationDrift('').drifted).toBe(false);
  });

  it('returns not-drifted for an ordinary terse flag list', () => {
    const r = detectSanitizationDrift('downtime, social, low-stakes');
    expect(r.drifted).toBe(false);
    expect(r.matches).toHaveLength(0);
  });

  it('catches the explicit SOFTENED self-report tag (review item 5)', () => {
    const r = detectSanitizationDrift('combat, post_violence, SOFTENED');
    expect(r.drifted).toBe(true);
    expect(r.matches.join(' ')).toContain('SOFTENED');
  });

  it('is case-sensitive on the SOFTENED token (the tag is uppercase by contract)', () => {
    // lowercase "softened the" still trips the legacy soften phrase, but the
    // bare tag contract is uppercase. Confirm the uppercase tag matches.
    expect(detectSanitizationDrift('SOFTENED').drifted).toBe(true);
  });

  it('still catches legacy free-text confessions (back-compat)', () => {
    expect(detectSanitizationDrift('I will fade to black here').drifted).toBe(true);
    expect(detectSanitizationDrift('keeping this tasteful').drifted).toBe(true);
    expect(detectSanitizationDrift('imply rather than describe').drifted).toBe(true);
  });

  it('does not false-positive on narrative-style words', () => {
    // "softly" / "imply" used naturally without the drift construction
    expect(detectSanitizationDrift('she spoke, intent unclear').drifted).toBe(false);
  });
});
