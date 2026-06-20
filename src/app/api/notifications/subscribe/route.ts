// src/app/api/notifications/subscribe/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const { subscription } = await req.json();

    if (!subscription || !subscription.endpoint) {
      return NextResponse.json({ error: 'Invalid subscription object' }, { status: 400 });
    }

    const { endpoint, keys } = subscription;
    const p256dh = keys?.p256dh || '';
    const auth = keys?.auth || '';

    // Save or update subscription in DB
    const sub = await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: {
        p256dh,
        auth,
      },
      create: {
        endpoint,
        p256dh,
        auth,
      },
    });

    return NextResponse.json({ success: true, subscription: sub });
  } catch (error: any) {
    console.error('Error in subscription route:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
