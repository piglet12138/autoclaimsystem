import { NextRequest, NextResponse } from 'next/server';
import { getUserAccessToken } from '@/lib/feishu';
import { createSession } from '@/lib/auth';
import { prisma } from '@/lib/db';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  if (!code) {
    return NextResponse.json({ error: 'Missing code' }, { status: 400 });
  }

  try {
    const userData = await getUserAccessToken(code);

    const employee = await createSession({
      open_id: userData.open_id,
      name: userData.name,
      en_name: userData.en_name,
      avatar_url: userData.avatar_url,
    });

    // Store user access token and refresh token for API calls
    await prisma.employee.update({
      where: { id: employee.id },
      data: {
        accessToken: userData.access_token,
        refreshToken: userData.refresh_token,
        tokenExpiresAt: userData.expires_in
          ? new Date(Date.now() + userData.expires_in * 1000)
          : null,
      },
    });

    // Check if admin to redirect appropriately
    const emp = await prisma.employee.findUnique({
      where: { id: employee.id },
      select: { isAdmin: true },
    });

    const state = request.nextUrl.searchParams.get('state');
    if (state && state !== '/') {
      return NextResponse.redirect(new URL(state, APP_URL));
    }

    // Admin → admin panel, non-admin → no access
    const redirectPath = emp?.isAdmin ? '/admin/approvals' : '/login?error=not_admin';
    return NextResponse.redirect(new URL(redirectPath, APP_URL));
  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.redirect(new URL('/login?error=auth_failed', APP_URL));
  }
}
