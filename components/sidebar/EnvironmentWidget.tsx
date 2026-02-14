
import React from 'react';
import { CombatEnvironment } from '../../types';

interface EnvironmentWidgetProps {
    environment?: CombatEnvironment;
}

export const EnvironmentWidget: React.FC<EnvironmentWidgetProps> = ({ environment }) => {
    if (!environment || !environment.terrain_tags || environment.terrain_tags.length === 0) return null;

    return (
        <div className="space-y-2 pt-2 border-t border-gray-900">
            <div className="flex justify-between items-center">
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Environment</span>
                <span className={`text-[8px] font-mono px-1 ${environment.lighting === 'DARK' ? 'bg-black text-gray-500 border border-gray-800' : 'text-gray-400'}`}>{environment.lighting}</span>
            </div>
            <div className="flex flex-wrap gap-1">
                {environment.terrain_tags.map((tag, i) => (
                    <span key={i} className="px-1.5 py-0.5 text-[8px] bg-gray-900/50 border border-gray-800 text-gray-400">{tag}</span>
                ))}
            </div>
            <div className="text-[8px] italic text-gray-500 leading-tight">{environment.summary}</div>
        </div>
    );
};
