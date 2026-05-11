import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const SUPER_ADMIN_UID = process.env.SUPER_ADMIN_UID || '';

/**
 * GET: List all employees with admin status
 */
export async function GET() {
  const employees = await prisma.employee.findMany({
    select: {
      id: true,
      feishuUid: true,
      nameCn: true,
      nameEn: true,
      department: true,
      isAdmin: true,
    },
    where: { isActive: true },
    orderBy: [{ isAdmin: 'desc' }, { nameEn: 'asc' }],
  });

  return NextResponse.json({ employees });
}

/**
 * POST: Create or find employee and set as admin
 * Body: { openId: string, name?: string }
 * Used when employee list is empty (bootstrap scenario)
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { openId, name } = body;

  if (!openId || typeof openId !== 'string') {
    return NextResponse.json({ error: 'openId is required' }, { status: 400 });
  }

  const employee = await prisma.employee.upsert({
    where: { feishuUid: openId },
    update: { isAdmin: true },
    create: {
      feishuUid: openId,
      nameEn: name || null,
      isAdmin: true,
      isActive: true,
    },
  });

  return NextResponse.json({
    message: `${employee.nameEn || employee.feishuUid} is now admin`,
    employee: { id: employee.id, feishuUid: employee.feishuUid, nameEn: employee.nameEn },
  });
}

/**
 * PATCH: Toggle admin status for an employee
 * Body: { employeeId: number, isAdmin: boolean }
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { employeeId, isAdmin } = body;

  if (typeof employeeId !== 'number' || typeof isAdmin !== 'boolean') {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
  }

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) {
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
  }
  if (employee.feishuUid === SUPER_ADMIN_UID && !isAdmin) {
    return NextResponse.json({ error: 'Cannot remove super admin' }, { status: 400 });
  }

  await prisma.employee.update({
    where: { id: employeeId },
    data: { isAdmin },
  });

  return NextResponse.json({
    message: `${employee.nameEn || employee.nameCn} is now ${isAdmin ? 'admin' : 'employee'}`,
  });
}
