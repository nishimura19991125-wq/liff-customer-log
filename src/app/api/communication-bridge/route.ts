import { NextResponse } from "next/server";

import { buildAtPocketAppRecordsPortalUrl } from "@/lib/atpocket";
import {
  COMMUNICATION_BRIDGE_CALENDAR_APP_NAME,
  verifyCommunicationBridgeCalendarApiAccess,
} from "@/lib/communication-bridge-calendar";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const apiAccess = await verifyCommunicationBridgeCalendarApiAccess();
  if (!apiAccess.ok || !apiAccess.appId) {
    return NextResponse.json({
      configured: false,
      disabled: true,
      appName: COMMUNICATION_BRIDGE_CALENDAR_APP_NAME,
      error: apiAccess.error ?? "設定を確認してください",
    });
  }

  const portalUrl = buildAtPocketAppRecordsPortalUrl(apiAccess.appId);
  if (!portalUrl) {
    return NextResponse.json({
      configured: false,
      disabled: true,
      appName: COMMUNICATION_BRIDGE_CALENDAR_APP_NAME,
      error: "ATPOCKET_DOMAIN が未設定です",
    });
  }

  return NextResponse.json({
    configured: true,
    disabled: false,
    appName: COMMUNICATION_BRIDGE_CALENDAR_APP_NAME,
    portalUrl,
  });
}
