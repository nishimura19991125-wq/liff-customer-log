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
import { listCustomerCrmRecords } from "@/lib/customer-crm-list";
import { customerInfoConfigReady } from "@/lib/customer-info-config";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

/** 工事日未定の既存案件一覧（全件検索＋AP/CL担当候補） */
export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const calAppId = process.env.CALENDAR_APP_ID?.trim();
  if (!calAppId) {
    const payload: UndatedConstructionCasesPayload = {
      configured: false,
      disabled: true,
      items: [],
      myItems: [],
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
    const [constructionFields, cancelledTNumbers, myApClTNumbers] =
      await Promise.all([
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
        (async () => {
          if (!staffName) return new Set<string>();
          const customerCfg = customerInfoConfigReady();
          if (!customerCfg.ok) return new Set<string>();
          try {
            const crmCustomers = await listCustomerCrmRecords(
              staffName,
              "no_construction_date",
              { maxResults: null },
            );
            return new Set(
              crmCustomers
                .filter((c) => !c.isCancelled)
                .map((c) => normApClStaffName(c.tNumber ?? ""))
                .filter(Boolean),
            );
          } catch (e) {
            console.warn(
              "[api/calendar/undated-construction-cases] my AP/CL T lookup failed",
              e,
            );
            return new Set<string>();
          }
        })(),
      ]);

    const fids = resolveConstructionFieldIds(constructionFields);
    if (!fids.title?.trim()) {
      const payload: UndatedConstructionCasesPayload = {
        configured: false,
        staffName,
        items: [],
        myItems: [],
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

    const baseItems = buildUndatedConstructionCases(
      constructionRecords,
      constructionFields,
      {
        excludedTNumbers:
          cancelledTNumbers.size > 0 ? cancelledTNumbers : undefined,
      },
    );

    const items = baseItems.map((item) => {
      const normT = normApClStaffName(item.tNumber);
      const isMyApCl = Boolean(normT && myApClTNumbers.has(normT));
      return isMyApCl ? { ...item, isMyApCl: true } : item;
    });
    const myItems = items.filter((item) => item.isMyApCl);

    const payload: UndatedConstructionCasesPayload = {
      configured: true,
      staffName,
      items,
      myItems,
      ...(staffName ? {} : { needsStaffBind: true }),
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
        myItems: [],
        error: isRateLimited
          ? "データ取得の利用上限に達しました。1〜2分待ってから再度お試しください。"
          : msg,
      } satisfies UndatedConstructionCasesPayload,
      { status: isRateLimited ? 429 : 502 },
    );
  }
}
