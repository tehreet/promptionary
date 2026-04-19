import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import {
  SIGNIN_CHALLENGE_COOKIE,
  base64urlToBytes,
  getExpectedOrigins,
  getRpIdFromRequest,
} from "@/lib/passkey";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    response: AuthenticationResponseJSON;
  };

  const jar = await cookies();
  const expectedChallenge = jar.get(SIGNIN_CHALLENGE_COOKIE)?.value;
  if (!expectedChallenge) {
    return NextResponse.json(
      { error: "challenge expired — try again" },
      { status: 400 },
    );
  }

  const credentialIdRaw = body.response.id;

  const svc = createSupabaseServiceClient();
  const { data: cred } = await svc
    .from("passkeys")
    .select("id, user_id, credential_id, public_key, counter, transports")
    .eq("credential_id", credentialIdRaw)
    .maybeSingle();
  if (!cred) {
    return NextResponse.json(
      { error: "unknown passkey" },
      { status: 404 },
    );
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: getExpectedOrigins(req),
      expectedRPID: getRpIdFromRequest(req),
      requireUserVerification: false,
      credential: {
        id: cred.credential_id,
        publicKey: new Uint8Array(base64urlToBytes(cred.public_key)),
        counter: Number(cred.counter),
        transports: (cred.transports ?? []) as AuthenticatorTransport[],
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (!verification.verified) {
    return NextResponse.json({ error: "verification failed" }, { status: 400 });
  }

  // Bump the signature counter to guard against replay.
  await svc
    .from("passkeys")
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", cred.id);

  // Mint a real Supabase session for the owning user by generating a
  // magic-link hashed token (admin API) and then calling verifyOtp on the
  // request-scoped client, which writes the session cookies on the
  // response.
  const {
    data: userRes,
    error: userErr,
  } = await svc.auth.admin.getUserById(cred.user_id);
  if (userErr || !userRes?.user?.email) {
    return NextResponse.json(
      { error: "user has no email — cannot mint session" },
      { status: 409 },
    );
  }
  const email = userRes.user.email;

  const { data: link, error: linkErr } = await svc.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    return NextResponse.json(
      { error: linkErr?.message ?? "could not mint session" },
      { status: 500 },
    );
  }

  const userClient = await createSupabaseServerClient();
  const { error: otpErr } = await userClient.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (otpErr) {
    return NextResponse.json({ error: otpErr.message }, { status: 500 });
  }

  // Clear the challenge cookie so it can't be replayed.
  jar.set(SIGNIN_CHALLENGE_COOKIE, "", { path: "/", maxAge: 0 });

  return NextResponse.json({ ok: true });
}
