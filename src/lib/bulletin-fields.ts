import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";

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

export type BulletinFieldIds = {
  category: string | null;
  title: string | null;
  body: string | null;
  date: string | null;
};

export function resolveBulletinFieldIds(
  appFields: AtPocketFieldRow[],
): BulletinFieldIds {
  return {
    category: resolveSchemaFieldId(
      process.env.BULLETIN_CATEGORY_FIELD_ID,
      appFields,
      ["カテゴリ", "チェックボックス", "部署", "分類"],
    ),
    title: resolveSchemaFieldId(
      process.env.BULLETIN_TITLE_FIELD_ID,
      appFields,
      ["タイトル", "見出し", "件名", "題名"],
    ),
    body: resolveSchemaFieldId(
      process.env.BULLETIN_BODY_FIELD_ID,
      appFields,
      ["詳細", "本文", "内容", "お知らせ内容"],
    ),
    date: resolveSchemaFieldId(
      process.env.BULLETIN_DATE_FIELD_ID,
      appFields,
      ["更新日時", "投稿日", "作成日時", "登録日時", "日付", "登録日"],
    ),
  };
}

/** 掲示板の表示・投稿に最低限必要な列（タイトル・詳細）が揃っているか */
export function bulletinFieldsConfigured(ids: BulletinFieldIds): boolean {
  return Boolean(ids.title && ids.body);
}

export function bulletinFieldsCsv(ids: BulletinFieldIds): string {
  return [ids.category, ids.title, ids.body, ids.date]
    .filter(Boolean)
    .join(",");
}
