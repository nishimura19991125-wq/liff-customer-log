import "server-only";

/**
 * 工事対応者が「スタッフ名簿」連携項目のとき、PUT に載せる値を組み立てる。
 * 公式ドキュメントが簡略なため、CALENDAR_EMPTY_FILL_HANDLER_LINK_FORMAT で切り替え可能。
 *
 * - apps_record_array（既定）: [{ appsId, recordId }] … 連携項目で多い形
 * - record_id: number のみ
 * - record_id_string: 文字列のレコード ID
 * - apps_record_object: { appsId, recordId }
 * - name_string: 表示名のみ（テキスト項目向け・連携では通常不可）
 */
export function pocketLinkageHandlerPutValue(
  staffRecordIdStr: string | undefined,
  displayNameFallback: string,
): unknown {
  const idTrim = staffRecordIdStr?.trim();
  if (!idTrim) return displayNameFallback.trim() || displayNameFallback;

  const rid = Number(idTrim);
  if (!Number.isFinite(rid)) {
    return displayNameFallback.trim() || displayNameFallback;
  }

  const staffAppRaw = process.env.STAFF_APP_ID?.trim();
  const aid = staffAppRaw ? Number(staffAppRaw) : NaN;
  const mode =
    process.env.CALENDAR_EMPTY_FILL_HANDLER_LINK_FORMAT?.trim().toLowerCase() ||
    "apps_record_array";

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
