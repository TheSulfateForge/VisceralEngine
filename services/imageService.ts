
import { GoogleGenAI } from "@google/genai";
import { IMAGE_SAFETY_SETTINGS } from "../constants";

export class ImageService {
    constructor(private ai: GoogleGenAI) {}

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
