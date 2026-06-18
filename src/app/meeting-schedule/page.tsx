"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  LiffAccountBar,
  LiffCard,
  LiffGhostLink,
  LiffLoadingBlock,
  LiffPageHeader,
  LiffScreen,
  LiffSessionExpiredPanel,
  LiffStaffBindPanel,
  LiffStaffBindingConfigNotice,
} from "@/components/liff-chrome";
import { MeetingScheduleItemCard } from "@/components/meeting-schedule-item-card";
import { ThemeToggle } from "@/components/theme-toggle";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import { initLiffAndGetToken } from "@/lib/liff-session";
import {
  LIFF_SWR_DEFAULT_OPTIONS,
  isLiffSwrSessionExpired,
} from "@/lib/liff-swr";
import type { MeetingScheduleScheduledUpdateInput } from "@/lib/meeting-schedule-scheduled-update";
import type { MeetingScheduleStatusUpdateInput } from "@/lib/meeting-schedule-status-update";
import type {
  MeetingScheduleItem,
  MeetingSchedulePayload,
} from "@/lib/meeting-schedule-types";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

type ViewMode = "list" | "day";

function shiftYmd(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T12:00:00+09:00`);
  d.setDate(d.getDate() + deltaDays);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(d);
}

function todayYmdJst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );
}

function groupItemsByDate(items: MeetingScheduleItem[]) {
  const map = new Map<string, MeetingScheduleItem[]>();
  for (const item of items) {
    const key = item.scheduledYmd || "__undated__";
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }

  return [...map.entries()]
    .map(([key, groupItems]) => ({
      ymd: key === "__undated__" ? "" : key,
      label: groupItems[0]?.scheduledDateLabel ?? "日付未定",
      items: groupItems,
    }))
    .sort((a, b) =>
      (a.ymd || "9999-12-31").localeCompare(b.ymd || "9999-12-31"),
    );
}

export default function MeetingSchedulePage() {
  const [phase, setPhase] = useState<
    "init" | "need-login" | "ready" | "error" | "session-expired"
  >(() => (LIFF_ID ? "init" : "error"));
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    LIFF_ID ? null : "NEXT_PUBLIC_LIFF_ID が設定されていません",
  );
  const [idToken, setIdToken] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [viewDate, setViewDate] = useState(() => todayYmdJst());
  const [updatingRecordId, setUpdatingRecordId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const account = useLiffAccountStrip(idToken, phase === "ready");
  const needsStaffBind =
    account.bindingEnabled &&
    !account.boundStaffName &&
    !account.loading &&
    account.staff.length > 0;

  const canFetch =
    Boolean(idToken) &&
    phase === "ready" &&
    !needsStaffBind &&
    !account.loading &&
    Boolean(account.boundStaffName || !account.bindingEnabled);

  const apiPath = canFetch
    ? viewMode === "list"
      ? "/api/meeting-schedule?scope=list"
      : `/api/meeting-schedule?date=${encodeURIComponent(viewDate)}`
    : null;

  const { data, error: swrError, isLoading, mutate } = useLiffSwr<
    MeetingSchedulePayload & { needsStaffBind?: boolean; disabled?: boolean }
  >(apiPath, idToken, LIFF_SWR_DEFAULT_OPTIONS);

  useEffect(() => {
    if (!LIFF_ID) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await initLiffAndGetToken(LIFF_ID);
        if (cancelled) return;
        if (result.status === "redirecting") {
          setPhase("need-login");
          return;
        }
        setIdToken(result.token);
        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        setErrorMessage("LIFF の初期化に失敗しました");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (swrError && isLiffSwrSessionExpired(swrError)) {
      setPhase("session-expired");
    }
  }, [swrError]);

  const isToday = viewDate === todayYmdJst();
  const itemCount = data?.items?.length ?? 0;
  const groupedItems = useMemo(
    () => (data?.items ? groupItemsByDate(data.items) : []),
    [data?.items],
  );

  const subtitle = useMemo(() => {
    if (viewMode === "list") return `全 ${itemCount} 件`;
    if (!data?.dateLabel) return undefined;
    return `${data.dateLabel} · ${itemCount}件`;
  }, [viewMode, data?.dateLabel, itemCount]);

  const reload = useCallback(() => {
    void mutate();
  }, [mutate]);

  const handleStatusChange = useCallback(
    async (recordId: string, update: MeetingScheduleStatusUpdateInput) => {
      if (!idToken || !update.status.trim()) return;
      setUpdatingRecordId(recordId);
      setFeedback(null);
      try {
        const res = await fetch(
          `/api/meeting-schedule/records/${encodeURIComponent(recordId)}/status`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${idToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(update),
          },
        );
        const body = (await res.json()) as { error?: string };
        if (!res.ok) {
          throw new Error(body.error ?? "見積ステータスの更新に失敗しました");
        }
        setFeedback("商談進捗情報を更新しました");
        await mutate();
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "見積ステータスの更新に失敗しました";
        setFeedback(msg);
      } finally {
        setUpdatingRecordId(null);
      }
    },
    [idToken, mutate],
  );

  const handleScheduleChange = useCallback(
    async (recordId: string, update: MeetingScheduleScheduledUpdateInput) => {
      if (!idToken || !update.scheduledYmd.trim()) return;
      setUpdatingRecordId(recordId);
      setFeedback(null);
      try {
        const res = await fetch(
          `/api/meeting-schedule/records/${encodeURIComponent(recordId)}/schedule`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${idToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(update),
          },
        );
        const body = (await res.json()) as {
          error?: string;
          estimateStatus?: string;
        };
        if (!res.ok) {
          throw new Error(
            body.error ?? "商談・資料送付予定日時の更新に失敗しました",
          );
        }
        setFeedback(
          body.estimateStatus
            ? "商談・資料送付予定日時を更新し、見積ステータスを見積依頼済みに変更しました"
            : "商談・資料送付予定日時を更新しました",
        );
        await mutate();
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.message
            : "商談・資料送付予定日時の更新に失敗しました";
        setFeedback(msg);
      } finally {
        setUpdatingRecordId(null);
      }
    },
    [idToken, mutate],
  );

  if (phase === "session-expired") {
    return (
      <LiffScreen>
        <LiffSessionExpiredPanel />
      </LiffScreen>
    );
  }

  if (phase === "need-login") {
    return (
      <LiffScreen>
        <main className="liff-page-main mx-auto w-full max-w-lg flex-1 py-6">
          <p className="text-center text-sm text-slate-600 dark:text-slate-300">
            LINE ログインへ移動しています…
          </p>
        </main>
      </LiffScreen>
    );
  }

  if (phase === "error") {
    return (
      <LiffScreen>
        <main className="liff-page-main mx-auto w-full max-w-lg flex-1 py-6">
          <p className="text-center text-sm text-red-700 dark:text-red-300">
            {errorMessage}
          </p>
        </main>
      </LiffScreen>
    );
  }

  if (phase === "init") {
    return (
      <LiffScreen>
        <LiffLoadingBlock message="読み込み中…" />
      </LiffScreen>
    );
  }

  return (
    <LiffScreen>
      <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <LiffGhostLink href="/">← メニュー</LiffGhostLink>
        <ThemeToggle />
      </header>

      <LiffAccountBar
        loading={account.loading}
        pictureUrl={account.pictureUrl}
        boundStaffName={account.boundStaffName}
        bindingEnabled={account.bindingEnabled}
      />

      <main className="liff-page-main mx-auto w-full max-w-lg flex-1 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <LiffPageHeader
          title="商談進捗情報"
          subtitle={subtitle}
          action={
            <button
              type="button"
              onClick={reload}
              className="rounded-lg px-2 py-1 text-[13px] font-medium text-sky-700 active:bg-sky-50 dark:text-sky-300 dark:active:bg-sky-950/40"
            >
              更新
            </button>
          }
        />

        <LiffStaffBindingConfigNotice message={account.bindingConfigError} />

        {feedback ? (
          <p className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13px] text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            {feedback}
          </p>
        ) : null}

        {needsStaffBind ? (
          <LiffStaffBindPanel
            staff={account.staff}
            bindingEnabled={account.bindingEnabled}
            boundStaffName={account.boundStaffName}
            accountLoading={account.loading}
            onBind={account.bindStaff}
          />
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`rounded-xl px-3 py-2.5 text-[14px] font-semibold transition-colors ${
                  viewMode === "list"
                    ? "bg-sky-600 text-white shadow-sm dark:bg-sky-500"
                    : "text-slate-600 active:bg-slate-100 dark:text-slate-300 dark:active:bg-slate-800"
                }`}
              >
                一覧
              </button>
              <button
                type="button"
                onClick={() => setViewMode("day")}
                className={`rounded-xl px-3 py-2.5 text-[14px] font-semibold transition-colors ${
                  viewMode === "day"
                    ? "bg-sky-600 text-white shadow-sm dark:bg-sky-500"
                    : "text-slate-600 active:bg-slate-100 dark:text-slate-300 dark:active:bg-slate-800"
                }`}
              >
                日別
              </button>
            </div>

            {viewMode === "day" ? (
              <div className="mb-4 flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => setViewDate((d) => shiftYmd(d, -1))}
                  className="flex size-10 items-center justify-center rounded-xl text-lg text-slate-700 active:bg-slate-100 dark:text-slate-200 dark:active:bg-slate-800"
                  aria-label="前の日"
                >
                  ‹
                </button>
                <div className="min-w-0 flex-1 text-center">
                  <p className="text-[15px] font-bold text-slate-800 dark:text-white">
                    {data?.dateLabel ?? viewDate}
                  </p>
                  {!isToday ? (
                    <button
                      type="button"
                      onClick={() => setViewDate(todayYmdJst())}
                      className="mt-0.5 text-[12px] font-medium text-sky-600 dark:text-sky-400"
                    >
                      今日に戻る
                    </button>
                  ) : (
                    <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
                      選択した日の商談進捗情報
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setViewDate((d) => shiftYmd(d, 1))}
                  className="flex size-10 items-center justify-center rounded-xl text-lg text-slate-700 active:bg-slate-100 dark:text-slate-200 dark:active:bg-slate-800"
                  aria-label="次の日"
                >
                  ›
                </button>
              </div>
            ) : null}

            {isLoading && !data ? (
              <LiffLoadingBlock message="商談進捗情報を読み込み中…" />
            ) : data?.error ? (
              <LiffCard>
                <p className="px-4 py-6 text-center text-[14px] text-red-700 dark:text-red-300">
                  {data.error}
                </p>
              </LiffCard>
            ) : !data?.configured ? (
              <LiffCard>
                <p className="px-4 py-6 text-center text-[14px] text-slate-600 dark:text-slate-300">
                  商談進捗情報は環境変数設定後に利用できます。
                </p>
              </LiffCard>
            ) : itemCount === 0 ? (
              <LiffCard>
                <p className="px-4 py-8 text-center text-[14px] text-slate-600 dark:text-slate-300">
                  {viewMode === "list"
                    ? "商談進捗情報はありません"
                    : isToday
                      ? "本日の商談進捗情報はありません"
                      : "この日の商談進捗情報はありません"}
                </p>
              </LiffCard>
            ) : viewMode === "list" ? (
              <div className="flex flex-col gap-5">
                {groupedItems.map((group) => (
                  <section key={group.ymd || group.label}>
                    <h2 className="mb-2 px-1 text-[13px] font-bold text-slate-500 dark:text-slate-400">
                      {group.label}
                      <span className="ml-2 font-medium text-slate-400 dark:text-slate-500">
                        {group.items.length}件
                      </span>
                    </h2>
                    <ul className="flex flex-col gap-3">
                      {group.items.map((item, i) => (
                        <li key={`${group.ymd}-${item.recordId}-${i}`}>
                          <MeetingScheduleItemCard
                            item={item}
                            staffName={data.staffName}
                            statusOptions={data.statusOptions}
                            statusEditable={data.statusEditable}
                            scheduleEditable={data.scheduleEditable}
                            closeTypeOptions={data.closeTypeOptions}
                            meetingPlaceOptions={data.meetingPlaceOptions}
                            statusUpdating={updatingRecordId === item.recordId}
                            onStatusChange={handleStatusChange}
                            onScheduleChange={handleScheduleChange}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.items.map((item, i) => (
                  <li key={`${item.recordId}-${i}`}>
                    <MeetingScheduleItemCard
                      item={item}
                      staffName={data.staffName}
                      statusOptions={data.statusOptions}
                      statusEditable={data.statusEditable}
                      scheduleEditable={data.scheduleEditable}
                      closeTypeOptions={data.closeTypeOptions}
                      meetingPlaceOptions={data.meetingPlaceOptions}
                      statusUpdating={updatingRecordId === item.recordId}
                      onStatusChange={handleStatusChange}
                      onScheduleChange={handleScheduleChange}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </LiffScreen>
  );
}
