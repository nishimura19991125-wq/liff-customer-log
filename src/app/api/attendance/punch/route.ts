import { NextResponse } from "next/server";

import { punchAttendanceForLineUser } from "@/lib/attendance-server";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON が不正です" }, { status: 400 });
  }

  const kind =
    typeof body === "object" &&
    body !== null &&
    "kind" in body &&
    ((body as { kind?: unknown }).kind === "in" ||
      (body as { kind?: unknown }).kind === "out")
      ? (body as { kind: "in" | "out" }).kind
      : null;

  if (!kind) {
    return NextResponse.json(
      { error: "kind は in または out を指定してください" },
      { status: 400 },
    );
  }

  try {
    const result = await punchAttendanceForLineUser(auth.lineUserId, kind);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, ...result.status });
  } catch (e) {
    console.error("[api/attendance/punch]", e);
    const msg =
      e instanceof Error ? e.message : "打刻に失敗しました";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
