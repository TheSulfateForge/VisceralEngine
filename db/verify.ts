// ============================================================================
// db/verify.ts — Round-trip verification for the absorb/project pair.
//
// Usage (debug-mode only):
//
//     import { verifyRoundTrip } from './db/verify';
//     const result = await verifyRoundTrip(originalGameSave);
//     if (!result.ok) console.warn('round-trip drift:', result.diffs);
//
// The differ tolerates differences that are intentional in the projection:
//   - Property ordering (handled by structural compare)
//   - Array ordering for arrays where we don't preserve order (see
//     UNORDERED_PATHS below)
//   - Synthetic uuid columns that never appear in `GameSave` (no-op here)
// ============================================================================
import { GameSave, SaveId } from '../types';
import { absorbGameSave, projectGameSave, deleteCampaignAndRows } from './projection';

// Dotted paths inside a GameSave whose array order is NOT preserved by the
// projection. Compared as multisets.
const UNORDERED_PATHS = new Set<string>([
  'character.inventory',
  'character.relationships',
  'character.conditions',
  'character.goals',
  'character.skills',
  'gameState.history.rollLog',
  'gameState.history.debugLog',
  'gameState.world.memory',
  'gameState.world.lore',
  'gameState.world.knownEntities',
  'gameState.world.activeThreats',
  'gameState.world.emergingThreats',
  'gameState.world.dormantHooks',
  'gameState.world.factions',
  'gameState.world.factionConflicts',
  'gameState.world.pregnancies',
  'gameState.world.scenarios',
  'gameState.world.worldRules',
  'gameState.world.worldTags',
  'gameState.world.bannedMechanisms',
  'gameState.world.usedNameRegistry',
  'gameState.world.failedModels',
  'gameState.world.generatedImages',
  'gameState.world.legalStatus.knownClaims',
  'gameState.world.legalStatus.playerDocuments',
]);

export interface DiffEntry {
  path: string;
  reason: string;
  expected?: unknown;
  actual?: unknown;
}

export interface VerifyResult {
  ok: boolean;
  diffs: DiffEntry[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) {
    return '[' + v.map(stableStringify).join(',') + ']';
  }
  if (isPlainObject(v)) {
    const keys = Object.keys(v).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

function multisetCompare(a: unknown[], b: unknown[]): { same: boolean; missing: unknown[]; extra: unknown[] } {
  const aMap = new Map<string, number>();
  const bMap = new Map<string, number>();
  for (const x of a) aMap.set(stableStringify(x), (aMap.get(stableStringify(x)) ?? 0) + 1);
  for (const x of b) bMap.set(stableStringify(x), (bMap.get(stableStringify(x)) ?? 0) + 1);
  const missing: unknown[] = [];
  const extra: unknown[] = [];
  for (const [k, n] of aMap) {
    const m = bMap.get(k) ?? 0;
    if (m < n) missing.push(JSON.parse(k));
  }
  for (const [k, n] of bMap) {
    const m = aMap.get(k) ?? 0;
    if (m < n) extra.push(JSON.parse(k));
  }
  return { same: missing.length === 0 && extra.length === 0, missing, extra };
}

function diff(a: unknown, b: unknown, path: string, out: DiffEntry[]): void {
  if (a === b) return;

  if (typeof a !== typeof b) {
    out.push({ path, reason: 'type-mismatch', expected: a, actual: b });
    return;
  }

  if (a === null || b === null) {
    if (a !== b) out.push({ path, reason: 'null-mismatch', expected: a, actual: b });
    return;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (UNORDERED_PATHS.has(path)) {
      const r = multisetCompare(a, b);
      if (!r.same) {
        if (r.missing.length) out.push({ path, reason: 'missing-elements', expected: r.missing });
        if (r.extra.length) out.push({ path, reason: 'extra-elements', actual: r.extra });
      }
      return;
    }
    if (a.length !== b.length) {
      out.push({ path, reason: 'array-length', expected: a.length, actual: b.length });
      return;
    }
    for (let i = 0; i < a.length; i++) diff(a[i], b[i], `${path}[${i}]`, out);
    return;
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const av = (a as Record<string, unknown>)[k];
      const bv = (b as Record<string, unknown>)[k];
      // Skip keys that are undefined on both sides (TS optional fields)
      if (av === undefined && bv === undefined) continue;
      diff(av, bv, path ? `${path}.${k}` : k, out);
    }
    return;
  }

  if (a !== b) out.push({ path, reason: 'value-mismatch', expected: a, actual: b });
}

/**
 * Absorb the given save into the new DB, project it back, diff the two.
 * Idempotent — leaves the DB in the post-absorb state.
 */
export async function verifyRoundTrip(original: GameSave): Promise<VerifyResult> {
  await absorbGameSave(original);
  const round = await projectGameSave(original.id);

  if (!round) {
    return {
      ok: false,
      diffs: [{ path: '', reason: 'projection-returned-undefined' }],
    };
  }

  const diffs: DiffEntry[] = [];
  diff(original, round, '', diffs);
  return { ok: diffs.length === 0, diffs };
}

/**
 * Verify without permanently writing — wipes campaign rows after verifying.
 * Use this on user data; otherwise the absorb persists.
 */
export async function verifyRoundTripEphemeral(original: GameSave): Promise<VerifyResult> {
  const result = await verifyRoundTrip(original);
  await deleteCampaignAndRows(original.id);
  return result;
}

/**
 * Verify every save currently in the new DB by re-projecting and re-absorbing.
 * Useful as a smoke test after migration.
 */
export async function verifyAllCampaigns(ids: SaveId[]): Promise<Record<string, VerifyResult>> {
  const results: Record<string, VerifyResult> = {};
  for (const id of ids) {
    const projected = await projectGameSave(id);
    if (!projected) {
      results[id] = { ok: false, diffs: [{ path: '', reason: 'project-failed' }] };
      continue;
    }
    results[id] = await verifyRoundTrip(projected);
  }
  return results;
}
