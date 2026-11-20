// v1.61: run the post-birth trait pass for every child whose traits are still
// pending. Called after each turn and after a montage commit. A child whose
// call fails stays pending and is retried next time.
import { useGameStore } from '../store';
import type { GeminiService } from '../geminiService';
import {
    childrenOf,
    parentInfo,
    applyChildTraits,
    syncPregnancyRegisters,
} from '../utils/reproductionSystem';

const inFlight = new Set<string>();

export const runPendingChildTraits = async (
    service: Pick<GeminiService, 'generateChildTraits'>,
    log: (message: string, type?: 'info' | 'warning' | 'error') => void,
): Promise<void> => {
    const start = useGameStore.getState();
    const pending = childrenOf(start.gameWorld.knownEntities).filter(c => c.child?.traitsPending && !inFlight.has(c.id));
    for (const child of pending.slice(0, 3)) {
        inFlight.add(child.id);
        try {
            const st = useGameStore.getState();
            const ents = st.gameWorld.knownEntities ?? [];
            const traits = await service.generateChildTraits({
                child,
                mother: parentInfo(child.child!.motherName, st.character, ents),
                father: parentInfo(child.child!.fatherName, st.character, ents),
                rules: st.gameWorld.inheritanceRules ?? '',
            });
            if (!traits) {
                log(`[CHILD TRAITS FAILED] no traits returned for ${child.name} — will retry next turn.`, 'warning');
                continue;
            }
            let summary: string[] = [];
            useGameStore.getState().setGameWorld(prev => {
                const res = applyChildTraits(prev.knownEntities ?? [], child.id, traits);
                summary = res.changed;
                const now = prev.time?.totalMinutes ?? 0;
                const entities = syncPregnancyRegisters(res.entities, prev.pregnancies, useGameStore.getState().character.name, now, prev.turnCount ?? 0);
                return { ...prev, knownEntities: entities };
            });
            log(`[CHILD TRAITS] ${child.name}: ${summary.join('; ') || 'no change'}.`);
        } catch (e) {
            log(`[CHILD TRAITS FAILED] ${child.name}: ${e instanceof Error ? e.message : String(e)}`, 'error');
        } finally {
            inFlight.delete(child.id);
        }
    }
};
