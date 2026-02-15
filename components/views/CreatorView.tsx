import React, { useState } from 'react';
import { Character, CharacterTemplate } from '../../types';
import { ListEditor } from '../common/ListEditor';
import { useGameStore, EMPTY_CHARACTER } from '../../store';
import { useImageLoader } from '../../hooks/useImageLoader';
import { useToast } from '../providers/ToastProvider';
import { useGeminiClient } from '../../hooks/useGeminiClient';
import { AttributeInput, TextAreaInput } from '../ui/Inputs';
import { db } from '../../db';
import { generateTemplateId } from '../../idUtils';

// ---- Sub-Components ----

const PreviewImage: React.FC<{ id: string | undefined }> = ({ id }) => {
    const src = useImageLoader(id);
    if (!id || !src) return null;
    return (
        <div className="w-full max-w-md mx-auto">
            <img src={src} alt="Character Preview" className="w-full rounded border border-red-900/20" />
        </div>
    );
};

// Spark icon button for field-level AI assist
const FieldAssistButton: React.FC<{
    fieldName: string;
    fieldDescription: string;
    isGenerating: boolean;
    onGenerate: (fieldName: string, fieldDescription: string) => Promise<void>;
}> = ({ fieldName, fieldDescription, isGenerating, onGenerate }) => (
    <button
        onClick={() => onGenerate(fieldName, fieldDescription)}
        disabled={isGenerating}
        className={`ml-2 p-1 rounded transition-all ${
            isGenerating 
                ? 'text-red-900/50 animate-pulse cursor-wait' 
                : 'text-gray-600 hover:text-red-500 hover:bg-red-900/10'
        }`}
        title={`AI Generate: ${fieldName}`}
    >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M10 1a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 1zM5.05 3.05a.75.75 0 011.06 0l1.062 1.06a.75.75 0 11-1.06 1.062L5.05 4.11a.75.75 0 010-1.06zM14.95 3.05a.75.75 0 011.06 1.06l-1.06 1.062a.75.75 0 01-1.062-1.06l1.06-1.062zM3 8a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5A.75.75 0 013 8zM14 8a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5A.75.75 0 0114 8zM7.172 13.828a.75.75 0 011.06 0l1.062 1.06a.75.75 0 01-1.06 1.062l-1.062-1.06a.75.75 0 010-1.062zM10 11a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 11z"/>
            <path fillRule="evenodd" d="M10 5a1 1 0 011 1v2h2a1 1 0 110 2h-2v2a1 1 0 11-2 0v-2H7a1 1 0 110-2h2V6a1 1 0 011-1z" clipRule="evenodd"/>
        </svg>
    </button>
);

// ---- Mode Toggle ----

type CreatorMode = 'manual' | 'neural';

// ---- Main Component ----

export const CreatorView: React.FC = () => {
    const { character, setCharacter, setView, gameWorld } = useGameStore();
    const { handleGenerateScenarios, handleVisualize, handleGenerateCharacter, handleGenerateField } = useGeminiClient();
    const { showToast } = useToast();
    
    // UI State
    const [errors, setErrors] = useState<{name?: string; setting?: string}>({});
    const [mode, setMode] = useState<CreatorMode>('manual');
    const [concept, setConcept] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatingField, setGeneratingField] = useState<string | null>(null);
    const [aiFilledFields, setAiFilledFields] = useState<Set<string>>(new Set());
    
    // Template State
    const [showTemplateModal, setShowTemplateModal] = useState(false);
    const [templateName, setTemplateName] = useState('');
    const [templates, setTemplates] = useState<CharacterTemplate[]>([]);
    const [showSaveTemplate, setShowSaveTemplate] = useState(false);

    // ---- Template Methods ----

    const loadTemplates = async () => {
        try {
            const all = await db.getAllTemplates();
            setTemplates(all);
        } catch (e) {
            console.error("Failed to load templates:", e);
            showToast("Failed to load templates.", "error");
        }
    };

    const handleSaveTemplate = async () => {
        const name = templateName.trim();
        if (!name) {
            showToast("Template requires a name.", "error");
            return;
        }

        try {
            const template: CharacterTemplate = {
                id: generateTemplateId(),
                name,
                timestamp: new Date().toISOString(),
                character: {
                    name: character.name,
                    gender: character.gender,
                    appearance: character.appearance,
                    notableFeatures: character.notableFeatures,
                    race: character.race,
                    backstory: character.backstory,
                    setting: character.setting,
                    inventory: [...character.inventory],
                    relationships: [...character.relationships],
                    conditions: [...character.conditions],
                    goals: [...character.goals],
                }
            };

            await db.saveTemplate(template);
            showToast(`Template "${name}" archived.`, "success");
            setTemplateName('');
            setShowSaveTemplate(false);
        } catch (e) {
            console.error("Template save failed:", e);
            showToast("Template archive failed.", "error");
        }
    };

    const handleLoadTemplate = (template: CharacterTemplate) => {
        const t = template.character;
        setCharacter(prev => ({
            ...prev,
            name: t.name,
            gender: t.gender,
            appearance: t.appearance,
            notableFeatures: t.notableFeatures,
            race: t.race,
            backstory: t.backstory,
            setting: t.setting,
            inventory: [...t.inventory],
            relationships: [...t.relationships],
            conditions: [...t.conditions],
            goals: [...t.goals],
        }));
        setShowTemplateModal(false);
        setMode('manual'); // Switch to manual so they can edit
        showToast(`Template "${template.name}" loaded.`, "success");
    };

    const handleDeleteTemplate = async (template: CharacterTemplate) => {
        try {
            await db.deleteTemplate(template.id);
            setTemplates(prev => prev.filter(t => t.id !== template.id));
            showToast(`Template "${template.name}" purged.`, "success");
        } catch (e) {
            showToast("Delete failed.", "error");
        }
    };

    // ---- AI Generation ----

    const handleNeuralSynthesize = async () => {
        if (!concept.trim()) {
            showToast("Enter a concept to synthesize.", "error");
            return;
        }
        setIsGenerating(true);
        const success = await handleGenerateCharacter(concept);
        setIsGenerating(false);
        
        if (success) {
            // Mark all fields as AI-filled for visual feedback
            setAiFilledFields(new Set([
                'name', 'gender', 'appearance', 'notableFeatures', 
                'race', 'backstory', 'setting', 'inventory', 
                'relationships', 'conditions', 'goals'
            ]));
            // Auto-switch to manual mode so they can review/edit
            setMode('manual');
            // Clear the glow after 3 seconds
            setTimeout(() => setAiFilledFields(new Set()), 3000);
        }
    };

    const handleFieldAssist = async (fieldName: string, fieldDescription: string) => {
        setGeneratingField(fieldName);
        await handleGenerateField(fieldName, fieldDescription);
        setGeneratingField(null);
        
        // Brief highlight on the generated field
        setAiFilledFields(new Set([fieldName]));
        setTimeout(() => setAiFilledFields(prev => {
            const next = new Set(prev);
            next.delete(fieldName);
            return next;
        }), 2000);
    };

    // ---- Existing Methods (kept) ----

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

    // ---- Render Helpers ----

    // Wrapper that adds the AI assist spark button next to a field label
    const fieldGlow = (fieldName: string) => 
        aiFilledFields.has(fieldName) ? 'ring-1 ring-red-500/40 transition-all duration-1000' : '';

    return (
        <div className="h-full w-full overflow-y-auto bg-[#0a0a0a] p-6 md:p-24 space-y-16">
        <div className="max-w-4xl mx-auto space-y-12">

            {/* ---- HEADER ---- */}
            <header className="border-b border-red-900/20 pb-8 space-y-6">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                    <h2 className="text-3xl md:text-4xl font-bold italic text-white uppercase tracking-tighter">
                        Subject Profile
                    </h2>
                    <div className="flex items-center gap-3">
                        {/* Template Buttons */}
                        <button 
                            onClick={() => { loadTemplates(); setShowTemplateModal(true); }}
                            className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-gray-900 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-all"
                        >
                            Load Template
                        </button>
                        <button 
                            onClick={() => setShowSaveTemplate(true)}
                            className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-gray-900 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-all"
                        >
                            Save Template
                        </button>
                        <button 
                            onClick={() => setView('landing')} 
                            className="text-xs text-gray-500 hover:text-white uppercase font-bold tracking-widest"
                        >
                            Abort
                        </button>
                    </div>
                </div>

                {/* ---- MODE TOGGLE ---- */}
                <div className="flex items-center gap-2 justify-center">
                    <button
                        onClick={() => setMode('manual')}
                        className={`px-6 py-2 text-[10px] font-bold uppercase tracking-widest transition-all ${
                            mode === 'manual' 
                                ? 'bg-red-900/30 border border-red-800 text-red-400' 
                                : 'bg-gray-900 border border-gray-800 text-gray-500 hover:text-gray-300'
                        }`}
                    >
                        Manual Entry
                    </button>
                    <button
                        onClick={() => setMode('neural')}
                        className={`px-6 py-2 text-[10px] font-bold uppercase tracking-widest transition-all ${
                            mode === 'neural' 
                                ? 'bg-red-900/30 border border-red-800 text-red-400' 
                                : 'bg-gray-900 border border-gray-800 text-gray-500 hover:text-gray-300'
                        }`}
                    >
                        Neural Synthesis
                    </button>
                </div>
            </header>

            {/* ---- SAVE TEMPLATE INLINE PROMPT ---- */}
            {showSaveTemplate && (
                <div className="border border-gray-800 bg-gray-900/50 p-6 space-y-4">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        Archive Current Profile As Template
                    </label>
                    <div className="flex gap-3">
                        <input
                            type="text"
                            value={templateName}
                            onChange={e => setTemplateName(e.target.value)}
                            placeholder="Template name (e.g. My Hucow, Cyberpunk Medic)"
                            className="flex-1 bg-black border border-gray-700 text-white px-4 py-2 text-sm focus:border-red-900 focus:outline-none"
                            onKeyDown={e => e.key === 'Enter' && handleSaveTemplate()}
                        />
                        <button 
                            onClick={handleSaveTemplate}
                            className="px-6 py-2 text-xs font-bold uppercase tracking-widest bg-red-900/20 border border-red-900/30 text-red-500 hover:bg-red-900 hover:text-white transition-all"
                        >
                            Archive
                        </button>
                        <button 
                            onClick={() => setShowSaveTemplate(false)}
                            className="px-4 py-2 text-xs text-gray-500 hover:text-white"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* ---- NEURAL SYNTHESIS MODE ---- */}
            {mode === 'neural' && (
                <div className="space-y-6 border border-red-900/20 p-8 bg-gradient-to-b from-red-900/5 to-transparent">
                    <label className="text-[10px] font-bold text-red-400 uppercase tracking-widest block">
                        Neural Concept Input
                    </label>
                    <p className="text-xs text-gray-500">
                        Describe your character concept in natural language. The AI will generate a complete 
                        profile that you can then edit. Be as specific or vague as you want.
                    </p>
                    <textarea
                        value={concept}
                        onChange={e => setConcept(e.target.value)}
                        placeholder={`Examples:\n• "A one-armed ex-military medic surviving in a flooded cyberpunk city"\n• "Hucow farm girl who escaped her handlers, now hiding in a medieval port town"\n• "Retired hitman with early-onset dementia in 1990s Miami"\n• "Elven ranger but make it gritty and realistic, low fantasy"`}
                        className="w-full h-40 bg-black border border-red-900/30 text-white p-4 text-sm font-light leading-relaxed resize-none focus:border-red-700 focus:outline-none placeholder-gray-700"
                    />
                    <div className="flex justify-center">
                        <button
                            onClick={handleNeuralSynthesize}
                            disabled={isGenerating || !concept.trim()}
                            className={`px-10 py-3 text-xs font-bold uppercase tracking-widest transition-all ${
                                isGenerating || !concept.trim()
                                    ? 'bg-gray-900 text-gray-600 cursor-not-allowed'
                                    : 'bg-red-900/20 border border-red-800 text-red-400 hover:bg-red-900 hover:text-white'
                            }`}
                        >
                            {isGenerating ? 'Synthesizing Neural Pattern...' : 'Generate Subject Profile'}
                        </button>
                    </div>
                </div>
            )}

            {/* ---- MANUAL ENTRY MODE (always rendered, but collapsed in neural mode before generation) ---- */}
            {mode === 'manual' && (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                        <div className="space-y-6">
                            <div className={`${fieldGlow('name')}`}>
                                <div className="flex items-center">
                                    <div className="flex-1">
                                        <AttributeInput 
                                            label="Name / ID" 
                                            value={character.name} 
                                            onChange={updateChar('name')} 
                                            placeholder="Required" 
                                            className="text-xl" 
                                            tooltip="The primary designation used by the system to identify the subject."
                                            error={errors.name}
                                        />
                                    </div>
                                    <FieldAssistButton 
                                        fieldName="name" 
                                        fieldDescription="A unique character name appropriate for the setting"
                                        isGenerating={generatingField === 'name'}
                                        onGenerate={handleFieldAssist}
                                    />
                                </div>
                            </div>
                            <div className={`${fieldGlow('gender')}`}>
                                <div className="flex items-center">
                                    <div className="flex-1">
                                        <AttributeInput 
                                            label="Identity / Gender" 
                                            value={character.gender} 
                                            onChange={updateChar('gender')} 
                                            placeholder="e.g. Male, Fluid, Unknown" 
                                            tooltip="Social and biological markers influencing NPC interactions and societal role."
                                        />
                                    </div>
                                    <FieldAssistButton 
                                        fieldName="gender" 
                                        fieldDescription="Gender identity"
                                        isGenerating={generatingField === 'gender'}
                                        onGenerate={handleFieldAssist}
                                    />
                                </div>
                            </div>
                            <div className={`${fieldGlow('race')}`}>
                                <div className="flex items-center">
                                    <div className="flex-1">
                                        <AttributeInput 
                                            label="Ancestry" 
                                            value={character.race} 
                                            onChange={updateChar('race')} 
                                            placeholder="e.g. Human, Hybrid" 
                                            tooltip="Genetic stock or species defining baseline physiology."
                                        />
                                    </div>
                                    <FieldAssistButton 
                                        fieldName="race" 
                                        fieldDescription="Species or ancestry"
                                        isGenerating={generatingField === 'race'}
                                        onGenerate={handleFieldAssist}
                                    />
                                </div>
                            </div>
                            <div className={`${fieldGlow('setting')}`}>
                                <div className="flex items-center">
                                    <div className="flex-1">
                                        <AttributeInput 
                                            label="Setting Anchor" 
                                            value={character.setting} 
                                            onChange={updateChar('setting')} 
                                            placeholder="e.g. Post-Apoc, Low-Magic" 
                                            tooltip="The specific location, era, or reality frame where the simulation initializes."
                                            error={errors.setting}
                                        />
                                    </div>
                                    <FieldAssistButton 
                                        fieldName="setting" 
                                        fieldDescription="The world setting — be specific about location, era, and tone"
                                        isGenerating={generatingField === 'setting'}
                                        onGenerate={handleFieldAssist}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="space-y-6">
                            <div className={`${fieldGlow('appearance')}`}>
                                <div className="flex items-start">
                                    <div className="flex-1">
                                        <TextAreaInput 
                                            label="Biological Shell (Appearance)" 
                                            value={character.appearance} 
                                            onChange={updateChar('appearance')} 
                                            placeholder="Texture, build, eyes..." 
                                            tooltip="Physical parameters: height, build, hair, eyes."
                                        />
                                    </div>
                                    <FieldAssistButton 
                                        fieldName="appearance" 
                                        fieldDescription="Detailed physical appearance — height, build, skin, hair, eyes, distinguishing features"
                                        isGenerating={generatingField === 'appearance'}
                                        onGenerate={handleFieldAssist}
                                    />
                                </div>
                            </div>
                            <div className={`${fieldGlow('notableFeatures')}`}>
                                <div className="flex items-start">
                                    <div className="flex-1">
                                        <TextAreaInput 
                                            label="Markings / Implants" 
                                            value={character.notableFeatures} 
                                            onChange={updateChar('notableFeatures')} 
                                            placeholder="Scars, tech, anomalies..." 
                                            className="font-mono" 
                                            tooltip="Distinguishing features, battle damage, or cybernetic augmentations."
                                        />
                                    </div>
                                    <FieldAssistButton 
                                        fieldName="notableFeatures" 
                                        fieldDescription="Scars, tattoos, implants, mutations — specific visual markers"
                                        isGenerating={generatingField === 'notableFeatures'}
                                        onGenerate={handleFieldAssist}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div className={`space-y-6 ${fieldGlow('backstory')}`}>
                        <div className="flex items-start">
                            <div className="flex-1">
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
                            <FieldAssistButton 
                                fieldName="backstory" 
                                fieldDescription="3-5 sentence backstory with origin, defining events, and current situation"
                                isGenerating={generatingField === 'backstory'}
                                onGenerate={handleFieldAssist}
                            />
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 border-t border-gray-900 pt-12">
                        <ListEditor label="Gear" items={character.inventory} field="inventory" character={character} setCharacter={setCharacter} tooltip="Starting inventory." />
                        <ListEditor label="Ties" items={character.relationships} field="relationships" character={character} setCharacter={setCharacter} tooltip="Existing relationships." />
                        <ListEditor label="States" items={character.conditions} field="conditions" character={character} setCharacter={setCharacter} tooltip="Active conditions." />
                        <ListEditor label="Directives" items={character.goals} field="goals" character={character} setCharacter={setCharacter} tooltip="Core motivations." />
                    </div>
                    
                    {/* ---- PREVIEW & ACTIONS ---- */}
                    <div className="pt-8 border-t border-gray-900 space-y-6">
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Neural Manifest Preview</label>
                        <PreviewImage id={gameWorld.visualUrl} />
                        <div className="flex justify-center gap-4">
                            <button 
                                onClick={handleVisualize}
                                disabled={gameWorld.isGeneratingVisual || !character.name || !character.appearance}
                                className={`px-8 py-3 text-xs font-bold uppercase tracking-widest ${
                                    gameWorld.isGeneratingVisual || !character.name || !character.appearance
                                    ? 'bg-gray-900 text-gray-600 cursor-not-allowed'
                                    : 'bg-gray-900 border border-red-900/30 text-red-600 hover:bg-red-900 hover:text-white'
                                } transition-all`}
                            >
                                {gameWorld.isGeneratingVisual ? 'Rendering...' : 'Visualize Subject'}
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* ---- SYNCHRONIZE BUTTON (visible in both modes) ---- */}
            <div className="flex justify-center pt-8 border-t border-red-900/10">
                <button 
                    onClick={handleSynchronize}
                    disabled={gameWorld.isGeneratingScenarios}
                    className={`px-12 py-4 text-sm font-bold uppercase tracking-widest ${
                        gameWorld.isGeneratingScenarios
                        ? 'bg-gray-900 text-gray-600 cursor-not-allowed'
                        : 'bg-red-900 text-white hover:bg-red-800'
                    } transition-all`}
                >
                    {gameWorld.isGeneratingScenarios ? 'Calculating Scenarios...' : 'Synchronize Matrix'}
                </button>
            </div>
        </div>

        {/* ---- TEMPLATE LOAD MODAL ---- */}
        {showTemplateModal && (
            <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setShowTemplateModal(false)}>
                <div className="bg-[#0a0a0a] border border-gray-800 max-w-lg w-full max-h-[70vh] overflow-y-auto p-6 space-y-4" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center border-b border-gray-800 pb-4">
                        <h3 className="text-lg font-bold text-white uppercase tracking-wider">Subject Templates</h3>
                        <button onClick={() => setShowTemplateModal(false)} className="text-gray-500 hover:text-white text-xl">&times;</button>
                    </div>

                    {templates.length === 0 ? (
                        <p className="text-gray-500 text-sm text-center py-8">
                            No templates archived. Save your current profile to create one.
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {templates.map(t => (
                                <div key={t.id} className="border border-gray-800 p-4 hover:border-gray-600 transition-all group">
                                    <div className="flex justify-between items-start">
                                        <div className="flex-1 cursor-pointer" onClick={() => handleLoadTemplate(t)}>
                                            <h4 className="text-white font-bold text-sm">{t.name}</h4>
                                            <p className="text-gray-500 text-xs mt-1">
                                                {t.character.name} — {t.character.race} — {t.character.setting}
                                            </p>
                                            <p className="text-gray-600 text-[10px] mt-1">
                                                {new Date(t.timestamp).toLocaleDateString()}
                                            </p>
                                        </div>
                                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => handleLoadTemplate(t)}
                                                className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest bg-red-900/20 border border-red-900/30 text-red-500 hover:bg-red-900 hover:text-white transition-all"
                                            >
                                                Load
                                            </button>
                                            <button
                                                onClick={() => handleDeleteTemplate(t)}
                                                className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest border border-gray-700 text-gray-500 hover:bg-red-900 hover:text-white hover:border-red-800 transition-all"
                                            >
                                                Purge
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        )}

        </div>
    );
};