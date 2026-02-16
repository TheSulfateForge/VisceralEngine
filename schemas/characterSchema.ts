
import { Schema, Type } from "@google/genai";

export const CHARACTER_GEN_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        name: { type: Type.STRING, description: "A unique, setting-appropriate name. Avoid generic fantasy names." },
        gender: { type: Type.STRING, description: "Gender identity." },
        appearance: { type: Type.STRING, description: "Detailed physical description: height, build, skin, hair, eyes, distinguishing features. 2-4 sentences of visceral detail." },
        notableFeatures: { type: Type.STRING, description: "Scars, tattoos, implants, mutations, or other distinguishing marks. Specific and visual." },
        race: { type: Type.STRING, description: "Species or ancestry." },
        backstory: { type: Type.STRING, description: "3-5 sentences of personal history. Include: origin, defining trauma or achievement, current situation, and a hook that drives action." },
        setting: { type: Type.STRING, description: "The specific world/era/location. Be precise — not just 'fantasy' but 'Low-magic feudal Japan, Sengoku period'." },
        inventory: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "3-6 starting items. Only significant gear — weapons, tools, key possessions. No generic 'clothes' or 'food'."
        },
        relationships: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "2-4 existing ties. Format: 'Name — relationship — status'. E.g. 'Mara — sister — estranged since the fire'."
        },
        conditions: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "0-2 starting conditions. Only if the concept demands it (e.g., 'Chronic Pain — Left Knee' for a war vet). Empty array for healthy characters."
        },
        goals: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "2-3 driving motivations. Mix of immediate needs and long-term ambitions."
        }
    },
    required: ["name", "gender", "appearance", "notableFeatures", "race", "backstory", "setting", "inventory", "relationships", "conditions", "goals"]
};
