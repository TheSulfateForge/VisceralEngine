import React from 'react';

interface RollResultCardProps {
    text: string;
}

export const RollResultCard: React.FC<RollResultCardProps> = ({ text }) => {
    // Expected format: [SYSTEM: Dice Result 17 (STRONG SUCCESS)]
    // Or with challenge/modifier: [SYSTEM: Dice Result 17 (STRONG SUCCESS) - Challenge: Climb wall, Modifier: +2]
    
    const match = text.match(/\[SYSTEM:\s*Dice Result\s*(\d+)\s*\(([^)]+)\)(?:.*?)\]/i);
    
    if (!match) {
        return <div className="text-gray-400 italic">{text}</div>;
    }

    const [, rollValue, outcome] = match;
    const isCriticalFailure = outcome.includes('CRITICAL FAILURE') || outcome.includes('CRITICAL F');
    const isFailure = outcome.includes('FAILURE') && !isCriticalFailure;
    const isMixed = outcome.includes('MIXED') || outcome.includes('COST');
    const isStrongSuccess = outcome.includes('STRONG');
    const isCriticalSuccess = outcome.includes('CRITICAL SUCCESS') || outcome.includes('CRITICAL S');
    const isSuccess = outcome.includes('SUCCESS') && !isStrongSuccess && !isCriticalSuccess;

    let borderColor = 'border-gray-700';
    let textColor = 'text-gray-300';
    let bgColor = 'bg-gray-900/50';
    let animation = '';

    if (isCriticalFailure) {
        borderColor = 'border-red-600';
        textColor = 'text-red-500';
        bgColor = 'bg-red-950/30';
        animation = 'animate-pulse';
    } else if (isFailure) {
        borderColor = 'border-red-900';
        textColor = 'text-red-400';
        bgColor = 'bg-red-900/20';
    } else if (isMixed) {
        borderColor = 'border-yellow-700';
        textColor = 'text-yellow-500';
        bgColor = 'bg-yellow-900/20';
    } else if (isStrongSuccess) {
        borderColor = 'border-green-500';
        textColor = 'text-green-400';
        bgColor = 'bg-green-900/20';
    } else if (isCriticalSuccess) {
        borderColor = 'border-yellow-400';
        textColor = 'text-yellow-400';
        bgColor = 'bg-yellow-900/30';
        animation = 'shadow-[0_0_15px_rgba(250,204,21,0.3)]';
    } else if (isSuccess) {
        borderColor = 'border-green-700';
        textColor = 'text-green-500';
        bgColor = 'bg-green-900/10';
    }

    // Extract challenge/modifier/skill if present
    const challengeMatch = text.match(/Challenge:\s*([^,\]]+)/i);
    const modifierMatch = text.match(/Modifier:\s*([^,\]]+)/i);
    const skillMatch = text.match(/\[([A-Za-z\s]+):\s*([a-z]+)\]/i); // [Skill Name: level]

    const challenge = challengeMatch ? challengeMatch[1].trim() : null;
    const modifier = modifierMatch ? modifierMatch[1].trim() : null;
    const skillName = skillMatch ? skillMatch[1].trim() : null;
    const skillLevel = skillMatch ? skillMatch[2].trim() : null;

    return (
        <div className={`my-4 border ${borderColor} ${bgColor} ${animation} rounded-sm overflow-hidden`}>
            <div className={`px-3 py-1.5 border-b ${borderColor} bg-black/40 flex items-center gap-2`}>
                <span className="text-[10px] font-bold tracking-widest uppercase text-gray-400">⚀ Dice Result</span>
            </div>
            
            <div className="p-4 flex flex-col items-center justify-center space-y-3">
                {(challenge || modifier || skillName) && (
                    <div className="w-full text-center space-y-1 mb-2">
                        {challenge && <div className="text-xs text-gray-400">{challenge}</div>}
                        {skillName && <div className="text-[10px] text-blue-400 uppercase tracking-widest">Skill: {skillName} ({skillLevel})</div>}
                        {modifier && <div className="text-[10px] text-gray-500 uppercase tracking-widest">Modifier: {modifier}</div>}
                    </div>
                )}

                <div className={`text-4xl font-bold ${textColor} font-mono`}>
                    {rollValue}
                </div>

                <div className={`text-[10px] font-bold tracking-widest uppercase ${textColor} bg-black/40 px-3 py-1 rounded-full border ${borderColor}`}>
                    {outcome}
                </div>
            </div>
        </div>
    );
};
