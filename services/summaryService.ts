
import { GoogleGenAI } from "@google/genai";
import { ChatMessage } from "../types";

export class SummaryService {
    constructor(private ai: GoogleGenAI) {}

    async summarizeHistory(history: ChatMessage[]): Promise<string> {
        try {
            const textContent = history.map(h => `${h.role}: ${h.text}`).join('\n');
            const response = await this.ai.models.generateContent({
                model: "gemini-2.5-flash-lite", 
                contents: `Summarize the following RPG session logs into a concise paragraph (max 300 words). Focus on key events, injuries, and location changes:\n\n${textContent}`,
            });
            return response.text || "";
        } catch (e) {
            console.error("Summary failed", e);
            return "";
        }
    }
}
