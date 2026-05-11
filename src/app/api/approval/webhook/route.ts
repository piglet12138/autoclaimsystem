import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { processApprovedClaim } from '@/lib/calculator';
import { createHash } from 'crypto';

const VERIFICATION_TOKEN = process.env.FEISHU_VERIFICATION_TOKEN || '';
const ENCRYPT_KEY = process.env.FEISHU_ENCRYPT_KEY || '';

/**
 * Decrypt Feishu event body if encrypt_key is configured.
 */
function decryptBody(encrypt: string): string {
  if (!ENCRYPT_KEY) return encrypt;
  const crypto = require('crypto');
  const key = createHash('sha256').update(ENCRYPT_KEY).digest();
  const encryptedBuf = Buffer.from(encrypt, 'base64');
  const iv = encryptedBuf.subarray(0, 16);
  const data = encryptedBuf.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(data, undefined, 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Feishu Approval webhook callback.
 * Supports both v1 (challenge) and v2 (event subscription) formats.
 * Works behind self-signed HTTPS reverse proxy.
 */
export async function POST(request: NextRequest) {
  let body = await request.json();

  // Handle encrypted events
  if (body.encrypt) {
    try {
      const decrypted = decryptBody(body.encrypt);
      body = JSON.parse(decrypted);
    } catch (error) {
      console.error('Failed to decrypt webhook body:', error);
      return NextResponse.json({ error: 'Decryption failed' }, { status: 400 });
    }
  }

  // Handle Feishu webhook URL verification challenge
  if (body.challenge) {
    return NextResponse.json({ challenge: body.challenge });
  }

  // Verify token if configured (v1 events)
  if (VERIFICATION_TOKEN && body.token && body.token !== VERIFICATION_TOKEN) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
  }

  // v2 event format: header + event
  const eventType = body.header?.event_type || body.type;
  const event = body.event || body;

  // Handle approval task status change (v2)
  if (eventType === 'approval.instance.status_changed' ||
      eventType === 'approval_instance') {
    const instanceCode = event.instance_code || event.instance_code;
    const status = event.status; // APPROVED, REJECTED, CANCELED, DELETED

    if (!instanceCode) {
      return NextResponse.json({ ok: true });
    }

    const claim = await prisma.claim.findFirst({
      where: { approvalInstanceId: instanceCode },
    });

    if (!claim || claim.status !== 'pending') {
      return NextResponse.json({ ok: true });
    }

    if (status === 'APPROVED') {
      await prisma.claim.update({
        where: { id: claim.id },
        data: {
          status: 'approved',
          approvedAt: new Date(),
        },
      });
      await processApprovedClaim(claim.id);
      console.log(`[Webhook] Claim #${claim.id} approved via Feishu`);
    } else if (status === 'REJECTED' || status === 'CANCELED' || status === 'DELETED') {
      await prisma.claim.update({
        where: { id: claim.id },
        data: {
          status: 'rejected',
          approvedAt: new Date(),
          rejectReason: event.comment || `${status.toLowerCase()} via Feishu`,
        },
      });
      console.log(`[Webhook] Claim #${claim.id} ${status.toLowerCase()} via Feishu`);
    }
  }

  return NextResponse.json({ ok: true });
}
