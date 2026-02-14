
import React, { useState, useRef, useEffect } from 'react';

interface InputAreaProps {
    onSend: (text: string) => void;
    handleVisualize: () => void;
    isGeneratingVisual: boolean;
    isThinking: boolean;
}

export const InputArea: React.FC<InputAreaProps> = ({ onSend, handleVisualize, isGeneratingVisual, isThinking }) => {
    const [input, setInput] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-resize logic
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
        }
    }, [input]);

    const handleSubmit = () => {
        if (!input.trim() || isThinking) return;
        onSend(input);
        setInput('');
        // Reset height immediately
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
    };

    return (
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
                    className="w-full bg-[#080808] border border-gray-900 group-focus-within:border-red-900/60 rounded-sm px-6 md:px-10 py-6 md:py-8 text-lg md:text-xl font-light focus:outline-none resize-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden" 
                    rows={1}
                    style={{ minHeight: '80px' }}
                />
                <div className={`absolute bottom-4 right-4 text-[9px] text-gray-700 uppercase tracking-widest transition-opacity ${isThinking || !input ? 'opacity-0' : 'opacity-0 group-focus-within:opacity-100'}`}>
                    Return to Submit
                </div>
            </div>
        </div>
    );
};
