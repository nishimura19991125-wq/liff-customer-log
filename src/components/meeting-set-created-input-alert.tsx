"use client";

import Link from "next/link";

import type { MeetingScheduleItem } from "@/lib/meeting-schedule-types";

type Props = {
  items: MeetingScheduleItem[];
  dateLabel: string;
  onClose: () => void;
  zIndexClass?: string;
};

export function MeetingSetCreatedInputAlert({
  items,
  dateLabel,
  onClose,
  zIndexClass = "z-[120]",
}: Props) {
  return (
    <div
      className={`fixed inset-0 ${zIndexClass} flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="meeting-set-created-alert-title"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border-2 border-sky-200 bg-white shadow-2xl dark:border-sky-800 dark:bg-slate-900">
        <div className="border-b border-sky-100 bg-sky-50 px-4 py-4 text-center dark:border-sky-900 dark:bg-sky-950/50">
          <p
            id="meeting-set-created-alert-title"
            className="text-[18px] font-bold text-sky-900 dark:text-sky-100"
          >
            入力してください
          </p>
          <p className="mt-1 text-[13px] text-sky-800/80 dark:text-sky-200/80">
            {dateLabel}の商談（商談セット作成済み）
          </p>
        </div>

        <div className="px-4 py-4">
          <p className="text-[14px] leading-relaxed text-slate-700 dark:text-slate-200">
            前日の商談で「商談セット作成済み」になっている案件があります。初回商談実施日・片クロor両クロ・商談場所を商談進捗情報から入力してください。
          </p>
          <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto">
            {items.map((item) => (
              <li
                key={item.recordId}
                className="rounded-xl bg-sky-50/80 px-3 py-2.5 dark:bg-sky-950/30"
              >
                <p className="text-[14px] font-semibold text-slate-900 dark:text-white">
                  {item.customerName}
                </p>
                <p className="mt-0.5 text-[12px] text-slate-600 dark:text-slate-400">
                  {[item.scheduledTime || item.meetingTime, item.city]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-4 dark:border-slate-800">
          <Link
            href="/meeting-schedule"
            onClick={onClose}
            className="w-full rounded-xl bg-sky-600 py-3 text-center text-[15px] font-bold text-white shadow-md transition-colors active:bg-sky-700 dark:bg-sky-500 dark:active:bg-sky-600"
          >
            商談進捗情報で入力
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl border border-slate-200 py-3 text-[14px] font-semibold text-slate-700 transition-colors active:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:active:bg-slate-800"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
