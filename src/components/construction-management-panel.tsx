"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import {
  ALL_BRANCHES,
  ALL_KINDS,
  buildSundayStartMonthGrid,
  constructionManagementDebugSummary,
  countConstructionEvents,
  eventsOfDay,
  filterConstructionEvents,
  formatDayHeading,
  formatDetailDate,
  initialBranchSelection,
  keepBranchSelection,
  KIND_META,
  KIND_ORDER,
  MY_CASES,
  resolveConstructionManagementViewState,
  shiftYearMonth,
  summarizeEventsByDay,
} from "@/lib/construction-management-view";
import type {
  ConstructionManagementEvent,
  ConstructionManagementEventKind,
  ConstructionManagementPayload,
  KindSelection,
} from "@/lib/construction-management-view";
import { jstWallParts, jstYmd } from "@/lib/jst-hm";
import { initLiffAndGetToken, triggerLiffRelogin } from "@/lib/liff-session";
import { isLiffSwrSessionExpired, LIFF_SWR_CALENDAR_OPTIONS } from "@/lib/liff-swr";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();
const API_PATH = "/api/calendar/construction-management";
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/**
 * デバッグ出力を有効にするか（?cmDebug=1）。既定は出さない。
 * 画面ができるまで API が一度も動いていないため、問題が出たときに
 * 「API か画面か」を切り分けられるようにしてある。
 */
function debugEnabled(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("cmDebug") === "1";
  } catch {
    return false;
  }
}

/**
 * 施工管理タブ。足場設置日・足場解体日・施工予定日を1つの月間カレンダーで見る。
 *
 * ■ API を呼ぶのは月を切り替えたときだけ
 * 支店・区分の絞り込みは取得済みのデータを画面側で絞る。API を何度も呼ぶと
 * @pocket の利用上限（サイト単位で100秒あたり100回）に響くため。
 *
 * ■ 閲覧のみ
 * @pocket のレコードへのリンクも、日程の編集もここには置かない。
 */
export function ConstructionManagementPanel() {
  const [idToken, setIdToken] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(() =>
    LIFF_ID ? null : "NEXT_PUBLIC_LIFF_ID が設定されていません",
  );
  const [ym, setYm] = useState(() => {
    const j = jstWallParts();
    return { year: j.y, month: j.m };
  });
  const todayKey = useMemo(() => jstYmd(), []);

  useEffect(() => {
    if (!LIFF_ID) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await initLiffAndGetToken(LIFF_ID);
        if (cancelled || result.status === "redirecting") return;
        setIdToken(result.token);
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        setAuthError("LIFF の初期化に失敗しました");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const path = idToken
    ? `${API_PATH}?${new URLSearchParams({
        year: String(ym.year),
        month: String(ym.month),
      })}`
    : null;
  const { data, error, mutate, isValidating } =
    useLiffSwr<ConstructionManagementPayload>(
      path,
      idToken,
      LIFF_SWR_CALENDAR_OPTIONS,
    );

  const state = resolveConstructionManagementViewState({ data, error, ym });
  const payload = state.kind === "ready" ? state.payload : null;

  // ── 支店（初回は 自分の案件のみ → 本人の勤務場所 → 全支店 の順。
  //    月を変えて一覧から消えたら全支店へ） ──
  const [branch, setBranch] = useState<string | null>(null);
  const selfStaffName = payload?.selfStaffName ?? null;
  const effectiveBranch = payload
    ? branch === null
      ? initialBranchSelection(payload)
      : keepBranchSelection(branch, payload.branches, Boolean(selfStaffName))
    : (branch ?? ALL_BRANCHES);

  // ── 区分（初期は3つとも ON・複数選択可） ──
  const [kinds, setKinds] = useState<KindSelection>(ALL_KINDS);
  const toggleKind = (k: ConstructionManagementEventKind) =>
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  // ── 選択日（当月なら今日、それ以外は1日） ──
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const monthPrefix = `${ym.year}-${String(ym.month).padStart(2, "0")}-`;
  const effectiveDay =
    selectedDay && selectedDay.startsWith(monthPrefix)
      ? selectedDay
      : todayKey.startsWith(monthPrefix)
        ? todayKey
        : `${monthPrefix}01`;

  const filtered = useMemo(
    () =>
      payload
        ? filterConstructionEvents(
            payload.events,
            effectiveBranch,
            kinds,
            payload.selfStaffName,
          )
        : [],
    [payload, effectiveBranch, kinds],
  );
  const counts = countConstructionEvents(filtered, kinds);
  const byDay = useMemo(() => summarizeEventsByDay(filtered), [filtered]);
  const dayEvents = useMemo(
    () => eventsOfDay(filtered, effectiveDay),
    [filtered, effectiveDay],
  );
  const grid = useMemo(
    () => buildSundayStartMonthGrid(ym.year, ym.month),
    [ym.year, ym.month],
  );

  const [detail, setDetail] = useState<ConstructionManagementEvent | null>(null);

  // ── デバッグ出力（?cmDebug=1 のときだけ。氏名・T番号 は出さない） ──
  const debugKey = `${state.kind}:${payload?.correlationId ?? ""}:${ym.year}-${ym.month}`;
  useEffect(() => {
    if (!debugEnabled()) return;
    console.info(
      "[construction-management]",
      constructionManagementDebugSummary(state, ym),
    );
    if (state.kind === "error" && error && typeof error === "object") {
      const status = (error as { status?: unknown }).status;
      console.info("[construction-management] error", {
        status: typeof status === "number" ? status : null,
        sessionExpired: isLiffSwrSessionExpired(error),
      });
    }
    // state・error は debugKey に要点が入っているので、それが変わったときだけ出す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugKey]);

  const changeMonth = (delta: number) => {
    setYm((cur) => shiftYearMonth(cur, delta));
    setSelectedDay(null);
  };

  if (authError) {
    return (
      <PanelShell>
        <ErrorBox message={authError} />
      </PanelShell>
    );
  }

  const sessionExpired = state.kind === "error" && isLiffSwrSessionExpired(error);

  return (
    <PanelShell>
      {/* 支店選択フィルター */}
      <label className="block">
        <span className="mb-1 block text-[12px] font-semibold text-[#64748B] dark:text-slate-400">
          支店
        </span>
        <span className="relative block">
          <select
            value={effectiveBranch}
            onChange={(e) => setBranch(e.target.value)}
            disabled={!payload}
            className="h-12 w-full appearance-none rounded-xl border border-[#E2E8F0] bg-white pl-4 pr-10 text-[16px] font-semibold text-[#1E293B] disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            {selfStaffName ? (
              <option value={MY_CASES}>自分の案件のみ</option>
            ) : null}
            <option value={ALL_BRANCHES}>全支店</option>
            {(payload?.branches ?? []).map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-[12px] text-[#64748B]"
          >
            ▼
          </span>
        </span>
      </label>

      {/* 予定区分フィルター */}
      <div className="mt-3 grid grid-cols-4 gap-2" role="group" aria-label="予定区分">
        {KIND_ORDER.map((k) => {
          const on = kinds.has(k);
          const meta = KIND_META[k];
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              onClick={() => toggleKind(k)}
              style={on ? { backgroundColor: meta.color } : undefined}
              className={`flex min-h-11 items-center justify-center gap-1 rounded-xl px-1 text-[14px] font-bold transition active:scale-[0.98] ${
                on
                  ? "text-white shadow-sm"
                  : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
              }`}
            >
              <span aria-hidden>{on ? "✓" : ""}</span>
              {meta.label}
            </button>
          );
        })}
      </div>

      {/*
        月間集計カード。
        ⚠ AP と CL の支店が違う案件は両方の支店に計上される。
           支店ごとの件数を足しても全体の件数とは一致しない。
      */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        {KIND_ORDER.map((k) => {
          const n = payload ? counts[k] : null;
          const off = !kinds.has(k);
          return (
            <div
              key={k}
              className={`flex h-full min-h-[4.5rem] flex-col justify-between rounded-2xl border border-[#E2E8F0] bg-white px-2 py-2 dark:border-slate-700 dark:bg-slate-800 ${
                off ? "opacity-50" : ""
              }`}
            >
              <span className="flex items-center gap-1 text-[11px] font-semibold leading-tight text-[#64748B] dark:text-slate-400">
                <span
                  aria-hidden
                  className="inline-block size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: KIND_META[k].color }}
                />
                {KIND_META[k].label}
              </span>
              <span className="text-right text-[#1E293B] dark:text-slate-100">
                {off || n === null ? (
                  <span className="text-[20px] font-bold text-slate-400">—</span>
                ) : (
                  <>
                    <span className="text-[22px] font-bold tabular-nums leading-none">
                      {n}
                    </span>
                    <span className="ml-0.5 text-[12px] font-semibold">件</span>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {/* 月間カレンダー */}
      <section className="mt-4 rounded-2xl border border-[#E2E8F0] bg-white p-2 sm:p-3 dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <button
            type="button"
            onClick={() => changeMonth(-1)}
            className="flex size-11 items-center justify-center rounded-xl text-[22px] font-bold text-[#1E293B] active:bg-slate-100 dark:text-slate-100 dark:active:bg-slate-700"
            aria-label="前の月"
          >
            ‹
          </button>
          <h2 className="text-[17px] font-bold text-[#1E293B] dark:text-slate-100">
            {ym.year}年{ym.month}月
            {isValidating && payload ? (
              <span className="ml-2 text-[11px] font-medium text-[#64748B]">更新中…</span>
            ) : null}
          </h2>
          <button
            type="button"
            onClick={() => changeMonth(1)}
            className="flex size-11 items-center justify-center rounded-xl text-[22px] font-bold text-[#1E293B] active:bg-slate-100 dark:text-slate-100 dark:active:bg-slate-700"
            aria-label="次の月"
          >
            ›
          </button>
        </div>

        <div className="grid grid-cols-7 text-center text-[12px] font-bold">
          {WEEKDAY_LABELS.map((w, i) => (
            <div
              key={w}
              className={`py-1 ${
                i === 0
                  ? "text-red-600 dark:text-red-400"
                  : i === 6
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-[#64748B] dark:text-slate-400"
              }`}
            >
              {w}
            </div>
          ))}
        </div>

        {state.kind === "loading" ? (
          <p
            className="flex min-h-[16rem] items-center justify-center text-[14px] text-[#64748B]"
            role="status"
          >
            読み込み中…
          </p>
        ) : state.kind === "error" ? (
          <div className="min-h-[16rem] py-6">
            <ErrorBox
              message={state.message}
              onRetry={sessionExpired ? undefined : () => void mutate()}
              onRelogin={
                sessionExpired && LIFF_ID
                  ? () => void triggerLiffRelogin(LIFF_ID)
                  : undefined
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-px">
            {grid.map((cell) => {
              const summaries = cell.inMonth ? (byDay.get(cell.dayKey) ?? []) : [];
              const isToday = cell.dayKey === todayKey;
              const isSelected = cell.inMonth && cell.dayKey === effectiveDay;
              const dayNum = Number(cell.dayKey.slice(8));
              const dayColor =
                cell.weekday === 0
                  ? "text-red-600 dark:text-red-400"
                  : cell.weekday === 6
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-[#1E293B] dark:text-slate-100";
              return (
                <button
                  key={cell.dayKey}
                  type="button"
                  disabled={!cell.inMonth}
                  onClick={() => setSelectedDay(cell.dayKey)}
                  aria-pressed={isSelected}
                  aria-label={
                    cell.inMonth
                      ? `${formatDayHeading(cell.dayKey)} ${summaries
                          .map((s) => `${KIND_META[s.kind].label}${s.count}件`)
                          .join(" ")}`
                      : undefined
                  }
                  className={`flex min-h-[3.75rem] min-w-0 flex-col items-stretch gap-0.5 rounded-lg border-2 p-0.5 text-left ${
                    isSelected
                      ? "border-[#16A34A] bg-emerald-50/60 dark:bg-emerald-950/30"
                      : "border-transparent"
                  } ${cell.inMonth ? "" : "opacity-30"}`}
                >
                  <span className="flex justify-center">
                    <span
                      className={`flex size-6 items-center justify-center rounded-full text-[12px] font-bold tabular-nums ${
                        isToday ? "bg-[#1E293B] text-white dark:bg-white dark:text-slate-900" : dayColor
                      }`}
                    >
                      {dayNum}
                    </span>
                  </span>
                  {summaries.map((s) => (
                    <span
                      key={s.kind}
                      className="block truncate rounded px-0.5 text-center text-[10px] font-bold leading-[1.35] text-white"
                      style={{ backgroundColor: KIND_META[s.kind].color }}
                    >
                      {KIND_META[s.kind].shortLabel}
                      {s.count > 1 ? ` ${s.count}` : ""}
                    </span>
                  ))}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* 選択日の予定一覧 */}
      {state.kind === "ready" ? (
        <section className="mt-4">
          <h3 className="mb-2 text-[15px] font-bold text-[#1E293B] dark:text-slate-100">
            {formatDayHeading(effectiveDay)}の予定
            <span className="ml-2 text-[13px] font-semibold text-[#64748B]">
              {dayEvents.length}件
            </span>
          </h3>
          {dayEvents.length === 0 ? (
            <div className="rounded-2xl border border-[#E2E8F0] bg-white px-4 py-6 text-center dark:border-slate-700 dark:bg-slate-800">
              <p className="text-[14px] text-[#64748B]">予定はありません</p>
              {/* 絞り込み中なら、全支店に切り替える導線を出す（取得の失敗とは別の表示） */}
              {effectiveBranch !== ALL_BRANCHES ? (
                <button
                  type="button"
                  onClick={() => setBranch(ALL_BRANCHES)}
                  className="mt-3 min-h-11 rounded-xl border border-[#E2E8F0] bg-slate-50 px-5 text-[14px] font-bold text-[#16A34A] active:scale-[0.98] dark:border-slate-700 dark:bg-slate-900 dark:text-emerald-400"
                >
                  全支店で見る
                </button>
              ) : null}
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {dayEvents.map((e) => (
                <li key={e.id}>
                  <EventCard event={e} onOpen={() => setDetail(e)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {detail ? (
        <EventDetailSheet event={detail} onClose={() => setDetail(null)} />
      ) : null}
    </PanelShell>
  );
}

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="liff-page-main mx-auto w-full max-w-xl pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-800 active:opacity-70 dark:text-emerald-300"
      >
        <span className="text-lg leading-none">‹</span>
        メニューへ
      </Link>
      <div className="mb-4 mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[1.35rem] font-bold leading-tight tracking-tight text-[#1E293B] dark:text-white">
            施工管理
          </h1>
          <p className="mt-1 text-[14px] leading-snug text-[#64748B] dark:text-slate-300">
            足場設置・足場解体・施工予定を月ごとに確認できます。日付をタップすると下に一覧が出ます。
          </p>
        </div>
        <div className="shrink-0 pt-0.5">
          <ThemeToggle />
        </div>
      </div>
      {children}
    </div>
  );
}

function ErrorBox({
  message,
  onRetry,
  onRelogin,
}: {
  message: string;
  onRetry?: () => void;
  onRelogin?: () => void;
}) {
  return (
    <div
      role="alert"
      className="mx-auto max-w-sm rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-center dark:border-red-900/60 dark:bg-red-950/40"
    >
      <p className="whitespace-pre-wrap text-[14px] font-semibold leading-relaxed text-red-800 dark:text-red-200">
        {message}
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 min-h-11 w-full rounded-xl bg-[#16A34A] text-[15px] font-bold text-white active:scale-[0.98]"
        >
          再試行
        </button>
      ) : null}
      {onRelogin ? (
        <button
          type="button"
          onClick={onRelogin}
          className="mt-3 min-h-11 w-full rounded-xl bg-[#16A34A] text-[15px] font-bold text-white active:scale-[0.98]"
        >
          再ログイン
        </button>
      ) : null}
    </div>
  );
}

function KindBadge({ kind }: { kind: ConstructionManagementEventKind }) {
  return (
    <span
      className="shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-bold text-white"
      style={{ backgroundColor: KIND_META[kind].color }}
    >
      {KIND_META[kind].label}
    </span>
  );
}

function branchText(e: ConstructionManagementEvent): string {
  return e.branches.join("・");
}

function EventCard({
  event,
  onOpen,
}: {
  event: ConstructionManagementEvent;
  onOpen: () => void;
}) {
  // 3行目: 足場の予定は足場業者、施工予定・残工は施工店
  const isScaffold =
    event.kind === "scaffoldInstall" || event.kind === "scaffoldRemoval";
  const company = isScaffold ? event.scaffoldContractor : event.constructionContractor;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-2xl border border-[#E2E8F0] bg-white px-4 py-3 text-left shadow-sm active:scale-[0.99] dark:border-slate-700 dark:bg-slate-800"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 break-words text-[16px] font-bold text-[#1E293B] dark:text-slate-100">
          {event.customerName ? `${event.customerName}様邸` : "（お客様名なし）"}
        </span>
        <KindBadge kind={event.kind} />
      </span>
      <span className="mt-1 block text-[13px] text-[#64748B] dark:text-slate-400">
        {branchText(event)}
      </span>
      <span className="mt-0.5 block break-words text-[13px] text-[#1E293B] dark:text-slate-200">
        {isScaffold ? "足場業者" : "施工店"}：{company || "未登録"}
      </span>
    </button>
  );
}

function EventDetailSheet({
  event,
  onClose,
}: {
  event: ConstructionManagementEvent;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows: [string, string][] = [
    ["支店", branchText(event)],
    // 残工（残工 段階2）は残工日も出す。日付は残工案件アプリ（186）の値
    ...(event.kind === "zanko"
      ? ([["残工日", formatDetailDate(event.dayKey)]] as [string, string][])
      : []),
    ["足場設置日", formatDetailDate(event.dates.scaffoldInstall)],
    ["施工予定日", formatDetailDate(event.dates.construction)],
    ["足場解体日", formatDetailDate(event.dates.scaffoldRemoval)],
    ["足場業者", event.scaffoldContractor || "未登録"],
    ["足場依頼内容", event.scaffoldRequest || "未登録"],
    ["施工店", event.constructionContractor || "未登録"],
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="予定の詳細"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:rounded-2xl dark:bg-slate-800"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="min-w-0 break-words text-[18px] font-bold text-[#1E293B] dark:text-slate-100">
            {event.customerName ? `${event.customerName}様邸` : "（お客様名なし）"}
          </h2>
          <KindBadge kind={event.kind} />
        </div>
        <dl className="mt-4 divide-y divide-[#E2E8F0] dark:divide-slate-700">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 py-2.5">
              <dt className="text-[13px] font-semibold text-[#64748B] dark:text-slate-400">
                {k}
              </dt>
              <dd className="whitespace-pre-wrap break-words text-[14px] text-[#1E293B] dark:text-slate-100">
                {v}
              </dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 min-h-11 w-full rounded-xl border border-[#E2E8F0] bg-slate-50 text-[15px] font-bold text-[#1E293B] active:scale-[0.98] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
