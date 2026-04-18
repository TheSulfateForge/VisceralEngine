
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { GEMINI_SAFETY_SETTINGS, THINKING_DEFAULTS } from "../constants";
import { ChatMessage, Role, ModelResponseSchema, SCENE_MODES, SceneMode, Lighting, LIGHTING_LEVELS } from "../types";
import { RESPONSE_SCHEMA } from "../schemas/responseSchema";
import { sanitiseHistory } from '../utils/nameResolver';
import { getContextProfile } from '../config/engineConfig';
import { systemInstructionCache } from './geminiCache';
import { SYSTEM_INSTRUCTIONS } from '../systemInstructions';

const REQUEST_TIMEOUT_MS = 60000;

export class GeminiClient {
  public readonly ai: GoogleGenAI;
  public readonly modelName: string;

  constructor(apiKey: string, modelName: string) {
    if (!apiKey) throw new Error("API Key is required for GeminiClient");
    this.modelName = modelName;
    this.ai = new GoogleGenAI({ apiKey });
  }

  public async withRetry<T>(fn: () => Promise<T>, maxRetries: number = 1): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (e: unknown) {
            lastError = e;
            const errMsg = e instanceof Error ? e.message : String(e);
            // Only retry on transient server errors
            const isRetryable = errMsg.includes('503') || errMsg.includes('500') || errMsg.includes('overloaded');
            if (!isRetryable || attempt === maxRetries) throw e;
            // Exponential backoff: 2s, then 4s
            await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
        }
    }
    throw lastError;
  }

  public cleanJsonOutput(text: string): string {
    if (!text) return "{}";
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    let clean = codeBlockMatch ? codeBlockMatch[1] : text;
    clean = clean.trim();
    const firstBrace = clean.indexOf('{');
    const firstBracket = clean.indexOf('[');
    let start = -1;

    if (firstBrace !== -1 && firstBracket !== -1) {
        if (firstBracket < firstBrace) {
            // Verify the '[' actually starts a JSON array, not a tag like [DEVOTED]
            const afterBracket = clean.substring(firstBracket + 1).trimStart();
            if (/^[\[{"0-9\-tfn]/.test(afterBracket)) {
                start = firstBracket; // Looks like real JSON array
            } else {
                start = firstBrace;   // Tag like [DEVOTED], skip to '{'
            }
        } else {
            start = firstBrace;
        }
    } else if (firstBrace !== -1) {
        start = firstBrace;
    } else if (firstBracket !== -1) {
        // Only '[' found — verify it's a real JSON array
        const afterBracket = clean.substring(firstBracket + 1).trimStart();
        if (/^[\[{"0-9\-tfn]/.test(afterBracket)) {
            start = firstBracket;
        } else {
            return "{}"; // Not JSON at all
        }
    } else {
        return "{}";
    }

    const lastBrace = clean.lastIndexOf('}');
    const lastBracket = clean.lastIndexOf(']');
    const end = Math.max(lastBrace, lastBracket);
    if (end === -1 || end <= start) return "{}";
    clean = clean.substring(start, end + 1);
    return clean
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*/g, '')
        .replace(/\\n/g, '\\n');
  }

  // v1.19c: Build the correct thinkingConfig for the current model family.
  // Gemini 2.5 models: OMIT thinkingConfig entirely — they think by default,
  // and the chats.create() API returns empty responses when thinkingConfig
  // is combined with responseMimeType + responseSchema.
  // Gemini 3.x models: use thinkingLevel with string values
  // ("minimal" | "low" | "medium" | "high").
  private buildThinkingConfig(): Record<string, unknown> | undefined {
    const defaults = THINKING_DEFAULTS[this.modelName];
    if (!defaults) return undefined; // 2.5 models + unknown models — omit entirely

    // 3.x models use string-based thinkingLevel
    return { thinkingLevel: defaults.value };
  }

  protected validateResponse(data: unknown): ModelResponseSchema {
    const isObject = (val: unknown): val is Record<string, unknown> => 
        typeof val === 'object' && val !== null && !Array.isArray(val);

    const safeData = isObject(data) ? data : {};

    const asString = (val: unknown, fallback: string): string => typeof val === 'string' ? val : fallback;
    const asNumber = (val: unknown, fallback: number): number => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string' && !isNaN(Number(val))) return Number(val);
        return fallback;
    };
    const asOptionalNumber = (val: unknown): number | undefined => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string' && !isNaN(Number(val))) return Number(val);
        return undefined;
    };
    const asBoolean = (val: unknown): boolean => val === true;
    const asArray = <T>(val: unknown): T[] => Array.isArray(val) ? val as T[] : [];
    
    const mode = asString(safeData.scene_mode, "NARRATIVE");
    const scene_mode: SceneMode = (SCENE_MODES as readonly string[]).includes(mode)
      ? mode as SceneMode
      : 'NARRATIVE';

    const combatContext = isObject(safeData.combat_context) ? safeData.combat_context : {};
    const environment = isObject(combatContext.environment) ? combatContext.environment : {};
    const rawLighting = asString(environment.lighting, "DIM");
    const lighting: Lighting = (LIGHTING_LEVELS as readonly string[]).includes(rawLighting)
        ? rawLighting as Lighting
        : 'DIM';

    return {
        thought_process: asString(safeData.thought_process, "Analysis protocol bypassed."),
        scene_mode: scene_mode,
        tension_level: asNumber(safeData.tension_level, 0),
        narrative: asString(safeData.narrative, "System Error: Narrative missing."),
        
        time_passed_minutes: asNumber(safeData.time_passed_minutes, 0),
        
        biological_inputs: isObject(safeData.biological_inputs) ? {
            ingested_calories: asNumber(safeData.biological_inputs.ingested_calories, undefined),
            ingested_water: asNumber(safeData.biological_inputs.ingested_water, undefined),
            sleep_hours: asNumber(safeData.biological_inputs.sleep_hours, undefined),
            relieved_pressure: asArray(safeData.biological_inputs.relieved_pressure)
        } : undefined,

        known_entity_updates: asArray(safeData.known_entity_updates),
        
        combat_context: isObject(safeData.combat_context) ? {
            environment: {
                summary: asString(environment.summary, "Unknown"),
                lighting: lighting,
                weather: asString(environment.weather, "None"),
                terrain_tags: asArray(environment.terrain_tags)
            },
            active_threats: asArray(safeData.combat_context.active_threats)
        } : undefined,

        npc_interaction: isObject(safeData.npc_interaction) ? {
            speaker: asString(safeData.npc_interaction.speaker, "Unknown"),
            dialogue: asString(safeData.npc_interaction.dialogue, "..."),
            subtext: asString(safeData.npc_interaction.subtext, ""),
            biological_tells: asString(safeData.npc_interaction.biological_tells, "")
        } : undefined,

        roll_request: isObject(safeData.roll_request) ? {
            challenge: asString(safeData.roll_request.challenge, "Unknown Challenge"),
            bonus: typeof safeData.roll_request.bonus === 'number' ? safeData.roll_request.bonus : undefined,
            advantage: safeData.roll_request.advantage === true ? true : undefined,
            disadvantage: safeData.roll_request.disadvantage === true ? true : undefined,
        } : undefined,

        bargain_request: isObject(safeData.bargain_request) ? {
            description: asString(safeData.bargain_request.description, "Unknown Bargain")
        } : undefined,

        hidden_update: typeof safeData.hidden_update === 'string' ? safeData.hidden_update : undefined,
        
        new_memory: isObject(safeData.new_memory) ? {
            fact: asString(safeData.new_memory.fact, "Unknown Memory")
        } : undefined,

        new_lore: isObject(safeData.new_lore) ? {
            keyword: asString(safeData.new_lore.keyword, "Unknown"),
            content: asString(safeData.new_lore.content, "")
        } : undefined,

        biological_event: asBoolean(safeData.biological_event),

        // v1.15: Location Graph — pass through location_update for engine processing
        location_update: isObject(safeData.location_update) ? {
            location_name: asString(safeData.location_update.location_name, ''),
            description: typeof safeData.location_update.description === 'string' 
                ? safeData.location_update.description : undefined,
            tags: asArray<string>(safeData.location_update.tags)
                .filter((s: unknown): s is string => typeof s === 'string'),
            traveled_from: typeof safeData.location_update.traveled_from === 'string' && safeData.location_update.traveled_from.trim()
                ? safeData.location_update.traveled_from : undefined,
            travel_time_minutes: asOptionalNumber(safeData.location_update.travel_time_minutes),
            nearby_locations: asArray<{ name: string; travel_time_minutes: number; mode?: string }>(
                safeData.location_update.nearby_locations
            ).map((loc: unknown) => {
                const l = isObject(loc) ? loc : {};
                return {
                    name: asString(l.name, 'Unknown'),
                    travel_time_minutes: asNumber(l.travel_time_minutes, 30),
                    mode: typeof l.mode === 'string' && l.mode.trim() ? l.mode : undefined
                };
            })
        } : undefined,

        // v1.1: World Tick validation
        world_tick: isObject(safeData.world_tick) ? {
            npc_actions: asArray<{ npc_name: string; action: string; player_visible: boolean }>(
                safeData.world_tick.npc_actions
            ).map((a: unknown) => {
                const action = isObject(a) ? a : {};
                return {
                    npc_name: asString(action.npc_name, 'Unknown NPC'),
                    action: asString(action.action, 'No action recorded'),
                    player_visible: action.player_visible !== false // default true
                };
            }),
            environment_changes: asArray<string>(safeData.world_tick.environment_changes)
                .filter((s: unknown): s is string => typeof s === 'string'),
            emerging_threats: asArray<{ description: string; turns_until_impact?: number; dormant_hook_id?: string; player_action_cause?: string }>(
                safeData.world_tick.emerging_threats
            ).map((t: unknown) => {
                const threat = isObject(t) ? t : {};
                return {
                    description: asString(threat.description, 'Unknown threat'),
                    turns_until_impact: asOptionalNumber(threat.turns_until_impact),
                    // v1.6: Origin Gate fields — pass through for engine validation
                    dormantHookId: typeof threat.dormant_hook_id === 'string' && threat.dormant_hook_id.trim()
                        ? threat.dormant_hook_id.trim()
                        : undefined,
                    playerActionCause: typeof threat.player_action_cause === 'string' && threat.player_action_cause.trim()
                        ? threat.player_action_cause.trim()
                        : undefined,
                };
            })
        } : { npc_actions: [], environment_changes: [], emerging_threats: [] },
        
        character_updates: isObject(safeData.character_updates) ? {
            added_conditions: asArray(safeData.character_updates.added_conditions),
            removed_conditions: asArray(safeData.character_updates.removed_conditions),
            added_inventory: asArray(safeData.character_updates.added_inventory),
            removed_inventory: asArray(safeData.character_updates.removed_inventory),
            trauma_delta: asNumber(safeData.character_updates.trauma_delta, 0),
            bio_modifiers: isObject(safeData.character_updates.bio_modifiers) ? {
                calories: asOptionalNumber(safeData.character_updates.bio_modifiers.calories),
                hydration: asOptionalNumber(safeData.character_updates.bio_modifiers.hydration),
                stamina: asOptionalNumber(safeData.character_updates.bio_modifiers.stamina),
                lactation: asOptionalNumber(safeData.character_updates.bio_modifiers.lactation),
            } : undefined,
            relationships: asArray(safeData.character_updates.relationships),
            goals: asArray(safeData.character_updates.goals)
        } : undefined
    };
  }

  /**
   * v1.19: Streams the response from Gemini. When `onChunk` is provided, it is
   * called on every delta with the *accumulated* text so far — useful for
   * showing live "typing" in the UI. The final parsed ModelResponseSchema is
   * returned only after the stream completes (we need the full JSON to parse).
   *
   * When `onChunk` is omitted, the behavior is identical to the legacy
   * non-streaming send — same inputs, same outputs, same error handling —
   * except that the transport under the hood is always streaming, which
   * reduces first-byte latency on long generations.
   */
  async sendMessage(
      systemPrompt: string,
      history: ChatMessage[],
      historicalSummary?: string,
      nameMap?: Record<string, string>,  // v1.7
      trailingReminder?: string | null,  // v1.19: Appended to user message for recency compliance
      onChunk?: (textSoFar: string) => void  // v1.19: Streaming callback
  ): Promise<ModelResponseSchema> {
    
    // v1.21: Model-adaptive context limits — lite models get shorter history
    // and progressive compression of older messages to preserve attention budget.
    const profile = getContextProfile(this.modelName);

    const contextHistory = history.length > 0 ? history.slice(0, -1) : [];
    const recentHistory = contextHistory.slice(-profile.maxHistory);

    // v1.7: Sanitise history to remove any banned names before sending to AI.
    const cleanHistory = nameMap
      ? sanitiseHistory(recentHistory, nameMap)
      : recentHistory;

    // v1.21: Progressive history compression — keep recent messages at full
    // length, but truncate older messages to save tokens for system instructions.
    // This preserves narrative continuity while freeing attention budget.
    const compressedHistory = cleanHistory.map((msg, i) => {
      const isRecent = i >= cleanHistory.length - profile.recentFullMessages;
      if (isRecent || msg.text.length <= profile.compressedMessageLength) return msg;
      return {
        ...msg,
        text: msg.text.slice(0, profile.compressedMessageLength) + '…'
      };
    });

    const apiHistory = compressedHistory
      .filter(msg => msg.role === Role.USER || msg.role === Role.MODEL)
      .map(msg => ({
        role: msg.role,
        parts: [{ text: msg.text }]
      }));

    // v1.21: Historical summary moved into the dynamic prompt (constructGeminiPrompt)
    // where it sits at the TOP of context for better attention. The systemPrompt
    // param now arrives with the summary already embedded in the right position.
    const fullSystemInstruction = systemPrompt;

    const currentUserMsg = history[history.length - 1];

    // v1.19: Build model-appropriate thinking config.
    // Gemini 2.5 → thinkingBudget (tokens), Gemini 3.x → thinkingLevel (0-3).
    const thinkingConfig = this.buildThinkingConfig();

    // v1.19: Context caching for the static SYSTEM_INSTRUCTIONS block.
    // We detect whether the caller prefixed the system prompt with the
    // SYSTEM_INSTRUCTIONS constant; if so, we split it off and cache it.
    // The dynamic remainder is passed as the normal systemInstruction.
    // This is best-effort — if the Gemini caches API isn't available for
    // this model or the cache creation fails, we transparently fall back
    // to the uncached path (see geminiCache.ts).
    let cachedContentName: string | null = null;
    let effectiveSystemInstruction = fullSystemInstruction;
    if (fullSystemInstruction.startsWith(SYSTEM_INSTRUCTIONS)) {
        const cacheResult = await systemInstructionCache.getOrCreate(
            this.ai,
            this.modelName,
            SYSTEM_INSTRUCTIONS,
        );
        if (cacheResult) {
            cachedContentName = cacheResult;
            // Strip the cached portion (and the two-newline separator) from
            // what we send inline — the model still "sees" SYSTEM_INSTRUCTIONS
            // because the cache is attached via config.cachedContent below.
            effectiveSystemInstruction = fullSystemInstruction
                .slice(SYSTEM_INSTRUCTIONS.length)
                .replace(/^\n{1,2}/, '');
        }
    }

    const chatConfig: Record<string, unknown> = {
        temperature: parseFloat(localStorage.getItem('visceral_temperature') || '0.9'),
        topP: 0.95,
        topK: 40,
        safetySettings: GEMINI_SAFETY_SETTINGS,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        ...(thinkingConfig ? { thinkingConfig } : {}),
    };

    if (cachedContentName) {
        // When using cached content, the cached systemInstruction is already
        // baked in — Google rejects requests that set both. We pass the
        // dynamic remainder as a USER-role preamble at the top of history.
        chatConfig.cachedContent = cachedContentName;
        if (effectiveSystemInstruction.trim().length > 0) {
            apiHistory.unshift({
                role: Role.USER,
                parts: [{ text: `[DYNAMIC CONTEXT]\n${effectiveSystemInstruction}` }],
            });
            apiHistory.splice(1, 0, {
                role: Role.MODEL,
                parts: [{ text: 'Acknowledged. Proceeding with current state.' }],
            });
        }
    } else {
        chatConfig.systemInstruction = effectiveSystemInstruction;
    }

    const chat = this.ai.chats.create({
      model: this.modelName,
      history: apiHistory,
      config: chatConfig,
    });

    try {
      // v1.19: Append section reminders to the END of the user message.
      // Gemini pays strongest attention to the very bottom of context (recency bias).
      // Moving enforcement reminders here forces compliance even in long conversations.
      const userMessageWithReminder = trailingReminder
          ? `${currentUserMsg.text}\n\n[SYSTEM REFRESH — MANDATORY COMPLIANCE]\n${trailingReminder}`
          : currentUserMsg.text;

      // v1.19: Always use streaming transport. When `onChunk` is provided,
      // we surface each accumulated delta to the caller; otherwise we simply
      // accumulate and return the final text as before. Streaming reduces
      // perceived latency dramatically on long generations.
      const runStream = async (): Promise<string> => {
          const chatAsStream = chat as unknown as {
              sendMessageStream: (args: { message: string }) =>
                  Promise<AsyncIterable<GenerateContentResponse>>;
          };
          const stream = await chatAsStream.sendMessageStream({ message: userMessageWithReminder });
          let accumulated = '';
          for await (const piece of stream) {
              const delta = (piece as GenerateContentResponse).text ?? '';
              if (delta) {
                  accumulated += delta;
                  if (onChunk) {
                      try { onChunk(accumulated); } catch { /* swallow UI errors */ }
                  }
              }
          }
          return accumulated;
      };

      const text: string = await this.withRetry(() => Promise.race([
          runStream(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Request Timed Out")), REQUEST_TIMEOUT_MS)
          )
      ]));

      if (!text) throw new Error("Empty response from model.");
      
      const jsonStr = this.cleanJsonOutput(text);
      
      try {
          const raw = JSON.parse(jsonStr);
          return this.validateResponse(raw);
      } catch (jsonError) {
          console.error("JSON Parse Error:", jsonError);
          if (text.length > 20) {
               return {
                  narrative: text.replace(/^\[[\w\s/]+\]\.\s*/g, '').trim(),
                  thought_process: "JSON Structure Collapse. Raw output passed to narrative.",
                  scene_mode: "NARRATIVE",
                  tension_level: 50,
                  time_passed_minutes: 0,
                  world_tick: { npc_actions: [], environment_changes: [], emerging_threats: [] }
               };
          }
          throw new Error("Failed to parse model response structure.");
      }

    } catch (e: unknown) {
      console.error("Gemini Execution Error:", e);
      const errMsg = e instanceof Error ? e.message : String(e);

      // v1.19: If the failure was a cache miss (expired cachedContent name),
      // drop the local entry so the next turn rebuilds it cleanly.
      if (cachedContentName && (errMsg.includes('404') || errMsg.toLowerCase().includes('cached'))) {
          systemInstructionCache.invalidate(this.modelName);
      }

      if (errMsg.includes('503')) {
          return {
            narrative: `[SYSTEM ALERT] The neural lattice is currently overloaded (503). Retrying the connection usually resolves this. Please resubmit your command.`,
            thought_process: "Server Overload",
            scene_mode: "NARRATIVE",
            tension_level: 0,
            time_passed_minutes: 0,
            world_tick: { npc_actions: [], environment_changes: [], emerging_threats: [] }
          };
      }
      return { 
        narrative: `[SYSTEM ERROR] Neural Link Unstable. The matrix failed to render the consequence.\n\nRaw Trace: ${errMsg}`,
        thought_process: "System Failure.",
        scene_mode: "NARRATIVE",
        tension_level: 50,
        time_passed_minutes: 0,
        world_tick: { npc_actions: [], environment_changes: [], emerging_threats: [] }
      };
    }
  }
}
