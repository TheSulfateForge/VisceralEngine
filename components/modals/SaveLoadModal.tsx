
import React from 'react';
import { SaveMetadata } from '../../types';

interface SaveLoadModalProps {
  show: boolean;
  onClose: () => void;
  mode: 'save' | 'load';
  savedGames: SaveMetadata[];
  onSave: () => void;
  onLoad: (name: string) => void;
  onDelete: (name: string) => void;
  saveName: string;
  setSaveName: (name: string) => void;
}

export const SaveLoadModal: React.FC<SaveLoadModalProps> = ({ show, onClose, mode, savedGames, onSave, onLoad, onDelete, saveName, setSaveName }) => {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/95 backdrop-blur-sm p-6">
      <div className="w-full max-w-md bg-[#0a0a0a] border border-red-900/20 p-8 space-y-6 relative shadow-2xl rounded-sm">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-white text-2xl font-light">×</button>
        <h3 className="text-2xl font-bold uppercase italic text-white tracking-tighter">
          {mode === 'save' ? 'Save Checkpoint' : 'Load Checkpoint'}
        </h3>

        {mode === 'save' && (
          <div className="space-y-4">
            <input 
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSave()}
              placeholder="Enter save name..."
              className="w-full bg-black border border-gray-900 px-4 py-3 text-gray-200 focus:border-red-900 outline-none"
              autoFocus
            />
            <button 
              onClick={onSave}
              disabled={!saveName.trim()}
              className={`w-full py-3 uppercase text-xs font-bold tracking-widest ${
                saveName.trim() 
                  ? 'bg-red-900 text-white hover:bg-red-700' 
                  : 'bg-gray-900 text-gray-600 cursor-not-allowed'
              } transition-all`}
            >
              Create Save
            </button>
          </div>
        )}

        {mode === 'load' && (
          <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
            {savedGames.length === 0 ? (
              <p className="text-gray-600 text-center py-8 italic">No saved games found</p>
            ) : (
              savedGames.map(save => (
                <div key={save.id} className="flex items-center justify-between bg-gray-900/50 border border-gray-800 p-3 hover:border-red-900/50 transition-all group">
                  <button 
                    onClick={() => onLoad(save.name)}
                    className="flex-1 text-left flex flex-col gap-1"
                  >
                    <span className="text-gray-300 group-hover:text-white uppercase text-xs tracking-widest font-bold">
                      {save.name}
                    </span>
                    <span className="text-[9px] text-gray-600 font-mono">
                      {new Date(save.timestamp).toLocaleString()}
                    </span>
                  </button>
                  <button 
                    onClick={() => onDelete(save.name)}
                    className="ml-4 px-3 py-1 bg-red-900/20 hover:bg-red-900/40 text-red-600 rounded text-[9px] uppercase tracking-widest opacity-50 group-hover:opacity-100 transition-opacity"
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};