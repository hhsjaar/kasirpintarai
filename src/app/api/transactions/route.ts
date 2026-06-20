// src/app/api/transactions/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    const transactions = await prisma.transaction.findMany({
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    return NextResponse.json(transactions);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { transactionId, status } = await req.json();

    if (!transactionId) {
      return NextResponse.json({ error: 'Transaction ID is required' }, { status: 400 });
    }

    const updatedTxn = await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        paymentStatus: status,
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    // If payment is successful, double-check and alert if products are running low
    if (status === 'PAID') {
      for (const item of updatedTxn.items) {
        const prod = item.product;
        if (prod.stock <= prod.minStock) {
          // Create a low stock warning notification if not already created recently
          const existingNotif = await prisma.notification.findFirst({
            where: {
              message: { contains: prod.name },
              createdAt: { gte: new Date(Date.now() - 1000 * 60 * 5) }, // last 5 minutes
            },
          });

          if (!existingNotif) {
            await prisma.notification.create({
              data: {
                message: `${prod.name} stok menipis (Sisa ${prod.stock}, Batas: ${prod.minStock})`,
                type: 'LOW_STOCK',
              },
            });
          }
        }
      }
    }

    return NextResponse.json({ success: true, transaction: updatedTxn });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
