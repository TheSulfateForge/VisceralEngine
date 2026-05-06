// db/repos/entities.ts
// Wraps the entities + entity_ledger_items + entity_relationships tables.
// Phase 2 simulation reads will go through this repo.

import {
  vdb,
  EntityRow,
  EntityLedgerRow,
  EntityRelationshipRow,
  EntityRelationshipKind,
} from '../schema';
import { KnownEntity, SaveId, EntityStatus } from '../../types';
import { generateUUID } from '../../idUtils';

const toEntity = (r: EntityRow, ledger: string[]): KnownEntity => ({
  id: r.id,
  name: r.name,
  role: r.role,
  location: r.current_location_text ?? '',
  impression: r.impression,
  relationship_level: r.relationship_level,
  leverage: r.leverage,
  ledger,
  ...(r.status ? { status: r.status } : {}),
  ...(r.first_seen_turn !== null ? { firstSeenTurn: r.first_seen_turn } : {}),
  ...(r.last_seen_turn !== null ? { lastSeenTurn: r.last_seen_turn } : {}),
  ...(r.status_changed_turn !== null ? { statusChangedTurn: r.status_changed_turn } : {}),
  ...(r.exit_reason !== null ? { exitReason: r.exit_reason } : {}),
});

async function withLedger(rows: EntityRow[]): Promise<KnownEntity[]> {
  if (rows.length === 0) return [];
  const ledgerRows = await vdb.entity_ledger_items
    .where('entity_id')
    .anyOf(rows.map((r) => r.id))
    .toArray();
  const byId = new Map<string, string[]>();
  for (const l of ledgerRows) {
    if (!byId.has(l.entity_id)) byId.set(l.entity_id, []);
    byId.get(l.entity_id)!.push(l.text);
  }
  return rows.map((r) => toEntity(r, byId.get(r.id) ?? []));
}

export const entitiesRepo = {
  async getById(id: string): Promise<KnownEntity | undefined> {
    const r = await vdb.entities.get(id);
    if (!r) return undefined;
    const ledger = await vdb.entity_ledger_items
      .where('entity_id')
      .equals(id)
      .toArray();
    return toEntity(r, ledger.map((l) => l.text));
  },

  async listForCampaign(campaignId: SaveId): Promise<KnownEntity[]> {
    const rows = await vdb.entities.where('campaign_id').equals(campaignId).toArray();
    return withLedger(rows);
  },

  async listByStatus(campaignId: SaveId, status: EntityStatus): Promise<KnownEntity[]> {
    const rows = await vdb.entities
      .where('[campaign_id+status]')
      .equals([campaignId, status])
      .toArray();
    return withLedger(rows);
  },

  async listAtLocation(campaignId: SaveId, locationId: string): Promise<KnownEntity[]> {
    const rows = await vdb.entities
      .where('[campaign_id+current_location_id]')
      .equals([campaignId, locationId])
      .toArray();
    return withLedger(rows);
  },

  async upsert(campaignId: SaveId, e: KnownEntity): Promise<void> {
    const row: EntityRow = {
      id: e.id,
      campaign_id: campaignId,
      name: e.name,
      role: e.role,
      current_location_id: null,
      current_location_text: e.location ?? null,
      impression: e.impression,
      relationship_level: e.relationship_level,
      leverage: e.leverage,
      status: e.status ?? 'present',
      first_seen_turn: e.firstSeenTurn ?? null,
      last_seen_turn: e.lastSeenTurn ?? null,
      status_changed_turn: e.statusChangedTurn ?? null,
      exit_reason: e.exitReason ?? null,
    };
    await vdb.entities.put(row);
    await vdb.entity_ledger_items.where('entity_id').equals(e.id).delete();
    if (e.ledger?.length) {
      const ledgerRows: EntityLedgerRow[] = e.ledger.map((text) => ({
        id: generateUUID(),
        entity_id: e.id,
        campaign_id: campaignId,
        text,
        recorded_turn: e.lastSeenTurn ?? 0,
      }));
      await vdb.entity_ledger_items.bulkPut(ledgerRows);
    }
  },

  async setStatus(id: string, status: EntityStatus, turn: number, reason?: string): Promise<void> {
    await vdb.entities.update(id, {
      status,
      status_changed_turn: turn,
      ...(reason !== undefined ? { exit_reason: reason } : {}),
    });
  },

  // ─── Relationships ───
  async addRelationship(
    campaignId: SaveId,
    src: { id: string; kind: EntityRelationshipKind },
    dst: { id: string; kind: EntityRelationshipKind },
    relation_type: string,
    opts: {
      strength?: number;
      visibility?: 'open' | 'rumored' | 'secret';
      evidence?: string;
      turn: number;
      symmetric?: boolean;
    }
  ): Promise<void> {
    const baseRow: EntityRelationshipRow = {
      id: generateUUID(),
      campaign_id: campaignId,
      source_id: src.id,
      source_kind: src.kind,
      target_id: dst.id,
      target_kind: dst.kind,
      relation_type,
      strength: opts.strength ?? 0,
      visibility: opts.visibility ?? 'open',
      evidence: opts.evidence ?? null,
      first_seen_turn: opts.turn,
      last_updated_turn: opts.turn,
      is_active: 1,
      is_symmetric: opts.symmetric ? 1 : 0,
    };
    if (opts.symmetric) {
      const mirror: EntityRelationshipRow = {
        ...baseRow,
        id: generateUUID(),
        source_id: dst.id,
        source_kind: dst.kind,
        target_id: src.id,
        target_kind: src.kind,
      };
      await vdb.entity_relationships.bulkPut([baseRow, mirror]);
    } else {
      await vdb.entity_relationships.put(baseRow);
    }
  },

  async listRelationshipsFor(id: string): Promise<EntityRelationshipRow[]> {
    return vdb.entity_relationships.where('source_id').equals(id).toArray();
  },
};
