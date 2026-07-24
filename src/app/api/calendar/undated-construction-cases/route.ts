import { NextResponse } from "next/server";

import {
  apiKeyForCalendarPocket,
  fetchAppFields,
} from "@/lib/atpocket";
import type { UndatedConstructionCasesPayload } from "@/lib/calendar-api-types";
import { fetchCalendarConstructionRecordsCached } from "@/lib/calendar-construction-records-cache";
import {
  collectConstructionFieldsCsv,
  resolveConstructionFieldIds,
} from "@/lib/calendar-kojo";
import { buildUndatedConstructionCases } from "@/lib/calendar-undated-cases";
import { fetchCancelledCustomerTNumbersCached } from "@/lib/customer-cancelled-t-numbers";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

/** 工事日未定の既存案件一覧（全件・キャンセル除外・お客様名で検索） */
export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const calAppId = process.env.CALENDAR_APP_ID?.trim();
  if (!calAppId) {
    const payload: UndatedConstructionCasesPayload = {
      configured: false,
      disabled: true,
      items: [],
      error: "CALENDAR_APP_ID が未設定です",
    };
    return NextResponse.json(payload, { status: 503 });
  }

  try {
    const boundStaffName = await resolveBoundStaffNameForLineUser(
      auth.lineUserId,
    );
    const staffName = normApClStaffName(boundStaffName ?? "");

    const calAuth = { apiKey: apiKeyForCalendarPocket() };
    const [constructionFields, cancelledTNumbers] = await Promise.all([
      fetchAppFields(calAppId, calAuth, {
        operation: "calendar:工事日未定案件fields",
        appEnv: "CALENDAR_APP_ID",
      }),
      fetchCancelledCustomerTNumbersCached().catch((e) => {
        console.warn(
          "[api/calendar/undated-construction-cases] cancelled T lookup failed",
          e,
        );
        return new Set<string>();
      }),
    ]);

    const fids = resolveConstructionFieldIds(constructionFields);
    if (!fids.title?.trim()) {
      const payload: UndatedConstructionCasesPayload = {
        configured: false,
        staffName,
        items: [],
        error: "お客様名フィールドを特定できません",
      };
      return NextResponse.json(payload);
    }

    const csv = collectConstructionFieldsCsv(fids);
    const constructionRecords = await fetchCalendarConstructionRecordsCached(
      calAppId,
      csv,
      null,
    );

    const items = buildUndatedConstructionCases(
      constructionRecords,
      constructionFields,
      {
        excludedTNumbers:
          cancelledTNumbers.size > 0 ? cancelledTNumbers : undefined,
      },
    );

    const payload: UndatedConstructionCasesPayload = {
      configured: true,
      staffName,
      items,
    };
    return NextResponse.json(payload);
  } catch (e) {
    console.error("[api/calendar/undated-construction-cases]", e);
    const msg =
      e instanceof Error
        ? e.message
        : "工事日未定案件の取得に失敗しました";
    const isRateLimited =
      msg.includes("429") || msg.includes("Too Many Request");
    return NextResponse.json(
      {
        configured: true,
        items: [],
        error: isRateLimited
          ? "データ取得の利用上限に達しました。1〜2分待ってから再度お試しください。"
          : msg,
      } satisfies UndatedConstructionCasesPayload,
      { status: isRateLimited ? 429 : 502 },
    );
  }
}
