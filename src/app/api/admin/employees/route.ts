import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export async function GET() {
  await requireAdmin();

  const employees = await prisma.employee.findMany({
    orderBy: [{ isActive: 'desc' }, { nameEn: 'asc' }],
  });

  return NextResponse.json({ employees });
}
