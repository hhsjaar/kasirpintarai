"use client";

import { useEffect, useState } from "react";
import { Download, X, Share2, Plus, Sparkles } from "lucide-react";

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // 1. Check if already running in standalone mode (already installed)
    const checkStandalone = () => {
      const isStandaloneMode =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as any).standalone === true;
      setIsStandalone(isStandaloneMode);
      return isStandaloneMode;
    };

    const isStandaloneMode = checkStandalone();

    // 2. Check if on iOS Safari
    const checkIOS = () => {
      const userAgent = window.navigator.userAgent.toLowerCase();
      const isIpadOrIphone = /ipad|iphone|ipod/.test(userAgent) && !(window as any).MSStream;
      setIsIOS(isIpadOrIphone);
      return isIpadOrIphone;
    };

    const ios = checkIOS();

    // 3. Handle Chrome/Android beforeinstallprompt event
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e);

      // Only show if not dismissed in the last 3 days
      const dismissedUntil = localStorage.getItem("pwa_prompt_dismissed_until");
      const isDismissed = dismissedUntil && Number(dismissedUntil) > Date.now();

      if (!isDismissed && !isStandaloneMode) {
        // Show after a brief delay for smoother page loading
        const timer = setTimeout(() => {
          setShowPrompt(true);
        }, 3000);
        return () => clearTimeout(timer);
      }
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // 4. For iOS, if they haven't installed and haven't dismissed, show after 4 seconds
    if (ios && !isStandaloneMode) {
      const dismissedUntil = localStorage.getItem("pwa_prompt_dismissed_until");
      const isDismissed = dismissedUntil && Number(dismissedUntil) > Date.now();

      if (!isDismissed) {
        const timer = setTimeout(() => {
          setShowPrompt(true);
        }, 4000);
        return () => clearTimeout(timer);
      }
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (isIOS) {
      return;
    }

    if (!deferredPrompt) return;

    // Show the browser's install prompt
    deferredPrompt.prompt();

    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to install prompt: ${outcome}`);

    // We no longer need the prompt, clear it
    setDeferredPrompt(null);
    setShowPrompt(false);
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    // Dismiss for 3 days
    const nextShowTime = Date.now() + 3 * 24 * 60 * 60 * 1000;
    localStorage.setItem("pwa_prompt_dismissed_until", String(nextShowTime));
  };

  if (!showPrompt || isStandalone) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 md:bottom-6 md:right-6 md:left-auto md:w-96 z-50 animate-fade-in">
      <div className="bg-white/90 backdrop-blur-md border border-slate-200/60 rounded-3xl p-5 shadow-2xl shadow-slate-200/40 relative">
        {/* Close button */}
        <button
          onClick={handleDismiss}
          className="absolute top-4.5 right-4.5 p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition duration-200 cursor-pointer"
          aria-label="Tutup"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Content */}
        <div className="flex gap-4 items-start pr-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-emerald-400 flex items-center justify-center shadow-md shadow-emerald-100 shrink-0">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-black text-slate-800 tracking-tight">
              Pasang KasirPintar<span className="text-emerald-600">AI</span>
            </h3>
            <p className="text-xs text-slate-500 font-medium leading-relaxed">
              Gunakan asisten suara pintar untuk memilih produk, kelola keranjang belanja, hingga pembayaran otomatis langsung dari layar utama Anda.
            </p>
          </div>
        </div>

        {/* Dynamic section: Android/Chrome vs iOS Safari instructions */}
        {isIOS ? (
          <div className="mt-4 pt-3.5 border-t border-slate-100 space-y-2 text-xs text-slate-650 font-medium">
            <p className="font-bold text-slate-850">Langkah instalasi iOS Safari:</p>
            <ol className="list-decimal pl-4.5 space-y-1.5 leading-relaxed">
              <li>
                Ketuk tombol Bagikan <Share2 className="inline-block w-3.5 h-3.5 mx-0.5 text-slate-500" /> (Share) di Safari.
              </li>
              <li>
                Scroll ke bawah lalu pilih <span className="font-bold text-slate-800">Tambahkan ke Layar Utama</span> <Plus className="inline-block w-3.5 h-3.5 mx-0.5 text-slate-500" /> (Add to Home Screen).
              </li>
            </ol>
            <button
              onClick={handleDismiss}
              className="w-full mt-3 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-center text-xs transition cursor-pointer"
            >
              Saya Mengerti
            </button>
          </div>
        ) : (
          <div className="mt-5 flex gap-2.5">
            <button
              onClick={handleDismiss}
              className="flex-1 py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200/60 text-slate-550 font-bold rounded-xl text-xs transition cursor-pointer text-center"
            >
              Nanti Saja
            </button>
            <button
              onClick={handleInstallClick}
              className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition cursor-pointer text-center flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-100"
            >
              <Download className="w-4 h-4" />
              Pasang
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
