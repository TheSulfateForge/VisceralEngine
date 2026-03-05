import React from 'react';
import { WorldTickEvent } from '../../types';

interface WorldTickAnnotationsProps {
    events: WorldTickEvent[];
}

export const WorldTickAnnotations: React.FC<WorldTickAnnotationsProps> = ({ events }) => {
    if (!events || events.length === 0) return null;

    return (
        <div className="my-4 border border-gray-800 bg-black/40 rounded-sm overflow-hidden">
            <div className="px-3 py-1.5 border-b border-gray-800 bg-black/60 flex items-center gap-2">
                <span className="text-[10px] font-bold tracking-widest uppercase text-gray-500">World Tick Events</span>
            </div>
            <div className="p-3 space-y-2">
                {events.map((event, idx) => {
                    let icon = '⚠';
                    let color = 'text-red-400';
                    
                    if (event.status === 'expired') {
                        icon = '✓';
                        color = 'text-green-400';
                    } else if (event.status === 'triggered') {
                        icon = '💥';
                        color = 'text-red-500 animate-pulse';
                    } else if (event.turns_until_impact === 0) {
                        icon = '💥';
                        color = 'text-red-500 animate-pulse';
                    }

                    return (
                        <div key={idx} className="flex items-start gap-2 text-xs">
                            <span className={`${color}`}>{icon}</span>
                            <div className="flex-1">
                                <span className="text-gray-300">{event.description}</span>
                                {event.turns_until_impact !== undefined && event.status !== 'expired' && event.status !== 'triggered' && (
                                    <span className="ml-2 text-[10px] text-gray-500 uppercase tracking-widest">
                                        ETA: {event.turns_until_impact} turns
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
