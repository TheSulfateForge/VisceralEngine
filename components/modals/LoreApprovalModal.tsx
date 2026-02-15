
import React, { useState } from 'react';
import { LoreItem } from '../../types';
import { useGameStore } from '../../store';
import { useToast } from '../providers/ToastProvider';

export const LoreApprovalModal: React.FC = () => {
    const { pendingLore, setPendingLore, setGameWorld } = useGameStore();
    const { showToast } = useToast();
    const [editingContent, setEditingContent] = useState<string | null>(null);

    if (pendingLore.length === 0) return null;

    const current = pendingLore[0];

    const handleApprove = (lore: LoreItem) => {
        // Add to canonical lore
        setGameWorld(prev => ({
            ...prev,
            lore: [...prev.lore, lore]
        }));
        // Remove from queue
        setPendingLore(prev => prev.slice(1));
        showToast(`Lore Accepted: ${lore.keyword}`, 'success');
        setEditingContent(null);
    };

    const handleReject = () => {
        const rejected = pendingLore[0];
        setPendingLore(prev => prev.slice(1));
        showToast(`Lore Rejected: ${rejected.keyword}`, 'info');
        setEditingContent(null);
    };

    const handleEdit = () => {
        setEditingContent(current.content);
    };

    const handleSaveEdit = () => {
        if (editingContent !== null) {
            handleApprove({ ...current, content: editingContent });
        }
    };

    return (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in">
            <div className="w-full max-w-lg bg-[#0a0a0a] border border-amber-900/40 p-6 space-y-4 shadow-2xl rounded-sm">
                {/* Header */}
                <div className="flex items-center gap-3 border-b border-amber-900/20 pb-3">
                    <span className="text-amber-500 text-lg">⚡</span>
                    <div className="flex-1">
                        <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-amber-400">
                            New World Lore Discovered
                        </h3>
                        <p className="text-[9px] text-gray-500 uppercase tracking-widest mt-1">
                            AI-Generated — Requires Your Approval
                        </p>
                    </div>
                    {pendingLore.length > 1 && (
                        <span className="text-[10px] text-gray-600 font-mono">
                            +{pendingLore.length - 1} more
                        </span>
                    )}
                </div>

                {/* Keyword */}
                <div className="bg-amber-950/20 border border-amber-900/20 px-4 py-2 rounded-sm">
                    <p className="text-[9px] text-gray-500 uppercase tracking-widest mb-1">Keyword</p>
                    <p className="text-amber-300 font-bold text-sm">{current.keyword}</p>
                </div>

                {/* Content */}
                <div className="bg-gray-950 border border-gray-800 px-4 py-3 rounded-sm">
                    <p className="text-[9px] text-gray-500 uppercase tracking-widest mb-2">
                        World Rule
                    </p>
                    {editingContent !== null ? (
                        <textarea
                            value={editingContent}
                            onChange={(e) => setEditingContent(e.target.value)}
                            className="w-full bg-black border border-gray-800 text-gray-300 text-xs leading-relaxed p-2 min-h-[100px] focus:border-amber-900 outline-none resize-y"
                        />
                    ) : (
                        <p className="text-gray-300 text-xs leading-relaxed whitespace-pre-wrap">
                            {current.content}
                        </p>
                    )}
                </div>

                {/* Warning */}
                <p className="text-[9px] text-gray-600 leading-relaxed border-t border-gray-900 pt-3">
                    This rule will become permanent world canon. The AI will reference
                    it in future turns and may use it to justify mechanical changes
                    (modifier adjustments, new conditions, narrative consequences).
                </p>

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                    <button
                        onClick={() => editingContent !== null ? handleSaveEdit() : handleApprove(current)}
                        className="flex-1 py-3 bg-amber-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-amber-700 transition-all border border-amber-800/50"
                    >
                        {editingContent !== null ? 'Save & Approve' : 'Approve'}
                    </button>
                    {editingContent === null && (
                        <button
                            onClick={handleEdit}
                            className="flex-1 py-3 border border-gray-700 text-gray-400 text-[10px] font-bold uppercase tracking-widest hover:border-amber-900 hover:text-amber-400 transition-all bg-gray-900/50"
                        >
                            Edit
                        </button>
                    )}
                    <button
                        onClick={handleReject}
                        className="flex-1 py-3 border border-red-900/30 text-red-600 text-[10px] font-bold uppercase tracking-widest hover:bg-red-950/30 transition-all bg-gray-900/50"
                    >
                        Reject
                    </button>
                </div>
            </div>
        </div>
    );
};
