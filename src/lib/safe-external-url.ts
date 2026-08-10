/**
 * @pocket に保存された文字列を外部リンクとして描画してよいか判定する。
 *
 * 値は人が入力する列なので、任意の文字列が入りうる。
 * `javascript:` などのスキームをそのまま href に置くと、リンクを踏んだだけで
 * スクリプトが動く。**https:// で始まるものだけ**を通す。
 *
 * 通らなかった値は「未設定」と同じ扱いにし、リンクにしない。
 */

/** 安全なら元の文字列、そうでなければ null */
export function safeHttpsUrl(raw: string | undefined | null): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;

  // @pocket の「未入力」表現
  if (t === "-") return null;

  // 制御文字を含む値は弾く。改行を挟んで別のスキームに見せかける細工を防ぐ
  for (const ch of t) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x20 || cp === 0x7f) return null;
  }

  // スキームの大文字・小文字は問わない（HTTPS:// も正当）
  if (!/^https:\/\//i.test(t)) return null;

  // URL として解釈できないものを href に置かない
  try {
    const url = new URL(t);
    if (url.protocol !== "https:") return null;
  } catch {
    return null;
  }

  return t;
}
