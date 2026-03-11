import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Headphones, 
  RefreshCw, 
  Volume2, 
  Mic, 
  MicOff, 
  Settings, 
  Play, 
  Pause, 
  CheckCircle2, 
  AlertCircle,
  ChevronRight,
  Monitor
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

interface AudioDevice {
  deviceId: string;
  label: string;
}

// --- Constants ---

const THEME = {
  bg: 'bg-[#151619]',
  card: 'bg-[#1C1D21]',
  accent: 'text-[#00FF00]',
  accentBg: 'bg-[#00FF00]',
  border: 'border-[#2A2B2F]',
  textPrimary: 'text-white',
  textSecondary: 'text-[#8E9299]',
  mono: 'font-mono',
};

export default function App() {
  // --- State ---
  const [isSwapped, setIsSwapped] = useState(() => {
    const saved = localStorage.getItem('audio-swap-enabled');
    return saved === 'true';
  });
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('default');
  const [status, setStatus] = useState<'idle' | 'active' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [volume, setVolume] = useState(80);
  
  // --- Refs ---
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const splitterNodeRef = useRef<ChannelSplitterNode | null>(null);
  const mergerNodeRef = useRef<ChannelMergerNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  // --- Audio Logic ---

  const initAudio = useCallback(async () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }
    
    return audioCtxRef.current;
  }, []);

  const setupRouting = useCallback((ctx: AudioContext, source: AudioNode) => {
    // Cleanup old nodes if they exist
    if (splitterNodeRef.current) splitterNodeRef.current.disconnect();
    if (mergerNodeRef.current) mergerNodeRef.current.disconnect();
    if (gainNodeRef.current) gainNodeRef.current.disconnect();

    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    const gain = ctx.createGain();
    
    gain.gain.value = volume / 100;

    source.connect(splitter);

    if (isSwapped) {
      // Swapped: L -> R, R -> L
      splitter.connect(merger, 0, 1);
      splitter.connect(merger, 1, 0);
    } else {
      // Normal: L -> L, R -> R
      splitter.connect(merger, 0, 0);
      splitter.connect(merger, 1, 1);
    }

    merger.connect(gain);
    gain.connect(ctx.destination);

    splitterNodeRef.current = splitter;
    mergerNodeRef.current = merger;
    gainNodeRef.current = gain;
  }, [isSwapped, volume]);

  const cleanupSource = useCallback(() => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsMonitoring(false);
  }, []);

  const startMonitoring = async () => {
    try {
      cleanupSource();
      const ctx = await initAudio();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      streamRef.current = stream;
      const source = ctx.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
      
      setupRouting(ctx, source);
      
      setIsMonitoring(true);
      setStatus('active');
    } catch (err) {
      console.error('Failed to start monitoring:', err);
      setStatus('error');
      setErrorMessage('Microphone access denied or not available.');
    }
  };

  const stopMonitoring = () => {
    cleanupSource();
    setStatus('idle');
  };

  const toggleSwap = () => {
    const nextState = !isSwapped;
    setIsSwapped(nextState);
    localStorage.setItem('audio-swap-enabled', String(nextState));
    
    // If active, re-route immediately
    if (audioCtxRef.current && sourceNodeRef.current) {
      setupRouting(audioCtxRef.current, sourceNodeRef.current);
    }
  };

  const playTestSound = async (channel: 'left' | 'right') => {
    try {
      const ctx = await initAudio();
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const panner = ctx.createStereoPanner();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(channel === 'left' ? 440 : 880, ctx.currentTime);
      
      panner.pan.setValueAtTime(channel === 'left' ? -1 : 1, ctx.currentTime);
      
      // We route the test sound through the swap logic if it's active
      // But for a simple test, we can just use a temporary routing
      const splitter = ctx.createChannelSplitter(2);
      const merger = ctx.createChannelMerger(2);

      osc.connect(g);
      g.connect(panner);
      panner.connect(splitter);

      if (isSwapped) {
        splitter.connect(merger, 0, 1);
        splitter.connect(merger, 1, 0);
      } else {
        splitter.connect(merger, 0, 0);
        splitter.connect(merger, 1, 1);
      }

      merger.connect(ctx.destination);

      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.1);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1);

      osc.start();
      osc.stop(ctx.currentTime + 1);
    } catch (err) {
      console.error('Test sound failed:', err);
    }
  };

  // --- Device Detection ---

  const refreshDevices = useCallback(async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = allDevices
        .filter(device => device.kind === 'audiooutput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Output ${device.deviceId.slice(0, 5)}...`,
        }));
      setDevices(audioOutputs);
    } catch (err) {
      console.error('Error enumerating devices:', err);
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
    };
  }, [refreshDevices]);

  // Update gain when volume changes
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.setTargetAtTime(volume / 100, audioCtxRef.current?.currentTime || 0, 0.1);
    }
  }, [volume]);

  const [isCompact, setIsCompact] = useState(false);
  const [activeTab, setActiveTab] = useState<'tool' | 'guide'>('tool');

  const [mediaUrl, setMediaUrl] = useState('');

  const handleUrlPlay = async () => {
    if (!mediaUrl) return;
    try {
      cleanupSource();
      const ctx = await initAudio();
      const audio = new Audio(mediaUrl);
      audio.crossOrigin = "anonymous";
      const source = ctx.createMediaElementSource(audio);
      sourceNodeRef.current = source;
      setupRouting(ctx, source);
      audio.play();
      setStatus('active');
    } catch (err) {
      console.error('URL Play failed:', err);
      setStatus('error');
      setErrorMessage('Could not load media. Ensure the URL is a direct link to an audio/video file.');
    }
  };

  return (
    <div className={`min-h-screen ${THEME.bg} ${THEME.textPrimary} flex flex-col items-center justify-center p-4 selection:bg-[#00FF00] selection:text-black transition-all duration-500`}>
      
      {/* Header - Hide in compact mode */}
      {!isCompact && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 text-center"
        >
          <div className="flex items-center justify-center gap-3 mb-2">
            <div className={`p-2 rounded-lg ${THEME.accentBg} bg-opacity-10`}>
              <Headphones className={`w-8 h-8 ${THEME.accent}`} />
            </div>
            <h1 className="text-3xl font-bold tracking-tighter uppercase italic">AudioSwap Fixer</h1>
          </div>
          <p className={`${THEME.textSecondary} text-sm max-w-xs mx-auto`}>
            Professional utility for correcting reversed stereo channels.
          </p>
        </motion.div>
      )}

      {/* Tab Switcher - Hide in compact mode */}
      {!isCompact && (
        <div className="flex bg-[#1C1D21] p-1 rounded-xl border border-[#2A2B2F] mb-6">
          <button 
            onClick={() => setActiveTab('tool')}
            className={`px-6 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${activeTab === 'tool' ? 'bg-[#00FF00] text-black' : 'text-[#8E9299] hover:text-white'}`}
          >
            Web Tester
          </button>
          <button 
            onClick={() => setActiveTab('guide')}
            className={`px-6 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${activeTab === 'guide' ? 'bg-[#00FF00] text-black' : 'text-[#8E9299] hover:text-white'}`}
          >
            System Fix Guide
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <AnimatePresence mode="wait">
        {activeTab === 'tool' ? (
          <motion.div 
            key="tool"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={`w-full ${isCompact ? 'max-w-[240px]' : 'max-w-md'} ${THEME.card} rounded-2xl border ${THEME.border} shadow-2xl overflow-hidden transition-all duration-500`}
          >
            {/* Status Bar */}
            <div className={`px-4 py-2 border-b ${THEME.border} flex items-center justify-between bg-black/20`}>
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${status === 'active' ? 'bg-[#00FF00] animate-pulse' : 'bg-[#8E9299]'}`} />
                <span className={`${THEME.mono} text-[8px] uppercase tracking-widest ${THEME.textSecondary}`}>
                  {isCompact ? 'COMPACT' : 'WEB SANDBOX MODE'}
                </span>
              </div>
              <button 
                onClick={() => setIsCompact(!isCompact)}
                className={`p-1 rounded hover:bg-white/10 transition-colors ${THEME.textSecondary}`}
                title={isCompact ? "Expand" : "Compact Mode"}
              >
                <Settings className="w-3 h-3" />
              </button>
            </div>

            <div className={`${isCompact ? 'p-4' : 'p-8'} space-y-6`}>
              {/* Swap Toggle Section */}
              <div className="flex flex-col items-center justify-center space-y-4">
                <div className="relative">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={toggleSwap}
                    className={`${isCompact ? 'w-20 h-20' : 'w-32 h-32'} rounded-full border-4 flex flex-col items-center justify-center transition-all duration-500 ${
                      isSwapped 
                        ? `${THEME.accentBg} border-[#00FF00] shadow-[0_0_30px_rgba(0,255,0,0.2)]` 
                        : `bg-transparent ${THEME.border} border-dashed`
                    }`}
                  >
                    <RefreshCw className={`${isCompact ? 'w-6 h-6' : 'w-10 h-10'} mb-1 transition-transform duration-700 ${isSwapped ? 'rotate-180 text-black' : THEME.textSecondary}`} />
                    <span className={`${isCompact ? 'text-[8px]' : 'text-[10px]'} font-bold uppercase tracking-tighter ${isSwapped ? 'text-black' : THEME.textSecondary}`}>
                      {isSwapped ? 'Swapped' : 'Normal'}
                    </span>
                  </motion.button>
                  
                  {!isCompact && (
                    <>
                      <div className="absolute -left-12 top-1/2 -translate-y-1/2 flex flex-col items-center">
                        <span className={`${THEME.mono} text-xs font-bold ${isSwapped ? 'text-[#00FF00]' : THEME.textSecondary}`}>L</span>
                        <ChevronRight className={`w-4 h-4 ${isSwapped ? 'text-[#00FF00] rotate-180' : THEME.textSecondary}`} />
                      </div>
                      <div className="absolute -right-12 top-1/2 -translate-y-1/2 flex flex-col items-center">
                        <span className={`${THEME.mono} text-xs font-bold ${isSwapped ? 'text-[#00FF00]' : THEME.textSecondary}`}>R</span>
                        <ChevronRight className={`w-4 h-4 ${isSwapped ? 'text-[#00FF00] rotate-180' : 'text-[#8E9299] rotate-180'}`} />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {!isCompact && <div className={`h-px ${THEME.border} w-full`} />}

              {/* Monitoring Controls */}
              <div className="space-y-2">
                <button
                  onClick={isMonitoring ? stopMonitoring : startMonitoring}
                  className={`w-full ${isCompact ? 'py-2' : 'py-4'} rounded-xl flex items-center justify-center gap-2 font-bold uppercase tracking-widest text-[10px] transition-all ${
                    isMonitoring 
                      ? 'bg-red-500/10 border border-red-500/50 text-red-500 hover:bg-red-500/20' 
                      : `${THEME.accentBg} text-black hover:opacity-90`
                  }`}
                >
                  {isMonitoring ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                  {isMonitoring ? 'Stop' : 'Start Mic'}
                </button>
              </div>

              {/* URL Player */}
              {!isCompact && (
                <div className="space-y-3">
                  <label className={`${THEME.mono} text-[10px] uppercase tracking-widest ${THEME.textSecondary}`}>
                    Stream from URL
                  </label>
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      value={mediaUrl}
                      onChange={(e) => setMediaUrl(e.target.value)}
                      placeholder="https://example.com/music.mp3"
                      className={`flex-1 bg-black/40 border ${THEME.border} rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#00FF00] transition-colors`}
                    />
                    <button 
                      onClick={handleUrlPlay}
                      className={`p-2 rounded-lg ${THEME.accentBg} text-black hover:opacity-90 transition-opacity`}
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Test Sounds */}
              {!isCompact && (
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => playTestSound('left')}
                    className={`py-3 rounded-lg border ${THEME.border} hover:bg-white/5 flex items-center justify-center gap-2 transition-colors`}
                  >
                    <Volume2 className="w-4 h-4 text-[#00FF00]" />
                    <span className="text-xs font-bold uppercase tracking-widest">Test L</span>
                  </button>
                  <button
                    onClick={() => playTestSound('right')}
                    className={`py-3 rounded-lg border ${THEME.border} hover:bg-white/5 flex items-center justify-center gap-2 transition-colors`}
                  >
                    <Volume2 className="w-4 h-4 text-[#00FF00]" />
                    <span className="text-xs font-bold uppercase tracking-widest">Test R</span>
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="guide"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className={`w-full max-w-md ${THEME.card} rounded-2xl border ${THEME.border} shadow-2xl p-8 space-y-6`}
          >
            <div className="space-y-2">
              <h2 className="text-xl font-bold italic uppercase tracking-tight">System-Wide Fix</h2>
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <p className="text-amber-500 text-[10px] font-bold uppercase leading-tight">
                  Note: Web Apps cannot float on top of other apps or change system audio. You must use a native tool below for a permanent fix.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Windows */}
              <div className={`p-4 rounded-xl border ${THEME.border} bg-black/20`}>
                <h3 className="text-sm font-bold text-[#00FF00] mb-2 flex items-center gap-2">
                  <Monitor className="w-4 h-4" /> Windows (Permanent Fix)
                </h3>
                <p className="text-[11px] text-[#8E9299] mb-3">
                  Use <strong>Equalizer APO</strong> with the <strong>Peace GUI</strong>. This runs in the background and swaps audio for every app (Games, Spotify, etc).
                </p>
                <div className="bg-black/40 p-2 rounded font-mono text-[9px] text-white/70">
                  Command: Copy L=R R=L
                </div>
              </div>

              {/* Android */}
              <div className={`p-4 rounded-xl border ${THEME.border} bg-black/20`}>
                <h3 className="text-sm font-bold text-[#00FF00] mb-2 flex items-center gap-2">
                  <Monitor className="w-4 h-4" /> Android (System Settings)
                </h3>
                <p className="text-[11px] text-[#8E9299] mb-3">
                  Android doesn't have a native "Swap" toggle, but you can adjust balance:
                </p>
                <ol className="text-[11px] space-y-2 text-[#8E9299] list-decimal list-inside">
                  <li>Go to <strong>Settings &rarr; Accessibility</strong>.</li>
                  <li>Tap <strong>Hearing enhancements</strong> (or Audio).</li>
                  <li>Adjust <strong>Left/right sound balance</strong>.</li>
                  <li>Search Play Store for <strong>"Lesser AudioSwitch"</strong> for advanced routing.</li>
                </ol>
              </div>

              {/* macOS */}
              <div className={`p-4 rounded-xl border ${THEME.border} bg-black/20`}>
                <h3 className="text-sm font-bold text-[#00FF00] mb-2 flex items-center gap-2">
                  <Headphones className="w-4 h-4" /> macOS (Menu Bar Toggle)
                </h3>
                <p className="text-[11px] text-[#8E9299]">
                  Install <strong>SoundSource</strong>. It adds a floating toggle to your menu bar that works system-wide.
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-[#2A2B2F]">
              <p className="text-[10px] text-center text-[#8E9299] italic">
                Use the <strong>Web Tester</strong> to verify your system settings after installing these tools.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!isCompact && (
        <footer className="mt-12 text-[10px] uppercase tracking-[0.2em] text-[#8E9299] opacity-50">
          Professional Audio Utility &bull; v1.0.0
        </footer>
      )}
    </div>
  );
}
