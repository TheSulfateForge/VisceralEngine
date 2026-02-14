
import React from 'react';

interface MobileControlsProps {
    isOpen: boolean;
    setIsOpen: (o: boolean) => void;
    isPulsing: boolean;
    pulseSeverity: string;
}

export const MobileControls: React.FC<MobileControlsProps> = ({ isOpen, setIsOpen, isPulsing, pulseSeverity }) => {
    return (
        <>
        <button 
            onClick={() => setIsOpen(!isOpen)}
            className={`fixed top-4 left-4 z-[105] lg:hidden w-12 h-12 flex flex-col items-center justify-center gap-1.5 bg-black/80 border border-gray-900 rounded-sm transition-all duration-300 shadow-xl
            ${isPulsing ? `pulse-${pulseSeverity}` : ''}`}
            aria-label="Toggle Menu"
        >
            <span className={`w-6 h-[2px] bg-white transition-transform ${isOpen ? 'rotate-45 translate-y-2' : ''}`}></span>
            <span className={`w-6 h-[2px] bg-white transition-opacity ${isOpen ? 'opacity-0' : 'opacity-100'}`}></span>
            <span className={`w-6 h-[2px] bg-white transition-transform ${isOpen ? '-rotate-45 -translate-y-2' : ''}`}></span>
        </button>

        <div 
            className={`fixed inset-0 z-[101] bg-black/60 backdrop-blur-sm lg:hidden transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            onClick={() => setIsOpen(false)}
            role="button"
            tabIndex={0}
            aria-label="Close Menu"
            onKeyDown={(e) => e.key === 'Escape' && setIsOpen(false)}
        ></div>
        </>
    );
};
