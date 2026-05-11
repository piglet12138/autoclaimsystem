import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { prisma } from './db';
import type { SessionUser } from '@/types';

const JWT_SECRET = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET || 'dev-secret-change-in-production'
);
const COOKIE_NAME = 'autoclaim_session';

export async function createSession(user: {
  open_id: string;
  name: string;
  en_name?: string;
  avatar_url?: string;
}): Promise<{ id: number; feishuUid: string }> {
  // Find or create employee record
  let employee = await prisma.employee.findUnique({
    where: { feishuUid: user.open_id },
  });

  if (!employee) {
    employee = await prisma.employee.create({
      data: {
        feishuUid: user.open_id,
        nameCn: user.name,
        nameEn: user.en_name || null,
      },
    });
  }

  const token = await new SignJWT({
    feishuUid: user.open_id,
    name: user.name,
    nameEn: user.en_name,
    avatar: user.avatar_url,
    employeeId: employee.id,
    isAdmin: employee.isAdmin,
  } satisfies SessionUser)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(JWT_SECRET);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NEXT_PUBLIC_APP_URL?.startsWith('https'),
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60,
    path: '/',
  });

  return { id: employee.id, feishuUid: employee.feishuUid };
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as SessionUser;
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    throw new Error('Unauthorized');
  }
  return session;
}

export async function requireAdmin(): Promise<SessionUser> {
  const session = await requireSession();
  if (!session.isAdmin) {
    throw new Error('Forbidden: admin access required');
  }
  return session;
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
