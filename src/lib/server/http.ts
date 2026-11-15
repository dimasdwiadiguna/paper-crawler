import { NextResponse, type NextRequest } from "next/server";
import { isValidSession, SESSION_COOKIE } from "../auth";

export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/** Route wrapper: re-checks the session (defence in depth behind the proxy) and turns throws into JSON errors. */
export function route<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    if (!(await isValidSession(req.cookies.get(SESSION_COOKIE)?.value))) {
      return json({ error: "Unauthorized" }, 401);
    }
    try {
      return await handler(req, ctx);
    } catch (e) {
      console.error(e);
      return json({ error: (e as Error).message ?? String(e) }, 500);
    }
  };
}

export async function body<T>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
