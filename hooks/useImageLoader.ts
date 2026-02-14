
import { useState, useEffect } from 'react';
import { db } from '../db';

export const useImageLoader = (imageId: string | null | undefined) => {
    const [src, setSrc] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        let objectUrl: string | null = null;

        if (!imageId) {
            setSrc(null);
            return;
        }

        // Check if it's already a Data URI (legacy compatibility)
        if (imageId.startsWith('data:')) {
            setSrc(imageId);
            return;
        }

        const load = async () => {
            try {
                const blob = await db.getImage(imageId);
                
                if (active && blob) {
                    objectUrl = URL.createObjectURL(blob);
                    setSrc(objectUrl);
                } else if (!active && blob) {
                    // If we finished loading after unmount, do nothing (blob is garbage collected)
                }
            } catch (e) {
                console.error("Failed to load image", imageId, e);
                if (active) setSrc(null);
            }
        };

        load();

        return () => {
            active = false;
            // Revoke the URL if we created one to prevent memory leaks
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        };
    }, [imageId]);

    return src;
};
