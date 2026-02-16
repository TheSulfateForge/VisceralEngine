
import React from 'react';
import { Sidebar } from './Sidebar';
import { MobileControls } from '../ui/MobileControls';
import { useGameStore } from '../../store';

interface MainLayoutProps {
    children: React.ReactNode;
}

const CRTOverlay: React.FC<{ trauma: number }> = ({ trauma }) => {
    // Opacity scales from 0 (0 trauma) to 0.4 (100 trauma)
    const scanlineOpacity = Math.min(0.4, (trauma / 100) * 0.4);
    
    // Only show aberration if trauma is significant (>30)
    const aberration = trauma > 30 ? 'animate-chromatic' : '';

    return (
        <div className="pointer-events-none fixed inset-0 z-[900] overflow-hidden">
            {/* Scanlines */}
            <div 
                className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))]"
                style={{ backgroundSize: '100% 2px, 3px 100%', opacity: scanlineOpacity }}
            ></div>
            
            {/* Vignette - Gets darker with trauma */}
            <div 
                className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_50%,rgba(0,0,0,0.4)_100%)]"
                style={{ opacity: 0.5 + (trauma / 200) }}
            ></div>

            {/* Critical Condition Pulse */}
            {trauma > 80 && (
                <div className="absolute inset-0 bg-red-900/10 animate-pulse"></div>
            )}
        </div>
    );
};

export const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
    const { 
        ui,
        setUI,
        character
    } = useGameStore();

    return (
        <div className={`flex h-screen w-full bg-[#050505] text-gray-300 transition-all duration-700 relative ${ui.screenEffect === 'fail' ? 'animate-shake bg-red-950/25' : ui.screenEffect === 'crit' ? 'shadow-[inset_0_0_200px_rgba(234,179,8,0.2)]' : ''}`}>
             <CRTOverlay trauma={character.trauma || 0} />
             
             <MobileControls 
                isOpen={ui.isMobileMenuOpen}
                setIsOpen={(o) => setUI({ isMobileMenuOpen: o })}
                isPulsing={ui.isPulsing}
                pulseSeverity={ui.pulseSeverity}
             />
             <Sidebar />
             <main className="flex-1 flex flex-col relative bg-[#050505] min-w-0 z-10">
                {children}
             </main>
        </div>
    );
};
