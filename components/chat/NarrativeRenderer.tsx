import React from 'react';
import { ChatMessage } from '../../types';
import { RollResultCard } from './RollResultCard';
import { SceneModeDivider } from './SceneModeDivider';
import { BargainCard } from './BargainCard';
import { WorldTickAnnotations } from './WorldTickAnnotations';

interface NarrativeRendererProps {
    message: ChatMessage;
    onResolveBargain?: (id: string, accepted: boolean, desc: string) => void;
}

export const NarrativeRenderer: React.FC<NarrativeRendererProps> = ({ message, onResolveBargain }) => {
    // If it's a user message, just render normally
    if (message.role === 'user') {
        return <div className="text-gray-200 whitespace-pre-wrap">{message.text}</div>;
    }

    // Process system/assistant messages
    const content = message.text;
    const blocks: React.ReactNode[] = [];
    
    // Split by newlines to process line by line
    const lines = content.split('\n');
    let currentParagraph: string[] = [];
    
    const flushParagraph = () => {
        if (currentParagraph.length > 0) {
            blocks.push(
                <p key={`p-${blocks.length}`} className="text-gray-300 leading-relaxed mb-4 whitespace-pre-wrap">
                    {currentParagraph.join('\n')}
                </p>
            );
            currentParagraph = [];
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Detect Roll Results
        if (line.match(/\[SYSTEM:\s*Dice Result/i)) {
            flushParagraph();
            blocks.push(<RollResultCard key={`roll-${i}`} text={line} />);
            continue;
        }
        
        // Detect Scene Mode changes
        const sceneMatch = line.match(/\[SYSTEM:\s*Scene Mode changed to\s*([A-Z]+)\]/i);
        if (sceneMatch) {
            flushParagraph();
            blocks.push(<SceneModeDivider key={`scene-${i}`} mode={sceneMatch[1] as any} />);
            continue;
        }

        // Detect Dialogue (quotes)
        if (line.trim().startsWith('"') && line.trim().endsWith('"') && line.trim().length > 2) {
            flushParagraph();
            blocks.push(
                <div key={`dialogue-${i}`} className="my-3 pl-4 border-l-2 border-gray-600 italic text-gray-200">
                    {line}
                </div>
            );
            continue;
        }

        // Detect System Messages (other than rolls/scene)
        if (line.match(/\[SYSTEM:/i)) {
            flushParagraph();
            blocks.push(
                <div key={`sys-${i}`} className="my-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                    {line}
                </div>
            );
            continue;
        }

        currentParagraph.push(line);
    }
    
    flushParagraph();

    return (
        <div className="space-y-2">
            {blocks}
            
            {/* Render Bargain if present */}
            {message.bargainRequest && !message.isResolved && onResolveBargain && (
                <BargainCard 
                    msgId={message.id}
                    request={message.bargainRequest}
                    onResolve={onResolveBargain}
                />
            )}
            
            {/* Render World Tick Annotations if present */}
            {message.worldTick && message.worldTick.emerging_threats && message.worldTick.emerging_threats.length > 0 && (
                <WorldTickAnnotations events={message.worldTick.emerging_threats} />
            )}
        </div>
    );
};
