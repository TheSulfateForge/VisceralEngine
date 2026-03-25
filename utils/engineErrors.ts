export type EngineErrorCategory =
  | 'API_ERROR'
  | 'PARSE_ERROR'
  | 'VALIDATION_ERROR'
  | 'STORAGE_ERROR'
  | 'STATE_ERROR'
  | 'GENERATION_ERROR';

export interface EngineError {
  category: EngineErrorCategory;
  message: string;
  technicalDetail: string;
  recoverable: boolean;
  suggestedAction?: string;
  originalError?: unknown;
}

export function classifyError(error: unknown, context: string): EngineError {
  // Classify based on:
  // - Google GenAI errors (check for GoogleGenerativeAIError, status codes in message)
  // - 401/403 → API_ERROR, "Check your API key", recoverable
  // - 429 → API_ERROR, "Try again in a moment", recoverable
  // - 500/503 → API_ERROR, "Service temporarily unavailable", recoverable
  // - SyntaxError → PARSE_ERROR, "AI returned invalid data", recoverable (retry)
  // - DOMException → STORAGE_ERROR, "Storage error", recoverable
  // - TypeError with "Cannot read properties" → STATE_ERROR
  // - Default: GENERATION_ERROR

  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorName = error instanceof Error ? error.name : '';

  // API errors
  if (
    errorMessage.includes('API key not valid') ||
    errorMessage.includes('401') ||
    errorMessage.includes('403')
  ) {
    return {
      category: 'API_ERROR',
      message: 'API key invalid or expired.',
      technicalDetail: `[${context}] ${errorMessage}`,
      recoverable: true,
      suggestedAction: 'Check your API key in settings.',
      originalError: error,
    };
  }
  if (
    errorMessage.includes('429') ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('quota')
  ) {
    return {
      category: 'API_ERROR',
      message: 'Rate limit reached.',
      technicalDetail: `[${context}] ${errorMessage}`,
      recoverable: true,
      suggestedAction: 'Try again in a moment.',
      originalError: error,
    };
  }
  if (
    errorMessage.includes('500') ||
    errorMessage.includes('503') ||
    errorMessage.includes('unavailable') ||
    errorMessage.includes('Requested entity was not found')
  ) {
    return {
      category: 'API_ERROR',
      message: 'AI service temporarily unavailable.',
      technicalDetail: `[${context}] ${errorMessage}`,
      recoverable: true,
      suggestedAction: 'Try again in a moment.',
      originalError: error,
    };
  }
  if (
    errorMessage.includes('network') ||
    errorMessage.includes('fetch') ||
    errorMessage.includes('CORS') ||
    errorMessage.includes('Failed to fetch')
  ) {
    return {
      category: 'API_ERROR',
      message: 'Network connection failed.',
      technicalDetail: `[${context}] ${errorMessage}`,
      recoverable: true,
      suggestedAction: 'Check your internet connection.',
      originalError: error,
    };
  }

  // Parse errors
  if (
    error instanceof SyntaxError ||
    errorMessage.includes('JSON') ||
    errorMessage.includes('parse')
  ) {
    return {
      category: 'PARSE_ERROR',
      message: 'AI returned invalid data.',
      technicalDetail: `[${context}] ${errorMessage}`,
      recoverable: true,
      suggestedAction:
        'Try again — the AI occasionally produces malformed output.',
      originalError: error,
    };
  }

  // Storage errors
  if (
    error instanceof DOMException ||
    errorMessage.includes('IndexedDB') ||
    errorMessage.includes('storage') ||
    errorMessage.includes('quota exceeded')
  ) {
    return {
      category: 'STORAGE_ERROR',
      message: 'Storage operation failed.',
      technicalDetail: `[${context}] ${errorMessage}`,
      recoverable: true,
      suggestedAction: 'Check available storage space.',
      originalError: error,
    };
  }

  // State errors
  if (
    errorMessage.includes('Cannot read properties') ||
    errorMessage.includes('undefined') ||
    errorMessage.includes('null')
  ) {
    return {
      category: 'STATE_ERROR',
      message: 'Unexpected state error.',
      technicalDetail: `[${context}] ${errorMessage}`,
      recoverable: false,
      originalError: error,
    };
  }

  // Default: generation error
  return {
    category: 'GENERATION_ERROR',
    message: `${context.replace(/_/g, ' ')} failed.`,
    technicalDetail: `[${context}] ${errorMessage}`,
    recoverable: true,
    suggestedAction: 'Try again.',
    originalError: error,
  };
}

// Import the DebugLogEntry type
import type { DebugLogEntry } from '../types';

export function toDebugLogEntry(err: EngineError): DebugLogEntry {
  return {
    timestamp: new Date().toISOString(),
    message: `[${err.category}] ${err.technicalDetail}`,
    type: 'error',
  };
}
