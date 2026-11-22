"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Loader2, Lock, ShieldCheck, Mail, RotateCcw, Eye, EyeOff, Flame } from "lucide-react";
import { api } from "./client";

/**
 * VORTEX ID — owner login.
 * Step 1: email + password → Step 2: email OTP (real SMTP since Phase 8 wiring).
 * Public developers build in the Developer Console instead — link below.
 */
export default function VortexLogin({ onAuthed, onOpenConsole }: { onAuthed: () => void; onOpenConsole?: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api<{ otpRequired: boolean; devCode?: string; delivery?: string }>("/api/v1/auth/login", {
      method: "POST",
      body: { email, password },
    });
    setBusy(false);
    if (!res.ok || !res.data?.otpRequired) {
      setError(res.error || "Login failed");
      return;
    }
    setDevCode(res.data.devCode || null);
    setDelivery(res.data.delivery || null);
    setStep(2);
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) {
      setError("Enter the 6-digit code");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await api("/api/v1/auth/otp", {
      method: "POST",
      body: { email, code },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error || "Verification failed");
      return;
    }
    onAuthed();
  }

  async function handleResend() {
    setBusy(true);
    setError(null);
    const res = await api<{ devCode?: string; delivery?: string }>("/api/v1/auth/otp/resend", {
      method: "POST",
      body: { email },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error || "Could not resend");
      return;
    }
    setDevCode(res.data?.devCode || null);
    setDelivery(res.data?.delivery || null);
    setCode("");
  }

  return (
    <div className="min-h-screen vortex-bg flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mb-4 vortex-glow">
            <VortexMark className="w-9 h-9 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-[0.35em] vortex-glow">VORTEX</h1>
          <p className="text-sm text-muted-foreground mt-2 tracking-wide">
            Private Infrastructure Control Plane
          </p>
          <Badge variant="outline" className="mt-3 border-destructive/40 text-destructive/90 text-xs">
            <Lock className="w-3 h-3 mr-1" /> PRIVATE SYSTEM — OWNER ACCESS ONLY
          </Badge>
        </div>

        <Card className="border-primary/20 shadow-2xl shadow-primary/10">
          {step === 1 ? (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-primary" /> VORTEX ID
                </CardTitle>
                <CardDescription>
                  Sign in with the owner account. No public signup exists — by design.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="admin@vortex.local"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="username"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPw ? "text" : "password"}
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        required
                      />
                      <button
                        type="button"
                        aria-label={showPw ? "Hide password" : "Show password"}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPw((v) => !v)}
                      >
                        {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Lock className="w-4 h-4 mr-2" />}
                    Continue
                  </Button>
                </form>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="w-5 h-5 text-primary" /> Two-Factor Verification
                </CardTitle>
                <CardDescription>
                  A 6-digit code was sent to <span className="text-foreground font-medium">{email}</span>.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleVerify} className="space-y-4">
                  <div className="flex justify-center py-2">
                    <InputOTP maxLength={6} value={code} onChange={setCode} disabled={busy}>
                      <InputOTPGroup>
                        <InputOTPSlot index={0} />
                        <InputOTPSlot index={1} />
                        <InputOTPSlot index={2} />
                      </InputOTPGroup>
                      <InputOTPSeparator />
                      <InputOTPGroup>
                        <InputOTPSlot index={3} />
                        <InputOTPSlot index={4} />
                        <InputOTPSlot index={5} />
                      </InputOTPGroup>
                    </InputOTP>
                  </div>

                  {delivery === "SENT" && !devCode && (
                    <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                      <span className="font-semibold">CODE DELIVERED:</span> sent to your inbox over real SMTP.
                      <span className="block mt-1 text-emerald-300/70">
                        For security the code is never echoed to this page once mail delivery is live.
                      </span>
                    </div>
                  )}

                  {devCode && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                      <span className="font-semibold">DEV MODE (no SMTP relay wired):</span>{" "}
                      your OTP is <span className="font-mono font-bold text-amber-200">{devCode}</span>
                      <span className="block mt-1 text-amber-300/70">
                        Save a relay in MAIL → SMTP wiring and flip the provider — codes then go to the real inbox.
                      </span>
                    </div>
                  )}

                  {error && <p className="text-sm text-destructive text-center">{error}</p>}

                  <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
                    {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                    Verify & Enter VORTEX
                  </Button>
                  <Button type="button" variant="ghost" className="w-full" onClick={handleResend} disabled={busy}>
                    <RotateCcw className="w-4 h-4 mr-2" /> Resend code
                  </Button>
                  <Button
                    type="button"
                    variant="link"
                    className="w-full text-muted-foreground"
                    onClick={() => {
                      setStep(1);
                      setCode("");
                      setError(null);
                    }}
                  >
                    Use a different account
                  </Button>
                </form>
              </CardContent>
            </>
          )}
        </Card>

        <div className="flex flex-col items-center gap-2 mt-6">
          <Button
            type="button"
            variant="outline"
            className="w-full border-primary/30 text-primary hover:bg-primary/10"
            onClick={onOpenConsole}
          >
            <Flame className="w-4 h-4 mr-2" />
            Building an app? Open the Developer Console →
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            The control plane stays private — public builders get VORTEX VaaS.
          </p>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          CORE v0.8.0 · Every access attempt is recorded in the audit trail
        </p>
      </div>
    </div>
  );
}

export function VortexMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <path
        d="M24 3 42 13.5v21L24 45 6 34.5v-21L24 3Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M24 12 33 24l-9 12-9-12 9-12Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.25"
      />
      <circle cx="24" cy="24" r="3" fill="currentColor" />
    </svg>
  );
}
