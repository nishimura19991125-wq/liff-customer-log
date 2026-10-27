"use client";

import { useEffect, useMemo, useState } from "react";

import {
  LiffAccountBar,
  LiffCard,
  LiffGhostLink,
  LiffLoadingBlock,
  LiffPageHeader,
  LiffPrimaryButton,
  LiffScreen,
  LiffSessionExpiredPanel,
  LiffStaffBindPanel,
  LiffStaffBindingConfigNotice,
} from "@/components/liff-chrome";
import { ThemeToggle } from "@/components/theme-toggle";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import { jstYmd } from "@/lib/jst-hm";
import {
  buildLeaveWeeks,
  formatLeaveDayLabel,
  isLeaveDaySelectable,
  leaveRegisterRequestBody,
  leaveWeekRemainingMessage,
  leaveWeekUsage,
  nextLeaveDeadline,
  summarizeLeaveRegisterResult,
  toggleLeaveDate,
  type LeaveRegisterResponse,
  type LeaveRegisterSummary,
} from "@/lib/leave-registration-view";
import { isRestLeaveType, leaveTypeLabel } from "@/lib/leave-type-mark";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";
import { initLiffAndGetToken } from "@/lib/liff-session";
import { isLiffSwrSessionExpired, LIFF_SWR_DEFAULT_OPTIONS } from "@/lib/liff-swr";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

/** GET /api/attendance/leave/registered */
type RegisteredResponse = {
  window?: { start: string; end: string };
  registered?: string[] | null;
  /** 登録済みの日ごとの種別（休み・有給・忌引き・欠勤 など） */
  registeredTypes?: Record<string, string> | null;
  leavesStatus?: "disabled" | "ok" | "error";
  error?: string;
};

/**
 * 休みの登録（休暇・段階5）。
 *
 * 来週の月曜から2週間のうち、週を選んでから日付を選び、まとめて登録する。
 * 期間はサーバが決める（登録 API と同じ計算）。計算と判定は
 * leave-registration-view.ts にあり、テストはそちらで固定している。
 */
export default function LeaveRegistrationPage() {
  const [phase, setPhase] = useState<
    "init" | "need-login" | "ready" | "error" | "session-expired"
  >(() => (LIFF_ID ? "init" : "error"));
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    LIFF_ID ? null : "NEXT_PUBLIC_LIFF_ID が設定されていません",
  );
  const [idToken, setIdToken] = useState<string | null>(null);
  const [weekIndex, setWeekIndex] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<LeaveRegisterSummary | null>(null);

  const account = useLiffAccountStrip(idToken, phase === "ready");
  const needsStaffBind =
    account.bindingEnabled &&
    !account.boundStaffName &&
    !account.loading &&
    account.staff.length > 0;
  const canUse =
    Boolean(idToken) &&
    phase === "ready" &&
    !needsStaffBind &&
    !account.loading &&
    Boolean(account.boundStaffName || !account.bindingEnabled);

  const {
    data,
    error: swrError,
    isLoading,
    mutate,
  } = useLiffSwr<RegisteredResponse>(
    canUse ? "/api/attendance/leave/registered" : null,
    idToken,
    LIFF_SWR_DEFAULT_OPTIONS,
  );

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
    if (swrError && isLiffSwrSessionExpired(swrError)) setPhase("session-expired");
  }, [swrError]);

  const weeks = useMemo(
    () => (data?.window ? buildLeaveWeeks(data.window.start) : []),
    [data?.window],
  );
  const shownDays = useMemo(() => weeks.flatMap((w) => w.days), [weeks]);
  const registered = useMemo(
    () => new Set(data?.registered ?? []),
    [data?.registered],
  );
  const currentWeek = weeks.find((w) => w.index === weekIndex) ?? weeks[0];
  // 週2日の制限で数えるのは「休み」だけ。有給・忌引き・欠勤の日は選べないが、数えない
  const restRegistered = useMemo(
    () =>
      new Set(
        (data?.registered ?? []).filter((d) =>
          isRestLeaveType(data?.registeredTypes?.[d]),
        ),
      ),
    [data?.registered, data?.registeredTypes],
  );
  const weekUsage = leaveWeekUsage(currentWeek?.days ?? [], selected, restRegistered);
  const deadline = nextLeaveDeadline();
  const deadlineIsToday = deadline === jstYmd();
  const body = leaveRegisterRequestBody(selected, registered);

  async function submit() {
    if (!idToken || submitting || body.dates.length === 0) return;
    setSubmitting(true);
    setSummary(null);
    try {
      const res = await fetch("/api/attendance/leave", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as LeaveRegisterResponse;
      if (res.status === 401 && isLineSessionExpiredPayload(json)) {
        setPhase("session-expired");
        return;
      }
      setSummary(summarizeLeaveRegisterResult(res.status, json));
      // 登録できた日・登録済みだった日は選択から外す。失敗・未送信の日は残すので、
      // そのままもう一度押せば残りだけが送られる
      const done = new Set([...(json.created ?? []), ...(json.alreadyRegistered ?? [])]);
      setSelected((prev) => prev.filter((d) => !done.has(d)));
      // 登録済みの日を取り直してグレーアウトに反映する
      await mutate();
    } catch {
      setSummary({
        kind: "error",
        message: "休暇登録に失敗しました。通信状況を確認して、もう一度お試しください。",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === "init" || phase === "need-login") {
    return (
      <LiffLoadingBlock
        message={
          phase === "need-login" ? "LINE でログインしています" : "アプリを起動しています"
        }
      />
    );
  }

  if (phase === "error") {
    return (
      <LiffScreen>
        <div className="flex flex-1 flex-col justify-center py-10">
          <LiffCard>
            <div className="px-5 py-8 text-center">
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-red-700">
                {errorMessage}
              </p>
            </div>
          </LiffCard>
        </div>
      </LiffScreen>
    );
  }

  if (phase === "session-expired") {
    return <LiffSessionExpiredPanel footer={<LiffGhostLink href="/">トップへ</LiffGhostLink>} />;
  }

  const loading = canUse && isLoading && !data;
  const disabled = data?.leavesStatus === "disabled";
  const loadError = swrError && !isLiffSwrSessionExpired(swrError) ? swrError.message : data?.error;

  return (
    <LiffScreen>
      <main className="liff-page-main mx-auto w-full max-w-lg flex-1 py-6">
        <LiffPageHeader
          title="休暇登録"
          subtitle="来週の月曜から2週間の休みを登録します"
          action={
            <div className="flex shrink-0 items-center gap-2">
              <ThemeToggle />
              <LiffAccountBar
                loading={account.loading}
                pictureUrl={account.pictureUrl}
                boundStaffName={account.boundStaffName}
                bindingEnabled={account.bindingEnabled}
              />
            </div>
          }
        />

        {/* 「← トップへ」は左、「勤怠管理へ」は右端（下のカードの右端とそろう） */}
        <div className="mb-4 flex items-center justify-between gap-4">
          <LiffGhostLink href="/">← トップへ</LiffGhostLink>
          <LiffGhostLink href="/attendance">勤怠管理へ</LiffGhostLink>
        </div>

        <LiffStaffBindingConfigNotice message={account.bindingConfigError} />
        <LiffStaffBindPanel
          staff={account.staff}
          bindingEnabled={account.bindingEnabled}
          boundStaffName={account.boundStaffName}
          accountLoading={account.loading}
          onBind={account.bindStaff}
        />

        {canUse ? (
          <div className="flex flex-col gap-4">
            {/* 締め切りの案内（表示だけ。登録は止めない） */}
            <LiffCard>
              <div className="px-4 py-3.5">
                <p className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
                  次の締め切り（第一・第三水曜）
                </p>
                <p className="mt-0.5 text-[16px] font-bold text-slate-900 dark:text-white">
                  {deadlineIsToday ? "本日 " : ""}
                  {formatLeaveDayLabel(deadline)}
                </p>
              </div>
            </LiffCard>

            {loading ? (
              <LiffCard>
                <p role="status" className="px-4 py-4 text-[14px] text-slate-500 dark:text-slate-400">
                  登録状況を読み込み中…
                </p>
              </LiffCard>
            ) : disabled ? (
              <LiffCard>
                <p className="px-4 py-4 text-[14px] text-slate-600 dark:text-slate-300">
                  休暇登録は現在利用できません。
                </p>
              </LiffCard>
            ) : !data?.window ? (
              <LiffCard>
                <div className="px-4 py-4">
                  <p className="text-[14px] text-amber-800 dark:text-amber-200">
                    {loadError ?? "登録状況を取得できませんでした。"}
                  </p>
                  <button
                    type="button"
                    onClick={() => void mutate()}
                    className="mt-3 min-h-11 rounded-xl border border-slate-300 px-4 text-[14px] font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
                  >
                    再読み込み
                  </button>
                </div>
              </LiffCard>
            ) : (
              <>
                {data.leavesStatus === "error" ? (
                  <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-[13px] leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                    登録済みの日を確認できませんでした。登録はできます（登録済みの日は自動で飛ばします）。
                  </p>
                ) : null}

                {/* 週の選択 */}
                <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="週の選択">
                  {weeks.map((w) => {
                    const active = w.index === currentWeek?.index;
                    return (
                      <button
                        key={w.index}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setWeekIndex(w.index)}
                        className={`min-h-14 rounded-2xl border px-2 py-2 text-center transition active:scale-[0.98] ${
                          active
                            ? "border-emerald-500 bg-emerald-50 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-100"
                            : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        }`}
                      >
                        <span className="block text-[14px] font-bold">{w.label}</span>
                        <span className="block text-[12px] tabular-nums opacity-80">
                          {formatLeaveDayLabel(w.days[0]!)}〜{formatLeaveDayLabel(w.days[6]!)}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* 週2日までの案内（登録済みも数える） */}
                <p
                  className={`text-[13px] leading-relaxed ${
                    weekUsage.full
                      ? "font-medium text-amber-800 dark:text-amber-200"
                      : "text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {leaveWeekRemainingMessage(weekUsage)}
                </p>

                {/* その週の7日 */}
                <LiffCard>
                  <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
                    {(currentWeek?.days ?? []).map((d) => {
                      const isRegistered = registered.has(d);
                      const isSelected = selected.includes(d);
                      const selectable = isLeaveDaySelectable(
                        d,
                        shownDays,
                        registered,
                        selected,
                        restRegistered,
                      );
                      // 週の上限で選べない日（登録済みではない）
                      const isOverLimit = !isRegistered && !isSelected && !selectable;
                      return (
                        <li key={d}>
                          <button
                            type="button"
                            disabled={!selectable || submitting}
                            aria-pressed={isSelected}
                            onClick={() =>
                              setSelected((prev) =>
                                toggleLeaveDate(prev, d, shownDays, registered, restRegistered),
                              )
                            }
                            className={`flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition ${
                              isRegistered || isOverLimit
                                ? "cursor-not-allowed bg-slate-50 text-slate-400 dark:bg-slate-900/60 dark:text-slate-600"
                                : isSelected
                                  ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
                                  : "text-slate-800 dark:text-slate-100"
                            }`}
                          >
                            <span className="text-[15px] font-semibold tabular-nums">
                              {formatLeaveDayLabel(d)}
                            </span>
                            <span className="shrink-0 text-[12px] font-semibold">
                              {isRegistered
                                ? leaveTypeLabel(data?.registeredTypes?.[d])
                                : isSelected
                                  ? "✓ 選択中"
                                  : isOverLimit
                                    ? "上限"
                                    : "選ぶ"}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </LiffCard>

                {/* 選んだ日付の確認（両方の週の分） */}
                <LiffCard>
                  <div className="px-4 py-3.5">
                    <p className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
                      選んだ日（{body.dates.length}日）
                    </p>
                    <p className="mt-1 break-words text-[14px] leading-relaxed text-slate-800 dark:text-slate-100">
                      {body.dates.length > 0
                        ? body.dates.map(formatLeaveDayLabel).join("・")
                        : "まだ選んでいません"}
                    </p>
                  </div>
                </LiffCard>

                <LiffPrimaryButton
                  type="button"
                  disabled={submitting || body.dates.length === 0}
                  onClick={() => void submit()}
                >
                  {submitting ? "登録中…" : "選んだ日を休みとして登録する"}
                </LiffPrimaryButton>

                {summary ? (
                  <p
                    role="status"
                    aria-live="polite"
                    className={`rounded-xl px-3 py-2.5 text-[14px] leading-relaxed ${
                      summary.kind === "success"
                        ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                        : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
                    }`}
                  >
                    {summary.message}
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </main>
    </LiffScreen>
  );
}
