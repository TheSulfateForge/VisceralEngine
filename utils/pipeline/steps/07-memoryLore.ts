import type { PipelineStep, TurnContext } from '../types';
import type { LoreItem } from '../../../types';
import {
    findExistingLore,
    checkLoreDuplicate,
    checkMemoryDuplicate,
    autoConsolidateMemory
} from '../../contentValidation';
import { generateLoreId, generateMemoryId } from '../../../idUtils';
import { checkBannedMechanisms, checkAdversarialLore } from '../../engine';
import { MEMORY_CAP } from '../../../config/engineConfig';

/**
 * Step 7: Lore & Memory Pipeline
 *
 * Processes new lore items with semantic deduplication and adversarial checks.
 * Processes new memory fragments with deduplication and hard cap enforcement.
 */
export const memoryLoreStep: PipelineStep = {
    name: '07-memoryLore',
    execute: (ctx: TurnContext): TurnContext => {
        const r = ctx.sanitisedResponse;

        // --- Lore ---
        if (r.new_lore) {
            const { keyword, content } = r.new_lore;

            const bannedMechs = ctx.previousWorld.bannedMechanisms ?? [];
            if (checkBannedMechanisms(`${keyword} ${content}`, bannedMechs, ctx.debugLogs)) {
                ctx.debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[LORE BANNED — v1.12] "${keyword}" matches a player-rejected mechanism. Suppressed.`,
                    type: 'error'
                });
            } else if (checkAdversarialLore(keyword, content, ctx.previousWorld.lore ?? [], ctx.previousCharacter.backstory ?? '', ctx.debugLogs)) {
                // v1.19: Block adversarial lore
                // checkAdversarialLore already logs the warning
            } else {
                const exactMatch = findExistingLore(keyword, ctx.previousWorld.lore);

                if (exactMatch) {
                    const isLonger = content.length > exactMatch.content.length;
                    ctx.debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[LORE-EXACT-DUPLICATE] Keyword "${keyword}" already exists in canonical lore. ${isLonger ? 'Content is longer — flagging as expansion candidate.' : 'Content is shorter/equal — suppressing.'}`,
                        type: 'warning'
                    });

                    if (isLonger) {
                        const expansionItem: LoreItem = {
                            id: generateLoreId(),
                            keyword,
                            content,
                            timestamp: new Date().toISOString(),
                        };
                        expansionItem.semanticUpdateOf = exactMatch.id;
                        expansionItem.turnCreated = ctx.currentTurn;
                        ctx.pendingLore.push(expansionItem);
                    }
                } else {
                    const { isDuplicate, isUpdate, existingIndex } = checkLoreDuplicate(
                        keyword,
                        content,
                        ctx.previousWorld.lore
                    );

                    if (isDuplicate) {
                        ctx.debugLogs.push({
                            timestamp: new Date().toISOString(),
                            message: `[LORE SEMANTIC DUPE] "${keyword}" is too similar to existing entry "${ctx.previousWorld.lore[existingIndex]?.keyword}" (Jaccard ≥ threshold) — suppressed.`,
                            type: 'warning'
                        });
                    } else {
                        const newItem: LoreItem = {
                            id: generateLoreId(),
                            keyword,
                            content,
                            timestamp: new Date().toISOString()
                        };
                        newItem.turnCreated = ctx.currentTurn;

                        if (isUpdate) {
                            newItem.semanticUpdateOf = ctx.previousWorld.lore[existingIndex]?.id;
                        }

                        ctx.pendingLore.push(newItem);

                        ctx.debugLogs.push({
                            timestamp: new Date().toISOString(),
                            message: `[LORE] Pending: "${keyword}"${isUpdate ? ' (semantic update of existing entry)' : ''}`,
                            type: 'info'
                        });
                    }
                }
            }
        }

        // --- Memory ---
        let finalMemory = [...ctx.previousWorld.memory];

        if (r.new_memory) {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[MEMORY-WRITE-ATTEMPT] AI provided new_memory: "${r.new_memory.fact?.substring(0, 80) ?? '(empty fact)'}"`,
                type: 'info'
            });

            if (finalMemory.length >= MEMORY_CAP) {
                const consolidated = autoConsolidateMemory(finalMemory, ctx.debugLogs);
                if (consolidated.length < MEMORY_CAP) {
                    finalMemory = consolidated;
                    const { isDuplicate, isUpdate, existingIndex } = checkMemoryDuplicate(
                        r.new_memory.fact,
                        finalMemory
                    );

                    if (isDuplicate) {
                        ctx.debugLogs.push({
                            timestamp: new Date().toISOString(),
                            message: `[MEMORY] Post-consolidation duplicate suppressed: "${r.new_memory.fact.substring(0, 80)}"`,
                            type: 'info'
                        });
                    } else if (isUpdate) {
                        finalMemory[existingIndex] = {
                            id: finalMemory[existingIndex].id,
                            fact: r.new_memory.fact,
                            timestamp: new Date().toISOString()
                        };
                        ctx.debugLogs.push({
                            timestamp: new Date().toISOString(),
                            message: `[MEMORY] Post-consolidation update (supersedes #${existingIndex}): "${r.new_memory.fact.substring(0, 80)}"`,
                            type: 'success'
                        });
                    } else {
                        finalMemory = [...finalMemory, {
                            id: generateMemoryId(),
                            fact: r.new_memory.fact,
                            timestamp: new Date().toISOString()
                        }];
                        ctx.debugLogs.push({
                            timestamp: new Date().toISOString(),
                            message: `[MEMORY] Post-consolidation engram created: "${r.new_memory.fact.substring(0, 80)}"`,
                            type: 'success'
                        });
                    }
                } else {
                    ctx.debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[MEMORY] Cap reached (${MEMORY_CAP}) — consolidation unable to free slots. Fragment suppressed: "${r.new_memory.fact.substring(0, 60)}"`,
                        type: 'warning'
                    });
                }
            } else {
                const { isDuplicate, isUpdate, existingIndex } = checkMemoryDuplicate(
                    r.new_memory.fact,
                    ctx.previousWorld.memory
                );

                if (isDuplicate) {
                    ctx.debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[MEMORY] Duplicate fragment suppressed (matches fragment #${existingIndex}): "${r.new_memory.fact.substring(0, 80)}"`,
                        type: 'info'
                    });
                } else if (isUpdate) {
                    const updated = [...ctx.previousWorld.memory];
                    updated[existingIndex] = {
                        id: updated[existingIndex].id,
                        fact: r.new_memory.fact,
                        timestamp: new Date().toISOString()
                    };
                    finalMemory = updated;
                    ctx.debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[MEMORY] Fragment updated (supersedes #${existingIndex}): "${r.new_memory.fact.substring(0, 80)}"`,
                        type: 'success'
                    });
                } else {
                    finalMemory = [...ctx.previousWorld.memory, {
                        id: generateMemoryId(),
                        fact: r.new_memory.fact,
                        timestamp: new Date().toISOString()
                    }];
                    ctx.debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[MEMORY] Engram Created: "${r.new_memory.fact.substring(0, 80)}"`,
                        type: 'success'
                    });
                }
            }
        }

        ctx.worldUpdate = {
            ...ctx.worldUpdate,
            memory: finalMemory
        };

        return ctx;
    }
};
