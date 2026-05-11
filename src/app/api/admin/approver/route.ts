import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getTenantAccessToken } from '@/lib/feishu';

const FEISHU_BASE = process.env.FEISHU_BASE_URL || 'https://open.feishu.cn';
const APPROVAL_CODE = process.env.FEISHU_APPROVAL_CODE || '';

/**
 * GET: Get current approver from our config table
 */
export async function GET() {
  await requireAdmin();

  const config = await prisma.config.findUnique({ where: { key: 'approver' } });
  const data = config?.value as { openId?: string; name?: string } | null;

  return NextResponse.json({
    approverOpenId: data?.openId || null,
    approverName: data?.name || null,
  });
}

/**
 * PUT: Update the approver — saves to config AND updates Feishu approval definition
 * Body: { openId: string }
 */
export async function PUT(request: NextRequest) {
  await requireAdmin();

  const body = await request.json();
  const { openId } = body;

  if (!openId || typeof openId !== 'string') {
    return NextResponse.json({ error: 'openId is required' }, { status: 400 });
  }

  // Look up employee name
  const employee = await prisma.employee.findUnique({
    where: { feishuUid: openId },
    select: { nameEn: true, nameCn: true },
  });
  const name = employee?.nameEn || employee?.nameCn || openId;

  try {
    const token = await getTenantAccessToken();

    // Update Feishu approval definition
    const form = [
      { id: 'widget1', custom_id: 'widget1', name: '@i18n@cat', type: 'radioV2',
        value: [{ key: '1', text: '@i18n@vision' }, { key: '2', text: '@i18n@wellness' }, { key: '3', text: '@i18n@insurance' }],
        required: true },
      { id: 'widget2', custom_id: 'widget2', name: '@i18n@amount', type: 'number', required: true },
      { id: 'widget3', custom_id: 'widget3', name: '@i18n@start_date', type: 'date', required: true, value: 'YYYY-MM-DD' },
      { id: 'widget4', custom_id: 'widget4', name: '@i18n@end_date', type: 'date', required: true, value: 'YYYY-MM-DD' },
      { id: 'widget5', custom_id: 'widget5', name: '@i18n@attachment', type: 'attachmentV2', required: true },
    ];

    const textsZh = [
      { key: '@i18n@approval_name', value: '弹性福利报销申请' },
      { key: '@i18n@node_start', value: '开始' }, { key: '@i18n@node_hr', value: 'HR审批' },
      { key: '@i18n@node_end', value: '结束' }, { key: '@i18n@cat', value: '类别' },
      { key: '@i18n@vision', value: 'Vision' }, { key: '@i18n@wellness', value: 'Wellness Program' },
      { key: '@i18n@insurance', value: 'Insurance' }, { key: '@i18n@amount', value: '金额 (SGD)' },
      { key: '@i18n@start_date', value: '开始日期' }, { key: '@i18n@end_date', value: '结束日期' },
      { key: '@i18n@attachment', value: '附件（发票/收据）' },
    ];
    const textsEn = [
      { key: '@i18n@approval_name', value: 'Flexi-Benefits Claim' },
      { key: '@i18n@node_start', value: 'Start' }, { key: '@i18n@node_hr', value: 'HR Approval' },
      { key: '@i18n@node_end', value: 'End' }, { key: '@i18n@cat', value: 'Category' },
      { key: '@i18n@vision', value: 'Vision' }, { key: '@i18n@wellness', value: 'Wellness Program' },
      { key: '@i18n@insurance', value: 'Insurance' }, { key: '@i18n@amount', value: 'Amount (SGD)' },
      { key: '@i18n@start_date', value: 'Start Date' }, { key: '@i18n@end_date', value: 'End Date' },
      { key: '@i18n@attachment', value: 'Attachment (Invoice/Receipt)' },
    ];

    const payload = {
      approval_code: APPROVAL_CODE,
      approval_name: '@i18n@approval_name',
      viewers: [{ viewer_type: 'TENANT' }],
      node_list: [
        { id: 'START', name: '@i18n@node_start', node_type: 'AND', approver: [] },
        {
          id: 'approve_node', name: '@i18n@node_hr', custom_node_id: 'approve_node',
          node_type: 'AND', approver: [{ type: 'Personal', user_id: openId }],
        },
        { id: 'END', name: '@i18n@node_end', node_type: 'AND', approver: [] },
      ],
      form: { form_content: JSON.stringify(form) },
      i18n_resources: [
        { locale: 'zh-CN', is_default: true, texts: textsZh },
        { locale: 'en-US', is_default: false, texts: textsEn },
      ],
    };

    const res = await fetch(`${FEISHU_BASE}/open-apis/approval/v4/approvals?user_id_type=open_id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (result.code !== 0) {
      throw new Error(`Feishu: ${result.msg} (code: ${result.code})`);
    }

    // Save to our config table
    await prisma.config.upsert({
      where: { key: 'approver' },
      update: { value: { openId, name } },
      create: { key: 'approver', value: { openId, name } },
    });

    return NextResponse.json({ message: `Approver updated to ${name}` });
  } catch (error) {
    console.error('Failed to update approver:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Failed: ${msg}` }, { status: 500 });
  }
}
