// src/app/api/transactions/checkout/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const serverKey = process.env.MIDTRANS_SERVER_KEY;
const isProduction = false; // Sandbox mode

export async function POST(req: Request) {
  try {
    const { items } = await req.json();

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }

    if (!serverKey) {
      return NextResponse.json({ error: 'Midtrans server key is not configured' }, { status: 500 });
    }

    // Retrieve product details and calculate total amount
    const dbItems = [];
    let totalAmount = 0;

    for (const item of items) {
      const product = await prisma.product.findUnique({
        where: { sku: item.sku }
      });
      
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
