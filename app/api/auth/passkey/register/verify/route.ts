import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import {
  REGISTER_CHALLENGE_COOKIE,
  bytesToBase64url,
  getExpectedOrigins,
  getRpIdFromRequest,
} from "@/lib/passkey";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const userClient = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthed" }, { status: 401 });
  }

  const body = (await req.json()) as {
    response: RegistrationResponseJSON;
    label?: string;
    displayName?: string;
  };

  // Anon users must supply a display name — we promote them in place so
  // the magic-link session-mint path works on future sign-ins, and the
  // handle_user_promoted trigger needs something to put in profiles.
  const displayName = body.displayName?.trim() ?? "";
  if (user.is_anonymous) {
    if (displayName.length < 1 || displayName.length > 24) {
      return NextResponse.json(
        { error: "display name must be 1–24 characters" },
        { status: 400 },
      );
    }
  }

  const jar = await cookies();
  const expectedChallenge = jar.get(REGISTER_CHALLENGE_COOKIE)?.value;
  if (!expectedChallenge) {
    return NextResponse.json(
      { error: "challenge expired — try again" },
      { status: 400 },
    );
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: getExpectedOrigins(req),
      expectedRPID: getRpIdFromRequest(req),
      requireUserVerification: false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "verification failed" }, { status: 400 });
  }

  const info = verification.registrationInfo;
  // SimpleWebAuthn already returns credential.id as base64url. publicKey
  // arrives as Uint8Array — encode to base64url for TEXT storage.
  const credentialId = info.credential.id;
  const publicKey = bytesToBase64url(info.credential.publicKey);

  const svc = createSupabaseServiceClient();

  // Promote first — if this fails we don't want an orphan passkey row.
  if (user.is_anonymous) {
    const syntheticEmail = `${user.id}@passkey.promptionary.io`;
    const { error: promoteErr } = await svc.rpc("promote_anon_for_passkey", {
      p_user_id: user.id,
      p_email: syntheticEmail,
      p_display_name: displayName,
    });
    if (promoteErr) {
      return NextResponse.json(
        { error: `could not promote: ${promoteErr.message}` },
        { status: 500 },
      );
    }
  }

  const { error } = await svc.from("passkeys").insert({
    user_id: user.id,
    credential_id: credentialId,
    public_key: publicKey,
    counter: info.credential.counter ?? 0,
    transports: info.credential.transports ?? [],
    device_type: info.credentialDeviceType,
    backed_up: info.credentialBackedUp,
    label: body.label ?? null,
  });

  // Clear the challenge cookie so it can't be replayed.
  jar.set(REGISTER_CHALLENGE_COOKIE, "", { path: "/", maxAge: 0 });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
