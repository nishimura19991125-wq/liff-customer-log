"use client";

/**
 * クリップボードへの書き込み（LIFF WebView 向け）。
 *
 * 元は construction-request-copy-panel.tsx にあったもの。施工会社向けの
 * 一行サマリ（タスクU）でも同じ扱いが要るので切り出した。中身は変えていない。
 *
 * LIFF は WebView 上で動き、navigator.clipboard が無い / 権限が無い環境がある。
 * 失敗したら false を返し、呼び出し側が手動選択用のテキストエリアへ切り替える。
 */
export async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 権限拒否・非セキュアコンテキストなど。フォールバックへ落とす
  }
  return false;
}
