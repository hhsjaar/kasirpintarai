// src/components/VoiceOrb.tsx
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, Sparkles, Loader2 } from 'lucide-react';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

// Global array to store active SpeechSynthesisUtterance objects to prevent garbage collection
const activeUtterances: SpeechSynthesisUtterance[] = [];

interface VoiceOrbProps {
  mode: 'customer' | 'owner';
  cartItems: Array<{ sku: string; quantity: number }>;
  onActionTriggered: (actionType: string, payload: any) => void;
  onTranscriptReceived: (userText: string, aiText: string, products?: any[]) => void;
  compact?: boolean;
  mockCheckoutActive?: boolean;
  voiceCommandToSpeak?: { text: string; timestamp: number };
}

export default function VoiceOrb({
  mode,
  cartItems,
  onActionTriggered,
  onTranscriptReceived,
  compact = false,
  mockCheckoutActive = false,
  voiceCommandToSpeak,
}: VoiceOrbProps) {
  const [state, setState] = useState<OrbState>('idle');
  const [recognitionSupported, setRecognitionSupported] = useState<boolean>(true);
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [finalTranscript, setFinalTranscript] = useState<string>('');
  const [hasGreeted, setHasGreeted] = useState<boolean>(false);
  
  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef<boolean>(false);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const safetyTimeoutRef = useRef<any>(null);

  // Refs to prevent closure staleness in Web Speech API events
  const finalTranscriptRef = useRef<string>('');
  const interimTranscriptRef = useRef<string>('');
  const processSpeechInputRef = useRef<any>(null);

  // Sync processSpeechInput with its ref on every render
  useEffect(() => {
    processSpeechInputRef.current = processSpeechInput;
  });

  // Trigger speech when parent requests vocal feedback (e.g. payment confirmations)
  useEffect(() => {
    if (voiceCommandToSpeak && voiceCommandToSpeak.text) {
      speakResponse(voiceCommandToSpeak.text);
    }
  }, [voiceCommandToSpeak]);

  useEffect(() => {
    // Unmount cleanup function
    return () => {
      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current);
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    // Pre-fetch SpeechSynthesis voices and register fallback loader callback
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = () => {
          window.speechSynthesis.getVoices();
        };
      }
    }

    // Initialize Web Speech API
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setRecognitionSupported(false);
      return;
    }

    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'id-ID'; // Indonesian Language Support

    rec.onstart = () => {
      setState('listening');
      isListeningRef.current = true;
      setInterimTranscript('');
      setFinalTranscript('');
      finalTranscriptRef.current = '';
      interimTranscriptRef.current = '';
    };

    rec.onresult = (event: any) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      if (interim) {
        setInterimTranscript(interim);
        interimTranscriptRef.current = interim;
      }
      if (final) {
        setFinalTranscript(final);
        finalTranscriptRef.current = final;
        setInterimTranscript('');
        interimTranscriptRef.current = '';
      }
    };

    rec.onerror = (event: any) => {
      console.error('Speech Recognition Error:', event.error);
      if (event.error !== 'no-speech') {
        setState('idle');
        isListeningRef.current = false;
      }
    };

    rec.onend = () => {
      isListeningRef.current = false;
      
      const textToProcess = finalTranscriptRef.current || interimTranscriptRef.current;
      if (textToProcess && textToProcess.trim()) {
        if (processSpeechInputRef.current) {
          processSpeechInputRef.current(textToProcess);
        }
      } else {
        setState('idle');
      }
    };

    recognitionRef.current = rec;
  }, []);

  const toggleListening = () => {
    if (!recognitionSupported) {
      alert('Perekaman suara (Speech Recognition) tidak didukung di browser ini. Silakan gunakan Google Chrome atau Safari.');
      return;
    }

    if (state === 'speaking') {
      // Stop speaking
      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current);
        safetyTimeoutRef.current = null;
      }
      if ('speechSynthesis' in window) {
        if (activeUtteranceRef.current) {
          activeUtteranceRef.current.onstart = null;
          activeUtteranceRef.current.onend = null;
          activeUtteranceRef.current.onerror = null;
        }
        window.speechSynthesis.cancel();
      }
      setState('idle');
      return;
    }

    if (state === 'listening') {
      recognitionRef.current?.stop();
    } else {
      // If customer clicks the mic for the first time, greet them first!
      if (!hasGreeted && mode === 'customer') {
        setHasGreeted(true);
        const greetingText = "Halo, selamat datang di Kasir Pintar A.I. Ada yang bisa saya bantu hari ini?";
        onTranscriptReceived("", greetingText, []);
        speakResponse(greetingText);
        return;
      }

      try {
        // Cancel any speaking first
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
        }
        recognitionRef.current?.start();
      } catch (err) {
        console.error('Failed to start recognition:', err);
      }
    }
  };

  const processSpeechInput = async (text: string) => {
    setState('thinking');

    // Intercept payment-related commands locally if the mock QRIS checkout is active
    if (mockCheckoutActive) {
      const query = text.toLowerCase();
      if (query.includes('bayar') || query.includes('sukses') || query.includes('konfirmasi') || query.includes('setuju') || query.includes('oke') || query.includes('selesai')) {
        speakResponse('Baik, saya konfirmasi pembayaran Anda. Mohon tunggu sebentar.');
        onActionTriggered('CONFIRM_MOCK_PAYMENT', null);
        return;
      }
      if (query.includes('batal') || query.includes('cancel') || query.includes('kembali')) {
        onActionTriggered('CANCEL_MOCK_PAYMENT', null);
        return;
      }
    }

    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          mode,
          cartItems,
        }),
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      onTranscriptReceived(text, data.response, data.products);

      // Execute client-side action if any
      if (data.action) {
        onActionTriggered(data.action.type, data.action.payload);
      }

      // Voice read back
      speakResponse(data.speakText || data.response);
    } catch (err: any) {
      console.error('Error processing voice request:', err);
      setState('idle');
      onTranscriptReceived(text, 'Maaf, saya gagal terhubung ke asisten AI.');
      speakResponse('Maaf, saya gagal terhubung ke asisten.');
    }
  };

  const speakResponse = (text: string) => {
    if (!('speechSynthesis' in window)) {
      setState('idle');
      return;
    }

    // Clean up previous event listeners and timeouts
    if (activeUtteranceRef.current) {
      activeUtteranceRef.current.onstart = null;
      activeUtteranceRef.current.onend = null;
      activeUtteranceRef.current.onerror = null;
    }
    if (safetyTimeoutRef.current) {
      clearTimeout(safetyTimeoutRef.current);
      safetyTimeoutRef.current = null;
    }

    // Cancel active speech with Chrome workaround (resume first)
    try {
      window.speechSynthesis.resume();
      window.speechSynthesis.cancel();
    } catch (err) {
      console.error('SpeechSynthesis cancel error:', err);
    }

    const utterance = new SpeechSynthesisUtterance(text);
    
    // Choose voice dynamically with robust fallbacks
    const voices = window.speechSynthesis.getVoices();
    let selectedVoice = voices.find(v => v.lang.startsWith('id') || v.lang.includes('ID') || v.lang.startsWith('ms'));
    
    if (selectedVoice) {
      utterance.voice = selectedVoice;
      utterance.lang = 'id-ID';
    } else {
      // Fallback to default or English voice to prevent silent failures on systems without Indonesian voice packages
      selectedVoice = voices.find(v => v.default) || voices.find(v => v.lang.startsWith('en')) || voices[0];
      if (selectedVoice) {
        utterance.voice = selectedVoice;
        utterance.lang = selectedVoice.lang;
        console.warn(`Indonesian voice not found. Falling back to ${selectedVoice.name} (${selectedVoice.lang})`);
      } else {
        utterance.lang = 'id-ID';
      }
    }

    utterance.volume = 1.0;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    // Pin to global array to prevent V8 garbage collection bug in Chrome
    activeUtterances.push(utterance);

    // Periodically trigger resume to prevent Chrome from pausing speech synthesis randomly
    const resumeInterval = setInterval(() => {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.resume();
      } else {
        clearInterval(resumeInterval);
      }
    }, 2000);

    // Estimate reading duration (approx. 12 characters per second + 3.5s padding)
    const estimatedMs = Math.max(3000, (text.length / 12) * 1000 + 3500);

    const cleanupAndIdle = () => {
      setState('idle');
      clearInterval(resumeInterval);
      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current);
        safetyTimeoutRef.current = null;
      }
      activeUtteranceRef.current = null;
      
      // Unpin from global array
      const idx = activeUtterances.indexOf(utterance);
      if (idx > -1) {
        activeUtterances.splice(idx, 1);
      }
    };

    safetyTimeoutRef.current = setTimeout(() => {
      console.warn('Speech synthesis safety timeout triggered.');
      cleanupAndIdle();
    }, estimatedMs);

    utterance.onstart = () => {
      setState('speaking');
    };

    utterance.onend = () => {
      cleanupAndIdle();
      // Auto-restart Speech Recognition for Siri-like hands-free interactive conversation flow
      if (recognitionRef.current && !isListeningRef.current) {
        try {
          recognitionRef.current.start();
        } catch (err) {
          console.error('Failed to auto-restart recognition:', err);
        }
      }
    };

    utterance.onerror = (e: any) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') {
        console.error('Speech synthesis error:', e);
      }
      cleanupAndIdle();
    };

    activeUtteranceRef.current = utterance;
    
    // Set state immediately to speaking (or at least transition) to prevent browser freezes
    setState('speaking');

    try {
      window.speechSynthesis.speak(utterance);
      // Force play audio immediately
      window.speechSynthesis.resume();
    } catch (err) {
      console.error('Failed to speak utterance:', err);
      cleanupAndIdle();
    }
  };

  // Trigger manually via keyboard text input if testing without mic
  const handleTextSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const text = formData.get('manualInput') as string;
    if (text && text.trim()) {
      processSpeechInput(text);
      e.currentTarget.reset();
    }
  };

  // Helper styles based on states
  const getOrbStyle = () => {
    switch (state) {
      case 'listening':
        return 'animate-orb-listening bg-gradient-to-tr from-emerald-500 to-teal-400 text-white shadow-xl shadow-emerald-200/60 scale-105';
      case 'thinking':
        return 'animate-orb-thinking bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 text-white shadow-xl shadow-indigo-200/60';
      case 'speaking':
        return 'animate-orb-speaking bg-gradient-to-tr from-teal-400 to-cyan-400 text-white shadow-xl shadow-teal-200/60';
      default:
        return 'animate-orb-idle bg-gradient-to-tr from-emerald-600 to-emerald-400 hover:from-emerald-500 hover:to-emerald-350 text-white shadow-lg shadow-emerald-100/70';
    }
  };

  if (compact) {
    return (
      <div className="flex flex-col sm:flex-row items-center gap-4">
        {/* Status indicator / Transcript */}
        <div className="text-center sm:text-right">
          {interimTranscript ? (
            <p className="text-slate-550 italic text-xs animate-pulse max-w-xs truncate">
              &ldquo;{interimTranscript}&rdquo;
            </p>
          ) : state === 'thinking' ? (
            <span className="flex items-center justify-center sm:justify-end text-indigo-650 gap-1.5 text-xs font-bold">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Berpikir...
            </span>
          ) : state === 'speaking' ? (
            <span className="flex items-center justify-center sm:justify-end text-teal-600 gap-1.5 text-xs font-bold">
              <Volume2 className="w-3.5 h-3.5 animate-bounce" />
              Berbicara...
            </span>
          ) : state === 'listening' ? (
            <span className="flex items-center justify-center sm:justify-end text-emerald-605 gap-1.5 text-xs font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              Mendengarkan...
            </span>
          ) : (
            <p className="text-slate-400 text-xs">Klik mic untuk berbicara</p>
          )}
        </div>

        {/* Small Orb Button */}
        <div className="relative flex items-center justify-center w-16 h-16 shrink-0">
          {state === 'listening' && (
            <>
              <div className="absolute inset-0 rounded-full border-2 border-emerald-500/20 animate-ping opacity-75" />
              <div className="absolute -inset-2 rounded-full border border-emerald-500/10 animate-ping delay-300 opacity-50" />
            </>
          )}

          <button
            onClick={toggleListening}
            className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all duration-500 cursor-pointer select-none active:scale-95 border-2 border-white ${getOrbStyle()}`}
            title="Klik untuk berbicara"
          >
            {state === 'idle' && <Mic className="w-5 h-5 text-white" />}
            {state === 'listening' && <Mic className="w-5 h-5 text-white animate-pulse" />}
            {state === 'thinking' && <Sparkles className="w-5 h-5 text-white animate-pulse" />}
            {state === 'speaking' && <Volume2 className="w-5 h-5 text-white" />}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-6 space-y-6 w-full max-w-md mx-auto">
      {/* Visual State Label */}
      <div className="flex items-center space-x-2 px-4 py-1.5 rounded-full glass-card border border-slate-200/60 shadow-md text-xs font-bold uppercase tracking-wider bg-white/80">
        {state === 'idle' && (
          <span className="flex items-center text-slate-500 gap-1.5">
            <span className="w-2 h-2 rounded-full bg-slate-400 animate-pulse" />
            Ready
          </span>
        )}
        {state === 'listening' && (
          <span className="flex items-center text-emerald-600 gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            Mendengarkan...
          </span>
        )}
        {state === 'thinking' && (
          <span className="flex items-center text-indigo-600 gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Berpikir...
          </span>
        )}
        {state === 'speaking' && (
          <span className="flex items-center text-teal-600 gap-1.5">
            <Volume2 className="w-3.5 h-3.5 animate-bounce" />
            Berbicara...
          </span>
        )}
      </div>

      {/* Main AI Orb Button */}
      <div className="relative flex items-center justify-center w-56 h-56">
        {/* External glow ripples during listening */}
        {state === 'listening' && (
          <>
            <div className="absolute inset-0 rounded-full border-2 border-emerald-500/20 animate-ping opacity-75" />
            <div className="absolute -inset-4 rounded-full border border-emerald-500/10 animate-ping delay-300 opacity-50" />
          </>
        )}

        <button
          onClick={toggleListening}
          className={`relative w-44 h-44 rounded-full flex flex-col items-center justify-center transition-all duration-500 cursor-pointer select-none active:scale-95 border-4 border-white ${getOrbStyle()}`}
          title="Klik untuk berbicara"
        >
          {state === 'idle' && <Mic className="w-14 h-14 text-white" />}
          {state === 'listening' && <Mic className="w-14 h-14 text-white animate-pulse" />}
          {state === 'thinking' && <Sparkles className="w-14 h-14 text-white animate-pulse" />}
          {state === 'speaking' && <Volume2 className="w-14 h-14 text-white" />}
          
          <span className="absolute bottom-8 text-[10px] text-white/95 font-black uppercase tracking-wider text-center px-4 w-full">
            {state === 'idle' 
              ? 'Mulai Bicara' 
              : state === 'listening' 
              ? 'Mendengarkan' 
              : state === 'thinking' 
              ? 'Berpikir' 
              : state === 'speaking' 
              ? 'Berbicara' 
              : state}
          </span>
        </button>
      </div>

      {/* Real-time transcript display */}
      <div className="w-full text-center space-y-2 h-16 flex flex-col justify-center">
        {interimTranscript && (
          <p className="text-slate-500 italic text-sm animate-pulse">
            &ldquo;{interimTranscript}&rdquo;
          </p>
        )}
        {state === 'thinking' && finalTranscript && (
          <p className="text-slate-700 font-bold text-sm">
            &ldquo;{finalTranscript}&rdquo;
          </p>
        )}
        {state === 'idle' && !interimTranscript && (
          <p className="text-slate-400 text-xs">
            Klik tombol di atas lalu sebutkan pesanan Anda
          </p>
        )}
      </div>

      {/* Keyboard Input Fallback (for testing/accessibility) */}
      <form onSubmit={handleTextSubmit} className="flex gap-2 w-full pt-4">
        <input
          name="manualInput"
          type="text"
          placeholder="Atau ketik perintah di sini..."
          className="flex-1 px-4 py-2.5 rounded-xl bg-white border border-slate-200 shadow-sm text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent transition"
          disabled={state === 'thinking' || state === 'listening'}
        />
        <button
          type="submit"
          disabled={state === 'thinking' || state === 'listening'}
          className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-bold transition border border-slate-200 disabled:opacity-50 shadow-sm cursor-pointer"
        >
          Kirim
        </button>
      </form>
    </div>
  );
}
