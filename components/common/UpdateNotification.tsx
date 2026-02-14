
import React, { useEffect, useState } from 'react';
import { useToast } from '../providers/ToastProvider';

export const UpdateNotification: React.FC = () => {
    const [needRefresh, setNeedRefresh] = useState(false);
    const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
    const { showToast } = useToast();

    useEffect(() => {
        // Strict Environment Guard
        if (
            typeof window === 'undefined' || 
            !('serviceWorker' in navigator) ||
            window.location.hostname === 'localhost' || // Optional: skip in dev
            window.self !== window.top // Skip inside iframes (AI Studio Preview)
        ) {
            return;
        }

        const initSW = async () => {
            try {
                // Safe registration check
                const reg = await navigator.serviceWorker.getRegistration();
                if (!reg) return;

                setRegistration(reg);

                if (reg.waiting) setNeedRefresh(true);

                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (newWorker) {
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                setNeedRefresh(true);
                                showToast("System Update Cached. Reboot Ready.", "info");
                            }
                        });
                    }
                });

                let refreshing = false;
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    if (!refreshing) {
                        refreshing = true;
                        window.location.reload();
                    }
                });

            } catch (error) {
                // Silently fail in restricted environments to prevent UI crashes
                console.warn("Service Worker access restricted:", error);
            }
        };

        initSW();
    }, [showToast]);

    const handleUpdate = () => {
        if (registration && registration.waiting) {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        } else {
            window.location.reload();
        }
    };

    if (!needRefresh) return null;

    return (
        <div className="fixed bottom-6 right-6 z-[250] animate-fade-in">
            <div className="bg-[#0a0a0a] border border-red-900 shadow-[0_0_30px_rgba(220,38,38,0.3)] p-6 max-w-sm relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-0.5 bg-red-600 animate-pulse"></div>
                <h3 className="text-sm font-bold uppercase text-red-500 tracking-widest mb-2 flex items-center gap-2">
                    <span className="animate-pulse">⚠</span> Protocol Update
                </h3>
                <p className="text-[10px] text-gray-400 font-mono mb-4 leading-relaxed">
                    The matrix has been patched. Synchronization required.
                </p>
                <div className="flex gap-2">
                    <button 
                        onClick={handleUpdate}
                        className="flex-1 py-2 bg-red-900 hover:bg-red-800 text-white font-bold uppercase tracking-widest text-[9px] transition-colors"
                    >
                        Reboot
                    </button>
                    <button 
                        onClick={() => setNeedRefresh(false)}
                        className="px-3 py-2 border border-gray-800 text-gray-500 hover:text-white uppercase font-bold tracking-widest text-[9px] transition-colors"
                    >
                        Dismiss
                    </button>
                </div>
            </div>
        </div>
    );
};
