import { useState, useRef, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { Eye, EyeOff, Loader2, CheckCircle2, XCircle, Mail } from "lucide-react";
import LogoBrand from "@/components/LogoBrand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { useLang } from "@/i18n/LangContext";

/* ── Password rules ──────────────────────────────────────────────────────── */
function PwRule({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-1.5 text-xs">
      {ok
        ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
        : <XCircle className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
      <span className={ok ? "text-emerald-400" : "text-muted-foreground"}>{label}</span>
    </li>
  );
}

/* ── Math captcha ────────────────────────────────────────────────────────── */
function useCaptcha() {
  const a = useMemo(() => Math.floor(1 + Math.random() * 9), []);
  const b = useMemo(() => Math.floor(1 + Math.random() * 9), []);
  return { question: `${a} + ${b} = ?`, answer: String(a + b) };
}

/* ── OTP input ───────────────────────────────────────────────────────────── */
function OtpInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  function handleKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !value[i] && i > 0) inputs.current[i - 1]?.focus();
  }
  function handleChange(i: number, char: string) {
    const digit = char.replace(/\D/, "").slice(-1);
    const arr = value.padEnd(6, " ").split("");
    arr[i] = digit || " ";
    const next = arr.join("").trimEnd();
    onChange(next);
    if (digit && i < 5) inputs.current[i + 1]?.focus();
  }
  function handlePaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted) { onChange(pasted); inputs.current[Math.min(pasted.length, 5)]?.focus(); }
    e.preventDefault();
  }

  return (
    <div className="flex gap-2 justify-center" onPaste={handlePaste}>
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={el => { inputs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[i] || ""}
          onChange={e => handleChange(i, e.target.value)}
          onKeyDown={e => handleKey(i, e)}
          className="w-11 h-14 text-center text-2xl font-bold font-mono rounded-xl border border-border/60 bg-input text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
          autoFocus={i === 0}
        />
      ))}
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────────────── */
export default function Login() {
  const [, navigate] = useLocation();
  const { t } = useLang();
  // Destination après connexion : ?next=<chemin interne> (ex: retour sur une invitation
  // /invite/<token>). Validé pour rester interne (anti open-redirect). Défaut: /dashboard.
  const postLoginDest = (() => {
    try {
      const next = new URLSearchParams(window.location.search).get("next");
      if (next && next.startsWith("/") && !next.startsWith("//")) return next;
    } catch { /* ignore */ }
    return "/dashboard";
  })();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [step, setStep] = useState<"form" | "otp" | "forgot" | "forgot_otp" | "forgot_newpw">("form");

  // Form fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [name, setName] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  // Register extras
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [acceptCGU, setAcceptCGU] = useState(false);
  const [acceptCGV, setAcceptCGV] = useState(false);
  const captcha = useCaptcha();

  // OTP
  const [otpCode, setOtpCode] = useState("");
  const [resendTimer, setResendTimer] = useState(0);
  const utils = trpc.useUtils();

  // Forgot password
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetOtpCode, setResetOtpCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPw, setConfirmNewPw] = useState("");
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmNew, setShowConfirmNew] = useState(false);

  // Password rules for new password (reset flow)
  const newPwRules = [
    { label: t("auth_rule_8chars"), ok: newPassword.length >= 8 },
    { label: t("auth_rule_upper"),  ok: /[A-Z]/.test(newPassword) },
    { label: t("auth_rule_special"), ok: /[@$!%*?&.#^()\-_=+\[\]{}|;:'",<>/\\`~]/.test(newPassword) },
  ];
  const newPwValid = newPwRules.every(r => r.ok);
  const newPwMatch = newPassword === confirmNewPw && confirmNewPw.length > 0;

  // Password rules (translated)
  const pwRules = [
    { label: t("auth_rule_8chars"), ok: password.length >= 8 },
    { label: t("auth_rule_upper"),  ok: /[A-Z]/.test(password) },
    { label: t("auth_rule_special"), ok: /[@$!%*?&.#^()\-_=+\[\]{}|;:'",<>/\\`~]/.test(password) },
  ];
  const pwValid = pwRules.every(r => r.ok);
  const pwMatch = password === confirmPw && confirmPw.length > 0;

  // Countdown for resend
  useEffect(() => {
    if (resendTimer <= 0) return;
    const timer = setTimeout(() => setResendTimer(r => r - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendTimer]);

  /* ── Login handler ─────────────────────────────────────────────────────── */
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Erreur de connexion."); return; }
      await utils.auth.me.invalidate();
      navigate(postLoginDest);
    } catch { toast.error("Erreur réseau, réessaie."); }
    finally { setLoading(false); }
  }

  /* ── Register → send OTP ───────────────────────────────────────────────── */
  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!pwValid) { toast.error(t("auth_rule_8chars")); return; }
    if (!pwMatch) { toast.error(t("auth_pw_mismatch")); return; }
    if (captchaAnswer.trim() !== captcha.answer) { toast.error(t("auth_captcha_label")); return; }
    if (!acceptCGU || !acceptCGV) return;

    setLoading(true);
    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Erreur d'inscription."); return; }
      setStep("otp");
      setOtpCode("");
      setResendTimer(60);
    } catch { toast.error("Erreur réseau, réessaie."); }
    finally { setLoading(false); }
  }

  /* ── Verify OTP ────────────────────────────────────────────────────────── */
  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (otpCode.replace(/\s/g, "").length < 6) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, code: otpCode.replace(/\s/g, "") }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Code invalide."); return; }
      await utils.auth.me.invalidate();
      navigate(postLoginDest);
    } catch { toast.error("Erreur réseau, réessaie."); }
    finally { setLoading(false); }
  }

  /* ── Resend OTP ────────────────────────────────────────────────────────── */
  async function handleResend() {
    if (resendTimer > 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, name: name.trim() }),
      });
      if (res.ok) setResendTimer(60);
      else { const d = await res.json(); toast.error(d.error || "Erreur."); }
    } catch { toast.error("Erreur réseau."); }
    finally { setLoading(false); }
  }

  /* ── Forgot password — request code ───────────────────────────────────── */
  async function handleForgotRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!forgotEmail.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: forgotEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Erreur."); return; }
      setStep("forgot_otp");
      setResetOtpCode("");
    } catch { toast.error("Erreur réseau, réessaie."); }
    finally { setLoading(false); }
  }

  /* ── Forgot password — verify OTP ─────────────────────────────────────── */
  async function handleForgotVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (resetOtpCode.replace(/\s/g, "").length < 6) return;
    // Just advance to new password step — actual validation happens on submit
    setStep("forgot_newpw");
    setNewPassword("");
    setConfirmNewPw("");
  }

  /* ── Forgot password — set new password ───────────────────────────────── */
  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!newPwValid) { toast.error(t("auth_rule_8chars")); return; }
    if (!newPwMatch) { toast.error(t("auth_pw_mismatch")); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: forgotEmail.trim(), code: resetOtpCode.replace(/\s/g, ""), newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Code invalide ou expiré.");
        // If code was wrong, go back to OTP step
        if (res.status === 400 || res.status === 429) setStep("forgot_otp");
        return;
      }
      toast.success(t("auth_reset_success"));
      setStep("form");
      setMode("login");
      setEmail(forgotEmail);
      setPassword("");
    } catch { toast.error("Erreur réseau, réessaie."); }
    finally { setLoading(false); }
  }

  /* ── OTP step ──────────────────────────────────────────────────────────── */
  if (step === "otp") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-8">
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Mail className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">{t("auth_otp_title")}</h1>
            <p className="text-muted-foreground text-sm">
              {t("auth_otp_sub")}<br />
              <strong className="text-foreground">{email}</strong>
            </p>
          </div>

          <form onSubmit={handleVerifyOtp} className="space-y-6">
            <OtpInput value={otpCode} onChange={setOtpCode} />
            <Button
              type="submit"
              className="w-full h-11 bg-primary hover:bg-primary/90 font-medium"
              disabled={loading || otpCode.replace(/\s/g, "").length < 6}
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />{t("auth_otp_verifying")}</>
                : t("auth_otp_verify_btn")}
            </Button>
          </form>

          <div className="text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              {resendTimer > 0
                ? `${t("auth_otp_resend_wait")} ${resendTimer}s`
                : <button onClick={handleResend} className="text-primary hover:underline font-medium" disabled={loading}>
                    {t("auth_otp_resend_btn")}
                  </button>
              }
            </p>
            <button
              onClick={() => { setStep("form"); setOtpCode(""); }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("auth_otp_back")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Forgot — enter email ──────────────────────────────────────────────── */
  if (step === "forgot") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-8">
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Mail className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">{t("auth_forgot_title")}</h1>
            <p className="text-muted-foreground text-sm">{t("auth_forgot_sub")}</p>
          </div>
          <form onSubmit={handleForgotRequest} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="forgot-email">{t("auth_email")}</Label>
              <Input id="forgot-email" type="email" placeholder="toi@exemple.com"
                value={forgotEmail} onChange={e => setForgotEmail(e.target.value)}
                required autoFocus className="bg-input border-border/60" />
            </div>
            <Button type="submit"
              className="w-full h-11 bg-primary hover:bg-primary/90 font-medium"
              disabled={loading || !forgotEmail.trim()}>
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />{t("auth_forgot_sending")}</>
                : t("auth_forgot_email_btn")}
            </Button>
          </form>
          <div className="text-center">
            <button onClick={() => setStep("form")}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              {t("auth_forgot_back_login")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Forgot — OTP verification ─────────────────────────────────────────── */
  if (step === "forgot_otp") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-8">
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Mail className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">{t("auth_reset_otp_title")}</h1>
            <p className="text-muted-foreground text-sm">
              {t("auth_reset_otp_sub")}<br />
              <strong className="text-foreground">{forgotEmail}</strong>
            </p>
          </div>
          <form onSubmit={handleForgotVerifyOtp} className="space-y-6">
            <OtpInput value={resetOtpCode} onChange={setResetOtpCode} />
            <Button type="submit"
              className="w-full h-11 bg-primary hover:bg-primary/90 font-medium"
              disabled={resetOtpCode.replace(/\s/g, "").length < 6}>
              {t("auth_reset_otp_verify_btn")}
            </Button>
          </form>
          <div className="text-center">
            <button onClick={() => setStep("forgot")}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {t("auth_forgot_back_login")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Forgot — new password ─────────────────────────────────────────────── */
  if (step === "forgot_newpw") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-8">
          <div className="flex flex-col items-center text-center space-y-3">
            <h1 className="text-2xl font-bold text-foreground">{t("auth_reset_newpw_title")}</h1>
          </div>
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-password">{t("auth_password")}</Label>
              <div className="relative">
                <Input id="new-password" type={showNewPwd ? "text" : "password"}
                  placeholder={t("auth_password_placeholder")}
                  value={newPassword} onChange={e => setNewPassword(e.target.value)}
                  required autoFocus className="bg-input border-border/60 pr-10" />
                <button type="button" onClick={() => setShowNewPwd(!showNewPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showNewPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {newPassword.length > 0 && (
                <ul className="space-y-1 mt-1.5 pl-1">
                  {newPwRules.map(r => <PwRule key={r.label} ok={r.ok} label={r.label} />)}
                </ul>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-new-password">{t("auth_confirm_password")}</Label>
              <div className="relative">
                <Input id="confirm-new-password" type={showConfirmNew ? "text" : "password"}
                  placeholder="••••••••"
                  value={confirmNewPw} onChange={e => setConfirmNewPw(e.target.value)}
                  required className={`bg-input border-border/60 pr-10 ${
                    confirmNewPw.length > 0 ? (newPwMatch ? "border-emerald-500/60" : "border-red-500/60") : ""
                  }`} />
                <button type="button" onClick={() => setShowConfirmNew(!showConfirmNew)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showConfirmNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {confirmNewPw.length > 0 && !newPwMatch && (
                <p className="text-xs text-red-400 mt-1">{t("auth_pw_mismatch")}</p>
              )}
            </div>
            <Button type="submit"
              className="w-full h-11 bg-primary hover:bg-primary/90 font-medium"
              disabled={loading || !newPwValid || !newPwMatch}>
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />{t("auth_reset_newpw_saving")}</>
                : t("auth_reset_newpw_btn")}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  /* ── Login form ────────────────────────────────────────────────────────── */
  if (mode === "login") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-8">
          <div className="flex flex-col items-center text-center">
            <Link href="/"><LogoBrand size="lg" showSlogan /></Link>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">{t("auth_email")}</Label>
              <Input id="email" type="email" placeholder="toi@exemple.com"
                value={email} onChange={e => setEmail(e.target.value)}
                required autoFocus className="bg-input border-border/60" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">{t("auth_password")}</Label>
              <div className="relative">
                <Input id="password" type={showPwd ? "text" : "password"}
                  placeholder="••••••••" value={password}
                  onChange={e => setPassword(e.target.value)}
                  required className="bg-input border-border/60 pr-10" />
                <button type="button" onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex justify-end -mt-1">
              <button type="button"
                onClick={() => { setForgotEmail(email); setStep("forgot"); }}
                className="text-xs text-muted-foreground hover:text-primary transition-colors">
                {t("auth_forgot_link")}
              </button>
            </div>

            <Button type="submit"
              className="w-full h-11 bg-primary hover:bg-primary/90 font-medium"
              disabled={loading || !email || !password}>
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />{t("auth_logging_in")}</>
                : t("auth_login_btn")}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            {t("auth_no_account")}{" "}
            <button onClick={() => setMode("register")} className="text-primary hover:underline font-medium">
              {t("auth_register_link")}
            </button>
          </p>
        </div>
      </div>
    );
  }

  /* ── Register form ─────────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center space-y-1">
          <Link href="/"><LogoBrand size="lg" showSlogan /></Link>
          <p className="text-muted-foreground text-sm pt-2">{t("auth_free_start")}</p>
        </div>

        <form onSubmit={handleRegister} className="space-y-4">
          {/* Honeypot */}
          <input type="text" name="website" autoComplete="off" tabIndex={-1}
            style={{ position: "absolute", left: "-9999px" }} aria-hidden="true" />

          {/* Nom */}
          <div className="space-y-1.5">
            <Label htmlFor="name">{t("auth_name")}</Label>
            <Input id="name" placeholder={t("auth_name_placeholder")} value={name}
              onChange={e => setName(e.target.value)}
              className="bg-input border-border/60" />
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="reg-email">{t("auth_email")}</Label>
            <Input id="reg-email" type="email" placeholder="toi@exemple.com"
              value={email} onChange={e => setEmail(e.target.value)}
              required autoFocus className="bg-input border-border/60" />
          </div>

          {/* Mot de passe */}
          <div className="space-y-1.5">
            <Label htmlFor="reg-password">{t("auth_password")}</Label>
            <div className="relative">
              <Input id="reg-password" type={showPwd ? "text" : "password"}
                placeholder={t("auth_password_placeholder")}
                value={password} onChange={e => setPassword(e.target.value)}
                required className="bg-input border-border/60 pr-10" />
              <button type="button" onClick={() => setShowPwd(!showPwd)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {password.length > 0 && (
              <ul className="space-y-1 mt-1.5 pl-1">
                {pwRules.map(r => <PwRule key={r.label} ok={r.ok} label={r.label} />)}
              </ul>
            )}
          </div>

          {/* Confirmer mot de passe */}
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">{t("auth_confirm_password")}</Label>
            <div className="relative">
              <Input id="confirm-password" type={showConfirm ? "text" : "password"}
                placeholder="••••••••"
                value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                required className={`bg-input border-border/60 pr-10 ${
                  confirmPw.length > 0 ? (pwMatch ? "border-emerald-500/60" : "border-red-500/60") : ""
                }`} />
              <button type="button" onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {confirmPw.length > 0 && !pwMatch && (
              <p className="text-xs text-red-400 mt-1">{t("auth_pw_mismatch")}</p>
            )}
          </div>

          {/* Captcha math */}
          <div className="space-y-1.5">
            <Label htmlFor="captcha">
              {t("auth_captcha_label")} — <span className="text-primary font-mono">{captcha.question}</span>
            </Label>
            <Input id="captcha" type="text" placeholder={t("auth_captcha_placeholder")}
              inputMode="numeric"
              value={captchaAnswer} onChange={e => setCaptchaAnswer(e.target.value)}
              required className="bg-input border-border/60 max-w-[120px]" />
          </div>

          {/* CGU + CGV */}
          <div className="space-y-2.5 pt-1">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={acceptCGU} onChange={e => setAcceptCGU(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-primary rounded flex-shrink-0" />
              <span className="text-xs text-muted-foreground leading-relaxed">
                {t("auth_accept_cgu").split("Conditions")[0]}
                <Link href="/cgu" target="_blank" className="text-primary hover:underline font-medium">
                  {t("auth_accept_cgu").includes("Terms") ? "Terms of Service" :
                   t("auth_accept_cgu").includes("Términos") ? "Términos de Servicio" :
                   "Conditions Générales d'Utilisation"}
                </Link>
              </span>
            </label>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={acceptCGV} onChange={e => setAcceptCGV(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-primary rounded flex-shrink-0" />
              <span className="text-xs text-muted-foreground leading-relaxed">
                {t("auth_accept_cgv").split("Conditions")[0].split("Terms")[0].split("Acepto")[0]}
                <Link href="/pricing" target="_blank" className="text-primary hover:underline font-medium">
                  {t("auth_accept_cgv").includes("Terms of Sale") ? "Terms of Sale" :
                   t("auth_accept_cgv").includes("Condiciones") ? "Condiciones de Venta" :
                   "Conditions Générales de Vente"}
                </Link>
              </span>
            </label>
          </div>

          <Button type="submit"
            className="w-full h-11 bg-primary hover:bg-primary/90 font-medium"
            disabled={loading || !email || !pwValid || !pwMatch || !acceptCGU || !acceptCGV || captchaAnswer.trim() !== captcha.answer}>
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />{t("auth_sending")}</>
              : t("auth_create_btn")}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          {t("auth_have_account")}{" "}
          <button onClick={() => setMode("login")} className="text-primary hover:underline font-medium">
            {t("auth_login_btn")}
          </button>
        </p>
      </div>
    </div>
  );
}
