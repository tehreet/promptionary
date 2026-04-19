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
  if (!user || user.is_anonymous) {
    return NextResponse.json(
      { error: "sign in with email or oauth first to add a passkey" },
      { status: 401 },
    );
  }

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
      id: bytesToBase64url(c.credential_id as unknown as Buffer),
      transports: (c.transports ?? []) as AuthenticatorTransport[],
    })),
    authenticatorSelection: {
      residentKey: "preferred",
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

function bytesToBase64url(buf: Buffer | Uint8Array): string {
  const b64 = Buffer.from(buf).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
