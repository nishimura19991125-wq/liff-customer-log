import { NextResponse } from "next/server";

import { buildAtPocketAppRecordsPortalUrl } from "@/lib/atpocket";
import {
  COMMUNICATION_BRIDGE_CALENDAR_APP_NAME,
  communicationBridgeCalendarAppIdFromEnv,
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

  const appId = communicationBridgeCalendarAppIdFromEnv();
  if (!appId) {
    return NextResponse.json({
      configured: false,
      disabled: true,
      appName: COMMUNICATION_BRIDGE_CALENDAR_APP_NAME,
      error: "COMMUNICATION_BRIDGE_CALENDAR_APP_ID が未設定です",
    });
  }

  const portalUrl = buildAtPocketAppRecordsPortalUrl(appId);
  if (!portalUrl) {
    return NextResponse.json({
      configured: false,
      disabled: true,
      appName: COMMUNICATION_BRIDGE_CALENDAR_APP_NAME,
      error: "ATPOCKET_DOMAIN が未設定です",
    });
  }

  const apiAccess = await verifyCommunicationBridgeCalendarApiAccess();
  if (!apiAccess.ok) {
    return NextResponse.json({
      configured: false,
      disabled: true,
      appName: COMMUNICATION_BRIDGE_CALENDAR_APP_NAME,
      portalUrl,
      error: apiAccess.error,
    });
  }

  return NextResponse.json({
    configured: true,
    disabled: false,
    appName: COMMUNICATION_BRIDGE_CALENDAR_APP_NAME,
    portalUrl,
  });
}
