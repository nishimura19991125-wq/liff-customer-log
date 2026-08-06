import { NextResponse } from "next/server";

import { pocketErrorResponse } from "@/lib/api-error-response";

import { customerInfoConfigReady } from "@/lib/customer-info-config";
import {
  listCustomerCrmRecords,
  type CustomerCrmFilter,
} from "@/lib/customer-crm-list";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

const FILTERS = new Set<CustomerCrmFilter>([
  "all",
  "missing_docs",
  "no_construction_date",
  "subsidy",
  "cancelled",
]);

function parseFilter(raw: string | null): CustomerCrmFilter {
  const v = raw?.trim() as CustomerCrmFilter | undefined;
  if (v && FILTERS.has(v)) return v;
  return "all";
}

/** ログイン担当者の担当顧客一覧（CRM） */
export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const cfg = customerInfoConfigReady();
  if (!cfg.ok) {
    return NextResponse.json(
      { customers: [], disabled: true, error: cfg.error },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const filter = parseFilter(url.searchParams.get("filter"));

  try {
    const boundStaffName = await resolveBoundStaffNameForLineUser(
      auth.lineUserId,
    );
    if (!boundStaffName) {
      return NextResponse.json({ customers: [], needsStaffBind: true });
    }

    const customers = await listCustomerCrmRecords(boundStaffName, filter);
    return NextResponse.json({ customers, filter });
  } catch (e) {
    return pocketErrorResponse(e, {
      scope: "api/customers",
      message: "担当顧客一覧の取得に失敗しました",
      extra: { customers: [] },
    });
  }
}
