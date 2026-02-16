
import { Schema, Type } from "@google/genai";

export const SCENARIO_SCHEMA: Schema = {
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
