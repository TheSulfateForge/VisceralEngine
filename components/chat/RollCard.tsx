
import React from 'react';
import { RollRequest } from '../../types';
import { formatModifier } from '../../utils';

interface RollCardProps {
    msgId: string;
    request: RollRequest;
    onExecute: (id: string, req: RollRequest) => void;
}

export const RollCard: React.FC<RollCardProps> = ({ msgId, request, onExecute }) => {
    return (
        <div className="mt-10 p-6 md:p-12 bg-red-950/5 border border-red-900/30 text-center space-y-10 shadow-2xl relative">
            <span className="text-[10px] uppercase font-bold tracking-[0.6em] text-red-800">Intervention Required</span>
            <h4 className="text-lg md:text-2xl font-light italic text-gray-400">"{request.challenge}"</h4>
            <div className="flex flex-col items-center space-y-4">
                <div className="flex flex-wrap justify-center gap-4 text-[10px] font-mono text-gray-600 uppercase">
                {request.bonus !== 0 && <span>Bonus: {formatModifier(request.bonus || 0)}</span>}
                {request.advantage && <span className="text-green-900">Advantage</span>}
                {request.disadvantage && <span className="text-red-900">Disadvantage</span>}
                </div>
                <button onClick={() => onExecute(msgId, request)} className="w-full md:w-auto px-10 md:px-14 py-5 md:py-6 bg-red-900 text-white uppercase text-xs font-bold tracking-[0.5em] hover:scale-105 transition-all">Execute d20 Probe</button>
            </div>
        </div>
    );
};
