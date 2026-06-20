// src/app/api/notifications/test/route.ts
import { NextResponse } from 'next/server';
import { sendPushNotification } from '@/lib/push';

export async function POST() {
  try {
    console.log('Sending test push notification...');
    await sendPushNotification(
      'Uji Coba Push Notification!',
      'Halo Owner! Notifikasi push VAPID untuk KasirPintarAI berjalan dengan sukses.'
    );
    return NextResponse.json({ success: true, message: 'Test notification sent successfully' });
  } catch (error: any) {
    console.error('Error sending test notification:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
