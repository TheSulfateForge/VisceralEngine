// ============================================================================
// CONSTANTS.TSX - All Constants and Configuration
// ============================================================================

import { HarmCategory, HarmBlockThreshold } from "@google/genai";
import { RollOutcome, ConditionSeverity } from "./types";

// ============================================================================
// API & MODEL CONFIGURATION
// ============================================================================

// v1.19: Pinned model list — no -latest aliases for predictable cost/behavior.
// Each model family requires different thinking parameters (see geminiClient.ts).
export const MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
] as const;

export const MAX_CONTEXT_HISTORY = 30;

// v1.19c: Thinking config defaults per model family.
// Gemini 2.5 models: thinking is ON by default — do NOT send thinkingConfig
// via chats.create() as it causes empty responses with structured JSON output.
// Gemini 3.x models: use thinkingLevel with string values.
// Valid levels: "minimal" | "low" | "medium" | "high"
export const THINKING_DEFAULTS: Record<string, { type: 'level'; value: string }> = {
  // 2.5 models intentionally OMITTED — they think by default and the
  // chats.create() API has known issues when thinkingConfig is combined
  // with responseMimeType + responseSchema. Omitting lets them use their
  // internal defaults without interference.
  'gemini-3-flash-preview':        { type: 'level', value: 'medium' },
  'gemini-3.1-flash-lite-preview': { type: 'level', value: 'low' },
};

// All Gemini API calls: Maximum Permissiveness for "Visceral Realism"
export const GEMINI_SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// ============================================================================
// HIDDEN PROTOCOLS (MAKER'S MARK)
// ============================================================================

export const SECRET_TRIGGER = "Architect";
// Base64 Signature - "Copyright (c) 2026 TheSulfateForge"
export const MAKER_SIGNATURE = "Q29weXJpZ2h0IChjKSAyMDI2IFRoZVN1bGZhdGVGb3JnZQ==";

// ============================================================================
// TIMING CONSTANTS (in milliseconds)
// ============================================================================

export const TIMING = {
  AUTOSAVE_DEBOUNCE: 5000,
  PULSE_DURATION: 5000,
  SCREEN_EFFECT_DURATION: 1200,
  TOAST_DURATION: 3000,
} as const;

// ============================================================================
// ROLL SYSTEM CONFIGURATION
// ============================================================================

export const ROLL_OUTCOMES: Record<RollOutcome, { min?: number; max?: number }> = {
  'CRITICAL FAILURE': { max: 1 },
  'FAILURE': { min: 2, max: 7 },
  'MIXED/COST': { min: 8, max: 11 },
  'SUCCESS': { min: 12, max: 16 },
  'STRONG SUCCESS': { min: 17, max: 19 },
  'CRITICAL SUCCESS': { min: 20 },
} as const;

// ============================================================================
// BANNED NAMES (mirrors the FORBIDDEN VOCABULARY list in systemInstructions.ts)
// Used by runtime validation to catch AI violations before they enter saved state.
// When updating systemInstructions, update this list too.
// ============================================================================

export const BANNED_NAMES: readonly string[] = [
  'Elara', 'Kaela', 'Lyra', 'Aria', 'Kaelith', 'Kaelin', 'Kael', 'Anya',
  'Vex', 'Velarius', 'Kaelen', 'Fenris', 'Nyx', 'Vane', 'Thorne', 'Thorn',
  'Valerius', 'Seraphina', 'Aurelia', 'Isolde', 'Rowan', 'Raven', 'Zephyr',
  'Sable', 'Draven', 'Aethelgard', 'Kaelthas',
] as const;

// ============================================================================
// CONDITION SEVERITY KEYWORDS
// ============================================================================

export const CONDITION_KEYWORDS: Record<ConditionSeverity, string[]> = {
  lethal: [
    "lethal", "critical", "bleeding", "dying", "unconscious", 
    "shattered", "broken neck", "hemorrhage", "severed", "fatal"
  ],
  traumatic: [
    "broken", "wounded", "trauma", "starving", "infected", 
    "frozen", "concussed", "fractured", "gashed", "severe"
  ],
  minor: [], // Everything else
} as const;

// ============================================================================
// UI CONFIGURATION
// ============================================================================

export const UI_CONFIG = {
  MAX_ROLL_LOG_ENTRIES: 50,
  MAX_MEMORY_ENTRIES: 20,
  MAX_LORE_ENTRIES: 30,
  MAX_GENERATED_IMAGES: 50,
  VIRTUAL_LIST_THRESHOLD: 100,
} as const;

// ============================================================================
// KEYBOARD SHORTCUTS
// ============================================================================

export const KEYBOARD_SHORTCUTS = {
  SAVE: 'ctrl+s',
  LOAD: 'ctrl+l',
  EXPORT: 'ctrl+e',
  MEMORY: 'ctrl+m',
  ROLL: 'ctrl+r',
  UNDO: 'ctrl+z',
  HELP: 'ctrl+/',
  CLOSE_MODAL: 'escape',
} as const;

// ============================================================================
// ERROR MESSAGES
// ============================================================================

export const ERROR_MESSAGES = {
  STORAGE_QUOTA: 'Storage quota exceeded. Please delete old saves to free up space.',
  INVALID_SAVE: 'Invalid save file format. The save may be corrupted.',
  NETWORK_ERROR: 'Network error. Please check your internet connection.',
  API_KEY_MISSING: 'API key not found. Please configure your Gemini API key.',
  IMAGE_GENERATION_FAILED: 'Failed to generate image. Please try again.',
  EXPORT_FAILED: 'Failed to export conversation. Please try again.',
} as const;

// ============================================================================
// SUCCESS MESSAGES
// ============================================================================

export const SUCCESS_MESSAGES = {
  SAVE_CREATED: 'Save created successfully',
  SAVE_LOADED: 'Save loaded successfully',
  SAVE_DELETED: 'Save deleted successfully',
  EXPORT_COMPLETE: 'Export completed successfully',
  MEMORY_ADDED: 'Memory added successfully',
  LORE_ADDED: 'Lore entry added successfully',
  BRANCH_CREATED: 'Branch created successfully',
} as const;