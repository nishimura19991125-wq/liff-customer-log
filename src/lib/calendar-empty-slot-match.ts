import "server-only";

import type { AtPocketFieldRow, AtPocketRecordRow } from "@/lib/atpocket";
import { dayKeyFromConstructionRecord } from "@/lib/calendar-consume-empty-slot";
import {
  constructionTitleFieldIsEmpty,
  pickRecordValueByFieldAliases,
  resolveConstructionFieldIds,
} from "@/lib/calendar-kojo";

/**
 * 同じ日・同じ施工会社の空き枠を探す（タスクS-2）。
 *
 * 新規登録の「未定案件を割り当て」から日付と施工会社を直接入力したとき、
 * その日にその施工会社の空き枠が既にあれば、枠を消費するか聞く。
 */

export type CalendarEmptySlotCandidate = {
  recordId: string;
  /** 施工予定日（YYYY-MM-DD） */
  dayKey: string;
  /** 施工会社（@pocket の生の値） */
  contractorName: string;
};

function coercePlainString(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw).trim();
  }
  if (Array.isArray(raw)) {
    return raw.map(coercePlainString).filter(Boolean).join(" ");
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of ["value", "displayValue", "label", "name", "text"]) {
      const v = o[k];
      if (v != null && (typeof v === "string" || typeof v === "number")) {
        return String(v).trim();
      }
    }
  }
  return String(raw).trim();
}

/**
 * 施工会社の比較キー。
 *
 * @pocket の値と画面の選択肢は同じ取引先会社一覧から来るが、全角括弧・
 * 空白・大小文字のゆれが混ざる。NFKC で正規化し、空白を落として比べる。
 */
export function normalizeContractorKey(raw: string | null | undefined): string {
  return (raw ?? "")
    .normalize("NFKC")
    .replace(/\s/g, "")
    .toLowerCase();
}

function recordIdFromRow(rec: AtPocketRecordRow): string {
  const raw = rec.recordId ?? rec.id;
  if (raw == null) return "";
  return String(raw).trim();
}

/**
 * 工事レコードから空き枠（＝お客様名が空で施工予定日が入っている行）を取り出す。
 *
 * 空き枠の判定は既存の constructionTitleFieldIsEmpty に合わせる。
 * 施工会社列が無い環境では contractorName が空になり、後段の照合で
 * 必ず対象外になる（＝確認画面が出ない）。
 */
export function buildCalendarEmptySlotCandidates(
  records: readonly AtPocketRecordRow[],
  constructionFields: AtPocketFieldRow[],
): CalendarEmptySlotCandidate[] {
  const fids = resolveConstructionFieldIds(constructionFields);
  const titleId = fids.title?.trim();
  if (!titleId) return [];
  const contractorId = fids.contractor?.trim();

  const out: CalendarEmptySlotCandidate[] = [];
  for (const rec of records) {
    const recordId = recordIdFromRow(rec);
    if (!recordId) continue;
    if (!rec.record || typeof rec.record !== "object") continue;
    const recObj = rec.record as Record<string, unknown>;

    if (!constructionTitleFieldIsEmpty(recObj, titleId)) continue;

    const dayKey = dayKeyFromConstructionRecord(recObj, constructionFields);
    if (!dayKey) continue;

    out.push({
      recordId,
      dayKey,
      contractorName: contractorId
        ? coercePlainString(pickRecordValueByFieldAliases(recObj, contractorId))
        : "",
    });
  }
  return out;
}

/**
 * レコードIDの昇順で並べるための比較。
 *
 * @pocket のレコードIDは数字だが、桁数がそろわないと文字列比較では
 * "10" < "9" になる。数字として読めるときは数値で比べ、読めない値が
 * 混ざったときだけ文字列比較へ落とす。
 */
function compareRecordId(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) {
    return na - nb;
  }
  if (Number.isFinite(na) && Number.isFinite(nb)) return 0;
  return a.localeCompare(b);
}

export type EmptySlotMatchResult = {
  /** 採用する空き枠。無ければ null */
  slot: CalendarEmptySlotCandidate | null;
  /** 条件に一致した空き枠の総数（ログ・監査用） */
  matchCount: number;
};

/**
 * 同じ日・同じ施工会社の空き枠を1つ選ぶ。
 *
 * ── 施工会社が空のときは必ず null ─────────────────────────
 * 空き枠の削除は不可逆なので、画面のバリデーションだけに頼らない。
 * 施工会社が空のまま呼ばれたら、日付が合っていても枠を返さない。
 *
 * ── 複数あるときの選び方 ────────────────────────────────
 * 同じ日・同じ施工会社の空き枠はレコードIDとT番号しか違わず、利用者に
 * 選ばせる材料がない。レコードIDの昇順で先頭（＝先に作られた枠）を採る。
 * 実行するたびに結果が変わらないよう、並び順は入力順に依存させない。
 */
export function pickEmptySlotForDay(
  candidates: readonly CalendarEmptySlotCandidate[],
  input: { dayKey: string; contractor: string },
): EmptySlotMatchResult {
  const dayKey = input.dayKey.trim();
  const contractorKey = normalizeContractorKey(input.contractor);
  if (!dayKey || !contractorKey) return { slot: null, matchCount: 0 };

  const matched = candidates.filter(
    (c) =>
      c.dayKey === dayKey &&
      normalizeContractorKey(c.contractorName) === contractorKey,
  );
  if (matched.length === 0) return { slot: null, matchCount: 0 };

  const sorted = [...matched].sort((a, b) =>
    compareRecordId(a.recordId, b.recordId),
  );
  return { slot: sorted[0], matchCount: matched.length };
}
