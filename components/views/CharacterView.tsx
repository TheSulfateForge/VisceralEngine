import React, { useState } from 'react';
import { useGameStore } from '../../store';
import { useGeminiClient } from '../../hooks/useGeminiClient';
import { ImageCarousel } from '../common/ImageCarousel';
import { Character, PROFICIENCY_MODIFIERS } from '../../types';
import { getTraumaTierLabel } from '../../utils/traumaSystem';

const TraumaTierBadge: React.FC<{ trauma: number }> = ({ trauma }) => {
    const { label, tier } = getTraumaTierLabel(trauma);
    let colorClass = 'bg-green-900 text-green-400 border-green-800';

    if (tier === 'STRESSED') colorClass = 'bg-yellow-900 text-yellow-400 border-yellow-800';
    else if (tier === 'UNSTABLE') colorClass = 'bg-amber-900 text-amber-400 border-amber-800';
    else if (tier === 'DISSOCIATING') colorClass = 'bg-red-900 text-red-400 border-red-800';
    else if (tier === 'BREAKING') colorClass = 'bg-red-950 text-red-500 border-red-700 animate-pulse';

    return (
        <span className={`text-[9px] font-bold px-2 py-1 rounded border ${colorClass}`}>
            {label}
        </span>
    );
};

const SkillLevelColor = (level: string) => {
    switch (level) {
        case 'untrained': return 'bg-gray-900 border-gray-700 text-gray-500';
        case 'familiar': return 'bg-gray-800 border-gray-600 text-gray-300';
        case 'trained': return 'bg-blue-950 border-blue-700 text-blue-400';
        case 'expert': return 'bg-purple-950 border-purple-700 text-purple-400';
        case 'master': return 'bg-yellow-950 border-yellow-700 text-yellow-400';
        default: return 'bg-gray-900 border-gray-700 text-gray-400';
    }
};

const EditableList: React.FC<{
    label: string;
    items: string[];
    field: keyof Pick<Character, 'inventory' | 'conditions' | 'goals' | 'relationships'>;
    character: Character;
    setCharacter: (update: Character | ((prev: Character) => Character)) => void;
    isEditing: boolean;
    borderColor?: string;
}> = ({ label, items, field, character, setCharacter, isEditing, borderColor = 'border-red-900' }) => {
    const [newItem, setNewItem] = useState('');
    const { addPlayerRemovedCondition } = useGameStore();

    const addItem = () => {
        if (!newItem.trim()) return;
        setCharacter(prev => ({
            ...prev,
            [field]: [...prev[field], newItem.trim()]
        }));
        setNewItem('');
    };

    const removeItem = (index: number) => {
        // If the player is manually removing a condition, register it for the
        // bio engine grace period so it isn't immediately re-imposed next turn.
        if (field === 'conditions') {
            addPlayerRemovedCondition(items[index]);
        }
        setCharacter(prev => ({
            ...prev,
            [field]: prev[field].filter((_, i) => i !== index)
        }));
    };

    return (
        <section>
            <label className={`text-[11px] font-bold text-gray-400 uppercase tracking-[0.5em] block mb-8 border-l-4 ${borderColor} pl-4`}>{label}</label>
            <div className="flex flex-wrap gap-4">
                {items.map((it, i) => (
                    <span key={i} className={`px-4 py-2 text-xs border relative group ${field === 'conditions' ? 'bg-red-950/10 border-red-900/20 text-red-500' : 'bg-gray-900 border-gray-800 text-gray-400'}`}>
                        {it}
                        {isEditing && (
                             <button
                                onClick={() => removeItem(i)}
                                className="absolute -top-2 -right-2 w-4 h-4 bg-red-900 text-white rounded-full flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity z-10"
                            >
                                ×
                            </button>
                        )}
                    </span>
                ))}
                {items.length === 0 && <span className="text-gray-500 italic text-sm">No entries</span>}
            </div>
            {isEditing && (
                <div className="flex gap-2 mt-4 max-w-sm">
                    <input
                        value={newItem}
                        onChange={(e) => setNewItem(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addItem()}
                        placeholder={`Add ${label.toLowerCase()}...`}
                        className="flex-1 bg-black border border-gray-800 text-gray-300 text-xs px-3 py-2 focus:border-gray-600 outline-none"
                    />
                    <button onClick={addItem} className="px-3 py-2 bg-gray-900 border border-gray-800 text-gray-400 text-xs hover:text-white transition-colors">+</button>
                </div>
            )}
        </section>
    );
};

export const CharacterView: React.FC = () => {
    const { character, setCharacter, gameWorld, setUI } = useGameStore();
    const { handleVisualize } = useGeminiClient();
    const [isEditing, setIsEditing] = useState(false);

    const traumaPercent = character.trauma || 0;
    let traumaColor = 'bg-gray-600';
    if (traumaPercent > 30) traumaColor = 'bg-yellow-600';
    if (traumaPercent > 60) traumaColor = 'bg-orange-600';
    if (traumaPercent > 80) traumaColor = 'bg-red-600';

    return (
        <div className="p-6 md:p-20 overflow-y-auto space-y-24 max-w-6xl mx-auto w-full pt-20 lg:pt-20">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <h2 className="text-5xl md:text-7xl font-bold tracking-tighter uppercase italic text-white">Subject Matrix</h2>
                <div className="flex gap-4">
                    <button 
                        onClick={() => setIsEditing(!isEditing)}
                        className={`px-6 py-3 text-xs font-bold uppercase tracking-widest border transition-all ${
                            isEditing 
                            ? 'bg-yellow-900/20 border-yellow-900/50 text-yellow-500' 
                            : 'border-gray-800 text-gray-500 hover:border-gray-600'
                        }`}
                    >
                        {isEditing ? 'Lock Fields' : 'Edit Subject'}
                    </button>
                    <button 
                        onClick={handleVisualize} 
                        disabled={gameWorld.isGeneratingVisual}
                        className={`px-6 py-3 text-xs font-bold uppercase tracking-widest ${
                            gameWorld.isGeneratingVisual 
                            ? 'bg-gray-900 text-gray-600 animate-pulse' 
                            : 'bg-red-900 text-white hover:bg-red-700'
                        } transition-all`}
                    >
                        {gameWorld.isGeneratingVisual ? 'Rendering...' : 'Generate Portrait'}
                    </button>
                </div>
            </div>

            <div className="w-full max-w-2xl mx-auto">
                <ImageCarousel 
                    images={gameWorld.generatedImages} 
                    onOpenGallery={() => setUI({ isGalleryOpen: true })}
                    heightClass="min-h-[300px]"
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-16 md:gap-24">
                <div className="space-y-20">
                <section>
                    <label className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.5em] block mb-8 border-l-4 border-red-900 pl-4">Subject Profile</label>
                    <p className="text-3xl md:text-4xl font-bold tracking-tight text-gray-100">{character.name || "UNNAMED_ENTITY"}</p>
                    <p className="text-sm text-gray-400 mt-4 uppercase font-mono tracking-[0.3em]">{character.race} // {character.gender}</p>
                </section>

                <section>
                    <label className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.5em] block mb-8 border-l-4 border-red-900 pl-4">Trauma Monitor</label>
                    <div className="space-y-2">
                        <div className="flex justify-between items-center text-xs uppercase font-bold text-gray-500">
                            <span>Psychological Integrity</span>
                            <div className="flex items-center gap-3">
                                <span>{traumaPercent}% Destabilized</span>
                                <TraumaTierBadge trauma={traumaPercent} />
                            </div>
                        </div>
                        <div className="w-full h-4 bg-gray-900 border border-gray-800 rounded-sm overflow-hidden">
                            <div className={`h-full transition-all duration-700 ${traumaColor}`} style={{ width: `${traumaPercent}%` }}></div>
                        </div>
                        <p className="text-[10px] text-gray-500 italic">
                            {traumaPercent < 20 ? "Stable." :
                             traumaPercent < 50 ? "Shaken. Minor tremors." :
                             traumaPercent < 80 ? "Unstable. Hallucinations possible." :
                             "Broken. Cognitive collapse imminent."}
                        </p>
                    </div>
                </section>

                <section>
                    <label className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.5em] block mb-8 border-l-4 border-red-900 pl-4">Markings / Implants</label>
                    <p className="text-base font-light leading-relaxed text-gray-300 whitespace-pre-wrap">{character.notableFeatures || "None recorded"}</p>
                </section>

                <EditableList 
                    label="Equipment Manifest" 
                    items={character.inventory} 
                    field="inventory" 
                    character={character} 
                    setCharacter={setCharacter} 
                    isEditing={isEditing} 
                />

                <EditableList 
                    label="Manifest (States)" 
                    items={character.conditions} 
                    field="conditions" 
                    character={character} 
                    setCharacter={setCharacter} 
                    isEditing={isEditing}
                />
                </div>

                <div className="space-y-20">
                <section>
                    <label className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.5em] block mb-8 border-l-4 border-red-900 pl-4">Reality Anchor</label>
                    <p className="text-xl md:text-2xl italic text-red-900 font-light">{character.setting}</p>
                </section>

                <section>
                    <label className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.5em] block mb-8 border-l-4 border-red-900 pl-4">Shell Description</label>
                    <p className="text-base font-light leading-relaxed text-gray-300 whitespace-pre-wrap">{character.appearance}</p>
                </section>

                <section>
                    <label className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.5em] block mb-8 border-l-4 border-red-900 pl-4">Neural Resonance</label>
                    <p className="text-base font-light leading-relaxed text-gray-300 whitespace-pre-wrap">{character.backstory || "No history recorded"}</p>
                </section>

                <EditableList 
                    label="Relational Ties" 
                    items={character.relationships} 
                    field="relationships" 
                    character={character} 
                    setCharacter={setCharacter} 
                    isEditing={isEditing} 
                />

                <EditableList
                    label="Directives"
                    items={character.goals}
                    field="goals"
                    character={character}
                    setCharacter={setCharacter}
                    isEditing={isEditing}
                />

                {(character.skills && character.skills.length > 0) && (
                    <section>
                        <label className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.5em] block mb-8 border-l-4 border-blue-900 pl-4">Proficiencies</label>
                        <div className="flex flex-wrap gap-3">
                            {character.skills.map((skill, i) => {
                                const modifier = PROFICIENCY_MODIFIERS[skill.level];
                                const modStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;
                                const colorClass = SkillLevelColor(skill.level);
                                return (
                                    <div key={i} className={`px-3 py-2 border rounded text-xs ${colorClass}`}>
                                        <div className="font-semibold">{skill.name}</div>
                                        <div className="text-[10px] opacity-75">
                                            {skill.level} {modStr}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}
                </div>
            </div>
        </div>
    );
};