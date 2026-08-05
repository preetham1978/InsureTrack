import React, { useState } from "react";
import { Shield, Key, Mail, CheckCircle2, AlertCircle } from "lucide-react";
import { api } from "../api";
import { User } from "../types";

interface LoginScreenProps {
  onLoginSuccess: (user: User) => void;
}

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [devOtp, setDevOtp] = useState<string | null>(null);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    setDevOtp(null);

    try {
      const data = await api.login(email.trim());
      setMessage(data.message || "OTP sent to your email.");
      if (data.devOtp) {
        setDevOtp(data.devOtp);
        setOtp(data.devOtp); // auto-fill for testing convenience
      }
      setStep("otp");
    } catch (err: any) {
      setError(err.message || "This email isn't registered. Ask your Ops Admin to invite you.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const data = await api.verifyOtp(email.trim(), otp.trim());
      onLoginSuccess(data.user);
    } catch (err: any) {
      setError(err.message || "Invalid or expired code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 font-sans text-slate-100">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center items-center space-x-3">
          <div className="bg-blue-600 p-2.5 rounded-lg text-white shadow-lg shadow-blue-900/20">
            <Shield className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">InsureTrack</h1>
            <p className="text-xs text-slate-400 font-medium">Healthcare Revenue-Cycle by Medyaan</p>
          </div>
        </div>
        <h2 className="mt-6 text-center text-xl font-semibold tracking-tight text-slate-200">
          Sign in to your provider workspace
        </h2>
        <p className="mt-1 text-center text-xs text-slate-400">
          Secure, multi-tenant B2B coverage verification engine
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-900/40 py-8 px-4 shadow-xl border border-slate-800/80 rounded-xl sm:px-10 backdrop-blur-md">
          {error && (
            <div className="mb-4 bg-rose-950/20 border-l-4 border-rose-600 p-3 rounded text-sm text-rose-200 flex items-start space-x-2 border border-rose-900/40">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {message && (
            <div className="mb-4 bg-emerald-950/20 border-l-4 border-emerald-600 p-3 rounded text-sm text-emerald-200 flex items-start space-x-2 border border-emerald-900/40">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
              <span>{message}</span>
            </div>
          )}

          {step === "email" && (
            <form className="space-y-4" onSubmit={handleSendOtp}>
              <div>
                <label htmlFor="email" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Email Address
                </label>
                <div className="relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-4 w-4 text-slate-500" />
                  </div>
                  <input
                    type="email"
                    id="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="block w-full pl-9 pr-3 py-2 bg-slate-950/50 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                    placeholder="name@medyaan.com"
                  />
                </div>
              </div>

              <div>
                <button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full flex justify-center py-2 px-4 border border-transparent rounded-lg shadow-md text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {loading ? "Sending..." : "Send Verification OTP Code"}
                </button>
              </div>

              <div className="mt-6 pt-6 border-t border-slate-800">
                <p className="text-xs font-medium text-slate-400 mb-2">Quick Test Accounts:</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: "Super Admin", email: "super_admin@medyaan.com" },
                    { label: "Reviewer", email: "reviewer@medyaan.com" },
                    { label: "Verifier", email: "verifier@medyaan.com" },
                    { label: "Ops Admin", email: "ops_admin@medyaan.com" },
                    { label: "Client Viewer", email: "apc_viewer@medyaan.com" }
                  ].map((acc) => (
                    <button
                      key={acc.email}
                      type="button"
                      onClick={() => setEmail(acc.email)}
                      className="text-xs bg-slate-800/80 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded-md transition-colors cursor-pointer border border-slate-700/50"
                    >
                      {acc.label}
                    </button>
                  ))}
                </div>
              </div>
            </form>
          )}

          {step === "otp" && (
            <form className="space-y-4" onSubmit={handleVerifyOtp}>
              <div className="text-sm text-slate-300 mb-2">
                We sent a temporary sign-in code to <strong className="text-white">{email}</strong>.
                <div className="mt-1 text-xs text-blue-400 bg-blue-950/30 p-2 rounded border border-blue-900/50">
                  Demo Note: Use verification code <strong className="text-white font-mono">123456</strong> to sign in.
                </div>
              </div>
              <div>
                <label htmlFor="otp" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Verification Code (OTP)
                </label>
                <div className="relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Key className="h-4 w-4 text-slate-500" />
                  </div>
                  <input
                    type="text"
                    id="otp"
                    required
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    className="block w-full pl-9 pr-3 py-2 bg-slate-950/50 border border-slate-800 rounded-lg text-sm text-white tracking-widest placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                    placeholder="••••••"
                  />
                </div>
              </div>

              <div className="flex justify-between items-center text-xs">
                <button
                  type="button"
                  onClick={() => setStep("email")}
                  className="text-blue-400 hover:text-blue-300 font-semibold cursor-pointer bg-transparent border-0"
                >
                  Change Email
                </button>
                <span className="text-slate-500">Code is valid for 5 minutes</span>
              </div>

              <div>
                <button
                  type="submit"
                  disabled={loading || !otp}
                  className="w-full flex justify-center py-2 px-4 border border-transparent rounded-lg shadow-md text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {loading ? "Verifying..." : "Verify & Log In"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
