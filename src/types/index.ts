export interface FeishuUser {
  open_id: string;
  union_id?: string;
  name: string;
  en_name?: string;
  avatar_url?: string;
  email?: string;
  employee_no?: string;
}

export interface SessionUser {
  feishuUid: string;
  name: string;
  nameEn?: string;
  avatar?: string;
  employeeId?: number;
  isAdmin: boolean;
}

export type ClaimCategory = 'Vision' | 'Wellness Program' | 'Insurance';

export type ClaimStatus = 'pending' | 'approved' | 'rejected';

export interface ClaimFormData {
  category: ClaimCategory;
  price: number;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  attachment?: File;
}

export interface MonthlyBreakdown {
  month: Date;
  amount: number;
  actuallyPay: number;
}

export interface AnnualSummary {
  employeeId: number;
  employeeName: string;
  department: string;
  annualCap: number;
  totalClaimed: number;
  totalPaid: number;
  remaining: number;
  byCategory: Record<ClaimCategory, number>;
  byMonth: MonthlyBreakdown[];
}

export interface FeishuApprovalInstance {
  approval_code: string;
  open_id: string;
  form: string; // JSON string
}
