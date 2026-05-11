import type { ClaimStatus } from "@/types";

const statusConfig: Record<ClaimStatus, { label: string; className: string }> = {
  pending: {
    label: "Pending",
    className: "bg-warning/10 text-warning",
  },
  approved: {
    label: "Approved",
    className: "bg-success/10 text-success",
  },
  rejected: {
    label: "Rejected",
    className: "bg-danger/10 text-danger",
  },
};

export function StatusBadge({ status }: { status: ClaimStatus }) {
  const config = statusConfig[status] || statusConfig.pending;
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}
