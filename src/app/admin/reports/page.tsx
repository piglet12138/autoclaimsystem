"use client";

import { useEffect, useState, useMemo } from "react";

const CATEGORIES = ["Vision", "Wellness Program", "Insurance"];
const CAT_SHORT: Record<string, string> = {
  "Vision": "Vis",
  "Wellness Program": "Well",
  "Insurance": "Ins",
};

interface MonthData {
  total: number;
  byCategory: Record<string, number>;
}

interface AnnualRow {
  employeeId: number;
  name: string;
  department: string;
  annualCap: number;
  totalClaimed: number;
  totalPaid: number;
  remaining: number;
  byCategory: Record<string, number>;
  byMonth: Record<string, MonthData>;
}

function fmt(v: number) {
  return v > 0 ? v.toFixed(2) : "-";
}

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const BOM = "\uFEFF";
  const csv = BOM + [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<AnnualRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"payout" | "detail" | "summary">("payout");
  const [deptFilter, setDeptFilter] = useState("all");
  const [payoutMonth, setPayoutMonth] = useState(now.getMonth()); // 0-based

  useEffect(() => {
    setLoading(true);
    fetch(`/api/reports/annual?year=${year}`)
      .then((r) => r.json())
      .then((d) => setData(d.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [year]);

  const departments = useMemo(() => {
    const depts = new Set(data.map((r) => r.department).filter(Boolean));
    return Array.from(depts).sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (deptFilter === "all") return data;
    return data.filter((r) => r.department === deptFilter);
  }, [data, deptFilter]);

  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(year, i, 1);
    return {
      key: d.toISOString().slice(0, 7),
      label: d.toLocaleDateString("en-US", { month: "short" }),
      index: i,
    };
  });

  const currentMonthKey = months[payoutMonth]?.key || "";

  // Payout data for selected month
  const payoutData = useMemo(() => {
    return filtered
      .filter((r) => {
        const md = r.byMonth[currentMonthKey];
        return md && md.total > 0;
      })
      .map((r) => ({
        ...r,
        monthData: r.byMonth[currentMonthKey],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered, currentMonthKey]);

  const payoutTotal = useMemo(() => {
    return {
      total: payoutData.reduce((s, r) => s + r.monthData.total, 0),
      byCategory: CATEGORIES.reduce((acc, c) => {
        acc[c] = payoutData.reduce((s, r) => s + (r.monthData.byCategory[c] || 0), 0);
        return acc;
      }, {} as Record<string, number>),
    };
  }, [payoutData]);

  // Totals for detail/summary
  const totals = useMemo(() => ({
    totalPaid: filtered.reduce((s, r) => s + r.totalPaid, 0),
    byCategory: CATEGORIES.reduce((acc, c) => {
      acc[c] = filtered.reduce((s, r) => s + (r.byCategory[c] || 0), 0);
      return acc;
    }, {} as Record<string, number>),
    byMonth: months.reduce((acc, m) => {
      acc[m.key] = {
        total: filtered.reduce((s, r) => s + (r.byMonth[m.key]?.total || 0), 0),
        byCategory: CATEGORIES.reduce((catAcc, c) => {
          catAcc[c] = filtered.reduce((s, r) => s + (r.byMonth[m.key]?.byCategory[c] || 0), 0);
          return catAcc;
        }, {} as Record<string, number>),
      };
      return acc;
    }, {} as Record<string, MonthData>),
  }), [filtered, months]);

  // Export functions
  const exportPayout = () => {
    const headers = ["Employee", "Department", ...CATEGORIES, "Total"];
    const rows = payoutData.map((r) => [
      r.name, r.department,
      ...CATEGORIES.map((c) => (r.monthData.byCategory[c] || 0).toFixed(2)),
      r.monthData.total.toFixed(2),
    ]);
    rows.push(["Total", "", ...CATEGORIES.map((c) => payoutTotal.byCategory[c].toFixed(2)), payoutTotal.total.toFixed(2)]);
    downloadCsv(`payout-${currentMonthKey}.csv`, headers, rows);
  };

  const exportSummary = () => {
    const headers = ["Employee", "Department", "Cap", ...CATEGORIES, "Total Paid", "Remaining"];
    const rows = filtered.map((r) => [
      r.name, r.department, r.annualCap.toFixed(2),
      ...CATEGORIES.map((c) => (r.byCategory[c] || 0).toFixed(2)),
      r.totalPaid.toFixed(2), r.remaining.toFixed(2),
    ]);
    downloadCsv(`annual-summary-${year}.csv`, headers, rows);
  };

  const exportDetail = () => {
    const headers = ["Employee", "Department"];
    for (const m of months) {
      for (const c of CATEGORIES) headers.push(`${m.label}-${CAT_SHORT[c]}`);
      headers.push(`${m.label}-Total`);
    }
    headers.push(...CATEGORIES.map((c) => `Year-${CAT_SHORT[c]}`), "Year-Total");

    const rows = filtered.map((r) => {
      const row = [r.name, r.department];
      for (const m of months) {
        const md = r.byMonth[m.key];
        for (const c of CATEGORIES) row.push((md?.byCategory[c] || 0).toFixed(2));
        row.push((md?.total || 0).toFixed(2));
      }
      for (const c of CATEGORIES) row.push((r.byCategory[c] || 0).toFixed(2));
      row.push(r.totalPaid.toFixed(2));
      return row;
    });
    downloadCsv(`monthly-detail-${year}.csv`, headers, rows);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Reports</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1">
            {(["payout", "detail", "summary"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded text-sm font-medium ${view === v ? "bg-primary text-white" : "bg-card border border-border"}`}>
                {v === "payout" ? "Monthly Payout" : v === "detail" ? "Monthly Detail" : "Annual Summary"}
              </button>
            ))}
          </div>
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}
            className="border border-border rounded-lg px-3 py-1.5 text-sm max-w-[200px]">
            <option value="all">All Departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select value={year} onChange={(e) => setYear(parseInt(e.target.value))}
            className="border border-border rounded-lg px-3 py-1.5 text-sm">
            {[2024, 2025, 2026, 2027].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-10 text-muted">Loading...</div>
      ) : data.length === 0 ? (
        <div className="text-center py-10 text-muted">No data for {year}</div>
      ) : view === "payout" ? (
        /* ===== Monthly Payout ===== */
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <select value={payoutMonth} onChange={(e) => setPayoutMonth(parseInt(e.target.value))}
                className="border border-border rounded-lg px-3 py-1.5 text-sm font-medium">
                {months.map((m) => (
                  <option key={m.index} value={m.index}>{m.label} {year}</option>
                ))}
              </select>
              <span className="text-sm text-muted">
                {payoutData.length} employees, SGD {payoutTotal.total.toFixed(2)} total
              </span>
            </div>
            <button onClick={exportPayout}
              className="px-3 py-1.5 border border-border rounded-lg text-sm hover:bg-background">
              Export CSV
            </button>
          </div>

          {payoutData.length === 0 ? (
            <div className="text-center py-10 text-muted">No payouts for {months[payoutMonth]?.label} {year}</div>
          ) : (
            <div className="bg-card rounded-xl border border-border shadow-sm overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-background">
                    <th className="text-left px-4 py-3 text-sm font-medium text-muted">Employee</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-muted">Department</th>
                    {CATEGORIES.map((c) => (
                      <th key={c} className="text-right px-4 py-3 text-sm font-medium text-muted">{c}</th>
                    ))}
                    <th className="text-right px-4 py-3 text-sm font-medium text-muted">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {payoutData.map((r) => (
                    <tr key={r.employeeId} className="hover:bg-background">
                      <td className="px-4 py-3 text-sm font-medium">{r.name}</td>
                      <td className="px-4 py-3 text-sm text-muted">{r.department}</td>
                      {CATEGORIES.map((c) => (
                        <td key={c} className="px-4 py-3 text-sm text-right">{fmt(r.monthData.byCategory[c] || 0)}</td>
                      ))}
                      <td className="px-4 py-3 text-sm text-right font-medium">{r.monthData.total.toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr className="bg-background font-medium border-t-2 border-border">
                    <td className="px-4 py-3 text-sm" colSpan={2}>Total ({payoutData.length} employees)</td>
                    {CATEGORIES.map((c) => (
                      <td key={c} className="px-4 py-3 text-sm text-right">{fmt(payoutTotal.byCategory[c])}</td>
                    ))}
                    <td className="px-4 py-3 text-sm text-right">{payoutTotal.total.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : view === "summary" ? (
        /* ===== Annual Summary ===== */
        <div>
          <div className="flex justify-end mb-4">
            <button onClick={exportSummary} className="px-3 py-1.5 border border-border rounded-lg text-sm hover:bg-background">
              Export CSV
            </button>
          </div>
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="border-b border-border bg-background">
                  <th className="text-left px-4 py-3 text-sm font-medium text-muted">Employee</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-muted">Department</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-muted">Cap</th>
                  {CATEGORIES.map((c) => (
                    <th key={c} className="text-right px-4 py-3 text-sm font-medium text-muted">{c}</th>
                  ))}
                  <th className="text-right px-4 py-3 text-sm font-medium text-muted">Total Paid</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-muted">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((row) => (
                  <tr key={row.employeeId} className="hover:bg-background">
                    <td className="px-4 py-3 text-sm font-medium">{row.name}</td>
                    <td className="px-4 py-3 text-sm text-muted">{row.department}</td>
                    <td className="px-4 py-3 text-sm text-right">{row.annualCap.toFixed(2)}</td>
                    {CATEGORIES.map((c) => (
                      <td key={c} className="px-4 py-3 text-sm text-right">{fmt(row.byCategory[c] || 0)}</td>
                    ))}
                    <td className="px-4 py-3 text-sm text-right font-medium">{row.totalPaid.toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-right">
                      <span className={row.remaining <= 0 ? "text-danger" : "text-success"}>{row.remaining.toFixed(2)}</span>
                    </td>
                  </tr>
                ))}
                <tr className="bg-background font-medium border-t-2 border-border">
                  <td className="px-4 py-3 text-sm" colSpan={2}>Total ({filtered.length})</td>
                  <td className="px-4 py-3 text-sm text-right">{filtered.reduce((s, r) => s + r.annualCap, 0).toFixed(2)}</td>
                  {CATEGORIES.map((c) => (
                    <td key={c} className="px-4 py-3 text-sm text-right">{fmt(totals.byCategory[c])}</td>
                  ))}
                  <td className="px-4 py-3 text-sm text-right">{totals.totalPaid.toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm text-right">{filtered.reduce((s, r) => s + r.remaining, 0).toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ===== Monthly Detail (wide table) ===== */
        <div>
          <div className="flex justify-end mb-4">
            <button onClick={exportDetail} className="px-3 py-1.5 border border-border rounded-lg text-sm hover:bg-background">
              Export CSV
            </button>
          </div>
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-x-auto">
            <table className="w-full" style={{ minWidth: `${220 + months.length * 160 + 160}px` }}>
              <thead>
                <tr className="border-b border-border bg-background">
                  <th className="text-left px-3 py-2 text-sm font-medium text-muted sticky left-0 bg-background z-10" rowSpan={2}>Employee</th>
                  <th className="text-left px-3 py-2 text-sm font-medium text-muted sticky left-[120px] bg-background z-10" rowSpan={2}>Dept</th>
                  {months.map((m) => (
                    <th key={m.key} className="text-center px-1 py-2 text-sm font-medium text-muted border-l border-border" colSpan={4}>{m.label}</th>
                  ))}
                  <th className="text-center px-1 py-2 text-sm font-medium text-muted border-l border-border" colSpan={4}>Year Total</th>
                </tr>
                <tr className="border-b border-border bg-background text-xs">
                  {[...months, { key: "total", label: "Total" }].flatMap((m) => [
                    ...CATEGORIES.map((c) => (
                      <th key={`${m.key}-${c}`} className={`text-right px-1 py-1 text-muted font-normal ${c === CATEGORIES[0] ? "border-l border-border" : "border-l border-border/30"}`}>
                        {CAT_SHORT[c]}
                      </th>
                    )),
                    <th key={`${m.key}-t`} className="text-right px-1 py-1 text-muted font-medium border-l border-border/30">Tot</th>,
                  ])}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((row) => (
                  <tr key={row.employeeId} className="hover:bg-background">
                    <td className="px-3 py-2 text-xs font-medium sticky left-0 bg-card z-10 whitespace-nowrap">{row.name}</td>
                    <td className="px-3 py-2 text-xs text-muted sticky left-[120px] bg-card z-10 whitespace-nowrap max-w-[100px] truncate">{row.department}</td>
                    {months.flatMap((m) => {
                      const md = row.byMonth[m.key];
                      return [
                        ...CATEGORIES.map((c) => (
                          <td key={`${m.key}-${c}`} className={`px-1 py-2 text-xs text-right ${c === CATEGORIES[0] ? "border-l border-border" : "border-l border-border/30"}`}>
                            {fmt(md?.byCategory[c] || 0)}
                          </td>
                        )),
                        <td key={`${m.key}-t`} className="px-1 py-2 text-xs text-right font-medium border-l border-border/30">
                          {fmt(md?.total || 0)}
                        </td>,
                      ];
                    })}
                    {CATEGORIES.map((c) => (
                      <td key={`y-${c}`} className={`px-1 py-2 text-xs text-right ${c === CATEGORIES[0] ? "border-l border-border" : "border-l border-border/30"}`}>
                        {fmt(row.byCategory[c] || 0)}
                      </td>
                    ))}
                    <td className="px-1 py-2 text-xs text-right font-medium border-l border-border/30">{row.totalPaid.toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="bg-background font-medium border-t-2 border-border">
                  <td className="px-3 py-2 text-xs sticky left-0 bg-background z-10">Total</td>
                  <td className="px-3 py-2 text-xs sticky left-[120px] bg-background z-10"></td>
                  {months.flatMap((m) => {
                    const md = totals.byMonth[m.key];
                    return [
                      ...CATEGORIES.map((c) => (
                        <td key={`t-${m.key}-${c}`} className={`px-1 py-2 text-xs text-right ${c === CATEGORIES[0] ? "border-l border-border" : "border-l border-border/30"}`}>
                          {fmt(md?.byCategory[c] || 0)}
                        </td>
                      )),
                      <td key={`t-${m.key}-t`} className="px-1 py-2 text-xs text-right font-medium border-l border-border/30">{fmt(md?.total || 0)}</td>,
                    ];
                  })}
                  {CATEGORIES.map((c) => (
                    <td key={`t-y-${c}`} className={`px-1 py-2 text-xs text-right ${c === CATEGORIES[0] ? "border-l border-border" : "border-l border-border/30"}`}>
                      {fmt(totals.byCategory[c])}
                    </td>
                  ))}
                  <td className="px-1 py-2 text-xs text-right font-medium border-l border-border/30">{totals.totalPaid.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
