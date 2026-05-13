import { NextResponse } from "next/server";

import { fetchAllRecordsPages } from "@/lib/atpocket";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

function uniqueFieldsCsv(...uids: (string | undefined)[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const u of uids) {
    const t = u?.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      parts.push(t);
    }
  }
  return parts.join(",");
}

/** 一覧 API の選択肢・文字列を「稼働」判定用に正規化して比較 */
function availabilityIsActive(raw: unknown, activeLabel: string): boolean {
  if (raw === undefined || raw === null) return false;
  if (Array.isArray(raw)) {
    return raw.some((x) => availabilityIsActive(x, activeLabel));
  }
  const target = nfkc(activeLabel);
  if (typeof raw === "string") return nfkc(raw) === target;
  if (typeof raw === "number" || typeof raw === "boolean") {
    return nfkc(String(raw)) === target;
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const cand =
      o.label ?? o.name ?? o.text ?? o.value ?? o.caption ?? o.title;
    if (cand !== undefined && cand !== null) {
      return nfkc(String(cand)) === target;
    }
  }
  return nfkc(String(raw)) === target;
}

/**
 * 工事空枠の「工事対応者」プルダウン用。
 * スタッフ名簿アプリで「工事対応稼働状況」が稼働のレコードの社員名のみ返す。
 */
export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const nameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim();
  const availabilityFieldId =
    process.env.STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID?.trim();
  const activeLabel =
    process.env.STAFF_CONSTRUCTION_AVAILABILITY_ACTIVE_LABEL?.trim() || "稼働";

  if (!staffAppId || !nameFieldId || !availabilityFieldId) {
    return NextResponse.json(
      {
        error:
          "工事対応者リスト用の環境変数が不足しています。STAFF_APP_ID・STAFF_NAME_FIELD_ID・STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID を設定してください。",
        handlers: [],
      },
      { status: 503 },
    );
  }

  const fieldsCsv = uniqueFieldsCsv(nameFieldId, availabilityFieldId);
  if (!fieldsCsv) {
    return NextResponse.json(
      { error: "フィールド ID が不正です", handlers: [] },
      { status: 500 },
    );
  }

  try {
    const rows = await fetchAllRecordsPages(staffAppId, fieldsCsv);
    const names: string[] = [];
    for (const row of rows) {
      const rec = row.record;
      if (!rec || typeof rec !== "object") continue;
      const rawStatus = rec[availabilityFieldId];
      if (!availabilityIsActive(rawStatus, activeLabel)) continue;
      const rawName = rec[nameFieldId];
      if (rawName === undefined || rawName === null) continue;
      const name = String(rawName).trim();
      if (name) names.push(name);
    }
    const uniqueSorted = [...new Set(names)].sort((a, b) =>
      a.localeCompare(b, "ja"),
    );
    return NextResponse.json({ handlers: uniqueSorted });
  } catch (e) {
    console.error("[api/calendar/construction-handlers]", e);
    return NextResponse.json(
      {
        error: "工事対応者リストの取得に失敗しました",
        handlers: [],
      },
      { status: 502 },
    );
  }
}
