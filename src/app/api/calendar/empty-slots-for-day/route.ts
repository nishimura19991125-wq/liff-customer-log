import { NextResponse } from "next/server";

import { apiKeyForCalendarPocket, fetchAppFields } from "@/lib/atpocket";
import type { CalendarEmptySlotMatchPayload } from "@/lib/calendar-api-types";
import { fetchCalendarConstructionRecordsCached } from "@/lib/calendar-construction-records-cache";
import {
  buildCalendarEmptySlotCandidates,
  pickEmptySlotForDay,
} from "@/lib/calendar-empty-slot-match";
import {
  collectConstructionFieldsCsv,
  resolveConstructionFieldIds,
} from "@/lib/calendar-kojo";
import { optionalCalendarYmd } from "@/lib/calendar-optional-ymd";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

/**
 * 指定日・指定施工会社の空き枠を1件返す（タスクS-2）。
 *
 * レコードは変更しない。呼び出し側は返ってきた枠を使うかどうかを
 * 利用者に確認し、使う場合だけ既存の assign-case-to-slot を叩く。
 */
export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const calAppId = process.env.CALENDAR_APP_ID?.trim();
  if (!calAppId) {
    const payload: CalendarEmptySlotMatchPayload = {
      configured: false,
      disabled: true,
      slot: null,
      matchCount: 0,
      error: "CALENDAR_APP_ID が未設定です",
    };
    return NextResponse.json(payload, { status: 503 });
  }

  const url = new URL(request.url);
  const dayKey = optionalCalendarYmd(url.searchParams.get("dayKey") ?? "");
  const contractor = (url.searchParams.get("contractor") ?? "").trim();

  if (!dayKey) {
    return NextResponse.json(
      {
        configured: true,
        slot: null,
        matchCount: 0,
        error: "dayKey（YYYY-MM-DD）を指定してください",
      } satisfies CalendarEmptySlotMatchPayload,
      { status: 400 },
    );
  }

  // 施工会社が空なら照合しない。@pocket を読むまでもなく対象外
  // （空き枠の削除は不可逆なので、画面の必須チェックだけに頼らない）
  if (!contractor) {
    return NextResponse.json({
      configured: true,
      slot: null,
      matchCount: 0,
    } satisfies CalendarEmptySlotMatchPayload);
  }

  try {
    const calAuth = { apiKey: apiKeyForCalendarPocket() };
    const constructionFields = await fetchAppFields(calAppId, calAuth, {
      operation: "calendar:空き枠照合fields",
      appEnv: "CALENDAR_APP_ID",
    });

    const fids = resolveConstructionFieldIds(constructionFields);
    if (!fids.title?.trim()) {
      return NextResponse.json({
        configured: false,
        slot: null,
        matchCount: 0,
        error: "お客様名フィールドを特定できません",
      } satisfies CalendarEmptySlotMatchPayload);
    }

    // 未定案件一覧と同じ CSV・同じ query（全件）で読むと、
    // 直前に開いた割り当て画面のキャッシュをそのまま使える
    const csv = collectConstructionFieldsCsv(fids);
    const records = await fetchCalendarConstructionRecordsCached(
      calAppId,
      csv,
      null,
    );

    const candidates = buildCalendarEmptySlotCandidates(
      records,
      constructionFields,
    );
    const { slot, matchCount } = pickEmptySlotForDay(candidates, {
      dayKey,
      contractor,
    });

    if (slot) {
      // どの枠を選んだかを後から追えるようにする（S-2）。
      // 実際に削除したかどうかは assign-case-to-slot の監査ログ（delete）で分かる
      console.info(
        matchCount > 1
          ? "[api/calendar/empty-slots-for-day] 同条件の空き枠が複数。レコードID昇順の先頭を採用"
          : "[api/calendar/empty-slots-for-day] 空き枠を1件検出",
        JSON.stringify({ dayKey, slotRecordId: slot.recordId, matchCount }),
      );
    }

    return NextResponse.json({
      configured: true,
      slot,
      matchCount,
    } satisfies CalendarEmptySlotMatchPayload);
  } catch (e) {
    console.error("[api/calendar/empty-slots-for-day]", e);
    const msg = e instanceof Error ? e.message : "";
    const isRateLimited =
      msg.includes("429") || msg.includes("Too Many Request");
    return NextResponse.json(
      {
        configured: true,
        slot: null,
        matchCount: 0,
        error: isRateLimited
          ? "データ取得の利用上限に達しました。1〜2分待ってから再度お試しください。"
          : "空き枠の確認に失敗しました。",
      } satisfies CalendarEmptySlotMatchPayload,
      { status: isRateLimited ? 429 : 502 },
    );
  }
}
