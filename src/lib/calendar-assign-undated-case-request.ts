import type { CalendarEmptySlotMatch } from "@/lib/calendar-api-types";

/**
 * 新規登録「未定案件を割り当て」の、どこへ何を送るかの判断（タスクS-3）。
 *
 * 画面から切り出して純粋関数にしてある。空き枠を消すか消さないかの分岐は
 * 取り返しがつかないので、UI の都合と混ぜずにここだけで決める。
 */

export type AssignUndatedCaseValues = {
  caseRecordId: string;
  scheduledStartDate: string;
  contractor: string;
};

/** 確認画面の3択。空き枠が無いときは skip-slot と同じ扱い */
export type AssignUndatedCaseChoice = "use-slot" | "skip-slot" | "cancel";

/** 既存の割り当て API。空き枠を削除する */
export const ASSIGN_CASE_TO_SLOT_PATH = "/api/calendar/assign-case-to-slot";
/** 空き枠に触らず案件へ日付を書くだけの API */
export const SCHEDULE_UNDATED_CASE_PATH =
  "/api/calendar/schedule-undated-case";

export type AssignUndatedCaseRequest = {
  path: string;
  body: Record<string, unknown>;
  /** この送信で空き枠が削除されるか（画面の文言・ログ用） */
  consumesSlot: boolean;
};

/** 未入力の必須項目。空配列なら送信してよい */
export function missingAssignUndatedCaseFields(
  values: AssignUndatedCaseValues,
): Array<{ key: "case" | "scheduledStartDate" | "contractor"; label: string }> {
  const missing: Array<{
    key: "case" | "scheduledStartDate" | "contractor";
    label: string;
  }> = [];
  if (!values.caseRecordId.trim()) {
    missing.push({ key: "case", label: "工事日未定案件" });
  }
  if (!values.scheduledStartDate.trim()) {
    missing.push({ key: "scheduledStartDate", label: "施工予定日" });
  }
  // 空き枠との照合に使うため、この導線では必須
  if (!values.contractor.trim()) {
    missing.push({ key: "contractor", label: "施工会社" });
  }
  return missing;
}

export function formatMissingFieldsMessage(
  missing: readonly { label: string }[],
): string {
  if (missing.length === 0) return "";
  return `未入力の必須項目があります: ${missing.map((m) => m.label).join("、")}`;
}

/**
 * 送信先とペイロードを決める。送らない場合は null。
 *
 * - cancel                → null（何もしない）
 * - use-slot かつ空き枠あり → 既存の assign-case-to-slot（空き枠を削除）
 * - それ以外               → schedule-undated-case（空き枠は残る）
 *
 * 必須が欠けているときも null を返す。画面のバリデーションが素通りしても
 * 空き枠の削除まで進まないようにする。
 */
export function buildAssignUndatedCaseRequest(input: {
  choice: AssignUndatedCaseChoice;
  values: AssignUndatedCaseValues;
  slot: CalendarEmptySlotMatch | null;
  viewYear?: number;
  viewMonth?: number;
}): AssignUndatedCaseRequest | null {
  if (input.choice === "cancel") return null;
  if (missingAssignUndatedCaseFields(input.values).length > 0) return null;

  const caseRecordId = input.values.caseRecordId.trim();
  const scheduledStartDate = input.values.scheduledStartDate.trim();
  const contractor = input.values.contractor.trim();
  const slotRecordId = input.slot?.recordId.trim() ?? "";

  if (input.choice === "use-slot" && input.slot && slotRecordId) {
    return {
      path: ASSIGN_CASE_TO_SLOT_PATH,
      body: {
        slotRecordId,
        caseRecordId,
        // 空き枠側の日付を使う。画面の入力日と同じ日のはずだが、
        // 削除する枠そのものの日付を正とする
        slotDayKey: input.slot.dayKey,
        viewYear: input.viewYear,
        viewMonth: input.viewMonth,
      },
      consumesSlot: true,
    };
  }

  return {
    path: SCHEDULE_UNDATED_CASE_PATH,
    body: {
      caseRecordId,
      scheduledStartDate,
      contractor,
      viewYear: input.viewYear,
      viewMonth: input.viewMonth,
    },
    consumesSlot: false,
  };
}
