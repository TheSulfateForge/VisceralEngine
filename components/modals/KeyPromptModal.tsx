
import React from 'react';

interface KeyPromptModalProps {
    onLink: () => void;
}

export const KeyPromptModal: React.FC<KeyPromptModalProps> = ({ onLink }) => {
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/98">
            <div className="w-full max-w-md bg-[#0a0a0a] border border-red-900/50 p-12 space-y-12 text-center">
            <h2 className="text-4xl font-bold uppercase italic text-red-900 animate-pulse">Neural Link Severed</h2>
            <button onClick={onLink} className="w-full py-5 bg-red-900 text-white font-bold uppercase tracking-[0.5em] text-xs">Re-establish Pulse</button>
            </div>
        </div>
    );
};
