/**
 * 確認ダイアログの**枠だけ**を揃えるクラス定義。
 *
 * ── 直したこと ──────────────────────────────────────────────
 * 実機（iPhone / LIFF）で2つ続けて事故が起きた。どちらも「高さ」が原因。
 *
 *   1回目  下部が画面外に出てボタンに届かない
 *          iOS の 100vh は URL バーを畳んだ高さで、見えている領域より
 *          大きい。position: fixed; inset: 0 もこれに従う
 *
 *   2回目  ダイアログがタップを受け取らず、背後のパネルが反応する
 *          1回目の対処で土台の高さを
 *            height: 100vh; height: 100dvh;
 *          と2行で書いたが、**ミニファイアが前の行を捨てた**。dvh を
 *          知らない環境では height が丸ごと消え、top だけ指定した土台が
 *          中身ぶんの高さに潰れて、画面の大半が覆われなくなった
 *
 * ── 今の作り ────────────────────────────────────────────────
 * 覆いと位置決めを**別の層に分ける**。
 *
 *   backdrop  position: fixed; inset: 0
 *             高さを計算に頼らない。常に画面全部を覆い、タップを止める
 *   viewport  高さ（dvh）を持ち、ダイアログを下／中央へ寄せる
 *   panel     中身と操作を縦に分ける器
 *   body      ここだけスクロールする
 *   footer    スクロールの外。常に見える位置に残る
 *
 * 高さが解けなかったときの最悪でも「ボタンに届かない」で、
 * **タップが背後へ抜けることは起きない**。inset: 0 は計算不要で潰れない。
 *
 * ⚠ ここにあるのは**枠のクラスだけ**。フォーカストラップ・Esc の扱い・
 *    role / aria 属性は各ダイアログが持っている。
 */

/**
 * 覆い。**タップを背後へ通さない層。**
 *
 * ⚠ ここに高さのクラスを足さないこと。inset: 0 で上下左右が決まるので
 *    計算が要らず、dvh が使えない環境でも潰れない。この層が背後を守る。
 */
export const DIALOG_BACKDROP_CLASS = "fixed inset-0 z-50 bg-slate-900/50";

/**
 * 位置決め。スマホでは下から出し、広い画面では中央に置く。
 * 高さは globals.css の .liff-dialog-viewport（100% → dvh）。
 */
export const DIALOG_VIEWPORT_CLASS =
  "liff-dialog-viewport flex items-end justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6 sm:items-center";

/** 位置決め（常に中央）。下から出す形にしていないダイアログ用 */
export const DIALOG_VIEWPORT_CENTERED_CLASS =
  "liff-dialog-viewport flex items-center justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6";

/**
 * ダイアログ本体。**見た目（背景・影・枠線）は各ダイアログが足す。**
 * ここで決めるのは「中身と操作を縦に分け、土台からはみ出さない」ことだけ。
 * 高さの上限は globals.css の .liff-dialog-panel（100% → 85dvh）。
 */
export const DIALOG_PANEL_CLASS =
  "liff-dialog-panel flex w-full max-w-sm flex-col overflow-hidden rounded-2xl";

/**
 * 中身。**ここだけがスクロールする。**
 *
 * min-h-0 が要る。flex の子は既定で min-height:auto になり、中身のぶんだけ
 * 伸びて overflow-y-auto が効かない（縮まないので溢れない）。
 * overscroll-contain は、端まで送ったスクロールが背後のページへ
 * 流れるのを止める。
 */
export const DIALOG_BODY_CLASS =
  "min-h-0 flex-1 overflow-y-auto overscroll-contain p-4";

/**
 * 操作。**スクロールの外に置き、常に見える位置に残す。**
 *
 * shrink-0 が無いと、中身が長いときにボタン側が潰される。
 * relative z-10 は、スクロールする中身がボタンの上へ重なって
 * 「押しても反応しない」状態を作らないための保険。
 */
export const DIALOG_FOOTER_CLASS =
  "relative z-10 shrink-0 border-t border-slate-100 px-4 pb-4 pt-3";
