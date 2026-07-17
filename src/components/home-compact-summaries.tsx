"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { LiffCard } from "@/components/liff-chrome";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import {
  bulletinTodayLabelJst,
  type BulletinListResponse,
} from "@/lib/bulletin-types";
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
  /** 掲示場セクション全体を閉じる（親の表示状態を false にする） */
  onClose?: () => void;
};

const PREVIEW_LIMIT = 3;

/** 本日のお知らせ＋商談進捗を横並びのコンパクトカードで表示（掲示場） */
export function HomeCompactSummaries({
  idToken,
  boundStaffName,
  disabled = false,
  onClose,
}: Props) {
  const [meetingCollapsed, setMeetingCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const bulletinPath = idToken && !disabled ? "/api/bulletin" : null;
  const meetingPath =
    idToken && boundStaffName && !disabled
      ? "/api/meeting-schedule?scope=list"
      : null;

  const { data: bulletinData, isLoading: bulletinLoading } =
    useLiffSwr<BulletinListResponse>(bulletinPath, idToken, LIFF_SWR_DEFAULT_OPTIONS);

  const { data: meetingData, isLoading: meetingLoading } = useLiffSwr<
    MeetingSchedulePayload & { needsStaffBind?: boolean; disabled?: boolean }
  >(meetingPath, idToken, LIFF_SWR_DEFAULT_OPTIONS);

  useEffect(() => {
    setMeetingCollapsed(isMeetingScheduleHomeCollapsed());
    setHydrated(true);
    return () => {
      clearMeetingScheduleHomeSessionCollapse();
    };
  }, []);

  const today = bulletinTodayLabelJst();
  const bulletinItems = useMemo(
    () => (bulletinData?.posts ?? []).filter((post) => post.date === today),
    [bulletinData?.posts, today],
  );
  const bulletinPreview = bulletinItems.slice(0, PREVIEW_LIMIT);
  const bulletinRest = bulletinItems.length - bulletinPreview.length;

  const meetingItems = meetingData?.items ?? [];
  const meetingPreview = meetingItems.slice(0, PREVIEW_LIMIT);
  const meetingRest = meetingItems.length - meetingPreview.length;

  const bulletinReady =
    bulletinData?.configured && !bulletinData.error && !bulletinLoading;
  const meetingReady =
    meetingData?.configured && !meetingData.error && !meetingLoading;

  if (disabled) return null;

  const loading = (bulletinLoading && !bulletinData) || (meetingLoading && !meetingData);
  if (loading) {
    return (
      <section aria-label="掲示場（読み込み中）" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <p className="text-[13px] font-bold text-slate-800 dark:text-white">
            掲示場
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3" aria-label="ダッシュボード（読み込み中）">
          <LiffCard>
            <div className="px-3 py-2.5">
              <p className="text-[12px] text-slate-500">読み込み中…</p>
            </div>
          </LiffCard>
          <LiffCard>
            <div className="px-3 py-2.5">
              <p className="text-[12px] text-slate-500">読み込み中…</p>
            </div>
          </LiffCard>
        </div>
      </section>
    );
  }

  if (!bulletinReady && !meetingReady) return null;

  if (!hydrated) return null;

  if (meetingCollapsed && meetingItems.length > 0 && !bulletinReady) {
    return (
      <button
        type="button"
        onClick={() => setMeetingCollapsed(false)}
        className="w-full rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-left text-[13px] font-semibold text-sky-900 shadow-sm transition-colors active:scale-[0.99] dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100"
      >
        商談進捗情報 {meetingItems.length} 件（タップで表示）
      </button>
    );
  }

  const showBulletin = bulletinReady;
  const showMeeting = meetingReady && boundStaffName && !meetingCollapsed;
  const gridCols =
    showBulletin && showMeeting ? "grid-cols-2" : "grid-cols-1";

  if (!showBulletin && !showMeeting) {
    if (meetingCollapsed && meetingItems.length > 0) {
      return (
        <button
          type="button"
          onClick={() => setMeetingCollapsed(false)}
          className="w-full rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-left text-[13px] font-semibold text-sky-900 shadow-sm transition-colors active:scale-[0.99] dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100"
        >
          商談進捗情報 {meetingItems.length} 件（タップで表示）
        </button>
      );
    }
    return null;
  }

  return (
    <section aria-label="掲示場" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <p className="text-[13px] font-bold tracking-tight text-slate-800 dark:text-white">
          掲示場
        </p>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-100 active:scale-[0.98] dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="掲示場を閉じる"
          >
            閉じる
          </button>
        ) : null}
      </div>

      <div
        className={`grid ${gridCols} gap-3 items-stretch`}
        aria-label="本日のお知らせと商談進捗"
      >
        {showBulletin ? (
          <section className="min-w-0" aria-label="本日のお知らせ">
            <LiffCard>
              <div className="flex h-full min-h-[4.5rem] flex-col px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-[13px] font-bold text-slate-900 dark:text-white">
                    本日のお知らせ
                    <span className="ml-1.5 font-normal text-slate-500 dark:text-slate-400">
                      {bulletinItems.length}件
                    </span>
                  </p>
                  <Link
                    href="/bulletin"
                    className="shrink-0 text-[12px] font-semibold text-pink-700 dark:text-pink-300"
                  >
                    ›
                  </Link>
                </div>

                {bulletinItems.length === 0 ? (
                  <p className="mt-1.5 text-[12px] text-slate-500 dark:text-slate-400">
                    なし
                  </p>
                ) : (
                  <ul className="mt-1.5 flex flex-1 flex-col gap-1">
                    {bulletinPreview.map((item) => (
                      <li key={item.id} className="min-w-0">
                        <Link
                          href="/bulletin"
                          className="flex items-start gap-1.5 active:opacity-70"
                        >
                          <span
                            className="mt-1.5 size-1 shrink-0 rounded-full bg-pink-500"
                            aria-hidden
                          />
                          <span className="line-clamp-2 text-[12px] font-medium leading-snug text-slate-800 dark:text-slate-100">
                            {item.title}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}

                {bulletinRest > 0 ? (
                  <Link
                    href="/bulletin"
                    className="mt-1.5 text-[11px] font-semibold text-pink-700 dark:text-pink-300"
                  >
                    +{bulletinRest}件
                  </Link>
                ) : null}
              </div>
            </LiffCard>
          </section>
        ) : null}

        {showMeeting ? (
          <section className="min-w-0" aria-label="商談進捗情報">
            <LiffCard>
              <div className="flex h-full min-h-[4.5rem] flex-col px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-[13px] font-bold text-slate-900 dark:text-white">
                    商談進捗
                    <span className="ml-1.5 font-normal text-slate-500 dark:text-slate-400">
                      {meetingItems.length}件
                    </span>
                  </p>
                  <div className="flex shrink-0 items-center gap-1">
                    {meetingItems.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setMeetingScheduleHomeCollapsed();
                          setMeetingCollapsed(true);
                        }}
                        className="text-[11px] font-semibold text-sky-800 underline underline-offset-2 dark:text-sky-200"
                        aria-label="商談進捗情報を折りたたむ"
                      >
                        閉
                      </button>
                    ) : null}
                    <Link
                      href="/meeting-schedule"
                      className="text-[12px] font-semibold text-sky-700 dark:text-sky-300"
                    >
                      ›
                    </Link>
                  </div>
                </div>

                {meetingItems.length === 0 ? (
                  <p className="mt-1.5 text-[12px] text-slate-500 dark:text-slate-400">
                    なし
                  </p>
                ) : (
                  <ul className="mt-1.5 flex flex-1 flex-col gap-1">
                    {meetingPreview.map((item, i) => (
                      <li
                        key={`${item.recordId}-${item.customerName}-${item.meetingTime}-${i}`}
                        className="min-w-0"
                      >
                        <Link
                          href="/meeting-schedule"
                          className="block active:opacity-70"
                        >
                          <p className="truncate text-[12px] leading-snug text-slate-800 dark:text-slate-100">
                            <span className="font-bold tabular-nums text-sky-800 dark:text-sky-200">
                              {item.meetingTime}
                            </span>
                            <span className="font-medium">
                              {" "}
                              {item.customerName}
                            </span>
                          </p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}

                {meetingRest > 0 ? (
                  <Link
                    href="/meeting-schedule"
                    className="mt-1.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300"
                  >
                    +{meetingRest}件
                  </Link>
                ) : null}
              </div>
            </LiffCard>
          </section>
        ) : meetingCollapsed && meetingItems.length > 0 ? (
          <button
            type="button"
            onClick={() => setMeetingCollapsed(false)}
            className="w-full rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-left text-[13px] font-semibold text-sky-900 shadow-sm transition-colors active:scale-[0.99] dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100"
          >
            商談進捗情報 {meetingItems.length} 件（タップで表示）
          </button>
        ) : null}
      </div>
    </section>
  );
}
