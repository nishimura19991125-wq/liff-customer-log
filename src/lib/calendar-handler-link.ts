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
 * - name_string: 表示名のみ（項目によっては連携項目でも直接入力と同等に受け付ける）
 * - employee_id_string: 社員IDなどプレーン文字列（連携キーがテキストのときのみ）
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

  const recordIdForLink = idTrim;

  const staffAppRaw = process.env.STAFF_APP_ID?.trim();
  const aid = staffAppRaw ? Number(staffAppRaw) : NaN;

  function linkagePair(): { appsId: number | string; recordId: number | string } {
    const strIds =
      process.env.CALENDAR_EMPTY_FILL_HANDLER_LINK_IDS_AS_STRING?.trim() ===
      "true";
    if (strIds && Number.isFinite(aid)) {
      return { appsId: String(aid), recordId: recordIdForLink };
    }
    return { appsId: aid, recordId: rid };
  }

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
      return linkagePair();
    case "name_string":
      return displayNameFallback.trim() || displayNameFallback;
    case "apps_record_array":
    case "link_array":
    default:
      if (!Number.isFinite(aid)) return rid;
      return [linkagePair()];
  }
}

/**
 * 「工事対応者IDの形式が正しくありません」時に順に試す値のリスト（重複除去）。
 * 先頭は CALENDAR_EMPTY_FILL_HANDLER_LINK_FORMAT に従った pocketLinkageHandlerPutValue の結果。
 */
export function pocketLinkageHandlerCandidateValues(
  staffRecordIdStr: string | undefined,
  displayNameFallback: string,
  opts?: PocketLinkageHandlerPutOptions,
): unknown[] {
  const primary = pocketLinkageHandlerPutValue(
    staffRecordIdStr,
    displayNameFallback,
    opts,
  );

  const modeRaw =
    process.env.CALENDAR_EMPTY_FILL_HANDLER_LINK_FORMAT?.trim().toLowerCase() ||
    "";
  const mode =
    modeRaw === "construction_handler_id_string" || modeRaw === "handler_id_string"
      ? "employee_id_string"
      : modeRaw;

  if (mode === "employee_id_string") {
    return [primary];
  }

  const expandLinkageVariants =
    !modeRaw ||
    mode === "apps_record_array" ||
    mode === "link_array" ||
    mode === "apps_record_object" ||
    mode === "link_single_object";

  if (!expandLinkageVariants) {
    return [primary];
  }

  const idTrim = staffRecordIdStr?.trim();
  if (!idTrim) return [primary];

  const rid = Number(idTrim);
  if (!Number.isFinite(rid)) return [primary];

  const staffAppRaw = process.env.STAFF_APP_ID?.trim();
  if (!staffAppRaw) return [primary];

  const aidNum = Number(staffAppRaw);
  const aidNumericOk = Number.isFinite(aidNum);

  const aids: (number | string)[] = [];
  const aidSeen = new Set<string>();
  const pushAid = (v: number | string) => {
    const k = `${typeof v}:${String(v)}`;
    if (aidSeen.has(k)) return;
    aidSeen.add(k);
    aids.push(v);
  };
  if (aidNumericOk) pushAid(aidNum);
  pushAid(staffAppRaw.trim());

  const recordIds: (number | string)[] = [];
  const ridSeen = new Set<string>();
  const pushRid = (v: number | string) => {
    const k = `${typeof v}:${String(v)}`;
    if (ridSeen.has(k)) return;
    ridSeen.add(k);
    recordIds.push(v);
  };
  pushRid(rid);
  pushRid(idTrim);

  const pairs: { appsId: number | string; recordId: number | string }[] = [];
  for (const a of aids) {
    for (const r of recordIds) {
      pairs.push({ appsId: a, recordId: r });
    }
  }

  const out: unknown[] = [];
  const jsonSeen = new Set<string>();
  const pushUnique = (v: unknown) => {
    const key = JSON.stringify(v);
    if (jsonSeen.has(key)) return;
    jsonSeen.add(key);
    out.push(v);
  };

  pushUnique(primary);
  for (const p of pairs) {
    pushUnique([p]);
    pushUnique(p);
  }
  return out;
}
