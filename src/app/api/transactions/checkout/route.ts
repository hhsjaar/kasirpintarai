// src/app/api/transactions/checkout/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const serverKey = process.env.MIDTRANS_SERVER_KEY;
const isProduction = false; // Sandbox mode

export async function POST(req: Request) {
  try {
    const { items, paymentType, buyerName } = await req.json();

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

          // Create PENDING transaction with KASBON payment type and create Kasbon record
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
                  buyerName: buyerName.trim(),
                  amount: transTotal,
                  status: 'UNPAID'
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
                reason: `Kasbon ${invoiceNumber} oleh ${buyerName}`
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

          return { txn, totalAmount: transTotal };
        });

        return NextResponse.json({
          success: true,
          token: 'kasbon-' + result.txn.invoiceNumber,
          redirectUrl: '#',
          invoiceNumber: result.txn.invoiceNumber,
          transactionId: result.txn.id,
          totalAmount: result.totalAmount,
          paymentType: 'KASBON'
        });

      } catch (err: any) {
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
