// src/components/Dashboard.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  Package, 
  ShoppingCart, 
  AlertTriangle, 
  RefreshCw, 
  ArrowUpRight, 
  ClipboardList,
  Plus,
  CheckCircle,
  Truck,
  Bell,
  BellOff,
  Zap,
  Activity
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer,
  CartesianGrid
} from 'recharts';

interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  stock: number;
  minStock: number;
  category?: { name: string } | null;
  supplier?: { name: string } | null;
}

interface TransactionItem {
  product: { name: string };
  quantity: number;
  priceAtPurchase: number;
}

interface Transaction {
  id: string;
  invoiceNumber: string;
  totalAmount: number;
  paymentStatus: string;
  paymentType: string;
  createdAt: string;
  items: TransactionItem[];
}

interface Notification {
  id: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string;
}

interface DashboardProps {
  refreshTrigger: number;
  onRefreshCompleted: () => void;
}

// Helper for converting VAPID key
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function Dashboard({ refreshTrigger, onRefreshCompleted }: DashboardProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  
  // VAPID Web Push subscription states
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);
  const [subscribing, setSubscribing] = useState<boolean>(false);
  const [pushSupported, setPushSupported] = useState<boolean>(false);

  // Modal for adding product
  const [showAddProductModal, setShowAddProductModal] = useState<boolean>(false);
  const [newProduct, setNewProduct] = useState({
    name: '', sku: '', price: '', stock: '', minStock: '5'
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [resProd, resTxn, resNotif] = await Promise.all([
        fetch('/api/products'),
        fetch('/api/transactions'),
        fetch('/api/notifications')
      ]);

      const dataProd = await resProd.json();
      const dataTxn = await resTxn.json();
      const dataNotif = await resNotif.json();

      setProducts(dataProd);
      setTransactions(dataTxn);
      setNotifications(dataNotif);
      
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
      onRefreshCompleted();
    }
  };

  useEffect(() => {
    fetchData();
  }, [refreshTrigger]);

  // Check subscription on mount
  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      setPushSupported(true);
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          setIsSubscribed(!!sub);
        });
      });
    }
  }, []);

  const handleSubscribePush = async () => {
    if (!pushSupported) return;
    setSubscribing(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        alert('Izin notifikasi ditolak oleh pengguna.');
        setSubscribing(false);
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      
      if (!vapidPublicKey) {
        alert('VAPID Public Key tidak terkonfigurasi di environment client.');
        setSubscribing(false);
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });

      const res = await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription })
      });

      if (res.ok) {
        setIsSubscribed(true);
      } else {
        alert('Gagal mengirim data subscription ke server.');
      }
    } catch (err: any) {
      console.error('Failed to subscribe to Web Push:', err);
      alert('Error saat mengaktifkan push: ' + err.message);
    } finally {
      setSubscribing(false);
    }
  };

  const handleUnsubscribePush = async () => {
    if (!pushSupported) return;
    setSubscribing(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        setIsSubscribed(false);
      }
    } catch (err: any) {
      console.error('Failed to unsubscribe:', err);
    } finally {
      setSubscribing(false);
    }
  };

  const handleTestPushNotification = async () => {
    try {
      const res = await fetch('/api/notifications/test', {
        method: 'POST'
      });
      if (!res.ok) {
        alert('Gagal memicu notifikasi uji coba.');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSimulateWebhook = async (invoiceNumber: string) => {
    try {
      const res = await fetch('/api/transactions/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: invoiceNumber,
          transaction_status: 'settlement',
          payment_type: 'gopay'
        })
      });
      
      if (res.ok) {
        fetchData();
      } else {
        alert('Gagal memproses simulasi pembayaran webhook.');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationId: 'all' })
      });
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProduct)
      });
      if (res.ok) {
        setShowAddProductModal(false);
        setNewProduct({ name: '', sku: '', price: '', stock: '', minStock: '5' });
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Metrics calculations
  const totalRevenue = transactions
    .filter(t => t.paymentStatus === 'PAID')
    .reduce((acc, t) => acc + t.totalAmount, 0);

  const pendingRevenue = transactions
    .filter(t => t.paymentStatus === 'PENDING')
    .reduce((acc, t) => acc + t.totalAmount, 0);

  const paidTransactions = transactions.filter(t => t.paymentStatus === 'PAID');
  const totalSalesCount = paidTransactions.length;
  
  const lowStockProducts = products.filter(p => p.stock <= p.minStock);
  const lowStockCount = lowStockProducts.length;

  // Prepare chart data (past transactions)
  const chartData = [...transactions]
    .reverse()
    .filter(t => t.paymentStatus === 'PAID')
    .slice(-10)
    .map(t => ({
      date: new Date(t.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
      omzet: t.totalAmount,
    }));

  const displayChartData = chartData.length > 0 ? chartData : [
    { date: '10:00', omzet: 35000 },
    { date: '11:00', omzet: 50000 },
    { date: '12:00', omzet: 120000 },
    { date: '13:00', omzet: 80000 },
    { date: '14:00', omzet: 150000 },
    { date: '15:00', omzet: 110000 },
  ];

  return (
    <div className="space-y-8 pb-16">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">Owner Dashboard & Warehouse</h1>
          <p className="text-slate-500 text-sm">Kelola inventori, pantau omzet penjualan, dan kelola push notification.</p>
        </div>
        
        <div className="flex gap-2.5">
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-semibold transition cursor-pointer shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          
          <button
            onClick={() => setShowAddProductModal(true)}
            className="flex items-center gap-1.5 px-4.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold transition cursor-pointer shadow-md shadow-emerald-100"
          >
            <Plus className="w-4 h-4" />
            Tambah Produk
          </button>
        </div>
      </div>

      {/* Web Push Configuration Panel */}
      <div className="glass-panel p-5 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4 border-l-4 border-l-emerald-500 bg-emerald-50/20">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl ${isSubscribed ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-200 text-slate-400'}`}>
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">System Web Push Notification</h3>
            <p className="text-slate-500 text-xs mt-0.5">
              {isSubscribed 
                ? 'Browser Anda sudah berlangganan notifikasi push VAPID untuk asisten gudang.' 
                : 'Aktifkan notifikasi browser untuk menerima peringatan otomatis ketika stok barang menipis.'}
            </p>
          </div>
        </div>
        <div className="flex gap-2.5 shrink-0 w-full md:w-auto justify-end">
          {isSubscribed ? (
            <>
              <button
                onClick={handleTestPushNotification}
                className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer shadow-sm"
              >
                Uji Notifikasi
              </button>
              <button
                onClick={handleUnsubscribePush}
                disabled={subscribing}
                className="flex items-center gap-1 px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-xs font-bold rounded-xl transition cursor-pointer disabled:opacity-50"
              >
                <BellOff className="w-3.5 h-3.5" />
                Matikan Notifikasi
              </button>
            </>
          ) : (
            <button
              onClick={handleSubscribePush}
              disabled={subscribing || !pushSupported}
              className="flex items-center gap-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition cursor-pointer disabled:opacity-50"
            >
              <Bell className="w-3.5 h-3.5" />
              Aktifkan Notifikasi
            </button>
          )}
        </div>
      </div>

      {/* KPI Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Card 1: Revenue */}
        <div className="bg-white border border-slate-100 border-l-4 border-l-emerald-500 p-5 rounded-2xl flex flex-col justify-between h-32 hover:scale-[1.02] transition-transform duration-300 shadow-sm shadow-slate-100/50">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Pendapatan</span>
            <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div>
            <h3 className="text-xl font-extrabold text-slate-800">Rp {totalRevenue.toLocaleString('id-ID')}</h3>
            <p className="text-slate-400 text-2xs flex items-center gap-1 mt-1">
              <span className="text-emerald-600 font-bold flex items-center">
                <ArrowUpRight className="w-3 h-3" /> +12.5%
              </span>
              dari kemarin
            </p>
          </div>
        </div>

        {/* Card 2: Sales volume */}
        <div className="bg-white border border-slate-100 border-l-4 border-l-indigo-500 p-5 rounded-2xl flex flex-col justify-between h-32 hover:scale-[1.02] transition-transform duration-300 shadow-sm shadow-slate-100/50">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Penjualan</span>
            <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
              <ShoppingCart className="w-4 h-4" />
            </div>
          </div>
          <div>
            <h3 className="text-xl font-extrabold text-slate-800">{totalSalesCount} Transaksi</h3>
            <p className="text-slate-400 text-2xs flex items-center gap-1 mt-1">
              Pending: Rp {pendingRevenue.toLocaleString('id-ID')}
            </p>
          </div>
        </div>

        {/* Card 3: Catalog products */}
        <div className="bg-white border border-slate-100 border-l-4 border-l-blue-500 p-5 rounded-2xl flex flex-col justify-between h-32 hover:scale-[1.02] transition-transform duration-300 shadow-sm shadow-slate-100/50">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Katalog Produk</span>
            <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div>
            <h3 className="text-xl font-extrabold text-slate-800">{products.length} Barang</h3>
            <p className="text-slate-400 text-2xs mt-1">
              Toko Kelontong / Kelola Stok
            </p>
          </div>
        </div>

        {/* Card 4: Low stock alerts */}
        <div className="bg-white border border-slate-100 border-l-4 border-l-amber-500 p-5 rounded-2xl flex flex-col justify-between h-32 hover:scale-[1.02] transition-transform duration-300 shadow-sm shadow-slate-100/50">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Stok Menipis</span>
            <div className={`p-2 rounded-lg ${lowStockCount > 0 ? 'bg-amber-50 text-amber-600 animate-pulse' : 'bg-slate-100 text-slate-400'}`}>
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div>
            <h3 className={`text-xl font-extrabold ${lowStockCount > 0 ? 'text-amber-600' : 'text-slate-800'}`}>
              {lowStockCount} Peringatan
            </h3>
            <p className="text-slate-400 text-2xs mt-1">
              {lowStockCount > 0 ? 'Segera restock produk berikut!' : 'Semua produk aman'}
            </p>
          </div>
        </div>
      </div>

      {/* Main dashboard content sections */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Chart section */}
        <div className="glass-panel p-5 rounded-2xl lg:col-span-2 space-y-4 bg-white border border-slate-150">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Grafik Pendapatan</h3>
            <span className="text-3xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-md font-black uppercase tracking-widest flex items-center gap-1">
              <Activity className="w-3 h-3 animate-pulse" /> Live Updates
            </span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={displayChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorOmzet" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
                  labelStyle={{ color: '#64748b', fontSize: '12px', fontWeight: 'bold' }}
                  itemStyle={{ color: '#0f172a', fontSize: '12px' }}
                />
                <Area type="monotone" dataKey="omzet" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorOmzet)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Notifications & System Alerts */}
        <div className="glass-panel p-5 rounded-2xl flex flex-col justify-between bg-white border border-slate-150">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <ClipboardList className="w-4 h-4 text-slate-400" />
                Alerts & Notifikasi
              </h3>
              {notifications.some(n => !n.isRead) && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-2xs text-emerald-600 hover:text-emerald-500 font-bold cursor-pointer"
                >
                  Tandai Dibaca
                </button>
              )}
            </div>
            
            <div className="space-y-2.5 overflow-y-auto max-h-60 pr-1">
              {notifications.length === 0 ? (
                <div className="text-center py-8 text-slate-400 space-y-1">
                  <CheckCircle className="w-8 h-8 mx-auto text-slate-300" />
                  <p className="text-xs">Tidak ada notifikasi aktif</p>
                </div>
              ) : (
                notifications.map((notif) => (
                  <div
                    key={notif.id}
                    className={`p-3 rounded-xl border transition text-xs flex gap-2.5 items-start ${
                      notif.isRead 
                        ? 'bg-slate-50/70 border-slate-200/50 text-slate-500' 
                        : 'bg-amber-50 border-amber-200 text-slate-700'
                    }`}
                  >
                    <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${notif.isRead ? 'text-slate-400' : 'text-amber-500'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="leading-relaxed break-words font-medium">{notif.message}</p>
                      <span className="text-3xs text-slate-400 block mt-1">
                        {new Date(notif.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          
          <div className="pt-4 border-t border-slate-100 text-3xs text-slate-400 text-center flex items-center justify-center gap-1">
            <Truck className="w-3.5 h-3.5 text-emerald-500" />
            Terhubung otomatis ke Neon Postgres & Web Push
          </div>
        </div>
      </div>

      {/* Midtrans Transactions Table */}
      <div className="glass-panel p-5 rounded-2xl space-y-4 bg-white border border-slate-150">
        <div>
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Histori Transaksi Midtrans</h3>
          <p className="text-slate-500 text-xs mt-0.5">Daftar transaksi kasir. Anda bisa menyetujui pembayaran secara simulasi untuk pengujian lokal.</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-150 text-slate-400 text-xs font-bold uppercase">
                <th className="py-3 px-4">Invoice</th>
                <th className="py-3 px-4">Waktu</th>
                <th className="py-3 px-4">Total Belanja</th>
                <th className="py-3 px-4">Jenis Bayar</th>
                <th className="py-3 px-4">Status Pembayaran</th>
                <th className="py-3 px-4 text-center">Aksi Simulasi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-6 text-slate-400 text-xs">Belum ada transaksi di database.</td>
                </tr>
              ) : (
                transactions.map((txn) => (
                  <tr key={txn.id} className="hover:bg-slate-50/50 transition text-slate-600">
                    <td className="py-3.5 px-4 font-mono font-bold text-slate-800 text-xs">{txn.invoiceNumber}</td>
                    <td className="py-3.5 px-4 text-xs">
                      {new Date(txn.createdAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-slate-800">Rp {txn.totalAmount.toLocaleString('id-ID')}</td>
                    <td className="py-3.5 px-4"><span className="px-2 py-0.5 bg-slate-50 border border-slate-200 rounded text-3xs uppercase text-slate-500 font-bold">{txn.paymentType || 'MIDTRANS'}</span></td>
                    <td className="py-3.5 px-4">
                      {txn.paymentStatus === 'PAID' ? (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-3xs font-black bg-emerald-50 text-emerald-600 uppercase">
                          Lunas
                        </span>
                      ) : txn.paymentStatus === 'FAILED' ? (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-3xs font-black bg-red-50 text-red-600 uppercase">
                          Gagal
                        </span>
                      ) : (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-3xs font-black bg-amber-50 text-amber-600 uppercase animate-pulse">
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      {txn.paymentStatus === 'PENDING' ? (
                        <button
                          onClick={() => handleSimulateWebhook(txn.invoiceNumber)}
                          className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border border-emerald-200 rounded-lg text-3xs font-black transition cursor-pointer mx-auto shadow-sm"
                          title="Simulasikan pembayaran sukses dari Midtrans"
                        >
                          <Zap className="w-3 h-3 text-emerald-500 animate-bounce" />
                          Bayar Sukses (Simulasi)
                        </button>
                      ) : (
                        <span className="text-slate-400 text-xs">-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Product Table List */}
      <div className="glass-panel p-5 rounded-2xl space-y-4 bg-white border border-slate-150">
        <div>
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Warehouse & Inventori Produk</h3>
          <p className="text-slate-500 text-xs mt-0.5">Pantau jumlah persediaan real-time di Neon DB, batas stok minimum, dan harga jual aktif.</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-150 text-slate-400 text-xs font-bold uppercase">
                <th className="py-3 px-4">Nama Produk</th>
                <th className="py-3 px-4">SKU</th>
                <th className="py-3 px-4">Harga</th>
                <th className="py-3 px-4">Stok GUDANG</th>
                <th className="py-3 px-4">Min. Stok</th>
                <th className="py-3 px-4 text-center">Status Stok</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((prod) => {
                const isLow = prod.stock <= prod.minStock;
                const isOut = prod.stock === 0;
                
                return (
                  <tr key={prod.id} className="hover:bg-slate-50/50 transition text-slate-600">
                    <td className="py-3.5 px-4 font-bold text-slate-800">{prod.name}</td>
                    <td className="py-3.5 px-4 font-mono text-slate-500 text-xs">{prod.sku}</td>
                    <td className="py-3.5 px-4">Rp {prod.price.toLocaleString('id-ID')}</td>
                    <td className="py-3.5 px-4 font-semibold text-slate-800">{prod.stock} unit</td>
                    <td className="py-3.5 px-4 text-slate-400">{prod.minStock}</td>
                    <td className="py-3.5 px-4 text-center">
                      {isOut ? (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-3xs font-black bg-red-50 text-red-600 uppercase">
                          Habis
                        </span>
                      ) : isLow ? (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-3xs font-black bg-amber-50 text-amber-600 uppercase">
                          Menipis
                        </span>
                      ) : (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-3xs font-black bg-emerald-50 text-emerald-600 uppercase">
                          Aman
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Product Modal */}
      {showAddProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800">Registrasi Produk Baru</h3>
              <button
                onClick={() => setShowAddProductModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xs font-semibold cursor-pointer"
              >
                Tutup
              </button>
            </div>
            
            <form onSubmit={handleAddProductSubmit} className="space-y-3.5 text-sm">
              <div className="space-y-1">
                <label className="text-slate-500 text-xs font-bold">Nama Produk</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Indomie Goreng Rendang"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-950 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  value={newProduct.name}
                  onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-500 text-xs font-bold">SKU (Unik)</label>
                  <input
                    type="text"
                    required
                    placeholder="IND-REN"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-950 focus:outline-none focus:ring-2 focus:ring-emerald-400 font-mono"
                    value={newProduct.sku}
                    onChange={(e) => setNewProduct({ ...newProduct, sku: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-500 text-xs font-bold">Harga Jual (IDR)</label>
                  <input
                    type="number"
                    required
                    placeholder="4000"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-950 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    value={newProduct.price}
                    onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-500 text-xs font-bold">Stok Awal</label>
                  <input
                    type="number"
                    required
                    placeholder="100"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-950 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    value={newProduct.stock}
                    onChange={(e) => setNewProduct({ ...newProduct, stock: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-500 text-xs font-bold">Min. Batas Stok</label>
                  <input
                    type="number"
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-950 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    value={newProduct.minStock}
                    onChange={(e) => setNewProduct({ ...newProduct, minStock: e.target.value })}
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl mt-4 transition shadow-lg cursor-pointer"
              >
                Simpan Produk
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
