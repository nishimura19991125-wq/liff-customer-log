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
import { listCustomerCrmRecords } from "@/lib/customer-crm-list";
import { customerInfoConfigReady } from "@/lib/customer-info-config";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

/** 工事日未定の既存案件一覧（担当顧客一覧と同じ担当・工事日未定条件） */
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

  const customerCfg = customerInfoConfigReady();
  if (!customerCfg.ok) {
    const payload: UndatedConstructionCasesPayload = {
      configured: false,
      items: [],
      error: customerCfg.error,
    };
    return NextResponse.json(payload, { status: 503 });
  }

  try {
    const boundStaffName = await resolveBoundStaffNameForLineUser(
      auth.lineUserId,
    );
    const staffName = normApClStaffName(boundStaffName ?? "");

    if (!staffName) {
      const payload: UndatedConstructionCasesPayload = {
        configured: true,
        staffName: "",
        items: [],
        needsStaffBind: true,
      };
      return NextResponse.json(payload);
    }

    const crmCustomers = await listCustomerCrmRecords(
      staffName,
      "no_construction_date",
      { maxResults: null },
    );
    const allowedTNumbers = new Set(
      crmCustomers
        .map((c) => normApClStaffName(c.tNumber ?? ""))
        .filter(Boolean),
    );

    const calAuth = { apiKey: apiKeyForCalendarPocket() };
    const constructionFields = await fetchAppFields(calAppId, calAuth, {
      operation: "calendar:工事日未定案件fields",
      appEnv: "CALENDAR_APP_ID",
    });

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
      { allowedTNumbers },
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
