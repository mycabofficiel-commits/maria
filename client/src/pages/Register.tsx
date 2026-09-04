import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/i18n/LangContext";

export default function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const { t } = useLang();
  const [, navigate] = useLocation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError(t("reg_err_pwd"));
      return;
    }
    setLoading(true);
    try {
      await register(email, password, name);
      navigate("/onboarding");
    } catch (err: any) {
      setError(err.message || t("reg_err_generic"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/">
            <div className="inline-flex items-center gap-2 cursor-pointer">
              <span className="text-white text-xl font-semibold">Mar-ia</span>
            </div>
          </Link>
          <h1 className="text-white text-2xl font-bold mt-6">{t("reg_title")}</h1>
          <p className="text-gray-400 mt-2">{t("reg_subtitle")}</p>
        </div>

        {/* Form */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="text-gray-300 text-sm font-medium block mb-2">
                {t("reg_name")}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("reg_name_ph")}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            <div>
              <label className="text-gray-300 text-sm font-medium block mb-2">
                {t("reg_email")}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("reg_email_ph")}
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            <div>
              <label className="text-gray-300 text-sm font-medium block mb-2">
                {t("reg_password")}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("reg_password_ph")}
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors"
            >
              {loading ? t("reg_submitting") : t("reg_submit")}
            </button>
          </form>

          <p className="text-center text-gray-400 text-sm mt-6">
            {t("reg_have_account")}{" "}
            <Link href="/login">
              <span className="text-blue-400 hover:text-blue-300 cursor-pointer font-medium">
                {t("reg_login_link")}
              </span>
            </Link>
          </p>

          <p className="text-center text-gray-500 text-xs mt-4">
            {t("reg_terms_pre")}
            <Link href="/legal/terms">
              <span className="text-gray-400 hover:text-gray-300 cursor-pointer">{t("reg_terms_cgu")}</span>
            </Link>
            {t("reg_terms_and")}
            <Link href="/legal/privacy">
              <span className="text-gray-400 hover:text-gray-300 cursor-pointer">{t("reg_terms_privacy")}</span>
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
