
import React, { useState, memo, useEffect, useRef } from 'react';
import { ChatMessage, Role } from '../../types';
import { RollCard } from './RollCard';
import { BargainCard } from './BargainCard';
import { DecisionBlock } from './DecisionBlock';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import { useSensoryFX } from '../../hooks/useSensoryFX';

interface MessageItemProps {
    msg: ChatMessage;
    executeLocalRoll: (id: string, req: any) => void;
    resolveBargain: (id: string, accepted: boolean, desc: string) => void;
}

const TypewriterText: React.FC<{ text: string; onComplete?: () => void }> = ({ text, onComplete }) => {
    const [displayed, setDisplayed] = useState('');
    const index = useRef(0);

    useEffect(() => {
        // Reset if text changes entirely
        setDisplayed('');
        index.current = 0;
    }, [text]);

    useEffect(() => {
        if (index.current >= text.length) {
            onComplete?.();
            return;
        }

        const interval = setInterval(() => {
            if (index.current < text.length) {
                setDisplayed(prev => prev + text.charAt(index.current));
                index.current++;
            } else {
                clearInterval(interval);
                onComplete?.();
            }
        }, 10); // Speed: 10ms per char

        return () => clearInterval(interval);
    }, [text, onComplete]);

    return <MarkdownRenderer content={displayed} />;
};

const MessageItemComponent: React.FC<MessageItemProps> = ({ msg, executeLocalRoll, resolveBargain }) => {
    const hasDecision = msg.rollRequest && msg.bargainRequest && !msg.isResolved;
    const [showSubtext, setShowSubtext] = useState(false);
    const [isTypingComplete, setIsTypingComplete] = useState(false);
    const isModel = msg.role === Role.MODEL;

    // Only typewrite if it's the latest model message (heuristic: checking timestamp vs now is tricky, 
    // better to assume if we are rendering it new, we type it. But for history logs, we just show it.)
    // For this implementation, we will skip typewriter for history items to prevent re-typing on scroll.
    // A simple heuristic: if the message is older than 5 seconds, show immediately.
    const isNew = (Date.now() - new Date(msg.timestamp).getTime()) < 5000;

    const narrativeFontSize = (() => {
        const size = localStorage.getItem('visceral_font_size') || 'xl';
        const sizeMap: Record<string, string> = {
            'sm': 'text-sm md:text-base',
            'base': 'text-base md:text-lg',
            'lg': 'text-lg md:text-xl',
            'xl': 'text-xl md:text-2xl'
        };
        return sizeMap[size] || sizeMap['xl'];
    })();

    return (
        <div className={`flex ${msg.role === Role.USER ? 'justify-end' : 'justify-start'} animate-fade-in`}>
            <div className={`w-full ${msg.role === Role.USER ? 'max-w-[85%]' : ''}`}>
                
                {msg.npcInteraction && (
                    <div className="mb-4 ml-2 max-w-lg">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">{msg.npcInteraction.speaker}</span>
                            {msg.npcInteraction.biological_tells && (
                                <span className="text-xs text-orange-500/90 italic border-l border-orange-900/30 pl-2">
                                    {msg.npcInteraction.biological_tells}
                                </span>
                            )}
                        </div>
                        <div className="text-xl text-gray-100 font-serif italic mb-3 leading-relaxed pl-1 border-l-2 border-transparent">
                            "{msg.npcInteraction.dialogue}"
                        </div>
                        <div className="relative group inline-block">
                             <button 
                                onClick={() => setShowSubtext(!showSubtext)}
                                className={`text-[9px] uppercase tracking-widest border px-2 py-0.5 transition-all ${showSubtext ? 'bg-blue-900/20 text-blue-400 border-blue-900/50' : 'bg-gray-900 border-gray-800 text-gray-600 hover:text-gray-400'}`}
                             >
                                {showSubtext ? 'Hide Intent' : 'Read Intent (Insight)'}
                             </button>
                             {showSubtext && (
                                <div className="mt-2 p-3 bg-blue-950/10 border-l-2 border-blue-900 text-blue-200/80 text-xs italic font-serif">
                                    "{msg.npcInteraction.subtext}"
                                </div>
                             )}
                        </div>
                    </div>
                )}

                <div className={`${msg.role === Role.USER ? 'bg-red-950/5 border-r border-red-900/20 pr-6 pl-4 py-4 rounded-sm text-gray-500 italic text-sm' : msg.role === Role.SYSTEM ? 'bg-gray-900/10 border border-gray-800 text-gray-600 rounded p-5 text-center text-[9px] uppercase font-mono' : `serif-font ${narrativeFontSize} leading-[1.7] text-gray-300 font-light tracking-wide`}`}>
                    {isModel && isNew ? (
                        <TypewriterText text={msg.text} onComplete={() => setIsTypingComplete(true)} />
                    ) : (
                        <MarkdownRenderer content={msg.text} />
                    )}
                </div>

                {hasDecision && (
                    <DecisionBlock 
                        msgId={msg.id} 
                        rollRequest={msg.rollRequest!} 
                        bargainRequest={msg.bargainRequest!} 
                        onExecuteRoll={executeLocalRoll}
                        onResolveBargain={resolveBargain}
                    />
                )}

                {!hasDecision && msg.rollRequest && !msg.isResolved && (
                    <RollCard msgId={msg.id} request={msg.rollRequest} onExecute={executeLocalRoll} />
                )}
                {!hasDecision && msg.bargainRequest && !msg.isResolved && (
                    <BargainCard msgId={msg.id} request={msg.bargainRequest} onResolve={resolveBargain} />
                )}
            </div>
        </div>
    );
};

export const MessageItem = memo(MessageItemComponent, (prev, next) => {
    return (
        prev.msg.id === next.msg.id &&
        prev.msg.text === next.msg.text &&
        prev.msg.isResolved === next.msg.isResolved &&
        prev.msg.npcInteraction === next.msg.npcInteraction
    );
});
