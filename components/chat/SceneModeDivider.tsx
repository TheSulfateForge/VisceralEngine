import React from 'react';
import { SceneMode } from '../../types';

interface SceneModeDividerProps {
    mode: SceneMode;
}

export const SceneModeDivider: React.FC<SceneModeDividerProps> = ({ mode }) => {
    let colorClass = 'text-gray-500 border-gray-800';
    let pulseClass = '';

    switch (mode) {
        case 'SOCIAL':
            colorClass = 'text-blue-400 border-blue-900/50';
            break;
        case 'TENSION':
            colorClass = 'text-amber-500 border-amber-900/50';
            pulseClass = 'animate-pulse';
            break;
        case 'COMBAT':
            colorClass = 'text-red-500 border-red-900/50';
            pulseClass = 'animate-[pulse_1.5s_ease-in-out_infinite]';
            break;
        case 'NARRATIVE':
        default:
            colorClass = 'text-gray-500 border-gray-800';
            break;
    }

    return (
        <div className={`flex items-center justify-center my-8 ${pulseClass}`}>
            <div className={`flex-grow border-t ${colorClass}`}></div>
            <span className={`px-4 text-[10px] font-bold uppercase tracking-[0.3em] ${colorClass}`}>
                ◆ {mode} ◆
            </span>
            <div className={`flex-grow border-t ${colorClass}`}></div>
        </div>
    );
};
