import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

/**
 * List all claims (admin only).
 * Claims are created by the poller from Feishu approval instances.
 */
export async function GET(request: NextRequest) {
  await requireAdmin();
  const searchParams = request.nextUrl.searchParams;

  const where: Record<string, unknown> = {};
  const status = searchParams.get('status');
  if (status) {
    where.status = status;
  }

  const claims = await prisma.claim.findMany({
    where,
    include: {
      employee: { select: { nameCn: true, nameEn: true, department: true } },
    },
    orderBy: { submittedAt: 'desc' },
    take: 100,
  });

  return NextResponse.json({ claims });
}
