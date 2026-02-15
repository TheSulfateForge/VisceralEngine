import React, { useLayoutEffect, useState, useRef, useCallback, useEffect } from 'react';
import { useGameStore } from '../../store';
import { useGeminiClient } from '../../hooks/useGeminiClient';
import { useRollSystem } from '../../hooks/core';
import { MessageItem } from '../chat/MessageItem';
import { InputArea } from '../chat/InputArea';
import { UI_CONFIG } from '../../constants';
import { RollRequest } from '../../types';
import { useSensoryFX } from '../../hooks/useSensoryFX';

export const ChatView: React.FC = () => {
    const { 
        gameHistory, 
        setGameHistory, 
        gameWorld, 
        triggerScreenEffect 
    } = useGameStore();

    const { handleSend, handleVisualize } = useGeminiClient();
    const { playSound, triggerHaptic } = useSensoryFX();
    const scrollRef = useRef<HTMLDivElement>(null);
    const rollSystem = useRollSystem();

    const { history, isThinking } = gameHistory;
    const { isGeneratingVisual } = gameWorld;

    const [isAtBottom, setIsAtBottom] = useState(true);
    const [visibleCount, setVisibleCount] = useState<number>(UI_CONFIG.MAX_ROLL_LOG_ENTRIES);

    const totalMessages = history.length;
    const startIndex = Math.max(0, totalMessages - visibleCount);
    const displayHistory = history.slice(startIndex);
    const hasOlderMessages = startIndex > 0;

    const prevTurnCount = useRef(gameHistory.turnCount);
    useEffect(() => {
        if (gameHistory.turnCount < prevTurnCount.current) {
            setVisibleCount(UI_CONFIG.MAX_ROLL_LOG_ENTRIES);
        }
        prevTurnCount.current = gameHistory.turnCount;
    }, [gameHistory.turnCount]);

    // Scroll Logic: Check if user is near bottom
    const onScroll = () => {
        if (!scrollRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
        // Tolerance of 50px
        const atBottom = scrollHeight - scrollTop - clientHeight < 50;
        setIsAtBottom(atBottom);
    };

    // Auto-scroll only if already at bottom (sticky scroll)
    useLayoutEffect(() => {
        if (isAtBottom && scrollRef.current) {
            scrollRef.current.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: 'auto' // Instant scroll for new messages to prevent flicker
            });
        }
    }, [history.length, isThinking, isAtBottom]);

    const executeLocalRoll = useCallback((msgId: string, request: RollRequest) => {
        const res = rollSystem.executeRoll(request, gameHistory.rollStats);
        
        setGameHistory(prev => ({
            ...prev,
            rollStats: res.newStats,
            rollLog: [res.logEntry, ...prev.rollLog].slice(0, 50),
            history: prev.history.map(m => m.id === msgId ? { ...m, isResolved: true } : m)
        }));

        if (res.outcome === 'CRITICAL FAILURE') {
            triggerScreenEffect('fail');
            playSound('error');
            triggerHaptic('failure');
        } else if (res.outcome === 'CRITICAL SUCCESS') {
            triggerScreenEffect('crit');
            playSound('success');
            triggerHaptic('heavy');
        } else {
            playSound('click');
            triggerHaptic('medium');
        }

        handleSend(`[SYSTEM: Dice Result ${res.total} (${res.outcome}). Narrate the consequences.]`);
    }, [gameHistory.rollStats, rollSystem, setGameHistory, triggerScreenEffect, handleSend, playSound, triggerHaptic]);

    const resolveBargain = useCallback((msgId: string, accepted: boolean, description: string) => {
        setGameHistory(prev => ({ ...prev, history: prev.history.map(m => m.id === msgId ? { ...m, isResolved: true } : m) }));
        
        if (accepted) {
            playSound('boot');
            triggerHaptic('heavy');
            handleSend(`[SYSTEM: Bargain Accepted: ${description}]`);
        } else {
            playSound('hover');
            handleSend(`[SYSTEM: Bargain Refused]`);
        }
    }, [setGameHistory, handleSend, playSound, triggerHaptic]);

    const onSendMessage = (text: string) => {
        playSound('click');
        triggerHaptic('light');
        // Force scroll to bottom when user sends
        if (scrollRef.current) {
             setIsAtBottom(true); 
             setTimeout(() => {
                 scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
             }, 50);
        }
        handleSend(text);
    };

    return (
        <>
            <div 
                className="flex-1 overflow-y-auto p-6 md:p-12 space-y-16 pb-64 md:pb-96 max-w-4xl mx-auto w-full custom-scrollbar" 
                ref={scrollRef}
                onScroll={onScroll}
            >
                {hasOlderMessages && (
                    <div className="text-center py-6">
                        <button
                        onClick={() => setVisibleCount(prev => Math.min(prev + 50, totalMessages))}
                        className="text-[9px] font-mono uppercase tracking-[0.3em] text-gray-600 hover:text-red-500 border border-gray-800 hover:border-red-900/40 px-4 py-2 transition-all"
                        >
                        Load Previous Memories ({totalMessages - visibleCount} remaining)
                        </button>
                    </div>
                )}
                {displayHistory.map(msg => (
                    <MessageItem 
                        key={msg.id} 
                        msg={msg} 
                        executeLocalRoll={executeLocalRoll} 
                        resolveBargain={resolveBargain} 
                    />
                ))}
                {isThinking && (
                    <div className="text-[10px] font-mono animate-pulse text-red-900 uppercase tracking-[1em] text-center w-full py-16">
                        Neural Flux...
                    </div>
                )}
            </div>
            <InputArea 
                onSend={onSendMessage} 
                handleVisualize={handleVisualize} 
                isGeneratingVisual={isGeneratingVisual} 
                isThinking={isThinking}
            />
        </>
    );
};