import React, { useState } from 'react';
import type { WorldSeed, WorldSeedId } from '../../types';
import { useGeminiService } from '../../hooks/useGeminiService';
import { useToast } from '../providers/ToastProvider';
import { WorldService } from '../../services/worldService';

interface WorldForgeProps {
  show: boolean;
  onClose: () => void;
  onSave: (seed: Omit<WorldSeed, 'id' | 'timestamp' | 'lastModified'>) => Promise<void>;
  existingSeed?: WorldSeed;
}

export const WorldForge: React.FC<WorldForgeProps> = ({ show, onClose, onSave, existingSeed }) => {
  const { getService } = useGeminiService();
  const { showToast } = useToast();

  const [worldName, setWorldName] = useState(existingSeed?.name || '');
  const [worldDescription, setWorldDescription] = useState(existingSeed?.description || '');
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [isDecomposing, setIsDecomposing] = useState(false);
  const [decomposed, setDecomposed] = useState(existingSeed || null);

  const handleDecompose = async () => {
    if (!worldDescription.trim()) {
      showToast('Enter a world description to decompose.', 'error');
      return;
    }

    setIsDecomposing(true);
    try {
      const geminiService = await getService();
      if (!geminiService) {
        showToast('Gemini service not available.', 'error');
        setIsDecomposing(false);
        return;
      }

      const service = new WorldService(geminiService);
      const result = existingSeed && additionalNotes.trim()
        ? await service.expandWorld(
            {
              locations: existingSeed.locations,
              factions: existingSeed.factions,
              lore: existingSeed.lore,
              npcs: existingSeed.npcs,
              rules: existingSeed.rules,
            },
            additionalNotes
          )
        : await service.decomposeWorld(worldDescription);

      const seed: WorldSeed = {
        id: existingSeed?.id || '' as WorldSeedId,
        name: worldName || 'Unnamed World',
        description: worldDescription,
        timestamp: existingSeed?.timestamp || new Date().toISOString(),
        lastModified: new Date().toISOString(),
        locations: result.locations,
        factions: result.factions,
        lore: result.lore,
        npcs: result.npcs,
        rules: result.rules,
        tags: result.tags,
      };

      setDecomposed(seed);
      showToast('World decomposed successfully!', 'success');
    } catch (e) {
      console.error('[WorldForge] Decomposition failed:', e);
      showToast('Failed to decompose world. Try a more detailed description.', 'error');
    } finally {
      setIsDecomposing(false);
    }
  };

  const handleSave = async () => {
    if (!decomposed) {
      showToast('Decompose the world first.', 'error');
      return;
    }

    try {
      await onSave({
        name: decomposed.name,
        description: decomposed.description,
        locations: decomposed.locations,
        factions: decomposed.factions,
        lore: decomposed.lore,
        npcs: decomposed.npcs,
        rules: decomposed.rules,
        tags: decomposed.tags,
      });
      onClose();
    } catch (e) {
      console.error('[WorldForge] Save failed:', e);
      showToast('Failed to save world seed.', 'error');
    }
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-[#0a0a0a] border border-gray-800 max-w-4xl w-full max-h-[90vh] overflow-y-auto p-8 space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-gray-800 pb-4">
          <h2 className="text-2xl font-bold text-white uppercase tracking-wider">
            {existingSeed ? 'Expand World' : 'World Forge'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white text-2xl"
          >
            ×
          </button>
        </div>

        {/* Input Section */}
        {!decomposed && (
          <div className="space-y-6">
            {/* World Name */}
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-2">
                World Name
              </label>
              <input
                type="text"
                value={worldName}
                onChange={e => setWorldName(e.target.value)}
                placeholder="e.g. The Shattered Kingdoms, Neon Undercity"
                className="w-full bg-black border border-gray-700 text-white px-4 py-2 text-sm focus:border-red-900 focus:outline-none"
              />
            </div>

            {/* World Description */}
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-2">
                World Description
              </label>
              <textarea
                value={worldDescription}
                onChange={e => setWorldDescription(e.target.value)}
                placeholder="Describe your world: geography, factions, culture, magic system, key locations, NPCs, etc. Be as detailed as possible."
                className="w-full h-48 bg-black border border-gray-700 text-white px-4 py-2 text-sm font-light leading-relaxed resize-none focus:border-red-900 focus:outline-none"
              />
            </div>

            {/* Expansion Section (if editing) */}
            {existingSeed && (
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-2">
                  Additional Notes (Optional)
                </label>
                <textarea
                  value={additionalNotes}
                  onChange={e => setAdditionalNotes(e.target.value)}
                  placeholder="Add new locations, NPCs, factions, or plot hooks to expand the world."
                  className="w-full h-24 bg-black border border-gray-700 text-white px-4 py-2 text-sm font-light leading-relaxed resize-none focus:border-red-900 focus:outline-none"
                />
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-4 justify-center pt-4">
              <button
                onClick={handleDecompose}
                disabled={isDecomposing || !worldDescription.trim()}
                className={`px-8 py-3 text-xs font-bold uppercase tracking-widest transition-all ${
                  isDecomposing || !worldDescription.trim()
                    ? 'bg-gray-900 text-gray-600 cursor-not-allowed'
                    : 'bg-red-900/20 border border-red-800 text-red-400 hover:bg-red-900 hover:text-white'
                }`}
              >
                {isDecomposing ? 'Decomposing World...' : 'Decompose World'}
              </button>
              <button
                onClick={onClose}
                className="px-8 py-3 text-xs font-bold uppercase tracking-widest bg-gray-900 border border-gray-700 text-gray-400 hover:text-white transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Preview Section */}
        {decomposed && (
          <div className="space-y-6">
            <div className="border-b border-gray-800 pb-4">
              <h3 className="text-lg font-bold text-white mb-4">World Preview</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div className="bg-gray-900/30 p-3 rounded">
                  <span className="text-gray-500 text-[10px] uppercase">Locations</span>
                  <p className="text-white font-bold text-lg">{decomposed.locations.length}</p>
                </div>
                <div className="bg-gray-900/30 p-3 rounded">
                  <span className="text-gray-500 text-[10px] uppercase">Factions</span>
                  <p className="text-white font-bold text-lg">{decomposed.factions.length}</p>
                </div>
                <div className="bg-gray-900/30 p-3 rounded">
                  <span className="text-gray-500 text-[10px] uppercase">NPCs</span>
                  <p className="text-white font-bold text-lg">{decomposed.npcs.length}</p>
                </div>
                <div className="bg-gray-900/30 p-3 rounded">
                  <span className="text-gray-500 text-[10px] uppercase">Lore Entries</span>
                  <p className="text-white font-bold text-lg">{decomposed.lore.length}</p>
                </div>
                <div className="bg-gray-900/30 p-3 rounded">
                  <span className="text-gray-500 text-[10px] uppercase">Rules</span>
                  <p className="text-white font-bold text-lg">{decomposed.rules.length}</p>
                </div>
                <div className="bg-gray-900/30 p-3 rounded">
                  <span className="text-gray-500 text-[10px] uppercase">Tags</span>
                  <p className="text-white font-bold text-lg">{decomposed.tags.length}</p>
                </div>
              </div>
            </div>

            {/* Quick Preview of Content */}
            <div className="space-y-4 text-xs text-gray-400">
              {decomposed.tags.length > 0 && (
                <div>
                  <h4 className="text-gray-300 font-bold mb-2">Tags</h4>
                  <div className="flex flex-wrap gap-2">
                    {decomposed.tags.slice(0, 8).map((tag, i) => (
                      <span key={i} className="bg-red-900/20 text-red-400 px-2 py-1 rounded text-[9px]">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {decomposed.locations.length > 0 && (
                <div>
                  <h4 className="text-gray-300 font-bold mb-2">Sample Locations</h4>
                  <p>{decomposed.locations.slice(0, 3).map(l => l.name).join(', ')}{decomposed.locations.length > 3 ? '...' : ''}</p>
                </div>
              )}
            </div>

            {/* Save/Back Buttons */}
            <div className="flex gap-4 justify-center pt-4 border-t border-gray-800">
              <button
                onClick={handleSave}
                className="px-8 py-3 text-xs font-bold uppercase tracking-widest bg-red-900 text-white hover:bg-red-800 transition-all"
              >
                Save World Seed
              </button>
              <button
                onClick={() => setDecomposed(null)}
                className="px-8 py-3 text-xs font-bold uppercase tracking-widest bg-gray-900 border border-gray-700 text-gray-400 hover:text-white transition-all"
              >
                Back to Edit
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
