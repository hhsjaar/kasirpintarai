// src/app/api/products/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    const products = await prisma.product.findMany({
      include: {
        category: true,
        supplier: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
    return NextResponse.json(products);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { name, sku, price, stock, minStock, categoryId, supplierId, attributes } = await req.json();

    const product = await prisma.product.create({
      data: {
        name,
        sku: sku.toUpperCase(),
        price: parseFloat(price),
        stock: parseInt(stock),
        minStock: parseInt(minStock) || 5,
        attributes: attributes || null,
        categoryId: categoryId || null,
        supplierId: supplierId || null,
      },
    });

    // Log the initial stock
    await prisma.stockLog.create({
      data: {
        productId: product.id,
        type: 'STOCK_IN',
        quantity: parseInt(stock),
        reason: 'Manual Product Registration',
      },
    });

    return NextResponse.json(product);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
