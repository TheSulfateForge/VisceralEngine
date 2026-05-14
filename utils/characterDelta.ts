/**
 * characterDelta.ts — v1.5
 *
 * v1.3 changes:
 *   - Bio modifier ceilings from BIO_MODIFIER_CEILING are now enforced here
 *     in addition to bioEngine.ts. This closes the gap where the AI could
 *     set a modifier via character_updates that bypassed the bio engine tick.
 *
 * v1.5 changes:
 *   - FIX 3a: Mandatory Prune Gate. If the character's condition list exceeds
 *     CONDITION_PRUNE_THRESHOLD (25), new additions are BLOCKED unless the AI
 *     included enough removals this same turn. Requires MIN_REMOVALS_BEFORE_ADD (3)
 *     removals to unlock additions. This enforces the system rule mechanically
 *     rather than relying on the reminder rotation alone.
 *   - FIX 3c: Condition Replacement Rule Enforcement. When the AI proposes a new
 *     condition that is semantically equivalent to an existing condition (Jaccard ≥
 *     CONDITION_SIMILARITY_THRESHOLD), the addition is blocked unless the old version
 *     is also present in removed_conditions this turn. This prevents stacking like
 *     "Adrenaline Surge" + "Adrenaline Surge (Enhanced Physical Checks for 3 turns)"
 *     without removing the original.
 */

import { Character, CharacterUpdates } from '../types';
import { clampModifier } from './characterUtils';
import { checkConditionDuplicate } from './contentValidation';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Condition count above which the prune gate activates. */
import {
    CONDITION_PRUNE_THRESHOLD, MIN_REMOVALS_BEFORE_ADD, CONDITION_HARD_CAP, BIO_MODIFIER_CEILING
} from '../config/engineConfig';

// ---------------------------------------------------------------------------
// Main delta processor
// ---------------------------------------------------------------------------

export const processCharacterUpdates = (
    character: Character,
    updates: CharacterUpdates,
    showToast: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => void
): Character => {
    let tempCharUpdates = { ...character };
    let newConditions = [...tempCharUpdates.conditions];
    let newInventory = [...tempCharUpdates.inventory];

    // =========================================================================
    // Conditions — Removals first (always process before additions)
    // =========================================================================
    if (updates.removed_conditions?.length) {
        newConditions = newConditions.filter(c => !updates.removed_conditions!.includes(c));
        updates.removed_conditions.forEach(c => showToast(`Condition Removed: ${c}`, 'success', 6000));
    }

    // =========================================================================
    // Conditions — Additions (FIX 3a + FIX 3c)
    // =========================================================================
    if (updates.added_conditions?.length) {
        const removalCount = updates.removed_conditions?.length ?? 0;
        const currentCount = newConditions.length; // count after removals this turn

        // FIX 3a — Hard cap: block everything at or above CONDITION_HARD_CAP.
        if (currentCount >= CONDITION_HARD_CAP) {
            showToast(
                `⚠ CONDITION HARD CAP (${currentCount}/${CONDITION_HARD_CAP}) — all additions blocked until pruning occurs.`,
                'error',
                8000
            );
            // Skip ALL additions this turn — do not add any conditions.
        } else if (currentCount > CONDITION_PRUNE_THRESHOLD && removalCount < MIN_REMOVALS_BEFORE_ADD) {
            // FIX 3a — Soft gate: above threshold, require minimum removals before unlocking.
            showToast(
                `⚠ CONDITION PRUNE GATE (${currentCount}>${CONDITION_PRUNE_THRESHOLD}): ${removalCount}/${MIN_REMOVALS_BEFORE_ADD} required removals this turn. Additions blocked.`,
                'error',
                8000
            );
            // Skip ALL additions this turn.
        } else {
            // Additions are allowed — apply FIX 3c (Condition Replacement Rule) per entry.
            for (const newCond of updates.added_conditions) {
                // Exact duplicate check first (fast path).
                if (newConditions.includes(newCond)) {
                    showToast(`Condition Duplicate Suppressed: ${newCond}`, 'info', 4000);
                    continue;
                }

                // FIX 3c — Semantic duplicate check.
                const { isDuplicate, existingIndex } = checkConditionDuplicate(newCond, newConditions);

                if (isDuplicate) {
                    const existingCond = newConditions[existingIndex];
                    // Check whether the old version is also being removed this turn.
                    const oldVersionBeingRemoved = (updates.removed_conditions ?? []).includes(existingCond);

                    if (!oldVersionBeingRemoved) {
                        // Replacement rule violated: new version proposed without removing old.
                        showToast(
                            `⚠ CONDITION REPLACE VIOLATION: "${newCond}" is a duplicate of "${existingCond}" — old version must be in removed_conditions first. Addition blocked.`,
                            'error',
                            8000
                        );
                        continue; // Skip this addition.
                    }
                    // Old version is being removed — safe to add the new version.
                }

                newConditions.push(newCond);
                showToast(`Condition Added: ${newCond}`, 'error', 6000);
            }
        }
    }

    // =========================================================================
    // Inventory
    // =========================================================================
    if (updates.added_inventory?.length) {
        updates.added_inventory.forEach(i => {
            if (!newInventory.includes(i)) newInventory.push(i);
            showToast(`Item Acquired: ${i}`, 'success');
        });
    }
    if (updates.removed_inventory?.length) {
        newInventory = newInventory.filter(i => !updates.removed_inventory!.includes(i));
        updates.removed_inventory.forEach(i => showToast(`Item Lost: ${i}`, 'info'));
    }

    // =========================================================================
    // Trauma
    // =========================================================================
    let newTrauma = (tempCharUpdates.trauma || 0) + (updates.trauma_delta || 0);
    newTrauma = Math.max(0, Math.min(100, newTrauma));

    // =========================================================================
    // Bio Modifiers — clamping + ceiling enforcement
    // clampModifier(value, current) enforces the absolute min/max (0.25–4.0).
    // The additional ceiling check enforces the tighter per-stat ceilings
    // defined in contentValidation.ts (stamina max 1.5, calories/hydration max 2.0, etc.)
    // =========================================================================
    let newBioModifiers = { ...tempCharUpdates.bio.modifiers };
    if (updates.bio_modifiers) {
        if (updates.bio_modifiers.calories !== undefined) {
            const clamped = clampModifier(updates.bio_modifiers.calories, newBioModifiers.calories);
            newBioModifiers.calories = Math.min(clamped, BIO_MODIFIER_CEILING.calories);
        }
        if (updates.bio_modifiers.hydration !== undefined) {
            const clamped = clampModifier(updates.bio_modifiers.hydration, newBioModifiers.hydration);
            newBioModifiers.hydration = Math.min(clamped, BIO_MODIFIER_CEILING.hydration);
        }
        if (updates.bio_modifiers.stamina !== undefined) {
            const clamped = clampModifier(updates.bio_modifiers.stamina, newBioModifiers.stamina);
            newBioModifiers.stamina = Math.min(clamped, BIO_MODIFIER_CEILING.stamina);
        }
        if (updates.bio_modifiers.lactation !== undefined) {
            const clamped = clampModifier(updates.bio_modifiers.lactation, newBioModifiers.lactation);
            newBioModifiers.lactation = Math.min(clamped, BIO_MODIFIER_CEILING.lactation);
        }
    }

    // =========================================================================
    // Relationships & Goals
    //
    // The schema exposes BOTH a full-replacement field (`relationships`, `goals`)
    // and additive fields (`added_*`, `removed_*`). Additive operations are
    // applied on top of the (optionally replaced) baseline so the AI can:
    //   - send added_goals: ["Find the smuggler"] to append one directive
    //   - send removed_goals: ["..."] to drop a directive that was fulfilled
    //   - send goals: [...] to overhaul the whole list (rare)
    //
    // Guard rails: an empty array on the replacement field is treated as "no
    // update" rather than a wipe. This prevents the AI first turn from
    // silently nuking ties/directives the player entered in the creator.
    // =========================================================================
    let newRelationships = [...tempCharUpdates.relationships];
    if (Array.isArray(updates.relationships) && updates.relationships.length > 0) {
        newRelationships = [...updates.relationships];
    }
    if (updates.removed_relationships?.length) {
        newRelationships = newRelationships.filter(r => !updates.removed_relationships!.includes(r));
        updates.removed_relationships.forEach(r => showToast("Tie Severed: " + r, 'info', 5000));
    }
    if (updates.added_relationships?.length) {
        updates.added_relationships.forEach(r => {
            if (!newRelationships.includes(r)) {
                newRelationships.push(r);
                showToast("Tie Formed: " + r, 'success', 5000);
            }
        });
    }

    let newGoals = [...tempCharUpdates.goals];
    if (Array.isArray(updates.goals) && updates.goals.length > 0) {
        newGoals = [...updates.goals];
    }
    if (updates.removed_goals?.length) {
        newGoals = newGoals.filter(g => !updates.removed_goals!.includes(g));
        updates.removed_goals.forEach(g => showToast("Directive Resolved: " + g, 'success', 5000));
    }
    if (updates.added_goals?.length) {
        updates.added_goals.forEach(g => {
            if (!newGoals.includes(g)) {
                newGoals.push(g);
                showToast("Directive Assigned: " + g, 'success', 6000);
            }
        });
    }

    return {
        ...tempCharUpdates,
        conditions: newConditions,
        inventory: newInventory,
        trauma: newTrauma,
        bio: {
            ...tempCharUpdates.bio,
            modifiers: newBioModifiers,
        },
        relationships: newRelationships,
        goals: newGoals,
    };
};
