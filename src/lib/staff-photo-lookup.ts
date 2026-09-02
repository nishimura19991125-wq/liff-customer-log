import "server-only";

import type { AtPocketFieldRow, AtPocketRequestContext } from "@/lib/atpocket";
import {
  apiKeyForStaffPocketReadApClList,
  fetchAppFields,
  fetchRecordById,
} from "@/lib/atpocket";
import {
  pickRecordValueByFieldAliases,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { fetchStaffRosterRowsCached } from "@/lib/staff-roster-cache";
import { pocketTableCellToPlainString } from "@/lib/staff-construction-availability";

/**
 * スタッフ名簿の顔写真列。
 *
 * 解決の順は既存の勤務場所・部署と同じで、環境変数（uniqueId）→ 見出し。
 * **列が解決できないときは写真機能そのものを無効として扱う**（例外にしない）。
 * 写真は付加情報で、これが無いことでランキングを落としてはいけない。
 */

const PHOTO_CAPTIONS = ["顔写真", "写真", "画像", "プロフィール画像"] as const;

export type StaffPhotoLookupConfig = {
  staffAppId: string;
  nameFieldId: string;
  photoFieldId: string;
};

function staffPocketAuth() {
  return { apiKey: apiKeyForStaffPocketReadApClList() };
}

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

function pickFieldUniqueIdByCaptions(
  fields: AtPocketFieldRow[],
  captions: readonly string[],
): string | null {
  const targetSet = new Set(captions.map((c) => nfkc(c).toLowerCase()));
  for (const f of fields) {
    const cap = f.caption ? nfkc(String(f.caption)).toLowerCase() : "";
    if (cap && targetSet.has(cap)) {
      const id = f.uniqueId?.trim();
      return id || null;
    }
  }
  return null;
}

function resolveSchemaFieldId(
  configuredId: string | undefined,
  fields: AtPocketFieldRow[],
  captionAlts: readonly string[],
): string | null {
  const fromEnv = configuredId?.trim();
  if (fromEnv) {
    return resolveConfiguredFieldToSchemaUniqueId(fromEnv, fields);
  }
  const picked = pickFieldUniqueIdByCaptions(fields, captionAlts);
  if (!picked) return null;
  return resolveConfiguredFieldToSchemaUniqueId(picked, fields) ?? picked;
}

/** 解決できなければ null（＝写真は出さない） */
export async function resolveStaffPhotoLookupConfig(): Promise<StaffPhotoLookupConfig | null> {
  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const nameFieldIdEnv = process.env.STAFF_NAME_FIELD_ID?.trim();
  if (!staffAppId || !nameFieldIdEnv) return null;

  const fieldsCtx: AtPocketRequestContext = {
    operation: "staff:顔写真(列定義)",
    appEnv: "STAFF_APP_ID",
  };

  try {
    const appFields = await fetchAppFields(
      staffAppId,
      staffPocketAuth(),
      fieldsCtx,
    );
    const nameFieldId = resolveSchemaFieldId(nameFieldIdEnv, appFields, [
      "氏名",
      "担当者名",
      "スタッフ名",
      "名前",
      "社員名",
    ]);
    const photoFieldId = resolveSchemaFieldId(
      process.env.STAFF_PHOTO_FIELD_ID,
      appFields,
      PHOTO_CAPTIONS,
    );
    if (!nameFieldId || !photoFieldId) return null;
    return { staffAppId, nameFieldId, photoFieldId };
  } catch (e) {
    console.warn(
      "[staff-photo-lookup] 顔写真列を解決できません（写真は表示しません）",
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

/**
 * 担当者名 → 名簿レコードの recordId。
 *
 * **名前だけを入口にする。**レコードIDや列IDを外から受け取る作りにすると、
 * 名簿以外のアプリの添付まで読み出せる中継口になる。ここで名前から引いた
 * ID だけを、呼び出し側が写真の取得に使う。
 *
 * 写真列は名簿の共有キャッシュに載せていない。@pocket が base64 を返す
 * 仕様だった場合、名簿を共有する全画面（紐付け・勤怠・工事対応者）の
 * 取得が重くなるため。写真は1件ずつ取りにいく。
 */
export async function findStaffRecordIdByName(
  staffName: string,
  cfg: StaffPhotoLookupConfig,
): Promise<string | null> {
  const target = normApClStaffName(staffName);
  if (!target) return null;

  const rows = await fetchStaffRosterRowsCached();
  for (const row of rows) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const ro = rec as Record<string, unknown>;
    const name = normApClStaffName(
      pocketTableCellToPlainString(
        pickRecordValueByFieldAliases(ro, cfg.nameFieldId),
      ),
    );
    if (name !== target) continue;
    const id = row.recordId != null ? String(row.recordId) : (row.uniqueId ?? "");
    return id.trim() || null;
  }
  return null;
}

/**
 * 名簿の1件だけを写真列付きで取り直す。
 *
 * 上位3人ぶんで最大3回。結果は staff-photo-cache が30分持つので、
 * 何人が画面を開いても往復はほとんど起きない。
 */
export async function fetchStaffPhotoRawValue(
  recordId: string,
  cfg: StaffPhotoLookupConfig,
): Promise<unknown | null> {
  const row = await fetchRecordById(
    cfg.staffAppId,
    recordId,
    staffPocketAuth(),
    cfg.photoFieldId,
  );
  const rec = row?.record;
  if (!rec || typeof rec !== "object") return null;
  return (
    pickRecordValueByFieldAliases(rec as Record<string, unknown>, cfg.photoFieldId) ??
    null
  );
}
