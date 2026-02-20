// ============================================================================
// ScenarioSelectionView.tsx — 4-scenario layout with Nightmare card
// ============================================================================

import React, { useState } from 'react';
import { useGameStore } from '../../store';
import { Scenario } from '../../types';

// Scenario-specific display config
const SCENARIO_META = [
    {
        label: 'MUNDANE HOOK',
        badge: 'bg-gray-800 text-gray-400',
        border: 'border-gray-900 hover:border-red-900',
        accent: 'bg-red-900',
        glow: '',
        tag: 'Scenario 01',
    },
    {
        label: 'VIOLENT HOOK',
        badge: 'bg-gray-800 text-gray-400',
        border: 'border-gray-900 hover:border-red-900',
        accent: 'bg-red-900',
        glow: '',
        tag: 'Scenario 02',
    },
    {
        label: 'MATURE HOOK',
        badge: 'bg-gray-800 text-gray-400',
        border: 'border-gray-900 hover:border-red-900',
        accent: 'bg-red-900',
        glow: '',
        tag: 'Scenario 03',
    },
    {
        label: 'NIGHTMARE',
        badge: 'bg-red-950 text-red-400 border border-red-800',
        border: 'border-red-950 hover:border-red-600',
        accent: 'bg-red-600',
        glow: 'shadow-[inset_0_0_40px_rgba(153,27,27,0.15)]',
        tag: '⚠ SCENARIO 04',
    },
];

interface Props {
    handleSend: (msg: string) => void;
    setUI: (update: { view: string }) => void;
}

export const ScenarioSelectionView: React.FC<Props> = ({ handleSend, setUI }) => {
    const { gameWorld } = useGameStore();
    const [customEntry, setCustomEntry] = useState('');

    const scenarios: Scenario[] = gameWorld?.scenarios ? gameWorld.scenarios : [];

    const handleSelectScenario = (scenario: Scenario) => {
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
            <div className="max-w-7xl mx-auto space-y-12 relative z-10">
                <header className="space-y-4 text-center">
                    <h2 className="text-4xl md:text-5xl font-bold italic text-white uppercase tracking-tighter animate-fade-in">Select Insertion Point</h2>
                    <p className="text-xs font-mono text-red-900 uppercase tracking-[0.5em]">Probability Paths Calculated</p>
                </header>

                {/* ── Scenario Cards ── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 pt-8">
                    {scenarios.map((scenario, idx) => {
                        const meta = SCENARIO_META[idx] ?? SCENARIO_META[0];
                        const isNightmare = idx === 3;

                        return (
                            <button
                                key={idx}
                                onClick={() => handleSelectScenario(scenario)}
                                className={`
                                    group relative flex flex-col h-full bg-[#0a0a0a] border p-8
                                    transition-all duration-500 text-left
                                    hover:-translate-y-1 hover:shadow-[0_10px_40px_rgba(0,0,0,0.8)]
                                    ${meta.border} ${meta.glow}
                                    ${isNightmare ? 'ring-1 ring-red-950/60 hover:ring-red-700/60' : ''}
                                `}
                            >
                                {/* Nightmare background pulse */}
                                {isNightmare && (
                                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_100%,rgba(127,17,17,0.12),transparent)] pointer-events-none" />
                                )}

                                {/* Header badge */}
                                <span className={`
                                    text-[9px] font-bold uppercase tracking-widest mb-4 px-2 py-0.5 self-start
                                    transition-colors rounded-sm ${meta.badge}
                                    ${isNightmare ? '' : 'group-hover:text-red-600'}
                                `}>
                                    {meta.tag}
                                </span>

                                {/* Scenario type label */}
                                <span className={`
                                    text-[10px] font-mono uppercase tracking-wider mb-2
                                    ${isNightmare ? 'text-red-700' : 'text-gray-600 group-hover:text-red-800'}
                                `}>
                                    {meta.label}
                                </span>

                                {/* Title */}
                                <h3 className={`
                                    text-xl font-bold mb-4 transition-colors
                                    ${isNightmare
                                        ? 'text-red-300 group-hover:text-red-100'
                                        : 'text-gray-200 group-hover:text-white'}
                                `}>
                                    {scenario.title}
                                </h3>

                                {/* Description */}
                                <p className={`
                                    text-sm font-light leading-relaxed mb-6 flex-1
                                    ${isNightmare ? 'text-red-900/80 group-hover:text-red-800' : 'text-gray-400'}
                                `}>
                                    {scenario.description}
                                </p>

                                {/* Opening line preview */}
                                <div className={`mt-auto border-t pt-4 ${isNightmare ? 'border-red-950' : 'border-gray-900'}`}>
                                    <p className={`text-xs italic ${isNightmare ? 'text-red-800' : 'text-gray-500'}`}>
                                        "{scenario.opening_line.substring(0, 100)}..."
                                    </p>
                                </div>

                                {/* Bottom accent bar */}
                                <div className={`absolute bottom-0 left-0 h-[2px] w-0 transition-all duration-500 group-hover:w-full ${meta.accent}`}></div>
                            </button>
                        );
                    })}

                    {scenarios.length === 0 && (
                        <div className="col-span-full text-center py-12 border border-gray-900 border-dashed rounded bg-gray-900/20">
                            <p className="text-gray-500 text-sm font-mono">NO SCENARIOS GENERATED.</p>
                        </div>
                    )}
                </div>

                {/* ── Custom Entry ── */}
                <div className="border border-gray-900 p-6 space-y-4">
                    <p className="text-xs font-mono text-gray-600 uppercase tracking-widest">Custom Entry Point</p>
                    <textarea
                        value={customEntry}
                        onChange={e => setCustomEntry(e.target.value)}
                        placeholder="Describe your own starting situation..."
                        className="w-full bg-black border border-gray-800 text-gray-300 p-4 text-sm font-light resize-none h-24 focus:outline-none focus:border-red-900 placeholder-gray-700"
                    />
                    <button
                        onClick={handleCustomStart}
                        disabled={!customEntry.trim()}
                        className="px-6 py-2 border border-gray-800 text-gray-400 text-xs font-mono uppercase tracking-widest hover:border-red-900 hover:text-red-400 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        Initialize Custom Entry
                    </button>
                </div>
            </div>
        </div>
    );
};