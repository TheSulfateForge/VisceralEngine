// global.d.ts
// Extends the browser Window interface with the AI Studio host bridge API.
// window.aistudio is injected by the AI Studio preview environment and provides
// key management utilities. It is undefined when running outside AI Studio.

interface AIStudioBridge {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
}

declare global {
    interface Window {
        aistudio?: AIStudioBridge;
        webkitAudioContext?: typeof AudioContext; // also used in useSensoryFX.ts
    }
}

export {};