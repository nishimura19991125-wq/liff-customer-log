import { NextResponse } from "next/server";

import {
  buildBulletinList,
  createBulletinPost,
} from "@/lib/bulletin-server";
import { isBulletinCategory } from "@/lib/bulletin-types";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

/** お知らせ一覧 */
export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  try {
    const payload = await buildBulletinList();
    return NextResponse.json(payload);
  } catch (e) {
    console.error("[api/bulletin] GET", e);
    const msg = e instanceof Error ? e.message : "お知らせの取得に失敗しました";
    return NextResponse.json(
      { configured: true, error: msg },
      { status: 502 },
    );
  }
}

/** お知らせ投稿 */
export async function POST(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON が不正です" }, { status: 400 });
  }

  const obj = (body ?? {}) as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const bodyText = typeof obj.body === "string" ? obj.body.trim() : "";
  const category = typeof obj.category === "string" ? obj.category.trim() : "";

  if (!title) {
    return NextResponse.json(
      { error: "タイトルを入力してください" },
      { status: 400 },
    );
  }
  if (!bodyText) {
    return NextResponse.json(
      { error: "詳細（本文）を入力してください" },
      { status: 400 },
    );
  }
  if (category && !isBulletinCategory(category)) {
    return NextResponse.json({ error: "カテゴリが不正です" }, { status: 400 });
  }

  try {
    const result = await createBulletinPost({ category, title, body: bodyText });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const list = await buildBulletinList();
    return NextResponse.json({ ok: true, ...list });
  } catch (e) {
    console.error("[api/bulletin] POST", e);
    const msg = e instanceof Error ? e.message : "投稿に失敗しました";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
