
import React, { useState, useEffect } from 'react';
import { useImageLoader } from '../../hooks/useImageLoader';

interface ImageCarouselProps {
    images: string[];
    onOpenGallery: () => void;
    className?: string;
    heightClass?: string;
}

export const ImageCarousel: React.FC<ImageCarouselProps> = ({ 
    images, 
    onOpenGallery, 
    className = "",
    heightClass = "h-32"
}) => {
    const [currentIndex, setCurrentIndex] = useState(0);

    useEffect(() => {
        if (images.length > 0) {
            setCurrentIndex(0);
        }
    }, [images.length]);

    const currentImageId = images && images.length > 0 ? images[currentIndex] : null;
    const currentImageSrc = useImageLoader(currentImageId);

    if (!images || images.length === 0) {
        return null;
    }

    const handlePrev = (e: React.MouseEvent) => {
        e.stopPropagation();
        setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
    };

    const handleNext = (e: React.MouseEvent) => {
        e.stopPropagation();
        setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
    };

    return (
        <div className={`relative group overflow-hidden rounded-sm border border-red-900/20 shadow-lg ${className}`}>
            {currentImageSrc ? (
                <img 
                    src={currentImageSrc} 
                    alt="Neural Manifest" 
                    className={`w-full ${heightClass} object-cover grayscale opacity-60 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-700`} 
                />
            ) : (
                <div className={`w-full ${heightClass} flex items-center justify-center bg-gray-900 text-gray-700 text-xs`}>
                    Loading Fragment...
                </div>
            )}
            
            <button 
                onClick={onOpenGallery}
                className="absolute top-2 right-2 p-1.5 bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-900/80 rounded-sm z-20"
                title="Open Gallery"
            >
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>
            </button>

            {images.length > 1 && (
                <>
                    <button 
                        onClick={handlePrev}
                        className="absolute left-0 top-0 bottom-0 w-8 flex items-center justify-center bg-gradient-to-r from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity hover:from-black z-10 text-white"
                    >
                        ‹
                    </button>
                    <button 
                        onClick={handleNext}
                        className="absolute right-0 top-0 bottom-0 w-8 flex items-center justify-center bg-gradient-to-l from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity hover:from-black z-10 text-white"
                    >
                        ›
                    </button>
                    
                    <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        <span className="text-[9px] bg-black/70 px-2 py-0.5 rounded text-gray-300 font-mono tracking-widest">
                            {images.length - currentIndex} / {images.length}
                        </span>
                    </div>
                </>
            )}
        </div>
    );
};
