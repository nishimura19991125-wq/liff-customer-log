"use client";

import { useEffect, useRef } from "react";

import {
  DIALOG_BODY_CLASS,
  DIALOG_FOOTER_CLASS,
  DIALOG_BACKDROP_CLASS,
  DIALOG_VIEWPORT_CENTERED_CLASS,
  DIALOG_PANEL_CLASS,
} from "@/lib/dialog-shell";

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

  if (!open) return null;

  /**
   * 覆い（backdrop）と位置決め（viewport）を分けてある。
   * 覆いは inset: 0 だけで高さが決まるので潰れず、必ず背後を守る。
   */
  return (
    <div className={DIALOG_BACKDROP_CLASS}>
      {/* 位置決め。高さ（dvh）はここが持つ */}
      <div className={DIALOG_VIEWPORT_CENTERED_CLASS}>
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="meeting-negotiation-confirm-title"
          aria-describedby="meeting-negotiation-confirm-body"
          className={`${DIALOG_PANEL_CLASS} bg-white shadow-xl dark:bg-slate-900`}
        >
          {/* 中身。ここだけスクロールする */}
          <div className={DIALOG_BODY_CLASS}>
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
          </div>

          {/* 操作。中身がどれだけ長くても必ず見える位置に残す */}
          <div
            className={`${DIALOG_FOOTER_CLASS} flex gap-2 dark:border-slate-800`}
          >
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
      </div>
    </div>
  );
}
