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

/* ── Password rules ──────────────────────────────────────────────────────── */
const RULES = [
  { label: "8 caractères minimum", test: (p: string) => p.length >= 8 },
  { label: "1 majuscule (A-Z)", test: (p: string) => /[A-Z]/.test(p) },
  { label: "1 caractère spécial (!@#…)", test: (p: string) => /[@$!%*?&.#^()\-_=+\[\]{}|;:'",<>/\\`~]/.test(p) },
];

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
  const [mode, setMode] = useState<"login" | "register">("login");
  const [step, setStep] = useState<"form" | "otp">("form");

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

  // Countdown for resend
  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setTimeout(() => setResendTimer(r => r - 1), 1000);
    return () => clearTimeout(t);
  }, [resendTimer]);

  const pwRules = RULES.map(r => ({ ...r, ok: r.test(password) }));
  const pwValid = pwRules.every(r => r.ok);
  const pwMatch = password === confirmPw && confirmPw.length > 0;

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
      navigate("/dashboard");
    } catch { toast.error("Erreur réseau, réessaie."); }
    finally { setLoading(false); }
  }

  /* ── Register → send OTP ───────────────────────────────────────────────── */
  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!pwValid) { toast.error("Le mot de passe ne respecte pas les règles."); return; }
    if (!pwMatch) { toast.error("Les mots de passe ne correspondent pas."); return; }
    if (captchaAnswer.trim() !== captcha.answer) { toast.error("Réponse au captcha incorrecte."); return; }
    if (!acceptCGU || !acceptCGV) { toast.error("Veuillez accepter les conditions."); return; }

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
      toast.success("Code envoyé ! Vérifiez votre boîte mail.");
    } catch { toast.error("Erreur réseau, réessaie."); }
    finally { setLoading(false); }
  }

  /* ── Verify OTP ────────────────────────────────────────────────────────── */
  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (otpCode.replace(/\s/g, "").length < 6) { toast.error("Entrez le code à 6 chiffres."); return; }
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
      toast.success("Compte créé ! Bienvenue sur Mar-ia 🎉");
      navigate("/dashboard");
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
      if (res.ok) { setResendTimer(60); toast.success("Nouveau code envoyé !"); }
      else { const d = await res.json(); toast.error(d.error || "Erreur."); }
    } catch { toast.error("Erreur réseau."); }
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
            <h1 className="text-2xl font-bold text-foreground">Vérification email</h1>
            <p className="text-muted-foreground text-sm">
              Nous avons envoyé un code à 6 chiffres à <br />
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
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Vérification…</>
                : "Vérifier et créer mon compte"
              }
            </Button>
          </form>

          <div className="text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              {resendTimer > 0
                ? `Renvoyer le code dans ${resendTimer}s`
                : <button onClick={handleResend} className="text-primary hover:underline font-medium" disabled={loading}>
                    Renvoyer le code
                  </button>
              }
            </p>
            <button
              onClick={() => { setStep("form"); setOtpCode(""); }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Modifier mon email
            </button>
          </div>
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
            <LogoBrand size="lg" showSlogan />
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="toi@exemple.com"
                value={email} onChange={e => setEmail(e.target.value)}
                required autoFocus className="bg-input border-border/60" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Mot de passe</Label>
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

            <Button type="submit"
              className="w-full h-11 bg-primary hover:bg-primary/90 font-medium"
              disabled={loading || !email || !password}>
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Connexion…</>
                : "Se connecter"}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Pas encore de compte ?{" "}
            <button onClick={() => setMode("register")} className="text-primary hover:underline font-medium">
              S'inscrire
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
          <LogoBrand size="lg" showSlogan />
          <p className="text-muted-foreground text-sm pt-2">
            Gratuit pour commencer · Aucune carte requise
          </p>
        </div>

        <form onSubmit={handleRegister} className="space-y-4">
          {/* Honeypot anti-bot */}
          <input type="text" name="website" autoComplete="off" tabIndex={-1}
            style={{ position: "absolute", left: "-9999px" }} aria-hidden="true" />

          {/* Nom */}
          <div className="space-y-1.5">
            <Label htmlFor="name">Nom</Label>
            <Input id="name" placeholder="Ex: Sophie" value={name}
              onChange={e => setName(e.target.value)}
              className="bg-input border-border/60" />
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="reg-email">Email</Label>
            <Input id="reg-email" type="email" placeholder="toi@exemple.com"
              value={email} onChange={e => setEmail(e.target.value)}
              required autoFocus className="bg-input border-border/60" />
          </div>

          {/* Mot de passe */}
          <div className="space-y-1.5">
            <Label htmlFor="reg-password">Mot de passe</Label>
            <div className="relative">
              <Input id="reg-password" type={showPwd ? "text" : "password"}
                placeholder="8 car. · 1 maj. · 1 spécial"
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
            <Label htmlFor="confirm-password">Confirmer le mot de passe</Label>
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
              <p className="text-xs text-red-400 mt-1">Les mots de passe ne correspondent pas.</p>
            )}
          </div>

          {/* Captcha math */}
          <div className="space-y-1.5">
            <Label htmlFor="captcha">
              Vérification anti-robot — <span className="text-primary font-mono">{captcha.question}</span>
            </Label>
            <Input id="captcha" type="text" placeholder="Votre réponse" inputMode="numeric"
              value={captchaAnswer} onChange={e => setCaptchaAnswer(e.target.value)}
              required className="bg-input border-border/60 max-w-[120px]" />
          </div>

          {/* Checkboxes CGU + CGV */}
          <div className="space-y-2.5 pt-1">
            <label className="flex items-start gap-2.5 cursor-pointer group">
              <input type="checkbox" checked={acceptCGU} onChange={e => setAcceptCGU(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-primary rounded flex-shrink-0" />
              <span className="text-xs text-muted-foreground leading-relaxed">
                J'accepte les{" "}
                <Link href="/cgu" target="_blank"
                  className="text-primary hover:underline font-medium">
                  Conditions Générales d'Utilisation
                </Link>
              </span>
            </label>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={acceptCGV} onChange={e => setAcceptCGV(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-primary rounded flex-shrink-0" />
              <span className="text-xs text-muted-foreground leading-relaxed">
                J'accepte les{" "}
                <Link href="/pricing" target="_blank"
                  className="text-primary hover:underline font-medium">
                  Conditions Générales de Vente
                </Link>
              </span>
            </label>
          </div>

          <Button type="submit"
            className="w-full h-11 bg-primary hover:bg-primary/90 font-medium"
            disabled={loading || !email || !pwValid || !pwMatch || !acceptCGU || !acceptCGV || captchaAnswer.trim() !== captcha.answer}>
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Envoi du code…</>
              : "Créer mon compte →"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Déjà un compte ?{" "}
          <button onClick={() => setMode("login")} className="text-primary hover:underline font-medium">
            Se connecter
          </button>
        </p>
      </div>
    </div>
  );
}
