import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createSession } from '@/lib/auth';

/**
 * Dev-only login endpoint that bypasses Feishu OAuth.
 * Creates/updates dev user with admin privileges, redirects to admin management.
 */
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  const devUid = 'ou_dev_user_001';

  // Ensure dev user exists and is admin
  let employee = await prisma.employee.findUnique({ where: { feishuUid: devUid } });
  if (employee) {
    if (!employee.isAdmin) {
      await prisma.employee.update({ where: { id: employee.id }, data: { isAdmin: true } });
    }
  } else {
    employee = await prisma.employee.create({
      data: { feishuUid: devUid, nameCn: 'Dev User', nameEn: 'Dev User', isAdmin: true },
    });
  }

  await createSession({
    open_id: devUid,
    name: 'Dev User',
    en_name: 'Dev User',
    avatar_url: '',
  });

  return NextResponse.redirect(new URL('/dev', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'));
}
