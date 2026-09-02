"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { LiffCard, LiffMenuCard } from "@/components/liff-chrome";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import { type BulletinListResponse } from "@/lib/bulletin-types";
import {
  LIFF_SWR_DASHBOARD_OPTIONS,
  LIFF_SWR_DEFAULT_OPTIONS,
} from "@/lib/liff-swr";
import { barRatio } from "@/lib/sales-dashboard-bar-ratio";
import { filterOpenMeetingScheduleItems } from "@/lib/meeting-schedule-negotiation-status";
import type { MeetingSchedulePayload } from "@/lib/meeting-schedule-types";

type Props = {
  idToken: string | null;
  boundStaffName: string | null;
  /** 掲示板の既読判定用（LINEユーザーID） */
  lineUserId?: string;
  disabled?: boolean;
  /** 名簿と紐付いていない間は導線カードを押させない（ホームの他カードと同条件） */
  needsStaffBind?: boolean;
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

/** PT の桁区切り（営業ランキング画面の formatPt と同じ見せ方） */
function formatSalesPt(n: number): string {
  return new Intl.NumberFormat("ja-JP").format(Math.round(n));
}

/** /api/sales-dashboard?scope=self の応答（自分の1行だけ） */
type SalesRankSelfResponse = {
  rank?: number | null;
  totalCount?: number;
  pt?: number;
  targetPt?: number;
  achievementRate?: number;
  periodLabel?: string;
  needsStaffBind?: boolean;
};

/**
 * 順位の枠。**読み込み中も同じ高さを占める**。
 * ここが伸び縮みすると下のカードが動いて誤タップにつながる。
 */
function SalesRankBadge({
  rank,
  loading,
}: {
  rank: number | null;
  loading: boolean;
}) {
  if (rank == null) {
    return (
      <span
        className={`shrink-0 text-[1.35rem] font-bold leading-none ${
          loading
            ? "animate-pulse text-slate-300 dark:text-slate-600"
            : "text-transparent"
        }`}
        aria-hidden
      >
        —
      </span>
    );
  }
  return (
    <span className="shrink-0 text-[1.35rem] font-bold leading-none text-slate-800 dark:text-slate-100">
      {rank}
      <span className="ml-0.5 text-[13px] font-bold">位</span>
    </span>
  );
}

/** 営業ランキングの導線アイコン（ホームのメニューから移設） */
function SalesDashboardGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * ホーム最上部の掲示板囲い
 * - あいさつ
 * - 営業ランキングの導線（旧・本日のお知らせバナーの位置）
 * - 書類未回収 | 商談進捗（横並びカード）
 */
export function HomeCompactSummaries({
  idToken,
  boundStaffName,
  lineUserId = "",
  disabled = false,
  needsStaffBind = false,
  onClose,
  children,
}: Props) {
  const [hydrated, setHydrated] = useState(false);

  const bulletinPath = idToken && !disabled ? "/api/bulletin" : null;
  const selfRankPath =
    idToken && boundStaffName && !disabled
      ? "/api/sales-dashboard?scope=self"
      : null;
  const meetingPath =
    idToken && boundStaffName && !disabled
      ? "/api/meeting-schedule?scope=list"
      : null;
  const docsPath =
    idToken && boundStaffName && !disabled
      ? "/api/customers?filter=missing_docs"
      : null;

  /**
   * 「本日のお知らせ」のバナーは消したが、**取得は残してある**。
   *
   * 戻すときに配線をやり直さずに済むようにするため。今は読み込み完了の
   * 判定（下の loading）にだけ使っている。バナーを復活させるなら、
   * ここの posts から当日ぶんと未読数を組み立て直す。
   */
  const { data: bulletinData, isLoading: bulletinLoading } =
    useLiffSwr<BulletinListResponse>(bulletinPath, idToken, LIFF_SWR_DEFAULT_OPTIONS);

  /**
   * 営業ランキングの自分の1行だけ（scope=self）。
   *
   * 全量にはランキング全行とPT明細が入っていて、順位を出すだけのホームには
   * 重い。集計は営業ランキング画面と同じ30分キャッシュに相乗りするので、
   * @pocket への往復はここでは増えない。
   */
  const { data: selfSummary, isLoading: selfSummaryLoading } =
    useLiffSwr<SalesRankSelfResponse>(
      selfRankPath,
      idToken,
      LIFF_SWR_DASHBOARD_OPTIONS,
    );

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
    () => filterOpenMeetingScheduleItems(meetingData?.items ?? []),
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

  /**
   * 自分の順位まわり。**取れないときは順位の行を出さないだけ**にする。
   * ランキングに自分が居ない（rank が null）・目標未設定のいずれも
   * 異常ではないので、カード自体は必ず出す。
   */
  const selfRank =
    typeof selfSummary?.rank === "number" ? selfSummary.rank : null;
  const selfRankLoading = Boolean(selfRankPath) && selfSummaryLoading;
  const selfPt = selfSummary?.pt ?? 0;
  const selfTargetPt = selfSummary?.targetPt ?? 0;
  const selfRate = selfSummary?.achievementRate ?? 0;
  // 目標未設定（3分の1が該当）では達成率も「あと何PT」も出さない
  const showSelfTarget = selfRank != null && selfTargetPt > 0;

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

        {/* 「本日のお知らせ」のバナーがあった位置。導線はホームのここに集約する */}
        {/*
          description は省略し、代わりに自分の順位と達成率を添える。
          **取得できなくてもカードは必ず出す**（ホームの主要な導線なので、
          ランキングの取得失敗で押せなくなるのは避ける）。
        */}
        <LiffMenuCard
          href="/sales-dashboard"
          title="営業ランキング"
          icon={<SalesDashboardGlyph />}
          iconTone="blue"
          disabled={needsStaffBind}
          trailing={<SalesRankBadge rank={selfRank} loading={selfRankLoading} />}
        >
          {selfRank != null ? (
            <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
              {selfSummary?.periodLabel?.trim() ? `${selfSummary.periodLabel}・` : ""}
              全{selfSummary?.totalCount ?? 0}人中
            </p>
          ) : null}
          {showSelfTarget ? (
            <>
              <div
                className="mt-1.5 h-1 rounded-full bg-slate-200 dark:bg-slate-700/60"
                aria-hidden
              >
                <div
                  className="h-1 rounded-full bg-emerald-500 dark:bg-emerald-400"
                  style={{ width: `${barRatio(selfPt, selfTargetPt)}%` }}
                />
              </div>
              <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
                目標まであと {formatSalesPt(Math.max(0, selfTargetPt - selfPt))} PT
                （{Math.round(selfRate)}%）
              </p>
            </>
          ) : null}
        </LiffMenuCard>

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
