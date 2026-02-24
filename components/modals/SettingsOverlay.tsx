
import React, { useRef, useState } from 'react';
import { MODELS } from "../../constants";

interface SettingsOverlayProps {
    currentModel: string;
    setModel: (m: string) => void;
    onReLink: () => void;
    onClose: () => void;
    onExport: () => void;
    onImport: (file: File) => void;
    onExportTemplates: () => void;
    onImportTemplates: (file: File) => void;
}

export const SettingsOverlay: React.FC<SettingsOverlayProps> = ({ currentModel, setModel, onReLink, onClose, onExport, onImport, onExportTemplates, onImportTemplates }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const templateFileInputRef = useRef<HTMLInputElement>(null);
    const [temperature, setTemperature] = useState(() => 
        parseFloat(localStorage.getItem('visceral_temperature') || '0.9')
    );
    const [fontSize, setFontSize] = useState(() => 
        localStorage.getItem('visceral_font_size') || 'xl'
    );

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            onImport(file);
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleTemplateFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            onImportTemplates(file);
        }
        if (templateFileInputRef.current) templateFileInputRef.current.value = '';
    };

    const handleTempChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseFloat(e.target.value);
        setTemperature(val);
        localStorage.setItem('visceral_temperature', val.toString());
    };

    const handleFontSizeChange = (size: string) => {
        setFontSize(size);
        localStorage.setItem('visceral_font_size', size);
    };

    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/95 backdrop-blur-sm p-6">
        <div className="w-full max-w-lg bg-[#0a0a0a] border border-red-900/20 p-8 space-y-8 relative shadow-2xl rounded-sm max-h-[90vh] overflow-y-auto">
          <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-white text-2xl font-light">×</button>
          <div className="space-y-2">
            <h3 className="text-2xl font-bold uppercase italic text-white tracking-tighter">System Configuration</h3>
            <p className="text-[10px] text-gray-600 font-mono uppercase tracking-[0.5em]">Neural Pulse & Matrix Synchronization</p>
          </div>
          <div className="space-y-6">
            <div className="space-y-3">
              <label className="text-[10px] font-bold text-gray-700 uppercase tracking-widest block">Neural Model Selection</label>
              <div className="grid grid-cols-1 gap-2">
                {MODELS.map(m => (
                  <button 
                    key={m} 
                    onClick={() => setModel(m)} 
                    className={`w-full py-3 px-4 text-left text-[11px] font-mono border transition-all ${currentModel === m ? 'bg-red-950/20 border-red-900 text-red-500' : 'bg-black border-gray-900 text-gray-500 hover:border-gray-700'}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* AI CREATIVITY */}
            <div className="space-y-3 border-t border-gray-900 pt-4">
                <label className="text-[10px] font-bold text-gray-700 uppercase tracking-widest block">AI Creativity (Temperature)</label>
                <input 
                    type="range" 
                    min="0.5" 
                    max="1.2" 
                    step="0.05"
                    value={temperature}
                    onChange={handleTempChange}
                    className="w-full accent-red-900 bg-gray-900 h-1 appearance-none rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[8px] text-gray-600 font-mono">
                    <span>Predictable (0.5)</span>
                    <span className="text-red-900 font-bold">{temperature.toFixed(2)}</span>
                    <span>Chaotic (1.2)</span>
                </div>
            </div>

            {/* NARRATIVE FONT SIZE */}
            <div className="space-y-3 border-t border-gray-900 pt-4">
                <label className="text-[10px] font-bold text-gray-700 uppercase tracking-widest block">Narrative Font Size</label>
                <div className="flex gap-2">
                    {['sm', 'base', 'lg', 'xl'].map(size => (
                        <button
                            key={size}
                            onClick={() => handleFontSizeChange(size)}
                            className={`flex-1 py-2 text-[10px] font-mono uppercase border transition-all ${
                                fontSize === size
                                ? 'bg-red-950/20 text-red-500 border-red-900/50'
                                : 'bg-gray-900 border-gray-800 text-gray-500 hover:text-gray-300'
                            }`}
                        >
                            {size}
                        </button>
                    ))}
                </div>
            </div>

            <div className="space-y-3 pt-4 border-t border-gray-900">
                <label className="text-[10px] font-bold text-gray-700 uppercase tracking-widest block">Data Preservation</label>
                <div className="flex gap-4">
                    <button onClick={onExport} className="flex-1 py-3 bg-gray-900 border border-gray-800 text-gray-400 text-[10px] font-bold uppercase tracking-widest hover:border-red-900 hover:text-white transition-all">
                        Export JSON
                    </button>
                    <button onClick={() => fileInputRef.current?.click()} className="flex-1 py-3 bg-gray-900 border border-gray-800 text-gray-400 text-[10px] font-bold uppercase tracking-widest hover:border-red-900 hover:text-white transition-all">
                        Import JSON
                    </button>
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleFileChange} 
                        className="hidden" 
                        accept=".json"
                    />
                </div>
            </div>

            <div className="space-y-3 pt-4 border-t border-gray-900">
                <label className="text-[10px] font-bold text-gray-700 uppercase tracking-widest block">Subject Templates</label>
                <p className="text-[9px] text-gray-600 font-mono leading-relaxed">
                    Back up or share your character templates. Export saves all archived templates to a JSON file. Import merges templates from file — duplicates by name are overwritten.
                </p>
                <div className="flex gap-4">
                    <button onClick={onExportTemplates} className="flex-1 py-3 bg-gray-900 border border-gray-800 text-gray-400 text-[10px] font-bold uppercase tracking-widest hover:border-red-900 hover:text-white transition-all">
                        Export Templates
                    </button>
                    <button onClick={() => templateFileInputRef.current?.click()} className="flex-1 py-3 bg-gray-900 border border-gray-800 text-gray-400 text-[10px] font-bold uppercase tracking-widest hover:border-red-900 hover:text-white transition-all">
                        Import Templates
                    </button>
                    <input
                        type="file"
                        ref={templateFileInputRef}
                        onChange={handleTemplateFileChange}
                        className="hidden"
                        accept=".json"
                    />
                </div>
            </div>

            <div className="space-y-3 pt-4 border-t border-gray-900">
              <label className="text-[10px] font-bold text-gray-700 uppercase tracking-widest block">Neural Link Status</label>
              <button onClick={onReLink} className="w-full py-4 bg-red-950/20 border border-red-900/30 text-red-600 text-[10px] font-bold uppercase tracking-widest hover:bg-red-900 hover:text-white transition-all shadow-[0_0_15px_rgba(153,27,27,0.1)]">
                Refresh Matrix Connection
              </button>
              <div className="text-center mt-2">
                 <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="text-[8px] text-gray-700 hover:text-red-900 uppercase tracking-widest underline underline-offset-2">Core Billing Docs</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
};
