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

  return (
    <div className={`min-h-screen ${THEME.bg} ${THEME.textPrimary} flex flex-col items-center justify-center p-4 selection:bg-[#00FF00] selection:text-black`}>
      
      {/* Header */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-12 text-center"
      >
        <div className="flex items-center justify-center gap-3 mb-2">
          <div className={`p-2 rounded-lg ${THEME.accentBg} bg-opacity-10`}>
            <Headphones className={`w-8 h-8 ${THEME.accent}`} />
          </div>
          <h1 className="text-3xl font-bold tracking-tighter uppercase italic">AudioSwap Fixer</h1>
        </div>
        <p className={`${THEME.textSecondary} text-sm max-w-xs mx-auto`}>
          Real-time stereo channel correction for reversed headsets.
        </p>
      </motion.div>

      {/* Main Control Panel */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`w-full max-w-md ${THEME.card} rounded-2xl border ${THEME.border} shadow-2xl overflow-hidden`}
      >
        {/* Status Bar */}
        <div className={`px-6 py-3 border-b ${THEME.border} flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${status === 'active' ? 'bg-[#00FF00] animate-pulse' : 'bg-[#8E9299]'}`} />
            <span className={`${THEME.mono} text-[10px] uppercase tracking-widest ${THEME.textSecondary}`}>
              System Status: {status.toUpperCase()}
            </span>
          </div>
          {status === 'error' && (
            <div className="flex items-center gap-1 text-red-500 text-[10px] uppercase font-bold">
              <AlertCircle className="w-3 h-3" />
              Error Detected
            </div>
          )}
        </div>

        <div className="p-8 space-y-8">
          
          {/* Swap Toggle Section */}
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="relative">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={toggleSwap}
                className={`w-32 h-32 rounded-full border-4 flex flex-col items-center justify-center transition-all duration-500 ${
                  isSwapped 
                    ? `${THEME.accentBg} border-[#00FF00] shadow-[0_0_30px_rgba(0,255,0,0.2)]` 
                    : `bg-transparent ${THEME.border} border-dashed`
                }`}
              >
                <RefreshCw className={`w-10 h-10 mb-2 transition-transform duration-700 ${isSwapped ? 'rotate-180 text-black' : THEME.textSecondary}`} />
                <span className={`text-[10px] font-bold uppercase tracking-tighter ${isSwapped ? 'text-black' : THEME.textSecondary}`}>
                  {isSwapped ? 'Swapped' : 'Normal'}
                </span>
              </motion.button>
              
              {/* Visual indicators for L/R */}
              <div className="absolute -left-12 top-1/2 -translate-y-1/2 flex flex-col items-center">
                <span className={`${THEME.mono} text-xs font-bold ${isSwapped ? 'text-[#00FF00]' : THEME.textSecondary}`}>L</span>
                <ChevronRight className={`w-4 h-4 ${isSwapped ? 'text-[#00FF00] rotate-180' : THEME.textSecondary}`} />
              </div>
              <div className="absolute -right-12 top-1/2 -translate-y-1/2 flex flex-col items-center">
                <span className={`${THEME.mono} text-xs font-bold ${isSwapped ? 'text-[#00FF00]' : THEME.textSecondary}`}>R</span>
                <ChevronRight className={`w-4 h-4 ${isSwapped ? 'text-[#00FF00] rotate-180' : 'text-[#8E9299] rotate-180'}`} />
              </div>
            </div>
            
            <p className={`text-center text-xs ${THEME.textSecondary} italic`}>
              {isSwapped 
                ? "Left channel is now routed to Right ear, and vice versa." 
                : "Audio channels are in their default configuration."}
            </p>
          </div>

          <div className={`h-px ${THEME.border} w-full`} />

          {/* Monitoring Controls */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className={`${THEME.mono} text-[10px] uppercase tracking-widest ${THEME.textSecondary}`}>
                Real-Time Monitoring
              </label>
              <div className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${isMonitoring ? 'bg-[#00FF00] text-black' : 'bg-[#2A2B2F] text-[#8E9299]'}`}>
                {isMonitoring ? 'Live' : 'Off'}
              </div>
            </div>
            
            <button
              onClick={isMonitoring ? stopMonitoring : startMonitoring}
              className={`w-full py-4 rounded-xl flex items-center justify-center gap-3 font-bold uppercase tracking-widest text-xs transition-all ${
                isMonitoring 
                  ? 'bg-red-500/10 border border-red-500/50 text-red-500 hover:bg-red-500/20' 
                  : `${THEME.accentBg} text-black hover:opacity-90`
              }`}
            >
              {isMonitoring ? (
                <>
                  <MicOff className="w-4 h-4" />
                  Stop Monitoring
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4" />
                  Start Mic Monitor
                </>
              )}
            </button>
            <p className={`text-[10px] ${THEME.textSecondary} text-center italic`}>
              Use this to hear your microphone with the current swap settings.
            </p>
          </div>

          <div className={`h-px ${THEME.border} w-full`} />

          {/* File Player Section */}
          <div className="space-y-4">
            <label className={`${THEME.mono} text-[10px] uppercase tracking-widest ${THEME.textSecondary}`}>
              Media File Test
            </label>
            <div className="flex flex-col gap-3">
              <input 
                type="file" 
                accept="audio/*" 
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    cleanupSource();
                    const ctx = await initAudio();
                    const audio = new Audio(URL.createObjectURL(file));
                    const source = ctx.createMediaElementSource(audio);
                    sourceNodeRef.current = source;
                    setupRouting(ctx, source);
                    audio.play();
                    setStatus('active');
                  }
                }}
                className="hidden" 
                id="audio-upload"
              />
              <label 
                htmlFor="audio-upload"
                className={`py-3 rounded-lg border ${THEME.border} border-dashed hover:border-[#00FF00] hover:bg-white/5 flex items-center justify-center gap-2 transition-all cursor-pointer`}
              >
                <Play className="w-4 h-4 text-[#00FF00]" />
                <span className="text-xs font-bold uppercase tracking-widest">Upload & Play File</span>
              </label>
            </div>
          </div>

          <div className={`h-px ${THEME.border} w-full`} />
          <div className="space-y-4">
            <label className={`${THEME.mono} text-[10px] uppercase tracking-widest ${THEME.textSecondary}`}>
              Channel Verification
            </label>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => playTestSound('left')}
                className={`py-3 rounded-lg border ${THEME.border} hover:bg-white/5 flex items-center justify-center gap-2 transition-colors`}
              >
                <Volume2 className="w-4 h-4 text-[#00FF00]" />
                <span className="text-xs font-bold uppercase tracking-widest">Test Left</span>
              </button>
              <button
                onClick={() => playTestSound('right')}
                className={`py-3 rounded-lg border ${THEME.border} hover:bg-white/5 flex items-center justify-center gap-2 transition-colors`}
              >
                <Volume2 className="w-4 h-4 text-[#00FF00]" />
                <span className="text-xs font-bold uppercase tracking-widest">Test Right</span>
              </button>
            </div>
          </div>

          {/* Volume Slider */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className={`${THEME.mono} text-[10px] uppercase tracking-widest ${THEME.textSecondary}`}>
                Output Volume
              </label>
              <span className={`${THEME.mono} text-xs text-[#00FF00]`}>{volume}%</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max="100" 
              value={volume}
              onChange={(e) => setVolume(parseInt(e.target.value))}
              className="w-full h-1 bg-[#2A2B2F] rounded-lg appearance-none cursor-pointer accent-[#00FF00]"
            />
          </div>
        </div>

        {/* Footer / Device Info */}
        <div className={`bg-black/20 p-4 border-t ${THEME.border}`}>
          <div className="flex items-center gap-2 text-[#8E9299]">
            <Monitor className="w-3 h-3" />
            <span className={`${THEME.mono} text-[9px] uppercase tracking-tight`}>
              Detected Output: {devices.length > 0 ? devices[0].label : 'System Default'}
            </span>
          </div>
        </div>
      </motion.div>

      {/* Error Toast */}
      <AnimatePresence>
        {status === 'error' && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-full shadow-xl flex items-center gap-3"
          >
            <AlertCircle className="w-5 h-5" />
            <span className="text-sm font-medium">{errorMessage}</span>
            <button onClick={() => setStatus('idle')} className="ml-2 hover:opacity-70">
              <CheckCircle2 className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="mt-12 text-[10px] uppercase tracking-[0.2em] text-[#8E9299] opacity-50">
        Professional Audio Utility &bull; v1.0.0
      </footer>
    </div>
  );
}
