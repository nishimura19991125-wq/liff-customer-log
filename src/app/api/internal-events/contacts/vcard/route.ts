import { NextResponse } from "next/server";

import {
  parseAtPocketFileField,
  type AtPocketFileEntry,
} from "@/lib/at-pocket-file-field";
import {
  apiKeyForStaffPocketReadApClList,
  atPocketAbsoluteUrl,
  fetchRecordById,
} from "@/lib/atpocket";
import { pickRecordValueByFieldAliases } from "@/lib/calendar-kojo";
import {
  formatPhoneNumberInput,
  parsePhoneDigits,
} from "@/lib/customer-info-form/phone-number";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { atPocketRecordIdFromRow } from "@/lib/atpocket-record-id";
import {
  buildStaffVcard,
  parsePocketContactField,
  vcardFileName,
} from "@/lib/pocket-contact-field";
import {
  resolveStaffContactsDirectoryConfig,
  STAFF_CONTACTS_EXCLUDED_NAMES,
} from "@/lib/staff-contacts-directory";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import {
  pickStaffPocketFieldValue,
  staffPocketRecordPayload,
} from "@/lib/staff-pocket-record";
import { staffPhoneFieldIdConfigured } from "@/lib/staff-phone-field-config";

export const dynamic = "force-dynamic";

async function fetchExternalFile(
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
      "text/vcard";
    return { body: buf, mimeType };
  } catch {
    return null;
  }
}

function isVcardFile(file: AtPocketFileEntry): boolean {
  const name = file.name.trim().toLowerCase();
  const mime = file.mimeType.trim().toLowerCase();
  return name.endsWith(".vcf") || mime.includes("vcard");
}

async function serveVcardFile(
  file: AtPocketFileEntry,
  apiKey: string,
  downloadName: string,
): Promise<NextResponse> {
  if (file.contentBase64?.trim()) {
    const body = Buffer.from(file.contentBase64, "base64");
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": "text/vcard; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  if (file.externalUrl?.trim()) {
    const absolute = atPocketAbsoluteUrl(file.externalUrl);
    const proxied = await fetchExternalFile(absolute, apiKey);
    if (proxied) {
      return new NextResponse(new Uint8Array(proxied.body), {
        headers: {
          "Content-Type": proxied.mimeType || "text/vcard; charset=utf-8",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
          "Cache-Control": "private, max-age=300",
        },
      });
    }
  }

  return NextResponse.json(
    { error: "連絡先ファイルを取得できませんでした" },
    { status: 404 },
  );
}

function isExcludedStaffName(name: string): boolean {
  const normalized = normApClStaffName(name);
  if (!normalized) return true;
  return STAFF_CONTACTS_EXCLUDED_NAMES.some(
    (excluded) => normApClStaffName(excluded) === normalized,
  );
}

function staffContactFieldIds(phoneFieldId: string): string[] {
  return [
    ...new Set(
      [phoneFieldId, staffPhoneFieldIdConfigured(), "field-4", "field_4"]
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
}

export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const url = new URL(request.url);
  const recordId = url.searchParams.get("recordId")?.trim() ?? "";
  if (!recordId) {
    return NextResponse.json(
      { error: "クエリ recordId を指定してください" },
      { status: 400 },
    );
  }

  const cfg = await resolveStaffContactsDirectoryConfig();
  if (!cfg) {
    return NextResponse.json(
      { error: "スタッフ名簿の連絡先設定が不足しています" },
      { status: 503 },
    );
  }

  const staffAuth = { apiKey: apiKeyForStaffPocketReadApClList() };

  try {
    let row = await fetchRecordById(cfg.staffAppId, recordId, staffAuth);
    if (!row) {
      return NextResponse.json(
        { error: "スタッフが見つかりませんでした" },
        { status: 404 },
      );
    }

    const recObj = staffPocketRecordPayload(row);
    const staffName = String(
      pickRecordValueByFieldAliases(recObj, cfg.nameFieldId) ?? "",
    ).trim();
    if (!staffName || isExcludedStaffName(staffName)) {
      return NextResponse.json(
        { error: "スタッフが見つかりませんでした" },
        { status: 404 },
      );
    }

    let contactRaw = pickStaffPocketFieldValue(
      row,
      staffContactFieldIds(cfg.phoneFieldId),
    );
    const parsed = parsePocketContactField(contactRaw);
    const files = parseAtPocketFileField(contactRaw);
    const vcardFile =
      files.find(isVcardFile) ?? (files.length === 1 ? files[0] : undefined);

    const downloadName = vcardFileName(staffName);

    if (vcardFile && (vcardFile.contentBase64 || vcardFile.externalUrl)) {
      return await serveVcardFile(vcardFile, staffAuth.apiKey, downloadName);
    }

    let phone = parsed.phone;
    if (!phone) {
      row = await fetchRecordById(
        cfg.staffAppId,
        recordId,
        staffAuth,
        staffContactFieldIds(cfg.phoneFieldId).join(","),
      );
      if (row) {
        contactRaw = pickStaffPocketFieldValue(
          row,
          staffContactFieldIds(cfg.phoneFieldId),
        );
        phone = parsePocketContactField(contactRaw).phone;
      }
    }

    const digits = parsePhoneDigits(phone);
    if (!digits) {
      return NextResponse.json(
        { error: "連絡先が登録されていません" },
        { status: 404 },
      );
    }

    const formatted = formatPhoneNumberInput(digits) || phone.trim();
    const body = buildStaffVcard(staffName, formatted);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/vcard; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (e) {
    console.error("[api/internal-events/contacts/vcard]", e);
    return NextResponse.json(
      { error: "連絡先の取得に失敗しました" },
      { status: 502 },
    );
  }
}
