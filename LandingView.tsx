
import React, { useEffect, useState } from 'react';
import { Character, GameState, View } from '../../types';
import { getSystemSignature } from '../../utils';
import { useGameData } from '../providers/GameContext';
import { useSavedGames } from '../../hooks/useSavedGames';

interface LandingViewProps {
    setIsSettingsOpen: (o: boolean) => void;
    handleKeyLink?: () => void;
    gameState?: GameState;
    setGameState?: React.Dispatch<React.SetStateAction<GameState>>;
    character: Character;
    setCharacter: React.Dispatch<React.SetStateAction<Character>>;
    EMPTY_CHARACTER: Character;
    setView: (v: View) => void;
    setShowLoadModal: (o: boolean) => void;
}

export const LandingView: React.FC<LandingViewProps> = ({ 
    setIsSettingsOpen, character, setCharacter, EMPTY_CHARACTER, setView, setShowLoadModal 
}) => {
    const signature = getSystemSignature();
    const { loadFromDb } = useGameData();
    const { saveList, refreshSaves } = useSavedGames(true);
    const [hasAutosave, setHasAutosave] = useState(false);

    useEffect(() => {
        const found = saveList.some(s => s.name === 'AUTOSAVE');
        setHasAutosave(found);
    }, [saveList]);

    const handleResume = async () => {
        await loadFromDb('AUTOSAVE');
    };

    return (
        <div className="flex flex-col items-center justify-center h-full w-full bg-[#050505] relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(153,27,27,0.05),transparent)] pointer-events-none"></div>

            <h1 className="text-7xl font-bold tracking-tighter uppercase italic text-red-900 animate-pulse mb-4 text-center">Visceral</h1>
            <p className="text-[10px] font-mono tracking-[0.8em] text-gray-500 uppercase mb-2 text-center">Realism Engine</p>
            <p className="text-[10px] font-mono tracking-widest text-white opacity-90 mb-12 text-center">ver. 0.7.2</p>
            
            <div className="flex flex-col space-y-3 w-64 z-10">
                {hasAutosave && (
                    <button 
                        onClick={handleResume}
                        className="w-full py-4 bg-red-900 text-white font-bold uppercase tracking-[0.2em] text-[11px] hover:bg-red-700 transition-all shadow-[0_0_20px_rgba(220,38,38,0.3)] animate-fade-in border border-red-800"
                    >
                        Resume Session
                    </button>
                )}

                <button onClick={() => { setCharacter(EMPTY_CHARACTER); setView('creator'); }} className="w-full py-4 border border-red-900/30 bg-red-950/5 hover:bg-red-900 text-red-600 hover:text-white uppercase text-[11px] font-bold tracking-widest transition-all">Start New Simulation</button>
                <button onClick={() => setShowLoadModal(true)} className="py-3 border border-gray-900 text-gray-500 uppercase text-[9px] font-bold tracking-widest hover:border-gray-700">Restore Checkpoint</button>
                <button onClick={() => setIsSettingsOpen(true)} className="py-3 border border-gray-900 text-gray-500 uppercase text-[9px] font-bold tracking-widest hover:border-gray-700">Configure Link</button>

                {signature && (
                    <div className="pt-6 flex justify-center animate-pulse">
                         <p className="text-[10px] font-mono text-yellow-300 font-bold uppercase tracking-[0.2em] drop-shadow-[0_0_10px_rgba(253,224,71,0.8)] text-center whitespace-nowrap">
                            {signature}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};
