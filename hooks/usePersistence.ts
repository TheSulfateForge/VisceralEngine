
import { useCallback, useEffect, useRef } from 'react';
import { GameSave, CharacterTemplate } from '../types';
import { generateSaveId, generateTemplateId, AUTOSAVE_ID } from '../idUtils';
import { db } from '../db';
import { downloadFile, debounce } from '../utils';
import { useToast } from '../components/providers/ToastProvider';
import { TIMING } from '../constants';
import { useGameStore } from '../store';

/**
 * HOOK: useAutosave
 * Handles background persistence logic (Autosave, cleanup).
 * Subscribes to store changes. Should be used once in the app root.
 */
export const useAutosave = () => {
    const { showToast } = useToast();

    // Reactive State Subscriptions
    // We select specific slices to ensure we only trigger when necessary
    const turnCount = useGameStore(state => state.gameHistory.turnCount);
    const historyLength = useGameStore(state => state.gameHistory.history.length);
    const sceneMode = useGameStore(state => state.gameWorld.sceneMode);
    const knownEntitiesLen = useGameStore(state => state.gameWorld.knownEntities.length);
    const character = useGameStore(state => state.character);
    
    // Refs for tracking
    const isInitialized = useRef(false);
    const lastCleanupTurn = useRef(0);

    // Initialization Check
    useEffect(() => {
        if (turnCount > 0 || character.name) {
            isInitialized.current = true;
        }
    }, [turnCount, character.name]);

    // Image Cleanup (Every 20 turns)
    useEffect(() => {
        if (turnCount > 0 && turnCount % 20 === 0 && turnCount !== lastCleanupTurn.current) {
            lastCleanupTurn.current = turnCount;
            const activeIds = useGameStore.getState().gameWorld.generatedImages || [];
            db.cleanupOrphanedImages(activeIds).then(count => {
                if (count > 0) console.log(`[Cleanup] Removed ${count} orphaned images`);
            }).catch(console.error);
        }
    }, [turnCount]);

    // Internal Save Helper
    const performAutosave = useCallback(async () => {
        try {
            const currentState = useGameStore.getState();
            await db.saveGame({
                id: AUTOSAVE_ID,
                name: 'AUTOSAVE',
                timestamp: new Date().toISOString(),
                gameState: { history: currentState.gameHistory, world: currentState.gameWorld },
                character: currentState.character
            });
            // Quiet success for autosave
        } catch (e) {
            console.error("Autosave Error:", e);
        }
    }, []);

    // Debouncer
    const debouncedAutosave = useRef(
        debounce(() => {
            if (isInitialized.current) {
                performAutosave();
            }
        }, TIMING.AUTOSAVE_DEBOUNCE)
    ).current;

    // Autosave Trigger
    useEffect(() => {
        if (isInitialized.current) {
            debouncedAutosave();
        }
        return () => {
            debouncedAutosave.cancel();
        };
    }, [
        historyLength, 
        turnCount, 
        character, 
        sceneMode, 
        knownEntitiesLen, 
        debouncedAutosave
    ]);
};

/**
 * HOOK: usePersistence
 * Provides manual actions for Saving, Loading, Exporting, Importing.
 * Optimized to NOT trigger re-renders on game state changes.
 */
export const usePersistence = () => {
  const { showToast } = useToast();
  
  // Stable Setters (Zustand setters don't change)
  const setGameHistory = useGameStore(state => state.setGameHistory);
  const setGameWorld = useGameStore(state => state.setGameWorld);
  const setCharacter = useGameStore(state => state.setCharacter);
  const setUI = useGameStore(state => state.setUI);

  const handleExport = useCallback(() => {
    const currentState = useGameStore.getState();
    const save: GameSave = {
      id: generateSaveId(),
      name: `${currentState.character.name || 'Unknown'}_${new Date().toISOString().split('T')[0]}`,
      timestamp: new Date().toISOString(),
      gameState: { history: currentState.gameHistory, world: currentState.gameWorld },
      character: currentState.character,
      thumbnail: currentState.gameWorld.visualUrl
    };
    
    const safeName = save.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `visceral_backup_${safeName}.json`;
    
    downloadFile(JSON.stringify(save, null, 2), filename, 'application/json');
    showToast("Reality state exported.", "success");
  }, [showToast]);

  const handleImport = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const save = JSON.parse(text) as GameSave;

      if (!save.gameState || !save.character) {
        throw new Error("Invalid save structure");
      }

      setGameHistory(save.gameState.history);
      setGameWorld(save.gameState.world);
      setCharacter(save.character);
      setUI({ view: 'game', isSettingsOpen: false });
      showToast("Reality state reconstructed.", "success");
    } catch (e) {
      console.error(e);
      showToast("Import failed. Corrupt data.", "error");
    }
  }, [setGameHistory, setGameWorld, setCharacter, setUI, showToast]);

  const saveToDb = useCallback(async (name: string) => {
    try {
      const currentState = useGameStore.getState();
      await db.saveGame({
        id: generateSaveId(),
        name,
        timestamp: new Date().toISOString(),
        gameState: { history: currentState.gameHistory, world: currentState.gameWorld },
        character: currentState.character
      });
      showToast("Checkpoint saved to Core.", "success");
    } catch (e) {
      console.error("Save Error:", e);
      showToast("Save failed.", "error");
    }
  }, [showToast]);

  const loadFromDb = useCallback(async (name: string) => {
    try {
      const save = await db.loadGame(name);
      if (save) {
        setGameHistory({ ...save.gameState.history, isThinking: false });
        setGameWorld({ ...save.gameState.world });
        setCharacter({ ...save.character });
        setUI({ view: 'game' });
        showToast("Reality restored.", "success");
      } else {
        showToast("Save file not found.", "error");
      }
    } catch (e) {
      console.error("Load Error:", e);
      showToast("Load failed.", "error");
    }
  }, [setGameHistory, setGameWorld, setCharacter, setUI, showToast]);

  const handleExportTemplates = useCallback(async () => {
    try {
      const templates = await db.getAllTemplates();
      if (templates.length === 0) {
        showToast("No templates to export.", "error");
        return;
      }
      const date = new Date().toISOString().split('T')[0];
      const filename = `visceral_templates_${date}.json`;
      downloadFile(JSON.stringify(templates, null, 2), filename, 'application/json');
      showToast(`${templates.length} template(s) exported.`, "success");
    } catch (e) {
      console.error("Template export failed:", e);
      showToast("Template export failed.", "error");
    }
  }, [showToast]);

  const handleImportTemplates = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const templates: CharacterTemplate[] = Array.isArray(parsed) ? parsed : [parsed];

      const valid = templates.filter(t =>
        t && typeof t === 'object' &&
        typeof t.name === 'string' && t.name.trim() &&
        typeof t.timestamp === 'string' &&
        t.character && typeof t.character === 'object' &&
        typeof t.character.name === 'string'
      );

      if (valid.length === 0) {
        throw new Error("No valid templates found in file");
      }

      // Re-stamp IDs so imported templates never collide with local ones
      for (const t of valid) {
        t.id = generateTemplateId();
        await db.saveTemplate(t);
      }

      showToast(`${valid.length} template(s) imported.`, "success");
    } catch (e) {
      console.error("Template import failed:", e);
      showToast("Template import failed. Invalid file.", "error");
    }
  }, [showToast]);

  return {
    handleExport,
    handleImport,
    handleExportTemplates,
    handleImportTemplates,
    saveToDb,
    loadFromDb
  };
};