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
  getExpectedOrigins,
  getRpIdFromRequest,
} from "@/lib/passkey";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const userClient = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user || user.is_anonymous) {
    return NextResponse.json({ error: "unauthed" }, { status: 401 });
  }

  const body = (await req.json()) as {
    response: RegistrationResponseJSON;
    label?: string;
  };

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
  const credentialId = Buffer.from(info.credential.id, "base64url");
  const publicKey = Buffer.from(info.credential.publicKey);

  const svc = createSupabaseServiceClient();
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
