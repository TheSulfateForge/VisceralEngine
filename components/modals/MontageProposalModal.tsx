// ============================================================================
// MontageProposalModal.tsx — Reviewable montage proposal (v0.13, Step 6/8)
// ----------------------------------------------------------------------------
// Renders the held MontageProposal for item-by-item review. Nothing is written
// to character/world until the player hits Accept (which routes through
// useMontage.acceptMontage → commitMontageProposal in a single pass).
//
//   • Each proposed memory / trauma / skill / NPC-delta shows veto / restore,
//     and memories+traumas get an inline text edit.
//   • Memories flagged can_play_out get a "Play this out" button that pauses the
//     montage so the moment can be run as a live scene (promote-to-scene).
//   • Regenerate re-runs the prompt (capped). Veto-all / Restore-all are bulk.
//   • Accept commits non-vetoed items AND advances the clock; Cancel backs out
//     with no time passing.
// ============================================================================

import React, { useState } from 'react';
import { useGameStore } from '../../store';
import { useMontage } from '../../hooks/useMontage';
import { MONTAGE_MAX_REGENERATES } from '../../config/engineConfig';
import type { MontageCategory } from '../../slices/pendingSlice';
import type {
    ReviewableItem,
    ProposedMemory,
    ProposedTrauma,
    ProposedSkillUpdate,
    ProposedNpcDelta,
} from '../../types';

const STATUS_STYLES: Record<string, string> = {
    vetoed: 'border-red-900/40 bg-red-950/20 opacity-60',
    edited: 'border-sky-800/50 bg-sky-950/10',
    pending: 'border-gray-800 bg-gray-950',
    accepted: 'border-emerald-800/50 bg-emerald-950/10',
};

interface ItemRowProps {
    category: MontageCategory;
    item: ReviewableItem<any>;
    primary: string;       // main display line
    secondary?: string;    // muted sub-line
    editableField?: 'summary' | 'description'; // inline-editable text field
    canPlayOut?: boolean;
}

const ItemRow: React.FC<ItemRowProps> = ({ category, item, primary, secondary, editableField, canPlayOut }) => {
    const setMontageItemStatus = useGameStore(s => s.setMontageItemStatus);
    const editMontageItem = useGameStore(s => s.editMontageItem);
    const pauseMontageForScene = useGameStore(s => s.pauseMontageForScene);
    const [editing, setEditing] = useState<string | null>(null);

    const vetoed = item.status === 'vetoed';

    const saveEdit = () => {
        if (editing !== null && editableField) {
            editMontageItem(category, item.id, { ...item.data, [editableField]: editing });
        }
        setEditing(null);
    };

    return (
        <div className={`px-3 py-2 rounded-sm border ${STATUS_STYLES[item.status] ?? STATUS_STYLES.pending}`}>
            {editing !== null ? (
                <textarea
                    value={editing}
                    onChange={e => setEditing(e.target.value)}
                    className="w-full bg-black border border-gray-800 text-gray-300 text-xs leading-relaxed p-2 min-h-[60px] focus:border-amber-900 outline-none resize-y"
                />
            ) : (
                <p className={`text-xs leading-relaxed ${vetoed ? 'line-through text-gray-500' : 'text-gray-200'}`}>
                    {primary}
                </p>
            )}
            {secondary && editing === null && (
                <p className="text-[10px] text-gray-500 mt-1">{secondary}</p>
            )}
            <div className="flex items-center gap-2 mt-2">
                {editing !== null ? (
                    <button onClick={saveEdit}
                        className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 border border-sky-800/60 text-sky-400 hover:bg-sky-900/40">
                        Save
                    </button>
                ) : (
                    <>
                        <button
                            onClick={() => setMontageItemStatus(category, item.id, vetoed ? 'pending' : 'vetoed')}
                            className={`text-[9px] font-bold uppercase tracking-widest px-2 py-1 border transition-all ${
                                vetoed
                                    ? 'border-emerald-800/50 text-emerald-400 hover:bg-emerald-900/30'
                                    : 'border-red-900/40 text-red-500 hover:bg-red-950/40'
                            }`}>
                            {vetoed ? 'Restore' : 'Veto'}
                        </button>
                        {editableField && !vetoed && (
                            <button
                                onClick={() => setEditing((item.data[editableField] as string) ?? '')}
                                className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 border border-gray-700 text-gray-400 hover:border-amber-900 hover:text-amber-400">
                                Edit
                            </button>
                        )}
                        {canPlayOut && !vetoed && (
                            <button
                                onClick={() => pauseMontageForScene(item.id)}
                                className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 border border-purple-800/50 text-purple-400 hover:bg-purple-900/30 ml-auto">
                                ▶ Play this out
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

const Section: React.FC<{ title: string; count: number; children: React.ReactNode }> = ({ title, count, children }) => {
    if (count === 0) return null;
    return (
        <div className="space-y-2">
            <p className="text-[9px] text-gray-500 uppercase tracking-widest">{title} ({count})</p>
            {children}
        </div>
    );
};

export const MontageProposalModal: React.FC = () => {
    const proposal = useGameStore(s => s.montageProposal);
    const paused = useGameStore(s => s.montagePausedForScene);
    const resumeMontageFromScene = useGameStore(s => s.resumeMontageFromScene);
    const vetoAllMontageItems = useGameStore(s => s.vetoAllMontageItems);
    const restoreAllMontageItems = useGameStore(s => s.restoreAllMontageItems);
    const isThinking = useGameStore(s => s.gameHistory.isThinking);
    const { acceptMontage, cancelMontage, regenerateMontage } = useMontage();

    if (!proposal) return null;

    // While a memory is being played out as a live scene, collapse to a slim bar.
    if (paused) {
        return (
            <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[140] bg-[#0a0a0a] border border-purple-800/50 px-4 py-2 rounded-sm shadow-2xl flex items-center gap-3">
                <span className="text-[10px] text-purple-400 uppercase tracking-widest">Montage paused — scene in play</span>
                <button
                    onClick={resumeMontageFromScene}
                    className="text-[9px] font-bold uppercase tracking-widest px-3 py-1 border border-purple-800/50 text-purple-300 hover:bg-purple-900/30">
                    Resume montage
                </button>
            </div>
        );
    }

    const regenLeft = MONTAGE_MAX_REGENERATES - proposal.regenerateCount;

    return (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in">
            <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#0a0a0a] border border-purple-900/40 p-6 space-y-4 shadow-2xl rounded-sm">
                {/* Header */}
                <div className="flex items-center gap-3 border-b border-purple-900/20 pb-3">
                    <span className="text-purple-400 text-lg">⏳</span>
                    <div className="flex-1">
                        <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-purple-300">
                            Montage — {proposal.type}
                        </h3>
                        <p className="text-[9px] text-gray-500 uppercase tracking-widest mt-1">
                            Review each item · nothing is written until you accept
                        </p>
                    </div>
                </div>

                {/* Narrative */}
                <div className="bg-gray-950 border border-gray-800 px-4 py-3 rounded-sm">
                    <p className="text-gray-300 text-xs leading-relaxed whitespace-pre-wrap">{proposal.narrative}</p>
                </div>

                {/* Aging note */}
                {proposal.ageIncrementYears > 0 && (
                    <p className="text-[10px] text-amber-500/80 uppercase tracking-widest">
                        Ages the character +{proposal.ageIncrementYears} year(s)
                    </p>
                )}

                {/* Bulk controls */}
                <div className="flex items-center gap-2">
                    <button onClick={vetoAllMontageItems}
                        className="text-[9px] font-bold uppercase tracking-widest px-3 py-1 border border-red-900/40 text-red-500 hover:bg-red-950/40">
                        Veto all
                    </button>
                    <button onClick={restoreAllMontageItems}
                        className="text-[9px] font-bold uppercase tracking-widest px-3 py-1 border border-gray-700 text-gray-400 hover:border-gray-500">
                        Restore all
                    </button>
                    <button onClick={regenerateMontage} disabled={regenLeft <= 0 || isThinking}
                        className="text-[9px] font-bold uppercase tracking-widest px-3 py-1 border border-purple-800/50 text-purple-400 hover:bg-purple-900/30 disabled:opacity-30 disabled:cursor-not-allowed ml-auto">
                        {isThinking ? 'Regenerating…' : `Regenerate (${regenLeft} left)`}
                    </button>
                </div>

                {/* Sections */}
                <Section title="Memories" count={proposal.memories.length}>
                    {proposal.memories.map((it: ReviewableItem<ProposedMemory>) => (
                        <ItemRow key={it.id} category="memories" item={it}
                            primary={it.data.summary}
                            secondary={`salience ${it.data.salience}${it.data.pinned ? ' · pinned' : ''}`}
                            editableField="summary"
                            canPlayOut={!!it.data.can_play_out} />
                    ))}
                </Section>

                <Section title="Traumas" count={proposal.traumas.length}>
                    {proposal.traumas.map((it: ReviewableItem<ProposedTrauma>) => (
                        <ItemRow key={it.id} category="traumas" item={it}
                            primary={it.data.description}
                            secondary={`severity ${it.data.severity} · ${it.data.source}`}
                            editableField="description" />
                    ))}
                </Section>

                <Section title="Skills" count={proposal.skillUpdates.length}>
                    {proposal.skillUpdates.map((it: ReviewableItem<ProposedSkillUpdate>) => (
                        <ItemRow key={it.id} category="skillUpdates" item={it}
                            primary={`${it.data.skill_name} → ${it.data.new_level}`}
                            secondary={it.data.reason} />
                    ))}
                </Section>

                <Section title="NPC changes" count={proposal.npcDeltas.length}>
                    {proposal.npcDeltas.map((it: ReviewableItem<ProposedNpcDelta>) => (
                        <ItemRow key={it.id} category="npcDeltas" item={it}
                            primary={`${it.data.change_type}: ${it.data.description}`} />
                    ))}
                </Section>

                {/* Commit controls */}
                <div className="flex gap-2 pt-2 border-t border-gray-900">
                    <button onClick={acceptMontage} disabled={isThinking}
                        className="flex-1 py-3 bg-purple-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-purple-700 transition-all border border-purple-800/50 disabled:opacity-40">
                        Accept &amp; Commit
                    </button>
                    <button onClick={cancelMontage} disabled={isThinking}
                        className="flex-1 py-3 border border-red-900/30 text-red-600 text-[10px] font-bold uppercase tracking-widest hover:bg-red-950/30 transition-all bg-gray-900/50 disabled:opacity-40">
                        Cancel (no time passes)
                    </button>
                </div>
            </div>
        </div>
    );
};
