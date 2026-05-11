"use client";

import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import type { ClaimStatus } from "@/types";

interface Claim {
  id: number;
  category: string;
  price: string;
  startDate: string;
  endDate: string;
  totalMonths: number;
  monthlyAmount: string;
  status: ClaimStatus;
  submittedAt: string;
  attachmentPath: string | null;
  employee: { nameCn: string; nameEn: string; department: string };
}

export default function ApprovalsPage() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [filter, setFilter] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState("");

  const fetchClaims = () => {
    setLoading(true);
    const params = filter !== "all" ? `?status=${filter}` : "";
    fetch(`/api/claims${params}`)
      .then((r) => r.json())
      .then((d) => setClaims(d.claims || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchClaims(); }, [filter]);

  const handleAction = async (id: number, action: "approve" | "reject") => {
    if (action === "reject") {
      const reason = prompt("Rejection reason (optional):");
      if (reason === null) return; // cancelled
      setActionLoading(id);
      await fetch(`/api/claims/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, rejectReason: reason }),
      });
    } else {
      setActionLoading(id);
      await fetch(`/api/claims/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
    }
    setActionLoading(null);
    fetchClaims();
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult("");
    try {
      const res = await fetch("/api/approval/poll", { method: "POST" });
      const data = await res.json();
      if (data.approved || data.rejected) {
        setSyncResult(`Synced: ${data.approved} approved, ${data.rejected} rejected`);
        fetchClaims();
      } else {
        setSyncResult(`Checked ${data.checked} pending — no changes`);
      }
    } catch {
      setSyncResult("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Approval Management</h1>
        <div className="flex items-center gap-3">
          {syncResult && <span className="text-sm text-muted">{syncResult}</span>}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 bg-card border border-border rounded-lg text-sm font-medium hover:bg-background disabled:opacity-50"
          >
            {syncing ? "Syncing..." : "Sync Feishu Approvals"}
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        {["pending", "approved", "rejected", "all"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === f
                ? "bg-primary text-white"
                : "bg-card border border-border text-muted hover:text-foreground"
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-10 text-muted">Loading...</div>
      ) : claims.length === 0 ? (
        <div className="text-center py-10 text-muted">No claims found</div>
      ) : (
        <div className="space-y-4">
          {claims.map((claim) => (
            <div
              key={claim.id}
              className="bg-card rounded-xl border border-border p-6 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">
                      {claim.employee.nameEn || claim.employee.nameCn}
                    </span>
                    <StatusBadge status={claim.status} />
                  </div>
                  <div className="text-sm text-muted">
                    {claim.employee.department}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3 text-sm">
                    <div>
                      <span className="text-muted">Category: </span>
                      <span className="font-medium">{claim.category}</span>
                    </div>
                    <div>
                      <span className="text-muted">Amount: </span>
                      <span className="font-medium">
                        SGD {parseFloat(claim.price).toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted">Period: </span>
                      <span className="font-medium">
                        {claim.totalMonths} months
                      </span>
                    </div>
                    <div>
                      <span className="text-muted">Monthly: </span>
                      <span className="font-medium">
                        SGD {parseFloat(claim.monthlyAmount).toFixed(2)}
                      </span>
                    </div>
                  </div>
                  {claim.attachmentPath && (
                    <a
                      href={claim.attachmentPath}
                      className="text-primary text-sm hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View attachment
                    </a>
                  )}
                </div>

                {claim.status === "pending" && (
                  <div className="flex gap-2 shrink-0 ml-4">
                    <button
                      onClick={() => handleAction(claim.id, "approve")}
                      disabled={actionLoading === claim.id}
                      className="px-4 py-2 bg-success text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
                    >
                      {actionLoading === claim.id ? "..." : "Approve"}
                    </button>
                    <button
                      onClick={() => handleAction(claim.id, "reject")}
                      disabled={actionLoading === claim.id}
                      className="px-4 py-2 bg-danger text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
