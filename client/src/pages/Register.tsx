import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";

export default function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const [, navigate] = useLocation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères");
      return;
    }
    setLoading(true);
    try {
      await register(email, password, name);
      navigate("/onboarding");
    } catch (err: any) {
      setError(err.message || "Erreur lors de l'inscription");
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
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <span className="text-white text-sm font-bold">✦</span>
              </div>
              <span className="text-white text-xl font-semibold">Maria</span>
            </div>
          </Link>
          <h1 className="text-white text-2xl font-bold mt-6">Créer un compte</h1>
          <p className="text-gray-400 mt-2">Commencez gratuitement — aucune carte requise.</p>
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
                Nom complet
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jean Dupont"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            <div>
              <label className="text-gray-300 text-sm font-medium block mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            <div>
              <label className="text-gray-300 text-sm font-medium block mb-2">
                Mot de passe
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8 caractères minimum"
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors"
            >
              {loading ? "Création..." : "Créer mon compte"}
            </button>
          </form>

          <p className="text-center text-gray-400 text-sm mt-6">
            Déjà un compte ?{" "}
            <Link href="/login">
              <span className="text-blue-400 hover:text-blue-300 cursor-pointer font-medium">
                Se connecter
              </span>
            </Link>
          </p>

          <p className="text-center text-gray-500 text-xs mt-4">
            En créant un compte, vous acceptez nos{" "}
            <Link href="/legal/terms">
              <span className="text-gray-400 hover:text-gray-300 cursor-pointer">CGU</span>
            </Link>{" "}
            et notre{" "}
            <Link href="/legal/privacy">
              <span className="text-gray-400 hover:text-gray-300 cursor-pointer">Politique de confidentialité</span>
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
