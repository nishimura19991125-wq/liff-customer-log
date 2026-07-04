import { NextResponse } from "next/server";

import { createApoAcquisitionRecord } from "@/lib/apo-acquisition-server";
import type {
  ApoAcquisitionCreateInput,
  ApoAcquisitionValues,
} from "@/lib/apo-acquisition-types";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

type Body = {
  apStaffName?: string;
  values?: ApoAcquisitionValues;
};

/** アポ取得情報連携へ新規登録 */
export async function POST(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const boundStaffName = await resolveBoundStaffNameForLineUser(auth.lineUserId);
  if (!boundStaffName) {
    return NextResponse.json(
      { error: "担当者の紐付けが必要です", needsStaffBind: true },
      { status: 403 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload: ApoAcquisitionCreateInput = {
    apStaffName: body.apStaffName ?? boundStaffName,
    values: body.values ?? {},
  };

  const result = await createApoAcquisitionRecord(boundStaffName, payload);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, recordId: result.recordId });
}
