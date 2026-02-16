
import { GeminiClient } from "./services/geminiClient";
import { ImageService } from "./services/imageService";
import { ScenarioService } from "./services/scenarioService";
import { CharacterService } from "./services/characterService";
import { SummaryService } from "./services/summaryService";
import { ChatMessage, Scenario, Character, GeneratedCharacterFields } from "./types";

export class GeminiService extends GeminiClient {
    private imageService: ImageService;
    private scenarioService: ScenarioService;
    private characterService: CharacterService;
    private summaryService: SummaryService;

    constructor(apiKey: string, modelName: string) {
        super(apiKey, modelName);
        this.imageService = new ImageService(this.ai);
        this.scenarioService = new ScenarioService(this);
        this.characterService = new CharacterService(this);
        this.summaryService = new SummaryService(this.ai);
    }

    // Facade Methods

    async summarizeHistory(history: ChatMessage[]): Promise<string> {
        return this.summaryService.summarizeHistory(history);
    }

    async generateScenarios(character: Character): Promise<Scenario[]> {
        return this.scenarioService.generateScenarios(character);
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
