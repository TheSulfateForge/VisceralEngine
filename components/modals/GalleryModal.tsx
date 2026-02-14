
import React, { useState } from 'react';
import { useImageLoader } from '../../hooks/useImageLoader';

interface GalleryModalProps {
    images: string[];
    onClose: () => void;
}

// Wrapper for individual grid items to handle lazy loading cleanly
const GalleryGridItem: React.FC<{ 
    id: string; 
    index: number; 
    total: number; 
    onClick: () => void 
}> = ({ id, index, total, onClick }) => {
    const src = useImageLoader(id);
    return (
        <div 
            onClick={onClick}
            className="group relative aspect-video bg-gray-900 cursor-pointer border border-transparent hover:border-red-900 transition-all overflow-hidden"
        >
            {src && (
                <img 
                    src={src} 
                    alt={`Archive ${index}`} 
                    className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity duration-500 grayscale group-hover:grayscale-0" 
                />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                <span className="text-[9px] text-gray-300 font-mono tracking-widest">
                    {total - index} // RENDER
                </span>
            </div>
        </div>
    );
};

// Wrapper for the full screen view
const GalleryFullScreen: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
    const src = useImageLoader(id);
    return (
        <div className="flex-1 flex flex-col items-center justify-center relative p-4 bg-black">
            {src ? (
                <>
                    <img 
                        src={src} 
                        alt="Full Res" 
                        className="max-h-[85vh] max-w-full object-contain border border-gray-800 shadow-[0_0_50px_rgba(0,0,0,0.8)]" 
                    />
                    <a 
                        href={src} 
                        download={`visceral_render_${Date.now()}.png`}
                        className="absolute bottom-8 px-8 py-3 bg-red-900/20 border border-red-900/50 text-red-500 hover:bg-red-900 hover:text-white uppercase text-xs font-bold tracking-widest transition-all backdrop-blur-sm"
                    >
                        Download Artifact
                    </a>
                </>
            ) : (
                <div className="text-white text-xs uppercase tracking-widest animate-pulse">Decrypting Artifact...</div>
            )}
            <button 
                onClick={onClose}
                className="absolute top-4 left-4 px-6 py-2 bg-black/50 border border-gray-700 text-gray-300 hover:text-white hover:border-red-900 uppercase text-xs font-bold tracking-widest transition-all"
            >
                ← Return to Grid
            </button>
        </div>
    );
};

export const GalleryModal: React.FC<GalleryModalProps> = ({ images, onClose }) => {
    const [selectedImageId, setSelectedImageId] = useState<string | null>(null);

    return (
        <div className="fixed inset-0 z-[150] bg-black/98 flex flex-col animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-red-900/20 bg-[#050505]">
                <h3 className="text-xl font-bold uppercase italic text-white tracking-tighter">Visual Archives</h3>
                <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl font-light px-4">×</button>
            </div>

            {selectedImageId ? (
                <GalleryFullScreen id={selectedImageId} onClose={() => setSelectedImageId(null)} />
            ) : (
                <div className="flex-1 overflow-y-auto p-6 md:p-12">
                     {images.length === 0 ? (
                         <div className="flex flex-col items-center justify-center h-64 text-gray-600">
                             <p className="uppercase tracking-[0.2em] text-xs">No visual data recorded.</p>
                         </div>
                     ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {images.map((imgId, idx) => (
                                <GalleryGridItem 
                                    key={idx} 
                                    id={imgId} 
                                    index={idx} 
                                    total={images.length} 
                                    onClick={() => setSelectedImageId(imgId)} 
                                />
                            ))}
                        </div>
                     )}
                </div>
            )}
        </div>
    );
};
