// prisma/seed.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding store categories and products...');

  // 1. Clean existing data
  await prisma.stockLog.deleteMany({});
  await prisma.transactionItem.deleteMany({});
  await prisma.transaction.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.supplier.deleteMany({});
  await prisma.notification.deleteMany({});

  // 2. Create Suppliers
  const supplierIndofood = await prisma.supplier.create({
    data: {
      name: 'PT Indofood Sukses Makmur',
      contactInfo: 'sales@indofood.com',
    },
  });

  const supplierAqua = await prisma.supplier.create({
    data: {
      name: 'PT Tirta Investama (Aqua)',
      contactInfo: 'support@aqua.co.id',
    },
  });

  const supplierSosro = await prisma.supplier.create({
    data: {
      name: 'PT Sinar Sosro',
      contactInfo: 'info@sosro.com',
    },
  });

  // 3. Create Categories
  const catMakanan = await prisma.category.create({
    data: { name: 'Makanan', description: 'Aneka makanan instan dan ringan' },
  });

  const catMinuman = await prisma.category.create({
    data: { name: 'Minuman', description: 'Minuman kemasan dingin atau hangat' },
  });

  // 4. Create Products
  const products = [
    {
      name: 'Indomie Goreng',
      sku: 'IND-GOR-ORI',
      price: 3500,
      stock: 120,
      minStock: 15,
      attributes: 'Original',
      categoryId: catMakanan.id,
      supplierId: supplierIndofood.id,
    },
    {
      name: 'Indomie Goreng',
      sku: 'IND-GOR-REN',
      price: 3800,
      stock: 80,
      minStock: 15,
      attributes: 'Rasa Rendang',
      categoryId: catMakanan.id,
      supplierId: supplierIndofood.id,
    },
    {
      name: 'Indomie Goreng',
      sku: 'IND-GOR-ACH',
      price: 4000,
      stock: 50,
      minStock: 15,
      attributes: 'Rasa Aceh',
      categoryId: catMakanan.id,
      supplierId: supplierIndofood.id,
    },
    {
      name: 'Aqua 600ml',
      sku: 'AQA-600',
      price: 3500,
      stock: 100,
      minStock: 20,
      categoryId: catMinuman.id,
      supplierId: supplierAqua.id,
    },
    {
      name: 'Teh Botol Sosro',
      sku: 'TEH-BTL',
      price: 5000,
      stock: 8, // low stock for trigger testing
      minStock: 10,
      categoryId: catMinuman.id,
      supplierId: supplierSosro.id,
    },
    {
      name: 'Chitato Sapi Panggang',
      sku: 'CHT-SPG',
      price: 11000,
      stock: 45,
      minStock: 8,
      categoryId: catMakanan.id,
      supplierId: supplierIndofood.id,
    },
    {
      name: 'Kopi Kapal Api',
      sku: 'KOP-KAP',
      price: 2000,
      stock: 200,
      minStock: 30,
      categoryId: catMinuman.id,
      supplierId: supplierIndofood.id,
    },
  ];

  for (const item of products) {
    const product = await prisma.product.create({ data: item });
    // Add initial Stock Log
    await prisma.stockLog.create({
      data: {
        productId: product.id,
        type: 'STOCK_IN',
        quantity: item.stock,
        reason: 'Initial Seeding',
      },
    });
  }

  // Add a sample low-stock notification
  await prisma.notification.create({
    data: {
      message: 'Teh Botol Sosro stok menipis (Sisa 8, Batas minimum: 10)',
      type: 'LOW_STOCK',
    },
  });

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
