
import React, { useState } from 'react';
import { useGameStore } from '../../store';
import { LoreItem, MemoryItem } from '../../types';
import { generateLoreId, generateMemoryId } from '../../utils';

export const WorldView: React.FC = () => {
    const { gameWorld, setGameWorld, gameHistory } = useGameStore();
    
    // Lore State
    const [isAddingLore, setIsAddingLore] = useState(false);
    const [newKeyword, setNewKeyword] = useState('');
    const [newContent, setNewContent] = useState('');

    // Memory State
    const [isAddingMemory, setIsAddingMemory] = useState(false);
    const [newMemoryFact, setNewMemoryFact] = useState('');

    const handleAddLore = () => {
        if (!newKeyword.trim() || !newContent.trim()) return;

        const newItem: LoreItem = {
            id: generateLoreId(),
            keyword: newKeyword.trim(),
            content: newContent.trim(),
            timestamp: new Date().toISOString()
        };

        setGameWorld(prev => ({
            ...prev,
            lore: [newItem, ...prev.lore]
        }));

        setNewKeyword('');
        setNewContent('');
        setIsAddingLore(false);
    };

    const handleDeleteLore = (id: string) => {
        setGameWorld(prev => ({
            ...prev,
            lore: prev.lore.filter(l => l.id !== id)
        }));
    };

    const handleAddMemory = () => {
        if (!newMemoryFact.trim()) return;

        const newItem: MemoryItem = {
            id: generateMemoryId(),
            fact: newMemoryFact.trim(),
            timestamp: new Date().toISOString()
        };

        setGameWorld(prev => ({
            ...prev,
            memory: [newItem, ...prev.memory]
        }));

        setNewMemoryFact('');
        setIsAddingMemory(false);
    };

    const handleDeleteMemory = (id: string) => {
        setGameWorld(prev => ({
            ...prev,
            memory: prev.memory.filter(m => m.id !== id)
        }));
    };

    return (
        <div className="p-6 md:p-20 overflow-y-auto space-y-24 max-w-6xl mx-auto w-full pt-20 lg:pt-20">
            <h2 className="text-5xl md:text-7xl font-bold tracking-tighter uppercase italic text-white">Neural Chronos</h2>
            
            {/* DICE ORACLE */}
            <section className="space-y-8">
                <h3 className="text-4xl font-bold tracking-tighter uppercase italic text-white">Dice Oracle</h3>
                
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="bg-black/40 border border-gray-800 p-5 text-center">
                        <div className="text-3xl font-bold text-white">{gameHistory.rollStats.totalRolls}</div>
                        <div className="text-[9px] text-gray-500 uppercase tracking-widest mt-2">Total Rolls</div>
                    </div>
                    <div className="bg-black/40 border border-gray-800 p-5 text-center">
                        <div className="text-3xl font-bold text-yellow-500">{gameHistory.rollStats.criticalSuccesses}</div>
                        <div className="text-[9px] text-gray-500 uppercase tracking-widest mt-2">Critical Successes</div>
                    </div>
                    <div className="bg-black/40 border border-gray-800 p-5 text-center">
                        <div className="text-3xl font-bold text-red-500">{gameHistory.rollStats.criticalFailures}</div>
                        <div className="text-[9px] text-gray-500 uppercase tracking-widest mt-2">Critical Failures</div>
                    </div>
                    <div className="bg-black/40 border border-gray-800 p-5 text-center">
                        <div className="text-3xl font-bold text-gray-300">{gameHistory.rollStats.averageRoll.toFixed(1)}</div>
                        <div className="text-[9px] text-gray-500 uppercase tracking-widest mt-2">Average Roll</div>
                    </div>
                </div>

                {gameHistory.rollStats.totalRolls > 0 && (
                    <div className="space-y-3">
                        <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">Outcome Distribution</span>
                        {Object.entries(gameHistory.rollStats.outcomes).map(([outcome, rawCount]) => {
                            const count = rawCount as number;
                            const pct = gameHistory.rollStats.totalRolls > 0 
                                ? (count / gameHistory.rollStats.totalRolls) * 100 
                                : 0;
                            const color = outcome.includes('CRITICAL F') ? 'bg-red-900' 
                                : outcome.includes('FAILURE') ? 'bg-red-800/60'
                                : outcome.includes('MIXED') ? 'bg-yellow-900/60'
                                : outcome.includes('STRONG') ? 'bg-green-700'
                                : outcome.includes('CRITICAL S') ? 'bg-yellow-500'
                                : 'bg-green-900/60';
                            return (
                                <div key={outcome} className="space-y-1">
                                    <div className="flex justify-between text-[9px] uppercase font-mono text-gray-500">
                                        <span>{outcome}</span>
                                        <span>{count} ({pct.toFixed(0)}%)</span>
                                    </div>
                                    <div className="w-full h-2 bg-gray-900 rounded-sm overflow-hidden">
                                        <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* EVENT TIMELINE */}
            <section className="space-y-8 border-t border-gray-900 pt-24">
                <h3 className="text-4xl font-bold tracking-tighter uppercase italic text-white">Chronicle</h3>
                
                <div className="space-y-4 border-l-2 border-gray-800 pl-6">
                    {[
                        ...gameWorld.memory.map(m => ({ type: 'memory' as const, text: m.fact, timestamp: m.timestamp, id: m.id })),
                        ...gameWorld.lore.map(l => ({ type: 'lore' as const, text: `[${l.keyword}] ${l.content}`, timestamp: l.timestamp, id: l.id })),
                    ]
                    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                    .slice(0, 50)
                    .map(event => (
                        <div key={event.id} className="relative">
                            <div className="absolute -left-[1.85rem] top-1 w-3 h-3 rounded-full border-2 border-gray-800 bg-[#050505]">
                                <div className={`w-1.5 h-1.5 rounded-full m-auto mt-[1px] ${event.type === 'memory' ? 'bg-blue-500' : 'bg-yellow-600'}`} />
                            </div>
                            <div className="pb-4">
                                <span className="text-[8px] font-mono text-gray-600 uppercase tracking-wider">
                                    {new Date(event.timestamp).toLocaleDateString()} — {event.type}
                                </span>
                                <p className="text-sm text-gray-400 mt-1 leading-relaxed">{event.text}</p>
                            </div>
                        </div>
                    ))}
                    {gameWorld.memory.length === 0 && gameWorld.lore.length === 0 && (
                        <div className="text-gray-500 uppercase tracking-widest text-xs">No memories recorded.</div>
                    )}
                </div>
            </section>

            {/* MEMORY FRAGMENTS SECTION */}
            <section className="space-y-10 border-t border-gray-900 pt-24">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <label className="text-[14px] font-bold text-white uppercase tracking-[0.5em]">Memory Fragments (History)</label>
                    <button 
                        onClick={() => setIsAddingMemory(!isAddingMemory)}
                        className={`px-6 py-2 text-[10px] font-bold uppercase tracking-widest border transition-all ${isAddingMemory ? 'bg-red-900 text-white border-red-900' : 'bg-transparent border-gray-800 text-gray-500 hover:border-red-900 hover:text-red-900'}`}
                    >
                        {isAddingMemory ? 'Cancel Entry' : '+ Manual Entry'}
                    </button>
                </div>

                {isAddingMemory && (
                    <div className="bg-[#080808] border border-red-900/30 p-6 space-y-4 animate-fade-in shadow-xl">
                        <div className="space-y-2">
                            <label className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">Permanent Fact</label>
                            <textarea 
                                value={newMemoryFact}
                                onChange={e => setNewMemoryFact(e.target.value)}
                                className="w-full bg-black border border-gray-900 px-4 py-3 text-sm focus:border-red-900 outline-none text-gray-200 min-h-[80px] resize-none"
                                placeholder="e.g. Lost left eye in duel with The Red King. / Took Valerius as a lover."
                            />
                        </div>
                        <div className="flex justify-end pt-2">
                            <button 
                                onClick={handleAddMemory}
                                disabled={!newMemoryFact.trim()}
                                className={`px-8 py-3 text-xs font-bold uppercase tracking-widest transition-all ${(!newMemoryFact.trim()) ? 'bg-gray-900 text-gray-600 cursor-not-allowed' : 'bg-red-900 text-white hover:bg-red-800'}`}
                            >
                                Commit to Memory
                            </button>
                        </div>
                    </div>
                )}

                <div className="space-y-4">
                {gameWorld.memory.map((m) => (
                    <div key={m.id} className="group relative bg-black/40 border-l-4 border-gray-900 p-6 md:p-8 hover:border-red-900 transition-all">
                        <p className="text-base md:text-lg font-light text-gray-400 leading-relaxed italic pr-8">"{m.fact}"</p>
                        <button 
                            onClick={() => handleDeleteMemory(m.id)}
                            className="absolute top-4 right-4 text-gray-600 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all text-[10px] uppercase font-bold tracking-widest"
                        >
                            Delete
                        </button>
                    </div>
                ))}
                {gameWorld.memory.length === 0 && !isAddingMemory && <div className="text-gray-500 uppercase tracking-widest text-xs">No long-term fragments recorded.</div>}
                </div>
            </section>

            {/* WORLD LORE SECTION */}
            <section className="space-y-10 border-t border-gray-900 pt-24">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <label className="text-[14px] font-bold text-white uppercase tracking-[0.5em]">World Lore</label>
                    <button 
                        onClick={() => setIsAddingLore(!isAddingLore)}
                        className={`px-6 py-2 text-[10px] font-bold uppercase tracking-widest border transition-all ${isAddingLore ? 'bg-red-900 text-white border-red-900' : 'bg-transparent border-gray-800 text-gray-500 hover:border-red-900 hover:text-red-900'}`}
                    >
                        {isAddingLore ? 'Cancel Entry' : '+ Manual Entry'}
                    </button>
                </div>

                {isAddingLore && (
                    <div className="bg-[#080808] border border-red-900/30 p-6 space-y-4 animate-fade-in shadow-xl">
                        <div className="space-y-2">
                            <label className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">Keyword / Title</label>
                            <input 
                                value={newKeyword}
                                onChange={e => setNewKeyword(e.target.value)}
                                className="w-full bg-black border border-gray-900 px-4 py-3 text-sm focus:border-red-900 outline-none text-gray-200"
                                placeholder="e.g. THE RED FACTION"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">Lore Content</label>
                            <textarea 
                                value={newContent}
                                onChange={e => setNewContent(e.target.value)}
                                className="w-full bg-black border border-gray-900 px-4 py-3 text-sm focus:border-red-900 outline-none text-gray-200 min-h-[100px] resize-none"
                                placeholder="Describe the entity, location, or historical event..."
                            />
                        </div>
                        <div className="flex justify-end pt-2">
                            <button 
                                onClick={handleAddLore}
                                disabled={!newKeyword.trim() || !newContent.trim()}
                                className={`px-8 py-3 text-xs font-bold uppercase tracking-widest transition-all ${(!newKeyword.trim() || !newContent.trim()) ? 'bg-gray-900 text-gray-600 cursor-not-allowed' : 'bg-red-900 text-white hover:bg-red-800'}`}
                            >
                                Commit to Database
                            </button>
                        </div>
                    </div>
                )}

                <div className="space-y-6">
                {gameWorld.lore.map((l) => (
                    <div key={l.id} className="group relative bg-black/40 border-l-4 border-yellow-900/30 p-6 md:p-8 hover:border-yellow-900 transition-all">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-yellow-600 mb-4">{l.keyword}</h4>
                        <p className="text-base font-light text-gray-400 leading-relaxed whitespace-pre-wrap">{l.content}</p>
                        <button 
                            onClick={() => handleDeleteLore(l.id)}
                            className="absolute top-4 right-4 text-gray-600 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all text-[10px] uppercase font-bold tracking-widest"
                        >
                            Delete
                        </button>
                    </div>
                ))}
                {gameWorld.lore.length === 0 && !isAddingLore && <div className="text-gray-500 uppercase tracking-widest text-xs">No lore established.</div>}
                </div>
            </section>
        </div>
    );
};
