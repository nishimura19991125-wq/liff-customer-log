import {
  CONSTRUCTION_SLOT_RESET_FIELDS,
  CONSTRUCTION_SLOT_RESET_FIELD_LABELS,
} from "@/lib/calendar-empty-slot-reset";
import { formatDisplayYmd } from "@/lib/format-display-ymd";

/**
 * 工事日変更（枠の移し替え）の、送信先と文言（M-2）。
 *
 * 文言をサーバのテンプレート文字列へ散らさず1箇所に置くのは、移動が
 * **2つのレコードを書き換える**操作で、途中で止まったときに「今どうなって
 * いて、何をすればよいか」を正確に伝える必要があるため。ここが曖昧だと
 * 案件が2件のまま放置される。
 */

/** M-2 で追加した移動 API。assign-customer-case（案A）とは別物 */
export const MOVE_CONSTRUCTION_CASE_PATH =
  "/api/calendar/move-construction-case";

/** サーバがどこへ書いたか */
export type MovedCaseTarget = "slot" | "new";

export type MoveConstructionCaseResponse = {
  ok?: boolean;
  error?: string;
  /** 移動先への書き込みは済んでいる（＝案件は消えていない） */
  constructionSaved?: boolean;
  slotConflict?: boolean;
  movedTo?: MovedCaseTarget;
  /** 移動元を空き枠へ戻せたか */
  sourceResetToEmptySlot?: boolean;
  /** 戻せなかったときに、利用者が @pocket で直す対象 */
  sourceRecordId?: string;
  sourceDayKey?: string;
};

/** 消す4列の見出しを「・」でつないだもの（文言と定義をずらさない） */
export function movedSourceClearedColumnsLabel(): string {
  return CONSTRUCTION_SLOT_RESET_FIELDS.map(
    (key) => CONSTRUCTION_SLOT_RESET_FIELD_LABELS[key],
  ).join("・");
}

/**
 * 移動元を空き枠へ戻せなかったときの文言。
 *
 * ■ 「2日に重複して表示されている」と言い切る
 * 移動先への書き込みは成功しているので、同じ案件が2件ある。黙って
 * 「失敗しました」とだけ返すと、利用者は移動そのものが無かったと思って
 * 押し直し、3件目を作りかねない。
 *
 * ■ 直すまで他の操作が止まることまで書く
 * 同じ T番号 の工事レコードが2件あると
 * findConstructionRecordByTNumber が「複数一致」で error を返し、
 * 割り当て（案A）もキャンセル処理も**何も書かずに止まる**。
 * 実際にそうなるので、放置されないよう先に伝えておく。
 *
 * ■ 日付は yyyy/mm/dd で出す
 * 月をまたぐ移動があるので「12月1日」だと年が分からない。
 * @pocket でレコードを探す人が迷わないほうを採る。
 */
export function buildMoveSourceResetFailedMessage(input: {
  sourceRecordId: string;
  sourceDayKey: string;
  targetDayKey: string;
}): string {
  const from = formatDisplayYmd(input.sourceDayKey) || input.sourceDayKey;
  const to = formatDisplayYmd(input.targetDayKey) || input.targetDayKey;

  return [
    `移動先（${to}）への登録は完了しましたが、移動元（${from}・レコードID ${input.sourceRecordId}）を空き枠に戻せませんでした。`,
    "現在この案件は2日に重複して表示されています。",
    `@pocket で${from}のレコードから${movedSourceClearedColumnsLabel()}を消してください。`,
    "消すまで、この案件の割り当て・キャンセルはエラーになります。",
  ].join("\n");
}

/** 確認画面の材料。空き枠を使わないときは targetSlotContractor を null にする */
export type MoveCaseConfirmInput = {
  customerName: string;
  tNumber: string;
  sourceDayKey: string;
  targetDayKey: string;
  /** 移動元の施工会社 */
  sourceContractor: string;
  /** 移動先の空き枠の施工会社。null＝空き枠を使わず新規作成 */
  targetSlotContractor: string | null;
};

function ymd(dayKey: string): string {
  return formatDisplayYmd(dayKey) || dayKey.trim();
}

/** 施工会社の比較キー。表記ゆれで「変わります」を誤表示しない */
function contractorKey(raw: string): string {
  return raw.normalize("NFKC").replace(/\s/g, "").toLowerCase();
}

export function moveCaseContractorChanges(
  input: MoveCaseConfirmInput,
): boolean {
  if (input.targetSlotContractor == null) return false;
  const to = contractorKey(input.targetSlotContractor);
  if (!to) return false;
  return contractorKey(input.sourceContractor) !== to;
}

export function buildMoveCaseConfirmTitle(input: MoveCaseConfirmInput): string {
  return `工事日を ${ymd(input.sourceDayKey)} → ${ymd(input.targetDayKey)} に変更します`;
}

export function buildMoveCaseConfirmSubject(
  input: MoveCaseConfirmInput,
): string {
  const name = input.customerName.trim();
  const t = input.tNumber.trim();
  if (!name) return t ? `（${t}）` : "";
  return t ? `${name} 様（${t}）` : `${name} 様`;
}

/**
 * 「実行される内容」の箇条書き。
 *
 * ■ 施工会社の行は変わるときだけ出す
 * 変わらないのに出すと、読み飛ばす癖がついて本当に変わるときに効かない。
 *
 * ■ Aki番号 は番号を書かない
 * カレンダーのペイロードに Aki番号 を載せていないため、確認の時点では
 * 移動先の番号が分からない。番号を出すには表示パイプライン（
 * buildCalendarPayload → rowToApiItem）に列を1つ通す必要があり、
 * 「工事カレンダーの表示」を触るリスクに見合わないと判断した。
 * 「入れ替わる／新規採番される／お客様情報にも反映される」という
 * 判断に必要な情報は番号なしで伝わる。
 */
export function buildMoveCaseConfirmLines(
  input: MoveCaseConfirmInput,
): string[] {
  const to = ymd(input.targetDayKey);
  const from = ymd(input.sourceDayKey);
  const usesSlot = input.targetSlotContractor != null;

  const lines: string[] = [];

  lines.push(
    usesSlot
      ? `${to} の空き枠（施工会社: ${input.targetSlotContractor?.trim() || "未設定"}）にこの案件を書き込みます`
      : `${to} に新しいレコードを作成します（Aki番号 は新規採番）`,
  );
  lines.push(
    `${from} のレコードは顧客情報を消して、空き枠として残します（削除しません）`,
  );
  if (moveCaseContractorChanges(input)) {
    lines.push(
      `施工会社が ${input.sourceContractor.trim() || "未設定"} → ${input.targetSlotContractor?.trim()} に変わります`,
    );
  }
  lines.push(
    usesSlot
      ? "Aki番号 が移動先の空き枠のものに入れ替わります（お客様情報にも反映）"
      : "Aki番号 が新規採番されます（お客様情報にも反映）",
  );

  return lines;
}

export const MOVE_CASE_CONFIRM_WARNING =
  "この操作は元に戻せません。途中で失敗した場合、案件が2日に重複して表示されることがあります。その場合は画面の案内に従ってください。";

export function moveCaseConfirmActionLabel(
  input: MoveCaseConfirmInput,
): string {
  return `${ymd(input.targetDayKey)} へ移動する`;
}
