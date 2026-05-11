import {
  startOfMonth,
  addMonths,
  differenceInCalendarMonths,
  getMonth,
  getYear,
} from 'date-fns';
import { prisma } from './db';

const DEFAULT_ANNUAL_CAP = 1000;

/**
 * Calculate the annual cap for an employee, accounting for new hire proration.
 *
 * Rule: If hired in the current year, cap = 1000 × (13 - hireMonth) / 12
 * Example: hired in July (month 7) → 1000 × 6 / 12 = 500 SGD
 */
export function calculateAnnualCap(hireDate: Date | null, year: number): number {
  if (!hireDate) return DEFAULT_ANNUAL_CAP;

  const hireYear = getYear(hireDate);
  if (hireYear < year) return DEFAULT_ANNUAL_CAP;
  if (hireYear > year) return 0;

  // Hired in the current year — prorate
  const hireMonth = getMonth(hireDate) + 1; // getMonth is 0-based
  const remainingMonths = 13 - hireMonth;
  return Math.round((DEFAULT_ANNUAL_CAP * remainingMonths) / 12 * 100) / 100;
}

/**
 * Calculate total months between start and end date (inclusive).
 * Uses calendar month difference + 1.
 */
export function calculateTotalMonths(startDate: Date, endDate: Date): number {
  return differenceInCalendarMonths(endDate, startDate) + 1;
}

/**
 * Calculate monthly amount by dividing price evenly across months.
 */
export function calculateMonthlyAmount(price: number, totalMonths: number): number {
  return price / totalMonths;
}

/**
 * Calculate the portion of a claim that falls within a given year,
 * and determine the actual payout months (from current/approval month onward).
 *
 * Business rules:
 * - Reimbursement is paid via salary, so past months can't be retroactively paid
 * - Only the current year portion counts; next year is calculated separately
 * - Payout months: from MAX(approval_month, claim_start_month) to MIN(claim_end_month, Dec)
 * - Monthly payout = (current year portion amount) / (number of payout months)
 *
 * @param claimStart - claim coverage start date
 * @param claimEnd - claim coverage end date
 * @param totalPrice - total claim amount
 * @param approvalDate - when the claim was approved
 * @returns array of { month, amount } for actual salary payout
 */
export function calculatePayoutMonths(
  claimStart: Date,
  claimEnd: Date,
  totalPrice: number,
  approvalDate: Date,
): { month: Date; amount: number; yearPortion: number; totalClaimMonths: number }[] {
  const approvalYear = getYear(approvalDate);

  // Total claim months (for proportional calculation)
  const totalClaimMonths = calculateTotalMonths(claimStart, claimEnd);

  // Clip claim period to the approval year
  const yearStart = new Date(approvalYear, 0, 1);
  const yearEnd = new Date(approvalYear, 11, 31);
  const effectiveStart = claimStart < yearStart ? yearStart : claimStart;
  const effectiveEnd = claimEnd > yearEnd ? yearEnd : claimEnd;

  if (effectiveStart > effectiveEnd) {
    // Claim doesn't fall in this year at all
    return [];
  }

  // Calculate the year portion of the total amount (proportional to months in this year)
  const monthsInYear = calculateTotalMonths(effectiveStart, effectiveEnd);
  const yearPortion = (totalPrice / totalClaimMonths) * monthsInYear;

  // Payout starts from MAX(approval month, effective start month)
  const approvalMonth = startOfMonth(approvalDate);
  const effectiveStartMonth = startOfMonth(effectiveStart);
  const payoutStart = approvalMonth > effectiveStartMonth ? approvalMonth : effectiveStartMonth;
  const payoutEnd = startOfMonth(effectiveEnd);

  if (payoutStart > payoutEnd) {
    // All claim months are before approval — compress everything into approval month
    return [{
      month: approvalMonth,
      amount: yearPortion,
      yearPortion,
      totalClaimMonths,
    }];
  }

  const payoutMonthCount = differenceInCalendarMonths(payoutEnd, payoutStart) + 1;
  const monthlyAmount = yearPortion / payoutMonthCount;

  const months: { month: Date; amount: number; yearPortion: number; totalClaimMonths: number }[] = [];
  for (let i = 0; i < payoutMonthCount; i++) {
    months.push({
      month: startOfMonth(addMonths(payoutStart, i)),
      amount: monthlyAmount,
      yearPortion,
      totalClaimMonths,
    });
  }

  return months;
}

/**
 * After a claim is approved, create monthly payment records and calculate actually_pay.
 *
 * Uses the new payout logic:
 * - Only current year portion
 * - Payout from approval month onward
 * - actually_pay capped at annual limit
 */
export async function processApprovedClaim(claimId: number): Promise<void> {
  const claim = await prisma.claim.findUniqueOrThrow({
    where: { id: claimId },
    include: { employee: true },
  });

  if (claim.status !== 'approved') {
    throw new Error(`Claim ${claimId} is not approved (status: ${claim.status})`);
  }

  const approvalDate = claim.approvedAt || new Date();

  const months = calculatePayoutMonths(
    claim.startDate,
    claim.endDate,
    Number(claim.price),
    approvalDate,
  );

  if (months.length === 0) return;

  // Create monthly payment records for this claim
  await prisma.monthlyPayment.createMany({
    data: months.map((m) => ({
      claimId: claim.id,
      employeeId: claim.employeeId,
      category: claim.category,
      month: m.month,
      amount: parseFloat(m.amount.toFixed(3)),
    })),
  });

  // Recalculate actually_pay for all months in affected years
  const years = new Set(months.map((m) => getYear(m.month)));
  for (const year of years) {
    await recalculateActuallyPay(claim.employeeId, year);
  }
}

/**
 * Recalculate actually_pay for all monthly payments of an employee in a given year.
 * This handles the annual cap logic with proper ordering.
 */
export async function recalculateActuallyPay(
  employeeId: number,
  year: number
): Promise<void> {
  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
  });

  const annualCap = calculateAnnualCap(employee.hireDate, year);

  // Get all monthly payments for this employee in this year, ordered by month
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);

  const payments = await prisma.monthlyPayment.findMany({
    where: {
      employeeId,
      month: { gte: yearStart, lte: yearEnd },
    },
    orderBy: [{ month: 'asc' }, { id: 'asc' }],
  });

  // Calculate actually_pay per-record, accumulating toward annual cap
  let accumulated = 0;

  for (const payment of payments) {
    const amount = Number(payment.amount);
    const actuallyPay = Math.max(0, Math.min(annualCap - accumulated, amount));

    await prisma.monthlyPayment.update({
      where: { id: payment.id },
      data: { actuallyPay: parseFloat(actuallyPay.toFixed(3)) },
    });

    accumulated += actuallyPay;
  }
}

/**
 * Get the annual usage summary for an employee.
 */
export async function getEmployeeAnnualUsage(
  employeeId: number,
  year: number
): Promise<{
  annualCap: number;
  totalClaimed: number;
  totalPaid: number;
  remaining: number;
}> {
  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
  });

  const annualCap = calculateAnnualCap(employee.hireDate, year);

  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);

  const result = await prisma.monthlyPayment.aggregate({
    where: {
      employeeId,
      month: { gte: yearStart, lte: yearEnd },
    },
    _sum: {
      amount: true,
      actuallyPay: true,
    },
  });

  const totalClaimed = Number(result._sum.amount || 0);
  const totalPaid = Number(result._sum.actuallyPay || 0);

  return {
    annualCap,
    totalClaimed,
    totalPaid,
    remaining: Math.max(0, annualCap - totalPaid),
  };
}
