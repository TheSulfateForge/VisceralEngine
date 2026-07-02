
import { GoogleGenAI, Type } from "@google/genai";
import { ChatMessage } from "../types";

/**
 * v1.24: Memory candidate salvaged from a summarization window. Facts the
 * model narrated but never recorded via `new_memories` would otherwise
 * survive only in raw history — and die when the window scrolls past
 * maxHistory. The salvage pass extracts them during the summarization call
 * that is already being paid for.
 */
export interface SalvagedMemoryCandidate {
    fact: string;
    salience?: number;
    tags?: string[];
}

export interface SummaryWithSalvage {
    summary: string;
    memoryCandidates: SalvagedMemoryCandidate[];
}

const SALVAGE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        summary: {
            type: Type.STRING,
            description: "Concise narrative summary of the window (max 300 words). Key events, injuries, location changes, relationship shifts.",
        },
        memory_candidates: {
            type: Type.ARRAY,
            description: "0-3 PERMANENT facts established in this window that a future narrator must not lose (vows, debts, deaths, reveals, acquisitions, identity facts). Self-contained single sentences. NOT routine actions, transient states, or anything already obvious from the summary.",
            items: {
                type: Type.OBJECT,
                properties: {
                    fact: { type: Type.STRING },
                    salience: { type: Type.NUMBER, description: "1-5; 5 = pivotal (death, vow, identity reveal)" },
                    tags: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
                },
                required: ["fact", "salience"],
            },
        },
    },
    required: ["summary", "memory_candidates"],
};

export class SummaryService {
    constructor(private ai: GoogleGenAI) {}

    /** Legacy string-only path — kept for any remaining callers. */
    async summarizeHistory(history: ChatMessage[]): Promise<string> {
        const result = await this.summarizeHistoryWithSalvage(history);
        return result.summary;
    }

    /**
     * v1.24: Summarize a window AND salvage memory-worthy facts from it in
     * the same call. Same latency, same price bracket, closes the "narrated
     * but never recorded" memory leak.
     */
    async summarizeHistoryWithSalvage(history: ChatMessage[]): Promise<SummaryWithSalvage> {
        try {
            const textContent = history.map(h => `${h.role}: ${h.text}`).join('\n');
            const response = await this.ai.models.generateContent({
                model: "gemini-2.5-flash-lite",
                contents: `You are the archival subsystem of an RPG simulation engine. Process the session logs below.

1. Write a concise narrative summary (max 300 words): key events, injuries, location changes, relationship shifts.
2. Extract 0-3 memory candidates: PERMANENT facts a future narrator must not lose (vows, oaths, debts, deaths, reveals, major acquisitions, identity facts). One self-contained sentence each. Skip routine actions and transient states. If nothing qualifies, return an empty array — most windows have 0-1.

LOGS:
${textContent}`,
                config: {
                    thinkingConfig: { thinkingBudget: 512 },
                    responseMimeType: "application/json",
                    responseSchema: SALVAGE_SCHEMA,
                },
            });
            const raw = JSON.parse(response.text || "{}") as {
                summary?: string;
                memory_candidates?: Array<{ fact?: string; salience?: number; tags?: string[] }>;
            };
            const candidates: SalvagedMemoryCandidate[] = (raw.memory_candidates ?? [])
                .filter(c => typeof c.fact === 'string' && c.fact.trim().length > 0)
                .slice(0, 3)
                .map(c => ({
                    fact: c.fact!.trim(),
                    salience: typeof c.salience === 'number'
                        ? Math.max(1, Math.min(5, Math.round(c.salience)))
                        : undefined,
                    tags: Array.isArray(c.tags)
                        ? c.tags.filter((t): t is string => typeof t === 'string')
                        : undefined,
                }));
            return { summary: raw.summary ?? "", memoryCandidates: candidates };
        } catch (e) {
            console.error("Summary failed", e);
            return { summary: "", memoryCandidates: [] };
        }
    }
}
