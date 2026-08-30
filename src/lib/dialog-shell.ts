/**
 * 確認ダイアログの**枠だけ**を揃えるクラス定義。
 *
 * ── なぜ切り出したか ────────────────────────────────────────
 * 実機（iPhone / LIFF）で、工事日の移動の確認ダイアログの下部が画面外に
 * 出て、実行ボタンにもキャンセルボタンにも届かなくなった。中身が増えた
 * （移動元の扱いのラジオ2つ・実行される内容の箇条書き・警告）ことが
 * きっかけだが、**原因は高さの取り方**にあり、同じ書き方をしている
 * ダイアログすべてが同じ地雷を踏む。
 *
 * ── iOS の vh は「見えている高さ」ではない ──────────────────
 * iOS Safari（LIFF の WKWebView も同じ）の 100vh は URL バーやツールバーを
 * 畳んだときの高さで、実際に見えている領域より**大きい**。
 * `position: fixed; inset: 0` もこの高さに従うため、
 *
 *   1. 下敷き（overlay）の下端が画面の外へ出る
 *   2. items-end で下寄せしたダイアログは、その画面外の下端に貼りつく
 *   3. 中身が max-h-[85vh] に収まっていると overflow-y-auto は働かない
 *      （スクロールするものが無い）
 *   4. 背後のページも fixed の下敷きに覆われて動かせない
 *
 * ＝ ボタンがどこにも出てこない。実機の症状はこれで説明がつく。
 *
 * dvh（dynamic viewport height）は見えている高さに追従するので、
 * 土台の高さを dvh で取る。dvh を知らない古い環境のために vh も併記して
 * あり、その指定は globals.css の .liff-dialog-viewport にある
 * （Tailwind のクラスでは2段のフォールバックを書けないため）。
 *
 * ── 中身をスクロールさせ、ボタンは固定する ──────────────────
 * 高さを直しても、中身が長ければいずれ収まらなくなる。ダイアログを
 * 縦の2段（中身／操作）に分け、**中身だけをスクロールさせて操作は残す**。
 * 中身をどれだけ足しても、ボタンには必ず届く。
 *
 * ⚠ ここにあるのは**枠のクラスだけ**。フォーカストラップ・Esc の扱い・
 *    role / aria 属性は各ダイアログが持っている。動きを共通化すると
 *    ボタンの数も初期フォーカス先も違う4つを1つに寄せることになり、
 *    緊急の修正としては risk が見合わない。
 */

/** 土台の高さ（globals.css）。iOS の vh を避けるため dvh で取る */
const VIEWPORT = "liff-dialog-viewport";

/**
 * 画面を覆う下敷き。スマホでは下から出し、広い画面では中央に置く。
 *
 * inset-0 ではなく inset-x-0 top-0 ＋ 高さクラスにしてある。
 * inset-0 だと下端が iOS の vh に従ってしまい、この修正の意味が無くなる。
 */
export const DIALOG_OVERLAY_CLASS =
  `${VIEWPORT} fixed inset-x-0 top-0 z-50 flex items-end justify-center bg-slate-900/50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6 sm:items-center`;

/** 下敷き（常に中央）。下から出す形にしていないダイアログ用 */
export const DIALOG_OVERLAY_CENTERED_CLASS =
  `${VIEWPORT} fixed inset-x-0 top-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6`;

/**
 * ダイアログ本体。**見た目（背景・影・枠線）は各ダイアログが足す。**
 * ここで決めるのは「中身と操作を縦に分け、下敷きからはみ出さない」ことだけ。
 *
 * 高さの上限は globals.css の .liff-dialog-panel（85vh → 85dvh）で決める。
 * max-h-full（＝ max-height: 100%）は土台の高さが確定していないと解けず、
 * 解けないと上限が無くなって操作が画面外へ出る。% に頼らない。
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
 * relative z-10 は、スクロールする中身が何かの拍子にボタンの上へ
 * 重なって**押しても反応しない**状態を作らないための保険。
 * 見た目は変わらないが、重なり順は必ずこちらが上になる。
 */
export const DIALOG_FOOTER_CLASS =
  "relative z-10 shrink-0 border-t border-slate-100 px-4 pb-4 pt-3";
