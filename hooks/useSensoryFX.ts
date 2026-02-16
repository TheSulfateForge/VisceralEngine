
import { useCallback, useEffect } from 'react';

interface SoundPreset {
  freq: number;
  type: OscillatorType;
  duration: number;
  vol: number;
  slide?: number;
}

const FX_PRESETS: Record<string, SoundPreset> = {
  click: { freq: 800, type: 'sine', duration: 0.05, vol: 0.05 },
  hover: { freq: 200, type: 'triangle', duration: 0.03, vol: 0.02 },
  error: { freq: 150, type: 'sawtooth', duration: 0.3, vol: 0.1, slide: -100 },
  success: { freq: 600, type: 'sine', duration: 0.2, vol: 0.05, slide: 400 },
  boot: { freq: 100, type: 'square', duration: 0.8, vol: 0.05, slide: 800 }
};

// Singleton AudioContext to prevent resource leaks and browser limits
let globalAudioContext: AudioContext | null = null;

export const useSensoryFX = () => {
  
  const initAudio = useCallback(() => {
    if (typeof window === 'undefined') return;

    if (!globalAudioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        globalAudioContext = new AudioCtx();
      }
    }
    
    if (globalAudioContext?.state === 'suspended') {
      globalAudioContext.resume().catch(() => {});
    }
  }, []);

  // --- ONE-SHOT SFX ---
  const playSound = useCallback((presetName: keyof typeof FX_PRESETS) => {
    // Ensure initialized before playing
    if (!globalAudioContext) initAudio();
    if (!globalAudioContext) return;

    const ctx = globalAudioContext;
    const preset = FX_PRESETS[presetName];
    
    try {
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        
        let source: AudioScheduledSourceNode;

        // Oscillator for tones
        const osc = ctx.createOscillator();
        osc.type = preset.type;
        osc.frequency.setValueAtTime(preset.freq, ctx.currentTime);
        if (preset.slide) {
            osc.frequency.linearRampToValueAtTime(preset.freq + preset.slide, ctx.currentTime + preset.duration);
        }
        source = osc;

        source.connect(gain);
        
        // Envelope
        const now = ctx.currentTime;
        gain.gain.setValueAtTime(preset.vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + preset.duration);

        source.start(now);
        source.stop(now + preset.duration);
        
        // Proper node cleanup via event listener instead of timeout
        source.onended = () => {
            source.disconnect();
            gain.disconnect();
        };

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
    
    // Only attach listeners if context needs initialization or resuming
    if (!globalAudioContext || globalAudioContext.state === 'suspended') {
        window.addEventListener('click', handleInteraction, { once: true });
        window.addEventListener('keydown', handleInteraction, { once: true });
    }
    
    return () => {
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };
  }, [initAudio]);

  return { playSound, triggerHaptic };
};
