
import React from 'react';
import { useGameStore } from '../../store';
import { useGeminiClient } from '../../hooks/useGeminiClient';
import { ImageCarousel } from '../common/ImageCarousel';

export const CharacterView: React.FC = () => {
    const { character, gameWorld, setIsGalleryOpen } = useGameStore();
    const { handleVisualize } = useGeminiClient();

    const traumaPercent = character.trauma || 0;
    let traumaColor = 'bg-gray-600';
    if (traumaPercent > 30) traumaColor = 'bg-yellow-600';
    if (traumaPercent > 60) traumaColor = 'bg-orange-600';
    if (traumaPercent > 80) traumaColor = 'bg-red-600';

    return (
        <div className="p-6 md:p-20 overflow-y-auto space-y-24 max-w-6xl mx-auto w-full pt-20 lg:pt-20">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <h2 className="text-5xl md:text-7xl font-bold tracking-tighter uppercase italic text-white">Subject Matrix</h2>
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

            <div className="w-full max-w-2xl mx-auto">
                <ImageCarousel 
                    images={gameWorld.generatedImages} 
                    onOpenGallery={() => setIsGalleryOpen(true)}
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
                        <div className="flex justify-between text-xs uppercase font-bold text-gray-500">
                            <span>Psychological Integrity</span>
                            <span>{traumaPercent}% Destabilized</span>
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

                <section>
                    <label className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.5em] block mb-8 border-l-4 border-red-900 pl-4">Equipment Manifest</label>
                    <div className="flex flex-wrap gap-3">
                    {character.inventory.map((item, i) => (
                        <span key={i} className="bg-gray-900 px-4 py-2 text-xs border border-gray-800 text-gray-400">{item}</span>
                    ))}
                    {character.inventory.length === 0 && <span className="text-gray-500 italic text-sm">No equipment logged</span>}
                    </div>
                </section>

                <section>
                    <label className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.5em] block mb-8 border-l-4 border-red-900 pl-4">Manifest (States)</label>
                    <div className="flex flex-wrap gap-4">
                    {character.conditions.map((it, i) => (
                        <span key={i} className="bg-red-950/10 px-5 py-2.5 text-xs border border-red-900/20 text-red-500">{it}</span>
                    ))}
                    {character.conditions.length === 0 && <span className="text-gray-500 italic text-sm">No conditions</span>}
                    </div>
                </section>
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

                <section>
                    <label className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.5em] block mb-8 border-l-4 border-red-900 pl-4">Relational Ties</label>
                    <div className="space-y-2">
                    {character.relationships.map((rel, i) => (
                        <p key={i} className="text-sm text-gray-400 border-l-2 border-gray-800 pl-3 py-1">{rel}</p>
                    ))}
                    {character.relationships.length === 0 && <span className="text-gray-500 italic text-sm">No connections</span>}
                    </div>
                </section>

                <section>
                    <label className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.5em] block mb-8 border-l-4 border-red-900 pl-4">Directives</label>
                    <div className="space-y-2">
                    {character.goals.map((goal, i) => (
                        <p key={i} className="text-sm text-gray-400 border-l-2 border-gray-800 pl-3 py-1">{goal}</p>
                    ))}
                    {character.goals.length === 0 && <span className="text-gray-500 italic text-sm">No directives set</span>}
                    </div>
                </section>
                </div>
            </div>
        </div>
    );
};
