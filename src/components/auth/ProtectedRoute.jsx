// frontend/src/components/auth/ProtectedRoute.jsx

import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

// ── Loading spinner ───────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="min-h-screen bg-[#070d1a] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
        <p className="text-slate-500 text-xs">Verifying access…</p>
      </div>
    </div>
  );
}

// ── Not authorised screen ─────────────────────────────────────────────────────
function AccessDenied() {
  return (
    <div className="min-h-screen bg-[#070d1a] flex items-center justify-center px-4">
      <div className="text-center space-y-3">
        <p className="text-red-400 font-bold text-lg">Access Denied</p>
        <p className="text-slate-400 text-sm">Superadmin credentials required.</p>
        <a href="/auth" className="inline-block mt-2 text-blue-400 hover:text-blue-300 text-sm underline">
          Sign in with authorised account
        </a>
      </div>
    </div>
  );
}

// ── Protected Route ───────────────────────────────────────────────────────────
// requireSuperadmin (default true) — only superadmin role passes.
// Set to false if you ever add admin/viewer routes later.
export default function ProtectedRoute({ children, requireSuperadmin = true }) {
  const { user, profile, loading } = useAuth();

  // loading stays true until both session AND profile have resolved
  if (loading) return <LoadingScreen />;

  // Not authenticated → auth page
  if (!user) return <Navigate to="/auth" replace />;

  // Profile missing after load = RLS blocked or DB issue
  if (!profile) return <AccessDenied />;

  // Role check
  if (requireSuperadmin && profile.role !== "superadmin") return <AccessDenied />;

  return children;
}
