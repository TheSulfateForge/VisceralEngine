// ============================================================================
// db/schema.ts — Dexie schema for the normalized Visceral Engine DB.
//
// Phase 1 of the migration. See PHASE0_SCHEMA.md for the design rationale and
// table-by-table description.
//
// This module owns the Dexie instance. Repos in db/repos/* are the only other
// callers of these tables; all higher-level code goes through repos or the
// projection layer (db/projection.ts).
// ============================================================================
import Dexie, { Table } from 'dexie';
import type {
  SaveId,
  MessageId,
  LoreId,
  MemoryId,
  TemplateId,
  WorldSeedId,
  RelationshipLevel,
  EntityStatus,
  HookCategory,
  HookStatus,
  EnemyArchetype,
  EnemyState,
  CoverState,
  Distance,
  ThreatStatus,
  SkillCategory,
  ProficiencyLevel,
  PregnancyStatus,
  ClaimValidity,
  FactionDisposition,
  FactionResource,
  RollOutcome,
  SceneMode,
  Role,
  CombatEnvironment,
  TraumaEffect,
  WorldSeed,
  Character,
  RollRequest,
  BargainRequest,
  NPCInteraction,
  WorldTick,
  BioMonitor,
} from '../types';

// ────────────────────────────────────────────────────────────────────────────
// Row types — one per table.
// These are the on-disk shapes. Repos translate them to/from the runtime types
// declared in ../types.
// ────────────────────────────────────────────────────────────────────────────

// 4.1 — campaigns
export interface CampaignRow {
  id: SaveId;
  name: string;
  created_at: string;        // ISO
  updated_at: string;        // ISO
  last_played_turn: number;
  world_seed_id: WorldSeedId | null;
  thumbnail_image_id: string | null;
  schema_version: number;
}

// 4.2 — characters (1:1 with campaign)
export interface CharacterRow {
  campaign_id: SaveId;
  name: string;
  gender: string;
  race: string;
  setting: string;
  appearance: string;
  notable_features: string;
  backstory: string;
  hidden_notes: string | null;
  trauma: number;
  bio: BioMonitor;                                       // JSON
  condition_timestamps: Record<string, number> | null;   // JSON
  languages_known: string[] | null;                      // JSON
}

export interface CharacterInventoryRow {
  id: string;                  // uuid
  campaign_id: SaveId;
  item: string;
  acquired_turn: number;
}

export interface CharacterConditionRow {
  id: string;
  campaign_id: SaveId;
  condition: string;
  applied_turn: number;
  applied_at: number | null;   // wall-clock
}

export interface CharacterGoalRow {
  id: string;
  campaign_id: SaveId;
  goal: string;
  created_turn: number;
  status: 'active' | 'achieved' | 'abandoned';
}

export interface CharacterRelationshipTextRow {
  id: string;
  campaign_id: SaveId;
  text: string;
  created_turn: number;
}

export interface CharacterSkillRow {
  id: string;
  campaign_id: SaveId;
  name: string;
  category: SkillCategory;
  level: ProficiencyLevel;
  source: string;
  usage_count: number;
  last_used_turn: number | null;
}

// 4.3 — turn history
export interface TurnRow {
  id: string;                          // `${campaign_id}:t${turn_number}`
  campaign_id: SaveId;
  turn_number: number;
  started_at: string;
  ended_at: string | null;
  scene_mode_at_end: SceneMode;
  tension_level_at_end: number;
  world_minutes_at_end: number;
}

export interface MessageRow {
  id: MessageId;
  campaign_id: SaveId;
  turn_number: number;
  role: Role;
  text: string;
  timestamp: string;
  is_resolved: boolean | null;
  roll_request: RollRequest | null;
  bargain_request: BargainRequest | null;
  npc_interaction: NPCInteraction | null;
  world_tick: WorldTick | null;
  metadata: Record<string, unknown> | null;
}

export interface SummarySegmentRow {
  id: string;
  campaign_id: SaveId;
  start_turn: number;
  end_turn: number;
  summary: string;
  timestamp: string;
}

export interface RollLogRow {
  id: string;
  campaign_id: SaveId;
  turn_number: number;
  entry: string;
  outcome: RollOutcome | null;
}

export interface RollStatsRow {
  campaign_id: SaveId;
  total_rolls: number;
  critical_successes: number;
  critical_failures: number;
  average_roll: number;
  outcomes: Record<RollOutcome, number>;
}

export interface DebugLogRow {
  id: string;
  campaign_id: SaveId;
  turn_number: number;
  timestamp: string;
  message: string;
  level: 'info' | 'error' | 'success' | 'warning';
}

// 4.4 — memory & lore
export interface MemoryRow {
  id: MemoryId;
  campaign_id: SaveId;
  fact: string;
  salience: number;
  turn_created: number;
  timestamp: string;
  is_pinned: number;       // 0/1 — Dexie indexes booleans poorly, store as int
}

export interface MemoryTagRow {
  memory_id: MemoryId;
  tag: string;
}

export interface LoreRow {
  id: LoreId;
  campaign_id: SaveId;
  keyword: string;
  content: string;
  timestamp: string;
  turn_created: number | null;
  semantic_update_of: LoreId | null;
}

// 4.5 — entities & relationships
export interface EntityRow {
  id: string;                          // npc_{normalized_name}
  campaign_id: SaveId;
  name: string;
  role: string;
  current_location_id: string | null;
  current_location_text: string | null;
  impression: string;
  /**
   * Canonical personality descriptors (traits, quirks, beliefs, habits).
   * Sourced from the World Seed for named seed NPCs. Surfaced in the
   * per-turn prompt as its own field so the model anchors characterization
   * here rather than defaulting from system-prompt threat language.
   * Non-indexed (we never query by it), so no schema version bump is
   * needed when it lands — Dexie persists arbitrary row fields.
   */
  personality: string | null;
  relationship_level: RelationshipLevel;
  leverage: string;
  status: EntityStatus;
  first_seen_turn: number | null;
  last_seen_turn: number | null;
  status_changed_turn: number | null;
  exit_reason: string | null;
}

export interface EntityLedgerRow {
  id: string;
  entity_id: string;
  campaign_id: SaveId;
  text: string;
  recorded_turn: number;
}

export type EntityRelationshipKind = 'entity' | 'faction' | 'player';
export interface EntityRelationshipRow {
  id: string;
  campaign_id: SaveId;
  source_id: string;
  source_kind: EntityRelationshipKind;
  target_id: string;
  target_kind: EntityRelationshipKind;
  relation_type: string;
  strength: number;
  visibility: 'open' | 'rumored' | 'secret';
  evidence: string | null;
  first_seen_turn: number;
  last_updated_turn: number;
  is_active: number;        // 0/1
  is_symmetric: number;     // 0/1
}

export interface PregnancyRow {
  id: string;
  campaign_id: SaveId;
  mother_entity_id: string | null;
  mother_is_player: number;
  mother_name_legacy: string;     // kept for round-trip until full ID resolution lands
  father_entity_id: string | null;
  father_is_player: number;
  father_unknown: number;
  father_name_legacy: string;
  conception_turn: number;
  conception_time: number;
  current_week: number;
  is_visible: number;
  status: PregnancyStatus;
}

// 4.6 — locations
export interface LocationRow {
  id: string;
  campaign_id: SaveId;
  display_name: string;
  description: string | null;
  first_mentioned_turn: number;
  tags: string[];                                        // JSON
}

export interface LocationEdgeRow {
  id: string;
  campaign_id: SaveId;
  from_id: string;
  to_id: string;
  travel_time_minutes: number;
  source: 'ai_declared' | 'inferred_from_narrative' | 'player_travel';
  created_turn: number;
  mode_overrides: Record<string, number> | null;
}

// 4.7 — factions
export interface FactionRow {
  id: string;
  campaign_id: SaveId;
  name: string;
  description: string;
  influence: number;
  leader_entity_id: string | null;
  leader_name_legacy: string | null;          // pre-resolution fallback
  active_objective: string | null;
}

export interface FactionTerritoryRow {
  faction_id: string;
  location_id: string;
  campaign_id: SaveId;
  claimed_turn: number;
}

export interface FactionResourceRow {
  faction_id: string;
  resource: FactionResource;
  campaign_id: SaveId;
}

export interface FactionMembershipRow {
  faction_id: string;
  entity_id: string;
  campaign_id: SaveId;
  joined_turn: number;
  role_in_faction: string | null;
}

export interface FactionDispositionRow {
  from_faction_id: string;
  to_faction_id: string;
  campaign_id: SaveId;
  disposition: FactionDisposition;
  last_updated_turn: number;
}

export interface FactionPlayerStandingRow {
  faction_id: string;
  campaign_id: SaveId;
  reputation: number;
  rank: string | null;
}

export interface FactionKnownActionRow {
  id: string;
  faction_id: string;
  campaign_id: SaveId;
  action: string;
  recorded_turn: number;
}

export type ExposureSubjectKind = 'faction' | 'entity';
export interface FactionExposureRow {
  id: string;
  campaign_id: SaveId;
  subject_id: string;
  subject_kind: ExposureSubjectKind;
  subject_name_legacy: string;            // pre-resolution fallback
  exposure_score: number;
  last_observed_action: string | null;
  last_observed_turn: number;
  observed_capabilities: string[];        // JSON
}

export interface FactionIntelligenceRow {
  id: string;
  campaign_id: SaveId;
  subject_id: string;
  subject_kind: ExposureSubjectKind;
  subject_name_legacy: string;
  known_player_location: string | null;
  location_confidence: 'none' | 'rumor' | 'report' | 'confirmed';
  last_updated_turn: number;
  information_source: string;
}

export interface FactionConflictRow {
  id: string;
  campaign_id: SaveId;
  aggressor_id: string;
  defender_id: string;
  type: 'skirmish' | 'trade_war' | 'territory_dispute' | 'full_war' | 'cold_war';
  start_turn: number;
  stakes: string;
  momentum: number;
  last_escalation_turn: number;
  player_involvement: 'none' | 'observer' | 'participant' | 'catalyst';
  is_active: number;
}

// 4.8 — threats and dormant hooks
export interface DormantHookRow {
  id: string;
  campaign_id: SaveId;
  summary: string;
  category: HookCategory;
  source_field: string;
  activation_conditions: string;
  status: HookStatus;
  activated_turn: number | null;
  resolved_turn: number | null;
  cooldown_until_turn: number | null;
  last_threat_expired_turn: number | null;
  total_threats_sourced: number;
}

export interface DormantHookEntityRow {
  hook_id: string;
  entity_name_normalized: string;
  campaign_id: SaveId;
  resolved_entity_id: string | null;
}

export interface ThreatRow {
  id: string;
  campaign_id: SaveId;
  kind: 'active' | 'emerging';
  // active fields
  name: string | null;
  archetype: EnemyArchetype | null;
  enemy_state: EnemyState | null;
  condition: string | null;
  current_action: string | null;
  cover_state: CoverState | null;
  distance: Distance | null;
  // emerging fields
  description: string | null;
  turns_until_impact: number | null;
  faction_source: string | null;
  origin_hook_id: string | null;
  dormant_hook_id_at_creation: string | null;
  player_action_cause: string | null;
  status: ThreatStatus | null;
  turn_created: number | null;
  original_eta: number | null;
  minimum_eta_floor: number | null;
  consecutive_turns_at_eta_one: number | null;
  required_lore_capability: string | null;
  pivot_penalty_applied: number | null;
}

export interface ThreatEntitySourceRow {
  threat_id: string;
  entity_name_normalized: string;
  campaign_id: SaveId;
}

export interface ThreatArcHistoryRow {
  id: string;
  campaign_id: SaveId;
  bucket: string;                       // hookId | 'playerAction' | 'factionExposure'
  entity_names: string[];               // JSON
  expired_turn: number;
  description_snippet: string;
}

export interface ThreatDenialRow {
  id: string;
  campaign_id: SaveId;
  entity_name_fragment_normalized: string;
  denial_count: number;
  last_denied_turn: number;
  suppressed_at_turn: number | null;
}

// 4.9 — legal
export interface LegalClaimRow {
  id: string;
  campaign_id: SaveId;
  claimant: string;
  subject: string;
  basis: string;
  validity: ClaimValidity;
  resolved_by: string | null;
  resolved_turn: number | null;
}

export interface PlayerDocumentRow {
  id: string;
  campaign_id: SaveId;
  name: string;
  acquired_turn: number | null;
}

// 4.10 — world singleton
export interface WorldStateRow {
  campaign_id: SaveId;
  current_model: string;
  scene_mode: SceneMode;
  tension_level: number;
  world_time_total_minutes: number;
  world_time_display: string;
  turn_count: number;
  last_world_tick_turn: number;
  last_bargain_turn: number;
  last_threat_arc_end_turn: number | null;
  threat_cooldown_until_turn: number | null;
  session_denial_count: number;
  passive_allies_detected: number;     // 0/1
  player_location_id: string | null;
  player_location_text: string | null;
  hidden_registry: string;
  visual_url: string | null;
  is_generating_visual: number;
  is_generating_scenarios: number;
  is_thinking: number;
  failed_models: string[];
  environment: CombatEnvironment | null;
  last_active_summary: string | null;  // deprecated, kept for round-trip
}

export interface WorldRuleRow {
  id: string;
  campaign_id: SaveId;
  rule: string;
  source: 'world_seed' | 'gameplay';
}

export interface WorldTagRow {
  campaign_id: SaveId;
  tag: string;
}

export interface ScenarioRow {
  id: string;
  campaign_id: SaveId;
  title: string;
  description: string;
  opening_line: string;
}

export interface TraumaStateRow {
  campaign_id: SaveId;
  active_effect: TraumaEffect | null;
  last_effect_turn: number | null;
}

// 4.11 — banned/used registries
export interface UsedNameRow {
  campaign_id: SaveId;
  name_normalized: string;
  original_display: string;
  first_used_turn: number;
  entity_id: string | null;
}

export interface BannedNameMapRow {
  campaign_id: SaveId;
  display_name: string;
  canonical_name: string;
}

export interface BannedMechanismRow {
  id: string;
  campaign_id: SaveId;
  keywords: string[];
  banned_turn: number;
}

// 4.12 — reference data
export interface WorldSeedRow {
  id: WorldSeedId;
  name: string;
  description: string;
  timestamp: string;
  last_modified: string;
  tags: string[];
  thumbnail_image_id: string | null;
  payload: WorldSeed;       // full seed; we don't normalize templates
}

export interface CharacterTemplateRow {
  id: TemplateId;
  name: string;
  timestamp: string;
  payload: Omit<Character, 'bio' | 'trauma' | 'hiddenNotes'>;
}

export interface ImageRow {
  id: string;
  blob: Blob;
  created_at: string;
}

export type ImageOwnerKind =
  | 'campaign_thumbnail'
  | 'world_seed_thumbnail'
  | 'generated_image';
export interface ImageUseRow {
  image_id: string;
  owner_kind: ImageOwnerKind;
  owner_id: string;
}

// 4.13 — embeddings (Phase 2 lands in this table)
export type EmbeddingOwnerKind =
  | 'memory'
  | 'lore'
  | 'entity'
  | 'summary_segment'
  | 'location'
  | 'world_rule'
  | 'message';

export interface EmbeddingRow {
  id: string;
  campaign_id: SaveId;
  owner_kind: EmbeddingOwnerKind;
  owner_id: string;
  text_hash: string;
  vector: Float32Array;
  dim: number;
  model_id: string;
  created_turn: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Database
// ────────────────────────────────────────────────────────────────────────────

export class VisceralDB extends Dexie {
  // Campaign root + character
  campaigns!: Table<CampaignRow, SaveId>;
  characters!: Table<CharacterRow, SaveId>;
  character_inventory!: Table<CharacterInventoryRow, string>;
  character_conditions!: Table<CharacterConditionRow, string>;
  character_goals!: Table<CharacterGoalRow, string>;
  character_relationships_text!: Table<CharacterRelationshipTextRow, string>;
  character_skills!: Table<CharacterSkillRow, string>;

  // Turn history
  turns!: Table<TurnRow, string>;
  messages!: Table<MessageRow, MessageId>;
  summary_segments!: Table<SummarySegmentRow, string>;
  roll_log!: Table<RollLogRow, string>;
  roll_stats!: Table<RollStatsRow, SaveId>;
  debug_log!: Table<DebugLogRow, string>;

  // Memory & lore
  memories!: Table<MemoryRow, MemoryId>;
  memory_tags!: Table<MemoryTagRow, [MemoryId, string]>;
  lore!: Table<LoreRow, LoreId>;

  // Entities
  entities!: Table<EntityRow, string>;
  entity_ledger_items!: Table<EntityLedgerRow, string>;
  entity_relationships!: Table<EntityRelationshipRow, string>;
  pregnancies!: Table<PregnancyRow, string>;

  // Locations
  locations!: Table<LocationRow, string>;
  location_edges!: Table<LocationEdgeRow, string>;

  // Factions
  factions!: Table<FactionRow, string>;
  faction_territories!: Table<FactionTerritoryRow, [string, string]>;
  faction_resources!: Table<FactionResourceRow, [string, FactionResource]>;
  faction_memberships!: Table<FactionMembershipRow, [string, string]>;
  faction_dispositions!: Table<FactionDispositionRow, [string, string]>;
  faction_player_standing!: Table<FactionPlayerStandingRow, string>;
  faction_known_actions!: Table<FactionKnownActionRow, string>;
  faction_exposure!: Table<FactionExposureRow, string>;
  faction_intelligence!: Table<FactionIntelligenceRow, string>;
  faction_conflicts!: Table<FactionConflictRow, string>;

  // Threats
  dormant_hooks!: Table<DormantHookRow, string>;
  dormant_hook_entities!: Table<DormantHookEntityRow, [string, string]>;
  threats!: Table<ThreatRow, string>;
  threat_entity_sources!: Table<ThreatEntitySourceRow, [string, string]>;
  threat_arc_history!: Table<ThreatArcHistoryRow, string>;
  threat_denial_tracker!: Table<ThreatDenialRow, string>;

  // Legal
  legal_claims!: Table<LegalClaimRow, string>;
  player_documents!: Table<PlayerDocumentRow, string>;

  // World singleton
  world_state!: Table<WorldStateRow, SaveId>;
  world_rules!: Table<WorldRuleRow, string>;
  world_tags!: Table<WorldTagRow, [SaveId, string]>;
  scenarios!: Table<ScenarioRow, string>;
  trauma_state!: Table<TraumaStateRow, SaveId>;

  // Registries
  used_names!: Table<UsedNameRow, [SaveId, string]>;
  banned_name_map!: Table<BannedNameMapRow, [SaveId, string]>;
  banned_mechanisms!: Table<BannedMechanismRow, string>;

  // Reference
  world_seeds!: Table<WorldSeedRow, WorldSeedId>;
  character_templates!: Table<CharacterTemplateRow, TemplateId>;
  images!: Table<ImageRow, string>;
  image_uses!: Table<ImageUseRow, [string, ImageOwnerKind, string]>;

  // Embeddings
  embeddings!: Table<EmbeddingRow, string>;

  constructor() {
    // New DB name. Old DB ('VisceralEngineDB') stays untouched until the
    // migration step copies it across.
    super('VisceralEngineDB_v2');

    this.version(1).stores({
      // 4.1
      campaigns: '&id, &name, updated_at, world_seed_id',

      // 4.2
      characters: '&campaign_id, name',
      character_inventory: '&id, campaign_id, [campaign_id+item]',
      character_conditions: '&id, campaign_id, [campaign_id+condition]',
      character_goals: '&id, campaign_id, [campaign_id+status]',
      character_relationships_text: '&id, campaign_id',
      character_skills: '&id, campaign_id, [campaign_id+name], [campaign_id+category], last_used_turn',

      // 4.3
      turns: '&id, [campaign_id+turn_number]',
      messages: '&id, [campaign_id+turn_number], [campaign_id+role], timestamp',
      summary_segments: '&id, [campaign_id+end_turn], start_turn',
      roll_log: '&id, [campaign_id+turn_number], outcome',
      roll_stats: '&campaign_id',
      debug_log: '&id, [campaign_id+turn_number], level',

      // 4.4
      memories: '&id, campaign_id, salience, turn_created, is_pinned',
      memory_tags: '[memory_id+tag], tag, memory_id',
      lore: '&id, campaign_id, [campaign_id+keyword], turn_created, semantic_update_of',

      // 4.5
      entities: '&id, campaign_id, [campaign_id+name], [campaign_id+status], [campaign_id+current_location_id], last_seen_turn',
      entity_ledger_items: '&id, entity_id, [entity_id+recorded_turn]',
      entity_relationships:
        '&id, campaign_id, [campaign_id+source_id], [campaign_id+target_id], [source_id+target_id], relation_type',
      pregnancies: '&id, campaign_id, [campaign_id+status], mother_entity_id, father_entity_id',

      // 4.6
      locations: '&id, campaign_id, [campaign_id+display_name]',
      location_edges: '&id, campaign_id, [from_id+to_id], from_id, to_id',

      // 4.7
      factions: '&id, campaign_id, [campaign_id+name], influence',
      faction_territories: '[faction_id+location_id], faction_id, location_id, campaign_id',
      faction_resources: '[faction_id+resource], faction_id, campaign_id',
      faction_memberships: '[faction_id+entity_id], faction_id, entity_id, campaign_id',
      faction_dispositions:
        '[from_faction_id+to_faction_id], from_faction_id, to_faction_id, disposition, campaign_id',
      faction_player_standing: '&faction_id, campaign_id, reputation',
      faction_known_actions: '&id, faction_id, [faction_id+recorded_turn]',
      faction_exposure: '&id, campaign_id, [campaign_id+subject_id], exposure_score, last_observed_turn',
      faction_intelligence: '&id, campaign_id, [campaign_id+subject_id], location_confidence',
      faction_conflicts:
        '&id, campaign_id, [campaign_id+is_active], aggressor_id, defender_id, last_escalation_turn',

      // 4.8
      dormant_hooks: '&id, campaign_id, [campaign_id+status], cooldown_until_turn',
      dormant_hook_entities:
        '[hook_id+entity_name_normalized], hook_id, entity_name_normalized, resolved_entity_id, campaign_id',
      threats:
        '&id, campaign_id, [campaign_id+kind], [campaign_id+status], faction_source, origin_hook_id, turn_created',
      threat_entity_sources:
        '[threat_id+entity_name_normalized], threat_id, entity_name_normalized, campaign_id',
      threat_arc_history: '&id, campaign_id, [campaign_id+bucket], expired_turn',
      threat_denial_tracker:
        '&id, campaign_id, [campaign_id+entity_name_fragment_normalized], suppressed_at_turn',

      // 4.9
      legal_claims: '&id, campaign_id, [campaign_id+validity], resolved_turn',
      player_documents: '&id, campaign_id',

      // 4.10
      world_state: '&campaign_id, scene_mode, turn_count',
      world_rules: '&id, campaign_id, source',
      world_tags: '[campaign_id+tag], campaign_id, tag',
      scenarios: '&id, campaign_id',
      trauma_state: '&campaign_id',

      // 4.11
      used_names: '[campaign_id+name_normalized], campaign_id, entity_id',
      banned_name_map: '[campaign_id+display_name], canonical_name, campaign_id',
      banned_mechanisms: '&id, campaign_id',

      // 4.12
      world_seeds: '&id, &name, last_modified',
      character_templates: '&id, &name, timestamp',
      images: '&id, created_at',
      image_uses: '[image_id+owner_kind+owner_id], image_id, owner_id',

      // 4.13
      embeddings:
        '&id, campaign_id, [campaign_id+owner_kind], [owner_kind+owner_id], model_id, text_hash',
    });

    // ─── v2 ─────────────────────────────────────────────────────────────
    // Adds the campaign_id index on `entity_ledger_items` and
    // `faction_known_actions`. `db/projection.ts` deletes rows from these
    // tables via `where('campaign_id').equals(cid)`; under v1 those queries
    // throw `KeyPath campaign_id ... is not indexed`, which broke saveGame
    // (and therefore autosave) silently.
    //
    // Only the two changed tables are listed here; every other table
    // inherits its v1 schema unchanged. Dexie handles the upgrade
    // automatically the next time the DB is opened — no data migration
    // needed because indexes are derivable from existing rows.
    this.version(2).stores({
      entity_ledger_items: '&id, entity_id, [entity_id+recorded_turn], campaign_id',
      faction_known_actions: '&id, faction_id, [faction_id+recorded_turn], campaign_id',
    });
  }
}

export const vdb = new VisceralDB();

// Convenience for callers that need to wipe the DB during testing.
export async function deleteVisceralDB(): Promise<void> {
  await vdb.delete();
}
