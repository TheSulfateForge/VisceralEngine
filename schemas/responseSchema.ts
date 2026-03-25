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
        description: "Minutes elapsed in THIS scene beat ONLY. Do NOT 'catch up' or account for off-screen time. STRICT BRACKETS — pick the lowest that fits: Quick exchange (a few spoken sentences)=1-3. Short conversation (one topic discussed)=3-5. Extended dialogue scene (multiple topics, emotional shift)=5-10. Brief physical action (hug, hand something over, open a door)=1-2. Routine task (cooking, cleaning, getting dressed)=15-30. District travel on foot=30-60. Sleep=420-480 ONLY with sleep_hours set. SOCIAL MODE DEFAULT: If scene_mode is SOCIAL, default to 2 (not 15). The engine caps SOCIAL turns at 15m max. Combat round=1-5. If unsure, default LOW: 2 for dialogue, 15 for activity. Saying a single sentence is NOT 15 minutes."
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
        goals: { type: Type.ARRAY, items: { type: Type.STRING } },
        skill_updates: {
          type: Type.ARRAY,
          nullable: true,
          items: {
            type: Type.OBJECT,
            properties: {
              skill_name: { type: Type.STRING },
              new_level: { type: Type.STRING },
              reason: { type: Type.STRING }
            }
          }
        }
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
        disadvantage: { type: Type.BOOLEAN },
        relevant_skill: { type: Type.STRING, description: 'Skill name if applicable', nullable: true }
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
    location_update: {
      type: Type.OBJECT,
      nullable: true,
      description: "LOCATION TRACKING: Populate EVERY turn the player is at a named location. Always set location_name to the current specific place name. If the player MOVED this turn, also set traveled_from (the previous location name) and travel_time_minutes. Optionally list 1-4 nearby_locations reachable from here with estimated travel times to build the world map. Even when the player stays put, still populate location_name.",
      properties: {
        location_name: {
          type: Type.STRING,
          description: "The player's CURRENT location. Use the most specific named place (e.g., 'The Rusty Anchor Tavern' not 'the tavern'). Be consistent — always reuse the exact same name for the same place across turns."
        },
        description: {
          type: Type.STRING,
          description: "Brief one-line description of this location if appearing for the first time (e.g., 'A cramped apothecary shop in the eastern market district'). Omit on subsequent visits."
        },
        tags: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "Categorization tags for new locations: 'settlement', 'wilderness', 'interior', 'underground', 'port', 'road', 'camp', 'market', 'residential', etc."
        },
        traveled_from: {
          type: Type.STRING,
          description: "If the player MOVED this turn, the exact name of the location they departed from. Must match a previously used location_name. Leave empty string if the player stayed put."
        },
        travel_time_minutes: {
          type: Type.INTEGER,
          description: "If traveled_from is set, how many minutes the journey took. Must be consistent with time_passed_minutes. Walking across a district: 15-30. Between nearby settlements: 60-240. Long journey: 480+."
        },
        nearby_locations: {
          type: Type.ARRAY,
          description: "1-4 locations reachable from the current location. Include places mentioned in narrative or logically nearby. These build the proximity graph over time.",
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: "Name of the nearby reachable location." },
              travel_time_minutes: { type: Type.INTEGER, description: "Estimated travel time in minutes by default movement mode." },
              mode: { type: Type.STRING, description: "Movement mode if not on foot (e.g., 'horseback', 'carriage', 'boat'). Omit for walking." }
            },
            required: ["name", "travel_time_minutes"]
          }
        }
      },
      required: ["location_name"]
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
    faction_updates: {
      type: Type.ARRAY,
      nullable: true,
      description: 'Updates to factions when player actions affect them',
      items: {
        type: Type.OBJECT,
        properties: {
          faction_name: { type: Type.STRING },
          influence_delta: { type: Type.INTEGER },
          territory_gained: { type: Type.ARRAY, items: { type: Type.STRING } },
          territory_lost: { type: Type.ARRAY, items: { type: Type.STRING } },
          player_reputation_delta: { type: Type.INTEGER },
          new_objective: { type: Type.STRING },
        }
      }
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