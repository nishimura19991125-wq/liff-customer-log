import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import {
  pocketFieldUniqueIdByCaption,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";
import { APO_ACQUISITION_FIELD_SPECS } from "@/lib/apo-acquisition-fields";
import type { ApoAcquisitionFieldKey } from "@/lib/apo-acquisition-types";

/**
 * アポ情報の詳細ページで出す項目の定義。
 *
 * 10項目はアポ取得時入力（APO_ACQUISITION_FIELD_SPECS）と同じ列なので、
 * 環境変数と見出し候補をそちらから借りる。同じ列を別の名前で
 * 二重に持たないため。
 *
 * 希望メーカーだけは APO_ACQUISITION_FIELD_SPECS に定義が無い。
 * @pocket 側はテキスト型で、フィールド識別名が field-61 と分かっている
 * ため、見出しを推測せず識別名で解決する（下の DESIRED_MANUFACTURER）。
 */

export type ApoDetailFieldKey = ApoAcquisitionFieldKey | "desiredManufacturer";

export type ApoDetailGroup = {
  title: string;
  keys: readonly ApoDetailFieldKey[];
};

/** 表示の順序とグループ。この並びのまま画面に出す */
export const APO_DETAIL_GROUPS: readonly ApoDetailGroup[] = [
  {
    title: "アポ情報",
    keys: ["apStaff", "clStaff", "apoRank"],
  },
  {
    title: "お客様情報",
    keys: [
      "customerContact",
      "pinpointAddress",
      "familyComposition",
      "familyFeatures",
      "conversationContent",
    ],
  },
  {
    title: "見積",
    keys: ["estimateType", "desiredManufacturer", "otherSharedItems"],
  },
];

/** 表示する全項目（グループ順に平坦化） */
export const APO_DETAIL_FIELD_KEYS: readonly ApoDetailFieldKey[] =
  APO_DETAIL_GROUPS.flatMap((g) => [...g.keys]);

/**
 * 希望メーカー。
 *
 * APO_ACQUISITION_FIELD_SPECS に無い唯一の項目。@pocket 側はテキスト型で、
 * 値は半角カンマ区切り（例: SHARP,XSOL,Panasonic）。
 * 見出しが分からないため、フィールド識別名（field-61）で解決する。
 * 環境変数を先に見るので、識別名が変わっても設定で追従できる。
 */
const DESIRED_MANUFACTURER = {
  label: "希望メーカー",
  envKey: "APO_LIST_DESIRED_MANUFACTURER_FIELD_ID",
  /** @pocket 上のフィールド識別名。見出しは推測しない */
  fallbackFieldId: "field-61",
} as const;

export function apoDetailFieldLabel(key: ApoDetailFieldKey): string {
  if (key === "desiredManufacturer") return DESIRED_MANUFACTURER.label;
  return APO_ACQUISITION_FIELD_SPECS[key].label;
}

/** 項目キー → @pocket の列 uniqueId。見つからない項目は null */
export function resolveApoDetailFieldIds(
  fields: AtPocketFieldRow[],
): Record<ApoDetailFieldKey, string | null> {
  const out = {} as Record<ApoDetailFieldKey, string | null>;

  for (const key of APO_DETAIL_FIELD_KEYS) {
    out[key] =
      key === "desiredManufacturer"
        ? resolveDesiredManufacturerFieldId(fields)
        : resolveFromAcquisitionSpec(key, fields);
  }

  return out;
}

function resolveFromAcquisitionSpec(
  key: Exclude<ApoDetailFieldKey, "desiredManufacturer">,
  fields: AtPocketFieldRow[],
): string | null {
  const spec = APO_ACQUISITION_FIELD_SPECS[key];

  const env = process.env[spec.envKey]?.trim();
  if (env) {
    const id = resolveConfiguredFieldToSchemaUniqueId(env, fields);
    if (id) return id;
  }

  for (const caption of spec.captions) {
    const id = pocketFieldUniqueIdByCaption(fields, caption);
    if (id) return id;
  }

  return null;
}

function resolveDesiredManufacturerFieldId(
  fields: AtPocketFieldRow[],
): string | null {
  const env = process.env[DESIRED_MANUFACTURER.envKey]?.trim();
  if (env) {
    const id = resolveConfiguredFieldToSchemaUniqueId(env, fields);
    if (id) return id;
  }
  return resolveConfiguredFieldToSchemaUniqueId(
    DESIRED_MANUFACTURER.fallbackFieldId,
    fields,
  );
}
