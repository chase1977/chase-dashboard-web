// frontend/src/pages/AuthPage.jsx

import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Eye, EyeOff, Mail, Lock, User, ArrowRight,
  CheckCircle, AlertCircle, ChevronLeft
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { LogoFull } from "../components/Logo";

// ── Password validation ───────────────────────────────────────────────────────
const SYMBOLS = ["@", ":", "$", "%", "£", "&"];

function validatePassword(pw) {
  const rules = [
    { id: "upper",  label: "One uppercase letter",         ok: /[A-Z]/.test(pw) },
    { id: "lower",  label: "One lowercase letter",         ok: /[a-z]/.test(pw) },
    { id: "number", label: "One number",                   ok: /[0-9]/.test(pw) },
    { id: "symbol", label: "One symbol (@ : $ % £ &)",    ok: SYMBOLS.some(s => pw.includes(s)) },
    { id: "length", label: "At least 8 characters",        ok: pw.length >= 8 },
  ];
  return { rules, valid: rules.every(r => r.ok) };
}

// ── Shared input ──────────────────────────────────────────────────────────────
function Input({ icon: Icon, type = "text", placeholder, value, onChange, rightEl, autoComplete }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
        <Icon size={16} />
      </span>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        className="w-full bg-slate-800/60 border border-slate-700 rounded-lg pl-9 pr-10 py-2.5
                   text-sm text-white placeholder-slate-500 focus:outline-none
                   focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
      />
      {rightEl && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2">{rightEl}</span>
      )}
    </div>
  );
}

// ── Password strength bar ─────────────────────────────────────────────────────
function PasswordRules({ password }) {
  if (!password) return null;
  const { rules } = validatePassword(password);
  return (
    <div className="mt-2 space-y-1">
      {rules.map(r => (
        <div key={r.id} className="flex items-center gap-2 text-xs">
          {r.ok
            ? <CheckCircle size={12} className="text-emerald-400 shrink-0" />
            : <AlertCircle size={12} className="text-slate-500 shrink-0" />}
          <span className={r.ok ? "text-emerald-400" : "text-slate-500"}>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  SIGN IN
// ══════════════════════════════════════════════════════════════════════════════
function SignIn({ onSwitch, onForgot }) {
  const { signIn } = useAuth();
  const navigate   = useNavigate();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const handle = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn(email, password);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message || "Sign in failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handle} className="space-y-4">
      <Input
        icon={Mail} type="email" placeholder="Email address"
        value={email} onChange={e => setEmail(e.target.value)}
        autoComplete="email"
      />
      <Input
        icon={Lock} type={showPw ? "text" : "password"}
        placeholder="Password" value={password}
        onChange={e => setPassword(e.target.value)}
        autoComplete="current-password"
        rightEl={
          <button type="button" onClick={() => setShowPw(v => !v)} className="text-slate-400 hover:text-white transition-colors">
            {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        }
      />

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      <button type="button" onClick={onForgot}
        className="text-xs text-blue-400 hover:text-blue-300 transition-colors block text-right w-full">
        Forgot password?
      </button>

      <button type="submit" disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-blue-500
                   hover:from-blue-500 hover:to-blue-400 disabled:opacity-50 disabled:cursor-not-allowed
                   text-white font-semibold py-2.5 rounded-lg transition-all text-sm">
        {loading ? "Signing in…" : <><span>Sign In</span><ArrowRight size={15} /></>}
      </button>

      <p className="text-center text-xs text-slate-500">
        No account?{" "}
        <button type="button" onClick={onSwitch} className="text-blue-400 hover:text-blue-300 transition-colors font-medium">
          Create one
        </button>
      </p>
    </form>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  SIGN UP
// ══════════════════════════════════════════════════════════════════════════════
function SignUp({ onSwitch }) {
  const { signUp } = useAuth();
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", password: "", confirm: ""
  });
  const [showPw, setShowPw]     = useState(false);
  const [showCf, setShowCf]     = useState(false);
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState(false);
  const [loading, setLoading]   = useState(false);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const { rules, valid: pwValid } = validatePassword(form.password);

  const handle = async (e) => {
    e.preventDefault();
    setError("");

    if (!pwValid) { setError("Password does not meet requirements."); return; }
    if (form.password !== form.confirm) { setError("Passwords do not match."); return; }

    setLoading(true);
    try {
      await signUp({ email: form.email, password: form.password, firstName: form.firstName, lastName: form.lastName });
      setSuccess(true);
    } catch (err) {
      setError(err.message || "Sign up failed.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="text-center space-y-4 py-4">
        <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle size={28} className="text-emerald-400" />
        </div>
        <div>
          <p className="text-white font-semibold">Account created!</p>
          <p className="text-slate-400 text-sm mt-1">
            Check <span className="text-blue-400">{form.email}</span> to confirm your account.
          </p>
        </div>
        <button onClick={onSwitch} className="text-blue-400 hover:text-blue-300 text-sm transition-colors">
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handle} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Input icon={User} placeholder="First name" value={form.firstName} onChange={set("firstName")} autoComplete="given-name" />
        <Input icon={User} placeholder="Last name"  value={form.lastName}  onChange={set("lastName")}  autoComplete="family-name" />
      </div>
      <Input
        icon={Mail} type="email" placeholder="Email address"
        value={form.email} onChange={set("email")} autoComplete="email"
      />
      <div>
        <Input
          icon={Lock} type={showPw ? "text" : "password"}
          placeholder="Password" value={form.password} onChange={set("password")}
          autoComplete="new-password"
          rightEl={
            <button type="button" onClick={() => setShowPw(v => !v)} className="text-slate-400 hover:text-white transition-colors">
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          }
        />
        <PasswordRules password={form.password} />
      </div>
      <Input
        icon={Lock} type={showCf ? "text" : "password"}
        placeholder="Confirm password" value={form.confirm} onChange={set("confirm")}
        autoComplete="new-password"
        rightEl={
          <button type="button" onClick={() => setShowCf(v => !v)} className="text-slate-400 hover:text-white transition-colors">
            {showCf ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        }
      />

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      <button type="submit" disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-blue-500
                   hover:from-blue-500 hover:to-blue-400 disabled:opacity-50 disabled:cursor-not-allowed
                   text-white font-semibold py-2.5 rounded-lg transition-all text-sm mt-1">
        {loading ? "Creating account…" : <><span>Create Account</span><ArrowRight size={15} /></>}
      </button>

      <p className="text-center text-xs text-slate-500">
        Have an account?{" "}
        <button type="button" onClick={onSwitch} className="text-blue-400 hover:text-blue-300 transition-colors font-medium">
          Sign in
        </button>
      </p>
    </form>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  FORGOT PASSWORD
// ══════════════════════════════════════════════════════════════════════════════
function ForgotPassword({ onBack }) {
  const { resetPassword } = useAuth();
  const [email, setEmail]   = useState("");
  const [sent, setSent]     = useState(false);
  const [error, setError]   = useState("");
  const [loading, setLoading] = useState(false);

  const handle = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await resetPassword(email);
      setSent(true);
    } catch (err) {
      setError(err.message || "Failed to send reset email.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-slate-400 hover:text-white text-xs transition-colors">
        <ChevronLeft size={14} /> Back to sign in
      </button>

      {sent ? (
        <div className="text-center space-y-3 py-2">
          <div className="w-12 h-12 bg-blue-500/10 border border-blue-500/30 rounded-full flex items-center justify-center mx-auto">
            <Mail size={22} className="text-blue-400" />
          </div>
          <p className="text-white font-medium text-sm">Reset link sent</p>
          <p className="text-slate-400 text-xs">
            Check <span className="text-blue-400">{email}</span> for the reset link.
          </p>
        </div>
      ) : (
        <form onSubmit={handle} className="space-y-4">
          <p className="text-slate-400 text-xs">Enter your email. We'll send a reset link.</p>
          <Input icon={Mail} type="email" placeholder="Email address"
            value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
          {error && (
            <div className="flex items-center gap-2 text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              <AlertCircle size={13} /> {error}
            </div>
          )}
          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-blue-500
                       hover:from-blue-500 hover:to-blue-400 disabled:opacity-50
                       text-white font-semibold py-2.5 rounded-lg transition-all text-sm">
            {loading ? "Sending…" : <><span>Send Reset Link</span><ArrowRight size={15} /></>}
          </button>
        </form>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  RESET PASSWORD (arrival from email link)
// ══════════════════════════════════════════════════════════════════════════════
function ResetPasswordForm() {
  const { updatePassword } = useAuth();
  const navigate = useNavigate();
  const [pw, setPw]         = useState("");
  const [cf, setCf]         = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError]   = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone]     = useState(false);

  const { valid: pwValid } = validatePassword(pw);

  const handle = async (e) => {
    e.preventDefault();
    if (!pwValid) { setError("Password does not meet requirements."); return; }
    if (pw !== cf) { setError("Passwords do not match."); return; }
    setLoading(true);
    try {
      await updatePassword(pw);
      setDone(true);
      setTimeout(() => navigate("/dashboard"), 2000);
    } catch (err) {
      setError(err.message || "Failed to update password.");
    } finally {
      setLoading(false);
    }
  };

  if (done) return (
    <div className="text-center py-4 space-y-2">
      <CheckCircle size={36} className="text-emerald-400 mx-auto" />
      <p className="text-white font-semibold">Password updated!</p>
      <p className="text-slate-400 text-xs">Redirecting to dashboard…</p>
    </div>
  );

  return (
    <form onSubmit={handle} className="space-y-4">
      <p className="text-slate-400 text-sm">Enter your new password.</p>
      <div>
        <Input
          icon={Lock} type={showPw ? "text" : "password"}
          placeholder="New password" value={pw} onChange={e => setPw(e.target.value)}
          autoComplete="new-password"
          rightEl={
            <button type="button" onClick={() => setShowPw(v => !v)} className="text-slate-400 hover:text-white transition-colors">
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          }
        />
        <PasswordRules password={pw} />
      </div>
      <Input icon={Lock} type="password" placeholder="Confirm new password"
        value={cf} onChange={e => setCf(e.target.value)} autoComplete="new-password" />
      {error && (
        <div className="flex items-center gap-2 text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
          <AlertCircle size={13} /> {error}
        </div>
      )}
      <button type="submit" disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-blue-500
                   hover:from-blue-500 hover:to-blue-400 disabled:opacity-50
                   text-white font-semibold py-2.5 rounded-lg transition-all text-sm">
        {loading ? "Updating…" : <><span>Set New Password</span><ArrowRight size={15} /></>}
      </button>
    </form>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  AUTH PAGE WRAPPER
// ══════════════════════════════════════════════════════════════════════════════
export default function AuthPage({ resetMode = false }) {
  const [view, setView] = useState("signin"); // signin | signup | forgot
  const [params] = useSearchParams();
  const { user, isSuperadmin, loading } = useAuth();
  const navigate = useNavigate();

  // Redirect already-authed superadmin
  useEffect(() => {
    if (!loading && user && isSuperadmin) navigate("/dashboard", { replace: true });
  }, [user, isSuperadmin, loading, navigate]);

  const title = resetMode
    ? "Set New Password"
    : view === "signin"  ? "Welcome back"
    : view === "signup"  ? "Create account"
    : "Reset password";

  const subtitle = resetMode
    ? "Choose a strong new password."
    : view === "signin"  ? "Sign in to your dashboard"
    : view === "signup"  ? "Join Chase Dashboard"
    : "We'll send you a reset link";

  return (
    <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center px-4">
      {/* Subtle grid background */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(30,50,100,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(30,50,100,0.05)_1px,transparent_1px)] bg-[size:50px_50px] pointer-events-none" />

      {/* Card */}
      <div className="relative w-full max-w-sm">
        {/* Glow */}
        <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-600/20 to-purple-600/20 rounded-2xl blur-xl" />

        <div className="relative bg-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-7 shadow-2xl">
          {/* Logo + back to home */}
          <div className="flex items-center justify-between mb-6">
            <LogoFull size={30} />
            {!resetMode && (
              <button
                onClick={() => navigate("/")}
                className="flex items-center gap-1 text-slate-500 hover:text-slate-300 text-xs transition-colors"
              >
                <ChevronLeft size={13} /> Home
              </button>
            )}
          </div>

          {/* Heading */}
          <div className="mb-5">
            <h1 className="text-xl font-bold text-white">{title}</h1>
            <p className="text-slate-400 text-xs mt-0.5">{subtitle}</p>
          </div>

          {/* View */}
          {resetMode ? (
            <ResetPasswordForm />
          ) : view === "signin" ? (
            <SignIn onSwitch={() => setView("signup")} onForgot={() => setView("forgot")} />
          ) : view === "signup" ? (
            <SignUp onSwitch={() => setView("signin")} />
          ) : (
            <ForgotPassword onBack={() => setView("signin")} />
          )}
        </div>
      </div>
    </div>
  );
}
