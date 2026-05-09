// ============================================================================
// db/projection.ts — `GameSave` ⇄ normalized-tables projection.
//
//   absorbGameSave(save):   tear a legacy `GameSave` blob into normalized rows
//                           inside one transaction.
//   projectGameSave(id):    rebuild the `GameSave` blob from rows in one
//                           transaction.
//
// Round-trip equivalence is the contract:
//
//      projectGameSave(absorbGameSave(s).campaign_id) ≈ s
//
// "≈" because:
//   - Synthetic row IDs (uuids for `character_inventory` etc.) are not stored
//     anywhere in the legacy blob; they are generated fresh on every absorb
//     and therefore differ between calls. The legacy fields these rows back
//     are still byte-identical.
//   - `Float32Array` embeddings are not part of `GameSave` and are not
//     touched here.
//
// All other fields must round-trip. `db/verify.ts` provides the differ.
// ============================================================================
import {
  vdb,
  CampaignRow,
  CharacterRow,
  CharacterInventoryRow,
  CharacterConditionRow,
  CharacterGoalRow,
  CharacterRelationshipTextRow,
  CharacterSkillRow,
  TurnRow,
  MessageRow,
  SummarySegmentRow,
  RollLogRow,
  RollStatsRow,
  DebugLogRow,
  MemoryRow,
  MemoryTagRow,
  LoreRow,
  EntityRow,
  EntityLedgerRow,
  EntityRelationshipRow,
  PregnancyRow,
  LocationRow,
  LocationEdgeRow,
  FactionRow,
  FactionTerritoryRow,
  FactionResourceRow,
  FactionMembershipRow,
  FactionDispositionRow,
  FactionPlayerStandingRow,
  FactionKnownActionRow,
  FactionExposureRow,
  FactionIntelligenceRow,
  FactionConflictRow,
  DormantHookRow,
  DormantHookEntityRow,
  ThreatRow,
  ThreatEntitySourceRow,
  ThreatArcHistoryRow,
  ThreatDenialRow,
  LegalClaimRow,
  PlayerDocumentRow,
  WorldStateRow,
  WorldRuleRow,
  WorldTagRow,
  ScenarioRow,
  TraumaStateRow,
  UsedNameRow,
  BannedNameMapRow,
  BannedMechanismRow,
  ImageUseRow,
} from './schema';
import {
  GameSave,
  GameWorld,
  GameHistory,
  Character,
  ChatMessage,
  KnownEntity,
  MemoryItem,
  LoreItem,
  SummarySegment,
  Faction,
  FactionConflict,
  DormantHook,
  WorldTickEvent,
  ActiveThreat,
  Pregnancy,
  LegalClaim,
  LegalStatus,
  LocationGraph,
  LocationNode,
  LocationEdge,
  FactionExposureEntry,
  FactionIntelligenceEntry,
  ThreatArcEntry,
  ThreatDenialEntry,
  Scenario,
  Skill,
  SaveId,
  MessageId,
  MemoryId,
  LoreId,
  WorldTime,
  RollStatistics,
  RollOutcome,
  Role,
  ENTITY_STATUSES,
} from '../types';
import { generateUUID } from '../idUtils';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const b = (v: boolean | undefined | null): number => (v ? 1 : 0);
const fromB = (v: number | undefined | null): boolean => v === 1;

function normalizeName(name: string): string {
  return (name || '').toLowerCase().trim();
}

// ─── ID prefixing ──────────────────────────────────────────────────────────
// Engine IDs (MessageId, MemoryId, LoreId, npc_*, faction_*, location names,
// hook_*, threat IDs, etc.) are generated without knowledge of the campaign
// they belong to. Two saves of different campaigns can therefore contain
// identical engine IDs — and bulkPut overwrites by primary key, silently
// reassigning rows from one campaign to the other. To keep storage rows
// isolated per-campaign we prefix every stable engine ID with the campaign
// id at write time and strip it at read.
//
// Synthetic UUID rows (entity_ledger_items.id, summary_segments.id, etc.)
// don't need this — the UUIDs are unique by construction.
//
// `stamp` is a no-op for empty / nullish input so it's safe to apply to
// optional FK columns.
const ID_SEP = '::';
function stamp(cid: SaveId, id: string | null | undefined): string {
  if (!id) return '';
  return `${cid}${ID_SEP}${id}`;
}
function stampOpt<T extends string>(cid: SaveId, id: T | null | undefined): T | null {
  if (!id) return null;
  return `${cid}${ID_SEP}${id}` as T;
}
function stripStamp(cid: SaveId, stamped: string | null | undefined): string {
  if (!stamped) return '';
  const prefix = `${cid}${ID_SEP}`;
  return stamped.startsWith(prefix) ? stamped.slice(prefix.length) : stamped;
}
function stripStampOpt<T extends string>(cid: SaveId, stamped: string | null | undefined): T | undefined {
  if (!stamped) return undefined;
  const prefix = `${cid}${ID_SEP}`;
  return (stamped.startsWith(prefix) ? stamped.slice(prefix.length) : stamped) as T;
}

function recomputeWorldTime(totalMinutes: number, display: string): WorldTime {
  const day = Math.floor(totalMinutes / (24 * 60));
  const hour = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minute = totalMinutes % 60;
  return { totalMinutes, day, hour, minute, display };
}

const ALL_TABLES = [
  'campaigns',
  'characters',
  'character_inventory',
  'character_conditions',
  'character_goals',
  'character_relationships_text',
  'character_skills',
  'turns',
  'messages',
  'summary_segments',
  'roll_log',
  'roll_stats',
  'debug_log',
  'memories',
  'memory_tags',
  'lore',
  'entities',
  'entity_ledger_items',
  'entity_relationships',
  'pregnancies',
  'locations',
  'location_edges',
  'factions',
  'faction_territories',
  'faction_resources',
  'faction_memberships',
  'faction_dispositions',
  'faction_player_standing',
  'faction_known_actions',
  'faction_exposure',
  'faction_intelligence',
  'faction_conflicts',
  'dormant_hooks',
  'dormant_hook_entities',
  'threats',
  'threat_entity_sources',
  'threat_arc_history',
  'threat_denial_tracker',
  'legal_claims',
  'player_documents',
  'world_state',
  'world_rules',
  'world_tags',
  'scenarios',
  'trauma_state',
  'used_names',
  'banned_name_map',
  'banned_mechanisms',
  'image_uses',
] as const;

// ────────────────────────────────────────────────────────────────────────────
// absorbGameSave
// ────────────────────────────────────────────────────────────────────────────

export async function absorbGameSave(save: GameSave): Promise<{ campaign_id: SaveId }> {
  const cid = save.id;
  const world = save.gameState.world;
  const history = save.gameState.history;
  const character = save.character;

  await vdb.transaction('rw', ALL_TABLES.map(t => vdb.table(t)), async () => {
    // ─── Wipe any prior rows for this campaign so absorb is idempotent. ───
    await deleteCampaignRows(cid);

    // ─── Campaign root ───
    const campaignRow: CampaignRow = {
      id: cid,
      name: save.name,
      created_at: save.timestamp,
      updated_at: save.timestamp,
      last_played_turn: world.turnCount,
      world_seed_id: world.worldSeedId ?? null,
      thumbnail_image_id: save.thumbnail ?? null,
      schema_version: 1,
    };
    await vdb.campaigns.put(campaignRow);

    if (save.thumbnail) {
      const u: ImageUseRow = {
        image_id: save.thumbnail,
        owner_kind: 'campaign_thumbnail',
        owner_id: cid,
      };
      await vdb.image_uses.put(u);
    }

    // ─── Character + sub-arrays ───
    const charRow: CharacterRow = {
      campaign_id: cid,
      name: character.name,
      gender: character.gender,
      race: character.race,
      setting: character.setting,
      appearance: character.appearance,
      notable_features: character.notableFeatures,
      backstory: character.backstory,
      hidden_notes: character.hiddenNotes ?? null,
      trauma: character.trauma,
      bio: character.bio,
      condition_timestamps: character.conditionTimestamps ?? null,
      languages_known: character.languagesKnown ?? null,
    };
    await vdb.characters.put(charRow);

    if (character.inventory?.length) {
      const rows: CharacterInventoryRow[] = character.inventory.map((item) => ({
        id: generateUUID(),
        campaign_id: cid,
        item,
        acquired_turn: world.turnCount,  // unknown for legacy items; stamp current turn
      }));
      await vdb.character_inventory.bulkPut(rows);
    }

    if (character.conditions?.length) {
      const rows: CharacterConditionRow[] = character.conditions.map((condition) => ({
        id: generateUUID(),
        campaign_id: cid,
        condition,
        applied_turn: world.turnCount,
        applied_at: character.conditionTimestamps?.[condition] ?? null,
      }));
      await vdb.character_conditions.bulkPut(rows);
    }

    if (character.goals?.length) {
      const rows: CharacterGoalRow[] = character.goals.map((goal) => ({
        id: generateUUID(),
        campaign_id: cid,
        goal,
        created_turn: world.turnCount,
        status: 'active',
      }));
      await vdb.character_goals.bulkPut(rows);
    }

    if (character.relationships?.length) {
      const rows: CharacterRelationshipTextRow[] = character.relationships.map((text) => ({
        id: generateUUID(),
        campaign_id: cid,
        text,
        created_turn: world.turnCount,
      }));
      await vdb.character_relationships_text.bulkPut(rows);
    }

    if (character.skills?.length) {
      const rows: CharacterSkillRow[] = character.skills.map((s: Skill) => ({
        id: s.id,
        campaign_id: cid,
        name: s.name,
        category: s.category,
        level: s.level,
        source: s.source,
        usage_count: s.usageCount,
        last_used_turn: s.lastUsedTurn ?? null,
      }));
      await vdb.character_skills.bulkPut(rows);
    }

    // ─── Turn history ───
    if (history.history?.length) {
      const messageRows: MessageRow[] = history.history.map((m: ChatMessage) => ({
        id: stamp(cid, m.id) as MessageId,
        campaign_id: cid,
        turn_number: 0, // turn_number is recomputed below
        role: m.role,
        text: m.text,
        timestamp: m.timestamp,
        is_resolved: m.isResolved ?? null,
        roll_request: m.rollRequest ?? null,
        bargain_request: m.bargainRequest ?? null,
        npc_interaction: m.npcInteraction ?? null,
        world_tick: m.worldTick ?? null,
        metadata: m.metadata ?? null,
      }));

      // Best-effort turn_number assignment: increment on each USER message.
      // The legacy save format does not record per-message turn numbers.
      let cursor = 0;
      for (const row of messageRows) {
        if (row.role === Role.USER) cursor++;
        row.turn_number = cursor;
      }

      await vdb.messages.bulkPut(messageRows);
    }

    if (history.summarySegments?.length) {
      const rows: SummarySegmentRow[] = history.summarySegments.map((s: SummarySegment) => ({
        id: generateUUID(),
        campaign_id: cid,
        start_turn: s.startTurn,
        end_turn: s.endTurn,
        summary: s.summary,
        timestamp: s.timestamp,
      }));
      await vdb.summary_segments.bulkPut(rows);
    }

    if (history.rollLog?.length) {
      const rows: RollLogRow[] = history.rollLog.map((entry) => ({
        id: generateUUID(),
        campaign_id: cid,
        turn_number: world.turnCount,    // legacy doesn't tag rolls per turn
        entry,
        outcome: null,
      }));
      await vdb.roll_log.bulkPut(rows);
    }

    if (history.rollStats) {
      const r: RollStatsRow = {
        campaign_id: cid,
        total_rolls: history.rollStats.totalRolls,
        critical_successes: history.rollStats.criticalSuccesses,
        critical_failures: history.rollStats.criticalFailures,
        average_roll: history.rollStats.averageRoll,
        outcomes: history.rollStats.outcomes,
      };
      await vdb.roll_stats.put(r);
    }

    if (history.debugLog?.length) {
      const rows: DebugLogRow[] = history.debugLog.map((d) => ({
        id: generateUUID(),
        campaign_id: cid,
        turn_number: world.turnCount,
        timestamp: d.timestamp,
        message: d.message,
        level: d.type,
      }));
      await vdb.debug_log.bulkPut(rows);
    }

    // ─── Memory & lore ───
    if (world.memory?.length) {
      const memRows: MemoryRow[] = [];
      const tagRows: MemoryTagRow[] = [];
      for (const m of world.memory as MemoryItem[]) {
        const tags = m.tags ?? [];
        const pinned = tags.some((t) =>
          ['vow', 'oath', 'debt', 'reveal', 'death', 'identity', 'betrayal'].includes(t)
        );
        const stampedMemId = stamp(cid, m.id) as MemoryId;
        memRows.push({
          id: stampedMemId,
          campaign_id: cid,
          fact: m.fact,
          salience: m.salience ?? 2,
          turn_created: m.turnCreated ?? 0,
          timestamp: m.timestamp,
          is_pinned: pinned ? 1 : 0,
        });
        for (const tag of tags) {
          tagRows.push({ memory_id: stampedMemId, tag });
        }
      }
      await vdb.memories.bulkPut(memRows);
      if (tagRows.length) await vdb.memory_tags.bulkPut(tagRows);
    }

    if (world.lore?.length) {
      const rows: LoreRow[] = (world.lore as LoreItem[]).map((l) => ({
        id: stamp(cid, l.id) as LoreId,
        campaign_id: cid,
        keyword: l.keyword,
        content: l.content,
        timestamp: l.timestamp,
        turn_created: l.turnCreated ?? null,
        semantic_update_of: stampOpt<LoreId>(cid, l.semanticUpdateOf),
      }));
      await vdb.lore.bulkPut(rows);
    }

    // ─── Entities ───
    if (world.knownEntities?.length) {
      const eRows: EntityRow[] = [];
      const ledgerRows: EntityLedgerRow[] = [];
      for (const e of world.knownEntities as KnownEntity[]) {
        const stampedEid = stamp(cid, e.id);
        eRows.push({
          id: stampedEid,
          campaign_id: cid,
          name: e.name,
          role: e.role,
          current_location_id: null,           // resolved at higher layer
          current_location_text: e.location ?? null,
          impression: e.impression,
          personality: e.personality?.trim() ? e.personality.trim() : null,
          relationship_level: e.relationship_level,
          leverage: e.leverage,
          status: (e.status ?? 'present') as typeof ENTITY_STATUSES[number],
          first_seen_turn: e.firstSeenTurn ?? null,
          last_seen_turn: e.lastSeenTurn ?? null,
          status_changed_turn: e.statusChangedTurn ?? null,
          exit_reason: e.exitReason ?? null,
        });
        for (const text of e.ledger ?? []) {
          ledgerRows.push({
            id: generateUUID(),
            entity_id: stampedEid,
            campaign_id: cid,
            text,
            recorded_turn: e.lastSeenTurn ?? 0,
          });
        }
      }
      await vdb.entities.bulkPut(eRows);
      if (ledgerRows.length) await vdb.entity_ledger_items.bulkPut(ledgerRows);
    }

    // ─── Pregnancies ───
    if (world.pregnancies?.length) {
      const rows: PregnancyRow[] = (world.pregnancies as Pregnancy[]).map((p) => ({
        id: stamp(cid, p.id),
        campaign_id: cid,
        mother_entity_id: null,
        mother_is_player: 0,                   // not derivable from legacy shape
        mother_name_legacy: p.motherName,
        father_entity_id: null,
        father_is_player: 0,
        father_unknown: p.fatherName ? 0 : 1,
        father_name_legacy: p.fatherName ?? '',
        conception_turn: p.conceptionTurn,
        conception_time: p.conceptionTime,
        current_week: p.currentWeek,
        is_visible: b(p.isVisible),
        status: p.status,
      }));
      await vdb.pregnancies.bulkPut(rows);
    }

    // ─── Locations ───
    const lg: LocationGraph | undefined = world.locationGraph;
    if (lg?.nodes) {
      const nodeRows: LocationRow[] = Object.values(lg.nodes).map((n: LocationNode) => ({
        id: stamp(cid, n.id),
        campaign_id: cid,
        display_name: n.displayName,
        description: n.description ?? null,
        first_mentioned_turn: n.firstMentionedTurn,
        tags: n.tags ?? [],
      }));
      if (nodeRows.length) await vdb.locations.bulkPut(nodeRows);

      const edgeRows: LocationEdgeRow[] = (lg.edges ?? []).map((e: LocationEdge) => ({
        id: generateUUID(),
        campaign_id: cid,
        from_id: stamp(cid, e.from),
        to_id: stamp(cid, e.to),
        travel_time_minutes: e.travelTimeMinutes,
        source: e.source,
        created_turn: e.createdTurn,
        mode_overrides: e.modeOverrides ?? null,
      }));
      if (edgeRows.length) await vdb.location_edges.bulkPut(edgeRows);
    }

    // ─── Factions ───
    if (world.factions?.length) {
      const fRows: FactionRow[] = [];
      const territoryRows: FactionTerritoryRow[] = [];
      const resourceRows: FactionResourceRow[] = [];
      const memberRows: FactionMembershipRow[] = [];
      const dispRows: FactionDispositionRow[] = [];
      const standingRows: FactionPlayerStandingRow[] = [];
      const actionRows: FactionKnownActionRow[] = [];

      for (const f of world.factions as Faction[]) {
        const stampedFid = stamp(cid, f.id);
        fRows.push({
          id: stampedFid,
          campaign_id: cid,
          name: f.name,
          description: f.description,
          influence: f.influence,
          leader_entity_id: null,
          leader_name_legacy: f.leader ?? null,
          active_objective: f.activeObjective ?? null,
        });

        for (const territoryId of f.territory ?? []) {
          territoryRows.push({
            faction_id: stampedFid,
            location_id: stamp(cid, territoryId),
            campaign_id: cid,
            claimed_turn: 0,
          });
        }

        for (const resource of f.resources ?? []) {
          resourceRows.push({ faction_id: stampedFid, resource, campaign_id: cid });
        }

        for (const memberEntityId of f.memberEntityIds ?? []) {
          memberRows.push({
            faction_id: stampedFid,
            entity_id: stamp(cid, memberEntityId),
            campaign_id: cid,
            joined_turn: 0,
            role_in_faction: null,
          });
        }

        for (const [otherId, disp] of Object.entries(f.disposition ?? {})) {
          dispRows.push({
            from_faction_id: stampedFid,
            to_faction_id: stamp(cid, otherId),
            campaign_id: cid,
            disposition: disp,
            last_updated_turn: 0,
          });
        }

        if (f.playerStanding) {
          standingRows.push({
            faction_id: stampedFid,
            campaign_id: cid,
            reputation: f.playerStanding.reputation,
            rank: f.playerStanding.rank ?? null,
          });

          for (const action of f.playerStanding.knownActions ?? []) {
            actionRows.push({
              id: generateUUID(),
              faction_id: stampedFid,
              campaign_id: cid,
              action,
              recorded_turn: 0,
            });
          }
        }
      }

      await vdb.factions.bulkPut(fRows);
      if (territoryRows.length) await vdb.faction_territories.bulkPut(territoryRows);
      if (resourceRows.length) await vdb.faction_resources.bulkPut(resourceRows);
      if (memberRows.length) await vdb.faction_memberships.bulkPut(memberRows);
      if (dispRows.length) await vdb.faction_dispositions.bulkPut(dispRows);
      if (standingRows.length) await vdb.faction_player_standing.bulkPut(standingRows);
      if (actionRows.length) await vdb.faction_known_actions.bulkPut(actionRows);
    }

    if (world.factionConflicts?.length) {
      const rows: FactionConflictRow[] = (world.factionConflicts as FactionConflict[]).map((c) => ({
        id: stamp(cid, c.id),
        campaign_id: cid,
        aggressor_id: stamp(cid, c.aggressorId),
        defender_id: stamp(cid, c.defenderId),
        type: c.type,
        start_turn: c.startTurn,
        stakes: c.stakes,
        momentum: c.momentum,
        last_escalation_turn: c.lastEscalationTurn,
        player_involvement: c.playerInvolvement,
        is_active: 1,
      }));
      await vdb.faction_conflicts.bulkPut(rows);
    }

    if (world.factionExposure) {
      const rows: FactionExposureRow[] = [];
      for (const [subjectName, entry] of Object.entries(
        world.factionExposure as Record<string, FactionExposureEntry>
      )) {
        rows.push({
          id: generateUUID(),
          campaign_id: cid,
          subject_id: '',                        // resolved at the access layer
          subject_kind: 'faction',
          subject_name_legacy: subjectName,
          exposure_score: entry.exposureScore,
          last_observed_action: entry.lastObservedAction,
          last_observed_turn: entry.lastObservedTurn,
          observed_capabilities: entry.observedCapabilities ?? [],
        });
      }
      if (rows.length) await vdb.faction_exposure.bulkPut(rows);
    }

    if (world.factionIntelligence) {
      const rows: FactionIntelligenceRow[] = [];
      for (const [subjectName, entry] of Object.entries(
        world.factionIntelligence as Record<string, FactionIntelligenceEntry>
      )) {
        rows.push({
          id: generateUUID(),
          campaign_id: cid,
          subject_id: '',
          subject_kind: 'faction',
          subject_name_legacy: subjectName,
          known_player_location: entry.knownPlayerLocation,
          location_confidence: entry.locationConfidenceLevel,
          last_updated_turn: entry.lastUpdatedTurn,
          information_source: entry.informationSource,
        });
      }
      if (rows.length) await vdb.faction_intelligence.bulkPut(rows);
    }

    // ─── Threats and dormant hooks ───
    if (world.dormantHooks?.length) {
      const hookRows: DormantHookRow[] = [];
      const hookEntityRows: DormantHookEntityRow[] = [];
      for (const h of world.dormantHooks as DormantHook[]) {
        const stampedHid = stamp(cid, h.id);
        hookRows.push({
          id: stampedHid,
          campaign_id: cid,
          summary: h.summary,
          category: h.category,
          source_field: h.sourceField,
          activation_conditions: h.activationConditions,
          status: h.status,
          activated_turn: h.activatedTurn ?? null,
          resolved_turn: h.resolvedTurn ?? null,
          cooldown_until_turn: h.cooldownUntilTurn ?? null,
          last_threat_expired_turn: h.lastThreatExpiredTurn ?? null,
          total_threats_sourced: h.totalThreatsSourced ?? 0,
        });
        for (const entityName of h.involvedEntities ?? []) {
          hookEntityRows.push({
            hook_id: stampedHid,
            entity_name_normalized: normalizeName(entityName),
            campaign_id: cid,
            resolved_entity_id: null,
          });
        }
      }
      await vdb.dormant_hooks.bulkPut(hookRows);
      if (hookEntityRows.length) await vdb.dormant_hook_entities.bulkPut(hookEntityRows);
    }

    // Active threats
    if (world.activeThreats?.length) {
      const rows: ThreatRow[] = (world.activeThreats as ActiveThreat[]).map((t) => ({
        id: stamp(cid, t.id),
        campaign_id: cid,
        kind: 'active',
        name: t.name,
        archetype: t.archetype,
        enemy_state: t.status,
        condition: t.condition,
        current_action: t.current_action,
        cover_state: t.cover_state,
        distance: t.distance,
        description: null,
        turns_until_impact: null,
        faction_source: null,
        origin_hook_id: null,
        dormant_hook_id_at_creation: null,
        player_action_cause: null,
        status: null,
        turn_created: null,
        original_eta: null,
        minimum_eta_floor: null,
        consecutive_turns_at_eta_one: null,
        required_lore_capability: null,
        pivot_penalty_applied: null,
      }));
      await vdb.threats.bulkPut(rows);
    }

    // Emerging threats
    if (world.emergingThreats?.length) {
      const rows: ThreatRow[] = [];
      const sourceRows: ThreatEntitySourceRow[] = [];
      for (const t of world.emergingThreats as WorldTickEvent[]) {
        const rawId = t.id ?? generateUUID();
        const stampedTid = stamp(cid, rawId);
        rows.push({
          id: stampedTid,
          campaign_id: cid,
          kind: 'emerging',
          name: null,
          archetype: null,
          enemy_state: null,
          condition: null,
          current_action: null,
          cover_state: null,
          distance: null,
          description: t.description,
          turns_until_impact: t.turns_until_impact ?? null,
          faction_source: t.factionSource ? stamp(cid, t.factionSource) : null,
          origin_hook_id: t.originHookId ? stamp(cid, t.originHookId) : null,
          dormant_hook_id_at_creation: t.dormantHookId ? stamp(cid, t.dormantHookId) : null,
          player_action_cause: t.playerActionCause ?? null,
          status: t.status ?? null,
          turn_created: t.turnCreated ?? null,
          original_eta: t.originalEta ?? null,
          minimum_eta_floor: t.minimumEtaFloor ?? null,
          consecutive_turns_at_eta_one: t.consecutiveTurnsAtEtaOne ?? null,
          required_lore_capability: t.requiredLoreCapability ?? null,
          pivot_penalty_applied: t.pivotPenaltyApplied ?? null,
        });
        for (const ename of t.entitySourceNames ?? []) {
          sourceRows.push({
            threat_id: stampedTid,
            entity_name_normalized: normalizeName(ename),
            campaign_id: cid,
          });
        }
      }
      await vdb.threats.bulkPut(rows);
      if (sourceRows.length) await vdb.threat_entity_sources.bulkPut(sourceRows);
    }

    if (world.threatArcHistory) {
      const rows: ThreatArcHistoryRow[] = [];
      for (const [bucket, entries] of Object.entries(
        world.threatArcHistory as Record<string, ThreatArcEntry[]>
      )) {
        for (const entry of entries) {
          rows.push({
            id: generateUUID(),
            campaign_id: cid,
            bucket,
            entity_names: entry.entityNames ?? [],
            expired_turn: entry.expiredTurn,
            description_snippet: entry.descriptionSnippet,
          });
        }
      }
      if (rows.length) await vdb.threat_arc_history.bulkPut(rows);
    }

    if (world.threatDenialTracker) {
      const rows: ThreatDenialRow[] = [];
      for (const [entityFragment, entry] of Object.entries(
        world.threatDenialTracker as Record<string, ThreatDenialEntry>
      )) {
        rows.push({
          id: generateUUID(),
          campaign_id: cid,
          entity_name_fragment_normalized: entityFragment,
          denial_count: entry.denialCount,
          last_denied_turn: entry.lastDeniedTurn,
          suppressed_at_turn: entry.suppressedAtTurn ?? null,
        });
      }
      if (rows.length) await vdb.threat_denial_tracker.bulkPut(rows);
    }

    // ─── Legal ───
    const legal: LegalStatus | undefined = world.legalStatus;
    if (legal?.knownClaims?.length) {
      const rows: LegalClaimRow[] = (legal.knownClaims as LegalClaim[]).map((c) => ({
        id: stamp(cid, c.id),
        campaign_id: cid,
        claimant: c.claimant,
        subject: c.subject,
        basis: c.basis,
        validity: c.validity,
        resolved_by: c.resolvedBy ?? null,
        resolved_turn: c.resolvedTurn ?? null,
      }));
      await vdb.legal_claims.bulkPut(rows);
    }
    if (legal?.playerDocuments?.length) {
      const rows: PlayerDocumentRow[] = legal.playerDocuments.map((name) => ({
        id: generateUUID(),
        campaign_id: cid,
        name,
        acquired_turn: null,
      }));
      await vdb.player_documents.bulkPut(rows);
    }

    // ─── World singleton state ───
    const wsRow: WorldStateRow = {
      campaign_id: cid,
      current_model: world.currentModel,
      scene_mode: world.sceneMode,
      tension_level: world.tensionLevel,
      world_time_total_minutes: world.time?.totalMinutes ?? 0,
      world_time_display: world.time?.display ?? '',
      turn_count: world.turnCount,
      last_world_tick_turn: world.lastWorldTickTurn ?? 0,
      last_bargain_turn: world.lastBargainTurn ?? 0,
      last_threat_arc_end_turn: world.lastThreatArcEndTurn ?? null,
      threat_cooldown_until_turn: world.threatCooldownUntilTurn ?? null,
      session_denial_count: world.sessionDenialCount ?? 0,
      passive_allies_detected: b(world.passiveAlliesDetected),
      player_location_id: lg?.playerLocationId ? stamp(cid, lg.playerLocationId) : null,
      player_location_text: world.location ?? null,
      hidden_registry: world.hiddenRegistry ?? '',
      visual_url: world.visualUrl ?? null,
      is_generating_visual: b(world.isGeneratingVisual),
      is_generating_scenarios: b(world.isGeneratingScenarios),
      is_thinking: b(history.isThinking),
      failed_models: world.failedModels ?? [],
      environment: world.environment ?? null,
      last_active_summary: history.lastActiveSummary ?? null,
    };
    await vdb.world_state.put(wsRow);

    if (world.worldRules?.length) {
      const rows: WorldRuleRow[] = world.worldRules.map((rule) => ({
        id: generateUUID(),
        campaign_id: cid,
        rule,
        source: 'gameplay',                 // origin not preserved in legacy; default to gameplay
      }));
      await vdb.world_rules.bulkPut(rows);
    }

    if (world.worldTags?.length) {
      const rows: WorldTagRow[] = world.worldTags.map((tag) => ({ campaign_id: cid, tag }));
      await vdb.world_tags.bulkPut(rows);
    }

    if (world.scenarios?.length) {
      const rows: ScenarioRow[] = (world.scenarios as Scenario[]).map((s) => ({
        id: generateUUID(),
        campaign_id: cid,
        title: s.title,
        description: s.description,
        opening_line: s.opening_line,
      }));
      await vdb.scenarios.bulkPut(rows);
    }

    await vdb.trauma_state.put({
      campaign_id: cid,
      active_effect: world.activeTraumaEffect ?? null,
      last_effect_turn: world.lastTraumaEffectTurn ?? null,
    });

    // ─── Registries ───
    if (world.usedNameRegistry?.length) {
      const rows: UsedNameRow[] = world.usedNameRegistry.map((n) => ({
        campaign_id: cid,
        name_normalized: n.toLowerCase(),
        original_display: n,
        first_used_turn: 0,
        entity_id: null,
      }));
      await vdb.used_names.bulkPut(rows);
    }

    if (world.bannedNameMap) {
      const rows: BannedNameMapRow[] = Object.entries(world.bannedNameMap).map(
        ([display, canonical]) => ({
          campaign_id: cid,
          display_name: display,
          canonical_name: canonical,
        })
      );
      if (rows.length) await vdb.banned_name_map.bulkPut(rows);
    }

    if (world.bannedMechanisms?.length) {
      const rows: BannedMechanismRow[] = world.bannedMechanisms.map((keywords) => ({
        id: generateUUID(),
        campaign_id: cid,
        keywords,
        banned_turn: 0,
      }));
      await vdb.banned_mechanisms.bulkPut(rows);
    }

    // ─── Generated images → image_uses ───
    if (world.generatedImages?.length) {
      const rows: ImageUseRow[] = world.generatedImages.map((imgId) => ({
        image_id: imgId,
        owner_kind: 'generated_image',
        owner_id: cid,
      }));
      await vdb.image_uses.bulkPut(rows);
    }
  });

  return { campaign_id: cid };
}

// ────────────────────────────────────────────────────────────────────────────
// projectGameSave
// ────────────────────────────────────────────────────────────────────────────

export async function projectGameSave(campaignId: SaveId): Promise<GameSave | undefined> {
  return await vdb.transaction('r', ALL_TABLES.map(t => vdb.table(t)), async () => {
    const camp = await vdb.campaigns.get(campaignId);
    if (!camp) return undefined;

    const charRow = await vdb.characters.get(campaignId);
    if (!charRow) return undefined;

    const inventoryRows = await vdb.character_inventory.where('campaign_id').equals(campaignId).toArray();
    const conditionRows = await vdb.character_conditions.where('campaign_id').equals(campaignId).toArray();
    const goalRows = await vdb.character_goals.where('campaign_id').equals(campaignId).toArray();
    const relTextRows = await vdb.character_relationships_text.where('campaign_id').equals(campaignId).toArray();
    const skillRows = await vdb.character_skills.where('campaign_id').equals(campaignId).toArray();

    const character: Character = {
      name: charRow.name,
      gender: charRow.gender,
      appearance: charRow.appearance,
      notableFeatures: charRow.notable_features,
      race: charRow.race,
      backstory: charRow.backstory,
      setting: charRow.setting,
      inventory: inventoryRows.map((r) => r.item),
      relationships: relTextRows.map((r) => r.text),
      conditions: conditionRows.map((r) => r.condition),
      goals: goalRows.filter((r) => r.status === 'active').map((r) => r.goal),
      trauma: charRow.trauma,
      bio: charRow.bio,
      hiddenNotes: charRow.hidden_notes ?? undefined,
      conditionTimestamps: charRow.condition_timestamps ?? undefined,
      skills: skillRows.length
        ? skillRows.map((r): Skill => ({
            id: r.id,
            name: r.name,
            category: r.category,
            level: r.level,
            source: r.source,
            usageCount: r.usage_count,
            lastUsedTurn: r.last_used_turn ?? undefined,
          }))
        : undefined,
      languagesKnown: charRow.languages_known ?? undefined,
    };

    // ─── History ───
    const messageRows = await vdb.messages.where('campaign_id').equals(campaignId).sortBy('timestamp');
    const history: ChatMessage[] = messageRows.map((m) => ({
      id: stripStamp(campaignId, m.id) as MessageId,
      role: m.role,
      text: m.text,
      timestamp: m.timestamp,
      ...(m.is_resolved !== null ? { isResolved: m.is_resolved } : {}),
      ...(m.roll_request ? { rollRequest: m.roll_request } : {}),
      ...(m.bargain_request ? { bargainRequest: m.bargain_request } : {}),
      ...(m.npc_interaction ? { npcInteraction: m.npc_interaction } : {}),
      ...(m.world_tick ? { worldTick: m.world_tick } : {}),
      ...(m.metadata ? { metadata: m.metadata } : {}),
    }));

    const summarySegmentRows = await vdb.summary_segments
      .where('campaign_id')
      .equals(campaignId)
      .sortBy('start_turn');
    const summarySegments: SummarySegment[] = summarySegmentRows.map((r) => ({
      startTurn: r.start_turn,
      endTurn: r.end_turn,
      summary: r.summary,
      timestamp: r.timestamp,
    }));

    const rollLogRows = await vdb.roll_log.where('campaign_id').equals(campaignId).toArray();
    const rollLog = rollLogRows.map((r) => r.entry);

    const rollStatsRow = await vdb.roll_stats.get(campaignId);
    const defaultOutcomes: Record<RollOutcome, number> = {
      'CRITICAL FAILURE': 0,
      'FAILURE': 0,
      'MIXED/COST': 0,
      'SUCCESS': 0,
      'STRONG SUCCESS': 0,
      'CRITICAL SUCCESS': 0,
    };
    const rollStats: RollStatistics = rollStatsRow
      ? {
          totalRolls: rollStatsRow.total_rolls,
          criticalSuccesses: rollStatsRow.critical_successes,
          criticalFailures: rollStatsRow.critical_failures,
          averageRoll: rollStatsRow.average_roll,
          outcomes: rollStatsRow.outcomes,
        }
      : {
          totalRolls: 0,
          criticalSuccesses: 0,
          criticalFailures: 0,
          averageRoll: 0,
          outcomes: defaultOutcomes,
        };

    const debugLogRows = await vdb.debug_log.where('campaign_id').equals(campaignId).sortBy('timestamp');
    const debugLog = debugLogRows.map((r) => ({
      timestamp: r.timestamp,
      message: r.message,
      type: r.level,
    }));

    const ws = await vdb.world_state.get(campaignId);

    const gameHistory: GameHistory = {
      history,
      rollLog,
      rollStats,
      isThinking: fromB(ws?.is_thinking),
      debugLog,
      turnCount: ws?.turn_count ?? 0,
      ...(ws?.last_active_summary ? { lastActiveSummary: ws.last_active_summary } : {}),
      summarySegments,
    };

    // ─── World ───
    const memRows = await vdb.memories.where('campaign_id').equals(campaignId).toArray();
    const tagRows = await vdb.memory_tags.where('memory_id').anyOf(memRows.map((m) => m.id)).toArray();
    const tagsByMem = new Map<string, string[]>();
    for (const t of tagRows) {
      if (!tagsByMem.has(t.memory_id)) tagsByMem.set(t.memory_id, []);
      tagsByMem.get(t.memory_id)!.push(t.tag);
    }
    const memory: MemoryItem[] = memRows.map((m) => ({
      id: stripStamp(campaignId, m.id) as MemoryId,
      fact: m.fact,
      timestamp: m.timestamp,
      salience: m.salience,
      tags: tagsByMem.get(m.id) ?? [],
      turnCreated: m.turn_created,
    }));

    const loreRows = await vdb.lore.where('campaign_id').equals(campaignId).toArray();
    const lore: LoreItem[] = loreRows.map((l) => ({
      id: stripStamp(campaignId, l.id) as LoreId,
      keyword: l.keyword,
      content: l.content,
      timestamp: l.timestamp,
      ...(l.turn_created !== null ? { turnCreated: l.turn_created } : {}),
      ...(l.semantic_update_of !== null
        ? { semanticUpdateOf: stripStampOpt<LoreId>(campaignId, l.semantic_update_of) }
        : {}),
    }));

    const entityRows = await vdb.entities.where('campaign_id').equals(campaignId).toArray();
    const ledgerRows = await vdb.entity_ledger_items
      .where('entity_id')
      .anyOf(entityRows.map((e) => e.id))
      .toArray();
    const ledgerByEntity = new Map<string, string[]>();
    for (const r of ledgerRows) {
      if (!ledgerByEntity.has(r.entity_id)) ledgerByEntity.set(r.entity_id, []);
      ledgerByEntity.get(r.entity_id)!.push(r.text);
    }
    const knownEntities: KnownEntity[] = entityRows.map((e) => ({
      id: stripStamp(campaignId, e.id),
      name: e.name,
      role: e.role,
      location: e.current_location_text ?? '',
      impression: e.impression,
      relationship_level: e.relationship_level,
      leverage: e.leverage,
      ledger: ledgerByEntity.get(e.id) ?? [],
      // Conditionally spread so unset personality stays `undefined` on
      // projection (matches absorb side: undefined input → null in DB →
      // absent on output), preserving round-trip equivalence.
      ...(e.personality ? { personality: e.personality } : {}),
      ...(e.status ? { status: e.status } : {}),
      ...(e.last_seen_turn !== null ? { lastSeenTurn: e.last_seen_turn } : {}),
      ...(e.first_seen_turn !== null ? { firstSeenTurn: e.first_seen_turn } : {}),
      ...(e.exit_reason !== null ? { exitReason: e.exit_reason } : {}),
      ...(e.status_changed_turn !== null ? { statusChangedTurn: e.status_changed_turn } : {}),
    }));

    const pregRows = await vdb.pregnancies.where('campaign_id').equals(campaignId).toArray();
    const pregnancies: Pregnancy[] = pregRows.map((p) => ({
      id: stripStamp(campaignId, p.id),
      motherName: p.mother_name_legacy,
      fatherName: p.father_name_legacy,
      conceptionTurn: p.conception_turn,
      conceptionTime: p.conception_time,
      currentWeek: p.current_week,
      isVisible: fromB(p.is_visible),
      status: p.status,
    }));

    const locationRows = await vdb.locations.where('campaign_id').equals(campaignId).toArray();
    const edgeRows = await vdb.location_edges.where('campaign_id').equals(campaignId).toArray();
    let locationGraph: LocationGraph | undefined = undefined;
    if (locationRows.length || edgeRows.length || ws?.player_location_id) {
      const nodes: Record<string, LocationNode> = {};
      for (const r of locationRows) {
        const unstampedId = stripStamp(campaignId, r.id);
        nodes[unstampedId] = {
          id: unstampedId,
          displayName: r.display_name,
          firstMentionedTurn: r.first_mentioned_turn,
          tags: r.tags,
          ...(r.description !== null ? { description: r.description } : {}),
        };
      }
      const edges: LocationEdge[] = edgeRows.map((e) => ({
        from: stripStamp(campaignId, e.from_id),
        to: stripStamp(campaignId, e.to_id),
        travelTimeMinutes: e.travel_time_minutes,
        source: e.source,
        createdTurn: e.created_turn,
        ...(e.mode_overrides ? { modeOverrides: e.mode_overrides } : {}),
      }));
      locationGraph = {
        nodes,
        edges,
        playerLocationId: stripStamp(campaignId, ws?.player_location_id),
      };
    }

    // Factions
    const factionRows = await vdb.factions.where('campaign_id').equals(campaignId).toArray();
    const factionIds = factionRows.map((f) => f.id);
    const territoryRows = factionIds.length
      ? await vdb.faction_territories.where('faction_id').anyOf(factionIds).toArray()
      : [];
    const resourceRows = factionIds.length
      ? await vdb.faction_resources.where('faction_id').anyOf(factionIds).toArray()
      : [];
    const memberRows = factionIds.length
      ? await vdb.faction_memberships.where('faction_id').anyOf(factionIds).toArray()
      : [];
    const dispRows = factionIds.length
      ? await vdb.faction_dispositions.where('from_faction_id').anyOf(factionIds).toArray()
      : [];
    const standingRows = factionIds.length
      ? await vdb.faction_player_standing.where('faction_id').anyOf(factionIds).toArray()
      : [];
    const knownActionRows = factionIds.length
      ? await vdb.faction_known_actions.where('faction_id').anyOf(factionIds).toArray()
      : [];

    const factions: Faction[] = factionRows.map((f) => {
      const standing = standingRows.find((s) => s.faction_id === f.id);
      const dispositions: Record<string, typeof dispRows[number]['disposition']> = {};
      for (const d of dispRows.filter((x) => x.from_faction_id === f.id)) {
        dispositions[stripStamp(campaignId, d.to_faction_id)] = d.disposition;
      }
      return {
        id: stripStamp(campaignId, f.id),
        name: f.name,
        description: f.description,
        territory: territoryRows
          .filter((t) => t.faction_id === f.id)
          .map((t) => stripStamp(campaignId, t.location_id)),
        influence: f.influence,
        disposition: dispositions,
        resources: resourceRows.filter((r) => r.faction_id === f.id).map((r) => r.resource),
        leader: f.leader_name_legacy ?? undefined,
        memberEntityIds: memberRows
          .filter((m) => m.faction_id === f.id)
          .map((m) => stripStamp(campaignId, m.entity_id)),
        playerStanding: {
          reputation: standing?.reputation ?? 0,
          rank: standing?.rank ?? undefined,
          knownActions: knownActionRows
            .filter((a) => a.faction_id === f.id)
            .sort((a, b) => a.recorded_turn - b.recorded_turn)
            .map((a) => a.action),
        },
        activeObjective: f.active_objective ?? undefined,
      };
    });

    const conflictRows = await vdb.faction_conflicts.where('campaign_id').equals(campaignId).toArray();
    const factionConflicts: FactionConflict[] = conflictRows.map((c) => ({
      id: stripStamp(campaignId, c.id),
      aggressorId: stripStamp(campaignId, c.aggressor_id),
      defenderId: stripStamp(campaignId, c.defender_id),
      type: c.type,
      startTurn: c.start_turn,
      stakes: c.stakes,
      momentum: c.momentum,
      lastEscalationTurn: c.last_escalation_turn,
      playerInvolvement: c.player_involvement,
    }));

    const exposureRows = await vdb.faction_exposure.where('campaign_id').equals(campaignId).toArray();
    const factionExposure: Record<string, FactionExposureEntry> = {};
    for (const r of exposureRows) {
      factionExposure[r.subject_name_legacy] = {
        exposureScore: r.exposure_score,
        lastObservedAction: r.last_observed_action,
        lastObservedTurn: r.last_observed_turn,
        observedCapabilities: r.observed_capabilities ?? [],
      };
    }

    const intelRows = await vdb.faction_intelligence.where('campaign_id').equals(campaignId).toArray();
    const factionIntelligence: Record<string, FactionIntelligenceEntry> = {};
    for (const r of intelRows) {
      factionIntelligence[r.subject_name_legacy] = {
        knownPlayerLocation: r.known_player_location,
        locationConfidenceLevel: r.location_confidence,
        lastUpdatedTurn: r.last_updated_turn,
        informationSource: r.information_source,
      };
    }

    // Threats
    const threatRows = await vdb.threats.where('campaign_id').equals(campaignId).toArray();
    const activeThreats: ActiveThreat[] = threatRows
      .filter((t) => t.kind === 'active')
      .map((t) => ({
        id: stripStamp(campaignId, t.id),
        name: t.name!,
        archetype: t.archetype!,
        status: t.enemy_state!,
        condition: t.condition!,
        current_action: t.current_action!,
        cover_state: t.cover_state!,
        distance: t.distance!,
      }));

    const threatSourceRows = await vdb.threat_entity_sources
      .where('campaign_id')
      .equals(campaignId)
      .toArray();
    const sourceByThreat = new Map<string, string[]>();
    for (const r of threatSourceRows) {
      if (!sourceByThreat.has(r.threat_id)) sourceByThreat.set(r.threat_id, []);
      sourceByThreat.get(r.threat_id)!.push(r.entity_name_normalized);
    }

    const emergingThreats: WorldTickEvent[] = threatRows
      .filter((t) => t.kind === 'emerging')
      .map((t) => ({
        description: t.description ?? '',
        ...(t.turns_until_impact !== null ? { turns_until_impact: t.turns_until_impact } : {}),
        id: stripStamp(campaignId, t.id),
        ...(t.faction_source !== null ? { factionSource: stripStamp(campaignId, t.faction_source) } : {}),
        ...(t.turn_created !== null ? { turnCreated: t.turn_created } : {}),
        ...(t.minimum_eta_floor !== null ? { minimumEtaFloor: t.minimum_eta_floor } : {}),
        ...(t.consecutive_turns_at_eta_one !== null
          ? { consecutiveTurnsAtEtaOne: t.consecutive_turns_at_eta_one }
          : {}),
        ...(t.required_lore_capability !== null
          ? { requiredLoreCapability: t.required_lore_capability }
          : {}),
        ...(t.status !== null ? { status: t.status } : {}),
        ...(t.dormant_hook_id_at_creation !== null
          ? { dormantHookId: stripStamp(campaignId, t.dormant_hook_id_at_creation) }
          : {}),
        ...(t.player_action_cause !== null ? { playerActionCause: t.player_action_cause } : {}),
        ...(sourceByThreat.has(t.id) ? { entitySourceNames: sourceByThreat.get(t.id) } : {}),
        ...(t.pivot_penalty_applied !== null
          ? { pivotPenaltyApplied: t.pivot_penalty_applied }
          : {}),
        ...(t.original_eta !== null ? { originalEta: t.original_eta } : {}),
        ...(t.origin_hook_id !== null ? { originHookId: stripStamp(campaignId, t.origin_hook_id) } : {}),
      }));

    const hookRows = await vdb.dormant_hooks.where('campaign_id').equals(campaignId).toArray();
    const hookEntityRows = await vdb.dormant_hook_entities
      .where('campaign_id')
      .equals(campaignId)
      .toArray();
    const entitiesByHook = new Map<string, string[]>();
    for (const r of hookEntityRows) {
      if (!entitiesByHook.has(r.hook_id)) entitiesByHook.set(r.hook_id, []);
      entitiesByHook.get(r.hook_id)!.push(r.entity_name_normalized);
    }
    const dormantHooks: DormantHook[] = hookRows.map((h) => ({
      id: stripStamp(campaignId, h.id),
      summary: h.summary,
      category: h.category,
      sourceField: h.source_field,
      involvedEntities: entitiesByHook.get(h.id) ?? [],
      activationConditions: h.activation_conditions,
      status: h.status,
      ...(h.activated_turn !== null ? { activatedTurn: h.activated_turn } : {}),
      ...(h.resolved_turn !== null ? { resolvedTurn: h.resolved_turn } : {}),
      ...(h.cooldown_until_turn !== null ? { cooldownUntilTurn: h.cooldown_until_turn } : {}),
      ...(h.last_threat_expired_turn !== null
        ? { lastThreatExpiredTurn: h.last_threat_expired_turn }
        : {}),
      totalThreatsSourced: h.total_threats_sourced,
    }));

    const arcRows = await vdb.threat_arc_history.where('campaign_id').equals(campaignId).toArray();
    const threatArcHistory: Record<string, ThreatArcEntry[]> = {};
    for (const r of arcRows) {
      if (!threatArcHistory[r.bucket]) threatArcHistory[r.bucket] = [];
      threatArcHistory[r.bucket].push({
        entityNames: r.entity_names,
        expiredTurn: r.expired_turn,
        descriptionSnippet: r.description_snippet,
      });
    }

    const denialRows = await vdb.threat_denial_tracker
      .where('campaign_id')
      .equals(campaignId)
      .toArray();
    const threatDenialTracker: Record<string, ThreatDenialEntry> = {};
    for (const r of denialRows) {
      threatDenialTracker[r.entity_name_fragment_normalized] = {
        denialCount: r.denial_count,
        lastDeniedTurn: r.last_denied_turn,
        ...(r.suppressed_at_turn !== null ? { suppressedAtTurn: r.suppressed_at_turn } : {}),
      };
    }

    // Legal
    const claimRows = await vdb.legal_claims.where('campaign_id').equals(campaignId).toArray();
    const docRows = await vdb.player_documents.where('campaign_id').equals(campaignId).toArray();
    const legalStatus: LegalStatus = {
      knownClaims: claimRows.map((c) => ({
        id: stripStamp(campaignId, c.id),
        claimant: c.claimant,
        subject: c.subject,
        basis: c.basis,
        validity: c.validity,
        ...(c.resolved_by !== null ? { resolvedBy: c.resolved_by } : {}),
        ...(c.resolved_turn !== null ? { resolvedTurn: c.resolved_turn } : {}),
      })),
      playerDocuments: docRows.map((d) => d.name),
    };

    // World rules / tags / scenarios / trauma
    const ruleRows = await vdb.world_rules.where('campaign_id').equals(campaignId).toArray();
    const tagRowsW = await vdb.world_tags.where('campaign_id').equals(campaignId).toArray();
    const scenRows = await vdb.scenarios.where('campaign_id').equals(campaignId).toArray();
    const traumaRow = await vdb.trauma_state.get(campaignId);

    // Registries
    const usedNameRows = await vdb.used_names.where('campaign_id').equals(campaignId).toArray();
    const bannedNameRows = await vdb.banned_name_map.where('campaign_id').equals(campaignId).toArray();
    const bannedMechanismRows = await vdb.banned_mechanisms.where('campaign_id').equals(campaignId).toArray();

    const bannedNameMap: Record<string, string> = {};
    for (const r of bannedNameRows) bannedNameMap[r.display_name] = r.canonical_name;

    // Generated images
    const imageUseRows = await vdb.image_uses.where('owner_id').equals(campaignId).toArray();
    const generatedImages = imageUseRows
      .filter((r) => r.owner_kind === 'generated_image')
      .map((r) => r.image_id);

    if (!ws) return undefined;

    const world: GameWorld = {
      currentModel: ws.current_model,
      memory,
      lore,
      generatedImages,
      isGeneratingVisual: fromB(ws.is_generating_visual),
      isGeneratingScenarios: fromB(ws.is_generating_scenarios),
      scenarios: scenRows.map((s) => ({
        title: s.title,
        description: s.description,
        opening_line: s.opening_line,
      })),
      failedModels: ws.failed_models ?? [],
      hiddenRegistry: ws.hidden_registry,
      pregnancies,
      activeThreats,
      knownEntities,
      bannedNameMap,
      sceneMode: ws.scene_mode,
      tensionLevel: ws.tension_level,
      time: recomputeWorldTime(ws.world_time_total_minutes, ws.world_time_display),
      lastWorldTickTurn: ws.last_world_tick_turn,
      turnCount: ws.turn_count,
      lastBargainTurn: ws.last_bargain_turn,
      factionIntelligence,
      legalStatus,
      dormantHooks,
      factionExposure,
      emergingThreats,
      ...(ws.visual_url !== null ? { visualUrl: ws.visual_url } : {}),
      ...(ws.environment !== null ? { environment: ws.environment } : {}),
      ...(Object.keys(threatArcHistory).length ? { threatArcHistory } : {}),
      ...(locationGraph ? { locationGraph } : {}),
      ...(Object.keys(threatDenialTracker).length ? { threatDenialTracker } : {}),
      ...(ws.threat_cooldown_until_turn !== null
        ? { threatCooldownUntilTurn: ws.threat_cooldown_until_turn }
        : {}),
      ...(ws.last_threat_arc_end_turn !== null
        ? { lastThreatArcEndTurn: ws.last_threat_arc_end_turn }
        : {}),
      sessionDenialCount: ws.session_denial_count,
      ...(ws.passive_allies_detected ? { passiveAlliesDetected: true } : {}),
      ...(ws.player_location_text !== null ? { location: ws.player_location_text } : {}),
      ...(usedNameRows.length
        ? { usedNameRegistry: usedNameRows.map((r) => r.original_display) }
        : {}),
      ...(traumaRow?.active_effect ? { activeTraumaEffect: traumaRow.active_effect } : {}),
      ...(traumaRow?.last_effect_turn !== null && traumaRow?.last_effect_turn !== undefined
        ? { lastTraumaEffectTurn: traumaRow.last_effect_turn }
        : {}),
      ...(factions.length ? { factions } : {}),
      ...(factionConflicts.length ? { factionConflicts } : {}),
      ...(ruleRows.length ? { worldRules: ruleRows.map((r) => r.rule) } : {}),
      ...(camp.world_seed_id ? { worldSeedId: camp.world_seed_id } : {}),
      ...(tagRowsW.length ? { worldTags: tagRowsW.map((t) => t.tag) } : {}),
      ...(bannedMechanismRows.length
        ? { bannedMechanisms: bannedMechanismRows.map((r) => r.keywords) }
        : {}),
    };

    const save: GameSave = {
      id: camp.id,
      name: camp.name,
      timestamp: camp.updated_at,
      gameState: { history: gameHistory, world },
      character,
      ...(camp.thumbnail_image_id ? { thumbnail: camp.thumbnail_image_id } : {}),
    };
    return save;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// deleteCampaignRows — internal helper used by absorb to make absorbs
// idempotent. Wipes every per-campaign row before re-writing.
// ────────────────────────────────────────────────────────────────────────────
async function deleteCampaignRows(cid: SaveId): Promise<void> {
  const where = (tableName: string, key: string) =>
    vdb.table(tableName).where(key).equals(cid).delete();

  // Delete child-of-entity tables first (FK-ish ordering, even though we
  // don't enforce FKs).
  await vdb.entity_ledger_items.where('campaign_id').equals(cid).delete();
  await vdb.memory_tags
    .where('memory_id')
    .anyOf(
      (await vdb.memories.where('campaign_id').equals(cid).primaryKeys()) as string[]
    )
    .delete();
  await vdb.threat_entity_sources.where('campaign_id').equals(cid).delete();
  await vdb.dormant_hook_entities.where('campaign_id').equals(cid).delete();
  await vdb.faction_known_actions.where('campaign_id').equals(cid).delete();
  await vdb.faction_player_standing.where('campaign_id').equals(cid).delete();
  await vdb.faction_dispositions.where('campaign_id').equals(cid).delete();
  await vdb.faction_memberships.where('campaign_id').equals(cid).delete();
  await vdb.faction_resources.where('campaign_id').equals(cid).delete();
  await vdb.faction_territories.where('campaign_id').equals(cid).delete();

  await Promise.all(
    [
      'campaigns',
      'characters',
      'character_inventory',
      'character_conditions',
      'character_goals',
      'character_relationships_text',
      'character_skills',
      'turns',
      'messages',
      'summary_segments',
      'roll_log',
      'roll_stats',
      'debug_log',
      'memories',
      'lore',
      'entities',
      'entity_relationships',
      'pregnancies',
      'locations',
      'location_edges',
      'factions',
      'faction_exposure',
      'faction_intelligence',
      'faction_conflicts',
      'dormant_hooks',
      'threats',
      'threat_arc_history',
      'threat_denial_tracker',
      'legal_claims',
      'player_documents',
      'world_state',
      'world_rules',
      'world_tags',
      'scenarios',
      'trauma_state',
      'used_names',
      'banned_name_map',
      'banned_mechanisms',
    ].map((t) => where(t, t === 'campaigns' ? 'id' : 'campaign_id'))
  );

  // image_uses: delete only the rows owned by this campaign.
  await vdb.image_uses.where('owner_id').equals(cid).delete();
}

export async function deleteCampaignAndRows(cid: SaveId): Promise<void> {
  await vdb.transaction('rw', ALL_TABLES.map((t) => vdb.table(t)), async () => {
    await deleteCampaignRows(cid);
  });
}
