
import React, { useState } from 'react';
import { Character } from '../../types';

interface ListEditorProps {
    label: string;
    items: string[];
    field: keyof Pick<Character, 'inventory' | 'relationships' | 'conditions' | 'goals'>;
    character: Character;
    setCharacter: React.Dispatch<React.SetStateAction<Character>>;
    tooltip?: string;
}

export const ListEditor: React.FC<ListEditorProps> = ({ label, items, field, character, setCharacter, tooltip }) => {
    const [val, setVal] = useState('');
    
    const addItem = () => { 
        if (!val.trim()) return; 
        setCharacter((prev: Character) => ({ 
            ...prev, 
            [field]: [...prev[field], val.trim()] 
        })); 
        setVal(''); 
    };

    const removeItem = (indexToRemove: number) => {
        setCharacter((prev: Character) => ({
            ...prev,
            [field]: prev[field].filter((_, idx) => idx !== indexToRemove)
        }));
    };

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 group relative w-fit">
            <label className={`text-[10px] font-bold text-gray-400 uppercase tracking-widest text-red-900 ${tooltip ? 'cursor-help border-b border-dashed border-red-900/30' : ''}`}>
                {label}
            </label>
            {tooltip && (
                <div className="absolute left-0 bottom-full mb-2 w-56 p-3 bg-black border border-red-900/40 text-[10px] text-gray-300 leading-relaxed pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-2xl backdrop-blur-sm">
                    {tooltip}
                </div>
            )}
        </div>
        <div className="flex gap-2">
          <input 
            value={val} 
            onChange={e => setVal(e.target.value)} 
            onKeyDown={e => e.key === 'Enter' && addItem()} 
            placeholder={`Add ${label.toLowerCase()}...`} 
            className="flex-1 bg-black/40 border border-gray-900 px-3 py-2 text-xs outline-none focus:border-red-900 transition-colors text-gray-300" 
          />
          <button onClick={addItem} className="px-4 bg-red-900/10 border border-red-900/30 text-red-900 font-bold hover:bg-red-900/20 transition-colors">+</button>
        </div>
        <div className="flex flex-wrap gap-2 min-h-[2rem]">
          {items.map((it: string, i: number) => (
            <div key={i} className="flex items-center bg-gray-900 px-2 py-1 text-[11px] rounded-sm group border border-gray-800 text-gray-300">
              {it}
              <button 
                onClick={() => removeItem(i)} 
                className="ml-2 text-red-950 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-600"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    );
};
