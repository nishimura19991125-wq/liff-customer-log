import { NextResponse } from "next/server";

import {
  buildBulletinList,
  createBulletinPost,
  updateBulletinPost,
} from "@/lib/bulletin-server";
import { isBulletinCategory, isBulletinTag } from "@/lib/bulletin-types";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

type BulletinInput = {
  category: string;
  tags: string[];
  title: string;
  body: string;
};

/** POST/PUT の本文を検証して投稿データに整形 */
function parseBulletinInput(
  obj: Record<string, unknown>,
): { ok: true; data: BulletinInput } | { ok: false; error: string } {
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const bodyText = typeof obj.body === "string" ? obj.body.trim() : "";
  const category = typeof obj.category === "string" ? obj.category.trim() : "";
  const tags = Array.isArray(obj.tags)
    ? Array.from(
        new Set(
          obj.tags
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      )
    : [];

  if (!title) return { ok: false, error: "タイトルを入力してください" };
  if (!bodyText) return { ok: false, error: "詳細（本文）を入力してください" };
  if (!category) return { ok: false, error: "カテゴリーを選択してください" };
  if (!isBulletinCategory(category)) {
    return { ok: false, error: "カテゴリーが不正です" };
  }
  if (tags.some((t) => !isBulletinTag(t))) {
    return { ok: false, error: "タグが不正です" };
  }

  return { ok: true, data: { category, tags, title, body: bodyText } };
}

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

  const parsed = parseBulletinInput((body ?? {}) as Record<string, unknown>);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await createBulletinPost(parsed.data);
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

/** お知らせ編集 */
export async function PUT(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON が不正です" }, { status: 400 });
  }

  const obj = (body ?? {}) as Record<string, unknown>;
  const recordId = typeof obj.recordId === "string" ? obj.recordId.trim() : "";
  if (!recordId) {
    return NextResponse.json(
      { error: "編集対象が特定できません" },
      { status: 400 },
    );
  }

  const parsed = parseBulletinInput(obj);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await updateBulletinPost(recordId, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const list = await buildBulletinList();
    return NextResponse.json({ ok: true, ...list });
  } catch (e) {
    console.error("[api/bulletin] PUT", e);
    const msg = e instanceof Error ? e.message : "更新に失敗しました";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
