"use client";

import Link from "next/link";

import { LiffCard } from "@/components/liff-chrome";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import { LIFF_SWR_DEFAULT_OPTIONS } from "@/lib/liff-swr";
import type { MeetingSchedulePayload } from "@/lib/meeting-schedule-types";

type Props = {
  idToken: string | null;
  boundStaffName: string | null;
  disabled?: boolean;
};

export function HomeMeetingScheduleSummary({
  idToken,
  boundStaffName,
  disabled = false,
}: Props) {
  const swrPath =
    idToken && boundStaffName && !disabled
      ? "/api/meeting-schedule?scope=list"
      : null;

  const { data, isLoading } = useLiffSwr<
    MeetingSchedulePayload & { needsStaffBind?: boolean; disabled?: boolean }
  >(swrPath, idToken, LIFF_SWR_DEFAULT_OPTIONS);

  if (!boundStaffName || disabled) return null;
  if (isLoading && !data) {
    return (
      <section className="mb-4" aria-label="商談進捗情報（読み込み中）">
        <LiffCard>
          <div className="px-4 py-4">
            <p className="text-[14px] text-slate-500 dark:text-slate-400">
              商談進捗情報を読み込み中…
            </p>
          </div>
        </LiffCard>
      </section>
    );
  }
  if (!data?.configured || data.error) return null;

  const items = data.items ?? [];

  return (
    <section className="mb-4" aria-label="商談進捗情報一覧">
      <LiffCard>
        <div className="px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[15px] font-bold text-slate-900 dark:text-white">
                商談進捗情報
              </p>
              <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">
                全 {items.length} 件
              </p>
            </div>
            <Link
              href="/meeting-schedule"
              className="shrink-0 rounded-lg px-2 py-1 text-[13px] font-semibold text-sky-700 active:bg-sky-50 dark:text-sky-300 dark:active:bg-sky-950/40"
            >
              詳細 ›
            </Link>
          </div>

          {items.length === 0 ? (
            <p className="mt-3 text-[14px] text-slate-600 dark:text-slate-300">
              商談進捗情報はありません
            </p>
          ) : (
            <ul className="mt-3 flex max-h-[min(60vh,28rem)] flex-col gap-2 overflow-y-auto">
              {items.map((item, i) => (
                <li
                  key={`${item.recordId}-${item.customerName}-${item.meetingTime}-${i}`}
                  className="flex items-start gap-3 rounded-xl bg-sky-50/80 px-3 py-2.5 dark:bg-sky-950/25"
                >
                  <div className="w-16 shrink-0 pt-0.5 text-center">
                    <p className="text-[10px] font-medium leading-tight text-sky-700 dark:text-sky-300">
                      {item.scheduledDateLabel}
                    </p>
                    <p className="mt-0.5 text-[13px] font-bold tabular-nums text-sky-900 dark:text-sky-100">
                      {item.scheduledTime || item.meetingTime}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold leading-snug text-slate-900 dark:text-white">
                      {item.customerName}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {item.city ? (
                        <span className="rounded-md bg-white/80 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
                          {item.city}
                        </span>
                      ) : null}
                      {item.estimateStatus ? (
                        <span className="rounded-md bg-white/80 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
                          {item.estimateStatus}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </LiffCard>
    </section>
  );
}
