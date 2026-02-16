
import { Character, CharacterUpdates } from '../types';
import { clampModifier } from './characterUtils';

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

    // Process Bio-Modifiers (Merging with existing) with CLAMPING
    let newBioModifiers = { ...tempCharUpdates.bio.modifiers };
    if (updates.bio_modifiers) {
        if (updates.bio_modifiers.calories !== undefined) 
            newBioModifiers.calories = clampModifier(updates.bio_modifiers.calories, newBioModifiers.calories);
        if (updates.bio_modifiers.hydration !== undefined) 
            newBioModifiers.hydration = clampModifier(updates.bio_modifiers.hydration, newBioModifiers.hydration);
        if (updates.bio_modifiers.stamina !== undefined) 
            newBioModifiers.stamina = clampModifier(updates.bio_modifiers.stamina, newBioModifiers.stamina);
        if (updates.bio_modifiers.lactation !== undefined) 
            newBioModifiers.lactation = clampModifier(updates.bio_modifiers.lactation, newBioModifiers.lactation);
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
