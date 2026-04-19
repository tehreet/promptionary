"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PasskeySignInButton({
  onDone,
}: {
  onDone?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const optsRes = await fetch("/api/auth/passkey/signin/options", {
        method: "POST",
      });
      if (!optsRes.ok) {
        const body = await optsRes.json().catch(() => ({}));
        throw new Error(body.error ?? `options status ${optsRes.status}`);
      }
      const options = await optsRes.json();

      const assertion = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch("/api/auth/passkey/signin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: assertion }),
      });
      const verifyBody = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(verifyBody.error ?? `verify status ${verifyRes.status}`);
      }
      if (onDone) onDone();
      router.refresh();
      router.push("/");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // WebAuthn "NotAllowedError" = user cancelled / no matching key. Make
      // that friendlier than the raw DOMException message.
      setError(
        msg.includes("NotAllowedError")
          ? "Passkey prompt cancelled or no matching key."
          : msg,
      );
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        onClick={go}
        disabled={busy}
        variant="outline"
        data-provider="passkey"
        className="w-full h-12"
      >
        <span className="mr-1.5" aria-hidden>
          🔑
        </span>
        {busy ? "Waiting for passkey…" : "Continue with a passkey"}
      </Button>
      {error && (
        <div className="text-xs bg-destructive/20 border border-destructive rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}

// One-button flow for the /sign-in page: try passkey sign-in first; if the
// visitor has no matching key (or cancels) we fall through to a register
// sub-UI that collects a display name and mints them an account with a
// new passkey. The underlying /api/auth/passkey/register/* routes promote
// the anon session in place so their user_id (and any in-flight rooms)
// survives.
export function PasskeyContinueButton({ onDone }: { onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [displayName, setDisplayName] = useState("");

  async function trySignIn() {
    setBusy(true);
    setError(null);
    try {
      const optsRes = await fetch("/api/auth/passkey/signin/options", {
        method: "POST",
      });
      if (!optsRes.ok) {
        const body = await optsRes.json().catch(() => ({}));
        throw new Error(body.error ?? `options status ${optsRes.status}`);
      }
      const options = await optsRes.json();

      let assertion;
      try {
        assertion = await startAuthentication({ optionsJSON: options });
      } catch (e) {
        const err = e as { name?: string; message?: string };
        // Per WebAuthn spec, "no matching key" / user-cancel / timeout all
        // surface as a NotAllowedError DOMException. SimpleWebAuthn
        // preserves the name on its wrapper class. Fall through to the
        // register UI — the user can create a key instead.
        if (err?.name === "NotAllowedError") {
          setMode("register");
          setBusy(false);
          return;
        }
        throw e;
      }

      const verifyRes = await fetch("/api/auth/passkey/signin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: assertion }),
      });
      if (verifyRes.status === 404) {
        // Key lives on the device but isn't in our DB — offer to register.
        setMode("register");
        setBusy(false);
        return;
      }
      const verifyBody = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(verifyBody.error ?? `verify status ${verifyRes.status}`);
      }
      if (onDone) onDone();
      // Full reload so the layout's server-rendered auth state picks up
      // the new session cookies on first paint (router.refresh alone
      // races with router.push here).
      window.location.assign("/");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setBusy(false);
    }
  }

  async function doRegister() {
    const trimmed = displayName.trim();
    if (trimmed.length < 1 || trimmed.length > 24) {
      setError("Display name must be 1–24 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const optsRes = await fetch("/api/auth/passkey/register/options", {
        method: "POST",
      });
      if (!optsRes.ok) {
        const body = await optsRes.json().catch(() => ({}));
        throw new Error(body.error ?? `options status ${optsRes.status}`);
      }
      const options = await optsRes.json();

      const attestation = await startRegistration({ optionsJSON: options });

      const label =
        typeof navigator !== "undefined"
          ? navigator.platform || navigator.userAgent.slice(0, 40)
          : null;

      const verifyRes = await fetch("/api/auth/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response: attestation,
          label,
          displayName: trimmed,
        }),
      });
      const verifyBody = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(verifyBody.error ?? `verify status ${verifyRes.status}`);
      }
      if (onDone) onDone();
      // Promotion updates auth.users but the client's session cookie was
      // minted when the user was anon — a full reload picks up the fresh
      // JWT + profile row on the server side.
      window.location.assign("/");
    } catch (e) {
      const err = e as { name?: string; message?: string };
      setError(
        err?.name === "NotAllowedError"
          ? "Passkey prompt cancelled."
          : (err?.message ?? String(e)),
      );
      setBusy(false);
    }
  }

  if (mode === "register") {
    return (
      <div className="space-y-2" data-passkey-mode="register">
        <div className="space-y-1.5">
          <Label htmlFor="passkey-display-name">Pick a name to play as</Label>
          <Input
            id="passkey-display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Skylar"
            maxLength={24}
            autoFocus
            disabled={busy}
          />
        </div>
        <Button
          onClick={doRegister}
          disabled={busy || displayName.trim().length === 0}
          data-provider="passkey"
          data-action="register-and-signin"
          className="w-full h-12"
        >
          <span className="mr-1.5" aria-hidden>
            🔑
          </span>
          {busy ? "Waiting for your device…" : "Create account with a passkey"}
        </Button>
        <button
          type="button"
          onClick={() => {
            setMode("signin");
            setError(null);
          }}
          disabled={busy}
          className="text-xs text-muted-foreground hover:underline disabled:opacity-50"
        >
          ← Try signing in instead
        </button>
        {error && (
          <div className="text-xs bg-destructive/20 border border-destructive rounded-lg px-3 py-2">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2" data-passkey-mode="signin">
      <Button
        onClick={trySignIn}
        disabled={busy}
        data-provider="passkey"
        className="w-full h-12"
      >
        <span className="mr-1.5" aria-hidden>
          🔑
        </span>
        {busy ? "Waiting for passkey…" : "Use a passkey"}
      </Button>
      {error && (
        <div className="text-xs bg-destructive/20 border border-destructive rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}

export function PasskeyRegisterButton({
  onDone,
}: {
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const optsRes = await fetch("/api/auth/passkey/register/options", {
        method: "POST",
      });
      if (!optsRes.ok) {
        const body = await optsRes.json().catch(() => ({}));
        throw new Error(body.error ?? `options status ${optsRes.status}`);
      }
      const options = await optsRes.json();

      const attestation = await startRegistration({ optionsJSON: options });

      const label =
        typeof navigator !== "undefined"
          ? navigator.platform || navigator.userAgent.slice(0, 40)
          : null;

      const verifyRes = await fetch("/api/auth/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: attestation, label }),
      });
      const verifyBody = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(verifyBody.error ?? `verify status ${verifyRes.status}`);
      }
      if (onDone) onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        msg.includes("NotAllowedError")
          ? "Passkey prompt cancelled."
          : msg,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        onClick={go}
        disabled={busy}
        data-action="register-passkey"
        className="w-full h-12"
      >
        <span className="mr-1.5" aria-hidden>
          🔑
        </span>
        {busy ? "Waiting for your device…" : "Add a passkey"}
      </Button>
      {error && (
        <div className="text-xs bg-destructive/20 border border-destructive rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
