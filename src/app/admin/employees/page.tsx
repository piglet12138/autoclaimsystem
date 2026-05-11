"use client";

import { useEffect, useState } from "react";

interface Employee {
  id: number;
  feishuUid: string;
  employeeNo: string | null;
  nameCn: string | null;
  nameEn: string | null;
  department: string | null;
  hireDate: string | null;
  isActive: boolean;
  syncedAt: string | null;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = () => {
    setLoading(true);
    fetch("/api/admin/employees")
      .then((r) => r.json())
      .then((d) => setEmployees(d.employees || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage("");
    try {
      const res = await fetch("/api/sync/employees", { method: "POST" });
      const data = await res.json();
      setSyncMessage(data.message || data.error || "Sync completed");
      fetchEmployees();
    } catch {
      setSyncMessage("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Employees</h1>
        <div className="flex items-center gap-4">
          {syncMessage && (
            <span className="text-sm text-muted">{syncMessage}</span>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-dark disabled:opacity-50"
          >
            {syncing ? "Syncing..." : "Sync from Feishu"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-10 text-muted">Loading...</div>
      ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-background">
                <th className="text-left px-4 py-3 text-sm font-medium text-muted">ID</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-muted">Employee No</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-muted">Name</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-muted">Department</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-muted">Hire Date</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-muted">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {employees.map((emp) => (
                <tr key={emp.id} className="hover:bg-background">
                  <td className="px-4 py-3 text-sm">{emp.id}</td>
                  <td className="px-4 py-3 text-sm">{emp.employeeNo || "-"}</td>
                  <td className="px-4 py-3 text-sm font-medium">
                    {emp.nameEn || emp.nameCn || "-"}
                    {emp.nameCn && emp.nameEn && (
                      <span className="text-muted ml-1">({emp.nameCn})</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted">{emp.department || "-"}</td>
                  <td className="px-4 py-3 text-sm">
                    {emp.hireDate ? new Date(emp.hireDate).toLocaleDateString() : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${emp.isActive ? "bg-success/10 text-success" : "bg-muted/10 text-muted"}`}>
                      {emp.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-border text-sm text-muted">
            {employees.length} employees
          </div>
        </div>
      )}
    </div>
  );
}
