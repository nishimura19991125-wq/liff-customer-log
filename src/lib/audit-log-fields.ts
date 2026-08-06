import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";

/**
 * 既存の「更新履歴」アプリの列解決。
 *
 * このアプリは別システム（Google アカウントでログインする方）が既に書き込んでいる。
 * **列構成は変更しない。追記のみ行い、既存行を読む・更新する処理は書かない。**
 * 解決順は「環境変数 → 見出し（caption）完全一致」で、staff-pin-fields.ts と同じ方式。
 */

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

function resolve(
  envName: string,
  caption: string,
  fields: AtPocketFieldRow[],
): string | null {
  const env = process.env[envName]?.trim();
  if (env) return resolveConfiguredFieldToSchemaUniqueId(env, fields);
  return pickFieldUniqueIdByExactCaption(fields, caption);
}

export type AuditLogFieldIds = {
  /** 実行日時（日時） */
  executedAt: string | null;
  /** 実行者（メールアドレス文字列） */
  actor: string | null;
  /** 操作種別（自由入力の文字列） */
  action: string | null;
  /** 対象アプリID（@pocket の appsId） */
  targetAppId: string | null;
  /** 対象レコードID */
  targetRecordId: string | null;
  /** 対象T番（無ければ空で書き込む） */
  targetTNumber: string | null;
  /** 変更内容（複数行テキスト） */
  change: string | null;
};

/** 見出しは既存アプリの実物に合わせている（「対象T番」は「対象T番号」ではない） */
const CAPTIONS = {
  executedAt: "実行日時",
  actor: "実行者",
  action: "操作種別",
  targetAppId: "対象アプリID",
  targetRecordId: "対象レコードID",
  targetTNumber: "対象T番",
  change: "変更内容",
} as const satisfies Record<keyof AuditLogFieldIds, string>;

export function resolveAuditLogFieldIds(
  fields: AtPocketFieldRow[],
): AuditLogFieldIds {
  return {
    executedAt: resolve(
      "AUDIT_LOG_EXECUTED_AT_FIELD_ID",
      CAPTIONS.executedAt,
      fields,
    ),
    actor: resolve("AUDIT_LOG_ACTOR_FIELD_ID", CAPTIONS.actor, fields),
    action: resolve("AUDIT_LOG_ACTION_FIELD_ID", CAPTIONS.action, fields),
    targetAppId: resolve(
      "AUDIT_LOG_TARGET_APP_ID_FIELD_ID",
      CAPTIONS.targetAppId,
      fields,
    ),
    targetRecordId: resolve(
      "AUDIT_LOG_TARGET_RECORD_ID_FIELD_ID",
      CAPTIONS.targetRecordId,
      fields,
    ),
    targetTNumber: resolve(
      "AUDIT_LOG_TARGET_T_NUMBER_FIELD_ID",
      CAPTIONS.targetTNumber,
      fields,
    ),
    change: resolve("AUDIT_LOG_CHANGE_FIELD_ID", CAPTIONS.change, fields),
  };
}

/**
 * ログとして成立する最低限の列。
 * 「対象T番」は空でも成立するので必須から外す（欠けても記録を続ける）。
 */
const REQUIRED_KEYS = [
  "executedAt",
  "actor",
  "action",
  "targetAppId",
  "targetRecordId",
  "change",
] as const satisfies readonly (keyof AuditLogFieldIds)[];

export function auditLogFieldsConfigured(ids: AuditLogFieldIds): boolean {
  return REQUIRED_KEYS.every((k) => Boolean(ids[k]));
}

/** 未解決の必須列の見出し名（設定ミスを運用者に伝えるため） */
export function missingAuditLogFieldLabels(ids: AuditLogFieldIds): string[] {
  return REQUIRED_KEYS.filter((k) => !ids[k]).map((k) => CAPTIONS[k]);
}
