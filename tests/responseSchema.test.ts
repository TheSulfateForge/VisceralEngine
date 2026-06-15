import { describe, it, expect } from 'vitest';
import {
  RESPONSE_SCHEMA,
  getResponseSchema,
  stripSchemaDescriptions,
  KEEP_DESCRIPTIONS,
} from '../schemas/responseSchema';

/** Rough char→token estimate (Gemini ~4 chars/token). */
const estTokens = (s: object): number => Math.ceil(JSON.stringify(s).length / 4);

/** Collect every property key that still carries a description, recursively. */
const keysWithDescription = (node: any, key: string | null = null, acc: Set<string> = new Set()): Set<string> => {
  if (node && typeof node === 'object') {
    if (key !== null && typeof node.description === 'string') acc.add(key);
    if (node.properties) for (const [k, v] of Object.entries(node.properties)) keysWithDescription(v, k, acc);
    if (node.items) keysWithDescription(node.items, key, acc);
  }
  return acc;
};

describe('getResponseSchema — scene-mode gating (review item 3)', () => {
  it('NARRATIVE drops combat_context and montage_block, keeps location_update', () => {
    const s: any = getResponseSchema('NARRATIVE');
    expect(s.properties.combat_context).toBeUndefined();
    expect(s.properties.montage_block).toBeUndefined();
    expect(s.properties.location_update).toBeDefined();
  });

  it('SOCIAL drops combat, montage AND location_update', () => {
    const s: any = getResponseSchema('SOCIAL');
    expect(s.properties.combat_context).toBeUndefined();
    expect(s.properties.location_update).toBeUndefined();
    expect(s.properties.montage_block).toBeUndefined();
  });

  it('COMBAT keeps combat_context, drops montage', () => {
    const s: any = getResponseSchema('COMBAT');
    expect(s.properties.combat_context).toBeDefined();
    expect(s.properties.montage_block).toBeUndefined();
  });

  it('MONTAGE is the only variant that keeps montage_block', () => {
    const s: any = getResponseSchema('MONTAGE');
    expect(s.properties.montage_block).toBeDefined();
  });

  it('NEVER gates the mature-consequence core in any mode (review §3)', () => {
    for (const mode of ['NARRATIVE', 'SOCIAL', 'TENSION', 'COMBAT', 'MONTAGE'] as const) {
      const s: any = getResponseSchema(mode);
      expect(s.properties.character_updates, `character_updates in ${mode}`).toBeDefined();
      expect(s.properties.biological_inputs, `biological_inputs in ${mode}`).toBeDefined();
      expect(s.properties.biological_event, `biological_event in ${mode}`).toBeDefined();
      // trauma_delta lives under character_updates
      expect(s.properties.character_updates.properties.trauma_delta).toBeDefined();
      expect(s.properties.character_updates.properties.added_conditions).toBeDefined();
    }
  });

  it('prunes required[] entries whose branch was removed', () => {
    const s: any = getResponseSchema('SOCIAL');
    for (const k of s.required) expect(k in s.properties).toBe(true);
  });

  it('does not mutate the master RESPONSE_SCHEMA', () => {
    const before = JSON.stringify(RESPONSE_SCHEMA);
    getResponseSchema('NARRATIVE');
    getResponseSchema('COMBAT');
    expect(JSON.stringify(RESPONSE_SCHEMA)).toBe(before);
  });
});

describe('stripSchemaDescriptions (review item 2)', () => {
  it('preserves descriptions on behavior-critical keys', () => {
    const stripped: any = stripSchemaDescriptions(JSON.parse(JSON.stringify(RESPONSE_SCHEMA)));
    const remaining = keysWithDescription(stripped);
    // Every key that still has a description must be in the keep-set.
    for (const k of remaining) expect(KEEP_DESCRIPTIONS.has(k), `unexpected description kept on ${k}`).toBe(true);
    // And the load-bearing ones are actually still present.
    expect(remaining.has('time_passed_minutes')).toBe(true);
    expect(remaining.has('biological_event')).toBe(true);
    expect(remaining.has('thought_process')).toBe(true);
  });

  it('strips self-evident wrapper descriptions (e.g. narrative, scene_mode)', () => {
    const stripped: any = stripSchemaDescriptions(JSON.parse(JSON.stringify(RESPONSE_SCHEMA)));
    expect(stripped.properties.narrative.description).toBeUndefined();
    expect(stripped.properties.scene_mode.description).toBeUndefined();
  });
});

describe('token budget (review item 7 — regression guard)', () => {
  it('a NARRATIVE schema is meaningfully smaller than the full master', () => {
    const full = estTokens(RESPONSE_SCHEMA);
    const narrative = estTokens(getResponseSchema('NARRATIVE'));
    expect(narrative).toBeLessThan(full);
    // Guardrail: the compacted narrative schema should stay well under budget.
    // If a future edit balloons it past this, the test fails loudly.
    expect(narrative).toBeLessThan(4500);
  });

  it('thought_process is constrained to a terse flags contract', () => {
    // The description must signal terseness + the SOFTENED self-report.
    const desc = (RESPONSE_SCHEMA as any).properties.thought_process.description as string;
    expect(desc).toMatch(/TERSE/i);
    expect(desc).toContain('SOFTENED');
  });
});
