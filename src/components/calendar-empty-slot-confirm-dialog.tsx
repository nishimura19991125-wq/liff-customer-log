"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  DIALOG_BODY_CLASS,
  DIALOG_FOOTER_CLASS,
  DIALOG_OVERLAY_CLASS,
  DIALOG_PANEL_CLASS,
} from "@/lib/dialog-shell";

/**
 * 同じ日・同じ施工会社の空き枠が見つかったときの確認（タスクS-2）。
 *
 * 空き枠の削除は不可逆なので、既定の動作にはしない。3択で明示的に選ばせる。
 * どの空き枠を選んだか（レコードID）は表示しない。同条件の枠は
 * レコードIDとT番号しか違わず、利用者に選ぶ材料がないため。
 *
 * Esc はキャンセル扱い。誤って登録されないようにする。
 */

/** 44px 四方のタップ領域を確保する共通クラス */
const DIALOG_BUTTON_CLASS =
  "w-full min-h-[48px] rounded-xl px-4 py-3 text-[14px] font-bold shadow-sm transition active:scale-[0.99] disabled:opacity-50";

/** YYYY-MM-DD → 9月5日。解釈できない値はそのまま返す */
export function formatMonthDayLabel(dayKey: string): string {
  const m = dayKey.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dayKey.trim();
  return `${Number(m[2])}月${Number(m[3])}日`;
}

export function CalendarEmptySlotConfirmDialog({
  open,
  dayKey,
  contractorName,
  busy,
  onUseSlot,
  onSkipSlot,
  onCancel,
}: {
  open: boolean;
  dayKey: string;
  contractorName: string;
  /** 送信中は3択を押せなくする */
  busy: boolean;
  onUseSlot: () => void;
  onSkipSlot: () => void;
  onCancel: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const firstButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // 開いたらダイアログ内へ、閉じたら元の要素へフォーカスを戻す
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    firstButtonRef.current?.focus();
    const restoreTo = restoreFocusRef.current;
    return () => {
      restoreTo?.focus?.();
    };
  }, [open]);

  // Esc はキャンセル。送信中は閉じない
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (!busy) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onCancel]);

  /** ダイアログの外へフォーカスが出ないようにする（簡易トラップ） */
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

  if (!open) return null;

  return (
    <div className={DIALOG_OVERLAY_CLASS}>
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="calendar-empty-slot-confirm-title"
        className={`${DIALOG_PANEL_CLASS} bg-white shadow-xl ring-1 ring-slate-200`}
        onKeyDown={onPanelKeyDown}
      >
        {/* 中身。ここだけスクロールする */}
        <div className={DIALOG_BODY_CLASS}>
          <p
            id="calendar-empty-slot-confirm-title"
            className="text-[15px] font-bold leading-relaxed text-slate-900"
          >
            {formatMonthDayLabel(dayKey)}に「{contractorName}」の空き枠があります。
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-slate-600">
            この空き枠を使うと、案件にこの日付を設定したうえで空き枠が削除されます。
            使わない場合は案件に日付を設定するだけで、空き枠はそのまま残ります。
          </p>
        </div>

        {/* 操作。中身がどれだけ長くても必ず見える位置に残す */}
        <div className={`${DIALOG_FOOTER_CLASS} flex flex-col gap-2`}>
          <button
            ref={firstButtonRef}
            type="button"
            className={`${DIALOG_BUTTON_CLASS} bg-[#06C755] text-white`}
            disabled={busy}
            onClick={onUseSlot}
          >
            この空き枠を使う
          </button>
          <button
            type="button"
            className={`${DIALOG_BUTTON_CLASS} bg-slate-800 text-white`}
            disabled={busy}
            onClick={onSkipSlot}
          >
            空き枠を使わずに登録する
          </button>
          <button
            type="button"
            className={`${DIALOG_BUTTON_CLASS} border border-slate-300 bg-white text-slate-700`}
            disabled={busy}
            onClick={onCancel}
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
