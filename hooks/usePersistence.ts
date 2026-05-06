
import { useCallback, useEffect, useRef } from 'react';
import { GameSave, CharacterTemplate } from '../types';
import { generateSaveId, generateTemplateId, AUTOSAVE_ID } from '../idUtils';
import { db } from '../db';
import { backfillEmbeddings } from '../services/embeddingBackfill';
import { downloadFile, debounce } from '../utils';
import { useToast } from '../components/providers/ToastProvider';
import { useErrorHandler } from './useErrorHandler';
import { TIMING } from '../constants';
import { useGameStore } from '../store';
import { sanitiseStateOnLoad } from '../utils/nameResolver';

/**
 * Fire-and-forget embedding backfill. Runs incrementally in the background;
 * skips items whose source text already has a current-model embedding. Safe
 * to call repeatedly. Logs any errors to console rather than surfacing toasts.
 */
const kickBackfill = (): void => {
  backfillEmbeddings(AUTOSAVE_ID, {
    onProgress: () => {/* silent — could surface to debug overlay later */},
  }).catch((err) => {
    console.warn('[embedding backfill] failed:', err);
  });
};

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
            // Phase 2: opportunistically refresh embeddings for newly added
            // memories/lore/entities/segments. Backfill is idempotent and
            // skips items whose source text hasn't changed since last embed.
            kickBackfill();
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
  const { handleError } = useErrorHandler();

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

      // v1.7: Deep-sanitise all state to resolve legacy [RENAME:X] contamination
      const { world, character: cleanChar, history } = sanitiseStateOnLoad(
        save.gameState.world,
        save.character,
        save.gameState.history
      );

      if (!world.emergingThreats) {
        world.emergingThreats = [];
      }
      if (world.passiveAlliesDetected === undefined) {
        world.passiveAlliesDetected = false;
      }
      // Stream 4: Trauma Narrative Effects
      if (world.activeTraumaEffect === undefined) {
        world.activeTraumaEffect = undefined;
      }
      if (world.lastTraumaEffectTurn === undefined) {
        world.lastTraumaEffectTurn = undefined;
      }
      // Stream 6: Faction-Scale Conflict
      if (world.factions === undefined) {
        world.factions = [];
      }
      if (world.factionConflicts === undefined) {
        world.factionConflicts = [];
      }
      // Stream 7: World Seeds
      if (world.worldRules === undefined) {
        world.worldRules = [];
      }
      if (world.worldSeedId === undefined) {
        world.worldSeedId = undefined;
      }
      if (world.worldTags === undefined) {
        world.worldTags = [];
      }

      setGameHistory(history);
      setGameWorld(world);
      setCharacter(cleanChar);
      setUI({ view: 'game', isSettingsOpen: false });
      showToast("Reality state reconstructed.", "success");
    } catch (e) {
      handleError(e, 'save_import');
    }
  }, [setGameHistory, setGameWorld, setCharacter, setUI, showToast, handleError]);

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
      handleError(e, 'save_to_db');
    }
  }, [showToast, handleError]);

  const loadFromDb = useCallback(async (name: string) => {
    try {
      const save = await db.loadGame(name);
      if (save) {
        const { world, character: cleanChar, history } = sanitiseStateOnLoad(
          save.gameState.world,
          save.character,
          save.gameState.history
        );

        if (!world.emergingThreats) {
          world.emergingThreats = [];
        }
        if (world.passiveAlliesDetected === undefined) {
          world.passiveAlliesDetected = false;
        }
        // Stream 4: Trauma Narrative Effects
        if (world.activeTraumaEffect === undefined) {
          world.activeTraumaEffect = undefined;
        }
        if (world.lastTraumaEffectTurn === undefined) {
          world.lastTraumaEffectTurn = undefined;
        }
        // Stream 6: Faction-Scale Conflict
        if (world.factions === undefined) {
          world.factions = [];
        }
        if (world.factionConflicts === undefined) {
          world.factionConflicts = [];
        }

        setGameHistory({ ...history, isThinking: false });
        setGameWorld({ ...world });
        setCharacter({ ...cleanChar });
        setUI({ view: 'game' });
        // Phase 2: the loaded campaign content needs embeddings under
        // AUTOSAVE_ID (the canonical scope used by hybrid retrieval).
        // Kick a backfill — runs in the background, doesn't block the load.
        kickBackfill();
        showToast("Reality restored.", "success");
      } else {
        showToast("Save file not found.", "error");
      }
    } catch (e) {
      handleError(e, 'load_from_db');
    }
  }, [setGameHistory, setGameWorld, setCharacter, setUI, showToast, handleError]);

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
      handleError(e, 'template_export');
    }
  }, [showToast, handleError]);

  const handleImportTemplates = useCallback(async (file: File) => {
    try {
      const text = await file.text();    const parsed = JSON.parse(text);
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
      handleError(e, 'template_import');
    }
  }, [showToast, handleError]);

  return {
    handleExport,
    handleImport,
    handleExportTemplates,
    handleImportTemplates,
    saveToDb,
    loadFromDb
  };
};
