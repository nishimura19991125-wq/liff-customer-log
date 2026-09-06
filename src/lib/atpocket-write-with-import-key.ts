import "server-only";

import type {
  AtPocketCreateRecordResult,
  AtPocketFetchAuth,
} from "@/lib/atpocket";
import { createRecord, fetchRecordById, updateRecord } from "@/lib/atpocket";
import { pickRecordValueByFieldAliases } from "@/lib/calendar-kojo";

const POCKET_IMPORT_KEY_CONFIG_ERROR =
  "@pocket: 該当アプリの取込設定にキー項目を追加してください（自動採番のままで番号入力は不要）";

/** @pocket 書き込み 400（取込キー不備）のユーザー向けメッセージ */
export function formatPocketImportKeyWriteError(detail: string): string {
  if (detail.includes("取込設定") && detail.includes("キー項目")) {
    return POCKET_IMPORT_KEY_CONFIG_ERROR;
  }
  return detail;
}

export type WritePocketRecordWithImportKeyOpts = {
  appId: string;
  /** 指定あり=更新(PUT) / なし=新規(POST) */
  recordId?: string;
  payload: Record<string, unknown>;
  /** そのアプリの取込キー列（スキーマ uniqueId）。例: T番号 */
  importKeyFieldId?: string;
  /** 更新時に既存キー値を読む元（任意） */
  existingRecord?: Record<string, unknown>;
  /** existingRecord が無いとき既存レコードを取得するため */
  readAuth?: AtPocketFetchAuth;
  writeAuth: AtPocketFetchAuth;
  /**
   * 既存レコードから取込キーを読めなかったとき、キーを載せずに書き込む。
   *
   * 取込キーの列が @pocket 側で差し替わった直後は、それ以前に作られた
   * レコードに新しいキーの値が入っていないことがある。そこで先回りして
   * 例外にすると、**既存レコードの更新がすべて落ちる**。
   * この指定があるときは載せずに送り、可否は @pocket に判断させる。
   */
  allowMissingImportKey?: boolean;
};

function coerceImportKeyValue(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const t = raw.trim();
    return t || null;
  }
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw).trim() || null;
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of ["value", "displayValue", "label", "name", "text"]) {
      const v = o[k];
      if (v != null && (typeof v === "string" || typeof v === "number")) {
        const t = String(v).trim();
        if (t) return t;
      }
    }
  }
  const t = String(raw).trim();
  return t || null;
}

function readImportKeyFromRecord(
  rec: Record<string, unknown>,
  fieldId: string,
): string | null {
  const raw = pickRecordValueByFieldAliases(rec, fieldId);
  if (raw === undefined || raw === null) return null;
  return coerceImportKeyValue(raw);
}

function payloadHasImportKeyValue(
  payload: Record<string, unknown>,
  fieldId: string,
): boolean {
  if (!(fieldId in payload)) return false;
  return readImportKeyFromRecord(payload, fieldId) != null;
}

async function resolveExistingImportKeyValue(opts: {
  appId: string;
  recordId: string;
  importKeyFieldId: string;
  existingRecord?: Record<string, unknown>;
  readAuth?: AtPocketFetchAuth;
}): Promise<string> {
  if (opts.existingRecord) {
    const fromExisting = readImportKeyFromRecord(
      opts.existingRecord,
      opts.importKeyFieldId,
    );
    if (fromExisting) return fromExisting;
  }

  if (opts.readAuth) {
    const row = await fetchRecordById(
      opts.appId,
      opts.recordId,
      opts.readAuth,
      opts.importKeyFieldId,
    );
    if (row?.record && typeof row.record === "object") {
      const fromFetch = readImportKeyFromRecord(
        row.record as Record<string, unknown>,
        opts.importKeyFieldId,
      );
      if (fromFetch) return fromFetch;
    }
  }

  throw new Error(
    `取込キー（${opts.importKeyFieldId}）の既存値を取得できません。レコードにキーが入っているか、フィールド設定を確認してください。`,
  );
}

/**
 * 取込キーを payload に載せてから @pocket へ書き込む。
 * 更新(PUT)時にキー欠落による 400 を防ぐ。
 */
export async function writePocketRecordWithImportKey(
  opts: WritePocketRecordWithImportKeyOpts,
): Promise<AtPocketCreateRecordResult | void> {
  const payload = { ...opts.payload };
  const keyFieldId = opts.importKeyFieldId?.trim();
  const recordId = opts.recordId?.trim();

  if (keyFieldId && !payloadHasImportKeyValue(payload, keyFieldId)) {
    if (recordId) {
      try {
        payload[keyFieldId] = await resolveExistingImportKeyValue({
          appId: opts.appId,
          recordId,
          importKeyFieldId: keyFieldId,
          existingRecord: opts.existingRecord,
          readAuth: opts.readAuth,
        });
      } catch (e) {
        if (!opts.allowMissingImportKey) throw e;
        // 載せずに送る。@pocket が拒否すればそのエラーがそのまま返る
        console.warn(
          "[atpocket] 取込キーの既存値を読めないため、キーを載せずに更新します",
          { appId: opts.appId, recordId, importKeyFieldId: keyFieldId },
        );
      }
    }
  }

  try {
    if (recordId) {
      await updateRecord(opts.appId, recordId, payload, opts.writeAuth);
      return;
    }
    return await createRecord(opts.appId, payload, opts.writeAuth);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    /**
     * 文言は作り替えるが、**status と Retry-After は落とさない。**
     *
     * ここで新しい Error に詰め替えると、@pocket が返した 429 の
     * Retry-After が消える。呼び出し側（打刻の再試行）が待ち時間を
     * 決められなくなるので、判定に使うプロパティだけ引き継ぐ。
     */
    const wrapped: Error & { status?: number; retryAfterMs?: number } =
      new Error(formatPocketImportKeyWriteError(detail));
    if (e && typeof e === "object") {
      const src = e as { status?: unknown; retryAfterMs?: unknown };
      if (typeof src.status === "number") wrapped.status = src.status;
      if (typeof src.retryAfterMs === "number") {
        wrapped.retryAfterMs = src.retryAfterMs;
      }
    }
    throw wrapped;
  }
}
