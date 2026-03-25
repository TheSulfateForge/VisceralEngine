import React, { useState } from 'react';
import type { WorldSeed, WorldSeedId } from '../../types';
import { useWorldSeeds } from '../../hooks/useWorldSeeds';
import { WorldForge } from './WorldForge';

interface WorldSelectorProps {
  selectedId?: WorldSeedId;
  onSelect: (seed: WorldSeed | undefined) => void;
}

export const WorldSelector: React.FC<WorldSelectorProps> = ({ selectedId, onSelect }) => {
  const { seeds, saveWorldSeed, deleteWorldSeed } = useWorldSeeds();
  const [showForge, setShowForge] = useState(false);
  const [editingSeed, setEditingSeed] = useState<WorldSeed | undefined>(undefined);

  const selectedSeed = selectedId ? seeds.find(s => s.id === selectedId) : undefined;

  const handleCreateNew = async (seed: Omit<WorldSeed, 'id' | 'timestamp' | 'lastModified'>) => {
    const newSeed = await saveWorldSeed(seed);
    onSelect(newSeed);
    setShowForge(false);
  };

  const handleExpand = async (seed: Omit<WorldSeed, 'id' | 'timestamp' | 'lastModified'>) => {
    if (!editingSeed) return;
    const expanded = await saveWorldSeed({
      ...seed,
      id: editingSeed.id as WorldSeedId
    });
    onSelect(expanded);
    setShowForge(false);
    setEditingSeed(undefined);
  };

  return (
    <div className="space-y-6 border border-red-900/20 p-6 bg-gradient-to-b from-red-900/5 to-transparent">
      <div>
        <h3 className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-4 block">
          World Seed Selection
        </h3>
        <p className="text-xs text-gray-500 mb-4">
          Select a saved world or create a new one. The world's locations, NPCs, and factions will be available to your character.
        </p>
      </div>

      {/* Current Selection */}
      {selectedSeed ? (
        <div className="border border-red-900/30 bg-red-900/10 p-4 rounded space-y-3">
          <div>
            <h4 className="text-white font-bold">{selectedSeed.name}</h4>
            <p className="text-gray-400 text-xs mt-1 line-clamp-2">{selectedSeed.description}</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px]">
            <div className="bg-gray-900/50 p-2 rounded text-center">
              <span className="text-gray-500 block">Locations</span>
              <span className="text-red-400 font-bold">{selectedSeed.locations.length}</span>
            </div>
            <div className="bg-gray-900/50 p-2 rounded text-center">
              <span className="text-gray-500 block">Factions</span>
              <span className="text-red-400 font-bold">{selectedSeed.factions.length}</span>
            </div>
            <div className="bg-gray-900/50 p-2 rounded text-center">
              <span className="text-gray-500 block">NPCs</span>
              <span className="text-red-400 font-bold">{selectedSeed.npcs.length}</span>
            </div>
            <div className="bg-gray-900/50 p-2 rounded text-center">
              <span className="text-gray-500 block">Lore</span>
              <span className="text-red-400 font-bold">{selectedSeed.lore.length}</span>
            </div>
            <div className="bg-gray-900/50 p-2 rounded text-center">
              <span className="text-gray-500 block">Rules</span>
              <span className="text-red-400 font-bold">{selectedSeed.rules.length}</span>
            </div>
          </div>
          {selectedSeed.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedSeed.tags.map((tag, i) => (
                <span key={i} className="text-[9px] bg-red-900/20 text-red-400 px-2 py-1 rounded">
                  {tag}
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => {
                setEditingSeed(selectedSeed);
                setShowForge(true);
              }}
              className="flex-1 px-3 py-2 text-[9px] font-bold uppercase tracking-widest bg-red-900/20 border border-red-900/30 text-red-500 hover:bg-red-900 hover:text-white transition-all rounded"
            >
              Expand
            </button>
            <button
              onClick={() => onSelect(undefined)}
              className="flex-1 px-3 py-2 text-[9px] font-bold uppercase tracking-widest border border-gray-700 text-gray-500 hover:bg-gray-800 transition-all rounded"
            >
              Unselect
            </button>
          </div>
        </div>
      ) : (
        <div className="border border-gray-800 bg-gray-900/20 p-4 rounded text-center text-gray-500 text-sm py-6">
          No world selected. Create or load one below.
        </div>
      )}

      {/* World List */}
      {seeds.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Saved Worlds</h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {seeds.map(seed => (
              <div
                key={seed.id}
                className={`border p-3 rounded cursor-pointer transition-all ${
                  selectedId === seed.id
                    ? 'border-red-800 bg-red-900/20'
                    : 'border-gray-800 hover:border-gray-700'
                }`}
                onClick={() => onSelect(seed)}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h5 className="text-white font-bold text-sm">{seed.name}</h5>
                    <p className="text-gray-500 text-[10px] mt-1 line-clamp-1">{seed.description}</p>
                    <p className="text-gray-600 text-[9px] mt-1">
                      {new Date(seed.lastModified).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      deleteWorldSeed(seed.id);
                    }}
                    className="px-2 py-1 text-[9px] font-bold uppercase tracking-widest border border-gray-700 text-gray-500 hover:bg-red-900 hover:text-white hover:border-red-800 transition-all rounded"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create New World Button */}
      <button
        onClick={() => {
          setEditingSeed(undefined);
          setShowForge(true);
        }}
        className="w-full px-6 py-3 text-xs font-bold uppercase tracking-widest bg-red-900/20 border border-red-800 text-red-400 hover:bg-red-900 hover:text-white transition-all rounded"
      >
        Create New World
      </button>

      {/* World Forge Modal */}
      <WorldForge
        show={showForge}
        onClose={() => {
          setShowForge(false);
          setEditingSeed(undefined);
        }}
        onSave={editingSeed ? handleExpand : handleCreateNew}
        existingSeed={editingSeed}
      />
    </div>
  );
};
