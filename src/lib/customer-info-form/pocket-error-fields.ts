/**
 * @pocket が 400 で返した本文から、原因の列の**見出し**を拾う。
 *
 * 値の形式が合わないと @pocket は 400 を返すが、画面には
 * 「更新に失敗しました」しか出ず、利用者は何を直せばよいか分からない。
 * 実際に「追加部材の金額に 10000円 と入力して登録できない」という報告が
 * あった（列は数値型で、アプリ側が text だった）。
 *
 * 応答本文には列の識別名（field-XX）が入るので、それを見出しへ引き直す。
 *
 * ■ 出すのは見出しだけ
 * 値・field-XX・appsId・環境変数名・応答本文そのものは出さない。
 * 引き直せた列の**名前だけ**を返す。
 *
 * ■ 引けなければ空を返す
 * 推測で項目名を出さない。誤った項目を案内すると、かえって混乱する。
 * 呼び出し側は空のときに従来の文言へ落とす。
 */

/** 画面に並べる上限。多すぎると読まれない（必須未入力の案内と同じ作法） */
export const POCKET_ERROR_FIELD_LABEL_LIMIT = 5;

/**
 * 列の識別名のゆれを吸収する。
 * @pocket の uniqueId は `field-12` と `field_101` の両方の書き方がある。
 */
function normalizeFieldId(raw: string): string {
  return raw.trim().toLowerCase().replace(/_/g, "-");
}

/** 解決済みフィールドから「識別名 → 見出し」を作る */
export function customerInfoFieldLabelMap(
  resolved: ReadonlyArray<{ fieldId?: string; label?: string; caption?: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of resolved) {
    const id = f.fieldId?.trim();
    const label = (f.label ?? f.caption ?? "").trim();
    if (!id || !label) continue;
    const key = normalizeFieldId(id);
    if (!map.has(key)) map.set(key, label);
  }
  return map;
}

/**
 * 応答本文に出てくる列の識別名を、見出しへ引き直して返す。
 *
 * - 出てきた順に、重複を落として返す
 * - 引き直せなかった識別名は**捨てる**（field-XX を画面へ出さない）
 * - 1つも引き直せなければ空配列（呼び出し側は従来の文言へ落とす）
 */
export function customerInfoFieldLabelsFromPocketError(
  rawMessage: string,
  labelByFieldId: ReadonlyMap<string, string>,
  limit: number = POCKET_ERROR_FIELD_LABEL_LIMIT,
): string[] {
  if (!rawMessage) return [];

  const labels: string[] = [];
  const seen = new Set<string>();
  for (const m of rawMessage.matchAll(/field[-_]\d+/gi)) {
    const label = labelByFieldId.get(normalizeFieldId(m[0]));
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }

  if (labels.length <= limit) return labels;
  return [...labels.slice(0, limit), `ほか${labels.length - limit}項目`];
}

/** 画面へ出す1行。引き直せなければ null（呼び出し側は従来の文言のまま） */
export function customerInfoPutFailureMessage(
  rawMessage: string,
  labelByFieldId: ReadonlyMap<string, string>,
): string | null {
  const labels = customerInfoFieldLabelsFromPocketError(
    rawMessage,
    labelByFieldId,
  );
  if (labels.length === 0) return null;
  return `更新に失敗しました。次の項目の値をご確認ください: ${labels.join("、")}`;
}
