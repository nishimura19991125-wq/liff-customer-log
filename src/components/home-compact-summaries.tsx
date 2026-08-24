"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { LiffCard } from "@/components/liff-chrome";
import { useBulletinRead } from "@/hooks/use-bulletin-read";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import {
  bulletinTodayLabelJst,
  isBulletinDateOnOrBefore,
  type BulletinListResponse,
} from "@/lib/bulletin-types";
import { LIFF_SWR_DEFAULT_OPTIONS } from "@/lib/liff-swr";
import { filterMeetingScheduleHomePanelItems } from "@/lib/meeting-schedule-negotiation-status";
import type { MeetingSchedulePayload } from "@/lib/meeting-schedule-types";

type Props = {
  idToken: string | null;
  boundStaffName: string | null;
  /** 掲示板の既読判定用（LINEユーザーID） */
  lineUserId?: string;
  disabled?: boolean;
  /** 掲示板セクション全体を閉じる */
  onClose?: () => void;
  /** 掲示板内の最下部に表示する追加コンテンツ */
  children?: ReactNode;
};

type CustomersApiBody = {
  customers?: Array<{
    recordId: string;
    customerName: string;
    isDocumentMissing?: boolean;
  }>;
};

const PREVIEW_LIMIT = 3;

/**
 * ホーム最上部の掲示板囲い
 * - あいさつ
 * - 本日のお知らせ（上部バナー）
 * - 書類未回収 | 商談進捗（横並びカード）
 */
export function HomeCompactSummaries({
  idToken,
  boundStaffName,
  lineUserId = "",
  disabled = false,
  onClose,
  children,
}: Props) {
  const [hydrated, setHydrated] = useState(false);

  const bulletinPath = idToken && !disabled ? "/api/bulletin" : null;
  const meetingPath =
    idToken && boundStaffName && !disabled
      ? "/api/meeting-schedule?scope=list"
      : null;
  const docsPath =
    idToken && boundStaffName && !disabled
      ? "/api/customers?filter=missing_docs"
      : null;

  const { data: bulletinData, isLoading: bulletinLoading } =
    useLiffSwr<BulletinListResponse>(bulletinPath, idToken, LIFF_SWR_DEFAULT_OPTIONS);

  const { data: meetingData, isLoading: meetingLoading } = useLiffSwr<
    MeetingSchedulePayload & { needsStaffBind?: boolean; disabled?: boolean }
  >(meetingPath, idToken, LIFF_SWR_DEFAULT_OPTIONS);

  const { data: docsData, isLoading: docsLoading } = useLiffSwr<CustomersApiBody>(
    docsPath,
    idToken,
    {
      dedupingInterval: 10 * 60 * 1000,
      focusThrottleInterval: 10 * 60 * 1000,
      revalidateOnFocus: false,
    },
  );

  useEffect(() => {
    setHydrated(true);
  }, []);

  const { isRead } = useBulletinRead(lineUserId);

  const today = bulletinTodayLabelJst();
  const bulletinPosts = bulletinData?.posts ?? [];
  const bulletinItems = useMemo(
    () => bulletinPosts.filter((post) => post.date === today),
    [bulletinPosts, today],
  );
  const bulletinUnreadCount = useMemo(
    () =>
      bulletinPosts.filter(
        (post) =>
          isBulletinDateOnOrBefore(post.date, today) && !isRead(post.id),
      ).length,
    [bulletinPosts, today, isRead],
  );
  const bulletinPreview = bulletinItems.slice(0, PREVIEW_LIMIT);
  const bulletinRest = bulletinItems.length - bulletinPreview.length;

  /**
   * 商談ステータスで絞る。まだ変更の余地がある案件だけを出し、
   * 商談結果が確定済みの案件（即決成約・否・アポキャン等）は載せない。
   *
   * API（/api/meeting-schedule?scope=list）は見積ステータスでしか
   * 絞っていないので、ここで重ねる。同じ API を /meeting-schedule の
   * 一覧ページも使っているため、サーバ側ではなくこちらで絞る。
   * 件数表示もこの絞り込み後の件数になる。
   */
  const meetingItems = useMemo(
    () => filterMeetingScheduleHomePanelItems(meetingData?.items ?? []),
    [meetingData?.items],
  );
  const meetingPreview = meetingItems.slice(0, PREVIEW_LIMIT);
  const meetingRest = meetingItems.length - meetingPreview.length;

  const docsItems = useMemo(
    () =>
      (docsData?.customers ?? []).map((r) => ({
        recordId: r.recordId,
        customerName: r.customerName,
      })),
    [docsData?.customers],
  );
  const docsPreview = docsItems.slice(0, PREVIEW_LIMIT);
  const docsRest = docsItems.length - docsPreview.length;

  const bulletinReady =
    Boolean(bulletinData?.configured) && !bulletinData?.error && !bulletinLoading;
  const meetingReady =
    Boolean(meetingData?.configured) && !meetingData?.error && !meetingLoading;
  const docsReady = !docsLoading && docsItems.length > 0;

  if (disabled) return null;
  if (!hydrated) return null;

  const loading =
    (bulletinLoading && !bulletinData) ||
    (meetingLoading && !meetingData) ||
    (Boolean(docsPath) && docsLoading && !docsData);

  const showMeeting = meetingReady && Boolean(boundStaffName);
  const showDocs = docsReady;

  const greeting = boundStaffName?.trim()
    ? `${boundStaffName.trim()} さん、おつかれさまです`
    : null;

  return (
    <section
      aria-label="掲示板"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:ring-slate-800"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3.5 py-2.5 dark:border-slate-700">
        <p className="text-[14px] font-bold tracking-tight text-slate-900 dark:text-white">
          掲示板
        </p>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-100 active:scale-[0.98] dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="掲示板を閉じる"
          >
            閉じる
          </button>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 px-3.5 py-3">
        {greeting ? (
          <p className="text-[15px] font-semibold text-slate-800 dark:text-white">
            {greeting}
          </p>
        ) : null}

        {loading ? (
          <p className="text-[12px] text-slate-500 dark:text-slate-400">
            読み込み中…
          </p>
        ) : null}

        {/* 上部バナー：本日のお知らせ（旧・書類未回収の位置） */}
        {bulletinReady ? (
          <section
            aria-label="本日のお知らせ"
            className="rounded-xl border border-pink-200/80 bg-pink-50/90 px-3 py-2.5 dark:border-pink-900/50 dark:bg-pink-950/25"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 text-[13px] font-bold text-pink-950 dark:text-pink-100">
                本日のお知らせ
                <span className="ml-1.5 font-normal text-pink-800/80 dark:text-pink-200/80">
                  {bulletinItems.length}件
                </span>
                {bulletinUnreadCount > 0 ? (
                  <span className="ml-1.5 inline-flex items-center rounded-full bg-pink-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white dark:bg-pink-500">
                    未読{bulletinUnreadCount}件
                  </span>
                ) : null}
              </p>
              <Link
                href="/bulletin"
                className="shrink-0 text-[12px] font-semibold text-pink-700 dark:text-pink-300"
              >
                ›
              </Link>
            </div>
            {bulletinItems.length === 0 ? (
              <p className="mt-1 text-[12px] text-pink-900/70 dark:text-pink-200/70">
                なし
              </p>
            ) : (
              <ul className="mt-1.5 flex flex-col gap-1">
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
                      <span className="line-clamp-2 text-[12px] font-medium leading-snug text-pink-950 dark:text-pink-50">
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
                className="mt-1.5 inline-block text-[11px] font-semibold text-pink-700 dark:text-pink-300"
              >
                +{bulletinRest}件
              </Link>
            ) : null}
          </section>
        ) : null}

        {/* 下段：書類未回収 | 商談進捗 */}
        {showDocs || showMeeting ? (
          <div
            className={`grid gap-3 items-stretch ${
              showDocs && showMeeting ? "grid-cols-2" : "grid-cols-1"
            }`}
            aria-label="書類未回収と商談進捗"
          >
            {showDocs ? (
              <section className="min-w-0" aria-label="書類未回収">
                <LiffCard>
                  <div className="relative flex h-full min-h-[4.5rem] flex-col px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-[13px] font-bold text-slate-900 dark:text-white">
                        書類未回収
                        <span className="ml-1.5 font-normal text-slate-500 dark:text-slate-400">
                          {docsItems.length}件
                        </span>
                      </p>
                      <Link
                        href="/customer-list"
                        className="shrink-0 text-[12px] font-semibold text-red-700 dark:text-red-300"
                      >
                        ›
                      </Link>
                    </div>
                    <ul className="mt-1.5 flex flex-1 flex-col gap-1">
                      {docsPreview.map((row) => (
                        <li key={row.recordId} className="min-w-0">
                          <Link
                            href={`/customer-list/${encodeURIComponent(row.recordId)}`}
                            className="block truncate text-[12px] font-medium leading-snug text-red-900 active:opacity-70 dark:text-red-100"
                          >
                            🚨 {row.customerName}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {docsRest > 0 ? (
                      <Link
                        href="/customer-list"
                        className="mt-1.5 text-[11px] font-semibold text-red-700 dark:text-red-300"
                      >
                        +{docsRest}件
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
                      <Link
                        href="/meeting-schedule"
                        className="shrink-0 text-[12px] font-semibold text-sky-700 dark:text-sky-300"
                        aria-label="商談進捗情報一覧へ"
                      >
                        ›
                      </Link>
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
            ) : null}
          </div>
        ) : null}

        {children ? (
          <div className="border-t border-slate-100 pt-3 dark:border-slate-700">
            {children}
          </div>
        ) : null}
      </div>
    </section>
  );
}
