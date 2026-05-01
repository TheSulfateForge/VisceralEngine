import { Schema, Type } from "@google/genai";

/**
 * IMPORTANT — preservation policy:
 * Field descriptions in this schema double as instructions to Gemini. They
 * intentionally tell the model to preserve source wording verbatim and to
 * avoid summarizing. Do NOT add sentence-count caps ("1-2 sentences", etc.)
 * to text fields — that wording causes the extractor to compress
 * multi-sentence source content into a single paraphrased line.
 */

const VERBATIM_SUFFIX =
  " Preserve the source wording verbatim or as close to verbatim as possible — copy every concrete detail (physical traits, history, quirks, numbers, names) from the source. Do NOT paraphrase, condense, or drop sentences. If the source has four sentences on this topic, output four sentences.";

export const WORLD_DECOMPOSITION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    locations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Location name" },
          description: {
            type: Type.STRING,
            description:
              "Full description of this location, including population, government, atmosphere, and notable features." +
              VERBATIM_SUFFIX
          },
          tags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              "All tags from the source (e.g., trade, neutral, urban, mixed-race, lawless, settlement, wilderness, dungeon, ruin, station, planet, orbital). Include every tag listed for this location."
          },
          connections: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                to: { type: Type.STRING, description: "Name of connected location" },
                travelTimeMinutes: {
                  type: Type.INTEGER,
                  description:
                    "Travel time in minutes. If the source gives a duration in days/hours, convert it (1 day = 1440 min, 1 hour = 60 min)."
                },
                mode: {
                  type: Type.STRING,
                  description:
                    "Movement mode exactly as named in the source (e.g., foot, mounted, horse, ship, car, shuttle, teleporter)."
                }
              },
              required: ["to", "travelTimeMinutes"]
            },
            description:
              "Every connection listed for this location. If the source lists multiple modes for the same destination (e.g., '5 days by foot, 3 days by mounted'), emit one connection entry per mode."
          },
          controllingFaction: {
            type: Type.STRING,
            description:
              "Name of the controlling faction exactly as written in the source. Use null only if the source explicitly says None / neutral / unaligned.",
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
          name: { type: Type.STRING, description: "Faction name exactly as written in the source." },
          description: {
            type: Type.STRING,
            description:
              "Full description of this faction's governance, culture, doctrine, and key policies." +
              VERBATIM_SUFFIX
          },
          territory: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              "Every controlled location, region, or holding listed for this faction in the source — copy each entry as written."
          },
          influence: {
            type: Type.INTEGER,
            description:
              "Influence score 0-100. If the source gives a numeric influence (e.g., 'Influence: 75'), use that number exactly."
          },
          resources: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              "Every resource type the source lists for this faction (e.g., military, economic, intelligence, magical, political, technological, debt leverage). Preserve any parenthetical qualifiers."
          },
          dispositions: {
            type: Type.OBJECT,
            description:
              "Dispositions toward other factions — one key per other faction named in the source, with the relationship label as written (allied, neutral, rival, war, vassal, trade-partner, irrelevant, etc.)."
          },
          leader: {
            type: Type.STRING,
            description:
              "Leader name and title exactly as written in the source (e.g., 'Hearth-Empress Brunhildra Coalveil').",
            nullable: true
          },
          keyMembers: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              "Every key member, council, or sub-body the source lists for this faction — copy each entry verbatim."
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
          keyword: {
            type: Type.STRING,
            description:
              "Unique topic name (2-5 words) specific enough to distinguish from every other entry. If the source uses a === Header === for this topic, use that header verbatim."
          },
          content: {
            type: Type.STRING,
            description:
              "Full content for this lore topic — every sentence the source devotes to it." +
              VERBATIM_SUFFIX
          },
          category: {
            type: Type.STRING,
            description:
              "Category for this lore entry. If the source supplies one (e.g., 'Category: culture'), use it exactly. Otherwise pick the best fit (history, geography, culture, magic, technology, religion, economy, law, biology, military, social, science, dungeon, combat, faction-detail, racial-trait)."
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
          name: {
            type: Type.STRING,
            description:
              "NPC name exactly as written in the source, including titles (e.g., 'Mayor Corrith Vaelhart', 'Den-Mother Olwyn Greysong')."
          },
          role: {
            type: Type.STRING,
            description:
              "Role or occupation. If the source has an explicit 'Role:' line, use it verbatim — do NOT shorten or rephrase."
          },
          location: { type: Type.STRING, description: "Current location exactly as named in the source." },
          faction: {
            type: Type.STRING,
            description:
              "Faction affiliation exactly as written in the source, including parenthetical context (e.g., 'High Council of Matriarchs (retired Apex Knight)').",
            nullable: true
          },
          description: {
            type: Type.STRING,
            description:
              "Full physical and background description — every detail the source provides (age, build, race, scars, eye color, clothing, mannerisms, history)." +
              VERBATIM_SUFFIX
          },
          personality: {
            type: Type.STRING,
            description:
              "Full personality description — every trait, quirk, belief, and habit the source lists." +
              VERBATIM_SUFFIX
          },
          goals: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              "Every goal or motivation the source lists for this NPC, as a separate array entry. Copy each goal verbatim — do NOT merge or drop goals. If the source lists three goals, output three array entries."
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
          name: {
            type: Type.STRING,
            description: "Specific rule name. If the source uses a === Header === for this rule, use that header verbatim."
          },
          description: {
            type: Type.STRING,
            description:
              "Full mechanical rule text — every sentence the source devotes to it, including examples, baselines, and exceptions." +
              VERBATIM_SUFFIX
          }
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

