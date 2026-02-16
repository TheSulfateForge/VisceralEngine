
import { useState, useEffect, useRef } from 'react';
import { ChatMessage } from '../types';
import { UI_CONFIG } from '../constants';

export const useVirtualizedMessages = (history: ChatMessage[], turnCount: number) => {
    const [visibleCount, setVisibleCount] = useState<number>(UI_CONFIG.MAX_ROLL_LOG_ENTRIES);

    const totalMessages = history.length;
    const startIndex = Math.max(0, totalMessages - visibleCount);
    const displayHistory = history.slice(startIndex);
    const hasOlderMessages = startIndex > 0;

    const prevTurnCount = useRef(turnCount);
    
    // Reset visible count if we undo (turn count decreases)
    useEffect(() => {
        if (turnCount < prevTurnCount.current) {
            setVisibleCount(UI_CONFIG.MAX_ROLL_LOG_ENTRIES);
        }
        prevTurnCount.current = turnCount;
    }, [turnCount]);

    const loadMore = () => {
        setVisibleCount(prev => Math.min(prev + 50, totalMessages));
    };

    return {
        displayHistory,
        hasOlderMessages,
        remainingCount: totalMessages - visibleCount,
        loadMore
    };
};
