
import React, { useState, useRef, useEffect } from 'react';

interface InputAreaProps {
    onSend: (text: string) => void;
    handleVisualize: () => void;
    isGeneratingVisual: boolean;
    isThinking: boolean;
}

export const InputArea: React.FC<InputAreaProps> = ({ onSend, handleVisualize, isGeneratingVisual, isThinking }) => {
    const [input, setInput] = useState('');
    const [isExpanded, setIsExpanded] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const expandedTextareaRef = useRef<HTMLTextAreaElement>(null);

    // v1.22: Auto-resize logic — grow with content up to the CSS max-height.
    // Browser handles overflow/scroll once the clamp kicks in.
    useEffect(() => {
        if (!isExpanded && textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [input, isExpanded]);

    // v1.22: When opening the expanded composer, focus it and place the caret at end.
    useEffect(() => {
        if (isExpanded && expandedTextareaRef.current) {
            expandedTextareaRef.current.focus();
            const len = expandedTextareaRef.current.value.length;
            expandedTextareaRef.current.setSelectionRange(len, len);
        }
    }, [isExpanded]);

    // v1.22: Lock background scroll while the expanded overlay is open.
    useEffect(() => {
        if (!isExpanded) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [isExpanded]);

    const handleSubmit = () => {
        if (!input.trim() || isThinking) return;
        onSend(input);
        setInput('');
        setIsExpanded(false);
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
    };

    return (
        <>
            <div className="absolute bottom-0 left-0 right-0 p-6 md:p-12 bg-gradient-to-t from-black via-black/95 to-transparent flex flex-col items-center">
                <div className="max-w-3xl w-full flex justify-end mb-4">
                    <button
                        onClick={handleVisualize}
                        disabled={isGeneratingVisual || isThinking}
                        className={`text-[9px] font-bold uppercase tracking-widest px-4 py-2 border transition-all ${isGeneratingVisual ? 'border-gray-800 text-gray-800 animate-pulse' : 'border-red-900/30 text-red-900 hover:bg-red-900 hover:text-white'}`}
                    >
                        {isGeneratingVisual ? 'Synthesizing...' : 'Capture Visual Fragment'}
                    </button>
                </div>
                <div className="max-w-3xl mx-auto w-full relative group">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSubmit())}
                        placeholder={isThinking ? "Processing neural response..." : "Declare intent..."}
                        disabled={isThinking}
                        // v1.22: overflow-hidden -> overflow-y-auto so tall content can scroll internally on mobile.
                        className="w-full bg-[#080808] border border-gray-900 group-focus-within:border-red-900/60 rounded-sm px-6 md:px-10 py-6 md:py-8 pr-14 md:pr-16 text-lg md:text-xl font-light focus:outline-none resize-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed overflow-y-auto"
                        rows={1}
                        // v1.22: viewport-aware max height (was flat 200px JS clamp).
                        style={{ minHeight: '80px', maxHeight: 'min(40vh, 320px)', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
                    />
                    {/* v1.22: Expand-to-fullscreen toggle for easier long-form composition on mobile. */}
                    <button
                        type="button"
                        onClick={() => setIsExpanded(true)}
                        disabled={isThinking}
                        aria-label="Expand compose area"
                        title="Expand compose area"
                        className="absolute top-3 right-3 w-9 h-9 flex items-center justify-center border border-gray-900 text-gray-600 hover:text-red-400 hover:border-red-900/60 bg-[#080808]/80 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">
                            <polyline points="15 3 21 3 21 9" />
                            <polyline points="9 21 3 21 3 15" />
                            <line x1="21" y1="3" x2="14" y2="10" />
                            <line x1="3" y1="21" x2="10" y2="14" />
                        </svg>
                    </button>
                    <div className={`absolute bottom-4 right-4 text-[9px] text-gray-700 uppercase tracking-widest transition-opacity ${isThinking || !input ? 'opacity-0' : 'opacity-0 group-focus-within:opacity-100'}`}>
                        Return to Submit
                    </div>
                </div>
            </div>

            {/* v1.22: Full-screen compose overlay. Enter inserts newline; Cmd/Ctrl+Enter submits. */}
            {isExpanded && (
                <div
                    className="fixed inset-0 z-50 bg-black flex flex-col"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Expanded compose"
                >
                    <div className="flex items-center justify-between px-4 py-3 md:px-6 md:py-4 border-b border-gray-900">
                        <span className="text-[10px] md:text-[11px] font-bold uppercase tracking-[0.3em] text-red-900">
                            Compose Intent
                        </span>
                        <button
                            type="button"
                            onClick={() => setIsExpanded(false)}
                            aria-label="Collapse compose area"
                            className="text-[9px] font-bold uppercase tracking-widest px-3 py-2 border border-gray-900 text-gray-500 hover:text-gray-200 hover:border-gray-600 transition-colors"
                        >
                            Collapse
                        </button>
                    </div>
                    <textarea
                        ref={expandedTextareaRef}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                e.preventDefault();
                                handleSubmit();
                            }
                        }}
                        placeholder={isThinking ? "Processing neural response..." : "Declare intent..."}
                        disabled={isThinking}
                        className="flex-1 w-full bg-black text-gray-100 px-4 md:px-8 py-6 text-lg md:text-xl font-light focus:outline-none resize-none overflow-y-auto disabled:opacity-50"
                        style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
                    />
                    <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-6 md:py-4 border-t border-gray-900 bg-[#080808]">
                        <span className="text-[9px] uppercase tracking-widest text-gray-700">
                            {input.length} chars · ⌘/Ctrl + Enter to submit
                        </span>
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => setInput('')}
                                disabled={isThinking || !input}
                                className="text-[9px] font-bold uppercase tracking-widest px-4 py-2 border border-gray-900 text-gray-500 hover:text-gray-200 hover:border-gray-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                Clear
                            </button>
                            <button
                                type="button"
                                onClick={handleSubmit}
                                disabled={!input.trim() || isThinking}
                                className="text-[9px] font-bold uppercase tracking-widest px-5 py-2 border border-red-900/60 text-red-400 hover:bg-red-900 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                {isThinking ? 'Transmitting...' : 'Submit Intent'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
