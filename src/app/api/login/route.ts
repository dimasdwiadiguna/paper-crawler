import { NextResponse, type NextRequest } from "next/server";
import { checkPasscode, passcode, SESSION_COOKIE, SESSION_MAX_AGE, sessionToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  if (!passcode()) return NextResponse.json({ error: "APP_PASSCODE is not set on the server" }, { status: 500 });
  const { passcode: input } = (await req.json().catch(() => ({}))) as { passcode?: string };
  if (!input || !(await checkPasscode(input))) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return NextResponse.json({ error: "Wrong passcode" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, (await sessionToken())!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
