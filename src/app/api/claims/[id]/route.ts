import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { processApprovedClaim } from '@/lib/calculator';
import { getApprovalInstance, approveTask, rejectTask } from '@/lib/feishu';

const APPROVAL_CODE = process.env.FEISHU_APPROVAL_CODE || '';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin();
  const { id } = await params;
  const claimId = parseInt(id, 10);

  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: {
      employee: { select: { nameCn: true, nameEn: true, department: true, feishuUid: true } },
      monthlyPayments: { orderBy: { month: 'asc' } },
    },
  });

  if (!claim) {
    return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
  }

  return NextResponse.json({ claim });
}

/**
 * Admin action: approve or reject a claim.
 * Syncs back to Feishu if the claim has an approval instance.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  const { id } = await params;
  const claimId = parseInt(id, 10);
  const body = await request.json();
  const { action, rejectReason } = body;

  if (!['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const claim = await prisma.claim.findUnique({ where: { id: claimId } });
  if (!claim) {
    return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
  }

  if (claim.status !== 'pending') {
    return NextResponse.json({ error: 'Claim already processed' }, { status: 400 });
  }

  // Sync to Feishu if approval instance exists
  if (claim.approvalInstanceId && APPROVAL_CODE) {
    try {
      const instance = await getApprovalInstance(claim.approvalInstanceId);
      // Find the pending task
      const pendingTask = instance.task_list?.find((t) => t.status === 'PENDING');

      if (pendingTask) {
        if (action === 'approve') {
          await approveTask({
            approvalCode: APPROVAL_CODE,
            instanceCode: claim.approvalInstanceId,
            openId: pendingTask.open_id,
            taskId: pendingTask.id,
            comment: 'Approved via web admin',
          });
        } else {
          await rejectTask({
            approvalCode: APPROVAL_CODE,
            instanceCode: claim.approvalInstanceId,
            openId: pendingTask.open_id,
            taskId: pendingTask.id,
            comment: rejectReason || 'Rejected via web admin',
          });
        }
      }
    } catch (error) {
      console.error('Failed to sync approval to Feishu:', error);
      // Continue with local update even if Feishu sync fails
    }
  }

  if (action === 'approve') {
    await prisma.claim.update({
      where: { id: claimId },
      data: {
        status: 'approved',
        approverUid: session.feishuUid,
        approvedAt: new Date(),
      },
    });
    await processApprovedClaim(claimId);
    return NextResponse.json({ message: 'Claim approved' });
  } else {
    await prisma.claim.update({
      where: { id: claimId },
      data: {
        status: 'rejected',
        approverUid: session.feishuUid,
        approvedAt: new Date(),
        rejectReason: rejectReason || null,
      },
    });
    return NextResponse.json({ message: 'Claim rejected' });
  }
}
