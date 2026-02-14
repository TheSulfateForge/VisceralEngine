
import React, { useState } from 'react';
import { useGameStore } from '../../store';
import { getConditionSeverity, getMakersMark } from '../../utils';
import { ImageCarousel } from '../common/ImageCarousel';
import { EnvironmentWidget } from '../sidebar/EnvironmentWidget';
import { ThreatRadar } from '../sidebar/ThreatRadar';
import { RelationshipLevel } from '../../types';

const RelationshipBadge: React.FC<{ level: RelationshipLevel }> = ({ level }) => {
    let colorClass = 'bg-gray-800 text-gray-400';
    if (level === 'NEMESIS') colorClass = 'bg-red-950 text-red-500 border-red-900 animate-pulse';
    else if (level === 'HOSTILE') colorClass = 'bg-red-900/40 text-red-400 border-red-900/60';
    else if (level === 'COLD') colorClass = 'bg-blue-900/20 text-blue-300 border-blue-900/30';
    else if (level === 'NEUTRAL') colorClass = 'bg-gray-800 text-gray-400 border-gray-700';
    else if (level === 'WARM') colorClass = 'bg-green-900/20 text-green-300 border-green-900/30';
    else if (level === 'ALLIED') colorClass = 'bg-green-900/40 text-green-400 border-green-900/60';
    else if (level === 'DEVOTED') colorClass = 'bg-purple-900/40 text-purple-300 border-purple-900/60 shadow-[0_0_10px_rgba(168,85,247,0.4)]';

    return (
        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded border ${colorClass} uppercase tracking-wider`}>
            {level}
        </span>
    );
};

export const Sidebar: React.FC = () => {
    const { 
        character, 
        gameWorld, 
        gameHistory,
        activeTab, 
        setActiveTab, 
        isMobileMenuOpen, 
        setIsMobileMenuOpen,
        setView,
        setIsSettingsOpen,
        setShowSaveModal,
        setShowLoadModal,
        setIsGalleryOpen,
        setIsDebugOpen
    } = useGameStore();

    const [expandedLedgerId, setExpandedLedgerId] = useState<string | null>(null);

    const makersMark = getMakersMark(character.name);
    
    // Filter for active biological events
    // Only show if visible (Week 12+) or giving birth to prevent meta-gaming spoilers
    const activePregnancies = gameWorld.pregnancies?.filter(p => 
        ((p.status === 'gestating' && p.isVisible) || p.status === 'birth')
    ) || [];

    const activeThreats = gameWorld.activeThreats || [];
    const knownEntities = gameWorld.knownEntities || [];
    const environment = gameWorld.environment;
    const tension = gameWorld.tensionLevel || 0;
    const mode = gameWorld.sceneMode || 'NARRATIVE';

    const toggleLedger = (id: string) => {
        setExpandedLedgerId(prev => prev === id ? null : id);
    };

    const bio = character.bio || { metabolism: { calories: 80, hydration: 80, stamina: 100 }, pressures: { lactation: 0 } };
    const timeDisplay = gameWorld.time?.display || "Day 1, 09:00";

    return (
        <aside className={`
            fixed lg:static inset-y-0 left-0 z-[102] w-80 bg-[#0a0a0a] border-r border-red-900/10 flex flex-col p-6 space-y-8 
            transition-transform duration-500 lg:translate-x-0 overflow-y-auto h-full max-h-screen
            ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}>
            <div className="flex items-center justify-between mb-8 shrink-0">
                <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setView('landing')}>
                    <div className="w-3 h-3 bg-red-900 shadow-[0_0_12px_rgba(153,27,27,0.6)] animate-pulse"></div>
                    <h1 className="text-lg font-bold tracking-tighter text-white uppercase italic">Visceral</h1>
                </div>
                <button onClick={() => setIsSettingsOpen(true)} className="text-gray-400 hover:text-white transition-colors">
                    <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path fillRule="evenodd" d="M1.323 11.447C2.811 6.976 7.028 3.75 12.001 3.75c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113-1.487 4.471-5.705 7.697-10.677 7.697-4.97 0-9.186-3.223-10.675-7.69a1.762 1.762 0 010-1.113zM17.25 12a5.25 5.25 0 11-10.5 0 5.25 5.25 0 0110.5 0z" clipRule="evenodd"/></svg>
                </button>
            </div>

            <div className="bg-black/40 border border-gray-900 p-5 rounded-sm space-y-5 shadow-2xl relative mb-8 shrink-0">
                <div className="flex flex-col">
                    <div className="flex justify-between items-baseline mb-1">
                        <span className="text-[9px] font-bold text-red-900 uppercase tracking-widest">Active Matrix</span>
                        <span className="text-[9px] font-mono text-gray-500">{timeDisplay}</span>
                    </div>
                    <span className="text-sm font-bold text-gray-200 tracking-tight">{character.name || "UNNAMED_ID"}</span>
                    <div className="flex items-center gap-2 mt-2">
                         <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded border uppercase ${
                             mode === 'COMBAT' ? 'bg-red-950 text-red-500 border-red-800 animate-pulse' :
                             mode === 'TENSION' ? 'bg-yellow-950 text-yellow-500 border-yellow-800' :
                             mode === 'SOCIAL' ? 'bg-blue-950 text-blue-400 border-blue-800' :
                             'bg-gray-800 text-gray-400 border-gray-700'
                         }`}>{mode}</span>
                         <div className="flex-1 h-1 bg-gray-900 rounded-full overflow-hidden" title="Atmosphere Tension">
                            <div className={`h-full transition-all duration-1000 ${tension > 70 ? 'bg-red-600' : 'bg-gray-600'}`} style={{width: `${tension}%`}}></div>
                         </div>
                    </div>
                </div>
                
                <ImageCarousel 
                    images={gameWorld.generatedImages}
                    onOpenGallery={() => setIsGalleryOpen(true)}
                />

                <div className="space-y-2">
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Biological Manifest</span>
                    
                    {/* Bio-Bars */}
                    <div className="grid grid-cols-2 gap-2 mb-2">
                         <div>
                            <div className="flex justify-between text-[7px] text-gray-500 uppercase">
                                <span>Calories</span>
                                <span>{Math.round(bio.metabolism.calories)}%</span>
                            </div>
                            <div className="h-1 bg-gray-900 rounded-full overflow-hidden">
                                <div className={`h-full ${bio.metabolism.calories < 30 ? 'bg-red-600' : 'bg-green-700'}`} style={{width: `${bio.metabolism.calories}%`}}></div>
                            </div>
                         </div>
                         <div>
                            <div className="flex justify-between text-[7px] text-gray-500 uppercase">
                                <span>Hydration</span>
                                <span>{Math.round(bio.metabolism.hydration)}%</span>
                            </div>
                            <div className="h-1 bg-gray-900 rounded-full overflow-hidden">
                                <div className={`h-full ${bio.metabolism.hydration < 30 ? 'bg-red-600' : 'bg-blue-700'}`} style={{width: `${bio.metabolism.hydration}%`}}></div>
                            </div>
                         </div>
                    </div>

                    <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                        {character.conditions.map((c, i) => {
                            const sev = getConditionSeverity(c);
                            return (
                                <div key={i} className={`px-2.5 py-1.5 text-[8px] font-mono uppercase tracking-[0.2em] border rounded-sm flex justify-between items-center ${sev === 'lethal' ? 'bg-red-950/50 border-red-600 text-red-500 animate-pulse' : sev === 'traumatic' ? 'bg-red-900/10 border-red-900/60 text-red-700' : 'bg-gray-900 border-gray-800 text-gray-400'}`}>
                                    {c}
                                </div>
                            );
                        })}
                        {character.conditions.length === 0 && <span className="text-[8px] text-gray-500 italic">No biological compromise.</span>}
                    </div>
                </div>

                <EnvironmentWidget environment={environment} />
                <ThreatRadar threats={activeThreats} />
                
                {/* KNOWN ENTITIES / DOSSIER */}
                {knownEntities.length > 0 && (
                     <div className="space-y-2 pt-2 border-t border-gray-900">
                        <span className="text-[9px] font-bold text-blue-900/70 uppercase tracking-widest">Social Registry</span>
                        <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                            {knownEntities.map(entity => (
                                <div key={entity.id} className="bg-gray-900/30 border border-gray-800 rounded-sm hover:border-gray-600 transition-colors">
                                    <div 
                                        className="px-2.5 py-2 cursor-pointer"
                                        onClick={() => toggleLedger(entity.id)}
                                    >
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="text-[9px] font-bold text-gray-300">{entity.name}</span>
                                            <span className="text-[7px] text-gray-500 uppercase tracking-wider">{entity.role}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <RelationshipBadge level={entity.relationship_level || 'NEUTRAL'} />
                                            <span className="text-[7px] text-blue-400 italic opacity-80">{entity.impression}</span>
                                        </div>
                                    </div>
                                    
                                    {/* Expandable Ledger */}
                                    {expandedLedgerId === entity.id && (
                                        <div className="px-2.5 pb-2.5 pt-1 border-t border-gray-800 bg-black/20 animate-fade-in">
                                            <p className="text-[7px] font-bold text-gray-500 uppercase tracking-widest mb-1">Leverage</p>
                                            <p className="text-[8px] text-gray-400 italic mb-2">{entity.leverage || "None"}</p>
                                            
                                            <p className="text-[7px] font-bold text-gray-500 uppercase tracking-widest mb-1">Memory Ledger</p>
                                            {entity.ledger && entity.ledger.length > 0 ? (
                                                <ul className="space-y-1">
                                                    {entity.ledger.map((mem, idx) => (
                                                        <li key={idx} className="text-[8px] text-gray-500 leading-tight border-l border-gray-700 pl-1.5">
                                                            {mem}
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <p className="text-[8px] text-gray-500 italic">No significant memories.</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                     </div>
                )}

                {/* Independent Biological Tracker */}
                {activePregnancies.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-gray-900">
                        <span className="text-[9px] font-bold text-pink-900/70 uppercase tracking-widest animate-pulse">Gestation Tracker</span>
                        <div className="flex flex-col gap-1.5">
                            {activePregnancies.map(p => (
                                <div key={p.id} className="bg-pink-950/10 border border-pink-900/20 px-2.5 py-1.5 rounded-sm">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-[9px] text-pink-500 font-bold uppercase">{p.motherName}</span>
                                        <span className="text-[8px] text-gray-500">Week {p.currentWeek}/40</span>
                                    </div>
                                    <div className="w-full bg-gray-900 h-1 rounded-full overflow-hidden">
                                        <div 
                                            className="h-full bg-pink-900/60" 
                                            style={{ width: `${(p.currentWeek / 40) * 100}%` }}
                                        ></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <nav className="flex flex-col space-y-1 mb-8 shrink-0">
                {['chat', 'character', 'world'].map(t => (
                    <button 
                        key={t} 
                        onClick={() => { setActiveTab(t as any); setIsMobileMenuOpen(false); }} 
                        className={`text-left px-5 py-3 text-[9px] font-bold uppercase tracking-[0.3em] transition-all border-l-2 ${activeTab === t ? 'bg-red-950/10 border-red-700 text-white' : 'border-transparent text-gray-500'}`}
                    >
                        {t}
                    </button>
                ))}
            </nav>
            
            <div className="space-y-2 border-t border-gray-900 pt-6 mb-8 shrink-0">
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Save Management</label>
                <button 
                    onClick={() => setShowSaveModal(true)}
                    className="w-full py-2 bg-gray-900 border border-gray-800 text-gray-500 text-[9px] font-bold uppercase tracking-widest hover:border-red-900 hover:text-red-500 transition-all"
                >
                    Save Checkpoint
                </button>
                <button 
                    onClick={() => setShowLoadModal(true)}
                    className="w-full py-2 bg-gray-900 border border-gray-800 text-gray-500 text-[9px] font-bold uppercase tracking-widest hover:border-red-900 hover:text-red-500 transition-all"
                >
                    Load Checkpoint
                </button>
            </div>
            
            <div className="shrink-0 max-h-[300px] overflow-y-auto font-mono text-[8px] space-y-2 border-t border-gray-900 pt-6">
                <label className="text-gray-500 uppercase font-bold tracking-widest mb-3 block">Neural Audit (Fate Logs)</label>
                {gameHistory.rollLog.map((r, i) => <div key={i} className="border-l border-red-900/20 pl-3 py-1.5 text-gray-500 hover:text-red-400 transition-colors">{r}</div>)}
            </div>

            <div className="shrink-0 mt-auto pt-4 flex items-center justify-between">
                 {makersMark && (
                    <div className="animate-pulse">
                        <p className="text-[9px] font-mono text-red-900 uppercase tracking-widest border border-red-900/30 p-2 inline-block">
                            {makersMark}
                        </p>
                    </div>
                )}
                <button onClick={() => setIsDebugOpen(true)} className="text-gray-500 hover:text-red-500 transition-colors" title="Debug Console">
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                </button>
            </div>
        </aside>
    );
};
