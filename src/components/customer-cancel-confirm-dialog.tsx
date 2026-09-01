"use client";

import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { useIsClient } from "@/hooks/use-is-client";

import type { CustomerCancelPlan } from "@/lib/customer-cancel-plan";

/**
 * 顧客ステータスを「キャンセル」にするときの確認（タスクV-6）。
 *
 * 消した値は復元できないので、**実際に実行される内容だけ**を並べて
 * 明示的に選ばせる。空き枠を作らない場合はその行を出さない。
 * Esc は「やめる」扱い（誤って実行されないため）。
 */

const DIALOG_BUTTON_CLASS =
  "w-full min-h-[48px] rounded-xl px-4 py-3 text-[14px] font-bold shadow-sm transition active:scale-[0.99] disabled:opacity-50";

/** YYYY-MM-DD → 9月20日。解釈できない値はそのまま返す */
export function formatCancelDialogDate(dayKey: string): string {
  const m = dayKey.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dayKey.trim();
  return `${Number(m[2])}月${Number(m[3])}日`;
}

/** 確認画面に並べる「実行されること」。空き枠は条件を満たすときだけ */
export function buildCancelActionLines(plan: CustomerCancelPlan): string[] {
  const lines = [
    "PT、APPT、CLPT を 0 にします",
    "施工予定日、初回施工予定日、施工会社、工事対応者を消します",
    "工事登録アプリの該当項目も消します",
  ];
  if (plan.createsEmptySlot) {
    lines.push(
      `${formatCancelDialogDate(plan.emptySlotDayKey)}（${plan.emptySlotContractor}）に空き枠を作ります`,
    );
  }
  return lines;
}

export function CustomerCancelConfirmDialog({
  open,
  plan,
  busy,
  onConfirm,
  onDismiss,
}: {
  open: boolean;
  plan: CustomerCancelPlan | null;
  /** 保存中は押せなくする */
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  /** createPortal を使うので、サーバ側では描画しない */
  const isClient = useIsClient();

  const panelRef = useRef<HTMLDivElement | null>(null);
  /** 開いたときに最初に当てるのは「やめる」。誤爆を減らす */
  const dismissButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dismissButtonRef.current?.focus();
    const restoreTo = restoreFocusRef.current;
    return () => {
      restoreTo?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (!busy) onDismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onDismiss]);

  const onPanelKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
      return;
    }
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  if (!open || !plan || !isClient) return null;

  /**
   * ⚠ **document.body 直下へ出す（createPortal）。**
   *    工事日の移動の確認ダイアログで、position: fixed が祖先に
   *    閉じ込められ、見た目と当たり判定が約370px ずれていた（iOS 実測）。
   *    同じ作りなのでこちらも body 直下へ出す。祖先に依存しなくなる。
   */
  return createPortal(
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6 sm:items-center">
        <div
          ref={panelRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="customer-cancel-confirm-title"
          aria-describedby="customer-cancel-confirm-body"
          className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-4 shadow-xl ring-1 ring-slate-200"
          onKeyDown={onPanelKeyDown}
        >
          <p
            id="customer-cancel-confirm-title"
            className="text-[15px] font-bold leading-relaxed text-slate-900"
          >
            顧客ステータスを「キャンセル」にします。
          </p>

          <div id="customer-cancel-confirm-body" className="mt-3">
            <p className="text-[13px] font-bold text-slate-700">
              以下が実行されます。
            </p>
            <ul className="mt-1.5 space-y-1">
              {buildCancelActionLines(plan).map((line) => (
                <li
                  key={line}
                  className="text-[13px] leading-relaxed text-slate-800"
                >
                  ・{line}
                </li>
              ))}
            </ul>

            <p className="mt-3 rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2 text-[13px] font-bold leading-relaxed text-red-800">
              この操作は元に戻せません。
            </p>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              className={`${DIALOG_BUTTON_CLASS} bg-red-600 text-white`}
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? "処理中…" : "キャンセルにする"}
            </button>
            <button
              ref={dismissButtonRef}
              type="button"
              className={`${DIALOG_BUTTON_CLASS} border border-slate-300 bg-white text-slate-700`}
              disabled={busy}
              onClick={onDismiss}
            >
              やめる
            </button>
          </div>
        </div>
      </div>,
    document.body,
  );
}
