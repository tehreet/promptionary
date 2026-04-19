import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import {
  CHALLENGE_TTL_SECONDS,
  SIGNIN_CHALLENGE_COOKIE,
  getRpIdFromRequest,
} from "@/lib/passkey";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const rpID = getRpIdFromRequest(req);
  // Usernameless / resident-key flow: we don't know which user yet, so
  // leave allowCredentials empty. The browser will surface whichever
  // passkey matches this RP ID.
  const options = await generateAuthenticationOptions({
    rpID,
    timeout: CHALLENGE_TTL_SECONDS * 1000,
    userVerification: "preferred",
  });

  const jar = await cookies();
  jar.set(SIGNIN_CHALLENGE_COOKIE, options.challenge, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: CHALLENGE_TTL_SECONDS,
  });

  return NextResponse.json(options);
}
