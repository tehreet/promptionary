// Shared helpers for the WebAuthn / passkey flows. RP ID + origin derivation
// is centralised here because SimpleWebAuthn verification is strict about
// both, and we want one source of truth across register + sign-in.

export const RP_NAME = "Promptionary";

// Hostnames where passkeys should share the same RP ID (apex + www).
const APEX_HOSTS = new Set(["promptionary.io", "www.promptionary.io"]);

/**
 * Derive the WebAuthn Relying Party ID from the incoming request. For our
 * production apex + www, use `promptionary.io` so passkeys work on both.
 * Elsewhere (localhost, Vercel previews) just use the hostname.
 */
export function getRpIdFromRequest(req: Request): string {
  const origin = new URL(req.url);
  const host = origin.hostname;
  if (APEX_HOSTS.has(host)) return "promptionary.io";
  return host;
}

/**
 * Return the set of origins a passkey assertion may legitimately come from
 * for this request. We include both apex and www on prod so a passkey
 * enrolled at one works at the other.
 */
export function getExpectedOrigins(req: Request): string[] {
  const origin = new URL(req.url);
  const host = origin.hostname;
  if (APEX_HOSTS.has(host)) {
    return [
      "https://promptionary.io",
      "https://www.promptionary.io",
    ];
  }
  return [`${origin.protocol}//${origin.host}`];
}

export const REGISTER_CHALLENGE_COOKIE = "ppk_reg_challenge";
export const SIGNIN_CHALLENGE_COOKIE = "ppk_signin_challenge";
export const CHALLENGE_TTL_SECONDS = 120;

export function bytesToBase64url(buf: Uint8Array | Buffer): string {
  const b64 = Buffer.from(buf).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlToBytes(s: string): Buffer {
  // base64url → base64 with padding, then standard decode.
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  return Buffer.from(b64 + pad, "base64");
}
