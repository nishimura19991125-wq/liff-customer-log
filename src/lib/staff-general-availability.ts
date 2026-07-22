import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import {
  fetchAppFields,
  isPocketHttpRateLimitError,
  staffReadListAuths,
} from "@/lib/atpocket";
import {
  pickRecordValueByFieldAliases,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";
import { staffConstructionAvailabilityIsActive } from "@/lib/staff-construction-availability";

export type StaffGeneralAvailabilityConfig = {
  fieldId: string;
  activeLabel: string;
};

let resolvedCfg: StaffGeneralAvailabilityConfig | null | undefined;
/** 恒久的な設定ミスのみキャッシュ（429 はキャッシュしない） */
let permanentResolveError: string | null = null;

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

function pickFieldUniqueIdByExactCaption(
  fields: AtPocketFieldRow[],
  caption: string,
): string | null {
  const target = nfkc(caption).toLowerCase();
  for (const f of fields) {
    const cap = f.caption ? nfkc(String(f.caption)).toLowerCase() : "";
    if (cap && cap === target) {
      const id = f.uniqueId?.trim();
      return id || null;
    }
  }
  return null;
}

function pickFieldUniqueIdByCaptions(
  fields: AtPocketFieldRow[],
  captions: string[],
): string | null {
  for (const caption of captions) {
    const id = pickFieldUniqueIdByExactCaption(fields, caption);
    if (id) return id;
  }
  return null;
}

function resolveSchemaFieldId(
  configuredId: string | undefined,
  fields: AtPocketFieldRow[],
  captionAlts: string[],
): string | null {
  const fromEnv = configuredId?.trim();
  if (fromEnv) {
    return resolveConfiguredFieldToSchemaUniqueId(fromEnv, fields);
  }
  const picked = pickFieldUniqueIdByCaptions(fields, captionAlts);
  if (!picked) return null;
  return resolveConfiguredFieldToSchemaUniqueId(picked, fields) ?? picked;
}

export function staffGeneralAvailabilityActiveLabel(): string {
  return (
    process.env.STAFF_AVAILABILITY_ACTIVE_LABEL?.trim() ||
    process.env.STAFF_CONSTRUCTION_AVAILABILITY_ACTIVE_LABEL?.trim() ||
    "稼働"
  );
}

/** LINE 紐付け名簿リスト用：稼働状況列の uniqueId（メモリキャッシュ） */
export async function resolveStaffGeneralAvailabilityConfig(): Promise<
  | { ok: true; cfg: StaffGeneralAvailabilityConfig }
  | { ok: false; error: string; rateLimited?: boolean }
> {
  if (resolvedCfg) return { ok: true, cfg: resolvedCfg };
  if (permanentResolveError) {
    return { ok: false, error: permanentResolveError };
  }

  const staffAppId = process.env.STAFF_APP_ID?.trim();
  if (!staffAppId) {
    permanentResolveError = "STAFF_APP_ID が未設定です";
    return { ok: false, error: permanentResolveError };
  }

  // env に uniqueId があれば list fields 不要（429 回避）
  const envFieldId = process.env.STAFF_AVAILABILITY_FIELD_ID?.trim();
  if (envFieldId) {
    resolvedCfg = {
      fieldId: envFieldId,
      activeLabel: staffGeneralAvailabilityActiveLabel(),
    };
    return { ok: true, cfg: resolvedCfg };
  }

  try {
    const listAuths = staffReadListAuths();
    const appFields = await fetchAppFields(
      staffAppId,
      listAuths[0],
      { operation: "staff:稼働状況(列定義)", appEnv: "STAFF_APP_ID" },
      {
        maxRetries: 1,
        ...(listAuths.length >= 2 ? { authKeys: listAuths } : {}),
      },
    );

    const fieldId = resolveSchemaFieldId(
      process.env.STAFF_AVAILABILITY_FIELD_ID,
      appFields,
      ["稼働状況", "稼働 状況"],
    );
    if (!fieldId) {
      permanentResolveError =
        "スタッフ名簿に「稼働状況」列が見つかりません。見出し名を確認するか STAFF_AVAILABILITY_FIELD_ID を設定してください。";
      return { ok: false, error: permanentResolveError };
    }

    resolvedCfg = {
      fieldId,
      activeLabel: staffGeneralAvailabilityActiveLabel(),
    };
    return { ok: true, cfg: resolvedCfg };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isPocketHttpRateLimitError(e)) {
      return {
        ok: false,
        rateLimited: true,
        error:
          "いま @pocket のリクエスト上限に達しています。100秒ほど待ってから画面を更新してください。",
      };
    }
    // 一時障害は固定キャッシュしない
    return {
      ok: false,
      error: `稼働状況列の取得に失敗しました: ${msg}`,
    };
  }
}

export function staffRowGeneralAvailabilityIsActive(
  rec: Record<string, unknown>,
  cfg: StaffGeneralAvailabilityConfig,
): boolean {
  return staffConstructionAvailabilityIsActive(
    pickRecordValueByFieldAliases(rec, cfg.fieldId),
    cfg.activeLabel,
  );
}
