
import { GeminiClient } from "./services/geminiClient";
import { ImageService } from "./services/imageService";
import { ScenarioService } from "./services/scenarioService";
import { CharacterService } from "./services/characterService";
import { SummaryService } from "./services/summaryService";
import { WorldPulseService } from "./services/worldPulseService";
import { ChatMessage, Scenario, Character, GeneratedCharacterFields, GameWorld } from "./types";

export class GeminiService extends GeminiClient {
    private imageService: ImageService;
    private scenarioService: ScenarioService;
    private characterService: CharacterService;
    private summaryService: SummaryService;
    private worldPulseService: WorldPulseService;

    constructor(apiKey: string, modelName: string) {
        super(apiKey, modelName);
        this.imageService = new ImageService(this.ai);
        this.scenarioService = new ScenarioService(this);
        this.characterService = new CharacterService(this);
        this.summaryService = new SummaryService(this.ai);
        this.worldPulseService = new WorldPulseService(this.ai);
    }

    // v1.24: offscreen world simulation (background, cheap model)
    async worldPulse(world: GameWorld, turn: number) {
        return this.worldPulseService.pulse(world, turn);
    }

    // Facade Methods

    async summarizeHistory(history: ChatMessage[]): Promise<string> {
        return this.summaryService.summarizeHistory(history);
    }

    // v1.24: summary + salvaged memory candidates in one call
    async summarizeHistoryWithSalvage(history: ChatMessage[]) {
        return this.summaryService.summarizeHistoryWithSalvage(history);
    }

    async generateScenarios(character: Character, seedBrief?: string): Promise<Scenario[]> {
        return this.scenarioService.generateScenarios(character, seedBrief);
    }

    async generateImage(prompt: string): Promise<string | null> {
        return this.imageService.generateImage(prompt);
    }

    async generateCharacter(concept: string): Promise<GeneratedCharacterFields | null> {
        return this.characterService.generateCharacter(concept);
    }

    async generateCharacterField(
        character: Partial<Character>, 
        fieldName: string, 
        fieldDescription: string
    ): Promise<string | string[] | null> {
        return this.characterService.generateCharacterField(character, fieldName, fieldDescription);
    }
}
