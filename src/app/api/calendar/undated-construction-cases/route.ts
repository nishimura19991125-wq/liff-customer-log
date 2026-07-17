import { NextResponse } from "next/server";

import {
  apiKeyForCalendarPocket,
  fetchAppFields,
} from "@/lib/atpocket";
import type { UndatedConstructionCasesPayload } from "@/lib/calendar-api-types";
import { fetchCalendarConstructionRecordsCached } from "@/lib/calendar-construction-records-cache";
import {
  collectConstructionFieldsCsv,
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionFieldIds,
} from "@/lib/calendar-kojo";
import {
  buildUndatedConstructionCases,
  filterUndatedCasesByCallerApClStaff,
} from "@/lib/calendar-undated-cases";
import {
  customerInfoAppId,
  customerInfoImportKeyFieldId,
  customerInfoPocketAuth,
} from "@/lib/customer-info-config";
import { resolveCustomerInfoFormFieldId } from "@/lib/customer-info-form/resolve-fields";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { defaultApClStaffNamesForLineUser } from "@/lib/staff-ap-cl-candidates";

export const dynamic = "force-dynamic";

/** 工事日未定の既存案件一覧（ログイン中のAP/CL担当案件のみ） */
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

  const customerAppId = customerInfoAppId();
  if (!customerAppId) {
    const payload: UndatedConstructionCasesPayload = {
      configured: false,
      items: [],
      error: "CUSTOMER_INFO_APP_ID が未設定です",
    };
    return NextResponse.json(payload, { status: 503 });
  }

  const customerKeyEnv = customerInfoImportKeyFieldId();
  if (!customerKeyEnv) {
    const payload: UndatedConstructionCasesPayload = {
      configured: false,
      items: [],
      error:
        "CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID（T番号）が未設定です",
    };
    return NextResponse.json(payload, { status: 503 });
  }

  try {
    const { apStaff, clStaff } = await defaultApClStaffNamesForLineUser(
      auth.lineUserId,
    );
    const staffName =
      normApClStaffName(apStaff ?? "") ||
      normApClStaffName(clStaff ?? "") ||
      "";

    if (!apStaff && !clStaff) {
      const payload: UndatedConstructionCasesPayload = {
        configured: true,
        staffName: "",
        items: [],
        needsStaffBind: true,
      };
      return NextResponse.json(payload);
    }

    const calAuth = { apiKey: apiKeyForCalendarPocket() };
    const customerAuth = customerInfoPocketAuth();

    const [constructionFields, customerFields] = await Promise.all([
      fetchAppFields(calAppId, calAuth, {
        operation: "calendar:工事日未定案件fields",
        appEnv: "CALENDAR_APP_ID",
      }),
      fetchAppFields(customerAppId, customerAuth, {
        operation: "calendar:工事日未定案件(お客様情報fields)",
        appEnv: "CUSTOMER_INFO_APP_ID",
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

    const customerKeyFieldId = resolveConfiguredFieldToSchemaUniqueId(
      customerKeyEnv,
      customerFields,
    );
    if (!customerKeyFieldId) {
      const payload: UndatedConstructionCasesPayload = {
        configured: false,
        staffName,
        items: [],
        error: `お客様情報のT番号フィールド「${customerKeyEnv}」が定義と一致しません`,
      };
      return NextResponse.json(payload);
    }

    const apStaffFieldId = resolveCustomerInfoFormFieldId(
      "apStaff",
      "AP担当者",
      customerFields,
    );
    const clStaffFieldId = resolveCustomerInfoFormFieldId(
      "clStaff",
      "CL担当者",
      customerFields,
    );
    if (!apStaffFieldId && !clStaffFieldId) {
      const payload: UndatedConstructionCasesPayload = {
        configured: false,
        staffName,
        items: [],
        error:
          "お客様情報のAP担当者／CL担当者フィールドを特定できません",
      };
      return NextResponse.json(payload);
    }

    const csv = collectConstructionFieldsCsv(fids);
    const constructionRecords = await fetchCalendarConstructionRecordsCached(
      calAppId,
      csv,
      null,
    );

    const undatedAll = buildUndatedConstructionCases(
      constructionRecords,
      constructionFields,
    );

    const items = await filterUndatedCasesByCallerApClStaff(undatedAll, {
      customerAppId,
      customerKeyFieldId,
      apStaffFieldId,
      clStaffFieldId,
      callerApStaff: apStaff,
      callerClStaff: clStaff,
      customerAuth,
    });

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
    return NextResponse.json(
      {
        configured: true,
        items: [],
        error: msg,
      } satisfies UndatedConstructionCasesPayload,
      { status: 502 },
    );
  }
}
