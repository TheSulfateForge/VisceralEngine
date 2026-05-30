// ============================================================================
// DeclaredActionPicker.tsx — Time-skip declaration (v0.13, Step 5 UI)
// ----------------------------------------------------------------------------
// Self-contained trigger + popover. The player picks a montage type, duration
// (unit × quantity), and optional focus; on confirm the engine resolves the
// duration deterministically and useMontage runs the montage proposal flow.
// Time authority lives in the engine, not the AI.
// ============================================================================

import React, { useState } from 'react';
import { useMontage } from '../../hooks/useMontage';
import { MONTAGE_TYPES, DECLARED_ACTION_UNITS } from '../../types';
import type { MontageType, DeclaredActionUnit, DeclaredActionType } from '../../types';
import { formatDeclaredDuration } from '../../utils/engine/declaredActions';

const TYPE_LABELS: Record<MontageType, string> = {
    training: 'Train / Study',
    travel: 'Travel',
    aging: 'Years Pass (aging)',
    rest: 'Rest / Recover',
    work: 'Work',
};

interface Props {
    disabled?: boolean;
}

export const DeclaredActionPicker: React.FC<Props> = ({ disabled }) => {
    const { declareMontage } = useMontage();
    const [open, setOpen] = useState(false);
    const [type, setType] = useState<MontageType>('training');
    const [unit, setUnit] = useState<DeclaredActionUnit>('weeks');
    const [quantity, setQuantity] = useState(2);
    const [focus, setFocus] = useState('');

    const confirm = () => {
        const actionType = `montage:${type}` as DeclaredActionType;
        declareMontage(actionType, unit, Math.max(1, Math.round(quantity)), focus.trim() || undefined);
        setOpen(false);
        setFocus('');
    };

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                disabled={disabled}
                className={`text-[9px] font-bold uppercase tracking-widest px-4 py-2 border transition-all ${
                    disabled
                        ? 'border-gray-800 text-gray-800'
                        : 'border-purple-900/40 text-purple-500 hover:bg-purple-900 hover:text-white'
                }`}>
                ⏳ Skip Time
            </button>

            {open && (
                <div className="absolute bottom-full mb-2 right-0 w-72 bg-[#0a0a0a] border border-purple-900/40 p-4 rounded-sm shadow-2xl z-[120] space-y-3">
                    <p className="text-[9px] text-gray-500 uppercase tracking-widest">Declare a time skip</p>

                    <div>
                        <label className="text-[9px] text-gray-600 uppercase tracking-widest">Type</label>
                        <select value={type} onChange={e => setType(e.target.value as MontageType)}
                            className="w-full bg-black border border-gray-800 text-gray-300 text-xs p-2 mt-1 focus:border-purple-800 outline-none">
                            {MONTAGE_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                        </select>
                    </div>

                    <div className="flex gap-2">
                        <div className="flex-1">
                            <label className="text-[9px] text-gray-600 uppercase tracking-widest">Amount</label>
                            <input type="number" min={1} value={quantity}
                                onChange={e => setQuantity(Number(e.target.value))}
                                className="w-full bg-black border border-gray-800 text-gray-300 text-xs p-2 mt-1 focus:border-purple-800 outline-none" />
                        </div>
                        <div className="flex-1">
                            <label className="text-[9px] text-gray-600 uppercase tracking-widest">Unit</label>
                            <select value={unit} onChange={e => setUnit(e.target.value as DeclaredActionUnit)}
                                className="w-full bg-black border border-gray-800 text-gray-300 text-xs p-2 mt-1 focus:border-purple-800 outline-none">
                                {DECLARED_ACTION_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="text-[9px] text-gray-600 uppercase tracking-widest">Focus (optional)</label>
                        <input type="text" value={focus} placeholder="e.g. swordsmanship, the road north"
                            onChange={e => setFocus(e.target.value)}
                            className="w-full bg-black border border-gray-800 text-gray-300 text-xs p-2 mt-1 focus:border-purple-800 outline-none" />
                    </div>

                    <p className="text-[9px] text-gray-600">
                        Skipping <span className="text-purple-400">{formatDeclaredDuration(unit, Math.max(1, Math.round(quantity)))}</span>.
                        The AI will propose what changed; you review before anything is written.
                    </p>

                    <div className="flex gap-2">
                        <button onClick={confirm}
                            className="flex-1 py-2 bg-purple-900 text-white text-[9px] font-bold uppercase tracking-widest hover:bg-purple-700 border border-purple-800/50">
                            Begin Montage
                        </button>
                        <button onClick={() => setOpen(false)}
                            className="px-3 py-2 border border-gray-800 text-gray-500 text-[9px] font-bold uppercase tracking-widest hover:border-gray-600">
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
