import { NextResponse } from "next/server";

import {
  apiKeyForStaffPocketRead,
  isPocketApiRateLimited,
  pocketApiRateLimitRemainingMs,
} from "@/lib/atpocket";
import { resolveStaffApClRoleByName } from "@/lib/staff-ap-cl-candidates";
import { lookupStaffDepartmentByStaffName } from "@/lib/staff-department-lookup";
import {
  boundStaffFromRosterRows,
  fetchStaffRosterRowsCached,
  getStaffRosterRowsBestEffort,
} from "@/lib/staff-roster-cache";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import {
  staffLineBindingConfigError,
  staffLineBindingEnabled,
  staffLineUserIdFieldIdsFromEnv,
} from "@/lib/staff-line-field-config";
import {
  readStaffImportKeyFromRawRecord,
  staffImportKeyFieldIdResolved,
} from "@/lib/staff-import-key";
import {
  resolveStaffGeneralAvailabilityConfig,
  staffRowGeneralAvailabilityIsActive,
} from "@/lib/staff-general-availability";
export const dynamic = "force-dynamic";

function isPocketRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("429") || msg.includes("Too Many Request");
}

export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);
  const caller = auth;
  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const staffNameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim();

  if (!staffAppId || !staffNameFieldId) {
    return NextResponse.json(
      {
        error:
          "STAFF_APP_ID または STAFF_NAME_FIELD_ID（担当者名のフィールド識別名）が未設定です",
      },
      { status: 500 },
    );
  }

  try {
    const lineIds = staffLineUserIdFieldIdsFromEnv();
    const lineBindingOn = staffLineBindingEnabled(lineIds);
    const lineConfigError = staffLineBindingConfigError();

    let rows: Awaited<ReturnType<typeof fetchStaffRosterRowsCached>>;
    let rosterStale = false;
    let rateLimited = false;
    const staffAuth = { apiKey: apiKeyForStaffPocketRead() };
    try {
      rows = await fetchStaffRosterRowsCached();
      if (!rows.length && isPocketApiRateLimited(staffAuth)) {
        rateLimited = true;
        rosterStale = true;
      }
    } catch (e) {
      const fallback = getStaffRosterRowsBestEffort();
      if (fallback.length > 0) {
        console.warn("[api/staff] using stale roster after fetch error", e);
        rows = fallback;
        rosterStale = true;
      } else if (isPocketRateLimitError(e)) {
        console.warn("[api/staff] rate limited with no cached roster", e);
        rows = [];
        rateLimited = true;
        rosterStale = true;
      } else {
        throw e;
      }
    }
    const includeImportKey = Boolean(staffImportKeyFieldIdResolved());

    let availabilityCfg: Awaited<
      ReturnType<typeof resolveStaffGeneralAvailabilityConfig>
    > | null = null;
    let availabilityConfigError: string | undefined;
    let availabilityRateLimited = false;
    if (lineBindingOn) {
      availabilityCfg = await resolveStaffGeneralAvailabilityConfig();
      if (!availabilityCfg.ok) {
        if (availabilityCfg.rateLimited) {
          availabilityRateLimited = true;
          rateLimited = true;
        } else {
          availabilityConfigError = availabilityCfg.error;
        }
      }
    }

    const staff = rows
      .map((row) => {
        const id =
          row.recordId != null ? String(row.recordId) : row.uniqueId ?? "";
        const rec = row.record;
        const raw = rec?.[staffNameFieldId];
        const name =
          raw === undefined || raw === null ? "" : String(raw).trim();
        const importKey =
          includeImportKey &&
          rec &&
          typeof rec === "object"
            ? readStaffImportKeyFromRawRecord(rec as Record<string, unknown>)
            : undefined;
        return {
          id,
          name,
          rec,
          ...(includeImportKey ? { importKey } : {}),
        };
      })
      .filter((s) => {
        if (!s.id || !s.name) return false;
        if (!lineBindingOn) return true;
        // 設定ミス時は紐付け候補を出さない。429 時はフィルターを外して候補を残す
        if (!availabilityCfg?.ok) return availabilityRateLimited;
        if (!s.rec || typeof s.rec !== "object") return false;
        return staffRowGeneralAvailabilityIsActive(
          s.rec as Record<string, unknown>,
          availabilityCfg.cfg,
        );
      })
      .map(({ id, name, importKey }) => ({
        id,
        name,
        ...(importKey !== undefined ? { importKey } : {}),
      }));

    const boundStaffBase = lineBindingOn
      ? boundStaffFromRosterRows(rows, caller.lineUserId)
      : null;

    const boundStaff = boundStaffBase
      ? await (async () => {
          const [department, staffRole] = await Promise.all([
            lookupStaffDepartmentByStaffName(boundStaffBase.name),
            resolveStaffApClRoleByName(boundStaffBase.name),
          ]);
          return {
            ...boundStaffBase,
            ...(department ? { department } : {}),
            ...(staffRole ? { staffRole } : {}),
          };
        })()
      : null;

    const res = NextResponse.json({
      staff,
      boundStaff,
      lineUserId: caller.lineUserId,
      bindingEnabled: lineBindingOn,
      ...(rosterStale ? { rosterStale: true } : {}),
      ...(rateLimited
        ? {
            rateLimited: true,
            rosterMessage: availabilityRateLimited
              ? "いまアクセスが混み合っています。100秒ほど待ってから画面を更新してください。"
              : "担当者一覧の取得が混み合っています。しばらくしてから再度お試しください。",
          }
        : {}),
      ...(lineConfigError && !lineBindingOn
        ? { bindingConfigError: lineConfigError }
        : {}),
      ...(availabilityConfigError
        ? { bindingConfigError: availabilityConfigError }
        : {}),
      ...(lineBindingOn &&
      availabilityCfg?.ok &&
      staff.length === 0 &&
      rows.length > 0
        ? {
            rosterMessage: `稼働状況が「${availabilityCfg.cfg.activeLabel}」の社員が名簿にいません。`,
          }
        : {}),
    });
    if (rosterStale || rateLimited) {
      const retrySec = Math.max(
        60,
        Math.ceil(pocketApiRateLimitRemainingMs(staffAuth) / 1000) || 120,
      );
      res.headers.set("Retry-After", String(retrySec));
    }
    return res;
  } catch (e) {
    console.error("[api/staff]", e);
    const msg = e instanceof Error ? e.message : String(e);
    const isRateLimited =
      msg.includes("429") || msg.includes("Too Many Request");
    return NextResponse.json(
      {
        error: isRateLimited
          ? "担当者一覧の取得が混み合っています。しばらくしてから再度お試しください。"
          : "担当者一覧の取得に失敗しました",
      },
      {
        status: isRateLimited ? 429 : 502,
        ...(isRateLimited ? { headers: { "Retry-After": "120" } } : {}),
      },
    );
  }
}
