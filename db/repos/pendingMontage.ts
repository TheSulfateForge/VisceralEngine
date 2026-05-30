// db/repos/pendingMontage.ts
// Wraps the pending_montage table (v0.13 montage system).
//
// One uncommitted MontageProposal per campaign, persisted so a mid-review app
// close survives. The proposal is stored as a single JSON payload (never
// queried by inner fields) and the row is deleted outright on accept/discard.

import { vdb, PendingMontageRow } from '../schema';
import { MontageProposal, SaveId } from '../../types';

const fromRow = (r: PendingMontageRow): MontageProposal => r.payload;

const toRow = (proposal: MontageProposal): PendingMontageRow => ({
  campaign_id: proposal.campaignId as SaveId,
  payload: proposal,
  updated_at: new Date().toISOString(),
});

export const pendingMontageRepo = {
  /** Upsert the campaign's single pending proposal (overwrites any prior one). */
  async save(proposal: MontageProposal): Promise<void> {
    await vdb.pending_montage.put(toRow(proposal));
  },

  /** Load the campaign's pending proposal, if one is mid-review. */
  async load(campaignId: SaveId): Promise<MontageProposal | undefined> {
    const r = await vdb.pending_montage.get(campaignId);
    return r ? fromRow(r) : undefined;
  },

  /** Drop the pending proposal (called on accept/commit or discard). */
  async clear(campaignId: SaveId): Promise<void> {
    await vdb.pending_montage.delete(campaignId);
  },
};
