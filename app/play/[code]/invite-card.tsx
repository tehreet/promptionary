"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";

export function InviteCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);

  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/play/${code}`
      : `https://promptionary.io/play/${code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // graceful no-op for browsers without clipboard perms
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl bg-card border border-border p-4 flex flex-col gap-3 shadow-sm">
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] sm:text-xs uppercase tracking-widest text-muted-foreground">
            Invite link
          </p>
          <p className="text-xs sm:text-sm font-mono truncate">{url}</p>
        </div>
        <Button
          onClick={copy}
          className="font-bold h-10 px-3 sm:px-4 rounded-xl"
        >
          {copied ? "Copied!" : "Copy"}
        </Button>
        <Button
          onClick={() => setShowQR((v) => !v)}
          variant="outline"
          className="h-10 px-3 rounded-xl"
        >
          QR
        </Button>
      </div>
      {showQR && (
        <div className="flex justify-center bg-white rounded-xl p-4">
          <QRCodeSVG value={url} size={180} level="M" marginSize={0} />
        </div>
      )}
    </div>
  );
}
