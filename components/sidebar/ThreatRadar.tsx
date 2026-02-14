
import React from 'react';
import { ActiveThreat } from '../../types';

interface ThreatRadarProps {
    threats: ActiveThreat[];
}

export const ThreatRadar: React.FC<ThreatRadarProps> = ({ threats }) => {
    if (!threats || threats.length === 0) return null;

    return (
        <div className="space-y-2 pt-2 border-t border-gray-900">
            <span className="text-[9px] font-bold text-yellow-900/70 uppercase tracking-widest animate-pulse">Tactical Radar (OODA)</span>
            <div className="flex flex-col gap-1.5">
                {threats.map(threat => (
                    <div key={threat.id} className={`border px-2.5 py-1.5 rounded-sm transition-all relative overflow-hidden ${
                        threat.status === 'EFFECTIVE' ? 'bg-red-950/20 border-red-900/40' :
                        threat.status === 'COMPROMISED' ? 'bg-yellow-950/10 border-yellow-900/30' :
                        'bg-gray-900/50 border-gray-800 opacity-70'
                    }`}>
                        <div className="flex justify-between items-center mb-1 relative z-10">
                            <span className={`text-[9px] font-bold uppercase ${
                                threat.status === 'EFFECTIVE' ? 'text-red-500' :
                                threat.status === 'COMPROMISED' ? 'text-yellow-600' : 'text-gray-400 line-through'
                            }`}>{threat.name}</span>
                            <span className="text-[7px] text-gray-500 tracking-wider">[{threat.archetype.substring(0,3)}]</span>
                        </div>
                        
                        <div className="text-[8px] font-bold text-gray-300 mb-1 relative z-10">
                            "{threat.current_action || "Holding"}"
                        </div>

                        <div className="flex justify-between items-end relative z-10">
                            <div className="flex gap-1">
                                <span className="text-[7px] bg-black/50 px-1 border border-gray-800 text-gray-400">{threat.cover_state}</span>
                                <span className="text-[7px] bg-black/50 px-1 border border-gray-800 text-gray-400">{threat.distance}</span>
                            </div>
                            <span className={`text-[7px] font-mono uppercase px-1 rounded ${
                                threat.status === 'EFFECTIVE' ? 'bg-red-900 text-white' :
                                threat.status === 'COMPROMISED' ? 'bg-yellow-900 text-black' : 'bg-gray-800 text-gray-400'
                            }`}>{threat.status}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
