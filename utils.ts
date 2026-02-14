
// ============================================================================
// UTILS.TS - Utility Functions with Error Handling
// ============================================================================

import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { 
  CONDITION_KEYWORDS, 
  ROLL_OUTCOMES,
  SECRET_TRIGGER,
  MAKER_SIGNATURE
} from './constants';
import { 
  ConditionSeverity, 
  RollOutcome
} from './types';

// Re-export ID generators from the new isolated module
export * from './idUtils';

// ============================================================================
// MAKER'S MARK PROTOCOL
// ============================================================================

export const getMakersMark = (inputName: string): string | null => {
  if (!inputName) return null;
  
  // Case-insensitive check for the secret trigger
  if (inputName.trim().toLowerCase() === SECRET_TRIGGER.toLowerCase()) {
    try {
      // "Decryption" via Base64 decode
      return atob(MAKER_SIGNATURE);
    } catch (e) {
      console.error("Signature verification failed.");
      return null;
    }
  }
  return null;
};

// Returns the signature unconditionally for system views
export const getSystemSignature = (): string => {
  try {
    return atob(MAKER_SIGNATURE);
  } catch (e) {
    return "";
  }
};

// ============================================================================
// ERROR MAPPING (In-Universe Translation)
// ============================================================================

export const mapSystemErrorToNarrative = (error: any): string => {
  const msg = (error?.message || typeof error === 'string' ? error : '').toLowerCase();

  if (msg.includes('fetch') || msg.includes('network') || msg.includes('offline')) {
    return "⚠ Neural Link Severed. Connection lost. (Check Network)";
  }
  if (msg.includes('400') || msg.includes('404')) {
    return "⚠ Matrix Protocol Error. Request malformed.";
  }
  if (msg.includes('401') || msg.includes('403') || msg.includes('key')) {
    return "⚠ Neural Key Invalid or Expired. Re-authorization required.";
  }
  if (msg.includes('500') || msg.includes('503') || msg.includes('overloaded')) {
    return "⚠ Core Processing Overload. The host is busy. Stand by.";
  }
  if (msg.includes('safety') || msg.includes('blocked')) {
    return "⚠ Cognitive Inhibitors Engaged. Content flagged by safety protocols.";
  }
  if (msg.includes('quota') || msg.includes('storage')) {
    return "⚠ Memory Banks Full. Clear old archives (Saves) to proceed.";
  }

  return `⚠ Core Fault: ${msg || "Unknown Anomaly"}`;
};

// ============================================================================
// CONDITION SEVERITY CALCULATION
// ============================================================================

export const getConditionSeverity = (condition: string): ConditionSeverity => {
  const lower = condition.toLowerCase();
  
  if (CONDITION_KEYWORDS.lethal.some(keyword => lower.includes(keyword))) {
    return 'lethal';
  }
  
  if (CONDITION_KEYWORDS.traumatic.some(keyword => lower.includes(keyword))) {
    return 'traumatic';
  }
  
  return 'minor';
};

export const getMostSevereCondition = (conditions: string[]): ConditionSeverity => {
  if (conditions.length === 0) return 'minor';
  
  const severities = conditions.map(getConditionSeverity);
  
  if (severities.includes('lethal')) return 'lethal';
  if (severities.includes('traumatic')) return 'traumatic';
  return 'minor';
};

// ============================================================================
// ROLL SYSTEM UTILITIES
// ============================================================================

export const formatModifier = (modifier: number): string => {
  if (modifier === 0) return '';
  return modifier > 0 ? ` +${modifier}` : ` ${modifier}`;
};

export const getRollOutcome = (total: number): RollOutcome => {
  if (total <= (ROLL_OUTCOMES['CRITICAL FAILURE'].max || 0)) {
    return 'CRITICAL FAILURE';
  }
  if (total >= (ROLL_OUTCOMES['CRITICAL SUCCESS'].min || 20)) {
    return 'CRITICAL SUCCESS';
  }
  if (total <= (ROLL_OUTCOMES['FAILURE'].max || 0)) {
    return 'FAILURE';
  }
  if (total <= (ROLL_OUTCOMES['MIXED/COST'].max || 0)) {
    return 'MIXED/COST';
  }
  if (total <= (ROLL_OUTCOMES['SUCCESS'].max || 0)) {
    return 'SUCCESS';
  }
  return 'STRONG SUCCESS';
};

export const executeDiceRoll = (
  advantage: boolean = false,
  disadvantage: boolean = false
): { raw: number; final: number; advText: string } => {
  const roll1 = Math.floor(Math.random() * 20) + 1;
  
  if (!advantage && !disadvantage) {
    return { raw: roll1, final: roll1, advText: '' };
  }
  
  const roll2 = Math.floor(Math.random() * 20) + 1;
  
  if (advantage) {
    const final = Math.max(roll1, roll2);
    return { 
      raw: roll1, 
      final, 
      advText: ` [ADV: ${roll1}, ${roll2} → ${final}]` 
    };
  }
  
  // Disadvantage
  const final = Math.min(roll1, roll2);
  return { 
    raw: roll1, 
    final, 
    advText: ` [DIS: ${roll1}, ${roll2} → ${final}]` 
  };
};

// ============================================================================
// MARKDOWN SANITIZATION (XSS Prevention)
// ============================================================================

export const safeMarkdown = (markdown: string): string => {
  const html = marked.parse(markdown) as string;
  return DOMPurify.sanitize(html);
};

// ============================================================================
// DATE/TIME FORMATTING
// ============================================================================

export const formatTimestamp = (isoString: string): string => {
  try {
    return new Date(isoString).toLocaleString();
  } catch {
    return 'Invalid date';
  }
};

// ============================================================================
// FILE EXPORT UTILITIES
// ============================================================================

export const downloadFile = (
  content: string,
  filename: string,
  mimeType: string = 'text/plain'
): void => {
  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Failed to download file:', error);
    throw error;
  }
};

// ============================================================================
// DEBOUNCE UTILITY
// ============================================================================

export interface DebouncedFunction<T extends (...args: any[]) => any> {
    (...args: Parameters<T>): void;
    cancel: () => void;
}

export const debounce = <T extends (...args: any[]) => any>(
  func: T,
  wait: number
): DebouncedFunction<T> => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  
  const debounced = (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };

  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  return debounced;
};

// ============================================================================
// TEXT TRUNCATION
// ============================================================================

export const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
};
