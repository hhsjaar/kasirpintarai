// src/app/api/kasbon/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    const kasbons = await prisma.kasbon.findMany({
      include: {
        transaction: {
          include: {
            items: {
              include: {
                product: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    return NextResponse.json(kasbons);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { kasbonId, buyerName } = await req.json();

    if (!kasbonId && (!buyerName || buyerName.trim() === '')) {
      return NextResponse.json({ error: 'kasbonId atau buyerName wajib diisi' }, { status: 400 });
    }

    if (kasbonId) {
      // Settle single kasbon record
      const kasbon = await prisma.kasbon.findUnique({
        where: { id: kasbonId },
        include: { transaction: true }
      });

      if (!kasbon) {
        return NextResponse.json({ error: 'Catatan kasbon tidak ditemukan' }, { status: 444 });
      }

      if (kasbon.status === 'PAID') {
        return NextResponse.json({ success: true, message: 'Kasbon ini sudah lunas sebelumnya.' });
      }

      await prisma.$transaction(async (tx) => {
        // Mark Kasbon as PAID
        await tx.kasbon.update({
          where: { id: kasbonId },
          data: { status: 'PAID' }
        });

        // Mark associated Transaction as PAID
        if (kasbon.transactionId) {
          await tx.transaction.update({
            where: { id: kasbon.transactionId },
            data: { paymentStatus: 'PAID' }
          });
        }
      });

      return NextResponse.json({ success: true, message: 'Kasbon berhasil dilunasi!' });
    } else {
      // Settle all unpaid kasbon for a buyerName (case-insensitive search)
      const name = buyerName.trim();
      const unpaidKasbons = await prisma.kasbon.findMany({
        where: {
          buyerName: { equals: name, mode: 'insensitive' },
          status: 'UNPAID'
        }
      });

      if (unpaidKasbons.length === 0) {
        return NextResponse.json({ error: `Tidak ada kasbon belum lunas untuk pembeli bernama "${name}"` }, { status: 404 });
      }

      await prisma.$transaction(async (tx) => {
        for (const k of unpaidKasbons) {
          await tx.kasbon.update({
            where: { id: k.id },
            data: { status: 'PAID' }
          });

          if (k.transactionId) {
            await tx.transaction.update({
              where: { id: k.transactionId },
              data: { paymentStatus: 'PAID' }
            });
          }
        }
      });

      const totalPaid = unpaidKasbons.reduce((sum, k) => sum + k.amount, 0);
      return NextResponse.json({
        success: true,
        message: `Berhasil melunasi ${unpaidKasbons.length} catatan kasbon atas nama "${name}" dengan total Rp ${totalPaid.toLocaleString('id-ID')}`
      });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
