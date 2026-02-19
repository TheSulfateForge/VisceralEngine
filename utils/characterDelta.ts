/**
 * characterDelta.ts — v1.3
 *
 * v1.3 changes:
 *   - Bio modifier ceilings from BIO_MODIFIER_CEILING are now enforced here
 *     in addition to bioEngine.ts. This closes the gap where the AI could
 *     set a modifier via character_updates that bypassed the bio engine tick.
 */

import { Character, CharacterUpdates } from '../types';
import { clampModifier } from './characterUtils';
import { BIO_MODIFIER_CEILING } from './contentValidation';

export const processCharacterUpdates = (
    character: Character,
    updates: CharacterUpdates,
    showToast: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => void
): Character => {
    let tempCharUpdates = { ...character };
    let newConditions = [...tempCharUpdates.conditions];
    let newInventory = [...tempCharUpdates.inventory];

    // Process Conditions
    if (updates.added_conditions?.length) {
        updates.added_conditions.forEach(c => {
            if (!newConditions.includes(c)) newConditions.push(c);
            showToast(`Condition Added: ${c}`, 'error', 6000);
        });
    }
    if (updates.removed_conditions?.length) {
        newConditions = newConditions.filter(c => !updates.removed_conditions!.includes(c));
        updates.removed_conditions.forEach(c => showToast(`Condition Removed: ${c}`, 'success', 6000));
    }

    // Process Inventory
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

    // Process Trauma
    let newTrauma = (tempCharUpdates.trauma || 0) + (updates.trauma_delta || 0);
    newTrauma = Math.max(0, Math.min(100, newTrauma));

    // Process Bio-Modifiers with CLAMPING and CEILING ENFORCEMENT
    // clampModifier() enforces the absolute min/max from characterUtils (0.25–4.0).
    // The additional ceiling check below enforces the tighter per-stat ceilings
    // defined in contentValidation.ts (stamina max 1.5, calories/hydration max 2.0, etc.)
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

    return {
        ...tempCharUpdates,
        conditions: newConditions,
        inventory: newInventory,
        trauma: newTrauma,
        bio: {
            ...tempCharUpdates.bio,
            modifiers: newBioModifiers
        },
        relationships: updates.relationships || tempCharUpdates.relationships,
        goals: updates.goals || tempCharUpdates.goals
    };
};
