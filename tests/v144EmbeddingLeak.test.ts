import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { vdb, EmbeddingRow, EMBEDDING_MODEL_FOR_PRUNE } from '../db/schema';
import { embeddingsRepo } from '../db/repos/embeddings';
import { derivedId } from '../db/projection';
import { DEFAULT_EMBEDDING_MODEL } from '../services/embeddingService';
import type { SaveId } from '../types';

// ============================================================================
// v1.44 — the 32-second read.
//
// One real turn's [PROMPT PROFILE], which is what this file exists to answer:
//
//   total=34717ms · hybridContext=34392ms(99%)
//   embed:loadRows=32077ms(92%) [462367 rows read from IndexedDB]
//   embed:encodeQuery=2271ms(7%) [2 vector(s)]
//   embed:modelFilter: 236359 row(s) dropped as stale-model
//
// 92% of the build was one IndexedDB read of 462,367 embedding rows, and more
// than half of what it read was thrown away in JS immediately afterwards. A
// campaign holds 43 lore items and 51 entities. The rows were leaked:
//
//   1. `absorbGameSave` runs on EVERY autosave and minted fresh UUIDs for
//      `summary_segments` and `world_rules` each time.
//   2. `deleteCampaignRows` wipes those tables but has never touched
//      `embeddings`.
//   3. `kickBackfill` then saw owner_ids it had never embedded and wrote a
//      new vector for each.
//
// So each autosave orphaned a generation of vectors that nothing deleted, and
// every turn read all of them. Three fixes, tested here in that order: stop
// minting new owners, sweep what is already dead, and stop reading the rest.
// ============================================================================

const CID = 'campaign-1' as SaveId;
const OTHER = 'campaign-2' as SaveId;
const MODEL = 'Xenova/bge-small-en-v1.5';
const OLD_MODEL = 'Xenova/all-MiniLM-L6-v2';

const row = (
  over: Partial<EmbeddingRow> & Pick<EmbeddingRow, 'id' | 'owner_kind' | 'owner_id'>,
): EmbeddingRow => ({
  campaign_id: CID,
  text_hash: 'h',
  vector: new Float32Array([1, 0, 0]),
  dim: 3,
  model_id: MODEL,
  created_turn: 0,
  ...over,
});

beforeEach(async () => {
  if (!vdb.isOpen()) await vdb.open();
  await vdb.embeddings.clear();
  await vdb.lore.clear();
  await vdb.world_rules.clear();
  embeddingsRepo.invalidateCache();
});

// ---------------------------------------------------------------------------
describe('v1.44 — absorb stops minting a new owner on every autosave', () => {
    it('derives the same id from the same identity', () => {
        expect(derivedId(CID, 'rule', 'Blood debts are paid in kind.'))
            .toBe(derivedId(CID, 'rule', 'Blood debts are paid in kind.'));
    });

    it('separates identity, kind and campaign', () => {
        const a = derivedId(CID, 'rule', 'one');
        expect(a).not.toBe(derivedId(CID, 'rule', 'two'));
        expect(a).not.toBe(derivedId(CID, 'seg', 'one'));
        expect(a).not.toBe(derivedId(OTHER, 'rule', 'one'));
    });

    it('stays a sane length for a paragraph-long rule', () => {
        const long = 'The Vaultspine remembers every oath sworn beneath it. '.repeat(20);
        expect(derivedId(CID, 'rule', long).length).toBeLessThan(CID.length + 32);
    });

    it('is what the leak actually needed: N absorbs produce N owner ids, not N×rules', () => {
        // The regression in one line. Ten autosaves over an unchanged rule set
        // used to produce 10 × 3 = 30 distinct owner_ids, and therefore 30
        // embedding rows where 3 were wanted.
        const rules = ['A debt is a debt.', 'Names bind.', 'The dead do not vote.'];
        const seen = new Set<string>();
        for (let autosave = 0; autosave < 10; autosave++) {
            for (const r of rules) seen.add(derivedId(CID, 'rule', r));
        }
        expect(seen.size).toBe(3);
    });

    it('keys a summary segment by the turn range it covers', () => {
        expect(derivedId(CID, 'seg', '1-20')).toBe(derivedId(CID, 'seg', '1-20'));
        expect(derivedId(CID, 'seg', '1-20')).not.toBe(derivedId(CID, 'seg', '21-40'));
    });
});

// ---------------------------------------------------------------------------
describe('v1.44 — the sweep clears what has already leaked', () => {
    it('deletes rows whose owner is gone and keeps the ones that are not', async () => {
        await vdb.lore.bulkPut([
            { id: 'live-1', campaign_id: CID, keyword: 'k', content: 'c', timestamp: 't' },
        ] as never[]);
        await vdb.embeddings.bulkPut([
            row({ id: 'e1', owner_kind: 'lore', owner_id: 'live-1' }),
            row({ id: 'e2', owner_kind: 'lore', owner_id: 'dead-uuid-a' }),
            row({ id: 'e3', owner_kind: 'lore', owner_id: 'dead-uuid-b' }),
        ]);

        const dropped = await embeddingsRepo.pruneOrphans(
            CID,
            new Set(['lore:live-1']),
            ['lore'],
        );

        expect(dropped).toBe(2);
        expect((await vdb.embeddings.toArray()).map(r => r.id)).toEqual(['e1']);
    });

    it('leaves kinds the caller did not gather alone', async () => {
        // A backfill run restricted to `{kinds: ['lore']}` knows nothing about
        // which entities are live. Treating that silence as "none of them are"
        // would delete every entity vector in the campaign.
        await vdb.embeddings.bulkPut([
            row({ id: 'e1', owner_kind: 'entity', owner_id: 'ent-1' }),
            row({ id: 'e2', owner_kind: 'lore', owner_id: 'gone' }),
        ]);

        const dropped = await embeddingsRepo.pruneOrphans(CID, new Set(), ['lore']);

        expect(dropped).toBe(1);
        expect((await vdb.embeddings.toArray()).map(r => r.id)).toEqual(['e1']);
    });

    it('never reaches into another campaign', async () => {
        await vdb.embeddings.bulkPut([
            row({ id: 'mine', owner_kind: 'lore', owner_id: 'gone' }),
            row({ id: 'theirs', owner_kind: 'lore', owner_id: 'gone', campaign_id: OTHER }),
        ]);

        await embeddingsRepo.pruneOrphans(CID, new Set(), ['lore']);

        expect((await vdb.embeddings.toArray()).map(r => r.id)).toEqual(['theirs']);
    });

    it('deletes vectors from a superseded embedding model', async () => {
        await vdb.embeddings.bulkPut([
            row({ id: 'new', owner_kind: 'lore', owner_id: 'l1' }),
            row({ id: 'old-a', owner_kind: 'lore', owner_id: 'l1', model_id: OLD_MODEL }),
            row({ id: 'old-b', owner_kind: 'lore', owner_id: 'l2', model_id: OLD_MODEL }),
        ]);

        expect(await embeddingsRepo.pruneStaleModels(CID, MODEL)).toBe(2);
        expect((await vdb.embeddings.toArray()).map(r => r.id)).toEqual(['new']);
    });

    it('is a no-op on a clean table, so it can run on every backfill', async () => {
        await vdb.lore.bulkPut([
            { id: 'l1', campaign_id: CID, keyword: 'k', content: 'c', timestamp: 't' },
        ] as never[]);
        await vdb.embeddings.put(row({ id: 'e1', owner_kind: 'lore', owner_id: 'l1' }));

        expect(await embeddingsRepo.pruneStaleModels(CID, MODEL)).toBe(0);
        expect(await embeddingsRepo.pruneOrphans(CID, new Set(['lore:l1']), ['lore'])).toBe(0);
        expect(await vdb.embeddings.count()).toBe(1);
    });
});

// ---------------------------------------------------------------------------
describe('v1.44 — the read no longer scales with what leaked', () => {
    it('reads only the current model, rather than filtering after the fact', async () => {
        await vdb.embeddings.bulkPut([
            row({ id: 'a', owner_kind: 'lore', owner_id: 'l1' }),
            row({ id: 'b', owner_kind: 'lore', owner_id: 'l2' }),
            row({ id: 'c', owner_kind: 'lore', owner_id: 'l3', model_id: OLD_MODEL }),
        ]);

        const rows = await embeddingsRepo.listForRetrieval(CID, MODEL);

        expect(rows.map(r => r.id).sort()).toEqual(['a', 'b']);
    });

    it('excludes other campaigns', async () => {
        await vdb.embeddings.bulkPut([
            row({ id: 'a', owner_kind: 'lore', owner_id: 'l1' }),
            row({ id: 'b', owner_kind: 'lore', owner_id: 'l1', campaign_id: OTHER }),
        ]);

        expect(await embeddingsRepo.listForRetrieval(OTHER, MODEL)).toHaveLength(1);
    });

    it('serves the second turn from cache without touching the table', async () => {
        await vdb.embeddings.put(row({ id: 'a', owner_kind: 'lore', owner_id: 'l1' }));
        const first = await embeddingsRepo.listForRetrieval(CID, MODEL);

        // Change the table behind the cache's back. A cached read must not see
        // it — that is the whole point of caching, and the assertion that the
        // second turn costs nothing.
        await vdb.embeddings.put(row({ id: 'b', owner_kind: 'lore', owner_id: 'l2' }));

        const second = await embeddingsRepo.listForRetrieval(CID, MODEL);
        expect(second).toBe(first);
        expect(second).toHaveLength(1);
    });

    it('re-reads after the backfill writes', async () => {
        await vdb.embeddings.put(row({ id: 'a', owner_kind: 'lore', owner_id: 'l1' }));
        await embeddingsRepo.listForRetrieval(CID, MODEL);

        await embeddingsRepo.bulkUpsert([{
            campaign_id: CID,
            owner_kind: 'lore',
            owner_id: 'l2',
            text_hash: 'h',
            vector: new Float32Array([0, 1, 0]),
            dim: 3,
            model_id: MODEL,
            created_turn: 1,
        }]);

        expect(await embeddingsRepo.listForRetrieval(CID, MODEL)).toHaveLength(2);
    });

    it('re-reads after a prune', async () => {
        await vdb.embeddings.bulkPut([
            row({ id: 'a', owner_kind: 'lore', owner_id: 'l1' }),
            row({ id: 'b', owner_kind: 'lore', owner_id: 'gone' }),
        ]);
        expect(await embeddingsRepo.listForRetrieval(CID, MODEL)).toHaveLength(2);

        await embeddingsRepo.pruneOrphans(CID, new Set(['lore:l1']), ['lore']);

        expect(await embeddingsRepo.listForRetrieval(CID, MODEL)).toHaveLength(1);
    });

    it('re-reads when the embedding model changes', async () => {
        await vdb.embeddings.bulkPut([
            row({ id: 'a', owner_kind: 'lore', owner_id: 'l1' }),
            row({ id: 'b', owner_kind: 'lore', owner_id: 'l1', model_id: OLD_MODEL }),
        ]);
        expect((await embeddingsRepo.listForRetrieval(CID, MODEL)).map(r => r.id)).toEqual(['a']);
        expect((await embeddingsRepo.listForRetrieval(CID, OLD_MODEL)).map(r => r.id)).toEqual(['b']);
    });
});

// ---------------------------------------------------------------------------
describe('v1.44 — the schema', () => {
    it('is at v4 with the [campaign_id+model_id] index the read depends on', async () => {
        if (!vdb.isOpen()) await vdb.open();
        expect(vdb.verno).toBe(4);
        const indexes = vdb.embeddings.schema.indexes.map(i => i.name);
        expect(indexes).toContain('[campaign_id+model_id]');
    });

    it('pins the prune constant to the embedding service, so they cannot drift', () => {
        // schema.ts must not import the embedding service — every repo imports
        // schema, and the service reaches for transformers.js. The duplicate is
        // deliberate; this is what keeps it honest.
        expect(EMBEDDING_MODEL_FOR_PRUNE).toBe(DEFAULT_EMBEDDING_MODEL);
    });
});
