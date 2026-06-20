// src/app/api/transactions/webhook/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { sendPushNotification } from '@/lib/push';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log('Received Midtrans Webhook Payload:', JSON.stringify(body));

    const { order_id, transaction_status, payment_type } = body;

    if (!order_id) {
      return NextResponse.json({ error: 'order_id is required' }, { status: 400 });
    }

    // Find the pending transaction
    const transaction = await prisma.transaction.findUnique({
      where: { invoiceNumber: order_id },
      include: {
        items: {
          include: {
            product: true
          }
        }
      }
    });

    if (!transaction) {
      return NextResponse.json({ error: `Transaction with invoice ${order_id} not found` }, { status: 404 });
    }

    // Idempotency: if already paid, return success
    if (transaction.paymentStatus === 'PAID') {
      return NextResponse.json({ success: true, message: 'Transaction already processed as PAID' });
    }

    // Determine final payment status
    let finalStatus = 'PENDING';
    const successStatuses = ['settlement', 'capture'];
    const failureStatuses = ['deny', 'cancel', 'expire', 'failure'];

    if (successStatuses.includes(transaction_status)) {
      finalStatus = 'PAID';
    } else if (failureStatuses.includes(transaction_status)) {
      finalStatus = 'FAILED';
    }

    if (finalStatus === 'PAID') {
      // 1. Process DB updates transactionally
      await prisma.$transaction(async (tx) => {
        // Update transaction status
        await tx.transaction.update({
          where: { id: transaction.id },
          data: {
            paymentStatus: 'PAID',
            paymentType: payment_type || 'MIDTRANS'
          }
        });

        // Deduct stocks and log
        for (const item of transaction.items) {
          const product = item.product;

          // Decrement stock
          const updatedProduct = await tx.product.update({
            where: { id: product.id },
            data: {
              stock: {
                decrement: item.quantity
              }
            }
          });

          // Log stock out
          await tx.stockLog.create({
            data: {
              productId: product.id,
              type: 'STOCK_OUT',
              quantity: item.quantity,
              reason: `Sale ${order_id} (Midtrans)`
            }
          });

          // Trigger notifications if stock falls below minimum
          if (updatedProduct.stock <= updatedProduct.minStock) {
            const message = `${updatedProduct.name} stok menipis! Sisa stok: ${updatedProduct.stock} (Batas minimum: ${updatedProduct.minStock})`;
            
            // Create in-app notification record
            await tx.notification.create({
              data: {
                message,
                type: 'LOW_STOCK'
              }
            });

            // Send VAPID Push Notification
            console.log(`Triggering push notification for low stock: ${updatedProduct.name}`);
            sendPushNotification('Peringatan Stok Menipis!', message).catch((err) => {
              console.error('Error sending push notification:', err);
            });
          }
        }
      });

      return NextResponse.json({ success: true, message: 'Transaction successfully processed as PAID' });
    } else if (finalStatus === 'FAILED') {
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          paymentStatus: 'FAILED'
        }
      });
      return NextResponse.json({ success: true, message: 'Transaction marked as FAILED' });
    }

    return NextResponse.json({ success: true, message: 'Transaction status is pending/unhandled' });

  } catch (error: any) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
