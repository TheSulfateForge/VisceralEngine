import type { PipelineStep, TurnContext } from '../types';
import type { LoreItem, MemoryItem } from '../../../types';
import {
    findExistingLore,
    checkLoreDuplicate,
    checkMemoryDuplicate,
    autoConsolidateMemory,
    evictBySalience,
} from '../../contentValidation';
import { generateLoreId, generateMemoryId } from '../../../idUtils';
import { checkBannedMechanisms, checkAdversarialLore } from '../../engine';
import { MEMORY_CAP, DEFAULT_MEMORY_SALIENCE } from '../../../config/engineConfig';

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
        // v1.22: Process new_memories[] (preferred) and new_memory (legacy)
        // through a single code path. Each candidate is deduped against the
        // current pool AND against earlier candidates from the same turn.
        // After all candidates are processed, autoConsolidateMemory clusters
        // any near-duplicates and evictBySalience trims the pool to MEMORY_CAP.
        let finalMemory: MemoryItem[] = [...ctx.previousWorld.memory];

        const candidates: Array<{ fact: string; salience?: number; tags?: string[]; src: 'array' | 'legacy' }> = [];
        if (Array.isArray(r.new_memories)) {
            for (const m of r.new_memories) {
                if (m && typeof m.fact === 'string' && m.fact.trim().length > 0) {
                    candidates.push({
                        fact: m.fact.trim(),
                        salience: typeof m.salience === 'number' ? m.salience : undefined,
                        tags: Array.isArray(m.tags) ? m.tags.filter(t => typeof t === 'string') : undefined,
                        src: 'array',
                    });
                }
            }
        }
        if (r.new_memory && typeof r.new_memory.fact === 'string' && r.new_memory.fact.trim().length > 0) {
            // Legacy single-memory path. Treat as "default salience" so it
            // doesn't accidentally outrank intentionally-tagged entries.
            candidates.push({
                fact: r.new_memory.fact.trim(),
                salience: undefined,
                tags: undefined,
                src: 'legacy',
            });
        }

        if (candidates.length > 0) {
            ctx.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[MEMORY-WRITE-ATTEMPT] AI provided ${candidates.length} memory candidate(s) (${candidates.filter(c => c.src === 'array').length} array, ${candidates.filter(c => c.src === 'legacy').length} legacy).`,
                type: 'info',
            });

            for (const cand of candidates) {
                const clampedSalience = cand.salience !== undefined
                    ? Math.max(1, Math.min(5, Math.round(cand.salience)))
                    : DEFAULT_MEMORY_SALIENCE;

                const { isDuplicate, isUpdate, existingIndex } = checkMemoryDuplicate(cand.fact, finalMemory);

                if (isDuplicate) {
                    ctx.debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[MEMORY] Duplicate suppressed (matches #${existingIndex}): "${cand.fact.substring(0, 80)}"`,
                        type: 'info',
                    });
                    continue;
                }

                if (isUpdate) {
                    const prev = finalMemory[existingIndex];
                    finalMemory = [
                        ...finalMemory.slice(0, existingIndex),
                        {
                            id: prev.id,
                            fact: cand.fact,
                            timestamp: new Date().toISOString(),
                            // Preserve highest seen salience and union of tags so
                            // updates never demote an entry's pinning status.
                            salience: Math.max(prev.salience ?? DEFAULT_MEMORY_SALIENCE, clampedSalience),
                            tags: Array.from(new Set([...(prev.tags ?? []), ...(cand.tags ?? [])])),
                            turnCreated: prev.turnCreated ?? ctx.currentTurn,
                        },
                        ...finalMemory.slice(existingIndex + 1),
                    ];
                    ctx.debugLogs.push({
                        timestamp: new Date().toISOString(),
                        message: `[MEMORY] Updated #${existingIndex} (salience ${clampedSalience}): "${cand.fact.substring(0, 80)}"`,
                        type: 'success',
                    });
                    continue;
                }

                const newItem: MemoryItem = {
                    id: generateMemoryId(),
                    fact: cand.fact,
                    timestamp: new Date().toISOString(),
                    salience: clampedSalience,
                    tags: cand.tags && cand.tags.length > 0 ? cand.tags : undefined,
                    turnCreated: ctx.currentTurn,
                };
                finalMemory = [...finalMemory, newItem];
                ctx.debugLogs.push({
                    timestamp: new Date().toISOString(),
                    message: `[MEMORY] Engram created (s${clampedSalience}${newItem.tags ? `, tags: ${newItem.tags.join(',')}` : ''}): "${cand.fact.substring(0, 80)}"`,
                    type: 'success',
                });
            }

            // Cap enforcement: try consolidation first (cheap, semantic), then
            // fall back to salience-weighted eviction if still over.
            if (finalMemory.length > MEMORY_CAP) {
                const consolidated = autoConsolidateMemory(finalMemory, ctx.debugLogs);
                finalMemory = consolidated.length < finalMemory.length ? consolidated : finalMemory;
            }
            if (finalMemory.length > MEMORY_CAP) {
                finalMemory = evictBySalience(finalMemory, MEMORY_CAP, ctx.currentTurn, ctx.debugLogs);
            }
        }

        ctx.worldUpdate = {
            ...ctx.worldUpdate,
            memory: finalMemory
        };

        return ctx;
    }
};
