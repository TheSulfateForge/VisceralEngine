
import React, { useRef, useEffect } from 'react';
import { useGameStore } from '../../store';

interface DebugModalProps {
    onClose: () => void;
}

export const DebugModal: React.FC<DebugModalProps> = ({ onClose }) => {
    const { gameHistory } = useGameStore();
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }, [gameHistory.debugLog.length]);

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/98 p-6">
            <div className="w-full max-w-4xl bg-[#0a0a0a] border border-red-900/40 rounded-sm shadow-2xl flex flex-col h-[80vh]">
                <div className="flex items-center justify-between p-4 border-b border-gray-900 bg-gray-950">
                    <h3 className="text-sm font-mono font-bold uppercase text-red-500 tracking-widest">Debug Console // Matrix Logs</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-white px-2">×</button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-2 bg-black">
                    {gameHistory.debugLog.length === 0 && <div className="text-gray-700 italic">No logs recorded.</div>}
                    {gameHistory.debugLog.map((entry, idx) => (
                        <div key={idx} className={`border-l-2 pl-3 py-1 ${
                            entry.type === 'error' ? 'border-red-600 text-red-400' :
                            entry.type === 'success' ? 'border-green-600 text-green-400' :
                            'border-gray-700 text-gray-500'
                        }`}>
                            <span className="opacity-50 mr-3">[{new Date(entry.timestamp).toLocaleTimeString()}]</span>
                            <span>{entry.message}</span>
                        </div>
                    ))}
                    <div ref={bottomRef} />
                </div>
            </div>
        </div>
    );
};
