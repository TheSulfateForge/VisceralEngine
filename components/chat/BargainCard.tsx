
import React from 'react';
import { BargainRequest } from '../../types';

interface BargainCardProps {
    msgId: string;
    request: BargainRequest;
    onResolve: (id: string, accepted: boolean, desc: string) => void;
}

export const BargainCard: React.FC<BargainCardProps> = ({ msgId, request, onResolve }) => {
    return (
        <div className="my-6 border border-red-900/50 bg-gradient-to-b from-red-950/40 to-amber-950/20 rounded-sm overflow-hidden shadow-lg shadow-red-900/10">
            <div className="px-4 py-2 border-b border-red-900/50 bg-black/60 flex items-center gap-2">
                <span className="text-red-500">♠</span>
                <span className="text-[10px] font-bold tracking-widest uppercase text-red-400">Devil's Bargain</span>
            </div>
            
            <div className="p-5 space-y-4">
                <p className="text-sm text-gray-300 italic leading-relaxed">
                    "{request.description}"
                </p>
                
                <div className="flex gap-3 pt-2">
                    <button
                        onClick={() => onResolve(msgId, true, request.description)}
                        className="flex-1 py-2 text-[10px] font-bold uppercase tracking-widest border border-red-900/50 text-red-400 hover:bg-red-900/30 hover:text-white transition-colors"
                    >
                        Accept
                    </button>
                    <button
                        onClick={() => onResolve(msgId, false, "")}
                        className="flex-1 py-2 text-[10px] font-bold uppercase tracking-widest border border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
                    >
                        Refuse
                    </button>
                </div>
            </div>
        </div>
    );
};
