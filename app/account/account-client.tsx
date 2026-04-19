"use client";

import { useCallback, useEffect, useState } from "react";
import { PasskeyRegisterButton } from "@/components/passkey-buttons";

type PasskeyRow = {
  id: string;
  label: string | null;
  device_type: string | null;
  backed_up: boolean;
  created_at: string;
  last_used_at: string | null;
};

export function AccountClient() {
  const [keys, setKeys] = useState<PasskeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/passkey/list");
      if (res.ok) {
        const body = await res.json();
        setKeys(body.passkeys ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string) {
    setBusyId(id);
    try {
      await fetch("/api/auth/passkey/list", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="w-full max-w-xl rounded-3xl bg-card/90 backdrop-blur border border-border shadow-xl p-6 space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-heading font-black">Passkeys</h2>
        <p className="text-xs text-muted-foreground">
          Sign in with your phone, laptop, or a security key — no password.
        </p>
      </div>

      <PasskeyRegisterButton onDone={load} />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No passkeys yet. Add one above to sign in instantly next time.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="passkey-list">
          {keys.map((k) => {
            const created = new Date(k.created_at).toLocaleDateString();
            const lastUsed = k.last_used_at
              ? new Date(k.last_used_at).toLocaleDateString()
              : "never";
            return (
              <li
                key={k.id}
                data-passkey-id={k.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2"
              >
                <span className="text-xl">🔑</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">
                    {k.label ?? "Passkey"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Added {created} · last used {lastUsed}
                    {k.backed_up ? " · synced" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(k.id)}
                  disabled={busyId === k.id}
                  className="text-xs rounded-full border border-border bg-muted hover:bg-destructive hover:text-white px-3 py-1 font-semibold transition disabled:opacity-50"
                >
                  {busyId === k.id ? "Removing…" : "Remove"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
