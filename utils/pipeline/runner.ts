import type { PipelineStep, TurnContext, SimulationResult } from './types';

/**
 * Executes all pipeline steps in order, passing context between them.
 * If a step throws, the error is logged and execution continues.
 */
export function executePipeline(steps: PipelineStep[], ctx: TurnContext): SimulationResult {
    let current = ctx;
    for (const step of steps) {
        try {
            current = step.execute(current);
        } catch (e) {
            current.debugLogs.push({
                timestamp: new Date().toISOString(),
                message: `[PIPELINE] Step "${step.name}" failed: ${e instanceof Error ? e.message : String(e)}`,
                type: 'error'
            });
            // Continue to next step even on error
        }
    }
    return {
        worldUpdate: current.worldUpdate,
        characterUpdate: current.characterUpdate,
        debugLogs: current.debugLogs,
        pendingLore: current.pendingLore,
    };
}
