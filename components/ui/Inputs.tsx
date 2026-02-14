
import React, { memo } from 'react';

export const AttributeInput: React.FC<{ 
    label: string; 
    value: string; 
    onChange: (val: string) => void; 
    placeholder?: string;
    className?: string;
    tooltip?: string;
    error?: string;
}> = memo(({ label, value, onChange, placeholder, className, tooltip, error }) => (
    <div>
        <div className="flex items-center gap-2 mb-1 group relative w-fit">
            <label className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${error ? 'text-red-500' : 'text-gray-400'} ${tooltip ? 'cursor-help border-b border-dashed border-gray-800' : ''}`}>
                {label}
            </label>
            {tooltip && (
                <div className="absolute left-0 bottom-full mb-2 w-56 p-3 bg-black border border-gray-800 text-[10px] text-gray-300 leading-relaxed pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-2xl backdrop-blur-sm">
                    {tooltip}
                </div>
            )}
        </div>
        <input 
            value={value} 
            onChange={e => onChange(e.target.value)} 
            className={`w-full bg-black border-b p-2 outline-none transition-colors ${className || 'text-lg'} ${error ? 'border-red-500 text-red-100 placeholder-red-900/50' : 'border-gray-900 focus:border-red-900 text-gray-200'}`} 
            placeholder={placeholder} 
        />
        {error && <p className="text-[10px] text-red-500 mt-1 font-mono uppercase tracking-wider animate-pulse">⚠ {error}</p>}
    </div>
));

export const TextAreaInput: React.FC<{ 
    label: string; 
    value: string; 
    onChange: (val: string) => void; 
    placeholder?: string;
    heightClass?: string;
    className?: string;
    tooltip?: string;
}> = memo(({ label, value, onChange, placeholder, heightClass, className, tooltip }) => (
    <div>
        <div className="flex items-center gap-2 mb-1 group relative w-fit">
            <label className={`text-[10px] font-bold text-gray-400 uppercase tracking-widest ${tooltip ? 'cursor-help border-b border-dashed border-gray-800' : ''}`}>
                {label}
            </label>
            {tooltip && (
                <div className="absolute left-0 bottom-full mb-2 w-56 p-3 bg-black border border-gray-800 text-[10px] text-gray-300 leading-relaxed pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-2xl backdrop-blur-sm">
                    {tooltip}
                </div>
            )}
        </div>
        <textarea 
            value={value} 
            onChange={e => onChange(e.target.value)} 
            className={`w-full bg-black/40 border border-gray-900 p-4 text-sm focus:border-red-900 outline-none resize-none text-gray-300 ${heightClass || 'h-32'} ${className || ''}`} 
            placeholder={placeholder} 
        />
    </div>
));
