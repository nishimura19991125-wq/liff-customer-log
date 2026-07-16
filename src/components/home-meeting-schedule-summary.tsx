"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { LiffCard } from "@/components/liff-chrome";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import { LIFF_SWR_DEFAULT_OPTIONS } from "@/lib/liff-swr";
import {
  clearMeetingScheduleHomeSessionCollapse,
  isMeetingScheduleHomeCollapsed,
  setMeetingScheduleHomeCollapsed,
} from "@/lib/meeting-schedule-home-collapse";
import type { MeetingSchedulePayload } from "@/lib/meeting-schedule-types";

type Props = {
  idToken: string | null;
  boundStaffName: string | null;
  disabled?: boolean;
};

const HOME_PREVIEW_LIMIT = 5;

export function HomeMeetingScheduleSummary({
  idToken,
  boundStaffName,
  disabled = false,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const swrPath =
    idToken && boundStaffName && !disabled
      ? "/api/meeting-schedule?scope=list"
      : null;

  const { data, isLoading } = useLiffSwr<
    MeetingSchedulePayload & { needsStaffBind?: boolean; disabled?: boolean }
  >(swrPath, idToken, LIFF_SWR_DEFAULT_OPTIONS);

  useEffect(() => {
    setCollapsed(isMeetingScheduleHomeCollapsed());
    setHydrated(true);
    return () => {
      clearMeetingScheduleHomeSessionCollapse();
    };
  }, []);

  const handleCollapse = () => {
    setMeetingScheduleHomeCollapsed();
    setCollapsed(true);
  };

  if (!boundStaffName || disabled) return null;
  if (isLoading && !data) {
    return (
      <section aria-label="商談進捗情報（読み込み中）">
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
  const preview = items.slice(0, HOME_PREVIEW_LIMIT);
  const restCount = items.length - preview.length;

  if (!hydrated) return null;

  if (collapsed && items.length > 0) {
    return (
      <section aria-label="商談進捗情報（折りたたみ中）">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="w-full rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-left text-[14px] font-semibold text-sky-900 shadow-sm transition-colors active:scale-[0.99] dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100"
        >
          商談進捗情報 {items.length} 件（タップで表示）
        </button>
      </section>
    );
  }

  return (
    <section aria-label="商談進捗情報一覧">
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
            <div className="flex shrink-0 flex-col items-end gap-1">
              {items.length > 0 ? (
                <button
                  type="button"
                  onClick={handleCollapse}
                  className="rounded-lg px-2 py-1 text-[12px] font-semibold text-sky-800 underline underline-offset-2 dark:text-sky-200"
                  aria-label="商談進捗情報を折りたたむ"
                >
                  閉じる
                </button>
              ) : null}
              <Link
                href="/meeting-schedule"
                className="rounded-lg px-2 py-1 text-[13px] font-semibold text-sky-700 active:bg-sky-50 dark:text-sky-300 dark:active:bg-sky-950/40"
              >
                一覧 ›
              </Link>
            </div>
          </div>

          {items.length === 0 ? (
            <p className="mt-3 text-[14px] text-slate-600 dark:text-slate-300">
              商談進捗情報はありません
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {preview.map((item, i) => (
                <li
                  key={`${item.recordId}-${item.customerName}-${item.meetingTime}-${i}`}
                  className="flex items-start gap-3 rounded-xl bg-sky-50/80 px-3 py-2.5 dark:bg-sky-950/25"
                >
                  <div className="w-16 shrink-0 pt-0.5 text-center">
                    <p className="text-[10px] font-medium leading-tight text-sky-700 dark:text-sky-300">
                      {item.scheduledDateLabel}
                    </p>
                    <p className="mt-0.5 text-[13px] font-bold tabular-nums text-sky-900 dark:text-sky-100">
                      {item.meetingTime}
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

          {restCount > 0 ? (
            <Link
              href="/meeting-schedule"
              className="mt-3 block text-center text-[13px] font-semibold text-sky-700 underline underline-offset-2 dark:text-sky-300"
            >
              他 {restCount} 件を見る
            </Link>
          ) : null}
        </div>
      </LiffCard>
    </section>
  );
}
