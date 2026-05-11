"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { SessionUser } from "@/types";

export function NavBar() {
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
  }, []);

  const adminItems = [
    { href: "/admin/approvals", label: "Approvals" },
    { href: "/admin/reports", label: "Reports" },
    { href: "/admin/employees", label: "Employees" },
    { href: "/admin/settings", label: "Settings" },
  ];

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <nav className="bg-card border-b border-border shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <Link href="/admin/approvals" className="text-lg font-semibold text-primary">
              Flexi-Benefits Admin
            </Link>
            {user?.isAdmin && (
              <div className="hidden md:flex items-center gap-1">
                {adminItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      pathname === item.href || pathname.startsWith(item.href + "/")
                        ? "bg-primary/10 text-primary"
                        : "text-muted hover:text-foreground hover:bg-gray-100"
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            {user ? (
              <>
                <span className="text-sm text-muted">
                  {user.name}
                  {user.isAdmin && (
                    <span className="ml-1 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">HR</span>
                  )}
                </span>
                <button onClick={handleLogout} className="text-sm text-muted hover:text-foreground">
                  Logout
                </button>
              </>
            ) : (
              <Link href="/login" className="text-sm text-primary hover:text-primary-dark">Login</Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
