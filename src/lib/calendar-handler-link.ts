import "server-only";

export type PocketLinkageHandlerPutOptions = {
  /** employee_id_string モード時に PUT する値（取込キー「社員 ID」など） */
  employeeId?: string;
};

/**
 * 工事対応者が「スタッフ名簿」連携項目のとき、PUT に載せる値を組み立てる。
 * 公式ドキュメントが簡略なため、CALENDAR_EMPTY_FILL_HANDLER_LINK_FORMAT で切り替え可能。
 *
 * - apps_record_array（既定）: [{ appsId, recordId }] … 連携項目で多い形
 * - record_id: number のみ
 * - record_id_string: 文字列のレコード ID
 * - apps_record_object: { appsId, recordId }
 * - name_string: 表示名のみ（テキスト項目向け・連携では通常不可）
 * - employee_id_string: 「工事対応者 ID」などテキストで社員 ID を要求するフィールド向け（opts.employeeId を優先）
 */
export function pocketLinkageHandlerPutValue(
  staffRecordIdStr: string | undefined,
  displayNameFallback: string,
  opts?: PocketLinkageHandlerPutOptions,
): unknown {
  const idTrim = staffRecordIdStr?.trim();
  const modeRaw =
    process.env.CALENDAR_EMPTY_FILL_HANDLER_LINK_FORMAT?.trim().toLowerCase() ||
    "apps_record_array";
  const mode =
    modeRaw === "construction_handler_id_string" || modeRaw === "handler_id_string"
      ? "employee_id_string"
      : modeRaw;

  if (mode === "employee_id_string") {
    const emp = opts?.employeeId?.trim();
    if (emp) return emp;
    const ridEarly = Number(idTrim ?? "");
    if (Number.isFinite(ridEarly)) return String(ridEarly);
    return displayNameFallback.trim() || displayNameFallback;
  }

  if (!idTrim) return displayNameFallback.trim() || displayNameFallback;

  const rid = Number(idTrim);
  if (!Number.isFinite(rid)) {
    return displayNameFallback.trim() || displayNameFallback;
  }

  const staffAppRaw = process.env.STAFF_APP_ID?.trim();
  const aid = staffAppRaw ? Number(staffAppRaw) : NaN;

  switch (mode) {
    case "record_id":
    case "staff_record_id":
      return rid;
    case "record_id_string":
    case "staff_record_id_string":
      return idTrim;
    case "apps_record_object":
    case "link_single_object":
      if (!Number.isFinite(aid)) return rid;
      return { appsId: aid, recordId: rid };
    case "name_string":
      return displayNameFallback.trim() || displayNameFallback;
    case "apps_record_array":
    case "link_array":
    default:
      if (!Number.isFinite(aid)) return rid;
      return [{ appsId: aid, recordId: rid }];
  }
}
