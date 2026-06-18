"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { snoozeMeetingScheduleAlertForSession } from "@/lib/meeting-schedule-pending-set-created-client";
import type { MeetingScheduleAlertItem } from "@/lib/meeting-schedule-types";

type Props = {
  items: MeetingScheduleAlertItem[];
  onClose: () => void;
  zIndexClass?: string;
};

function alertKindLabel(kind: MeetingScheduleAlertItem["alertKind"]): string {
  return kind === "set-created" ? "商談セット作成済み" : "返待ち";
}

function alertItemDetail(item: MeetingScheduleAlertItem): string {
  if (item.alertKind === "henmachi") {
    return [
      item.responseDateLabel,
      item.scheduledDateLabel,
      item.scheduledTime || item.meetingTime,
      item.city,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return [
    item.scheduledDateLabel,
    item.scheduledTime || item.meetingTime,
    item.city,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function MeetingSetCreatedInputAlert({
  items,
  onClose,
  zIndexClass = "z-[130]",
}: Props) {
  const [mounted, setMounted] = useState(false);

  const summary = useMemo(() => {
    const setCreatedCount = items.filter(
      (item) => item.alertKind === "set-created",
    ).length;
    const henmachiCount = items.filter(
      (item) => item.alertKind === "henmachi",
    ).length;
    const parts: string[] = [];
    if (setCreatedCount > 0) {
      parts.push(`商談セット作成済み ${setCreatedCount}件`);
    }
    if (henmachiCount > 0) {
      parts.push(`返待ち ${henmachiCount}件`);
    }
    return parts.join(" · ");
  }, [items]);

  useEffect(() => {
    setMounted(true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${zIndexClass} flex min-h-dvh flex-col bg-sky-50 text-slate-800 dark:bg-slate-900 dark:text-slate-100`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="meeting-set-created-alert-title"
    >
      <div className="shrink-0 border-b border-sky-200 bg-sky-100 px-4 py-5 text-center pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-sky-800 dark:bg-sky-950/60">
        <p
          id="meeting-set-created-alert-title"
          className="text-[20px] font-bold text-sky-900 dark:text-sky-100"
        >
          入力してください
        </p>
        <p className="mt-1 text-[14px] text-sky-800/80 dark:text-sky-200/80">
          {summary}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
          対応が必要な商談進捗があります。商談進捗情報から入力・更新してください。
        </p>
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li
              key={item.recordId}
              className="rounded-xl border border-sky-100 bg-white px-3 py-3 shadow-sm dark:border-sky-900 dark:bg-slate-800"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[15px] font-semibold text-slate-900 dark:text-white">
                  {item.customerName}
                </p>
                <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800 dark:bg-sky-950/60 dark:text-sky-200">
                  {alertKindLabel(item.alertKind)}
                </span>
              </div>
              <p className="mt-0.5 text-[13px] text-slate-600 dark:text-slate-400">
                {alertItemDetail(item)}
              </p>
              {item.alertKind === "set-created" ? (
                <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
                  初回商談実施日・片クロor両クロ・商談場所を入力してください
                </p>
              ) : (
                <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
                  返待ち回答日が未設定、または期限を過ぎています
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="shrink-0 flex flex-col gap-2 border-t border-sky-200 bg-sky-50 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-sky-800 dark:bg-slate-900">
        <Link
          href="/meeting-schedule"
          onClick={() => {
            snoozeMeetingScheduleAlertForSession();
            onClose();
          }}
          className="w-full rounded-xl bg-sky-600 py-3.5 text-center text-[16px] font-bold text-white shadow-md transition-colors active:bg-sky-700 dark:bg-sky-500 dark:active:bg-sky-600"
        >
          商談進捗情報で入力
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-xl border border-slate-200 bg-white py-3.5 text-[15px] font-semibold text-slate-700 transition-colors active:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:active:bg-slate-700"
        >
          閉じる
        </button>
      </div>
    </div>,
    document.body,
  );
}
