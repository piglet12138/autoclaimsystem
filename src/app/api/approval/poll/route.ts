import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { listApprovalInstances, getApprovalInstance } from '@/lib/feishu';
import { processApprovedClaim, calculateTotalMonths, calculateMonthlyAmount } from '@/lib/calculator';

const APPROVAL_CODE = process.env.FEISHU_APPROVAL_CODE || '';

interface FormField {
  custom_id: string;
  type: string;
  name: string;
  value: unknown;
  option?: { key: string; text: string };
}

/**
 * Parse form fields from a Feishu approval instance into claim data.
 */
function parseFormData(formJson: string): {
  category: string;
  price: number;
  startDate: Date;
  endDate: Date;
} | null {
  try {
    const fields: FormField[] = JSON.parse(formJson);
    let category = '';
    let price = 0;
    let startDate = '';
    let endDate = '';

    for (const f of fields) {
      switch (f.custom_id) {
        case 'widget1': // category (radioV2)
          category = typeof f.value === 'string' ? f.value : (f.option?.text || '');
          break;
        case 'widget2': // price (number)
          price = typeof f.value === 'number' ? f.value : parseFloat(String(f.value));
          break;
        case 'widget3': // start date
          startDate = String(f.value);
          break;
        case 'widget4': // end date
          endDate = String(f.value);
          break;
      }
    }

    if (!category || !price || !startDate || !endDate) return null;

    return {
      category,
      price,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
    };
  } catch {
    return null;
  }
}

/**
 * Poll Feishu approval instances:
 * 1. Discover new submissions and create claim records
 * 2. Sync status changes for existing pending claims
 */
export async function POST() {
  if (!APPROVAL_CODE) {
    return NextResponse.json({ error: 'FEISHU_APPROVAL_CODE not configured' }, { status: 400 });
  }

  // Time range: from Jan 1 of current year to now
  const now = Date.now();
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();

  let newClaims = 0;
  let approved = 0;
  let rejected = 0;
  let unchanged = 0;
  const errors: string[] = [];

  try {
    // Step 1: List all instance codes from Feishu
    const instanceCodes = await listApprovalInstances(APPROVAL_CODE, yearStart, now);

    // Step 2: Find which ones we already have in DB
    const existingClaims = await prisma.claim.findMany({
      where: { approvalInstanceId: { in: instanceCodes } },
      select: { id: true, approvalInstanceId: true, status: true },
    });
    const existingMap = new Map(
      existingClaims.map((c) => [c.approvalInstanceId!, c])
    );

    // Step 3: Process each instance
    for (const code of instanceCodes) {
      try {
        const existing = existingMap.get(code);

        if (!existing) {
          // New instance — fetch details and create claim
          const instance = await getApprovalInstance(code);
          const formData = parseFormData(instance.form);
          if (!formData) {
            errors.push(`Instance ${code}: failed to parse form data`);
            continue;
          }

          // Find or create employee by open_id
          let employee = await prisma.employee.findUnique({
            where: { feishuUid: instance.open_id },
          });
          if (!employee) {
            employee = await prisma.employee.create({
              data: { feishuUid: instance.open_id },
            });
          }

          const totalMonths = calculateTotalMonths(formData.startDate, formData.endDate);
          const monthlyAmount = calculateMonthlyAmount(formData.price, totalMonths);

          // Map Feishu status to our status
          let status = 'pending';
          if (instance.status === 'APPROVED') status = 'approved';
          else if (['REJECTED', 'CANCELED', 'DELETED'].includes(instance.status)) status = 'rejected';

          const claim = await prisma.claim.create({
            data: {
              employeeId: employee.id,
              category: formData.category,
              price: formData.price,
              startDate: formData.startDate,
              endDate: formData.endDate,
              totalMonths,
              monthlyAmount: parseFloat(monthlyAmount.toFixed(3)),
              status,
              approvalInstanceId: code,
              submittedAt: new Date(parseInt(instance.start_time)),
              approvedAt: status !== 'pending' ? new Date() : null,
            },
          });

          // If already approved at discovery time, process immediately
          if (status === 'approved') {
            await processApprovedClaim(claim.id);
            approved++;
          }
          newClaims++;

        } else if (existing.status === 'pending') {
          // Existing pending claim — check for status update
          const instance = await getApprovalInstance(code);

          if (instance.status === 'APPROVED') {
            await prisma.claim.update({
              where: { id: existing.id },
              data: { status: 'approved', approvedAt: new Date() },
            });
            await processApprovedClaim(existing.id);
            approved++;
          } else if (['REJECTED', 'CANCELED', 'DELETED'].includes(instance.status)) {
            const rejectEvent = instance.timeline?.find((t) => t.type === 'REJECT');
            await prisma.claim.update({
              where: { id: existing.id },
              data: {
                status: 'rejected',
                approvedAt: new Date(),
                rejectReason: rejectEvent?.comment || `${instance.status.toLowerCase()} via Feishu`,
              },
            });
            rejected++;
          } else {
            unchanged++;
          }
        }
      } catch (err) {
        errors.push(`Instance ${code}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
  } catch (err) {
    return NextResponse.json({
      error: 'Failed to list instances',
      detail: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 });
  }

  return NextResponse.json({
    total: newClaims + approved + rejected + unchanged,
    newClaims,
    approved,
    rejected,
    unchanged,
    errors: errors.length > 0 ? errors : undefined,
  });
}
