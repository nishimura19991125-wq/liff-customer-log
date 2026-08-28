/**
 * 案件のレコードを**空き枠に戻す**ための、消す列の定義（工事日変更 M-1）。
 *
 * 工事日を別の日へ移すとき、移動先へ案件を書いたあと、移動元のレコードは
 * 削除せずに空き枠へ戻す（3-3 で「空き枠を消さない」方針にしたため）。
 * そのために顧客まわりの列だけを空にする。
 *
 * ⚠ **M-1 の時点ではどこからも呼ばれない。** 配線は M-2 以降。
 *
 * ── キャンセル処理と混同しないこと ──────────────────────────
 * customer-cancel-server.ts も「レコードを削除せず列を空にする」が、
 * **消す列がほぼ正反対**である。
 *
 *              消す                                   残す
 *   キャンセル  施工予定日 / 施工会社 / 工事対応者      お客様名 / T番号 / 住宅ステータス
 *   移動（ここ）お客様名 / T番号 / 住宅ステータス /     施工予定日 / 施工会社 / Aki番号
 *               工事対応者
 *
 * 共通するのは工事対応者だけ。狙いも逆で、
 *   キャンセル … 案件は残したまま日程を外し、空き枠は**別に新規作成**する
 *   移動       … このレコード**そのもの**を空き枠に変える
 * どちらかの定義をもう一方へ流用しないこと。片方を直すときも、
 * もう片方が追随すべきかを必ず考えること。
 *
 * ── 空き枠として成立する条件 ────────────────────────────────
 * カレンダーの判定（calendar-kojo.ts の rowToCalendarEvent）は
 *   ・お客様名が空        → category = "empty"
 *   ・施工予定日が読める  → 読めない行はカレンダーから落ちる
 * の2つ。だから施工予定日は**残さなければならない**。
 * 施工会社は空き枠の判定には要らないが、空き枠の照合
 * （pickEmptySlotForDay）が施工会社の一致を必須にしているので、
 * 消すと「日付はあるのに誰も割り当てられない枠」になる。だから残す。
 *
 * ── 取込キー（Aki番号）を載せない理由 ──────────────────────
 * @pocket は取込キーの列がレコード本文に無いと更新を 400 で返すが、
 * **ここでは載せない**。この関数は @pocket を読まない純粋関数で、
 * Aki番号 の実際の値を知らないため。値を知らないまま空文字などを
 * 入れると採番済みの Aki番号 を壊す。
 *
 * 補完は writePocketRecordWithImportKey に任せる。あちらは
 * 「payload にキーが無ければ既存レコードから読んで載せる」という、
 * まさにこのための部品で、工事アプリの更新経路はすべてこれを使っている
 * （fill-empty-slot / assign-case-to-slot / schedule-undated-case /
 *   assign-customer-case / customer-cancel-server）。
 *
 * M-2 で呼ぶときは次の形にすること。
 *   writePocketRecordWithImportKey({
 *     appId, recordId: 移動元,
 *     payload: buildConstructionEmptySlotResetPatch(...).patch,
 *     importKeyFieldId: resolveConstructionImportKeyFieldId(fields),
 *     existingRecord: 読み込み済みの移動元レコード, // 追加の GET を起こさない
 *     readAuth, writeAuth,
 *     allowMissingImportKey: true,  // 移行前の案件は Aki番号 が無い
 *   })
 */

/** 空き枠へ戻すときに空にする項目。ここに1行足せば全体が追随する */
export type ConstructionSlotResetField =
  | "customerName"
  | "tNumber"
  | "housingStatus"
  | "constructionHandler";

export const CONSTRUCTION_SLOT_RESET_FIELDS: readonly ConstructionSlotResetField[] =
  ["customerName", "tNumber", "housingStatus", "constructionHandler"];

export const CONSTRUCTION_SLOT_RESET_FIELD_LABELS: Record<
  ConstructionSlotResetField,
  string
> = {
  customerName: "お客様名",
  tNumber: "T番号",
  housingStatus: "住宅ステータス",
  constructionHandler: "工事対応者",
};

/** 空き枠へ戻しても**残す**項目。確認画面の説明にも使う */
export const CONSTRUCTION_SLOT_KEEP_FIELD_LABELS: readonly string[] = [
  "施工予定日",
  "施工会社",
  "Aki番号",
];

export function isConstructionSlotResetField(
  key: string,
): key is ConstructionSlotResetField {
  return (
    CONSTRUCTION_SLOT_RESET_FIELDS as readonly string[]
  ).includes(key);
}

/** 1項目ぶんの列指定。お客様名のように解決経路が複数あるものは配列で渡す */
export type ConstructionSlotResetFieldIds =
  | string
  | readonly (string | null | undefined)[]
  | null
  | undefined;

export type ConstructionSlotResetPatchResult = {
  /** @pocket へ送る payload。空にする列だけが入る */
  patch: Record<string, unknown>;
  /** 実際に空にする列があった項目 */
  cleared: ConstructionSlotResetField[];
  /**
   * 空にできなかった項目（呼び出し側でログに出す）。
   * 列を解決できなかった場合と、解決先が「残す列」だった場合の両方が入る。
   * どちらだったかは keptFieldIds で分かる。
   */
  unresolved: ConstructionSlotResetField[];
  /**
   * 「残す列」と同じ列だったため patch から外した列。
   *
   * 見出しの表記ゆれや環境変数の設定ミスで、消す側の解決が
   * 施工予定日・施工会社・Aki番号 を指してしまうことがありうる。
   * そのまま送ると空き枠として成立しなくなるので落とす。
   * 空でない＝設定がおかしいので、呼び出し側で必ずログに出すこと。
   */
  keptFieldIds: string[];
};

function normalizeFieldIds(
  raw: ConstructionSlotResetFieldIds,
): string[] {
  if (raw == null) return [];
  const list = typeof raw === "string" ? [raw] : raw;
  const out: string[] = [];
  for (const id of list) {
    const t = id?.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * 移動元のレコードを空き枠に戻す patch を組み立てる。
 *
 * ■ お客様名の列を複数受け取れるようにしてある理由
 * 工事アプリのお客様名は解決経路が2つある。
 *   カレンダー表示の判定 … resolveConstructionFieldIds の title（見出し）
 *   空き枠の書き込み・空判定 … CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID
 * 通常は同じ列を指すが、食い違うと「片方だけ空になって空き枠に戻らない」
 * が起きる。消す操作なので、解決できたものは**全部**空にする。
 *
 * @param fieldIdsOf 項目 → 工事アプリの列（解決できなければ null）
 * @param keepFieldIds 残す列（施工予定日・施工会社・Aki番号）。
 *                     ここに入っている列は消す側に来ても外す
 */
export function buildConstructionEmptySlotResetPatch(input: {
  fieldIdsOf: (
    key: ConstructionSlotResetField,
  ) => ConstructionSlotResetFieldIds;
  keepFieldIds?: readonly (string | null | undefined)[];
}): ConstructionSlotResetPatchResult {
  const keep = new Set(normalizeFieldIds(input.keepFieldIds));

  const patch: Record<string, unknown> = {};
  const cleared: ConstructionSlotResetField[] = [];
  const unresolved: ConstructionSlotResetField[] = [];
  const keptFieldIds: string[] = [];

  for (const field of CONSTRUCTION_SLOT_RESET_FIELDS) {
    const ids = normalizeFieldIds(input.fieldIdsOf(field));
    if (ids.length === 0) {
      unresolved.push(field);
      continue;
    }

    let clearedAny = false;
    for (const id of ids) {
      if (keep.has(id)) {
        if (!keptFieldIds.includes(id)) keptFieldIds.push(id);
        continue;
      }
      patch[id] = "";
      clearedAny = true;
    }
    if (clearedAny) cleared.push(field);
    else unresolved.push(field);
  }

  return { patch, cleared, unresolved, keptFieldIds };
}
