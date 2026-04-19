"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";

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
        className="w-full h-11 rounded-xl font-semibold"
      >
        <span className="mr-1.5" aria-hidden>
          🔑
        </span>
        {busy ? "Waiting for passkey…" : "Continue with a passkey"}
      </Button>
      {error && (
        <div className="text-xs bg-red-500/20 border border-red-500/30 rounded-lg px-3 py-2">
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
        className="w-full h-11 rounded-xl font-semibold"
      >
        <span className="mr-1.5" aria-hidden>
          🔑
        </span>
        {busy ? "Waiting for your device…" : "Add a passkey"}
      </Button>
      {error && (
        <div className="text-xs bg-red-500/20 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
