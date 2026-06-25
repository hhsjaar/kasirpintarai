// src/app/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  ShoppingCart, 
  Trash2, 
  User, 
  ShoppingBag,
  ArrowRight,
  CreditCard,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import Script from 'next/script';
import VoiceOrb from '@/components/VoiceOrb';
import Dashboard from '@/components/Dashboard';

interface CartItem {
  id: string;
  name: string;
  sku: string;
  price: number;
  quantity: number;
}

interface ChatLog {
  sender: 'user' | 'ai';
  text: string;
  timestamp: Date;
  products?: any[];
}

export default function Home() {
  const [mode, setMode] = useState<'customer' | 'owner'>('customer');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [chatLogs, setChatLogs] = useState<ChatLog[]>([]);
  const [dashboardRefreshTrigger, setDashboardRefreshTrigger] = useState<number>(0);
  const [mockCheckout, setMockCheckout] = useState<{ invoiceNumber: string; totalAmount: number; token: string } | null>(null);
  
  // Checkout Modal State
  const [showCheckoutModal, setShowCheckoutModal] = useState<boolean>(false);
  const [manualPaymentType, setManualPaymentType] = useState<'MIDTRANS' | 'KASBON'>('MIDTRANS');
  const [manualBuyerName, setManualBuyerName] = useState<string>('');
  const [checkoutLoading, setCheckoutLoading] = useState<boolean>(false);

  // Ref to automatically scroll the chat container to bottom
  const chatEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatLogs]);

  // Toast notifications
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'alert' } | null>(null);

  // Speech triggers state to communicate with VoiceOrb
  const [voiceCommandToSpeak, setVoiceCommandToSpeak] = useState<{ text: string; timestamp: number } | undefined>(undefined);

  const triggerToast = (message: string, type: 'success' | 'alert' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4500);
  };

  const confirmMockPayment = async (invoiceNumber: string) => {
    try {
      const res = await fetch('/api/transactions/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: invoiceNumber,
          transaction_status: 'settlement',
          payment_type: 'qris_simulated'
        })
      });
      if (res.ok) {
        triggerToast('Pembayaran berhasil dikonfirmasi!', 'success');
        setCart([]);
        setDashboardRefreshTrigger((prev) => prev + 1);
        handleTranscriptReceived("", "Pembayaran berhasil dikonfirmasi! Terima kasih telah berbelanja di Kasir Pintar.");
        setVoiceCommandToSpeak({
          text: "Pembayaran berhasil dikonfirmasi! Terima kasih telah berbelanja di Kasir Pintar.",
          timestamp: Date.now()
        });
      } else {
        triggerToast('Simulasi pembayaran gagal.', 'alert');
      }
    } catch (err) {
      triggerToast('Terjadi kesalahan koneksi.', 'alert');
    } finally {
      setMockCheckout(null);
    }
  };

  const cancelMockPayment = () => {
    triggerToast('Pembayaran dibatalkan.', 'alert');
    setMockCheckout(null);
    handleTranscriptReceived("", "Pembayaran dibatalkan.");
    setVoiceCommandToSpeak({
      text: "Pembayaran dibatalkan.",
      timestamp: Date.now()
    });
  };

  // Launch Midtrans Snap Payment Popup
  const handleMidtransPay = (token: string) => {
    if (token && token.startsWith('mock')) {
      const invoiceNumber = token.replace('mock-', '');
      setMockCheckout({
        invoiceNumber,
        totalAmount: cartTotal,
        token
      });
      return;
    }

    if (typeof window !== 'undefined' && (window as any).snap) {
      (window as any).snap.pay(token, {
        onSuccess: function (result: any) {
          console.log('Midtrans Payment Success:', result);
          triggerToast('Pembayaran berhasil dikonfirmasi!', 'success');
          setCart([]); // Clear cart
          setDashboardRefreshTrigger((prev) => prev + 1); // Refresh dashboard metrics
        },
        onPending: function (result: any) {
          console.log('Midtrans Payment Pending:', result);
          triggerToast('Pembayaran tertunda. Harap selesaikan pembayaran.', 'alert');
          setCart([]); // Clear cart
          setDashboardRefreshTrigger((prev) => prev + 1);
        },
        onError: function (result: any) {
          console.error('Midtrans Payment Error:', result);
          triggerToast('Pembayaran gagal atau dibatalkan.', 'alert');
        },
        onClose: function () {
          console.log('Midtrans Snap payment popup closed');
        }
      });
    } else {
      triggerToast('Gagal memuat Midtrans Snap SDK. Silakan muat ulang halaman.', 'alert');
    }
  };

  // Callback when AI Voice Orb triggers an action
  const handleActionTriggered = (actionType: string, payload: any) => {
    console.log(`Action Triggered: ${actionType}`, payload);
    
    switch (actionType) {
      case 'ADD_TO_CART': {
        const { product, quantity } = payload;
        setCart((prevCart) => {
          const existing = prevCart.find((item) => item.sku === product.sku);
          if (existing) {
            return prevCart.map((item) =>
              item.sku === product.sku
                ? { ...item, quantity: item.quantity + quantity }
                : item
            );
          } else {
            return [
              ...prevCart,
              {
                id: product.id,
                name: product.name,
                sku: product.sku,
                price: product.price,
                quantity,
              },
            ];
          }
        });
        triggerToast(`Ditambahkan ke keranjang: ${quantity}x ${product.name}`);
        break;
      }

      case 'REMOVE_FROM_CART': {
        const { productId } = payload;
        setCart((prevCart) => prevCart.filter((item) => item.id !== productId));
        triggerToast('Produk dihapus dari keranjang', 'alert');
        break;
      }

      case 'CLEAR_CART': {
        setCart([]);
        triggerToast('Keranjang belanja dikosongkan.');
        break;
      }

      case 'INITIATE_CHECKOUT': {
        const { token } = payload;
        if (token) {
          handleMidtransPay(token);
        } else {
          triggerToast('Transaksi gagal: Token Midtrans tidak ditemukan.', 'alert');
        }
        break;
      }

      case 'KASBON_CHECKOUT_SUCCESS': {
        const { totalAmount, buyerName } = payload;
        setCart([]);
        triggerToast(`Kasbon dicatat: Rp ${totalAmount.toLocaleString('id-ID')} atas nama ${buyerName}`, 'success');
        setDashboardRefreshTrigger((prev) => prev + 1);
        break;
      }

      case 'CONFIRM_MOCK_PAYMENT': {
        if (mockCheckout) {
          confirmMockPayment(mockCheckout.invoiceNumber);
        }
        break;
      }

      case 'CANCEL_MOCK_PAYMENT': {
        cancelMockPayment();
        break;
      }

      case 'UPDATE_DATABASE':
      case 'REFRESH_METRICS': {
        setDashboardRefreshTrigger((prev) => prev + 1);
        break;
      }

      default:
        break;
    }
  };

  const handleTranscriptReceived = (userText: string, aiText: string, products?: any[]) => {
    setChatLogs((prev) => [
      ...prev,
      { sender: 'user', text: userText, timestamp: new Date() },
      { sender: 'ai', text: aiText, timestamp: new Date(), products },
    ]);
  };

  const handleManualRemoveItem = (itemId: string) => {
    setCart((prevCart) => prevCart.filter((item) => item.id !== itemId));
    triggerToast('Produk dihapus dari keranjang', 'alert');
  };

  const handleManualClearCart = () => {
    setCart([]);
    triggerToast('Keranjang belanja dikosongkan.');
  };

  // Manual checkout button click
  const handleCheckoutBtnClick = () => {
    if (cart.length === 0) return;
    setManualPaymentType('MIDTRANS');
    setManualBuyerName('');
    setShowCheckoutModal(true);
  };

  const handleManualCheckoutConfirm = async () => {
    if (cart.length === 0) return;
    if (manualPaymentType === 'KASBON' && !manualBuyerName.trim()) {
      triggerToast('Nama pembeli wajib diisi untuk Kasbon', 'alert');
      return;
    }

    setCheckoutLoading(true);
    try {
      const res = await fetch('/api/transactions/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map(c => ({ sku: c.sku, quantity: c.quantity })),
          paymentType: manualPaymentType,
          buyerName: manualBuyerName
        })
      });
      const data = await res.json();
      
      if (data.success) {
        setShowCheckoutModal(false);
        if (manualPaymentType === 'KASBON') {
          setCart([]);
          setManualBuyerName('');
          triggerToast(`Kasbon berhasil dicatat atas nama ${data.buyerName || manualBuyerName}`, 'success');
          setDashboardRefreshTrigger((prev) => prev + 1);
          handleTranscriptReceived("", `Transaksi Kasbon berhasil dicatat atas nama "${data.buyerName || manualBuyerName}" sebesar Rp ${data.totalAmount.toLocaleString('id-ID')}.`);
          setVoiceCommandToSpeak({
            text: `Kasbon berhasil dicatat atas nama ${data.buyerName || manualBuyerName} sebesar ${data.totalAmount} rupiah.`,
            timestamp: Date.now()
          });
        } else {
          handleMidtransPay(data.token);
        }
      } else {
        triggerToast(data.error || 'Gagal memproses checkout.', 'alert');
      }
    } catch (err: any) {
      triggerToast(err.message, 'alert');
    } finally {
      setCheckoutLoading(false);
    }
  };

  const cartTotal = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-emerald-500/20 selection:text-emerald-700">
      
      {/* Midtrans Snap Script loader */}
      <Script
        src="https://app.sandbox.midtrans.com/snap/snap.js"
        data-client-key={process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY}
        strategy="lazyOnload"
      />

      {/* Toast Notification Container */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 animate-bounce">
          <div className={`px-4.5 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-sm font-bold border ${
            toast.type === 'success' 
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
              : 'bg-red-50 border-red-200 text-red-800'
          }`}>
            {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-red-650" />}
            {toast.message}
          </div>
        </div>
      )}

      {/* Header bar */}
      <header className="border-b border-slate-200/60 bg-white/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 sm:py-0 sm:h-16 flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-0">
          
          {/* Logo */}
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-emerald-400 flex items-center justify-center shadow-md shadow-emerald-200/30">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-extrabold text-sm tracking-tight text-slate-800 block">KasirPintar<span className="text-emerald-600">AI</span></span>
              <span className="text-3xs text-slate-400 tracking-wider uppercase font-bold block">Voice Assistant POS</span>
            </div>
          </div>

          {/* Mode Switcher Pill */}
          <div className="bg-slate-100 p-1.5 rounded-xl border border-slate-200/60 flex space-x-1 text-xs">
            <button
              onClick={() => setMode('customer')}
              className={`px-4 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition cursor-pointer ${
                mode === 'customer'
                  ? 'bg-white text-slate-800 border border-slate-200/50 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>Customer<span className="hidden sm:inline"> POS</span></span>
            </button>
            <button
              onClick={() => setMode('owner')}
              className={`px-4 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition cursor-pointer ${
                mode === 'owner'
                  ? 'bg-white text-slate-800 border border-slate-200/50 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>Owner<span className="hidden sm:inline"> Dashboard</span></span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-4 py-8 flex flex-col">
        {mode === 'customer' ? (
          
          /* =======================================
              CUSTOMER VOICE MODE (MAIN POS VIEW)
             ======================================= */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 flex-1 items-start">
            
            {/* Left Col: AI Orb and Speech Interactions */}
            <div className="lg:col-span-2 flex flex-col justify-between space-y-6 lg:space-y-8 lg:h-full lg:min-h-[580px]">
              
              {/* Voice Orb Area */}
              <div className="flex-1 flex flex-col justify-center items-center py-6 glass-panel rounded-3xl relative overflow-hidden bg-white/70 min-h-[360px] lg:min-h-0">
                {/* Visual mesh bg */}
                <div className="absolute inset-0 bg-radial-gradient from-emerald-500/3 to-transparent pointer-events-none" />
                
                <VoiceOrb
                  mode="customer"
                  cartItems={cart.map((item) => ({ sku: item.sku, quantity: item.quantity }))}
                  onActionTriggered={handleActionTriggered}
                  onTranscriptReceived={handleTranscriptReceived}
                  mockCheckoutActive={!!mockCheckout}
                  voiceCommandToSpeak={voiceCommandToSpeak}
                  chatLogs={chatLogs}
                />
              </div>

              {/* Chat Log/History Area */}
              <div className="glass-panel p-5 rounded-3xl space-y-4 bg-white/70">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Log Percakapan AI</h2>
                <div className="space-y-3 max-h-96 overflow-y-auto pr-2 text-sm">
                  {chatLogs.length === 0 ? (
                    <div className="text-slate-400 text-xs py-4 text-center">
                      Belum ada interaksi suara. Silakan tekan tombol mic di atas dan mulai berbicara.
                    </div>
                  ) : (
                    chatLogs.map((log, index) => (
                      <div
                        key={index}
                        className={`p-3.5 rounded-2xl leading-relaxed max-w-[85%] font-medium ${
                          log.sender === 'user'
                            ? 'bg-slate-100 text-slate-800 ml-auto border border-slate-200/60'
                            : 'bg-emerald-50 text-emerald-800 border border-emerald-100/70'
                        }`}
                      >
                        <span className={`text-3xs font-black tracking-wider uppercase block mb-1 ${
                          log.sender === 'user' ? 'text-slate-450' : 'text-emerald-605'
                        }`}>
                          {log.sender === 'user' ? 'Pelanggan' : 'AI Kasir'}
                        </span>
                        <p className={log.sender === 'ai' && log.products && log.products.length > 0 ? "mb-2.5 font-bold" : ""}>{log.text}</p>
                        
                        {/* Interactive Product List if AI returns a list of items */}
                        {log.sender === 'ai' && log.products && log.products.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3.5">
                            {log.products.map((prod: any) => {
                              const isLow = prod.stock <= prod.minStock;
                              const isOut = prod.stock === 0;
                              return (
                                <div
                                  key={prod.id}
                                  className="p-3 bg-white border border-slate-200/60 hover:border-emerald-300 rounded-2xl flex flex-col justify-between shadow-sm transition duration-300 gap-2.5"
                                >
                                  <div className="min-w-0">
                                    <span className="font-bold text-slate-800 text-xs block truncate" title={prod.name}>
                                      {prod.name}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-mono block">
                                      {prod.sku}
                                    </span>
                                  </div>

                                  <div className="flex items-center justify-between gap-1.5">
                                    <span className="text-emerald-600 font-extrabold text-xs">
                                      Rp {prod.price.toLocaleString('id-ID')}
                                    </span>
                                    
                                    {isOut ? (
                                      <span className="px-1.5 py-0.5 bg-red-50 text-red-600 border border-red-150/30 rounded text-[9px] font-black uppercase">
                                        Habis
                                      </span>
                                    ) : isLow ? (
                                      <span className="px-1.5 py-0.5 bg-amber-50 text-amber-600 border border-amber-150/30 rounded text-[9px] font-black uppercase animate-pulse">
                                        Menipis
                                      </span>
                                    ) : (
                                      <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-150/30 rounded text-[9px] font-black uppercase">
                                        Stok: {prod.stock}
                                      </span>
                                    )}
                                  </div>

                                  <button
                                    onClick={() => handleActionTriggered('ADD_TO_CART', { product: prod, quantity: 1 })}
                                    disabled={isOut}
                                    className="w-full py-1.5 bg-emerald-50 hover:bg-emerald-500 hover:text-white disabled:bg-slate-50 disabled:text-slate-350 disabled:cursor-not-allowed border border-emerald-200/60 disabled:border-slate-150 text-emerald-700 font-bold rounded-xl text-[10px] flex items-center justify-center gap-1 transition cursor-pointer"
                                  >
                                    <ShoppingCart className="w-3.5 h-3.5" />
                                    Tambah
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                  <div ref={chatEndRef} />
                </div>
              </div>
            </div>

            {/* Right Col: POS Shopping Cart */}
            <div className="glass-panel p-5 sm:p-6 rounded-3xl flex flex-col lg:h-full lg:min-h-[580px] justify-between lg:sticky lg:top-24 bg-white min-h-[350px] lg:min-h-0">
              <div className="space-y-6 flex-1 flex flex-col justify-between">
                
                {/* Cart Header */}
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-2 text-slate-800">
                    <ShoppingCart className="w-5 h-5 text-emerald-600" />
                    <h2 className="font-bold text-base tracking-tight">Keranjang Belanja</h2>
                  </div>
                  {cart.length > 0 && (
                    <button
                      onClick={handleManualClearCart}
                      className="text-slate-400 hover:text-red-500 transition cursor-pointer"
                      title="Kosongkan Keranjang"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Cart Items list */}
                <div className="flex-1 overflow-y-auto max-h-[300px] space-y-4 my-4 pr-1">
                  {cart.length === 0 ? (
                    <div className="h-full flex flex-col justify-center items-center text-slate-400 text-center space-y-2 py-12">
                      <ShoppingBag className="w-10 h-10 text-slate-350 animate-pulse" />
                      <p className="text-xs">Keranjang Anda kosong.<br />Katakan &ldquo;Beli 2 Indomie&rdquo; atau tambah item.</p>
                    </div>
                  ) : (
                    cart.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200/70 text-sm animate-fade-in"
                      >
                        <div className="min-w-0">
                          <h4 className="font-bold text-slate-800 truncate">{item.name}</h4>
                          <span className="text-xs text-slate-400 font-mono font-medium">{item.sku} &bull; Rp {item.price.toLocaleString('id-ID')}</span>
                        </div>
                        <div className="flex items-center space-x-3.5">
                          <span className="text-slate-650 font-extrabold bg-slate-200/70 px-2 py-0.5 rounded text-xs">{item.quantity}x</span>
                          <span className="text-slate-800 font-extrabold">Rp {(item.price * item.quantity).toLocaleString('id-ID')}</span>
                          <button
                            onClick={() => handleManualRemoveItem(item.id)}
                            className="text-slate-400 hover:text-red-500 transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Subtotals & Payment action */}
                <div className="pt-4 border-t border-slate-100 space-y-4">
                  <div className="space-y-1.5 text-xs text-slate-500 font-medium">
                    <div className="flex justify-between">
                      <span>Pajak (PPN 11%)</span>
                      <span>Include</span>
                    </div>
                    <div className="flex justify-between text-slate-800 font-extrabold text-sm">
                      <span>Total Bayar</span>
                      <span className="text-emerald-600 font-black text-base">Rp {cartTotal.toLocaleString('id-ID')}</span>
                    </div>
                  </div>

                  <button
                    onClick={handleCheckoutBtnClick}
                    disabled={cart.length === 0}
                    className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-bold rounded-xl flex items-center justify-center gap-1.5 transition shadow-lg shadow-emerald-100 cursor-pointer"
                  >
                    Proses Bayar (Checkout)
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

          </div>
        ) : (
          
          /* =======================================
              OWNER MODE (ANALYTICS & MANAGEMENT)
             ======================================= */
          <div className="space-y-8">
            {/* Small Floating Voice Orb to allow Owner to speak orders while in dashboard */}
            <div className="glass-panel p-4 rounded-3xl flex flex-col md:flex-row items-center justify-between border border-emerald-250 bg-emerald-50/15 gap-4 shadow-sm shadow-emerald-50">
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse animate-ping" />
                <div className="text-xs">
                  <span className="font-bold text-slate-800">Asisten Suara Owner Aktif.</span>
                  <p className="text-slate-500 mt-0.5">Katakan &ldquo;Ubah harga Indomie ke 4000&rdquo;, &ldquo;Tambah stok Aqua 50&rdquo;, atau &ldquo;Berapa omset hari ini?&rdquo;</p>
                </div>
              </div>
              <div className="shrink-0 w-full md:w-auto flex justify-center md:justify-end">
                <VoiceOrb
                  mode="owner"
                  cartItems={[]}
                  onActionTriggered={handleActionTriggered}
                  onTranscriptReceived={handleTranscriptReceived}
                  compact={true}
                  chatLogs={chatLogs}
                />
              </div>
            </div>

            <Dashboard
              refreshTrigger={dashboardRefreshTrigger}
              onRefreshCompleted={() => {}}
            />
          </div>
        )}
      </div>

      {/* Manual Payment/Checkout Modal */}
      {showCheckoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-sm bg-white border border-slate-200 rounded-3xl p-6 shadow-2xl space-y-5 text-center">
            <div>
              <span className="text-xs bg-emerald-50 text-emerald-600 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider">
                Pembayaran Toko
              </span>
              <h3 className="text-lg font-bold text-slate-800 mt-2">Pilih Metode Pembayaran</h3>
              <p className="text-slate-500 text-xs mt-1">Total: <span className="font-extrabold text-emerald-650">Rp {cartTotal.toLocaleString('id-ID')}</span></p>
            </div>

            {/* Selection */}
            <div className="grid grid-cols-2 gap-3.5">
              <button
                type="button"
                onClick={() => setManualPaymentType('MIDTRANS')}
                className={`p-4 rounded-2xl border text-center transition cursor-pointer flex flex-col items-center justify-center gap-2 ${
                  manualPaymentType === 'MIDTRANS'
                    ? 'border-emerald-500 bg-emerald-50/10 text-slate-850 shadow-sm'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                <CreditCard className="w-5.5 h-5.5 text-emerald-650" />
                <span className="text-[11px] font-bold">QRIS / Midtrans</span>
              </button>

              <button
                type="button"
                onClick={() => setManualPaymentType('KASBON')}
                className={`p-4 rounded-2xl border text-center transition cursor-pointer flex flex-col items-center justify-center gap-2 ${
                  manualPaymentType === 'KASBON'
                    ? 'border-emerald-500 bg-emerald-50/10 text-slate-850 shadow-sm'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                <User className="w-5.5 h-5.5 text-emerald-600" />
                <span className="text-[11px] font-bold">Kasbon Pembeli</span>
              </button>
            </div>

            {/* Input name for Kasbon */}
            {manualPaymentType === 'KASBON' && (
              <div className="space-y-1 text-left animate-fade-in">
                <label className="text-slate-500 text-3xs font-black uppercase tracking-wider block">Nama Pembeli</label>
                <input
                  type="text"
                  placeholder="Masukkan nama pembeli..."
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 font-bold focus:outline-none focus:ring-2 focus:ring-emerald-450 focus:border-transparent text-sm"
                  value={manualBuyerName}
                  onChange={(e) => setManualBuyerName(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-2 pt-2">
              <button
                onClick={handleManualCheckoutConfirm}
                disabled={checkoutLoading || (manualPaymentType === 'KASBON' && !manualBuyerName.trim())}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition shadow-lg cursor-pointer text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {checkoutLoading ? 'Memproses...' : 'Konfirmasi Pembayaran'}
              </button>
              
              <button
                onClick={() => setShowCheckoutModal(false)}
                disabled={checkoutLoading}
                className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-500 font-bold rounded-xl transition text-xs cursor-pointer"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mock Payment Simulation Modal */}
      {mockCheckout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-sm bg-white border border-slate-200 rounded-3xl p-6 shadow-2xl space-y-5 text-center">
            <div>
              <span className="text-xs bg-emerald-50 text-emerald-600 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider">
                Simulasi QRIS POS
              </span>
              <h3 className="text-lg font-bold text-slate-800 mt-2">Selesaikan Pembayaran</h3>
              <p className="text-slate-400 text-xs mt-1">Invoice: <span className="font-mono font-bold text-slate-700">{mockCheckout.invoiceNumber}</span></p>
            </div>

            {/* Simulated QR Code */}
            <div className="bg-slate-50 p-4 rounded-2xl flex flex-col items-center justify-center border border-slate-100">
              <div className="w-40 h-40 bg-white border border-slate-200 rounded-xl flex items-center justify-center p-2 relative">
                {/* Fake QR code SVG */}
                <svg className="w-full h-full text-slate-800" viewBox="0 0 100 100">
                  <path fill="currentColor" d="M10,10 h30 v30 h-30 z M20,20 h10 v10 h-10 z M60,10 h30 v30 h-30 z M70,20 h10 v10 h-10 z M10,60 h30 v30 h-30 z M20,70 h10 v10 h-10 z M60,60 h10 v10 h-10 z M80,60 h10 v30 h-10 z M60,80 h20 v10 h-20 z M80,70 h10 v10 h-10 z M70,70 h10 v10 h-10 z" />
                </svg>
              </div>
              <span className="text-emerald-600 font-extrabold text-base mt-3.5">
                Rp {mockCheckout.totalAmount.toLocaleString('id-ID')}
              </span>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => confirmMockPayment(mockCheckout.invoiceNumber)}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition shadow-lg cursor-pointer text-sm"
              >
                Bayar Sukses (Simulasi)
              </button>
              
              <button
                onClick={cancelMockPayment}
                className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-500 font-bold rounded-xl transition text-xs cursor-pointer"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer bar */}
      <footer className="border-t border-slate-200 py-6 bg-white/50 mt-auto">
        <div className="max-w-7xl mx-auto px-4 text-center text-slate-400 text-xs flex items-center justify-center gap-1.5">
          <CreditCard className="w-3.5 h-3.5 text-emerald-600" />
          <span>KasirPintarAI &copy; 2026. Made with premium design aesthetics. Powered by Next.js, Neon & Midtrans.</span>
        </div>
      </footer>
    </main>
  );
}
