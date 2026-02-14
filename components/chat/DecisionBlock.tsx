
import React from 'react';
import { RollRequest, BargainRequest } from '../../types';
import { formatModifier } from '../../utils';

interface DecisionBlockProps {
    msgId: string;
    rollRequest: RollRequest;
    bargainRequest: BargainRequest;
    onExecuteRoll: (id: string, req: RollRequest) => void;
    onResolveBargain: (id: string, accepted: boolean, desc: string) => void;
}

export const DecisionBlock: React.FC<DecisionBlockProps> = ({ 
    msgId, rollRequest, bargainRequest, onExecuteRoll, onResolveBargain 
}) => {
    return (
        <div className="mt-8 flex flex-col md:flex-row gap-0 rounded-sm overflow-hidden shadow-2xl animate-fade-in border border-gray-900">
            {/* Left Side: The Sacrifice (Bargain) */}
            <div className="flex-1 bg-yellow-950/5 p-6 md:p-10 flex flex-col relative border-b md:border-b-0 md:border-r border-gray-900/50 group hover:bg-yellow-950/10 transition-colors">
                <div className="absolute top-0 left-0 w-full h-1 bg-yellow-900/30"></div>
                <div className="mb-6">
                    <span className="text-[9px] font-bold text-yellow-700 uppercase tracking-[0.4em] block mb-2">The Sacrifice</span>
                    <h3 className="text-xl md:text-2xl font-serif text-gray-300 italic">"Guarantee Success"</h3>
                </div>
                
                <p className="text-sm md:text-base text-gray-400 font-light leading-relaxed mb-8 flex-1">
                    {bargainRequest.description}
                </p>

                <div className="mt-auto pt-6 border-t border-yellow-900/10">
                    <button 
                        onClick={() => onResolveBargain(msgId, true, bargainRequest.description)}
                        className="w-full py-4 bg-yellow-900/10 border border-yellow-900/30 text-yellow-600 hover:bg-yellow-900 hover:text-black uppercase text-[10px] font-bold tracking-[0.3em] transition-all"
                    >
                        Accept Bargain
                    </button>
                    <p className="text-[9px] text-gray-600 mt-2 text-center uppercase tracking-widest">No Roll Required</p>
                </div>
            </div>

            {/* Center Divider Text (Desktop Only) */}
            <div className="hidden md:flex flex-col justify-center items-center w-0 relative z-10">
                 <div className="absolute bg-[#050505] border border-gray-800 rounded-full w-10 h-10 flex items-center justify-center">
                    <span className="text-[9px] font-bold text-gray-500">OR</span>
                 </div>
            </div>

            {/* Center Divider Text (Mobile Only) */}
             <div className="md:hidden flex items-center justify-center py-4 bg-[#050505]">
                <div className="h-[1px] flex-1 bg-gray-900"></div>
                <span className="px-4 text-[9px] font-bold text-gray-500">OR</span>
                <div className="h-[1px] flex-1 bg-gray-900"></div>
            </div>

            {/* Right Side: The Gamble (Roll) */}
            <div className="flex-1 bg-red-950/5 p-6 md:p-10 flex flex-col relative group hover:bg-red-950/10 transition-colors">
                <div className="absolute top-0 left-0 w-full h-1 bg-red-900/30"></div>
                <div className="mb-6 text-right">
                    <span className="text-[9px] font-bold text-red-800 uppercase tracking-[0.4em] block mb-2">The Gamble</span>
                    <h3 className="text-xl md:text-2xl font-serif text-gray-300 italic">"{rollRequest.challenge}"</h3>
                </div>

                <div className="flex-1 flex flex-col items-end justify-center mb-8 space-y-2">
                     <div className="text-4xl font-light text-gray-500 font-mono">d20</div>
                     <div className="flex flex-wrap justify-end gap-3">
                        {rollRequest.bonus !== 0 && (
                            <span className="px-2 py-1 bg-gray-900 border border-gray-800 text-gray-400 text-xs font-mono">
                                {formatModifier(rollRequest.bonus || 0)}
                            </span>
                        )}
                        {rollRequest.advantage && (
                            <span className="px-2 py-1 bg-green-950/20 border border-green-900/30 text-green-600 text-xs uppercase tracking-wider">
                                Advantage
                            </span>
                        )}
                        {rollRequest.disadvantage && (
                            <span className="px-2 py-1 bg-red-950/20 border border-red-900/30 text-red-600 text-xs uppercase tracking-wider">
                                Disadvantage
                            </span>
                        )}
                     </div>
                </div>

                <div className="mt-auto pt-6 border-t border-red-900/10">
                    <button 
                        onClick={() => onExecuteRoll(msgId, rollRequest)}
                        className="w-full py-4 bg-red-900/10 border border-red-900/30 text-red-500 hover:bg-red-900 hover:text-white uppercase text-[10px] font-bold tracking-[0.3em] transition-all"
                    >
                        Roll Dice
                    </button>
                    <p className="text-[9px] text-gray-600 mt-2 text-center uppercase tracking-widest">Risk Failure</p>
                </div>
            </div>
        </div>
    );
};
