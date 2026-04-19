import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import {
  CHALLENGE_TTL_SECONDS,
  REGISTER_CHALLENGE_COOKIE,
  RP_NAME,
  getRpIdFromRequest,
} from "@/lib/passkey";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const userClient = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "no session" }, { status: 401 });
  }

  // Anon users can register — /api/auth/passkey/register/verify promotes
  // them in place using the display name they supply there.
  const svc = createSupabaseServiceClient();
  const { data: existing } = await svc
    .from("passkeys")
    .select("credential_id, transports")
    .eq("user_id", user.id);

  const rpID = getRpIdFromRequest(req);
  const userDisplay =
    user.user_metadata?.full_name ??
    user.user_metadata?.name ??
    user.email?.split("@")[0] ??
    "player";

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: new TextEncoder().encode(user.id),
    userName: user.email ?? user.id,
    userDisplayName: userDisplay,
    timeout: CHALLENGE_TTL_SECONDS * 1000,
    attestationType: "none",
    excludeCredentials: (existing ?? []).map((c) => ({
      id: c.credential_id,
      transports: (c.transports ?? []) as AuthenticatorTransport[],
    })),
    authenticatorSelection: {
      // Required so usernameless sign-in can surface this credential
      // later — without a discoverable credential, /signin/options with
      // no allowCredentials won't find it on another device / after a
      // cookie wipe.
      residentKey: "required",
      userVerification: "preferred",
    },
  });

  const jar = await cookies();
  jar.set(REGISTER_CHALLENGE_COOKIE, options.challenge, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: CHALLENGE_TTL_SECONDS,
  });

  return NextResponse.json(options);
}
