/**
 * 取込キー（自動採番の列）を payload に載せる。列IDを引数で受け取る汎用版。
 *
 * ■ 規約
 *   - 作成時は **空文字**。@pocket に採番させる。番号をこちらで決めない
 *   - 更新時は **既存の値**。空文字や未指定で送ると更新が落ちる
 *     （この規約を外れて、過去に何度も不具合が出ている）
 *
 * 既存の applyAttendanceAutoNumberOnCreate / applyWorkEndReportAutoNumberOnCreate は
 * 中で自分のアプリの環境変数を読むため、ほかのアプリには使えない。
 * 新しいアプリはこちらを使う（既存の2つはそのまま）。
 */

export type ImportKeyWriteMode =
  | { importKeyFieldId: string | null | undefined; mode: "create" }
  | {
      importKeyFieldId: string | null | undefined;
      mode: "update";
      /** 更新するレコードに入っている取込キーの値 */
      existingValue: string | null | undefined;
    };

export function applyImportKeyForWrite(
  payload: Record<string, unknown>,
  opts: ImportKeyWriteMode,
): Record<string, unknown> {
  const fieldId = opts.importKeyFieldId?.trim();
  const out: Record<string, unknown> = { ...payload };
  if (!fieldId) return out;

  if (opts.mode === "create") {
    out[fieldId] = "";
    return out;
  }

  const existing = opts.existingValue?.trim();
  if (!existing) {
    // 空文字で送ると @pocket は新しいキーとして扱うか、更新を拒否する。
    // 黙って送らず、呼び出し側で既存の値を読み直してもらう
    throw new Error("取込キーの既存値が無いため更新できません");
  }
  out[fieldId] = existing;
  return out;
}
