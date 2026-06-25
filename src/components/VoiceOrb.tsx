// src/components/VoiceOrb.tsx
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, Sparkles, Loader2 } from 'lucide-react';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

// Global array to store active SpeechSynthesisUtterance objects to prevent garbage collection
const activeUtterances: SpeechSynthesisUtterance[] = [];

// Helper functions for Indonesian voice preprocessing
const numberToIndonesianWords = (num: number, isRoot: boolean = true): string => {
  const units = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  
  if (num === 0) return isRoot ? 'nol' : '';
  
  let temp = num;
  let result = '';
  
  if (temp < 12) {
    result = units[temp];
  } else if (temp < 20) {
    result = numberToIndonesianWords(temp - 10, false) + ' belas';
  } else if (temp < 100) {
    const remainder = temp % 10;
    result = numberToIndonesianWords(Math.floor(temp / 10), false) + ' puluh ' + (remainder !== 0 ? units[remainder] : '');
  } else if (temp < 200) {
    result = 'seratus ' + numberToIndonesianWords(temp - 100, false);
  } else if (temp < 1000) {
    const remainder = temp % 100;
    result = numberToIndonesianWords(Math.floor(temp / 100), false) + ' ratus ' + (remainder !== 0 ? numberToIndonesianWords(remainder, false) : '');
  } else if (temp < 2000) {
    result = 'seribu ' + numberToIndonesianWords(temp - 1000, false);
  } else if (temp < 1000000) {
    const remainder = temp % 1000;
    result = numberToIndonesianWords(Math.floor(temp / 1000), false) + ' ribu ' + (remainder !== 0 ? numberToIndonesianWords(remainder, false) : '');
  } else if (temp < 1000000000) {
    const remainder = temp % 1000000;
    result = numberToIndonesianWords(Math.floor(temp / 1000000), false) + ' juta ' + (remainder !== 0 ? numberToIndonesianWords(remainder, false) : '');
  } else if (temp < 1000000000000) {
    const remainder = temp % 1000000000;
    result = numberToIndonesianWords(Math.floor(temp / 1000000000), false) + ' miliar ' + (remainder !== 0 ? numberToIndonesianWords(remainder, false) : '');
  }
  
  return result.replace(/\s+/g, ' ').trim();
};

const preprocessTextForTTS = (text: string): string => {
  let processed = text;

  // 1. Strip out invoice numbers entirely (e.g. "Nomor invoice INV-2839213" or just "INV-2839213")
  processed = processed.replace(/(?:dengan\s+)?nomor\s+invoice\s+INV-[A-Z0-9]+/gi, '');
  processed = processed.replace(/INV-[A-Z0-9]+/gi, '');

  // 2. Adjust pronunciation of "AI" or "A.I." to sound friendly/conversational as "e ai"
  processed = processed.replace(/\bA\.?I\.?\b/gi, 'e ai');

  // 3. Convert Rp 3.500 or Rp 3500 -> tiga ribu lima ratus rupiah
  const currencyRegex = /(?:Rp\.?\s*)(\d+(?:\.\d{3})*)/gi;
  processed = processed.replace(currencyRegex, (match, numberStr) => {
    const cleanNumber = parseInt(numberStr.replace(/\./g, ''), 10);
    if (!isNaN(cleanNumber)) {
      return numberToIndonesianWords(cleanNumber) + ' rupiah';
    }
    return match;
  });

  // 4. Convert numbers preceding "rupiah"
  const rupiahSuffixRegex = /(\d+(?:\.\d{3})*)\s*rupiah/gi;
  processed = processed.replace(rupiahSuffixRegex, (match, numberStr) => {
    const cleanNumber = parseInt(numberStr.replace(/\./g, ''), 10);
    if (!isNaN(cleanNumber)) {
      return numberToIndonesianWords(cleanNumber) + ' rupiah';
    }
    return match;
  });

  // 5. Convert standalone numbers/digits (e.g. quantities like 2, 15)
  const numberRegex = /\b(\d+)\b/g;
  processed = processed.replace(numberRegex, (match, numberStr) => {
    const num = parseInt(numberStr, 10);
    if (!isNaN(num) && num < 1000000000000) {
      return numberToIndonesianWords(num);
    }
    return match;
  });

  // Clean double spaces and punctuation gaps
  return processed.replace(/\s+/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
};

function filterSpeechTranscript(text: string, allowedProducts: Set<string>): string {
  if (!text) return '';
  const words = text.split(/\s+/);
  const filteredWords: string[] = [];
  
  const baseAllowed = new Set([
    // Greetings & Politeness
    'selamat', 'datang', 'pagi', 'siang', 'sore', 'malam', 'halo', 'hai', 'permisi',
    'kak', 'kakak', 'bang', 'mbak', 'mas', 'de', 'dek',
    // Pronouns
    'saya', 'kami', 'kita', 'aku',
    // Buying verbs & intents
    'beli', 'pesan', 'tambah', 'order', 'ambil', 'minta', 'tolong', 'ingin', 'mau', 'pengen', 'butuh',
    // Modifying/Canceling verbs
    'kurang', 'hapus', 'batal', 'cancel', 'kurangi', 'hilangkan', 'kembali',
    // Cart & Checkout
    'keranjang', 'checkout', 'bayar', 'lunas', 'total', 'harga', 'berapa',
    'kasbon', 'hutang', 'utang', 'qris', 'midtrans', 'transfer', 'cash', 'tunai',
    'nanti', 'sekarang', 'catat', 'simpan',
    // Catalog queries & question words
    'produk', 'barang', 'daftar', 'menu', 'etalase', 'lihat', 'cari', 'stok',
    'ada', 'apa', 'apakah', 'saja', 'aja', 'mana', 'dimana', 'bagaimana',
    // Coordinating conjunctions & prepositions
    'dan', 'sama', 'dengan', 'atau', 'terus', 'lalu', 'kemudian', 'untuk', 'atas', 'nama',
    // Affirmations / Confirmations
    'cukup', 'sudah', 'selesai', 'oke', 'ok', 'okedeh', 'baik', 'siap', 'setuju', 'konfirmasi', 'ya', 'iya', 'yes', 'sukses',
    // Quantities / Numbers
    'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh',
    'sebelas', 'belas', 'puluh', 'ratus', 'ribu', 'rupiah', 'rp'
  ]);

  const roots = [
    'beli', 'pesan', 'tambah', 'order', 'ambil', 'kurang', 'hapus', 'batal', 'checkout',
    'bayar', 'lunas', 'harga', 'kasbon', 'hutang', 'utang', 'qris', 'transfer', 'tunai',
    'catat', 'cukup', 'selesai', 'barang', 'produk'
  ];

  words.forEach((w) => {
    const cleanWord = w.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
    if (!cleanWord) return;
    
    const isDigit = /^\d+$/.test(cleanWord);
    if (isDigit) {
      filteredWords.push(w);
      return;
    }

    if (baseAllowed.has(cleanWord)) {
      filteredWords.push(w);
      return;
    }

    if (allowedProducts.has(cleanWord)) {
      filteredWords.push(w);
      return;
    }

    for (const prodWord of allowedProducts) {
      if (cleanWord.includes(prodWord)) {
        filteredWords.push(w);
        return;
      }
    }

    for (const root of roots) {
      if (cleanWord.includes(root)) {
        filteredWords.push(w);
        return;
      }
    }
  });

  return filteredWords.join(' ');
}

interface VoiceOrbProps {
  mode: 'customer' | 'owner';
  cartItems: Array<{ sku: string; quantity: number }>;
  onActionTriggered: (actionType: string, payload: any) => void;
  onTranscriptReceived: (userText: string, aiText: string, products?: any[]) => void;
  compact?: boolean;
  mockCheckoutActive?: boolean;
  voiceCommandToSpeak?: { text: string; timestamp: number };
  chatLogs?: Array<{ sender: 'user' | 'ai'; text: string }>;
}

export default function VoiceOrb({
  mode,
  cartItems,
  onActionTriggered,
  onTranscriptReceived,
  compact = false,
  mockCheckoutActive = false,
  voiceCommandToSpeak,
  chatLogs = [],
}: VoiceOrbProps) {
  const [state, setState] = useState<OrbState>('idle');
  const [recognitionSupported, setRecognitionSupported] = useState<boolean>(true);
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [finalTranscript, setFinalTranscript] = useState<string>('');
  const [hasGreeted, setHasGreeted] = useState<boolean>(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  
  // 2-Way communication state (interactive hands-free mode)
  const [isTwoWayMode, setIsTwoWayMode] = useState<boolean>(true);
  const [isMounted, setIsMounted] = useState<boolean>(false);
  const [waitingForKasbonName, setWaitingForKasbonName] = useState<boolean>(false);
  const [allowedProductWords, setAllowedProductWords] = useState<Set<string>>(new Set());

  useEffect(() => {
    setIsMounted(true);
    const fetchProducts = async () => {
      try {
        const res = await fetch('/api/products');
        if (res.ok) {
          const data = await res.json();
          const words = new Set<string>();
          data.forEach((p: any) => {
            p.name.toLowerCase().split(/\s+/).forEach((w: string) => {
              const clean = w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
              if (clean) words.add(clean);
            });
            p.sku.toLowerCase().split(/\s+/).forEach((w: string) => {
              const clean = w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
              if (clean) words.add(clean);
            });
          });
          setAllowedProductWords(words);
        }
      } catch (err) {
        console.error('Failed to fetch product names for speech filtering:', err);
      }
    };
    fetchProducts();
  }, []);
  
  const addDebugLog = (msg: string) => {
    setDebugLogs(prev => [...prev.slice(-4), `${new Date().toLocaleTimeString()}: ${msg}`]);
  };
  
  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef<boolean>(false);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const safetyTimeoutRef = useRef<any>(null);

  // Custom Audio player refs
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingAudioRef = useRef<boolean>(false);
  const silenceCountRef = useRef<number>(0);

  // Refs to prevent closure staleness in Web Speech API events
  const finalTranscriptRef = useRef<string>('');
  const interimTranscriptRef = useRef<string>('');
  const processSpeechInputRef = useRef<any>(null);
  const isTwoWayModeRef = useRef<boolean>(true);
  const stateRef = useRef<OrbState>('idle');
  const waitingForKasbonNameRef = useRef<boolean>(false);
  const allowedProductWordsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    waitingForKasbonNameRef.current = waitingForKasbonName;
  }, [waitingForKasbonName]);

  useEffect(() => {
    allowedProductWordsRef.current = allowedProductWords;
  }, [allowedProductWords]);

  // Sync processSpeechInput and dynamic states with their refs on every render
  useEffect(() => {
    processSpeechInputRef.current = processSpeechInput;
  });

  useEffect(() => {
    isTwoWayModeRef.current = isTwoWayMode;
  }, [isTwoWayMode]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Trigger speech when parent requests vocal feedback (e.g. payment confirmations)
  useEffect(() => {
    if (voiceCommandToSpeak && voiceCommandToSpeak.text) {
      // Stop listening first to prevent audio feedback
      if (isListeningRef.current) {
        try {
          recognitionRef.current?.stop();
        } catch (err) {
          console.error('Failed to stop recognition for external voice trigger:', err);
        }
      }
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
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
    };
  }, []);

  // Helper to start recognition automatically
  const startListeningAutomatically = () => {
    if (!recognitionRef.current) return;
    if (stateRef.current === 'thinking' || stateRef.current === 'speaking') {
      addDebugLog('Skipping auto-start: voice loop busy');
      return;
    }

    try {
      addDebugLog('Auto-starting recognition...');
      try {
        recognitionRef.current.stop();
      } catch (e) {}
      setTimeout(() => {
        try {
          if (!isListeningRef.current && stateRef.current !== 'thinking' && stateRef.current !== 'speaking') {
            recognitionRef.current.start();
          }
        } catch (err) {
          console.error('Failed to auto-restart recognition:', err);
        }
      }, 100);
    } catch (err) {
      console.error('Failed to execute auto-start sequence:', err);
    }
  };

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

    // Global user gesture unlocker for mobile devices (iOS/Android/Safari)
    const unlockTTS = () => {
      const isMobileOrSafari = typeof navigator !== 'undefined' && (
        /iPad|iPhone|iPod|Android/.test(navigator.userAgent) ||
        (/^((?!chrome|android).)*safari/i.test(navigator.userAgent))
      );
      if (isMobileOrSafari) {
        if ('speechSynthesis' in window) {
          try {
            const silentUtterance = new SpeechSynthesisUtterance(' ');
            silentUtterance.volume = 0;
            window.speechSynthesis.speak(silentUtterance);
            console.log('SpeechSynthesis unlocked via global user gesture.');
          } catch (err) {
            console.warn('Failed to unlock SpeechSynthesis via global gesture:', err);
          }
        }
        try {
          const silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
          silentAudio.play().catch(() => {});
          console.log('HTML5 Audio unlocked via global user gesture.');
        } catch (err) {
          console.warn('Failed to unlock HTML5 Audio via global gesture:', err);
        }
      }
      // Remove listeners after first interaction
      window.removeEventListener('click', unlockTTS);
      window.removeEventListener('touchstart', unlockTTS);
    };

    window.addEventListener('click', unlockTTS);
    window.addEventListener('touchstart', unlockTTS);

    // Initialize Web Speech API
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setRecognitionSupported(false);
      return () => {
        window.removeEventListener('click', unlockTTS);
        window.removeEventListener('touchstart', unlockTTS);
      };
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;
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
      let cumulativeFinal = '';
      let currentInterim = '';

      for (let i = 0; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          cumulativeFinal += event.results[i][0].transcript + ' ';
        } else {
          currentInterim += event.results[i][0].transcript;
        }
      }

      setInterimTranscript(currentInterim);
      interimTranscriptRef.current = currentInterim;
      
      setFinalTranscript(cumulativeFinal.trim());
      finalTranscriptRef.current = cumulativeFinal.trim();

      // Check for 'cukup' keyword to stop recording
      const checkText = (cumulativeFinal + ' ' + currentInterim).toLowerCase();
      if (checkText.includes('cukup')) {
        addDebugLog('Detected "cukup" trigger! Stopping speech recognition...');
        try {
          recognitionRef.current?.stop();
        } catch (e) {}
      }
    };

    rec.onerror = (event: any) => {
      console.error('Speech Recognition Error:', event.error);
      addDebugLog(`Speech Recognition Error: ${event.error}`);
      
      if (event.error === 'no-speech') {
        // Let onend handle the timeout/restart logic
        return;
      }
      
      if (event.error !== 'aborted') {
        setState('idle');
        isListeningRef.current = false;
      }
    };

    rec.onend = () => {
      isListeningRef.current = false;
      
      const rawText = (finalTranscriptRef.current + ' ' + interimTranscriptRef.current).trim();
      
      // Clear transcript states for next session
      setInterimTranscript('');
      setFinalTranscript('');
      finalTranscriptRef.current = '';
      interimTranscriptRef.current = '';

      if (rawText) {
        silenceCountRef.current = 0; // Reset silence counter on valid input
        
        // Strip the word "cukup" (and some variations/symbols)
        let cleanRaw = rawText.replace(/\b(cukup|sudah cukup)\b/gi, '').trim();
        
        // Normalize "kris" and "keris" pronunciation variants to standard "qris"
        cleanRaw = cleanRaw.replace(/\b(kris|keris)\b/gi, 'qris');
        
        // Handle stop/cancel keywords locally to disable 2-way mode smoothly
        const query = cleanRaw.toLowerCase();
        const stopKeywords = ['stop', 'matikan', 'nonaktifkan', 'batal', 'cancel'];
        const isStopCommand = stopKeywords.some(keyword => query === keyword || query.startsWith(keyword + ' ') || query.endsWith(' ' + keyword));
        
        if (isStopCommand) {
          setIsTwoWayMode(false);
          setState('idle');
          speakResponse('Baik, saya matikan komunikasi dua arah. Sampai jumpa!');
          return;
        }

        // Apply product-aware and grammar keyword filter!
        // If we are waiting for a Kasbon name, we bypass the filter to avoid discarding the user's name.
        const filteredText = waitingForKasbonNameRef.current 
          ? cleanRaw 
          : filterSpeechTranscript(cleanRaw, allowedProductWordsRef.current);
        addDebugLog(`Raw speech: "${rawText}" -> Filtered speech: "${filteredText}"`);

        if (filteredText.trim()) {
          if (processSpeechInputRef.current) {
            processSpeechInputRef.current(filteredText);
          }
        } else {
          // If the filtered text is empty (trash input/background noise), restart automatically if in 2-way mode
          if (isTwoWayModeRef.current) {
            setState('idle');
            setTimeout(() => {
              startListeningAutomatically();
            }, 400);
          } else {
            setState('idle');
          }
        }
      } else {
        // Handle silence - automatically restart recognition for continuous loop if two-way mode is active
        if (isTwoWayModeRef.current) {
          setState('idle');
          setTimeout(() => {
            if (isTwoWayModeRef.current && !isListeningRef.current && stateRef.current !== 'speaking' && stateRef.current !== 'thinking') {
              try {
                recognitionRef.current?.stop();
              } catch (e) {}
              setTimeout(() => {
                try {
                  if (isTwoWayModeRef.current && !isListeningRef.current && stateRef.current !== 'speaking' && stateRef.current !== 'thinking') {
                    recognitionRef.current?.start();
                  }
                } catch (err) {
                  console.error('Failed to restart recognition on silence:', err);
                }
              }, 100);
            }
          }, 400);
        } else {
          setState('idle');
        }
      }
    };

    recognitionRef.current = rec;

    return () => {
      window.removeEventListener('click', unlockTTS);
      window.removeEventListener('touchstart', unlockTTS);
    };
  }, []);

  const stopAllAudio = () => {
    // Stop native speechSynthesis if speaking
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    // Stop custom HTML5 audio playing
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    isPlayingAudioRef.current = false;
    if (safetyTimeoutRef.current) {
      clearTimeout(safetyTimeoutRef.current);
      safetyTimeoutRef.current = null;
    }
  };

  const splitTextIntoChunks = (text: string): string[] => {
    const cleanText = text.replace(/\s+/g, ' ').trim();
    // Split by sentence ending punctuation and newlines
    const sentences = cleanText.match(/[^.!?;\n]+[.!?;\n]*/g) || [cleanText];
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > 150) {
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = sentence;
      } else {
        currentChunk += ' ' + sentence;
      }
    }
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    return chunks.filter(c => c.length > 0);
  };

  const playAudioChunks = (chunks: string[]): Promise<void> => {
    return new Promise((resolve, reject) => {
      let index = 0;
      
      const playNext = () => {
        if (!isPlayingAudioRef.current) {
          resolve();
          return;
        }
        if (index >= chunks.length) {
          resolve();
          return;
        }

        const chunk = chunks[index];
        index++;
        
        const url = `/api/tts?text=${encodeURIComponent(chunk)}`;
        const audio = new Audio(url);
        currentAudioRef.current = audio;
        
        audio.onended = () => {
          playNext();
        };
        
        audio.onerror = (e) => {
          console.error('Audio chunk playback error:', e);
          if (index === 1) {
            reject(new Error('TTS Service Unavailable'));
          } else {
            playNext();
          }
        };

        audio.play().catch(err => {
          console.error('Failed to play audio chunk:', err);
          reject(err);
        });
      };

      playNext();
    });
  };

  const toggleListening = () => {
    addDebugLog('toggleListening called, state: ' + state);
    
    // Unlock Speech Synthesis and HTML5 Audio for iOS/Safari & Android browsers in click handler context
    const isMobileOrSafari = typeof navigator !== 'undefined' && (
      /iPad|iPhone|iPod|Android/.test(navigator.userAgent) ||
      (/^((?!chrome|android).)*safari/i.test(navigator.userAgent))
    );
    if (isMobileOrSafari) {
      if ('speechSynthesis' in window) {
        try {
          const silentUtterance = new SpeechSynthesisUtterance(' ');
          silentUtterance.volume = 0;
          window.speechSynthesis.speak(silentUtterance);
        } catch (err) {
          console.warn('Failed to unlock SpeechSynthesis:', err);
        }
      }
      try {
        const silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
        silentAudio.play().catch(() => {});
      } catch (err) {}
    }

    if (!recognitionSupported) {
      alert('Perekaman suara (Speech Recognition) tidak didukung di browser ini. Silakan gunakan Google Chrome atau Safari.');
      return;
    }

    if (state === 'speaking') {
      // User clicked while AI was speaking - stop audio and start listening immediately (continuous loop remains active)
      stopAllAudio();
      setIsTwoWayMode(true);
      setState('idle');
      setTimeout(() => {
        try {
          recognitionRef.current?.stop();
        } catch (e) {}
        setTimeout(() => {
          try {
            recognitionRef.current?.start();
          } catch (err) {
            console.error('Failed to start recognition after speaking interruption:', err);
          }
        }, 100);
      }, 50);
      return;
    }

    if (state === 'listening') {
      // User clicked while listening - stop listening and disable continuous hands-free mode (mute)
      setIsTwoWayMode(false);
      try {
        recognitionRef.current?.stop();
      } catch (e) {}
      setState('idle');
    } else {
      // User clicked while idle - enable continuous hands-free mode and start listening
      setIsTwoWayMode(true);
      
      // If customer clicks the mic for the first time, greet them first!
      if (!hasGreeted && mode === 'customer') {
        setHasGreeted(true);
        const greetingText = "Halo, selamat datang di Kasir Pintar A.I. Ada yang bisa saya bantu hari ini?";
        onTranscriptReceived("", greetingText, []);
        speakResponse(greetingText);
        return;
      }

      try {
        stopAllAudio();
        try {
          recognitionRef.current?.stop();
        } catch (e) {}
        setTimeout(() => {
          try {
            recognitionRef.current?.start();
          } catch (err) {
            console.error('Failed to start recognition:', err);
          }
        }, 100);
      } catch (err) {
        console.error('Failed to initiate start sequence:', err);
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

    // Determine final message to send based on context
    let finalMessage = text;
    if (waitingForKasbonNameRef.current) {
      finalMessage = `kasbon atas nama ${text}`;
      setWaitingForKasbonName(false);
    }

    // Format conversation history for Gemini context (last 10 turns)
    const history = (chatLogs || [])
      .filter(log => log.text && log.text.trim() !== '')
      .slice(-10)
      .map(log => ({
        role: log.sender === 'user' ? 'user' : 'model',
        parts: [{ text: log.text }]
      }));

    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: finalMessage,
          mode,
          cartItems,
          history,
        }),
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      onTranscriptReceived(text, data.response, data.products);

      // Execute client-side action if any
      if (data.actions && Array.isArray(data.actions)) {
        for (const action of data.actions) {
          if (action) {
            onActionTriggered(action.type, action.payload);
            if (action.type === 'ASK_KASBON_NAME') {
              setWaitingForKasbonName(true);
            }
          }
        }
      } else if (data.action) {
        onActionTriggered(data.action.type, data.action.payload);
        
        if (data.action.type === 'ASK_KASBON_NAME') {
          setWaitingForKasbonName(true);
        }
      } else {
        // Fallback: If response conversationally asks for the buyer's name for a kasbon checkout, trigger context
        const lowerResponse = (data.response || '').toLowerCase();
        if (
          (lowerResponse.includes('nama lengkap') || lowerResponse.includes('atas nama siapa') || lowerResponse.includes('boleh tahu nama') || lowerResponse.includes('siapa ya')) &&
          (lowerResponse.includes('kasbon') || lowerResponse.includes('hutang') || lowerResponse.includes('pembukuan'))
        ) {
          setWaitingForKasbonName(true);
        }
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

  const speakResponse = async (text: string) => {
    addDebugLog(`speakResponse: "${text.substring(0, 20)}..."`);
    
    // Clean up previous event listeners, audios, and timeouts
    stopAllAudio();

    // Preprocess text to convert currency and standalone digits to Indonesian words (terbilang)
    const cleanText = preprocessTextForTTS(text);
    addDebugLog(`Cleaned speech text: "${cleanText.substring(0, 20)}..."`);

    // Check if the output text is a deactivation/goodbye response
    const lowerText = text.toLowerCase();
    const isDeactivationResponse = lowerText.includes('nonaktifkan') || lowerText.includes('matikan') || lowerText.includes('sampai jumpa');

    // Use custom server-side TTS proxy as the primary stable player
    const chunks = splitTextIntoChunks(cleanText);
    if (chunks.length === 0) {
      setState('idle');
      return;
    }

    setState('speaking');
    isPlayingAudioRef.current = true;

    try {
      await playAudioChunks(chunks);
      
      // Finished speaking successfully
      setState('idle');
      isPlayingAudioRef.current = false;
      
      // Auto-restart listening if 2-way mode is active
      if (isTwoWayModeRef.current && !isDeactivationResponse) {
        setTimeout(() => {
          startListeningAutomatically();
        }, 400);
      }
    } catch (err) {
      console.warn('Custom server-side TTS failed, falling back to Web SpeechSynthesis:', err);
      speakResponseFallback(cleanText, isDeactivationResponse);
    }
  };

  const speakResponseFallback = (text: string, isDeactivationResponse: boolean) => {
    if (!('speechSynthesis' in window)) {
      addDebugLog('ERROR: speechSynthesis not in window');
      setState('idle');
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    
    // Choose voice dynamically with robust fallbacks prioritizing Indonesian
    const voices = window.speechSynthesis.getVoices();
    
    // 1. Try exact match for Indonesian (id-ID)
    let selectedVoice = voices.find(v => {
      const l = v.lang.toLowerCase().replace('_', '-');
      return l === 'id-id';
    });
    
    // 2. Try any language code starting with 'id'
    if (!selectedVoice) {
      selectedVoice = voices.find(v => {
        const l = v.lang.toLowerCase().replace('_', '-');
        return l.startsWith('id');
      });
    }

    // 3. Try to match if name has "indonesia"
    if (!selectedVoice) {
      selectedVoice = voices.find(v => v.name.toLowerCase().includes('indonesia'));
    }

    // 4. Fallback to Malay (ms) only as a last resort if Indonesian is not installed
    if (!selectedVoice) {
      selectedVoice = voices.find(v => {
        const l = v.lang.toLowerCase().replace('_', '-');
        return l.startsWith('ms');
      });
    }

    if (selectedVoice) {
      utterance.voice = selectedVoice;
      utterance.lang = selectedVoice.lang.toLowerCase().startsWith('ms') ? selectedVoice.lang : 'id-ID';
      console.log(`Fallback Voice selected: ${selectedVoice.name} (${selectedVoice.lang})`);
    } else {
      utterance.lang = 'id-ID';
    }

    utterance.volume = 1.0;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    activeUtterances.push(utterance);

    // Periodically trigger resume to prevent Chrome from pausing speech synthesis randomly
    const resumeInterval = setInterval(() => {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.resume();
      } else {
        clearInterval(resumeInterval);
      }
    }, 2000);

    const estimatedMs = Math.max(3000, (text.length / 12) * 1000 + 3500);

    const cleanupAndIdle = () => {
      setState('idle');
      clearInterval(resumeInterval);
      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current);
        safetyTimeoutRef.current = null;
      }
      activeUtteranceRef.current = null;
      
      const idx = activeUtterances.indexOf(utterance);
      if (idx > -1) {
        activeUtterances.splice(idx, 1);
      }
    };

    safetyTimeoutRef.current = setTimeout(() => {
      addDebugLog('fallback safety timeout triggered!');
      cleanupAndIdle();
      if (isTwoWayModeRef.current && !isDeactivationResponse) {
        startListeningAutomatically();
      }
    }, estimatedMs);

    utterance.onstart = () => {
      setState('speaking');
    };

    utterance.onend = () => {
      cleanupAndIdle();
      if (isTwoWayModeRef.current && !isDeactivationResponse) {
        setTimeout(() => {
          startListeningAutomatically();
        }, 400);
      }
    };

    utterance.onerror = (e: any) => {
      cleanupAndIdle();
      if (isTwoWayModeRef.current && !isDeactivationResponse) {
        startListeningAutomatically();
      }
    };

    activeUtteranceRef.current = utterance;
    setState('speaking');

    try {
      window.speechSynthesis.speak(utterance);
      window.speechSynthesis.resume();
    } catch (err: any) {
      console.error('Failed to speak fallback utterance:', err);
      cleanupAndIdle();
    }
  };

  // Trigger manually via keyboard text input if testing without mic
  const handleTextSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Unlock Speech Synthesis for iOS/Safari & Android browsers on manual text submit
    const isMobileOrSafari = typeof navigator !== 'undefined' && (
      /iPad|iPhone|iPod|Android/.test(navigator.userAgent) ||
      (/^((?!chrome|android).)*safari/i.test(navigator.userAgent))
    );
    if (isMobileOrSafari && 'speechSynthesis' in window) {
      try {
        const silentUtterance = new SpeechSynthesisUtterance(' ');
        silentUtterance.volume = 0;
        window.speechSynthesis.speak(silentUtterance);
      } catch (err) {
        console.warn('Failed to unlock SpeechSynthesis on submit:', err);
      }
    }

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
