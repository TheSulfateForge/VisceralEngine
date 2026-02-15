import { GoogleGenAI, Schema, Type, GenerateContentResponse } from "@google/genai";
import { SAFETY_SETTINGS, IMAGE_SAFETY_SETTINGS, MAX_CONTEXT_HISTORY } from "./constants";
import { ChatMessage, Role, ModelResponseSchema, Character, Scenario } from "./types";

// Schema Definition for Visceral Realism Engine 0.9.0
const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    thought_process: { 
      type: Type.STRING, 
      description: "Analyze the scene before writing. Determine intent, mood, and time passed." 
    },
    scene_mode: {
      type: Type.STRING,
      enum: ["NARRATIVE", "SOCIAL", "TENSION", "COMBAT"],
      description: "NARRATIVE: Normal. SOCIAL: Conversation. TENSION: Danger near. COMBAT: Active violence."
    },
    tension_level: {
      type: Type.INTEGER,
      description: "0 (Peaceful) to 100 (Doomed). Adjust based on atmosphere.",
    },
    narrative: { 
      type: Type.STRING, 
      description: "The main story content." 
    },
    time_passed_minutes: {
        type: Type.INTEGER,
        description: "Minutes elapsed in THIS scene beat ONLY. Do NOT 'catch up' or account for off-screen time from prior turns. Combat round=1-5, Dialogue=5-15, Routine task=15-45, District travel=30-60. Sleep=420-480 ONLY if sleep_hours is also set. If unsure, default LOW (15). Max non-sleep value: 90."
    },
    biological_inputs: {
        type: Type.OBJECT,
        nullable: true,
        properties: {
            ingested_calories: { type: Type.INTEGER, description: "Est. calories eaten (200=Snack, 600=Meal, 1200=Feast)." },
            ingested_water: { type: Type.INTEGER, description: "Est. hydration gained (10=Sip, 50=Cup, 100=Meal/Large Drink)." },
            sleep_hours: { type: Type.INTEGER },
            relieved_pressure: { type: Type.ARRAY, items: { type: Type.STRING }, description: "['lactation', 'bladder', 'seminal']" }
        }
    },
    character_updates: {
      type: Type.OBJECT,
      description: "STATE ENGINE: Use these fields to Add/Remove items and conditions.",
      properties: {
        added_conditions: { type: Type.ARRAY, items: { type: Type.STRING } },
        removed_conditions: { type: Type.ARRAY, items: { type: Type.STRING } },
        added_inventory: { type: Type.ARRAY, items: { type: Type.STRING } },
        removed_inventory: { type: Type.ARRAY, items: { type: Type.STRING } },
        trauma_delta: { type: Type.INTEGER },
        bio_modifiers: {
            type: Type.OBJECT,
            nullable: true,
            description: "PHYSIOLOGY TUNING: Set multipliers. 1.0 = Human Base. 0.5 = Slow Burn/Efficient. 2.0 = Fast Burn/Inefficient.",
            properties: {
                calories: { type: Type.NUMBER },
                hydration: { type: Type.NUMBER },
                stamina: { type: Type.NUMBER },
                lactation: { type: Type.NUMBER }
            }
        },
        relationships: { type: Type.ARRAY, items: { type: Type.STRING } },
        goals: { type: Type.ARRAY, items: { type: Type.STRING } }
      }
    },
    combat_context: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        environment: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            lighting: { type: Type.STRING, enum: ["BRIGHT", "DIM", "DARK"] },
            weather: { type: Type.STRING },
            terrain_tags: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["summary", "lighting", "terrain_tags"]
        },
        active_threats: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              name: { type: Type.STRING },
              archetype: { type: Type.STRING, enum: ["AMATEUR", "PROFESSIONAL", "FANATIC", "MONSTER"] },
              status: { type: Type.STRING, enum: ["EFFECTIVE", "COMPROMISED", "BROKEN"] },
              condition: { type: Type.STRING },
              current_action: { type: Type.STRING },
              cover_state: { type: Type.STRING, enum: ["OPEN", "PARTIAL", "FULL"] },
              distance: { type: Type.STRING, enum: ["MELEE", "CLOSE", "FAR"] }
            },
            required: ["id", "name", "archetype", "status", "condition", "current_action", "cover_state", "distance"]
          }
        }
      },
      required: ["environment", "active_threats"]
    },
    known_entity_updates: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          name: { type: Type.STRING },
          role: { type: Type.STRING },
          location: { type: Type.STRING },
          impression: { type: Type.STRING },
          relationship_level: { type: Type.STRING, enum: ['NEMESIS', 'HOSTILE', 'COLD', 'NEUTRAL', 'WARM', 'ALLIED', 'DEVOTED'] },
          leverage: { type: Type.STRING },
          ledger: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["id", "name", "role", "location", "impression", "relationship_level", "leverage", "ledger"]
      }
    },
    npc_interaction: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        speaker: { type: Type.STRING },
        dialogue: { type: Type.STRING },
        subtext: { type: Type.STRING },
        biological_tells: { type: Type.STRING }
      },
      required: ["speaker", "dialogue", "subtext", "biological_tells"]
    },
    roll_request: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        challenge: { type: Type.STRING },
        bonus: { type: Type.NUMBER },
        advantage: { type: Type.BOOLEAN },
        disadvantage: { type: Type.BOOLEAN }
      },
      required: ["challenge"]
    },
    bargain_request: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        description: { type: Type.STRING }
      },
      required: ["description"]
    },
    hidden_update: { type: Type.STRING, nullable: true },
    new_memory: {
      type: Type.OBJECT,
      nullable: true,
      description: "PERSISTENT HISTORY: Record major life events (sexual partners, major kills, permanent loss).",
      properties: {
        fact: { type: Type.STRING, description: "The absolute truth to remember forever." }
      }
    },
    new_lore: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        keyword: { type: Type.STRING },
        content: { type: Type.STRING }
      }
    },
    biological_event: { type: Type.BOOLEAN }
  },
  required: ["thought_process", "scene_mode", "tension_level", "narrative"]
};

const SCENARIO_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      description: { type: Type.STRING },
      opening_line: { type: Type.STRING }
    },
    required: ["title", "description", "opening_line"]
  }
};

const REQUEST_TIMEOUT_MS = 60000;

export class GeminiService {
  private readonly modelName: string;
  private readonly apiKey: string;
  private readonly ai: GoogleGenAI;

  constructor(apiKey: string, modelName: string) {
    if (!apiKey) throw new Error("API Key is required for GeminiService");
    this.apiKey = apiKey;
    this.modelName = modelName;
    this.ai = new GoogleGenAI({ apiKey: this.apiKey });
  }

  private cleanJsonOutput(text: string): string {
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

  private validateResponse(data: unknown): ModelResponseSchema {
    // Strict Type Guarding without "any"
    const isObject = (val: unknown): val is Record<string, unknown> => 
        typeof val === 'object' && val !== null && !Array.isArray(val);

    const safeData = isObject(data) ? data : {};

    // Helper for safe casting with string coercion support
    const asString = (val: unknown, fallback: string): string => typeof val === 'string' ? val : fallback;
    const asNumber = (val: unknown, fallback: number): number => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string' && !isNaN(Number(val))) return Number(val);
        return fallback;
    };
    const asBoolean = (val: unknown): boolean => val === true;
    const asArray = <T>(val: unknown): T[] => Array.isArray(val) ? val as T[] : [];
    
    // Scene Mode Guard
    const mode = asString(safeData.scene_mode, "NARRATIVE");
    const validModes = ["NARRATIVE", "SOCIAL", "TENSION", "COMBAT"];
    const scene_mode = validModes.includes(mode) ? mode as any : "NARRATIVE";

    const sanitized: ModelResponseSchema = {
        thought_process: asString(safeData.thought_process, "Analysis protocol bypassed."),
        scene_mode: scene_mode,
        tension_level: asNumber(safeData.tension_level, 0),
        narrative: asString(safeData.narrative, "System Error: Narrative missing."),
        
        // CRITICAL FIX: Default time passed to 0 to prevent "Phantom Time" drift.
        // If the AI doesn't specify time, no time has passed.
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
                lighting: asString((safeData.combat_context.environment as any)?.lighting, "DIM") as any,
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

        roll_request: safeData.roll_request as any,
        bargain_request: safeData.bargain_request as any,
        hidden_update: typeof safeData.hidden_update === 'string' ? safeData.hidden_update : undefined,
        
        // New Memory Validation
        new_memory: isObject(safeData.new_memory) ? {
            fact: asString(safeData.new_memory.fact, "Unknown Memory")
        } : undefined,

        new_lore: safeData.new_lore as any,
        biological_event: asBoolean(safeData.biological_event),
        
        character_updates: isObject(safeData.character_updates) ? {
            added_conditions: asArray(safeData.character_updates.added_conditions),
            removed_conditions: asArray(safeData.character_updates.removed_conditions),
            added_inventory: asArray(safeData.character_updates.added_inventory),
            removed_inventory: asArray(safeData.character_updates.removed_inventory),
            trauma_delta: asNumber(safeData.character_updates.trauma_delta, 0),
            bio_modifiers: isObject(safeData.character_updates.bio_modifiers) ? {
                calories: asNumber(safeData.character_updates.bio_modifiers.calories, undefined as any),
                hydration: asNumber(safeData.character_updates.bio_modifiers.hydration, undefined as any),
                stamina: asNumber(safeData.character_updates.bio_modifiers.stamina, undefined as any),
                lactation: asNumber(safeData.character_updates.bio_modifiers.lactation, undefined as any),
            } : undefined,
            relationships: asArray(safeData.character_updates.relationships),
            goals: asArray(safeData.character_updates.goals)
        } : undefined
    };
    return sanitized;
  }

  async summarizeHistory(history: ChatMessage[]): Promise<string> {
      try {
          const textContent = history.map(h => `${h.role}: ${h.text}`).join('\n');
          const response = await this.ai.models.generateContent({
              model: "gemini-3-flash-preview", 
              contents: `Summarize the following RPG session logs into a concise paragraph (max 300 words). Focus on key events, injuries, and location changes:\n\n${textContent}`,
          });
          return response.text || "";
      } catch (e) {
          console.error("Summary failed", e);
          return "";
      }
  }

  async sendMessage(
      systemPrompt: string, 
      history: ChatMessage[], 
      historicalSummary?: string
  ): Promise<ModelResponseSchema> {
    
    const contextHistory = history.length > 0 ? history.slice(0, -1) : [];
    const recentHistory = contextHistory.slice(-MAX_CONTEXT_HISTORY);

    const apiHistory = recentHistory
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
        temperature: 0.9,
        topP: 0.95,
        topK: 40,
        safetySettings: SAFETY_SETTINGS,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA
      },
    });

    try {
      const result = await Promise.race([
          chat.sendMessage({ message: currentUserMsg.text }),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error("Request Timed Out")), REQUEST_TIMEOUT_MS)
          )
      ]);

      const response = result as GenerateContentResponse; 
      const text = response.text;
      
      if (!text) throw new Error("Empty response from model.");
      
      const jsonStr = this.cleanJsonOutput(text);
      
      try {
          const raw = JSON.parse(jsonStr);
          return this.validateResponse(raw);
      } catch (jsonError) {
          console.error("JSON Parse Error:", jsonError);
          // In the catch block, clean the fallback narrative:
          if (text.length > 20) {
               return {
                  narrative: text.replace(/^\[[\w\s/]+\]\.\s*/g, '').trim(),
                  thought_process: "JSON Structure Collapse. Raw output passed to narrative.",
                  scene_mode: "NARRATIVE",
                  tension_level: 50,
                  time_passed_minutes: 0 // Prevent time drift on JSON failure
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
            time_passed_minutes: 0 // Stop clock on server error
          };
      }
      return { 
        narrative: `[SYSTEM ERROR] Neural Link Unstable. The matrix failed to render the consequence.\n\nRaw Trace: ${errMsg}`,
        thought_process: "System Failure.",
        scene_mode: "NARRATIVE",
        tension_level: 50,
        time_passed_minutes: 0 // Stop clock on general error
      };
    }
  }

  async generateScenarios(character: Character): Promise<Scenario[]> {
    try {
      const prompt = `
      Generate 3 distinct starting scenarios for a "Hard Reality" roleplaying game based on this character:
      ${JSON.stringify(character)}
      1. MUNDANE HOOK: Low stakes, grounded.
      2. VIOLENT HOOK: Immediate danger/action.
      3. MATURE HOOK: Social/Ethical complexity.
      Output JSON only.
      `;

      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: SCENARIO_SCHEMA,
          safetySettings: SAFETY_SETTINGS,
          temperature: 0.9
        }
      });
      const text = response.text;
      if (!text) return [];
      const clean = this.cleanJsonOutput(text);
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) return parsed as Scenario[];
      if (typeof parsed === 'object' && parsed !== null) {
          const values = Object.values(parsed);
          const foundArray = values.find(v => Array.isArray(v));
          if (foundArray) return foundArray as Scenario[];
      }
      return [];
    } catch (e) {
      console.error("Scenario generation failed", e);
      return [];
    }
  }

  async generateImage(prompt: string): Promise<string | null> {
    const stylePrompt = `Visceral realism, gritty, high contrast, cinematic lighting, 35mm film grain, dark atmosphere. ${prompt}`;
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: stylePrompt }],
        },
        config: {
          imageConfig: {
            aspectRatio: "16:9"
          },
          safetySettings: IMAGE_SAFETY_SETTINGS,
        }
      });
      const candidate = response.candidates?.[0];
      if (!candidate?.content?.parts) return null;
      for (const part of candidate.content.parts) {
        if (part.inlineData) {
          return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
      }
    } catch (error) {
      console.error("Image generation error:", error);
    }
    return null;
  }
}