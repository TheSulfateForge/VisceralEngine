
import React, { useState } from 'react';
import { useGameStore } from '../../store';
import { Scenario } from '../../types';
import { useGeminiClient } from '../../hooks/useGeminiClient';

export const ScenarioSelectionView: React.FC = () => {
    const { gameWorld, setUI } = useGameStore();
    const { handleSend } = useGeminiClient();
    const [customEntry, setCustomEntry] = useState('');

    // Defensive: Ensure scenarios is strictly an array before trying to render
    const scenarios = Array.isArray(gameWorld.scenarios) ? gameWorld.scenarios : [];

    const handleSelectScenario = (scenario: Scenario) => {
        // We instruct the system to start the specific scenario
        handleSend(`[SYSTEM: INITIALIZE SCENARIO: "${scenario.title}" | ${scenario.description} | Opening: ${scenario.opening_line}]`);
        setUI({ view: 'game' });
    };

    const handleCustomStart = () => {
        if (!customEntry.trim()) return;
        handleSend(customEntry);
        setUI({ view: 'game' });
    };

    return (
        <div className="h-full w-full overflow-y-auto bg-[#050505] p-6 md:p-24 relative">
             <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(153,27,27,0.05),transparent)] pointer-events-none"></div>
             <div className="max-w-6xl mx-auto space-y-12 relative z-10">
                <header className="space-y-4 text-center">
                    <h2 className="text-4xl md:text-5xl font-bold italic text-white uppercase tracking-tighter animate-fade-in">Select Insertion Point</h2>
                    <p className="text-xs font-mono text-red-900 uppercase tracking-[0.5em]">Probability Paths Calculated</p>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8">
                    {scenarios.map((scenario, idx) => (
                        <button 
                            key={idx}
                            onClick={() => handleSelectScenario(scenario)}
                            className="group relative flex flex-col h-full bg-[#0a0a0a] border border-gray-900 p-8 hover:border-red-900 transition-all duration-500 text-left hover:-translate-y-1 hover:shadow-[0_10px_40px_rgba(0,0,0,0.8)]"
                        >
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4 group-hover:text-red-600 transition-colors">Scenario 0{idx + 1}</span>
                            <h3 className="text-xl font-bold text-gray-200 mb-4 group-hover:text-white">{scenario.title}</h3>
                            <p className="text-sm text-gray-400 font-light leading-relaxed mb-6 flex-1">{scenario.description}</p>
                            <div className="mt-auto border-t border-gray-900 pt-4">
                                <p className="text-xs text-gray-500 italic">"{scenario.opening_line.substring(0, 100)}..."</p>
                            </div>
                            <div className="absolute bottom-0 left-0 h-[2px] w-0 bg-red-900 transition-all duration-500 group-hover:w-full"></div>
                        </button>
                    ))}
                    {scenarios.length === 0 && (
                        <div className="col-span-full text-center py-12 border border-gray-900 border-dashed rounded bg-gray-900/20">
                            <p className="text-gray-500 text-sm font-mono">NO SCENARIOS GENERATED. INITIALIZE MANUALLY.</p>
                        </div>
                    )}
                </div>

                <div className="pt-12 border-t border-gray-900/50">
                    <div className="max-w-3xl mx-auto space-y-6">
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block text-center">Or Initialize Manual Entry</label>
                        <div className="relative group">
                            <textarea 
                                value={customEntry}
                                onChange={(e) => setCustomEntry(e.target.value)}
                                placeholder="I wake up in the gutter, rain soaking through my coat..."
                                className="w-full bg-[#080808] border border-gray-900 p-6 text-lg text-gray-300 focus:border-red-900 outline-none min-h-[150px] transition-colors resize-none"
                            />
                            <div className="absolute bottom-4 right-4">
                                <button 
                                    onClick={handleCustomStart}
                                    disabled={!customEntry.trim()}
                                    className={`px-8 py-3 text-xs font-bold uppercase tracking-widest transition-all ${!customEntry.trim() ? 'bg-gray-900 text-gray-600 cursor-not-allowed' : 'bg-red-900 text-white hover:bg-red-700'}`}
                                >
                                    Begin Simulation
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                 <div className="text-center pt-8">
                     <button onClick={() => setUI({ view: 'creator' })} className="text-[10px] text-gray-500 hover:text-red-500 uppercase tracking-widest">
                         ← Return to Character Matrix
                     </button>
                 </div>
             </div>
        </div>
    );
};
