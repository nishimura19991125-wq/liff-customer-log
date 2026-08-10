"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

import { formatCustomerInfoDraftSavedAt } from "@/lib/customer-info-draft";

/**
 * 入力途中の内容が残っているときの確認（タスクJ-2）。
 *
 * 自動では復元しない。いつの入力かが分からないと判断できないため、
 * 退避した日時を必ず出す。
 *
 * 退避してから開き直すまでの間に、他の人が @pocket 側を更新している
 * ことがある（顧客データは全社員が編集できる）。その場合は上書きの
 * おそれを明示するが、復元を禁止はしない（J-3）。
 *
 * 二択のどちらかを必ず選んでもらうため、背景タップと Esc では閉じない。
 * 曖昧に閉じると、退避データを残したまま入力を始めて上書きしてしまう。
 */
export function CustomerInfoDraftPrompt({
  savedAt,
  stale,
  onRestore,
  onDiscard,
}: {
  /** 退避した時刻（epoch ミリ秒） */
  savedAt: number;
  /** 退避したときと @pocket 側のレコードが変わっているか */
  stale: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLButtonElement>(null);
  const discardRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    // 開く前にフォーカスしていた要素へ、閉じたときに戻す
    const previous = document.activeElement as HTMLElement | null;
    restoreRef.current?.focus();
    return () => {
      previous?.focus?.();
    };
  }, []);

  /** ダイアログの外へフォーカスが出ないようにする（Tab の巡回） */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const first = restoreRef.current;
    const last = discardRef.current;
    if (!first || !last) return;
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  // このダイアログはクライアント側でレコードを読み込んだ後にしか出ないが、
  // ポータル先が無い環境（プリレンダ）では何も描かない
  if (typeof document === "undefined") return null;

  const savedAtLabel = formatCustomerInfoDraftSavedAt(savedAt);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-6">
      <div
        ref={containerRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={handleKeyDown}
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-800"
      >
        <p
          id={titleId}
          className="text-[15px] font-bold leading-relaxed text-slate-900 dark:text-white"
        >
          前回入力途中の内容が残っています
          {savedAtLabel ? `（${savedAtLabel}）` : ""}
        </p>

        <div id={descId} className="mt-2">
          {stale ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-bold leading-relaxed text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              ただし、この間に他の方がデータを更新した可能性があります。
              復元すると、その変更を上書きするおそれがあります。
            </p>
          ) : (
            <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
              復元すると、入力途中の内容が画面に戻ります。@pocket
              への反映は保存ボタンを押したときです。
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <button
            ref={restoreRef}
            type="button"
            onClick={onRestore}
            className="w-full rounded-xl bg-emerald-600 py-3 text-[15px] font-bold text-white transition active:scale-[0.98] dark:bg-emerald-500"
          >
            復元する
          </button>
          <button
            ref={discardRef}
            type="button"
            onClick={onDiscard}
            className="w-full rounded-xl border border-slate-300 py-3 text-[15px] font-semibold text-slate-700 transition active:scale-[0.98] dark:border-slate-600 dark:text-slate-200"
          >
            破棄する
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
