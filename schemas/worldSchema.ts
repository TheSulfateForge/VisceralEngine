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
          description: { type: Type.STRING, description: "Brief description" },
          tags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Tags like 'settlement', 'wilderness', 'interior', 'ruin', etc."
          },
          connections: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                to: { type: Type.STRING, description: "Name of connected location" },
                travelTimeMinutes: { type: Type.INTEGER, description: "Travel time in minutes" },
                mode: { type: Type.STRING, description: "Movement mode (optional, e.g. 'horseback')" }
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
          description: { type: Type.STRING, description: "Faction description" },
          territory: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "List of controlled location names"
          },
          influence: { type: Type.INTEGER, description: "Influence score 0-100" },
          resources: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "List of resource types (military, economic, intelligence, magical, political)"
          },
          dispositions: {
            type: Type.OBJECT,
            description: "Dispositions toward other factions (allied, neutral, rival, war)"
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
          keyword: { type: Type.STRING, description: "Short keyword for this lore entry" },
          content: { type: Type.STRING, description: "Detailed content" },
          category: {
            type: Type.STRING,
            enum: ["history", "geography", "culture", "magic", "technology", "religion", "economy"],
            description: "Category of lore"
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
          name: { type: Type.STRING, description: "Rule name (e.g. 'Magic System', 'Social Structure')" },
          description: { type: Type.STRING, description: "Detailed rule description" }
        },
        required: ["name", "description"]
      }
    },
    tags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "World tags (e.g. 'dark-fantasy', 'low-magic', 'steampunk')"
    }
  },
  required: ["locations", "factions", "lore", "npcs", "rules", "tags"]
};
