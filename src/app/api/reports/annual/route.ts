import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { calculateAnnualCap } from '@/lib/calculator';

export async function GET(request: NextRequest) {
  await requireAdmin();

  const year = parseInt(
    request.nextUrl.searchParams.get('year') || new Date().getFullYear().toString(),
    10
  );

  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);

  const payments = await prisma.monthlyPayment.findMany({
    where: { month: { gte: yearStart, lte: yearEnd } },
    include: { employee: true },
    orderBy: [{ employeeId: 'asc' }, { month: 'asc' }],
  });

  // Aggregate per employee
  const employeeMap = new Map<number, {
    employeeId: number;
    name: string;
    department: string;
    annualCap: number;
    totalClaimed: number;
    totalPaid: number;
    byCategory: Record<string, number>;
    // byMonth: { monthKey -> { total, byCategory: { cat -> pay } } }
    byMonth: Record<string, { total: number; byCategory: Record<string, number> }>;
  }>();

  for (const p of payments) {
    if (!employeeMap.has(p.employeeId)) {
      const cap = calculateAnnualCap(p.employee.hireDate, year);
      employeeMap.set(p.employeeId, {
        employeeId: p.employeeId,
        name: p.employee.nameEn || p.employee.nameCn || `Employee ${p.employeeId}`,
        department: p.employee.department || '',
        annualCap: cap,
        totalClaimed: 0,
        totalPaid: 0,
        byCategory: {},
        byMonth: {},
      });
    }

    const entry = employeeMap.get(p.employeeId)!;
    const amount = Number(p.amount);
    const pay = Number(p.actuallyPay || 0);
    const monthStr = p.month.toISOString().slice(0, 7);

    entry.totalClaimed += amount;
    entry.totalPaid += pay;
    entry.byCategory[p.category] = (entry.byCategory[p.category] || 0) + pay;

    if (!entry.byMonth[monthStr]) {
      entry.byMonth[monthStr] = { total: 0, byCategory: {} };
    }
    entry.byMonth[monthStr].total += pay;
    entry.byMonth[monthStr].byCategory[p.category] =
      (entry.byMonth[monthStr].byCategory[p.category] || 0) + pay;
  }

  const data = Array.from(employeeMap.values()).map((e) => ({
    ...e,
    remaining: Math.max(0, e.annualCap - e.totalPaid),
  }));

  return NextResponse.json({ year, data });
}
