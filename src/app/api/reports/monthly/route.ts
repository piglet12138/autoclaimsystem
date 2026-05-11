import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export async function GET(request: NextRequest) {
  await requireAdmin();

  const searchParams = request.nextUrl.searchParams;
  const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString(), 10);
  const month = searchParams.get('month') ? parseInt(searchParams.get('month')!, 10) : null;

  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);

  const where: Record<string, unknown> = {
    month: { gte: yearStart, lte: yearEnd },
  };

  if (month !== null) {
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);
    where.month = { gte: monthStart, lte: monthEnd };
  }

  const payments = await prisma.monthlyPayment.findMany({
    where,
    include: {
      employee: { select: { nameCn: true, nameEn: true, department: true } },
      claim: { select: { category: true } },
    },
    orderBy: [{ month: 'asc' }, { employeeId: 'asc' }],
  });

  // Aggregate by employee + month
  const summary = new Map<string, {
    employeeName: string;
    department: string;
    month: string;
    totalAmount: number;
    actuallyPay: number;
    categories: Record<string, number>;
  }>();

  for (const p of payments) {
    const monthStr = p.month.toISOString().slice(0, 7);
    const key = `${p.employeeId}-${monthStr}`;

    if (!summary.has(key)) {
      summary.set(key, {
        employeeName: p.employee.nameEn || p.employee.nameCn || '',
        department: p.employee.department || '',
        month: monthStr,
        totalAmount: 0,
        actuallyPay: 0,
        categories: {},
      });
    }

    const entry = summary.get(key)!;
    const amount = Number(p.amount);
    const pay = Number(p.actuallyPay || 0);
    entry.totalAmount += amount;
    entry.actuallyPay += pay;
    entry.categories[p.category] = (entry.categories[p.category] || 0) + pay;
  }

  return NextResponse.json({
    year,
    month,
    data: Array.from(summary.values()),
  });
}
