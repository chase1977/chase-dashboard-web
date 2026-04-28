// frontend/src/components/auth/UserMenu.jsx
// Drop this into your existing Navbar/TopBar component

import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, User, Shield, ChevronDown } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

export default function UserMenu() {
  const { user, profile, signOut } = useAuth();
  const navigate  = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  if (!user) return null;

  const initials = [profile?.first_name?.[0], profile?.last_name?.[0]].filter(Boolean).join("").toUpperCase() || "?";
  const fullName = profile ? `${profile.first_name} ${profile.last_name}`.trim() : user.email;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700
                   rounded-lg px-3 py-1.5 transition-all"
      >
        {/* Avatar */}
        <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-blue-700 rounded-md flex items-center justify-center text-white text-xs font-bold">
          {initials}
        </div>
        <span className="text-slate-200 text-xs font-medium hidden sm:block max-w-[120px] truncate">{fullName}</span>
        <ChevronDown size={12} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 mt-2 w-52 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden">

          {/* User info */}
          <div className="px-4 py-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center text-white text-xs font-bold">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-white text-xs font-semibold truncate">{fullName}</p>
                <p className="text-slate-500 text-xs truncate">{user.email}</p>
              </div>
            </div>
            {profile?.role === "superadmin" && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-md px-2 py-1">
                <Shield size={10} /> Superadmin
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="py-1">
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors text-xs"
            >
              <LogOut size={13} className="text-red-400" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
