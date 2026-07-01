// src/app/api/kasbon/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

async function getUniqueDebtorCode(): Promise<string> {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  while (true) {
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const code = `KSB-${result}`;
    const existing = await prisma.debtor.findUnique({ where: { code } });
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

export async function GET() {
  try {
    // 1. Migrate legacy kasbon records that don't have debtorId
    const legacyKasbons = await prisma.kasbon.findMany({
      where: { debtorId: null }
    });

    if (legacyKasbons.length > 0) {
      for (const k of legacyKasbons) {
        const cleanName = k.buyerName.trim();
        let debtor = await prisma.debtor.findFirst({
          where: { name: { equals: cleanName, mode: 'insensitive' } }
        });
        if (!debtor) {
          const code = await getUniqueDebtorCode();
          debtor = await prisma.debtor.create({
            data: {
              name: cleanName,
              code: code
            }
          });
        }
        await prisma.kasbon.update({
          where: { id: k.id },
          data: { debtorId: debtor.id }
        });
      }
    }

    // 2. Query all kasbon records (including transaction and debtor details)
    const kasbons = await prisma.kasbon.findMany({
      include: {
        debtor: true,
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

    // 3. Query all debtors including their kasbons to format summarized debt per person
    const debtors = await prisma.debtor.findMany({
      include: {
        kasbons: true
      },
      orderBy: {
        name: 'asc'
      }
    });

    const formattedDebtors = debtors.map(d => {
      const unpaid = d.kasbons.filter(k => k.status === 'UNPAID').reduce((sum, k) => sum + k.amount, 0);
      const paid = d.kasbons.filter(k => k.status === 'PAID').reduce((sum, k) => sum + k.amount, 0);
      return {
        id: d.id,
        code: d.code,
        name: d.name,
        accessCode: d.accessCode,
        totalDebt: unpaid,
        totalPaid: paid,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt
      };
    });

    return NextResponse.json({ kasbons, debtors: formattedDebtors });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { kasbonId, debtorId, buyerName, action, name } = await req.json();

    if (action === 'create_debtor') {
      if (!name || name.trim() === '') {
        return NextResponse.json({ error: 'Nama pengkasbon wajib diisi' }, { status: 400 });
      }
      const cleanName = name.trim();
      const existing = await prisma.debtor.findFirst({
        where: { name: { equals: cleanName, mode: 'insensitive' } }
      });
      if (existing) {
        return NextResponse.json({ error: `Pengkasbon dengan nama "${cleanName}" sudah terdaftar.` }, { status: 400 });
      }
      const code = await getUniqueDebtorCode();
      const accessCode = generateAccessCode();
      const debtor = await prisma.debtor.create({
        data: {
          name: cleanName,
          code,
          accessCode
        }
      });
      return NextResponse.json({ success: true, debtor });
    }

    if (!kasbonId && !debtorId && (!buyerName || buyerName.trim() === '')) {
      return NextResponse.json({ error: 'kasbonId, debtorId, atau buyerName wajib diisi' }, { status: 400 });
    }

    if (kasbonId) {
      // Settle single kasbon record
      const kasbon = await prisma.kasbon.findUnique({
        where: { id: kasbonId },
        include: { transaction: true }
      });

      if (!kasbon) {
        return NextResponse.json({ error: 'Catatan kasbon tidak ditemukan' }, { status: 404 });
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
    } else if (debtorId) {
      // Settle all unpaid kasbons for a debtor
      const debtor = await prisma.debtor.findUnique({
        where: { id: debtorId }
      });

      if (!debtor) {
        return NextResponse.json({ error: 'Data pengkasbon tidak ditemukan' }, { status: 404 });
      }

      const unpaidKasbons = await prisma.kasbon.findMany({
        where: {
          debtorId: debtorId,
          status: 'UNPAID'
        }
      });

      if (unpaidKasbons.length === 0) {
        return NextResponse.json({ error: `Tidak ada kasbon belum lunas untuk pengkasbon "${debtor.name}"` }, { status: 400 });
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
        message: `Berhasil melunasi ${unpaidKasbons.length} catatan kasbon atas nama "${debtor.name}" dengan total Rp ${totalPaid.toLocaleString('id-ID')}`
      });
    } else {
      // Settle all unpaid kasbon for a buyerName (case-insensitive search) - legacy fallback
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

export async function PUT(req: Request) {
  try {
    const { debtorId, accessCode } = await req.json();
    if (!debtorId || !accessCode) {
      return NextResponse.json({ error: 'debtorId dan accessCode wajib diisi' }, { status: 400 });
    }
    const updated = await prisma.debtor.update({
      where: { id: debtorId },
      data: { accessCode: accessCode.trim() }
    });
    return NextResponse.json({ success: true, debtor: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
