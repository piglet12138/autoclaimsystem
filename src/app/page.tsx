"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.user?.isAdmin) {
          router.replace("/admin/approvals");
        } else if (d.user) {
          // Non-admin user has no pages — show message
        } else {
          router.replace("/login");
        }
      })
      .catch(() => {});
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <h1 className="text-2xl font-bold">Flexi-Benefits Admin</h1>
      <p className="text-muted">HR management backend for flexi-benefits claims</p>
      <Link
        href="/login"
        className="bg-primary text-white px-6 py-2 rounded-lg hover:bg-primary-dark transition-colors"
      >
        Login
      </Link>
    </div>
  );
}
