// src/app/api/transactions/checkout/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const serverKey = process.env.MIDTRANS_SERVER_KEY;
const isProduction = false; // Sandbox mode

async function getUniqueDebtorCode(tx: any): Promise<string> {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  while (true) {
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const code = `KSB-${result}`;
    const existing = await tx.debtor.findUnique({ where: { code } });
    if (!existing) return code;
  }
}

function generateAccessCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function POST(req: Request) {
  try {
    const { items, paymentType, buyerName, accessCode } = await req.json();

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }

    // Retrieve product details and calculate total amount
    const dbItems = [];
    let totalAmount = 0;

    // Handle KASBON payment type
    if (paymentType === 'KASBON') {
      if (!buyerName || buyerName.trim() === '') {
        return NextResponse.json({ error: 'Nama pembeli wajib diisi untuk pembayaran Kasbon' }, { status: 400 });
      }

      try {
        const result = await prisma.$transaction(async (tx) => {
          const transItems = [];
          let transTotal = 0;

          for (const item of items) {
            let product = await tx.product.findUnique({
              where: { sku: item.sku }
            });
            if (!product && item.sku) {
              product = await tx.product.findUnique({
                where: { sku: item.sku.toUpperCase() }
              });
            }
            if (!product && item.sku) {
              product = await tx.product.findUnique({
                where: { sku: item.sku.toLowerCase() }
              });
            }
            
            if (!product) {
              throw new Error(`Product with SKU ${item.sku} not found`);
            }

            if (product.stock < item.quantity) {
              throw new Error(`Stok untuk ${product.name} tidak cukup. Tersedia: ${product.stock}`);
            }

            transItems.push({ product, quantity: item.quantity });
            transTotal += product.price * item.quantity;
          }

          const invoiceNumber = 'INV-' + Date.now().toString().slice(-8);

          // Debtor Resolution Logic
          const cleanName = buyerName.trim();
          let debtor = null;

          // 1. Check if input matches KSB-XXXXXX code format
          if (/^KSB-[A-Z0-9]{6}$/i.test(cleanName)) {
            debtor = await tx.debtor.findUnique({
              where: { code: cleanName.toUpperCase() }
            });
          }

          // 2. Search by name (case-insensitive) if not found by code
          if (!debtor) {
            debtor = await tx.debtor.findFirst({
              where: { name: { equals: cleanName, mode: 'insensitive' } }
            });
          }

          // 3. Create a new debtor if not found (generate random 5-character PIN if not specified)
          if (!debtor) {
            const code = await getUniqueDebtorCode(tx);
            debtor = await tx.debtor.create({
              data: {
                name: cleanName,
                code: code,
                accessCode: accessCode ? accessCode.trim() : generateAccessCode()
              }
            });
          } else {
            // Verify access code for existing debtor (case-insensitive and whitespace-stripped)
            const cleanAccessInput = accessCode ? accessCode.trim().replace(/\s/g, '').toLowerCase() : '';
            const cleanDebtorCode = debtor.accessCode ? debtor.accessCode.trim().replace(/\s/g, '').toLowerCase() : '';
            if (cleanDebtorCode && cleanDebtorCode !== cleanAccessInput) {
              throw new Error('KASBON_ACCESS_CODE_INVALID');
            }
          }

          // Create PENDING transaction with KASBON payment type and create Kasbon record linked to Debtor
          const txn = await tx.transaction.create({
            data: {
              invoiceNumber,
              totalAmount: transTotal,
              paymentStatus: 'PENDING',
              paymentType: 'KASBON',
              items: {
                create: transItems.map((item) => ({
                  productId: item.product.id,
                  quantity: item.quantity,
                  priceAtPurchase: item.product.price
                }))
              },
              kasbon: {
                create: {
                  buyerName: debtor.name, // Use registered debtor name
                  amount: transTotal,
                  status: 'UNPAID',
                  debtorId: debtor.id
                }
              }
            }
          });

          // Deduct stocks and log stock changes
          for (const item of transItems) {
            const updatedProduct = await tx.product.update({
              where: { id: item.product.id },
              data: {
                stock: {
                  decrement: item.quantity
                }
              }
            });

            await tx.stockLog.create({
              data: {
                productId: item.product.id,
                type: 'STOCK_OUT',
                quantity: item.quantity,
                reason: `Kasbon ${invoiceNumber} oleh ${debtor.name} (${debtor.code})`
              }
            });

            // Trigger warnings for low stock
            if (updatedProduct.stock <= updatedProduct.minStock) {
              await tx.notification.create({
                data: {
                  message: `${updatedProduct.name} stok menipis (Sisa ${updatedProduct.stock}, Batas: ${updatedProduct.minStock})`,
                  type: 'LOW_STOCK'
                }
              });
            }
          }

          return { txn, totalAmount: transTotal, debtor };
        });

        return NextResponse.json({
          success: true,
          token: 'kasbon-' + result.txn.invoiceNumber,
          redirectUrl: '#',
          invoiceNumber: result.txn.invoiceNumber,
          transactionId: result.txn.id,
          totalAmount: result.totalAmount,
          paymentType: 'KASBON',
          buyerName: result.debtor.name,
          debtorCode: result.debtor.code
        });

      } catch (err: any) {
        if (err.message === 'KASBON_ACCESS_CODE_INVALID') {
          return NextResponse.json({ error: 'Kode akses Kasbon salah! Silakan periksa kembali kode akses Anda.' }, { status: 400 });
        }
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
    }

    if (!serverKey) {
      return NextResponse.json({ error: 'Midtrans server key is not configured' }, { status: 500 });
    }

    for (const item of items) {
      let product = await prisma.product.findUnique({ where: { sku: item.sku } });
      if (!product && item.sku) {
        product = await prisma.product.findUnique({ where: { sku: item.sku.toUpperCase() } });
      }
      if (!product && item.sku) {
        product = await prisma.product.findUnique({ where: { sku: item.sku.toLowerCase() } });
      }
      
      if (!product) {
        return NextResponse.json({ error: `Product with SKU ${item.sku} not found` }, { status: 404 });
      }

      if (product.stock < item.quantity) {
        return NextResponse.json({ error: `Stock for ${product.name} is insufficient. Available: ${product.stock}` }, { status: 400 });
      }

      dbItems.push({ product, quantity: item.quantity });
      totalAmount += product.price * item.quantity;
    }

    // Generate unique Invoice Number
    const invoiceNumber = 'INV-' + Date.now().toString().slice(-8);

    // Create a PENDING transaction in DB
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

    // Request Snap Token from Midtrans Sandbox
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

    console.log('Sending transaction request to Midtrans...', JSON.stringify(midtransRequestBody));

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

    let token = midtransData.token;
    let redirectUrl = midtransData.redirect_url;

    if (!response.ok || midtransData.error_messages) {
      console.warn('Midtrans API Error (falling back to mock checkout token):', midtransData);
      token = 'mock-' + invoiceNumber;
      redirectUrl = '#';
    }

    // Update transaction with the Midtrans Token
    const updatedTxn = await prisma.transaction.update({
      where: { id: txn.id },
      data: {
        midtransId: token
      }
    });

    return NextResponse.json({
      success: true,
      token: token,
      redirectUrl: redirectUrl,
      invoiceNumber: updatedTxn.invoiceNumber,
      transactionId: updatedTxn.id,
      totalAmount
    });

  } catch (error: any) {
    console.error('Checkout error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
