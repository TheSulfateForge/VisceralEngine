
import { useCallback, useEffect, useRef } from 'react';
import { GameHistory, GameWorld, Character, GameSave, GameState } from '../types';
import { generateSaveId, generateMessageId } from '../idUtils';
import { db } from '../db';
import { downloadFile, debounce } from '../utils';
import { useToast } from '../components/providers/ToastProvider';
import { TIMING } from '../constants';

interface UsePersistenceProps {
  gameHistory: GameHistory;
  setGameHistory: (h: GameHistory) => void;
  gameWorld: GameWorld;
  setGameWorld: (w: GameWorld) => void;
  character: Character;
  setCharacter: (char: Character) => void;
  setView: (view: any) => void;
  setIsSettingsOpen: (open: boolean) => void;
}

export const usePersistence = ({
  gameHistory, setGameHistory,
  gameWorld, setGameWorld,
  character, setCharacter,
  setView,
  setIsSettingsOpen
}: UsePersistenceProps) => {
  const { showToast } = useToast();
  
  // Track if initial load is done to avoid overwriting autosave with empty state
  const isInitialized = useRef(false);

  useEffect(() => {
    if (gameHistory.turnCount > 0 || character.name) {
      isInitialized.current = true;
    }
  }, [gameHistory.turnCount, character.name]);

  const handleExport = useCallback(() => {
    const save: GameSave = {
      id: generateSaveId(),
      name: `${character.name || 'Unknown'}_${new Date().toISOString().split('T')[0]}`,
      timestamp: new Date().toISOString(),
      gameState: { history: gameHistory, world: gameWorld },
      character,
      thumbnail: gameWorld.visualUrl
    };
    const filename = `visceral_backup_${save.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
    downloadFile(JSON.stringify(save, null, 2), filename, 'application/json');
    showToast("Reality state exported.", "success");
  }, [gameHistory, gameWorld, character, showToast]);

  const handleImport = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const save = JSON.parse(text) as GameSave;

      // Basic validation
      if (!save.gameState || !save.character) {
        throw new Error("Invalid save structure");
      }

      setGameHistory(save.gameState.history);
      setGameWorld(save.gameState.world);
      setCharacter(save.character);
      setView('game');
      showToast("Reality state reconstructed.", "success");
      setIsSettingsOpen(false);
    } catch (e) {
      console.error(e);
      showToast("Import failed. Corrupt data.", "error");
    }
  }, [setGameHistory, setGameWorld, setCharacter, setView, showToast, setIsSettingsOpen]);

  const saveToDb = useCallback(async (name: string, isAutosave = false) => {
    try {
      await db.saveGame({
        id: isAutosave ? 'autosave_slot' as any : generateMessageId() as any, 
        name,
        timestamp: new Date().toISOString(),
        gameState: { history: gameHistory, world: gameWorld },
        character
      });
      if (!isAutosave) {
        showToast("Checkpoint saved to Core.", "success");
      }
    } catch (e) {
      console.error(e);
      if (!isAutosave) showToast("Save failed.", "error");
    }
  }, [gameHistory, gameWorld, character, showToast]);

  const loadFromDb = useCallback(async (name: string) => {
    try {
      const save = await db.loadGame(name);
      if (save) {
        // Deep clone / spread to ensure React detects the state change immediately
        // Also force thinking to false to prevent UI locks from saved states
        setGameHistory({ ...save.gameState.history, isThinking: false });
        setGameWorld({ ...save.gameState.world });
        setCharacter({ ...save.character });
        
        // Even if we are already in 'game' view, this ensures the logic holds
        setView('game');
        
        showToast("Reality restored.", "success");
      }
    } catch (e) {
      console.error(e);
      showToast("Load failed.", "error");
    }
  }, [setGameHistory, setGameWorld, setCharacter, setView, showToast]);

  // Autosave Effect
  // Uses a ref to hold the debounced function to ensure it persists across renders
  const debouncedAutosave = useRef(
    debounce(() => {
        // Only autosave if we have actual data
        if (isInitialized.current) {
            saveToDb('AUTOSAVE', true);
        }
    }, TIMING.AUTOSAVE_DEBOUNCE)
  ).current;

  // Trigger autosave on meaningful state changes
  useEffect(() => {
    if (isInitialized.current) {
        debouncedAutosave();
    }
  }, [
    gameHistory.history.length, 
    gameHistory.turnCount, 
    character, 
    gameWorld.sceneMode,
    gameWorld.knownEntities,
    debouncedAutosave
  ]);

  return {
    handleExport,
    handleImport,
    saveToDb,
    loadFromDb
  };
};
