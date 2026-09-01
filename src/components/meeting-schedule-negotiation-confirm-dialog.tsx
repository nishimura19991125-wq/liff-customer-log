"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { useIsClient } from "@/hooks/use-is-client";

/**
 * 商談ステータスを「アラートから消える値」に変更するときの確認。
 *
 * 出すかどうかの判定は needsMeetingScheduleNegotiationConfirm
 * （src/lib/meeting-schedule-negotiation-status.ts）が持つ。
 * ここは見た目と操作だけを受け持つ。
 */

type Props = {
  open: boolean;
  /** 見出し。何を確認するかで変わる */
  title: string;
  /** 本文。組み立ては呼び出し側（buildMeetingScheduleSaveConfirm） */
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * タップ領域は 44px 四方を目安にする。
 * 指で押す画面なので、小さいと隣のボタンを誤爆する
 */
const buttonBase =
  "min-h-[44px] min-w-[44px] flex-1 rounded-xl px-4 py-2.5 text-[14px] font-semibold transition";

export function MeetingScheduleNegotiationConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
}: Props) {
  /** createPortal を使うので、サーバ側では描画しない */
  const isClient = useIsClient();

  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    // Esc はキャンセル扱い。誤操作でそのまま実行されないようにする
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", onKeyDown);

    // 既定の初期フォーカスはキャンセル側に置く
    cancelRef.current?.focus();

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open || !isClient) return null;

  /**
   * ⚠ **document.body 直下へ出す（createPortal）。**
   *    工事日の移動の確認ダイアログで、position: fixed が祖先に
   *    閉じ込められ、見た目と当たり判定が約370px ずれていた（iOS 実測）。
   *    同じ作りなのでこちらも body 直下へ出す。祖先に依存しなくなる。
   */
  return createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="meeting-negotiation-confirm-title"
          aria-describedby="meeting-negotiation-confirm-body"
          className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl dark:bg-slate-900"
        >
          <p
            id="meeting-negotiation-confirm-title"
            className="text-[15px] font-bold text-slate-900 dark:text-white"
          >
            {title}
          </p>
          <p
            id="meeting-negotiation-confirm-body"
            className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-slate-700 dark:text-slate-200"
          >
            {message}
          </p>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              ref={cancelRef}
              onClick={onCancel}
              className={`${buttonBase} bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200`}
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={`${buttonBase} bg-emerald-600 text-white dark:bg-emerald-500`}
            >
              変更して保存
            </button>
          </div>
        </div>
      </div>,
    document.body,
  );
}
