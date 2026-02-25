
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { SAFETY_SETTINGS, MAX_CONTEXT_HISTORY } from "../constants";
import { ChatMessage, Role, ModelResponseSchema, SCENE_MODES, SceneMode, Lighting, LIGHTING_LEVELS } from "../types";
import { RESPONSE_SCHEMA } from "../schemas/responseSchema";
import { sanitiseHistory } from '../utils/nameResolver';

const REQUEST_TIMEOUT_MS = 60000;

export class GeminiClient {
  public readonly ai: GoogleGenAI;
  protected readonly modelName: string;

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

    const rawLighting = asString((safeData.combat_context as any)?.environment?.lighting, "DIM");
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
            ingested_calories: asNumber(safeData.biological_inputs.ingested_calories, undefined as any),
            ingested_water: asNumber(safeData.biological_inputs.ingested_water, undefined as any),
            sleep_hours: asNumber(safeData.biological_inputs.sleep_hours, undefined as any),
            relieved_pressure: asArray(safeData.biological_inputs.relieved_pressure)
        } : undefined,

        known_entity_updates: asArray(safeData.known_entity_updates),
        
        combat_context: isObject(safeData.combat_context) ? {
            environment: {
                summary: asString((safeData.combat_context.environment as any)?.summary, "Unknown"),
                lighting: lighting,
                weather: asString((safeData.combat_context.environment as any)?.weather, "None"),
                terrain_tags: asArray((safeData.combat_context.environment as any)?.terrain_tags)
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

  async sendMessage(
      systemPrompt: string, 
      history: ChatMessage[], 
      historicalSummary?: string,
      nameMap?: Record<string, string>  // v1.7
  ): Promise<ModelResponseSchema> {
    
    const contextHistory = history.length > 0 ? history.slice(0, -1) : [];
    const recentHistory = contextHistory.slice(-MAX_CONTEXT_HISTORY);

    // v1.7: Sanitise history to remove any banned names before sending to AI.
    // The nameMap must be passed in or accessed from the prompt context.
    // Since sendMessage doesn't have direct world access, we add nameMap as
    // an optional parameter (see signature change below).
    const cleanHistory = nameMap
      ? sanitiseHistory(recentHistory, nameMap)
      : recentHistory;

    const apiHistory = cleanHistory
      .filter(msg => msg.role === Role.USER || msg.role === Role.MODEL)
      .map(msg => ({
        role: msg.role,
        parts: [{ text: msg.text }]
      }));

    const fullSystemInstruction = historicalSummary 
        ? `${systemPrompt}\n\n[PREVIOUSLY ON...]\n${historicalSummary}`
        : systemPrompt;

    const currentUserMsg = history[history.length - 1];

    const chat = this.ai.chats.create({
      model: this.modelName,
      history: apiHistory,
      config: {
        systemInstruction: fullSystemInstruction,
        temperature: parseFloat(localStorage.getItem('visceral_temperature') || '0.9'),
        topP: 0.95,
        topK: 40,
        safetySettings: SAFETY_SETTINGS,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA
      },
    });

    try {
      const result = await this.withRetry(() => Promise.race([
          chat.sendMessage({ message: currentUserMsg.text }),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error("Request Timed Out")), REQUEST_TIMEOUT_MS)
          )
      ]));

      const response = result as GenerateContentResponse; 
      const text = response.text;
      
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
