import type {
  WorldSeedLocation,
  WorldSeedFaction,
  WorldSeedLore,
  WorldSeedNPC,
  WorldSeedRule
} from '../types';
import { GeminiService } from '../geminiService';
import { WORLD_DECOMPOSITION_SCHEMA } from '../schemas/worldSchema';
import { GEMINI_SAFETY_SETTINGS } from '../constants';

/* ────────────────────────────────────────────────────────────────────────────
 * Constants
 * ──────────────────────────────────────────────────────────────────────────── */

/** Word-count threshold: seeds above this use multi-pass extraction. */
const MULTI_PASS_WORD_THRESHOLD = 1500;

/** Max output tokens for decomposition calls — must be generous for large seeds. */
const DECOMPOSE_MAX_OUTPUT_TOKENS = 65536;

/** Max output tokens for expand calls. */
const EXPAND_MAX_OUTPUT_TOKENS = 65536;

/* ────────────────────────────────────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────────────────────────────────────── */

interface DecompositionResult {
  locations: WorldSeedLocation[];
  factions: WorldSeedFaction[];
  lore: WorldSeedLore[];
  npcs: WorldSeedNPC[];
  rules: WorldSeedRule[];
  tags: string[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Prompts
 * ──────────────────────────────────────────────────────────────────────────── */

const SYSTEM_INSTRUCTION_DECOMPOSE =
  "You are a precise extraction engine. Faithfully decompose world descriptions into structured JSON. " +
  "Prefer granularity over compression — every distinct concept, faction, rule, and mechanic in the " +
  "source MUST appear as its own entry. Never summarize multiple topics into one entry. Output only valid JSON.";

const SYSTEM_INSTRUCTION_EXPAND =
  "You are a precise world-building assistant. Merge new content into existing world data without " +
  "duplicating entries. Update existing entries when new detail is provided. Output only valid JSON.";

function buildDecomposePrompt(description: string): string {
  return `You are a world-building extraction engine. Your job is to faithfully decompose a world description into structured data for a retrieval-augmented generation (RAG) database.

WORLD DESCRIPTION:
${description}

EXTRACTION RULES:
- Extract ALL explicitly stated information. Do not omit, merge, or compress details that are distinct in the source.
- Each lore entry must cover exactly ONE distinct concept. Never combine multiple topics (e.g., six magic types) into a single entry — each gets its own entry.
- Each lore keyword must be unique and specific enough to distinguish it from every other entry (e.g., "Fire Magic" not "Magic Types", "Hucow Biology" not "Races").
- Lore content should be 1-3 sentences of concrete, retrievable detail — not vague summaries.
- Extract ALL factions/powers/nations described. Do not cap at an arbitrary number.
- Extract ALL mechanical rules described (magic systems, restrictions, laws, policies, dungeon mechanics, tracking/communication limits, biological traits) — each as its own entry.
- Extract ALL races/species with their unique traits, abilities, and limitations as separate lore entries.
- Lore categories are freeform — use whatever category best fits the content (e.g., history, geography, culture, magic, technology, religion, economy, law, biology, military, social, dungeon, combat, faction-detail, racial-trait, etc.). Do NOT force entries into ill-fitting categories.
- Location tags, travel modes, and faction resource types are freeform — use whatever terms best fit the setting described (fantasy, sci-fi, modern, or otherwise).
- Only invent details to fill structural gaps (e.g., travel times between locations, NPC personality traits) — never invent lore, factions, or rules that contradict or dilute what is explicitly described.

QUANTITY GUIDANCE (scale with input detail):
- Locations: Extract every named location. Invent connections to form a connected graph.
- Factions: Extract every named faction, power, nation, or political entity. No maximum.
- Lore: Create one entry per distinct concept. A detailed world may produce 30-80+ entries. Err heavily on the side of more granular entries rather than fewer compressed ones. If in doubt, split rather than merge.
- NPCs: 1-2 per faction minimum. Invent names and traits consistent with the faction's culture if not provided.
- Rules: Extract every stated mechanical rule, restriction, or law as its own entry. A complex world may have 10-30+ distinct rules.
- Tags: 3-10 tags describing genre, tone, and setting.

Return ONLY the JSON object, no other text.`;
}

function buildPass1Prompt(description: string): string {
  return `You are a world-building extraction engine (PASS 1 of 2: Locations, Factions, NPCs, Tags).

WORLD DESCRIPTION:
${description}

EXTRACTION RULES:
- Extract ALL locations, factions, NPCs, and world tags. This is PASS 1 — lore and rules will be extracted separately.
- Extract every named location. Invent connections to form a connected graph.
- Extract every named faction, power, nation, or political entity. No maximum. Include full detail on governance, territory, resources, and inter-faction dispositions.
- Generate 1-2 NPCs per faction minimum, with names and traits consistent with the faction's culture.
- Location tags, travel modes, and faction resource types are freeform — use whatever terms best fit the described setting.
- Only invent details to fill structural gaps — never invent content that contradicts the source.
- Leave lore and rules arrays EMPTY (they will be filled in Pass 2).

Return ONLY the JSON object, no other text.`;
}

function buildPass2Prompt(description: string, pass1Summary: string): string {
  return `You are a world-building extraction engine (PASS 2 of 2: Lore and Rules).

WORLD DESCRIPTION:
${description}

ALREADY EXTRACTED (for reference — do not duplicate these as lore):
${pass1Summary}

EXTRACTION RULES:
- This pass extracts ONLY lore entries and mechanical rules. Leave locations, factions, npcs, and tags as empty arrays.
- Each lore entry must cover exactly ONE distinct concept. Never combine multiple topics into a single entry.
- Each lore keyword must be unique and specific enough to distinguish it from every other entry.
- Lore content should be 1-3 sentences of concrete, retrievable detail — not vague summaries.
- Lore categories are freeform — use whatever category best fits (history, geography, culture, magic, technology, religion, economy, law, biology, military, social, dungeon, combat, faction-detail, racial-trait, etc.).
- Extract ALL mechanical rules, restrictions, laws, policies, dungeon mechanics, biological traits — each as its own rule entry.
- Extract ALL races/species with their unique traits as separate lore entries.
- Extract ALL magic types/elements/systems as separate lore entries (not one combined entry).
- Extract ALL dungeon mechanics, trap types, loot systems, monster behaviors as separate entries.
- Extract ALL legal systems, treaties, social structures as separate entries.

QUANTITY GUIDANCE:
- Lore: A detailed world should produce 30-80+ entries. Err heavily on the side of more granular entries. If you can split an entry into two distinct concepts, do it.
- Rules: Extract every stated mechanical rule as its own entry. A complex world may have 10-30+ distinct rules.

Return ONLY the JSON object (with empty locations, factions, npcs, tags arrays), no other text.`;
}

function buildExpandPrompt(existingContext: string, additionalDescription: string): string {
  return `You are a world-building AI. Expand this existing world with new content.

EXISTING WORLD DATA:
${existingContext}

ADDITIONAL DESCRIPTION TO INTEGRATE:
${additionalDescription}

RULES:
- Merge the new content into the existing world. Return the COMPLETE updated world as a JSON object.
- Deduplicate entries — if a location/NPC/faction/lore entry already exists, update it rather than creating a duplicate.
- New lore entries must each cover exactly ONE distinct concept with a unique keyword.
- Lore categories, location tags, travel modes, and faction resources are freeform — match the setting.
- Do not remove any existing entries unless the new description explicitly contradicts them.

Return ONLY the JSON object, no other text.`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Validation helpers
 * ──────────────────────────────────────────────────────────────────────────── */

interface ValidationReport {
  factionsMissing: string[];
  loreTooFew: boolean;
  rulesTooFew: boolean;
  expectedLoreMin: number;
  actualLore: number;
  expectedRulesMin: number;
  actualRules: number;
}

/**
 * Heuristically check whether the extraction captured enough of the source material.
 * Returns a report; the caller decides whether to retry.
 */
function validateExtraction(description: string, result: DecompositionResult): ValidationReport {
  const text = description.toUpperCase();

  // Count [FACTION — ...] style headers or similar patterns
  const factionHeaders = description.match(/\[FACTION[^[\]]*\]/gi) ?? [];
  const extractedFactionNames = new Set(result.factions.map(f => f.name.toUpperCase()));
  const factionsMissing: string[] = [];
  for (const header of factionHeaders) {
    // Extract faction name from header like "[FACTION — The Verdant Compact]"
    const nameMatch = header.match(/FACTION\s*[—\-–:]\s*(.+?)\s*\]/i);
    if (nameMatch) {
      const name = nameMatch[1].trim().toUpperCase();
      const found = [...extractedFactionNames].some(
        en => en.includes(name) || name.includes(en)
      );
      if (!found) factionsMissing.push(nameMatch[1].trim());
    }
  }

  // Estimate expected lore count from word count
  const wordCount = description.split(/\s+/).length;
  const expectedLoreMin = Math.max(10, Math.floor(wordCount / 150));
  const expectedRulesMin = Math.max(3, Math.floor(wordCount / 500));

  return {
    factionsMissing,
    loreTooFew: result.lore.length < expectedLoreMin,
    rulesTooFew: result.rules.length < expectedRulesMin,
    expectedLoreMin,
    actualLore: result.lore.length,
    expectedRulesMin,
    actualRules: result.rules.length,
  };
}

function buildRetryPrompt(description: string, currentResult: DecompositionResult, report: ValidationReport): string {
  const issues: string[] = [];

  if (report.factionsMissing.length > 0) {
    issues.push(`MISSING FACTIONS — The following factions are explicitly described but were not extracted: ${report.factionsMissing.join(', ')}. Extract them now.`);
  }
  if (report.loreTooFew) {
    issues.push(`INSUFFICIENT LORE — You produced ${report.actualLore} lore entries but the source material warrants at least ${report.expectedLoreMin}. Re-read the source and extract every distinct concept you missed. Each magic type, race, dungeon mechanic, legal system, biological trait, and social structure should be its own entry.`);
  }
  if (report.rulesTooFew) {
    issues.push(`INSUFFICIENT RULES — You produced ${report.actualRules} rules but the source material warrants at least ${report.expectedRulesMin}. Extract every mechanical rule, restriction, policy, and law as a separate entry.`);
  }

  const currentFactionNames = currentResult.factions.map(f => f.name).join(', ');
  const currentLoreKeywords = currentResult.lore.map(l => l.keyword).join(', ');
  const currentRuleNames = currentResult.rules.map(r => r.name).join(', ');

  return `You are a world-building extraction engine performing a SUPPLEMENTAL PASS to capture missed content.

WORLD DESCRIPTION:
${description}

ALREADY EXTRACTED (do NOT duplicate — only add NEW entries):
- Factions: ${currentFactionNames}
- Lore keywords: ${currentLoreKeywords}
- Rules: ${currentRuleNames}

ISSUES TO FIX:
${issues.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Return a JSON object with ONLY the new/missing entries. Include empty arrays for categories that need no additions.
Return ONLY the JSON object, no other text.`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Service
 * ──────────────────────────────────────────────────────────────────────────── */

export class WorldService {
  constructor(private client: GeminiService) {}

  /**
   * Core structured-output call to Gemini using responseSchema enforcement.
   */
  private async callStructured(
    prompt: string,
    systemInstruction: string,
    temperature: number,
    maxOutputTokens: number
  ): Promise<DecompositionResult> {
    const response = await this.client.ai.models.generateContent({
      model: this.client.modelName,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: WORLD_DECOMPOSITION_SCHEMA,
        safetySettings: GEMINI_SAFETY_SETTINGS,
        temperature,
        topP: 0.90,
        topK: 30,
        maxOutputTokens,
      }
    });

    const text = response?.text?.trim() ?? '';
    if (!text) throw new Error('Empty response from model');

    const parsed = JSON.parse(text);

    return {
      locations: parsed.locations ?? [],
      factions: parsed.factions ?? [],
      lore: parsed.lore ?? [],
      npcs: parsed.npcs ?? [],
      rules: parsed.rules ?? [],
      tags: parsed.tags ?? [],
    };
  }

  /**
   * Merge two DecompositionResults, deduplicating by name/keyword.
   */
  private mergeResults(base: DecompositionResult, supplement: DecompositionResult): DecompositionResult {
    const dedupe = <T extends { name?: string; keyword?: string }>(
      existing: T[],
      incoming: T[],
      keyFn: (item: T) => string
    ): T[] => {
      const seen = new Set(existing.map(keyFn).map(k => k.toUpperCase()));
      const newItems = incoming.filter(item => !seen.has(keyFn(item).toUpperCase()));
      return [...existing, ...newItems];
    };

    return {
      locations: dedupe(base.locations, supplement.locations, l => l.name ?? ''),
      factions: dedupe(base.factions, supplement.factions, f => f.name ?? ''),
      lore: dedupe(base.lore, supplement.lore, l => l.keyword ?? ''),
      npcs: dedupe(base.npcs, supplement.npcs, n => n.name ?? ''),
      rules: dedupe(base.rules, supplement.rules, r => r.name ?? ''),
      tags: [...new Set([...base.tags, ...supplement.tags])],
    };
  }

  /**
   * Single-pass decomposition for shorter seeds.
   */
  private async singlePassDecompose(description: string): Promise<DecompositionResult> {
    const prompt = buildDecomposePrompt(description);
    return this.callStructured(
      prompt,
      SYSTEM_INSTRUCTION_DECOMPOSE,
      0.4,
      DECOMPOSE_MAX_OUTPUT_TOKENS
    );
  }

  /**
   * Multi-pass decomposition for large seeds.
   * Pass 1: Locations, Factions, NPCs, Tags
   * Pass 2: Lore, Rules
   * Then merged.
   */
  private async multiPassDecompose(description: string): Promise<DecompositionResult> {
    console.log('[WorldService] Large seed detected — using multi-pass extraction');

    // Pass 1: Locations, Factions, NPCs, Tags
    const pass1Prompt = buildPass1Prompt(description);
    const pass1 = await this.callStructured(
      pass1Prompt,
      SYSTEM_INSTRUCTION_DECOMPOSE,
      0.4,
      DECOMPOSE_MAX_OUTPUT_TOKENS
    );

    // Build a summary of pass1 for pass2 context
    const pass1Summary = [
      `Locations: ${pass1.locations.map(l => l.name).join(', ')}`,
      `Factions: ${pass1.factions.map(f => f.name).join(', ')}`,
      `NPCs: ${pass1.npcs.map(n => n.name).join(', ')}`,
    ].join('\n');

    // Pass 2: Lore, Rules
    const pass2Prompt = buildPass2Prompt(description, pass1Summary);
    const pass2 = await this.callStructured(
      pass2Prompt,
      SYSTEM_INSTRUCTION_DECOMPOSE,
      0.4,
      DECOMPOSE_MAX_OUTPUT_TOKENS
    );

    // Merge: take structure from pass1, lore+rules from pass2
    return {
      locations: pass1.locations,
      factions: pass1.factions,
      npcs: pass1.npcs,
      tags: pass1.tags,
      lore: pass2.lore,
      rules: pass2.rules,
    };
  }

  /**
   * Validation pass: check extraction completeness and supplement if needed.
   */
  private async validateAndSupplement(
    description: string,
    result: DecompositionResult
  ): Promise<DecompositionResult> {
    const report = validateExtraction(description, result);

    const needsRetry =
      report.factionsMissing.length > 0 ||
      report.loreTooFew ||
      report.rulesTooFew;

    if (!needsRetry) {
      console.log('[WorldService] Validation passed — extraction looks complete');
      return result;
    }

    console.log('[WorldService] Validation failed — running supplemental pass:', {
      missingFactions: report.factionsMissing,
      lore: `${report.actualLore}/${report.expectedLoreMin}`,
      rules: `${report.actualRules}/${report.expectedRulesMin}`,
    });

    try {
      const retryPrompt = buildRetryPrompt(description, result, report);
      const supplement = await this.callStructured(
        retryPrompt,
        SYSTEM_INSTRUCTION_DECOMPOSE,
        0.4,
        DECOMPOSE_MAX_OUTPUT_TOKENS
      );

      const merged = this.mergeResults(result, supplement);

      console.log('[WorldService] After supplemental pass:', {
        factions: merged.factions.length,
        lore: merged.lore.length,
        rules: merged.rules.length,
      });

      return merged;
    } catch (e) {
      console.warn('[WorldService] Supplemental pass failed, returning original result:', e);
      return result;
    }
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * Public API
   * ────────────────────────────────────────────────────────────────────────── */

  async decomposeWorld(description: string): Promise<DecompositionResult> {
    try {
      const wordCount = description.split(/\s+/).length;
      const useMutliPass = wordCount > MULTI_PASS_WORD_THRESHOLD;

      console.log(`[WorldService] decomposeWorld: ${wordCount} words, mode=${useMutliPass ? 'multi-pass' : 'single-pass'}`);

      // Step 1: Extract (single or multi-pass)
      const rawResult = useMutliPass
        ? await this.multiPassDecompose(description)
        : await this.singlePassDecompose(description);

      console.log('[WorldService] Initial extraction:', {
        locations: rawResult.locations.length,
        factions: rawResult.factions.length,
        lore: rawResult.lore.length,
        npcs: rawResult.npcs.length,
        rules: rawResult.rules.length,
        tags: rawResult.tags.length,
      });

      // Step 2: Validate and supplement if under-extracted
      const finalResult = await this.validateAndSupplement(description, rawResult);

      console.log('[WorldService] Final result:', {
        locations: finalResult.locations.length,
        factions: finalResult.factions.length,
        lore: finalResult.lore.length,
        npcs: finalResult.npcs.length,
        rules: finalResult.rules.length,
        tags: finalResult.tags.length,
      });

      return finalResult;
    } catch (e) {
      console.error('[WorldService] decomposeWorld failed:', e);
      throw e;
    }
  }

  /* expandWorld uses slightly higher temperature (0.5) since merging requires more judgment */
  async expandWorld(existingData: {
    locations: any[];
    factions: any[];
    lore: any[];
    npcs: any[];
    rules: any[]
  }, additionalDescription: string): Promise<DecompositionResult> {
    try {
      const existingContext = JSON.stringify(existingData, null, 2);
      const prompt = buildExpandPrompt(existingContext, additionalDescription);

      return await this.callStructured(
        prompt,
        SYSTEM_INSTRUCTION_EXPAND,
        0.5,
        EXPAND_MAX_OUTPUT_TOKENS
      );
    } catch (e) {
      console.error('[WorldService] expandWorld failed:', e);
      throw e;
    }
  }
}
