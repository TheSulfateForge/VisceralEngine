
import React, { useRef } from 'react';
import { MODELS } from "../../constants";

interface SettingsOverlayProps {
    currentModel: string;
    setModel: (m: string) => void;
    onReLink: () => void;
    onClose: () => void;
    onExport: () => void;
    onImport: (file: File) => void;
}

export const SettingsOverlay: React.FC<SettingsOverlayProps> = ({ currentModel, setModel, onReLink, onClose, onExport, onImport }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            onImport(file);
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
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
