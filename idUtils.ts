
import { MessageId, SaveId, MemoryId, LoreId, TemplateId } from './types';

// Use standard UUID if available, otherwise fall back to a high-entropy timestamp mix
export const generateUUID = (): string => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback for older environments (unlikely in modern PWA context but safe)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

export const generateMessageId = (): MessageId => {
  return generateUUID() as MessageId;
};

export const generateSaveId = (): SaveId => {
  return generateUUID() as SaveId;
};

// Constant ID for autosaves, typed correctly to avoid 'as any' casting elsewhere
export const AUTOSAVE_ID = 'autosave_slot' as SaveId;

export const generateMemoryId = (): MemoryId => {
  return `mem_${generateUUID()}` as MemoryId;
};

export const generateLoreId = (): LoreId => {
  return `lore_${generateUUID()}` as LoreId;
};

export const generateTemplateId = (): TemplateId => 
  `tmpl_${generateUUID()}` as TemplateId;