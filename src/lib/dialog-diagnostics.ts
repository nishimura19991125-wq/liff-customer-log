/**
 * 確認ダイアログの診断モード。**既定は無効。**
 *
 * ── なぜ要るか ──────────────────────────────────────────────
 * 実機（iPhone / LIFF）でダイアログのボタンが反応しない。手元で再現できず、
 * コードだけでは「タップが届いていないのか、届いているのに処理が走らないのか」
 * が分からない。3度直して3度とも外したので、推測をやめて測る。
 *
 * ── 有効にする方法は2つ ─────────────────────────────────────
 *   1. URL に ?dialogDebug=1 を足す（**再デプロイが要らない**）
 *   2. NEXT_PUBLIC_CALENDAR_DIALOG_DIAGNOSTICS=1 を設定する
 *
 * ⚠ 環境変数は NEXT_PUBLIC_ が要る。確認ダイアログはクライアント側で
 *    動くので、それ以外の名前だと値が届かず、いつまでも無効のままになる。
 *
 * ── 誤って本番で有効にならないこと ──────────────────────────
 * 判定はホワイトリスト。"1" / "true" / "on" のいずれかに完全一致した
 * ときだけ有効で、それ以外（空文字・"0"・"false"・別の値・未設定）は
 * すべて無効。URL に別のパラメータが混ざっても反応しない。
 */

/** URL に足すパラメータ名 */
export const DIALOG_DIAGNOSTICS_PARAM = "dialogDebug";

/** 背後のスクロールロックを切るパラメータ名（検証3用） */
export const DIALOG_NO_SCROLL_LOCK_PARAM = "dialogNoScrollLock";

/** 有効とみなす値。ここに無い値はすべて無効 */
const TRUTHY = new Set(["1", "true", "on"]);

function flagIsOn(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}

/**
 * 診断モードが有効か。
 *
 * @param search location.search（"?dialogDebug=1" の形）。無ければ空文字
 * @param envValue NEXT_PUBLIC_CALENDAR_DIALOG_DIAGNOSTICS の値
 */
export function dialogDiagnosticsEnabled(input: {
  search?: string;
  envValue?: string;
}): boolean {
  if (flagIsOn(input.envValue)) return true;
  return flagIsOn(readParam(input.search, DIALOG_DIAGNOSTICS_PARAM));
}

/**
 * 背後のスクロールロックを止めるか（検証3）。
 *
 * ⚠ **診断モードが有効なときだけ効く。** これ単独で本番の動作を
 *    変えられると、URL を1つ配るだけでロックが外れてしまう。
 */
export function dialogScrollLockDisabled(input: {
  search?: string;
  envValue?: string;
}): boolean {
  if (!dialogDiagnosticsEnabled(input)) return false;
  return flagIsOn(readParam(input.search, DIALOG_NO_SCROLL_LOCK_PARAM));
}

/**
 * クエリ文字列から1つ読む。URLSearchParams を使わないのは、
 * 実行環境（node のテスト）を問わず同じ結果にするため。
 */
function readParam(search: string | undefined, name: string): string | null {
  const raw = search?.trim();
  if (!raw) return null;
  const qs = raw.startsWith("?") ? raw.slice(1) : raw;
  for (const part of qs.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const key = eq < 0 ? part : part.slice(0, eq);
    if (decodeURIComponent(key) !== name) continue;
    return eq < 0 ? "" : decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

/** タップがどこまで届いたかの数え上げ */
export type DialogTapProbe = {
  /** 覆い（画面全体） */
  overlay: number;
  /** ダイアログ本体 */
  panel: number;
  /** 実行ボタンの pointerdown */
  confirmDown: number;
  /** 実行ボタンの click */
  confirmClick: number;
  /** キャンセルボタンの pointerdown */
  cancelDown: number;
  /** キャンセルボタンの click */
  cancelClick: number;
};

export const EMPTY_DIALOG_TAP_PROBE: DialogTapProbe = {
  overlay: 0,
  panel: 0,
  confirmDown: 0,
  confirmClick: 0,
  cancelDown: 0,
  cancelClick: 0,
};

/**
 * 数え上げから、どの層で止まっているかを一言で返す。
 * 実機の人が数字を読み解かなくて済むようにする。
 */
export function describeDialogTapProbe(probe: DialogTapProbe): string {
  if (probe.overlay === 0 && probe.panel === 0) {
    return "タップがダイアログに届いていません";
  }
  if (probe.panel === 0) {
    return "覆いで止まっています（本体が前面にありません）";
  }
  if (probe.confirmDown === 0 && probe.cancelDown === 0) {
    return "本体までは届きますが、ボタンに当たっていません";
  }
  if (probe.confirmDown > 0 && probe.confirmClick === 0) {
    return "実行ボタンに触れていますが click になっていません";
  }
  if (probe.cancelDown > 0 && probe.cancelClick === 0) {
    return "取消ボタンに触れていますが click になっていません";
  }
  return "click まで届いています（原因は onClick より後ろ）";
}

/**
 * handleMove がどこまで進んだかの記録（診断モードのときだけ溜める）。
 *
 * click までは届いていることが分かったので、次に要るのは
 * **中のどこで止まったか**。段階ごとに1行残し、最後の行が到達点になる。
 *
 * 例
 *   1 開始 → 2 判定OK → 3 送信中 → 4 トークン取得中
 *   （ここで止まっていれば LIFF の init / getIDToken が返ってきていない）
 */
export const DIALOG_TRACE_MAX = 12;

/** 溜めすぎないよう、古いものから捨てる */
export function appendDialogTrace(
  prev: readonly string[],
  line: string,
): string[] {
  const next = [...prev, `${prev.length + 1}. ${line}`];
  return next.length > DIALOG_TRACE_MAX
    ? next.slice(next.length - DIALOG_TRACE_MAX)
    : next;
}

/** 例外を1行に潰す。握り潰さず、必ず読める形にする */
export function dialogTraceErrorText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}
