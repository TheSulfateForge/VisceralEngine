import React, { useEffect, useState } from 'react';
import { useGameStore } from '../../store';

/**
 * v1.48: the scene focus — a narration note for THIS scene, kept until the
 * location changes, so the player stops pasting the same [bracketed]
 * instruction into every turn. Also set automatically from a bracketed
 * instruction in the player's input (see utils/engine/sceneFocus).
 */
export const SceneFocusControl: React.FC<{ disabled?: boolean }> = ({ disabled }) => {
    const sceneFocus = useGameStore(s => s.gameWorld.sceneFocus);
    const location = useGameStore(s => s.gameWorld.location);
    const turnCount = useGameStore(s => s.gameHistory.turnCount);
    const setGameWorld = useGameStore(s => s.setGameWorld);

    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(sceneFocus?.text ?? '');
    const [keep, setKeep] = useState(!!sceneFocus?.keepAcrossScenes);

    useEffect(() => {
        if (!open) {
            setDraft(sceneFocus?.text ?? '');
            setKeep(!!sceneFocus?.keepAcrossScenes);
        }
    }, [sceneFocus, open]);

    const save = () => {
        const text = draft.trim();
        setGameWorld(prev => ({
            ...prev,
            sceneFocus: text
                ? { text, setTurn: turnCount ?? 0, location: prev.location ?? '', keepAcrossScenes: keep, source: 'manual' }
                : undefined,
        }));
        setOpen(false);
    };
    const clear = () => {
        setGameWorld(prev => ({ ...prev, sceneFocus: undefined }));
        setDraft('');
        setOpen(false);
    };

    const active = !!sceneFocus?.text;

    return (
        <div className="relative">
            <button
                type="button"
                disabled={disabled}
                onClick={() => setOpen(o => !o)}
                title={active ? `Scene focus: ${sceneFocus!.text}` : 'Set a narration focus for this scene'}
                className={`text-[9px] font-bold uppercase tracking-widest px-4 py-2 border transition-all disabled:opacity-30 ${active ? 'border-red-700 text-red-400 bg-red-950/20' : 'border-gray-800 text-gray-600 hover:text-gray-300 hover:border-gray-600'}`}
            >
                {active ? 'Focus ●' : 'Scene Focus'}
            </button>
            {open && (
                <div className="absolute bottom-full right-0 mb-2 w-[min(90vw,420px)] bg-[#0a0a0a] border border-gray-800 p-4 space-y-3 z-30 shadow-2xl">
                    <p className="text-[9px] text-gray-500 font-mono leading-relaxed">
                        How this scene should be written. Sent every turn until the scene moves away from
                        {' '}<span className="text-gray-300">{sceneFocus?.location || location || 'here'}</span>.
                        A [bracketed instruction] in your input sets this automatically.
                    </p>
                    <textarea
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        rows={4}
                        placeholder="e.g. Full anatomical realism — what he does, what he says, how her body responds."
                        className="w-full bg-black border border-gray-800 focus:border-red-900/60 text-gray-200 text-sm p-3 focus:outline-none resize-y"
                    />
                    <label className="flex items-center gap-2 text-[9px] text-gray-500 uppercase tracking-widest">
                        <input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} className="accent-red-900" />
                        Keep across scene changes
                    </label>
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={clear} className="text-[9px] font-bold uppercase tracking-widest px-3 py-2 border border-gray-800 text-gray-500 hover:text-gray-200">Clear</button>
                        <button type="button" onClick={save} className="text-[9px] font-bold uppercase tracking-widest px-4 py-2 border border-red-900/60 text-red-400 hover:bg-red-900 hover:text-white">Save</button>
                    </div>
                </div>
            )}
        </div>
    );
};
