import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { feishuApi, getValidUserToken } from '@/lib/feishu';

const BITABLE_TOKEN = process.env.FEISHU_BITABLE_TOKEN!;
const DEPT_TABLE_ID = process.env.FEISHU_DEPT_TABLE_ID!;

interface BitableRecord {
  record_id: string;
  fields: {
    '工号'?: string;
    '常用本地全名'?: string;
    '常用英文全名'?: string;
    '部门名称'?: string;
    '当前雇佣记录的入职日期'?: number;
    'SourceID'?: string;
  };
}

/**
 * Extract open_id from Bitable SourceID.
 * SourceID is base64 encoded: "xxx:ou_abc123-工号:hash:1"
 * We extract the "ou_xxx" part as the feishu open_id.
 */
function extractOpenId(sourceId: string): string | null {
  try {
    const decoded = Buffer.from(sourceId, 'base64').toString('utf-8');
    const match = decoded.match(/ou_[a-f0-9]+/);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

/**
 * Sync employees from Feishu Bitable department table.
 * Uses the current admin user's access token (user token has bitable permissions).
 * Extracts open_id from SourceID so OAuth login can match employee records.
 */
export async function POST() {
  const session = await requireAdmin();

  try {
    const token = await getValidUserToken(session.employeeId!);
    let hasMore = true;
    let pageToken: string | undefined;
    let synced = 0;
    let skipped = 0;

    while (hasMore) {
      const params = new URLSearchParams({ page_size: '200' });
      if (pageToken) params.set('page_token', pageToken);

      const data = await feishuApi(
        `/open-apis/bitable/v1/apps/${BITABLE_TOKEN}/tables/${DEPT_TABLE_ID}/records?${params}`,
        { token }
      ) as { items: BitableRecord[]; has_more: boolean; page_token?: string };

      for (const record of data.items || []) {
        const fields = record.fields;
        const sourceId = fields['SourceID'];
        if (!sourceId) continue;

        // Extract open_id from SourceID for OAuth matching
        const openId = extractOpenId(sourceId);
        if (!openId) {
          skipped++;
          continue;
        }

        // Parse department name (could be JSON array with lang variants)
        let department = fields['部门名称'] || '';
        if (typeof department === 'string' && department.startsWith('[')) {
          try {
            const parsed = JSON.parse(department) as { lang: string; value: string }[];
            const en = parsed.find((p) => p.lang === 'en-US');
            department = en?.value || parsed[0]?.value || '';
          } catch {
            // keep as-is
          }
        }

        // Parse hire date (millisecond timestamp)
        let hireDate: Date | null = null;
        const hireDateMs = fields['当前雇佣记录的入职日期'];
        if (hireDateMs && hireDateMs > 0) {
          hireDate = new Date(hireDateMs);
        }

        await prisma.employee.upsert({
          where: { feishuUid: openId },
          update: {
            employeeNo: fields['工号'] || null,
            nameCn: fields['常用本地全名'] || null,
            nameEn: fields['常用英文全名'] || null,
            department,
            hireDate,
            isActive: true,
            syncedAt: new Date(),
          },
          create: {
            feishuUid: openId,
            employeeNo: fields['工号'] || null,
            nameCn: fields['常用本地全名'] || null,
            nameEn: fields['常用英文全名'] || null,
            department,
            hireDate,
            isActive: true,
            syncedAt: new Date(),
          },
        });
        synced++;
      }

      hasMore = data.has_more;
      pageToken = data.page_token;
    }

    return NextResponse.json({
      message: `Synced ${synced} employees${skipped > 0 ? `, ${skipped} skipped (no open_id)` : ''}`,
      synced,
      skipped,
    });
  } catch (error) {
    console.error('Employee sync error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to sync employees', detail: msg },
      { status: 500 }
    );
  }
}
