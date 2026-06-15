import { NextResponse } from "next/server";

import {
  isDisplayableImageFile,
  parseAtPocketFileField,
} from "@/lib/at-pocket-file-field";
import {
  apiKeyForCommunicationBridgeCalendarPocket,
  fetchAppFields,
  fetchRecordById,
} from "@/lib/atpocket";
import { resolveCommunicationBridgeAttachmentFieldId } from "@/lib/communication-bridge-calendar-fields";
import { resolveCommunicationBridgeCalendarAppId } from "@/lib/communication-bridge-calendar";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

async function fetchExternalAttachment(
  url: string,
  apiKey: string,
): Promise<{ body: Buffer; mimeType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "X-At-Pocket-API-Key": apiKey,
        Accept: "*/*",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const mimeType =
      res.headers.get("content-type")?.split(";")[0]?.trim() ||
      "application/octet-stream";
    return { body: buf, mimeType };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const resolved = await resolveCommunicationBridgeCalendarAppId();
  if (!resolved.appId) {
    return NextResponse.json(
      {
        error:
          resolved.error ?? "COMMUNICATION_BRIDGE_CALENDAR_APP_ID が未設定です",
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const recordId = url.searchParams.get("recordId")?.trim() ?? "";
  const index = Number(url.searchParams.get("index") ?? "0");
  if (!recordId || !Number.isFinite(index) || index < 0) {
    return NextResponse.json(
      { error: "クエリ recordId と index（0始まり）を指定してください" },
      { status: 400 },
    );
  }

  const calAppId = resolved.appId;
  const calAuth = { apiKey: apiKeyForCommunicationBridgeCalendarPocket() };

  try {
    const fields = await fetchAppFields(calAppId, calAuth, {
      operation: "communication-bridge-calendar:attachment-fields",
      appEnv: "COMMUNICATION_BRIDGE_CALENDAR_APP_ID",
    });
    const attachmentFieldId =
      resolveCommunicationBridgeAttachmentFieldId(fields);
    if (!attachmentFieldId) {
      return NextResponse.json(
        { error: "添付画像フィールドを特定できませんでした" },
        { status: 503 },
      );
    }

    const row = await fetchRecordById(
      calAppId,
      recordId,
      calAuth,
      attachmentFieldId,
    );
    const recObj =
      row?.record && typeof row.record === "object"
        ? (row.record as Record<string, unknown>)
        : null;
    if (!recObj) {
      return NextResponse.json(
        { error: "レコードが見つかりませんでした" },
        { status: 404 },
      );
    }

    const files = parseAtPocketFileField(recObj[attachmentFieldId]);
    const file = files[index];
    if (!file || !isDisplayableImageFile(file)) {
      return NextResponse.json(
        { error: "添付画像が見つかりませんでした" },
        { status: 404 },
      );
    }

    if (file.contentBase64) {
      const body = Buffer.from(file.contentBase64, "base64");
      return new NextResponse(new Uint8Array(body), {
        headers: {
          "Content-Type": file.mimeType || "image/jpeg",
          "Cache-Control": "private, max-age=300",
        },
      });
    }

    if (file.externalUrl) {
      const proxied = await fetchExternalAttachment(
        file.externalUrl,
        calAuth.apiKey,
      );
      if (proxied) {
        return new NextResponse(new Uint8Array(proxied.body), {
          headers: {
            "Content-Type": proxied.mimeType,
            "Cache-Control": "private, max-age=300",
          },
        });
      }
      return NextResponse.redirect(file.externalUrl);
    }

    return NextResponse.json(
      { error: "画像データを取得できませんでした" },
      { status: 404 },
    );
  } catch (e) {
    console.error("[api/communication-bridge/attachment]", e);
    return NextResponse.json(
      { error: "添付画像の取得に失敗しました" },
      { status: 502 },
    );
  }
}
