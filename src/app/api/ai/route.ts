// src/app/api/ai/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

// Interface definitions
interface CartItemInput {
  sku: string;
  quantity: number;
}

interface RequestBody {
  message: string;
  mode: 'customer' | 'owner';
  cartItems: CartItemInput[];
}

export async function POST(req: Request) {
  try {
    const { message, mode, cartItems }: RequestBody = await req.json();

    if (!message || message.trim() === '') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const isMock = !apiKey || apiKey === 'placeholder' || apiKey === '';

    if (isMock) {
      // Execute simulated (mock) AI logic using regex parsing for zero-config testing
      return await handleMockAI(message, mode, cartItems);
    } else {
      // Execute real Gemini AI with Function Calling
      return await handleRealGeminiAI(apiKey, message, mode, cartItems);
    }
  } catch (error: any) {
    console.error('Error in AI Route:', error);
    return NextResponse.json(
      { response: 'Maaf, terjadi kesalahan pada server.', error: error.message },
      { status: 500 }
    );
  }
}

// ==========================================
// 1. MOCK AI AGENT LOGIC (ZERO-CONFIG FALLBACK)
// ==========================================
async function handleMockAI(message: string, mode: 'customer' | 'owner', cartItems: CartItemInput[]) {
  const query = message.toLowerCase();
  
  // CUSTOMER MODE SIMULATION
  if (mode === 'customer') {
    // Check checkout request
    if (query.includes('bayar') || query.includes('checkout') || query.includes('selesai') || query.includes('konfirmasi')) {
      if (!cartItems || cartItems.length === 0) {
        return NextResponse.json({
          response: 'Keranjang belanja Anda masih kosong. Silakan pesan produk terlebih dahulu.',
          speakText: 'Keranjang belanja Anda masih kosong. Silakan pesan produk terlebih dahulu.',
          action: null,
          isMock: true
        });
      }

      // Perform DB transaction creation
      try {
        const dbItems: any[] = [];
        let totalAmount = 0;

        for (const item of cartItems) {
          const product = await prisma.product.findUnique({
            where: { sku: item.sku }
          });
          if (!product) {
            return NextResponse.json({
              response: `Produk dengan SKU ${item.sku} tidak ditemukan.`,
              speakText: `Produk tidak ditemukan.`,
              action: null,
              isMock: true
            });
          }
          if (product.stock < item.quantity) {
            return NextResponse.json({
              response: `Stok ${product.name} tidak mencukupi (Sisa: ${product.stock}, Diminta: ${item.quantity}).`,
              speakText: `Stok ${product.name} tidak mencukupi.`,
              action: null,
              isMock: true
            });
          }
          dbItems.push({ product, quantity: item.quantity });
          totalAmount += product.price * item.quantity;
        }

        // Generate Invoice Number
        const invoiceNumber = 'INV-' + Date.now().toString().slice(-8);

        // Create transaction
        const txn = await prisma.transaction.create({
          data: {
            invoiceNumber,
            totalAmount,
            paymentStatus: 'PENDING',
            paymentType: 'MIDTRANS',
            midtransId: 'midtrans-mock-' + Date.now(),
            items: {
              create: dbItems.map((item) => ({
                productId: item.product.id,
                quantity: item.quantity,
                priceAtPurchase: item.product.price
              }))
            }
          }
        });

        // Request Midtrans Token
        let midtransToken = '';
        const serverKey = process.env.MIDTRANS_SERVER_KEY;
        if (serverKey) {
          try {
            const authHeader = Buffer.from(serverKey + ':').toString('base64');
            const midtransUrl = 'https://app.sandbox.midtrans.com/snap/v1/transactions';
            const midtransRequestBody = {
              transaction_details: {
                order_id: invoiceNumber,
                gross_amount: totalAmount
              },
              item_details: dbItems.map(item => ({
                id: item.product.sku,
                price: item.product.price,
                quantity: item.quantity,
                name: item.product.name
              })),
              credit_card: {
                secure: true
              }
            };
            const response = await fetch(midtransUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Basic ${authHeader}`
              },
              body: JSON.stringify(midtransRequestBody)
            });
            const midtransData = await response.json();
            if (response.ok && midtransData.token) {
              midtransToken = midtransData.token;
              // Update transaction with the Midtrans Token
              await prisma.transaction.update({
                where: { id: txn.id },
                data: { midtransId: midtransToken }
              });
            } else {
              console.error('Midtrans API Error during Mock checkout:', midtransData);
            }
          } catch (err) {
            console.error('Midtrans request failed in Mock checkout:', err);
          }
        }

        // Deduct stock and log
        for (const item of dbItems) {
          await prisma.product.update({
            where: { id: item.product.id },
            data: { stock: { decrement: item.quantity } }
          });

          await prisma.stockLog.create({
            data: {
              productId: item.product.id,
              type: 'STOCK_OUT',
              quantity: item.quantity,
              reason: `Sale ${invoiceNumber}`
            }
          });

          // Check for low stock alerts
          const updatedProd = await prisma.product.findUnique({ where: { id: item.product.id } });
          if (updatedProd && updatedProd.stock <= updatedProd.minStock) {
            await prisma.notification.create({
              data: {
                message: `${updatedProd.name} stok menipis (Sisa ${updatedProd.stock}, Batas: ${updatedProd.minStock})`,
                type: 'LOW_STOCK'
              }
            });
          }
        }

        return NextResponse.json({
          response: `Total belanja Anda adalah Rp ${totalAmount.toLocaleString('id-ID')}. Silakan selesaikan pembayaran di jendela Midtrans Snap yang muncul secara otomatis.`,
          speakText: `Total belanja Anda adalah ${totalAmount} rupiah. Silakan selesaikan pembayaran.`,
          action: {
            type: 'INITIATE_CHECKOUT',
            payload: {
              token: midtransToken,
              transactionId: txn.id,
              invoiceNumber: txn.invoiceNumber,
              totalAmount,
              items: dbItems.map(i => ({ name: i.product.name, price: i.product.price, quantity: i.quantity }))
            }
          },
          isMock: true
        });
      } catch (err: any) {
        return NextResponse.json({ response: 'Terjadi kesalahan checkout: ' + err.message, action: null, isMock: true });
      }
    }

    // Check clear cart
    if (query.includes('kosongkan') || query.includes('bersihkan keranjang')) {
      return NextResponse.json({
        response: 'Keranjang belanja telah dikosongkan.',
        speakText: 'Keranjang belanja telah dikosongkan.',
        action: { type: 'CLEAR_CART', payload: null },
        isMock: true
      });
    }

    // Check add item (beli/pesan/tambah)
    // Examples: "beli 2 indomie", "beli indomie 1", "pesan 1 aqua", "tambah 3 teh botol"
    const isPurchaseQuery = query.includes('beli') || query.includes('pesan') || query.includes('tambah') || query.includes('order') || query.includes('ambil');
    
    if (isPurchaseQuery) {
      // Check for Indonesian number words
      const idNumMap: Record<string, number> = {
        satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5,
        enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10
      };
      
      let quantity = 1;
      let cleanedQuery = query;
      
      // Parse Indonesian words for quantity
      const words = cleanedQuery.split(/\s+/);
      for (const word of words) {
        if (idNumMap[word.toLowerCase()]) {
          quantity = idNumMap[word.toLowerCase()];
          cleanedQuery = cleanedQuery.replace(new RegExp(`\\b${word}\\b`, 'gi'), '');
        }
      }
      
      // Parse digits for quantity
      const numMatch = cleanedQuery.match(/\b(\d+)\b/);
      if (numMatch) {
        quantity = parseInt(numMatch[1]);
        cleanedQuery = cleanedQuery.replace(/\b\d+\b/g, '');
      }
      
      // Extract clean product keyword
      const productKeyword = cleanedQuery
        .replace(/(?:beli|pesan|tambah|order|ambil)/gi, '')
        .trim();
        
      if (productKeyword && productKeyword.length >= 2) {
        // Search db
        const dbProduct = await prisma.product.findFirst({
          where: {
            name: { contains: productKeyword, mode: 'insensitive' }
          }
        });

        if (dbProduct) {
          if (dbProduct.stock < quantity) {
            return NextResponse.json({
              response: `Maaf, stok ${dbProduct.name} tidak cukup. Stok yang tersedia hanya ${dbProduct.stock}.`,
              speakText: `Maaf, stok tidak cukup.`,
              action: null,
              isMock: true
            });
          }

          return NextResponse.json({
            response: `Berhasil menambahkan ${quantity} ${dbProduct.name} (Rp ${(dbProduct.price * quantity).toLocaleString('id-ID')}) ke keranjang belanja.`,
            speakText: `Berhasil menambahkan ${quantity} ${dbProduct.name} ke keranjang.`,
            action: {
              type: 'ADD_TO_CART',
              payload: {
                product: dbProduct,
                quantity
              }
            },
            products: [dbProduct],
            isMock: true
          });
        }
      }
    }

    // Check for general product listing query
    if (query.includes('ada barang apa') || query.includes('produk apa') || query.includes('semua produk') || query.includes('daftar barang') || query.includes('barang apa aja') || query.includes('daftar produk')) {
      const allProducts = await prisma.product.findMany({});
      const listStr = allProducts.map(p => `- ${p.name} (SKU: ${p.sku}): Rp ${p.price.toLocaleString('id-ID')} (Stok: ${p.stock})`).join('\n');
      const speakStr = `Kami memiliki ${allProducts.map(p => p.name).join(', ')}. Mau beli yang mana?`;
      return NextResponse.json({
        response: `Berikut adalah daftar produk yang tersedia di toko kami:\n${listStr}`,
        speakText: speakStr,
        action: null,
        isMock: true
      });
    }

    // General search or price check
    // Examples: "berapa harga indomie", "ada aqua?"
    const allProducts = await prisma.product.findMany({});
    for (const p of allProducts) {
      if (query.includes(p.name.toLowerCase()) || query.includes(p.sku.toLowerCase())) {
        return NextResponse.json({
          response: `${p.name} tersedia dengan harga Rp ${p.price.toLocaleString('id-ID')} (Stok: ${p.stock}). Apakah Anda ingin membelinya?`,
          speakText: `${p.name} seharga ${p.price} rupiah, stok ada ${p.stock} buah. Mau beli?`,
          action: null,
          isMock: true
        });
      }
    }

    return NextResponse.json({
      response: 'Halo! Saya asisten kasir virtual Anda. Anda dapat berkata "Beli 2 Indomie dan 1 Aqua" atau menanyakan harga barang.',
      speakText: 'Halo! Saya asisten kasir Anda. Mau belanja apa hari ini?',
      action: null,
      isMock: true
    });
  }

  // OWNER MODE SIMULATION
  if (mode === 'owner') {
    // 1. Update Price
    // Example: "ubah harga aqua menjadi 4000", "harga indomie jadi 4000"
    const regexPrice = /(?:ubah harga|set harga|harga)\s+([a-zA-Z0-9\s]+?)\s+(?:menjadi|jadi|ke)\s+(\d+)/i;
    const matchPrice = query.match(regexPrice);
    if (matchPrice) {
      const keyword = matchPrice[1].trim();
      const newPrice = parseFloat(matchPrice[2]);

      const product = await prisma.product.findFirst({
        where: { name: { contains: keyword } }
      });

      if (!product) {
        return NextResponse.json({
          response: `Produk "${keyword}" tidak ditemukan untuk perubahan harga.`,
          speakText: `Produk tidak ditemukan.`,
          action: null,
          isMock: true
        });
      }

      await prisma.product.update({
        where: { id: product.id },
        data: { price: newPrice }
      });

      return NextResponse.json({
        response: `Harga produk ${product.name} (SKU: ${product.sku}) berhasil diubah menjadi Rp ${newPrice.toLocaleString('id-ID')}.`,
        speakText: `Harga ${product.name} telah diubah menjadi ${newPrice} rupiah.`,
        action: { type: 'UPDATE_DATABASE', payload: null },
        isMock: true
      });
    }

    // 2. Add Stock
    // Example: "tambah stok indomie 100", "tambah stok aqua 50"
    const regexStock = /(?:tambah stok|stok|restock)\s+([a-zA-Z0-9\s]+?)\s+(\d+)/i;
    const matchStock = query.match(regexStock);
    if (matchStock) {
      const keyword = matchStock[1].trim();
      const count = parseInt(matchStock[2]);

      const product = await prisma.product.findFirst({
        where: { name: { contains: keyword } }
      });

      if (!product) {
        return NextResponse.json({
          response: `Produk "${keyword}" tidak ditemukan untuk penambahan stok.`,
          speakText: `Produk tidak ditemukan.`,
          action: null,
          isMock: true
        });
      }

      const updated = await prisma.product.update({
        where: { id: product.id },
        data: { stock: { increment: count } }
      });

      await prisma.stockLog.create({
        data: {
          productId: product.id,
          type: 'STOCK_IN',
          quantity: count,
          reason: 'Owner Manual Adjustment (AI Voice)'
        }
      });

      return NextResponse.json({
        response: `Stok produk ${product.name} berhasil ditambahkan sebanyak ${count}. Stok sekarang adalah ${updated.stock}.`,
        speakText: `Stok ${product.name} berhasil ditambahkan ${count} unit.`,
        action: { type: 'UPDATE_DATABASE', payload: null },
        isMock: true
      });
    }

    // 3. Omzet/Metrics Check
    // Example: "berapa omzet hari ini", "omzet minggu ini", "pendapatan hari ini"
    if (query.includes('omzet') || query.includes('pendapatan') || query.includes('laporan') || query.includes('keuntungan')) {
      const transactions = await prisma.transaction.findMany({
        where: { paymentStatus: 'PAID' }
      });
      const totalOmzet = transactions.reduce((acc, curr) => acc + curr.totalAmount, 0);

      // Best seller query
      const items = await prisma.transactionItem.findMany({
        include: { product: true }
      });
      const salesMap: Record<string, { name: string, qty: number }> = {};
      items.forEach(it => {
        if (!salesMap[it.productId]) {
          salesMap[it.productId] = { name: it.product.name, qty: 0 };
        }
        salesMap[it.productId].qty += it.quantity;
      });

      let bestSeller = 'Belum ada transaksi';
      let maxQty = 0;
      Object.values(salesMap).forEach(val => {
        if (val.qty > maxQty) {
          maxQty = val.qty;
          bestSeller = `${val.name} (${val.qty} unit)`;
        }
      });

      return NextResponse.json({
        response: `Laporan Toko Saat Ini:\n- Total Omzet: Rp ${totalOmzet.toLocaleString('id-ID')}\n- Total Transaksi: ${transactions.length}\n- Produk Terlaris: ${bestSeller}.`,
        speakText: `Total omzet toko saat ini adalah ${totalOmzet} rupiah dari ${transactions.length} transaksi. Produk terlaris adalah ${bestSeller}.`,
        action: { type: 'REFRESH_METRICS', payload: null },
        isMock: true
      });
    }

    // 4. Low stock checking
    if (query.includes('stok hampir habis') || query.includes('stok menipis') || query.includes('habis')) {
      const lowStockProducts = await prisma.product.findMany({
        where: {
          stock: { lte: prisma.product.fields.minStock }
        }
      });

      if (lowStockProducts.length === 0) {
        return NextResponse.json({
          response: 'Bagus! Semua produk memiliki stok yang aman di atas batas minimum.',
          speakText: 'Semua stok produk aman.',
          action: null,
          isMock: true
        });
      }

      const listStr = lowStockProducts.map(p => `- ${p.name}: sisa ${p.stock} (Min: ${p.minStock})`).join('\n');
      return NextResponse.json({
        response: `Terdapat ${lowStockProducts.length} produk dengan stok menipis:\n${listStr}`,
        speakText: `Ada ${lowStockProducts.length} produk dengan stok menipis.`,
        action: null,
        isMock: true
      });
    }

    return NextResponse.json({
      response: 'Halo Owner! Anda dapat mengelola toko dengan suara. Cobalah katakan: "Ubah harga Aqua menjadi 4000", "Tambah stok Indomie 50", atau "Berapa omzet hari ini?"',
      speakText: 'Halo Owner! Ada yang bisa saya bantu untuk mengelola toko?',
      action: null,
      isMock: true
    });
  }

  return NextResponse.json({ response: 'Mode tidak valid.', action: null, isMock: true });
}

// Helper to clean search queries and extract quantities for products
function cleanProductSearchQuery(query: string) {
  let cleaned = query.toLowerCase().trim();
  
  // Strip starting/ending verbs like 'beli', 'pesan', 'tambah', 'ambil', 'order'
  cleaned = cleaned.replace(/^(?:beli|pesan|tambah|ambil|order)\s+/i, '');
  cleaned = cleaned.replace(/\s+(?:beli|pesan|tambah|ambil|order)$/i, '');

  const idNumMap: Record<string, number> = {
    satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5,
    enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10
  };

  let quantity = 1;

  // Pattern 1: Number or word number at the end
  const endPattern = /^(.+?)\s+(satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|\d+)$/i;
  const endMatch = cleaned.match(endPattern);
  if (endMatch) {
    cleaned = endMatch[1].trim();
    const qtyStr = endMatch[2].toLowerCase();
    quantity = idNumMap[qtyStr] !== undefined ? idNumMap[qtyStr] : parseInt(qtyStr, 10);
  } else {
    // Pattern 2: Number or word number at the start
    const startPattern = /^(satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|\d+)\s+(.+)$/i;
    const startMatch = cleaned.match(startPattern);
    if (startMatch) {
      cleaned = startMatch[2].trim();
      const qtyStr = startMatch[1].toLowerCase();
      quantity = idNumMap[qtyStr] !== undefined ? idNumMap[qtyStr] : parseInt(qtyStr, 10);
    }
  }

  // Strip common trailing unit words like 'pcs', 'buah', 'biji', 'bungkus', 'kaleng', 'botol', 'pack' if they are left at the end
  cleaned = cleaned.replace(/\s+(?:pcs|buah|biji|bungkus|kaleng|botol|pack)$/i, '').trim();

  return { cleaned, quantity };
}

// ==========================================
// 2. REAL GEMINI AI INTEGRATION WITH TOOLS
// ==========================================
async function handleRealGeminiAI(
  apiKey: string,
  message: string,
  mode: 'customer' | 'owner',
  cartItems: CartItemInput[]
) {
  const genAI = new GoogleGenerativeAI(apiKey);
  // Using gemini-2.5-flash for speed and lower latency
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: `Anda adalah KasirPintarAI, asisten POS suara pintar untuk toko retail. 
    Anda berjalan dalam dua mode: Customer Mode (membantu belanja, cek harga, tambah ke keranjang, checkout) dan Owner Mode (mengelola harga, stok, dan melihat omzet/laporan).
    
    Saat ini Anda berjalan di mode: ${mode.toUpperCase()}.
    
    ATURAN CUSTOMER MODE:
    - Panggil 'getCartAction' dengan aksi 'ADD' jika pelanggan menyatakan ingin membeli, memesan, menambahkan barang ke keranjang (misal: "beli indomie", "tambah aqua", "saya mau indomie", "order indomie"). Jika jumlah barang tidak disebutkan, gunakan quantity: 1.
    - PENTING: JANGAN HANYA menjawab dengan teks atau memanggil 'searchProducts' ketika pelanggan berniat membeli (misal: "beli mie goreng 1"). Anda HARUS langsung memanggil 'getCartAction' dengan aksi 'ADD' dan menyertakan nama/SKU barang tersebut di parameter 'skuOrName' agar sistem langsung memasukkannya ke keranjang belanja asli.
    - Panggil 'getCartAction' dengan aksi 'REMOVE' jika pelanggan ingin menghapus produk dari keranjang.
    - Panggil 'getCartAction' dengan aksi 'CLEAR' jika pelanggan ingin mengosongkan keranjang.
    - Hanya panggil 'searchProducts' jika pelanggan sekadar bertanya tentang keberadaan produk, mencari barang, atau bertanya harga produk tanpa berniat membelinya secara langsung (misal: "apakah ada indomie?", "berapa harga aqua?", "cari produk susu").
    - Panggil 'checkoutCart' untuk memproses checkout ketika pelanggan menyatakan ingin membayar, checkout, atau selesai belanja.
    - Selalu tampilkan detail harga produk yang ramah dalam Rupiah.
    
    ATURAN OWNER MODE:
    - Bantu pemilik toko mengubah harga, restock, melihat laporan omzet, dan mencari produk stok menipis.
    - Panggil 'updateProductPrice' untuk mengubah harga produk.
    - Panggil 'adjustProductStock' untuk menambah atau mengurangi stok barang.
    - Panggil 'getStoreAnalytics' untuk memperoleh metrik keuangan, produk terlaris, atau produk stok menipis.
 
    INFORMASI PENTING:
    - Selalu gunakan bahasa Indonesia yang sopan, natural, dan ringkas layaknya percakapan suara yang tidak bertele-tele.
    - Berikan instruksi atau konfirmasi yang jelas kepada pengguna.
    - Jika pengguna meminta tindakan yang membutuhkan alat (tools), panggil fungsi yang sesuai.`
  });

  // Tools definition
  const tools: any = [
    {
      functionDeclarations: [
        {
          name: 'searchProducts',
          description: 'Mencari produk di dalam inventori toko berdasarkan kata kunci nama produk atau SKU. Gunakan kata kunci kosong "" atau "semua" untuk menampilkan seluruh daftar daftar barang yang tersedia.',
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              query: { type: SchemaType.STRING, description: 'Kata kunci nama produk (misalnya: Indomie, Aqua) atau SKU. Gunakan kata kunci "semua" atau kosong untuk mendaftar seluruh produk.' }
            },
            required: ['query']
          }
        },
        {
          name: 'getCartAction',
          description: 'Mengelola isi keranjang belanja customer (ADD: menambah produk, REMOVE: menghapus produk, CLEAR: mengosongkan keranjang).',
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              action: { type: SchemaType.STRING, enum: ['ADD', 'REMOVE', 'CLEAR'], description: 'Jenis aksi keranjang.' },
              skuOrName: { type: SchemaType.STRING, description: 'SKU produk atau nama produk yang ingin ditambah atau dihapus (misal: "IND-GOR" atau "mie goreng"). Wajib diisi untuk ADD/REMOVE.' },
              quantity: { type: SchemaType.NUMBER, description: 'Jumlah unit produk (default: 1).' }
            },
            required: ['action']
          }
        },
        {
          name: 'checkoutCart',
          description: 'Melakukan pembayaran/checkout untuk seluruh isi keranjang belanja dan memicu pembayaran QRIS.',
          parameters: {
            type: SchemaType.OBJECT,
            properties: {}
          }
        },
        {
          name: 'updateProductPrice',
          description: 'Owner Tool: Mengubah harga jual produk berdasarkan SKU atau nama.',
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              skuOrName: { type: SchemaType.STRING, description: 'SKU produk atau nama produk.' },
              price: { type: SchemaType.NUMBER, description: 'Harga baru dalam rupiah.' }
            },
            required: ['skuOrName', 'price']
          }
        },
        {
          name: 'adjustProductStock',
          description: 'Owner Tool: Menambah atau mengurangi stok produk (delta positif untuk masuk, delta negatif untuk keluar) berdasarkan SKU atau nama.',
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              skuOrName: { type: SchemaType.STRING, description: 'SKU produk atau nama produk.' },
              delta: { type: SchemaType.NUMBER, description: 'Besar penyesuaian stok. Gunakan angka positif untuk tambah stok, negatif untuk kurangi stok.' },
              reason: { type: SchemaType.STRING, description: 'Alasan penyesuaian stok (opsional).' }
            },
            required: ['skuOrName', 'delta']
          }
        },
        {
          name: 'getStoreAnalytics',
          description: 'Owner Tool: Mengambil analisis performa penjualan toko, produk terlaris, dan produk dengan stok menipis.',
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              period: { type: SchemaType.STRING, enum: ['day', 'week', 'month'], description: 'Periode waktu laporan.' }
            },
            required: ['period']
          }
        }
      ]
    }
  ];

  // Start chat with tools
  const chat = model.startChat({
    tools: tools,
    generationConfig: {
      temperature: 0.2
    }
  });

  const chatResult = await chat.sendMessage(message);
  const response = chatResult.response;
  const functionCalls = response.functionCalls();

  if (functionCalls && functionCalls.length > 0) {
    const call = functionCalls[0];
    const funcName = call.name;
    const args = call.args as any;

    let toolResult: any = null;
    let clientAction: any = null;
    let productsMetadata: any[] = [];

    // Execute functions
    if (funcName === 'searchProducts') {
      const q = args.query ? args.query.trim() : '';
      const qLower = q.toLowerCase();
      let products;

      const isGeneralQuery = !q || 
        qLower === 'semua' || 
        qLower === 'all' || 
        qLower === 'barang' || 
        qLower === 'produk' || 
        qLower === 'list' || 
        qLower === 'apa saja' || 
        qLower === 'ada apa aja' || 
        qLower === 'ada barang apa aja';

      if (isGeneralQuery) {
        products = await prisma.product.findMany({
          include: { category: true }
        });
      } else {
        const { cleaned } = cleanProductSearchQuery(q);
        products = await prisma.product.findMany({
          where: {
            OR: [
              { name: { contains: cleaned, mode: 'insensitive' } },
              { sku: { equals: cleaned, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
              { sku: { equals: q, mode: 'insensitive' } }
            ]
          },
          include: { category: true }
        });

        // If no products found, try keyword split matching
        if (products.length === 0 && cleaned.length > 0) {
          const keywords = cleaned.split(/\s+/).filter(k => k.length > 0);
          if (keywords.length > 0) {
            products = await prisma.product.findMany({
              where: {
                AND: keywords.map(kw => ({
                  name: { contains: kw, mode: 'insensitive' }
                }))
              },
              include: { category: true }
            });
          }
        }
      }
      toolResult = { products };
      productsMetadata = products;
    } 
    
    else if (funcName === 'getCartAction') {
      const action = args.action;
      const skuOrName = args.skuOrName || args.sku;
      let quantity = args.quantity || 1;

      if (action === 'CLEAR') {
        toolResult = { success: true, message: 'Keranjang telah dibersihkan.' };
        clientAction = { type: 'CLEAR_CART', payload: null };
      } else {
        const { cleaned, quantity: parsedQuantity } = cleanProductSearchQuery(skuOrName);
        if (!args.quantity && parsedQuantity > 1) {
          quantity = parsedQuantity;
        }

        let product = await prisma.product.findUnique({ where: { sku: cleaned.toUpperCase() } });
        if (!product) {
          product = await prisma.product.findUnique({ where: { sku: skuOrName } });
        }
        if (!product) {
          // Fallback: search by name contains or sku equals (case-insensitive)
          product = await prisma.product.findFirst({
            where: {
              OR: [
                { name: { contains: cleaned, mode: 'insensitive' } },
                { sku: { equals: cleaned, mode: 'insensitive' } },
                { name: { contains: skuOrName, mode: 'insensitive' } },
                { sku: { equals: skuOrName, mode: 'insensitive' } }
              ]
            }
          });
        }

        // If still not found, split cleaned query into keywords and match all
        if (!product && cleaned.length > 0) {
          const keywords = cleaned.split(/\s+/).filter(k => k.length > 0);
          if (keywords.length > 0) {
            product = await prisma.product.findFirst({
              where: {
                AND: keywords.map(kw => ({
                  name: { contains: kw, mode: 'insensitive' }
                }))
              }
            });
          }
        }

        if (!product) {
          toolResult = { success: false, error: `Produk dengan SKU atau nama "${skuOrName}" tidak ditemukan.` };
        } else if (action === 'ADD') {
          if (product.stock < quantity) {
            toolResult = { success: false, error: `Stok ${product.name} tidak cukup. Sisa: ${product.stock}` };
          } else {
            toolResult = { success: true, product, quantity };
            clientAction = { type: 'ADD_TO_CART', payload: { product, quantity } };
          }
        } else if (action === 'REMOVE') {
          toolResult = { success: true, product, quantity };
          clientAction = { type: 'REMOVE_FROM_CART', payload: { productId: product.id } };
        }
      }
    } 
    
    else if (funcName === 'checkoutCart') {
      if (!cartItems || cartItems.length === 0) {
        toolResult = { success: false, error: 'Keranjang masih kosong.' };
      } else {
        try {
          const dbItems: any[] = [];
          let totalAmount = 0;

          for (const item of cartItems) {
            const product = await prisma.product.findUnique({ where: { sku: item.sku } });
            if (!product) throw new Error(`Produk SKU ${item.sku} tidak ditemukan.`);
            if (product.stock < item.quantity) throw new Error(`Stok ${product.name} kurang.`);
            dbItems.push({ product, quantity: item.quantity });
            totalAmount += product.price * item.quantity;
          }

          const invoiceNumber = 'INV-' + Date.now().toString().slice(-8);

          // Create transaction
          const txn = await prisma.transaction.create({
            data: {
              invoiceNumber,
              totalAmount,
              paymentStatus: 'PENDING',
              paymentType: 'MIDTRANS',
              items: {
                create: dbItems.map((item) => ({
                  productId: item.product.id,
                  quantity: item.quantity,
                  priceAtPurchase: item.product.price
                }))
              }
            }
          });

          // Request Midtrans Token
          let midtransToken = '';
          const serverKey = process.env.MIDTRANS_SERVER_KEY;
          if (serverKey) {
            const authHeader = Buffer.from(serverKey + ':').toString('base64');
            const midtransUrl = 'https://app.sandbox.midtrans.com/snap/v1/transactions';
            const midtransRequestBody = {
              transaction_details: {
                order_id: invoiceNumber,
                gross_amount: totalAmount
              },
              item_details: dbItems.map(item => ({
                id: item.product.sku,
                price: item.product.price,
                quantity: item.quantity,
                name: item.product.name
              })),
              credit_card: {
                secure: true
              }
            };
            const response = await fetch(midtransUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Basic ${authHeader}`
              },
              body: JSON.stringify(midtransRequestBody)
            });
            const midtransData = await response.json();
            if (response.ok && midtransData.token) {
              midtransToken = midtransData.token;
              // Update transaction with the Midtrans Token
              await prisma.transaction.update({
                where: { id: txn.id },
                data: { midtransId: midtransToken }
              });
            } else {
              console.error('Midtrans API Error during AI checkout:', midtransData);
              midtransToken = 'mock-' + invoiceNumber;
            }
          } else {
            midtransToken = 'mock-' + invoiceNumber;
          }

          toolResult = { success: true, invoiceNumber, totalAmount, midtransToken };
          clientAction = {
            type: 'INITIATE_CHECKOUT',
            payload: {
              token: midtransToken,
              transactionId: txn.id,
              invoiceNumber: txn.invoiceNumber,
              totalAmount,
              items: dbItems.map(i => ({ name: i.product.name, price: i.product.price, quantity: i.quantity }))
            }
          };
        } catch (err: any) {
          toolResult = { success: false, error: err.message };
        }
      }
    } 
    
    else if (funcName === 'updateProductPrice') {
      const skuOrName = args.skuOrName || args.sku;
      const { price } = args;
      let product = await prisma.product.findUnique({ where: { sku: skuOrName } });
      if (!product) {
        product = await prisma.product.findFirst({
          where: {
            OR: [
              { name: { contains: skuOrName, mode: 'insensitive' } },
              { sku: { equals: skuOrName, mode: 'insensitive' } }
            ]
          }
        });
      }
      if (!product) {
        toolResult = { success: false, error: `Produk "${skuOrName}" tidak ditemukan.` };
      } else {
        const updated = await prisma.product.update({
          where: { id: product.id },
          data: { price }
        });
        toolResult = { success: true, product: updated };
        clientAction = { type: 'UPDATE_DATABASE', payload: null };
      }
    } 
    
    else if (funcName === 'adjustProductStock') {
      const skuOrName = args.skuOrName || args.sku;
      const { delta, reason } = args;
      let product = await prisma.product.findUnique({ where: { sku: skuOrName } });
      if (!product) {
        product = await prisma.product.findFirst({
          where: {
            OR: [
              { name: { contains: skuOrName, mode: 'insensitive' } },
              { sku: { equals: skuOrName, mode: 'insensitive' } }
            ]
          }
        });
      }
      if (!product) {
        toolResult = { success: false, error: `Produk "${skuOrName}" tidak ditemukan.` };
      } else {
        const updated = await prisma.product.update({
          where: { id: product.id },
          data: { stock: { increment: delta } }
        });
        await prisma.stockLog.create({
          data: {
            productId: product.id,
            type: delta > 0 ? 'STOCK_IN' : 'STOCK_OUT',
            quantity: Math.abs(delta),
            reason: reason || 'AI Voice Owner Adjustment'
          }
        });
        toolResult = { success: true, product: updated };
        clientAction = { type: 'UPDATE_DATABASE', payload: null };
      }
    } 
    
    else if (funcName === 'getStoreAnalytics') {
      const { period } = args;
      const transactions = await prisma.transaction.findMany({
        where: { paymentStatus: 'PAID' }
      });
      const totalOmzet = transactions.reduce((acc, curr) => acc + curr.totalAmount, 0);

      const lowStockProducts = await prisma.product.findMany({
        where: {
          stock: { lte: prisma.product.fields.minStock }
        }
      });

      const items = await prisma.transactionItem.findMany({
        include: { product: true }
      });
      const salesMap: Record<string, { name: string, qty: number }> = {};
      items.forEach(it => {
        if (!salesMap[it.productId]) {
          salesMap[it.productId] = { name: it.product.name, qty: 0 };
        }
        salesMap[it.productId].qty += it.quantity;
      });
      const bestSellers = Object.values(salesMap).sort((a,b) => b.qty - a.qty).slice(0, 3);

      toolResult = {
        totalOmzet,
        transactionCount: transactions.length,
        lowStockCount: lowStockProducts.length,
        lowStockList: lowStockProducts.map(p => ({ name: p.name, stock: p.stock })),
        bestSellers
      };
      clientAction = { type: 'REFRESH_METRICS', payload: null };
    }

    // Send tool result back to Gemini to get conversational text
    const followUp = await chat.sendMessage([
      {
        functionResponse: {
          name: funcName,
          response: { result: toolResult }
        }
      }
    ]);

    const finalResponseText = followUp.response.text();
    return NextResponse.json({
      response: finalResponseText,
      speakText: stripMarkdown(finalResponseText),
      action: clientAction,
      products: productsMetadata,
      isMock: false
    });
  }

  // Simple conversational response if no tools were called
  const text = response.text();
  return NextResponse.json({
    response: text,
    speakText: stripMarkdown(text),
    action: null,
    products: [],
    isMock: false
  });
}

// Helper to strip markdown symbols for voice reading
function stripMarkdown(text: string): string {
  return text
    .replace(/\*+/g, '') // remove asterisks
    .replace(/#+/g, '') // remove headers
    .replace(/-\s+/g, '') // remove bullets
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // remove markdown links
    .trim();
}
