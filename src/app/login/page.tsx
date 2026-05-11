"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: "Authentication failed. Please try again.",
  not_admin: "Access denied. This system is for HR administrators only.",
};

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  const appId = process.env.NEXT_PUBLIC_FEISHU_APP_ID || "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== "undefined" ? window.location.origin : "");
  const redirectUri = `${appUrl}/api/auth/callback`;
  const oauthUrl = `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent("bitable:app:readonly wiki:wiki:readonly")}`;

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
      <div className="bg-card rounded-xl border border-border p-8 shadow-sm max-w-md w-full text-center">
        <h1 className="text-2xl font-bold mb-2">Flexi-Benefits Admin</h1>
        <p className="text-muted mb-6">
          HR management backend for flexi-benefits claims
        </p>

        {error && (
          <div className="bg-danger/10 text-danger text-sm p-3 rounded-lg mb-4">
            {ERROR_MESSAGES[error] || "An error occurred. Please try again."}
          </div>
        )}

        <a
          href={oauthUrl}
          className="inline-flex items-center justify-center w-full bg-primary text-white px-6 py-3 rounded-lg hover:bg-primary-dark transition-colors font-medium"
        >
          Login with Feishu
        </a>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[60vh]">Loading...</div>}>
      <LoginContent />
    </Suspense>
  );
}
