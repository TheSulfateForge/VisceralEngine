import { Schema, Type } from "@google/genai";
import { SCENE_MODES, LIGHTING_LEVELS } from "../types";

export const RESPONSE_SCHEMA: Schema = {
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
      description: "WORLD LORE — STRICT DISCOVERY ONLY: Record facts the player directly discovered or witnessed THIS TURN through exploration, observation, or NPC disclosure. VALID: A note found describing guard patrol schedules. A captured enemy revealing their faction's base location. INVALID: Retroactively establishing that 'tracking hounds were always part of this patrol' to justify something you've already written. INVALID: Inventing new enemy capabilities, faction assets, or world rules that weren't established before this turn and happen to worsen the player's position. Lore DOCUMENTS what was discovered. It does NOT retroactively create facts to support narrative decisions already made. Do NOT invent new biological rules, racial mechanics, or physiological systems not established in backstory. One entry per turn maximum. If in doubt, skip it.",
      properties: {
        keyword: { type: Type.STRING, description: "Short identifier for this lore entry (e.g., 'Kobold Tactics', 'Floor 1 Layout')" },
        content: { type: Type.STRING, description: "Factual description of the discovered information. Must describe something actually encountered this turn. Must be observational, not prescriptive, and must not retroactively add threats or capabilities to existing established entities." }
      }
    },
    biological_event: { 
        type: Type.BOOLEAN, 
        description: "CONCEPTION TRIGGER: Set true ONLY when unprotected vaginal insemination physically occurs in the narrative. This triggers an automatic pregnancy roll. Do NOT set true for lactation, arousal, pheromone events, combat stress, or other biological activity that is not direct insemination."
    },
    world_tick: {
      type: Type.OBJECT,
      description: "WORLD PULSE — REQUIRED EVERY TURN. The world moves whether the player acts or not. Report what NPCs did, what changed in the environment, and what threats are developing. Even during mundane turns, NPCs pursue their goals. If nothing dramatic happened, report the mundane (a merchant restocked, guards changed shift, an ally ate breakfast). This field must NEVER be empty.",
      properties: {
        npc_actions: {
          type: Type.ARRAY,
          description: "What named NPCs did this turn — on-screen or off. At least one NPC should act per turn. Include scheming, traveling, working, socializing, or pursuing goals. Set player_visible=false for actions the player wouldn't know about yet.",
          items: {
            type: Type.OBJECT,
            properties: {
              npc_name: { type: Type.STRING, description: "Name of the NPC taking action." },
              action: { type: Type.STRING, description: "What they did. Be specific: 'Bribed the dock foreman for shipping manifests' not 'worked on her plan'." },
              player_visible: { type: Type.BOOLEAN, description: "Would the player notice or learn about this? false = hidden (logged to registry only)." }
            },
            required: ["npc_name", "action", "player_visible"]
          }
        },
        environment_changes: {
          type: Type.ARRAY,
          description: "Observable changes in the world: weather shifts, new postings on a board, a shop closing, a fire in a distant district, sounds from another room. Empty array [] only if truly nothing changed.",
          items: { type: Type.STRING }
        },
        emerging_threats: {
          type: Type.ARRAY,
          description: "Developing situations that will affect the player soon. A gang consolidating territory, a storm approaching, a political shift, a bounty being posted. Empty array [] if no threats are developing.",
          items: {
            type: Type.OBJECT,
            properties: {
              description: { type: Type.STRING, description: "What is developing." },
              turns_until_impact: { type: Type.INTEGER, description: "Estimated turns before this affects the player directly. 0 = this turn. 1-3 = imminent. 4+ = distant." },
              dormant_hook_id: {
                  type: Type.STRING,
                  description: "ORIGIN GATE TEST A: If this threat derives from the character's pre-existing background, set this to the exact DormantHook ID from the [ORIGIN GATE CONTEXT] block. If passing Test B instead, leave empty. If neither applies, this threat is FORBIDDEN."
              },
              player_action_cause: {
                  type: Type.STRING,
                  description: "ORIGIN GATE TEST B: If this threat was caused by a specific player action this session, describe it as: '[NPC name] observed [player action] at [location] on turn [N]'. The NPC must exist in the entity registry. If passing Test A instead, leave empty."
              }
            },
            required: ["description"]
          }
        }
      },
      required: ["npc_actions", "environment_changes", "emerging_threats"]
    }
  },
  required: ["thought_process", "scene_mode", "tension_level", "narrative", "world_tick"]
};