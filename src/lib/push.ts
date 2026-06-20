// src/lib/push.ts
import webpush from 'web-push';
import { prisma } from './db';

const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(
    'mailto:support@kasirpintarai.com',
    vapidPublicKey,
    vapidPrivateKey
  );
} else {
  console.warn('VAPID keys not configured in environment. Push notifications will be disabled.');
}

export async function sendPushNotification(title: string, body: string) {
  if (!vapidPublicKey || !vapidPrivateKey) {
    console.warn('Cannot send push: VAPID keys not configured.');
    return;
  }

  try {
    const subscriptions = await prisma.pushSubscription.findMany();
    console.log(`Sending push notification to ${subscriptions.length} subscribers: "${title}" - "${body}"`);

    const payload = JSON.stringify({
      title,
      body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
    });

    const promises = subscriptions.map((sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      return webpush
        .sendNotification(pushSubscription, payload)
        .catch(async (error: any) => {
          // If subscription is expired or inactive, delete it from DB
          if (error.statusCode === 410 || error.statusCode === 404) {
            console.log(`Deleting expired subscription: ${sub.endpoint}`);
            await prisma.pushSubscription.delete({
              where: { id: sub.id },
            }).catch(() => {});
          } else {
            console.error(`Error sending push notification to ${sub.endpoint}:`, error);
          }
        });
    });

    await Promise.all(promises);
  } catch (error) {
    console.error('Failed to send push notifications:', error);
  }
}
