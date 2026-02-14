
import React, { useState } from 'react';
import { Character } from '../../types';
import { ListEditor } from '../common/ListEditor';
import { useGameStore } from '../../store';
import { useImageLoader } from '../../hooks/useImageLoader';
import { useToast } from '../providers/ToastProvider';
import { useGeminiClient } from '../../hooks/useGeminiClient';
import { AttributeInput, TextAreaInput } from '../ui/Inputs';

// Subcomponent to handle the image loading logic cleanly
const PreviewImage: React.FC<{ id: string | undefined }> = ({ id }) => {
    const src = useImageLoader(id);
    if (!id || !src) return null;
    return (
        <div className="w-full max-w-md mx-auto">
            <img 
                src={src} 
                alt="Character Preview" 
                className="w-full rounded border border-red-900/20"
            />
        </div>
    );
};

export const CreatorView: React.FC = () => {
    const { character, setCharacter, setView, gameWorld } = useGameStore();
    const { handleGenerateScenarios, handleVisualize } = useGeminiClient();
    const { showToast } = useToast();
    const [errors, setErrors] = useState<{name?: string; setting?: string}>({});

    const handleSynchronize = async () => {
        const newErrors: {name?: string; setting?: string} = {};
        let hasError = false;

        if (!character.name.trim()) {
            newErrors.name = "Identity Required";
            hasError = true;
        }
        if (!character.setting.trim()) {
            newErrors.setting = "Anchor Required";
            hasError = true;
        }

        if (hasError) {
            setErrors(newErrors);
            showToast("Matrix synchronization failed. Mandatory fields missing.", "error");
            return;
        }

        const scenarios = await handleGenerateScenarios();
        
        if (scenarios === undefined) return;

        setView('scenario');
    };

    const updateChar = (field: keyof Character) => (val: string) => {
        setCharacter((p: Character) => ({...p, [field]: val}));
        if (errors[field as keyof typeof errors]) {
            setErrors(prev => ({ ...prev, [field]: undefined }));
        }
    };

    return (
        <div className="h-full w-full overflow-y-auto bg-[#0a0a0a] p-6 md:p-24 space-y-16">
        <div className="max-w-4xl mx-auto space-y-12">
            <header className="border-b border-red-900/20 pb-8 flex flex-col md:flex-row justify-between items-center gap-4">
            <h2 className="text-3xl md:text-4xl font-bold italic text-white uppercase tracking-tighter">Subject Profile</h2>
            <button onClick={() => setView('landing')} className="text-xs text-gray-500 hover:text-white uppercase font-bold tracking-widest">Abort</button>
            </header>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                <div className="space-y-6">
                    <AttributeInput 
                        label="Name / ID" 
                        value={character.name} 
                        onChange={updateChar('name')} 
                        placeholder="Required" 
                        className="text-xl" 
                        tooltip="The primary designation used by the system to identify the subject."
                        error={errors.name}
                    />
                    <AttributeInput 
                        label="Identity / Gender" 
                        value={character.gender} 
                        onChange={updateChar('gender')} 
                        placeholder="e.g. Male, Fluid, Unknown" 
                        tooltip="Social and biological markers influencing NPC interactions and societal role."
                    />
                    <AttributeInput 
                        label="Ancestry" 
                        value={character.race} 
                        onChange={updateChar('race')} 
                        placeholder="e.g. Human, Hybrid" 
                        tooltip="Genetic stock or species (Human, Replicant, Elf) defining baseline physiology."
                    />
                    <AttributeInput 
                        label="Setting Anchor" 
                        value={character.setting} 
                        onChange={updateChar('setting')} 
                        placeholder="e.g. Post-Apoc, Low-Magic" 
                        tooltip="The specific location, era, or reality frame where the simulation initializes."
                        error={errors.setting}
                    />
                </div>
                <div className="space-y-6">
                    <TextAreaInput 
                        label="Biological Shell (Appearance)" 
                        value={character.appearance} 
                        onChange={updateChar('appearance')} 
                        placeholder="Texture, build, eyes..." 
                        tooltip="Physical parameters: height, build, hair, eyes. Determines first impressions."
                    />
                    <TextAreaInput 
                        label="Markings / Implants" 
                        value={character.notableFeatures} 
                        onChange={updateChar('notableFeatures')} 
                        placeholder="Scars, tech, anomalies..." 
                        className="font-mono" 
                        tooltip="Distinguishing features, battle damage, or cybernetic augmentations."
                    />
                </div>
            </div>
            
            <div className="space-y-6">
                <TextAreaInput 
                    label="Neural Resonance (Backstory)" 
                    value={character.backstory} 
                    onChange={updateChar('backstory')} 
                    className="p-6 font-light leading-relaxed" 
                    placeholder="Chronological history..." 
                    heightClass="h-48"
                    tooltip="The subject's memory archives, trauma history, and defining past events."
                />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 border-t border-gray-900 pt-12">
                <ListEditor 
                    label="Gear" 
                    items={character.inventory} 
                    field="inventory" 
                    character={character} 
                    setCharacter={setCharacter} 
                    tooltip="Starting inventory. Only list significant items (weapons, key tools)."
                />
                <ListEditor 
                    label="Ties" 
                    items={character.relationships} 
                    field="relationships" 
                    character={character} 
                    setCharacter={setCharacter} 
                    tooltip="Existing relationships. Allies, rivals, or debts that anchor the subject to the world."
                />
                <ListEditor 
                    label="States" 
                    items={character.conditions} 
                    field="conditions" 
                    character={character} 
                    setCharacter={setCharacter} 
                    tooltip="Active biological or psychological conditions (e.g., Wounded, Addicted)."
                />
                <ListEditor 
                    label="Directives" 
                    items={character.goals} 
                    field="goals" 
                    character={character} 
                    setCharacter={setCharacter} 
                    tooltip="Core motivations or mission objectives driving behavior."
                />
            </div>
            
            <div className="pt-8 border-t border-gray-900 space-y-6">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Neural Manifest Preview</label>
                
                <PreviewImage id={gameWorld.visualUrl} />

                <div className="flex justify-center">
                    <button 
                    onClick={handleVisualize}
                    disabled={gameWorld.isGeneratingVisual || !character.name || !character.appearance}
                    className={`px-8 py-3 text-xs font-bold uppercase tracking-widest ${
                        gameWorld.isGeneratingVisual || !character.name || !character.appearance
                        ? 'bg-gray-900 text-gray-600 cursor-not-allowed'
                        : 'bg-gray-900 border border-red-900/30 text-red-600 hover:bg-red-900 hover:text-white'
                    } transition-all`}
                    >
                    {gameWorld.isGeneratingVisual ? 'Rendering Portrait...' : 'Generate Character Portrait'}
                    </button>
                </div>
            </div>

            <div className="pt-12 flex justify-center pb-12">
            <button 
                onClick={handleSynchronize}
                disabled={gameWorld.isGeneratingScenarios}
                className={`px-12 md:px-16 py-5 text-xs font-bold uppercase tracking-[0.5em] transition-all shadow-[0_0_30px_rgba(153,27,27,0.2)] hover:scale-105 ${
                    gameWorld.isGeneratingScenarios 
                    ? 'bg-gray-900 text-gray-500 cursor-wait' 
                    : 'bg-red-900 hover:bg-red-700 text-white'
                }`}
            >
                {gameWorld.isGeneratingScenarios ? 'Calculating Probabilities...' : 'Synchronize Matrix'}
            </button>
            </div>
        </div>
        </div>
    );
};
