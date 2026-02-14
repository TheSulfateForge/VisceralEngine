
import { useCallback, useEffect, useRef } from 'react';

interface SoundPreset {
  freq: number;
  type: OscillatorType;
  duration: number;
  vol: number;
  slide?: number;
  noise?: boolean;
}

const FX_PRESETS: Record<string, SoundPreset> = {
  click: { freq: 800, type: 'sine', duration: 0.05, vol: 0.05 },
  hover: { freq: 200, type: 'triangle', duration: 0.03, vol: 0.02 },
  error: { freq: 150, type: 'sawtooth', duration: 0.3, vol: 0.1, slide: -100 },
  success: { freq: 600, type: 'sine', duration: 0.2, vol: 0.05, slide: 400 },
  boot: { freq: 100, type: 'square', duration: 0.8, vol: 0.05, slide: 800 },
  typewriter: { freq: 0, type: 'square', duration: 0.03, vol: 0.02, noise: true }
};

export const useSensoryFX = () => {
  const audioContext = useRef<AudioContext | null>(null);
  
  const initAudio = useCallback(() => {
    if (!audioContext.current && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        audioContext.current = new AudioCtx();
      }
    }
    if (audioContext.current?.state === 'suspended') {
      audioContext.current.resume().catch(() => {});
    }
  }, []);

  // --- ONE-SHOT SFX ---
  const playSound = useCallback((presetName: keyof typeof FX_PRESETS) => {
    initAudio();
    if (!audioContext.current) return;

    const ctx = audioContext.current;
    const preset = FX_PRESETS[presetName];
    
    try {
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        
        let source: AudioScheduledSourceNode;

        if (preset.noise) {
            // White noise buffer for typewriter
            const bufferSize = ctx.sampleRate * preset.duration;
            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            const noise = ctx.createBufferSource();
            noise.buffer = buffer;
            source = noise;
        } else {
            // Oscillator for tones
            const osc = ctx.createOscillator();
            osc.type = preset.type;
            osc.frequency.setValueAtTime(preset.freq, ctx.currentTime);
            if (preset.slide) {
                osc.frequency.linearRampToValueAtTime(preset.freq + preset.slide, ctx.currentTime + preset.duration);
            }
            source = osc;
        }

        source.connect(gain);
        
        // Envelope
        gain.gain.setValueAtTime(preset.vol, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + preset.duration);

        source.start();
        source.stop(ctx.currentTime + preset.duration);
        
        // Garbage collection
        setTimeout(() => {
            try {
                source.disconnect();
                gain.disconnect();
            } catch(e) {
                // Ignore disconnect errors if already disconnected
            }
        }, preset.duration * 1000 + 100);

    } catch (e) {
        console.warn("Audio playback failed", e);
    }
  }, [initAudio]);

  const triggerHaptic = useCallback((pattern: 'light' | 'medium' | 'heavy' | 'failure') => {
    if (typeof navigator === 'undefined' || !navigator.vibrate) return;
    try {
        switch (pattern) {
        case 'light': navigator.vibrate(5); break;
        case 'medium': navigator.vibrate(15); break;
        case 'heavy': navigator.vibrate([30, 50, 30]); break;
        case 'failure': navigator.vibrate([50, 100, 50, 100, 50]); break;
        }
    } catch (e) {
        // Haptics not supported
    }
  }, []);

  // Global Interaction Listener to unlock AudioContext
  useEffect(() => {
    const handleInteraction = () => {
        initAudio();
    };
    
    window.addEventListener('click', handleInteraction, { once: true });
    window.addEventListener('keydown', handleInteraction, { once: true });
    
    return () => {
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };
  }, [initAudio]);

  return { playSound, triggerHaptic };
};
