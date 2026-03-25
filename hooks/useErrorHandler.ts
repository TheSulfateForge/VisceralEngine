import { useCallback } from 'react';
import { useToast } from '../components/providers/ToastProvider';
import { useGameStore } from '../store';
import { classifyError, toDebugLogEntry, EngineError } from '../utils/engineErrors';

export function useErrorHandler() {
  const { showToast } = useToast();
  const setGameHistory = useGameStore(s => s.setGameHistory);

  const handleError = useCallback((error: unknown, context: string): EngineError => {
    const classified = classifyError(error, context);

    showToast(classified.message, 'error');

    setGameHistory(prev => ({
      ...prev,
      debugLog: [...prev.debugLog, toDebugLogEntry(classified)]
    }));

    if (classified.suggestedAction) {
      showToast(classified.suggestedAction, 'info');
    }

    return classified;
  }, [showToast, setGameHistory]);

  return { handleError };
}
