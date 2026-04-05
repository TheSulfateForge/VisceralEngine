import { Schema, Type } from "@google/genai";

export const WORLD_DECOMPOSITION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    locations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Location name" },
          description: { type: Type.STRING, description: "1-2 sentence description of this location" },
          tags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Setting-appropriate tags describing the location type (e.g., fantasy: settlement, wilderness, dungeon, ruin; sci-fi: station, planet, orbital; modern: urban, suburban, government)"
          },
          connections: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                to: { type: Type.STRING, description: "Name of connected location" },
                travelTimeMinutes: { type: Type.INTEGER, description: "Travel time in minutes" },
                mode: { type: Type.STRING, description: "Setting-appropriate movement mode (e.g., foot, horse, ship, car, shuttle, teleporter)" }
              },
              required: ["to", "travelTimeMinutes"]
            }
          },
          controllingFaction: {
            type: Type.STRING,
            description: "Name of faction controlling this location (optional)",
            nullable: true
          }
        },
        required: ["name", "description", "tags", "connections"]
      }
    },
    factions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Faction name" },
          description: { type: Type.STRING, description: "2-3 sentences covering governance, culture, and key policies" },
          territory: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "List of controlled location names"
          },
          influence: { type: Type.INTEGER, description: "Influence score 0-100" },
          resources: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Setting-appropriate resource types (e.g., military, economic, intelligence, magical, political, technological, cultural, industrial)"
          },
          dispositions: {
            type: Type.OBJECT,
            description: "Dispositions toward other factions (e.g., allied, neutral, rival, war, vassal, trade-partner)"
          },
          leader: {
            type: Type.STRING,
            description: "Leader name (optional)",
            nullable: true
          },
          keyMembers: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Names of key NPCs in this faction"
          }
        },
        required: ["name", "description", "territory", "influence", "resources", "dispositions", "keyMembers"]
      }
    },
    lore: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          keyword: { type: Type.STRING, description: "Unique topic name (2-5 words) specific enough to distinguish from all other entries" },
          content: { type: Type.STRING, description: "1-3 concrete sentences about this single topic" },
          category: {
            type: Type.STRING,
            description: "Setting-appropriate category for this lore entry (e.g., history, geography, culture, magic, technology, religion, economy, law, biology, military, social, science, dungeon, combat, faction-detail, racial-trait)"
          }
        },
        required: ["keyword", "content", "category"]
      }
    },
    npcs: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "NPC name" },
          role: { type: Type.STRING, description: "Role or occupation" },
          location: { type: Type.STRING, description: "Current location name" },
          faction: {
            type: Type.STRING,
            description: "Faction affiliation (optional)",
            nullable: true
          },
          description: { type: Type.STRING, description: "Physical and background description" },
          personality: { type: Type.STRING, description: "Personality traits and quirks" },
          goals: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "List of goals and motivations"
          }
        },
        required: ["name", "role", "location", "description", "personality", "goals"]
      }
    },
    rules: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Specific rule name" },
          description: { type: Type.STRING, description: "The exact mechanical rule as described in the source" }
        },
        required: ["name", "description"]
      }
    },
    tags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "World tags describing genre, tone, and setting (e.g., dark-fantasy, cyberpunk, post-apocalyptic, hard-sci-fi, urban-modern)"
    }
  },
  required: ["locations", "factions", "lore", "npcs", "rules", "tags"]
};
