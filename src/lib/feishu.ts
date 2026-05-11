import { prisma } from './db';

const FEISHU_BASE = process.env.FEISHU_BASE_URL || 'https://open.feishu.cn';
const APP_ID = process.env.FEISHU_APP_ID!;
const APP_SECRET = process.env.FEISHU_APP_SECRET!;

let tenantTokenCache: { token: string; expiresAt: number } | null = null;

export async function getTenantAccessToken(): Promise<string> {
  if (tenantTokenCache && Date.now() < tenantTokenCache.expiresAt) {
    return tenantTokenCache.token;
  }

  const res = await fetch(`${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });

  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`Failed to get tenant token: ${data.msg}`);
  }

  tenantTokenCache = {
    token: data.tenant_access_token,
    expiresAt: Date.now() + (data.expire - 300) * 1000,
  };
  return tenantTokenCache.token;
}

export async function getUserAccessToken(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  open_id: string;
  union_id: string;
  name: string;
  en_name: string;
  avatar_url: string;
  expires_in: number;
  refresh_expires_in: number;
}> {
  const tenantToken = await getTenantAccessToken();

  // Step 1: Exchange code for access token
  const tokenRes = await fetch(`${FEISHU_BASE}/open-apis/authen/v1/oidc/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tenantToken}`,
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
    }),
  });

  const tokenData = await tokenRes.json();
  if (tokenData.code !== 0) {
    throw new Error(`Failed to get user token: ${tokenData.msg}`);
  }

  const { access_token, refresh_token, expires_in, refresh_expires_in } = tokenData.data;

  // Step 2: Get user info with the access token
  const userRes = await fetch(`${FEISHU_BASE}/open-apis/authen/v1/user_info`, {
    headers: {
      'Authorization': `Bearer ${access_token}`,
    },
  });

  const userData = await userRes.json();
  if (userData.code !== 0) {
    throw new Error(`Failed to get user info: ${userData.msg}`);
  }

  return {
    access_token,
    refresh_token,
    expires_in,
    refresh_expires_in,
    open_id: userData.data.open_id,
    union_id: userData.data.union_id,
    name: userData.data.name,
    en_name: userData.data.en_name || '',
    avatar_url: userData.data.avatar_url || '',
  };
}

/**
 * Refresh a user access token using the refresh token.
 */
async function refreshUserToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
}> {
  const tenantToken = await getTenantAccessToken();

  const res = await fetch(`${FEISHU_BASE}/open-apis/authen/v1/oidc/refresh_access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tenantToken}`,
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`Failed to refresh user token: ${data.msg}`);
  }

  return data.data;
}

/**
 * Get a valid user access token for the given employee.
 * Automatically refreshes if expired.
 * Falls back to tenant token if no user token available.
 */
export async function getValidUserToken(employeeId: number): Promise<string> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { accessToken: true, refreshToken: true, tokenExpiresAt: true },
  });

  if (!employee?.accessToken || !employee?.refreshToken) {
    // No user token stored, fall back to tenant token
    return getTenantAccessToken();
  }

  // Check if token is still valid (with 5-min buffer)
  if (employee.tokenExpiresAt && employee.tokenExpiresAt > new Date(Date.now() + 300_000)) {
    return employee.accessToken;
  }

  // Token expired, refresh it
  try {
    const refreshed = await refreshUserToken(employee.refreshToken);

    await prisma.employee.update({
      where: { id: employeeId },
      data: {
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token,
        tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
      },
    });

    return refreshed.access_token;
  } catch {
    // Refresh failed (e.g. refresh token also expired), fall back to tenant token
    console.warn(`User token refresh failed for employee ${employeeId}, falling back to tenant token`);
    return getTenantAccessToken();
  }
}

export async function feishuApi(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
  } = {}
): Promise<unknown> {
  const token = options.token || (await getTenantAccessToken());

  const res = await fetch(`${FEISHU_BASE}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`Feishu API error [${path}]: ${data.msg} (code: ${data.code})`);
  }

  return data.data;
}

export function getOAuthUrl(redirectUri: string, state?: string): string {
  const params = new URLSearchParams({
    app_id: APP_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    state: state || '',
  });
  return `${FEISHU_BASE}/open-apis/authen/v1/authorize?${params.toString()}`;
}

/**
 * Upload a file to Feishu approval system.
 * Returns a file key that can be used in attachmentV2 widget.
 */
export async function uploadApprovalFile(
  filePath: string,
  fileName: string,
  mimeType: string,
): Promise<string> {
  const token = await getTenantAccessToken();
  const fs = await import('fs');
  const fileBuffer = fs.readFileSync(filePath);

  const formData = new FormData();
  formData.append('name', fileName);
  formData.append('type', 'attachment');
  formData.append('content', new Blob([fileBuffer], { type: mimeType }), fileName);

  const res = await fetch(`${FEISHU_BASE}/open-apis/approval/v4/files/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    body: formData,
  });

  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`Failed to upload approval file: ${data.msg} (code: ${data.code})`);
  }

  return data.data.code; // file key
}

export async function createApprovalInstance(params: {
  approvalCode: string;
  openId: string;
  form: Record<string, unknown>[];
}): Promise<string> {
  const data = await feishuApi('/open-apis/approval/v4/instances', {
    method: 'POST',
    body: {
      approval_code: params.approvalCode,
      open_id: params.openId,
      form: JSON.stringify(params.form),
    },
  }) as { instance_code: string };

  return data.instance_code;
}

/**
 * List all approval instance codes for a given approval definition.
 * Requires start_time and end_time in milliseconds.
 */
export async function listApprovalInstances(approvalCode: string, startTimeMs: number, endTimeMs: number): Promise<string[]> {
  const allCodes: string[] = [];
  let pageToken = '';

  do {
    const params = new URLSearchParams({
      approval_code: approvalCode,
      start_time: String(startTimeMs),
      end_time: String(endTimeMs),
      page_size: '100',
    });
    if (pageToken) params.set('page_token', pageToken);

    const data = await feishuApi(`/open-apis/approval/v4/instances?${params}`) as {
      instance_code_list: string[];
      has_more: boolean;
      page_token?: string;
    };

    allCodes.push(...(data.instance_code_list || []));
    pageToken = data.has_more ? (data.page_token || '') : '';
  } while (pageToken);

  return allCodes;
}

/**
 * Get full approval instance details including form data and task list.
 */
export async function getApprovalInstance(instanceCode: string): Promise<{
  status: string;
  open_id: string;
  start_time: string;
  end_time: string;
  form: string;
  task_list: {
    id: string;
    open_id: string;
    user_id: string;
    status: string;
    node_name?: string;
  }[];
  timeline: {
    type: string;
    user_id?: string;
    open_id?: string;
    comment?: string;
  }[];
}> {
  const data = await feishuApi(
    `/open-apis/approval/v4/instances/${instanceCode}`
  ) as {
    status: string;
    open_id: string;
    start_time: string;
    end_time: string;
    form: string;
    task_list: { id: string; open_id: string; user_id: string; status: string; node_name?: string }[];
    timeline: { type: string; user_id?: string; open_id?: string; comment?: string }[];
  };

  return data;
}

/**
 * Approve an approval task in Feishu.
 * Uses open_id as the user identifier.
 */
export async function approveTask(params: {
  approvalCode: string;
  instanceCode: string;
  openId: string;
  taskId: string;
  comment?: string;
}): Promise<void> {
  await feishuApi('/open-apis/approval/v4/tasks/approve?user_id_type=open_id', {
    method: 'POST',
    body: {
      approval_code: params.approvalCode,
      instance_code: params.instanceCode,
      user_id: params.openId,
      task_id: params.taskId,
      comment: params.comment || 'Approved via web',
    },
  });
}

/**
 * Reject an approval task in Feishu.
 * Uses open_id as the user identifier.
 */
export async function rejectTask(params: {
  approvalCode: string;
  instanceCode: string;
  openId: string;
  taskId: string;
  comment?: string;
}): Promise<void> {
  await feishuApi('/open-apis/approval/v4/tasks/reject?user_id_type=open_id', {
    method: 'POST',
    body: {
      approval_code: params.approvalCode,
      instance_code: params.instanceCode,
      user_id: params.openId,
      task_id: params.taskId,
      comment: params.comment || 'Rejected via web',
    },
  });
}

/**
 * Send a simple text card message via bot.
 */
export async function sendBotMessage(openId: string, content: {
  title: string;
  content: string;
}): Promise<void> {
  await feishuApi('/open-apis/im/v1/messages?receive_id_type=open_id', {
    method: 'POST',
    body: {
      receive_id: openId,
      msg_type: 'interactive',
      content: JSON.stringify({
        config: { wide_screen_mode: true },
        header: {
          title: { tag: 'plain_text', content: content.title },
          template: 'blue',
        },
        elements: [
          { tag: 'markdown', content: content.content },
        ],
      }),
    },
  });
}
