"use client";

import { useEffect, useState } from "react";

// Set this to the super admin's Feishu open_id (cannot be removed via UI)
const SUPER_ADMIN_UID = process.env.NEXT_PUBLIC_SUPER_ADMIN_UID || "";

interface Employee {
  id: number;
  feishuUid: string;
  nameCn: string | null;
  nameEn: string | null;
  department: string | null;
  isAdmin: boolean;
}

export default function SettingsPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<{ id: number; name: string; action: "set" | "remove" } | null>(null);

  // Approver
  const [approver, setApprover] = useState<{ openId: string | null; name: string | null }>({ openId: null, name: null });
  const [approverSearch, setApproverSearch] = useState("");
  const [updatingApprover, setUpdatingApprover] = useState(false);
  const [approverResult, setApproverResult] = useState("");
  const [approverConfirm, setApproverConfirm] = useState<{ openId: string; name: string } | null>(null);

  // Admin search
  const [adminSearch, setAdminSearch] = useState("");

  // Status
  const [statusMsg, setStatusMsg] = useState("");

  const fetchEmployees = () => {
    setLoading(true);
    fetch("/api/dev/admin")
      .then((r) => r.json())
      .then((d) => setEmployees(d.employees || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const fetchApprover = () => {
    fetch("/api/admin/approver")
      .then((r) => r.json())
      .then((d) => setApprover({ openId: d.approverOpenId, name: d.approverName }))
      .catch(console.error);
  };

  useEffect(() => { fetchEmployees(); fetchApprover(); }, []);

  const handleConfirm = async () => {
    if (!confirm) return;
    setToggling(confirm.id);
    setConfirm(null);
    await fetch("/api/dev/admin", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId: confirm.id, isAdmin: confirm.action === "set" }),
    });
    setToggling(null);
    fetchEmployees();
  };

  const handleApproverUpdate = async () => {
    if (!approverConfirm) return;
    setUpdatingApprover(true);
    setApproverResult("");
    setApproverConfirm(null);
    try {
      const res = await fetch("/api/admin/approver", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openId: approverConfirm.openId }),
      });
      const data = await res.json();
      setApproverResult(data.message || data.error);
      if (res.ok) { setApproverSearch(""); fetchApprover(); }
    } catch { setApproverResult("Request failed"); }
    finally { setUpdatingApprover(false); }
  };

  const handleSync = async (type: "employees" | "claims") => {
    setStatusMsg(type === "employees" ? "Syncing employees..." : "Syncing claims...");
    try {
      const url = type === "employees" ? "/api/sync/employees" : "/api/approval/poll";
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();
      if (type === "employees") {
        setStatusMsg(data.message || data.error || "Done");
        if (res.ok) fetchEmployees();
      } else {
        setStatusMsg(`${data.newClaims || 0} new, ${data.approved || 0} approved, ${data.rejected || 0} rejected`);
      }
    } catch { setStatusMsg("Failed"); }
  };

  const getName = (e: Employee) => e.nameEn || e.nameCn || e.feishuUid;
  const isSuperAdmin = (e: Employee) => e.feishuUid === SUPER_ADMIN_UID;

  const admins = employees.filter((e) => e.isAdmin);

  const adminSearchResults = adminSearch.trim().length >= 2
    ? employees.filter((e) => {
        const q = adminSearch.toLowerCase();
        return !e.isAdmin && (
          e.nameEn?.toLowerCase().includes(q) ||
          e.nameCn?.toLowerCase().includes(q) ||
          e.department?.toLowerCase().includes(q)
        );
      }).slice(0, 10)
    : [];

  const approverCandidates = approverSearch.trim().length >= 2
    ? employees.filter((e) => {
        const q = approverSearch.toLowerCase();
        return e.feishuUid !== approver.openId && (
          e.nameEn?.toLowerCase().includes(q) ||
          e.nameCn?.toLowerCase().includes(q) ||
          e.department?.toLowerCase().includes(q)
        );
      }).slice(0, 10)
    : [];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      {/* Confirm Dialog */}
      {confirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl border border-border p-6 shadow-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-2">
              {confirm.action === "set" ? "Set as Admin?" : "Remove Admin?"}
            </h3>
            <p className="text-sm text-muted mb-6">
              {confirm.action === "set"
                ? `Grant admin access to "${confirm.name}"?`
                : `Remove admin access from "${confirm.name}"?`}
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirm(null)} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-background">Cancel</button>
              <button onClick={handleConfirm}
                className={`px-4 py-2 text-sm text-white rounded-lg ${confirm.action === "set" ? "bg-primary hover:bg-primary-dark" : "bg-danger hover:opacity-90"}`}>
                {confirm.action === "set" ? "Confirm" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approver Confirm Dialog */}
      {approverConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl border border-border p-6 shadow-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-2">Change Approver?</h3>
            <p className="text-sm text-muted mb-6">
              All new claim submissions will be sent to <strong>{approverConfirm.name}</strong> for approval. Takes effect immediately.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setApproverConfirm(null)} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-background">Cancel</button>
              <button onClick={handleApproverUpdate} className="px-4 py-2 text-sm text-white rounded-lg bg-primary hover:bg-primary-dark">Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* Section 1: Feishu Approver */}
      <div className="mb-8 bg-card rounded-xl border border-border p-5">
        <h2 className="font-semibold mb-1">Feishu Approver</h2>
        <p className="text-xs text-muted mb-4">Employee claim submissions will be sent to this person for approval in Feishu.</p>

        <div className="flex items-center gap-3 mb-4">
          {approver.openId ? (
            <span className="inline-flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-lg px-3 py-1.5">
              <span className="font-medium text-sm">{approver.name || approver.openId}</span>
            </span>
          ) : (
            <span className="text-sm text-danger">Not configured</span>
          )}
          {updatingApprover && <span className="text-xs text-muted">Updating...</span>}
          {approverResult && <span className="text-xs text-muted">{approverResult}</span>}
        </div>

        <div className="relative">
          <input type="text" placeholder="Search employee to change approver..."
            value={approverSearch} onChange={(e) => setApproverSearch(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
          {approverCandidates.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-10 max-h-[200px] overflow-y-auto">
              {approverCandidates.map((e) => (
                <button key={e.id}
                  onClick={() => { setApproverConfirm({ openId: e.feishuUid, name: getName(e) }); setApproverSearch(""); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-background transition-colors flex justify-between">
                  <span className="font-medium">{getName(e)}</span>
                  {e.department && <span className="text-muted text-xs">{e.department}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Section 2: Admin Management */}
      <div className="mb-8 bg-card rounded-xl border border-border p-5">
        <h2 className="font-semibold mb-1">Administrators</h2>
        <p className="text-xs text-muted mb-4">Admins can access this management backend. Changes take effect on next login.</p>

        {loading ? (
          <div className="text-center py-6 text-muted text-sm">Loading...</div>
        ) : (
          <>
            {/* Current Admins */}
            <div className="space-y-2 mb-4">
              {admins.map((e) => (
                <div key={e.id} className="flex items-center justify-between bg-background rounded-lg px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{getName(e)}</span>
                    {isSuperAdmin(e) && (
                      <span className="text-xs bg-warning/20 text-warning px-1.5 py-0.5 rounded">Super</span>
                    )}
                    {e.department && <span className="text-xs text-muted">{e.department}</span>}
                  </div>
                  {!isSuperAdmin(e) && (
                    <button onClick={() => setConfirm({ id: e.id, name: getName(e), action: "remove" })}
                      disabled={toggling === e.id}
                      className="px-3 py-1 text-xs border border-danger/30 text-danger rounded hover:bg-danger/10 disabled:opacity-50">
                      {toggling === e.id ? "..." : "Remove"}
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Add Admin by search */}
            <div className="relative">
              <input type="text" placeholder="Search employee to add as admin..."
                value={adminSearch} onChange={(e) => setAdminSearch(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
              {adminSearchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-10 max-h-[200px] overflow-y-auto">
                  {adminSearchResults.map((e) => (
                    <button key={e.id}
                      onClick={() => { setConfirm({ id: e.id, name: getName(e), action: "set" }); setAdminSearch(""); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-background transition-colors flex justify-between">
                      <span className="font-medium">{getName(e)}</span>
                      {e.department && <span className="text-muted text-xs">{e.department}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Section 3: Data Sync */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h2 className="font-semibold mb-1">Data Sync</h2>
        <p className="text-xs text-muted mb-4">
          Claims sync from Feishu automatically every 2 minutes.
          Employee list should be synced when new employees join the company.
        </p>
        <div className="flex items-center gap-3">
          <button onClick={() => handleSync("employees")}
            className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-background">
            Sync Employees
          </button>
          <button onClick={() => handleSync("claims")}
            className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-background">
            Sync Claims Now
          </button>
          {statusMsg && <span className="text-xs text-muted">{statusMsg}</span>}
        </div>
      </div>
    </div>
  );
}
