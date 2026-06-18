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
import { ThemeToggle } from "@/components/theme-toggle";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import { initLiffAndGetToken } from "@/lib/liff-session";
import {
  LIFF_SWR_DEFAULT_OPTIONS,
  isLiffSwrSessionExpired,
} from "@/lib/liff-swr";
import type { MeetingSchedulePayload } from "@/lib/meeting-schedule-types";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

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

export default function MeetingSchedulePage() {
  const [phase, setPhase] = useState<
    "init" | "need-login" | "ready" | "error" | "session-expired"
  >(() => (LIFF_ID ? "init" : "error"));
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    LIFF_ID ? null : "NEXT_PUBLIC_LIFF_ID が設定されていません",
  );
  const [idToken, setIdToken] = useState<string | null>(null);
  const [viewDate, setViewDate] = useState(() => todayYmdJst());

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
    ? `/api/meeting-schedule?date=${encodeURIComponent(viewDate)}`
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

  const subtitle = useMemo(() => {
    if (!data?.dateLabel) return undefined;
    return `${data.dateLabel} · ${itemCount}件`;
  }, [data?.dateLabel, itemCount]);

  const reload = useCallback(() => {
    void mutate();
  }, [mutate]);

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
          title="商談進捗"
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
                    本日の進捗
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

            {isLoading && !data ? (
              <LiffLoadingBlock message="商談進捗を読み込み中…" />
            ) : data?.error ? (
              <LiffCard>
                <p className="px-4 py-6 text-center text-[14px] text-red-700 dark:text-red-300">
                  {data.error}
                </p>
              </LiffCard>
            ) : !data?.configured ? (
              <LiffCard>
                <p className="px-4 py-6 text-center text-[14px] text-slate-600 dark:text-slate-300">
                  商談進捗機能は環境変数設定後に利用できます。
                </p>
              </LiffCard>
            ) : itemCount === 0 ? (
              <LiffCard>
                <p className="px-4 py-8 text-center text-[14px] text-slate-600 dark:text-slate-300">
                  {isToday
                    ? "本日の商談進捗はありません"
                    : "この日の商談進捗はありません"}
                </p>
              </LiffCard>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.items.map((item, i) => (
                  <li key={`${item.customerName}-${item.meetingTime}-${i}`}>
                    <LiffCard>
                      <div className="flex items-start gap-3 px-4 py-4">
                        <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-sky-50 py-2 dark:bg-sky-950/40">
                          <span className="text-[11px] font-medium text-sky-700 dark:text-sky-300">
                            開始
                          </span>
                          <span className="text-[18px] font-black tabular-nums leading-none text-sky-900 dark:text-sky-100">
                            {item.meetingTime}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[16px] font-bold leading-snug text-slate-900 dark:text-white">
                            {item.customerName}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {item.city ? (
                              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                {item.city}
                              </span>
                            ) : null}
                            {item.apoTypeLabel ? (
                              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[12px] font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                                {item.apoTypeLabel}
                              </span>
                            ) : null}
                            {item.estimateStatus ? (
                              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[12px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                {item.estimateStatus}
                              </span>
                            ) : null}
                          </div>
                          {item.meetingPlace ? (
                            <p className="mt-2 text-[13px] text-slate-600 dark:text-slate-400">
                              商談場所: {item.meetingPlace}
                            </p>
                          ) : null}
                          {item.apPerson && item.apPerson !== data.staffName ? (
                            <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-500">
                              AP: {item.apPerson}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </LiffCard>
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
