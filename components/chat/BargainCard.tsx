
import React from 'react';
import { BargainRequest } from '../../types';

interface BargainCardProps {
    msgId: string;
    request: BargainRequest;
    onResolve: (id: string, accepted: boolean, desc: string) => void;
}

export const BargainCard: React.FC<BargainCardProps> = ({ msgId, request, onResolve }) => {
    return (
        <div className="mt-10 p-6 md:p-12 bg-yellow-950/5 border border-yellow-900/20 rounded-sm space-y-10 text-center shadow-xl">
            <span className="text-[10px] uppercase font-bold tracking-[0.6em] text-yellow-800">Devil's Bargain</span>
            <h4 className="text-lg md:text-2xl font-light italic text-gray-400">"{request.description}"</h4>
            <div className="flex flex-col md:flex-row justify-center gap-6 md:gap-8">
                <button onClick={() => onResolve(msgId, true, request.description)} className="px-12 py-5 bg-yellow-900/10 border border-yellow-900/30 text-yellow-600 hover:bg-yellow-900 hover:text-black uppercase text-[11px] font-bold tracking-[0.3em] transition-all">Accept Sacrifice</button>
                <button onClick={() => onResolve(msgId, false, "")} className="px-12 py-5 border border-gray-900 text-gray-700 hover:text-white uppercase text-[11px] font-bold tracking-[0.3em] transition-all">Reject</button>
            </div>
        </div>
    );
};
