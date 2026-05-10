"use client";

import liff from "@line/liff";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  LiffCard,
  LiffGhostLink,
  LiffLoadingBlock,
  LiffScreen,
} from "@/components/liff-chrome";
import type {
  CalendarApiPayload,
  CalendarMonthApiItem,
} from "@/lib/calendar-api-types";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

const WEEK_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function contractorHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

function ymdKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type GridCell = {
  dayKey: string | null;
  dayNum: number;
  inMonth: boolean;
  date: Date;
};

function buildMonthGrid(year: number, month1: number): GridCell[] {
  const viewMonth = month1 - 1;
  const firstDow = new Date(year, viewMonth, 1).getDay();
  const lastDate = new Date(year, viewMonth + 1, 0).getDate();
  const prevLast = new Date(year, viewMonth, 0).getDate();
  const cells: GridCell[] = [];
  for (let i = 0; i < firstDow; i++) {
    const d = prevLast - firstDow + i + 1;
    cells.push({
      dayKey: ymdKey(new Date(year, viewMonth - 1, d)),
      dayNum: d,
      inMonth: false,
      date: new Date(year, viewMonth - 1, d),
    });
  }
  for (let i = 1; i <= lastDate; i++) {
    cells.push({
      dayKey: ymdKey(new Date(year, viewMonth, i)),
      dayNum: i,
      inMonth: true,
      date: new Date(year, viewMonth, i),
    });
  }
  let nextFill = 1;
  while (cells.length % 7 !== 0 || cells.length < 42) {
    cells.push({
      dayKey: ymdKey(new Date(year, viewMonth + 1, nextFill)),
      dayNum: nextFill,
      inMonth: false,
      date: new Date(year, viewMonth + 1, nextFill),
    });
    nextFill += 1;
  }
  return cells;
}

function cellAccent(
  date: Date,
  holidayKeys: Set<string>,
): "hol" | "sun" | "sat" | "weekday" {
  const k = ymdKey(date);
  if (holidayKeys.has(k)) return "hol";
  const w = date.getDay();
  if (w === 0) return "sun";
  if (w === 6) return "sat";
  return "weekday";
}

function openExternal(url: string) {
  if (!url.trim()) return;
  try {
    if (typeof liff.openWindow === "function" && liff.isInClient()) {
      liff.openWindow({ url, external: true });
      return;
    }
  } catch {
    /* fallthrough */
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export default function CalendarPage() {
  const today = useMemo(() => new Date(), []);
  const [ym, setYm] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth() + 1,
  }));

  const [phase, setPhase] = useState<
    "init" | "need-login" | "loading" | "ready" | "error" | "disabled"
  >(() => (LIFF_ID ? "init" : "error"));
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    LIFF_ID ? null : "NEXT_PUBLIC_LIFF_ID が設定されていません",
  );
  const [data, setData] = useState<CalendarApiPayload | null>(null);

  const loadCalendar = useCallback(async (idToken: string, year: number, month: number) => {
    setPhase("loading");
    setErrorMessage(null);
    const qs = new URLSearchParams({ year: String(year), month: String(month) });
    const res = await fetch(`/api/calendar?${qs}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });

    if (res.status === 401) {
      setErrorMessage("認証に失敗しました。LINE から開き直してください。");
      setPhase("error");
      return;
    }

    if (res.status === 503) {
      const body = (await res.json()) as { disabled?: boolean; error?: string };
      setErrorMessage(
        body.error ??
          "工事カレンダーは環境変数 CALENDAR_APP_ID 設定後に利用できます。",
      );
      setPhase("disabled");
      return;
    }

    if (!res.ok) {
      const body = (await res.json()) as { error?: string; detail?: string };
      const base = body.error ?? "読み込みに失敗しました";
      setErrorMessage(body.detail ? `${base}\n${body.detail}` : base);
      setPhase("error");
      return;
    }

    const payload = (await res.json()) as CalendarApiPayload;
    setData(payload);
    setPhase("ready");
  }, []);

  const [idToken, setIdToken] = useState<string | null>(null);

  useEffect(() => {
    if (!LIFF_ID) return;

    let cancelled = false;

    (async () => {
      try {
        await liff.init({ liffId: LIFF_ID });
        if (cancelled) return;

        if (!liff.isLoggedIn()) {
          setPhase("need-login");
          liff.login();
          return;
        }

        const token = liff.getIDToken();
        if (!token) {
          setErrorMessage(
            "LINE の ID トークンを取得できませんでした。チャネル設定を確認してください。",
          );
          setPhase("error");
          return;
        }

        setIdToken(token);
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
    if (!idToken) return;
    const t = window.setTimeout(() => {
      void loadCalendar(idToken, ym.year, ym.month);
    }, 0);
    return () => clearTimeout(t);
  }, [idToken, ym.year, ym.month, loadCalendar]);

  const holidaySet = useMemo(
    () => new Set(data?.holidayKeys ?? []),
    [data?.holidayKeys],
  );

  const grid = useMemo(
    () => buildMonthGrid(ym.year, ym.month),
    [ym.year, ym.month],
  );

  const todayKey = ymdKey(today);

  function shiftMonth(delta: number) {
    setYm((prev) => {
      let y = prev.year;
      let m = prev.month + delta;
      while (m > 12) {
        m -= 12;
        y += 1;
      }
      while (m < 1) {
        m += 12;
        y -= 1;
      }
      return { year: y, month: m };
    });
  }

  if (phase === "init" || phase === "need-login") {
    return (
      <LiffLoadingBlock
        message="LINE でログインしています"
        footer={<LiffGhostLink href="/">ログ入力へ</LiffGhostLink>}
      />
    );
  }

  if (phase === "loading") {
    return (
      <LiffLoadingBlock
        message="カレンダーを読み込んでいます"
        footer={<LiffGhostLink href="/">ログ入力へ</LiffGhostLink>}
      />
    );
  }

  if (phase === "error" || phase === "disabled") {
    return (
      <LiffScreen>
        <div className="flex flex-1 flex-col justify-center py-8">
          <div className="mb-6 text-center">
            <Link href="/" className="inline-flex items-center gap-2 text-[14px] font-semibold text-emerald-800">
              <span aria-hidden>‹</span>
              ログ入力へ戻る
            </Link>
          </div>
          <LiffCard>
            <div className="px-5 py-8">
              <p className="whitespace-pre-wrap text-center text-[15px] leading-relaxed text-red-700">
                {errorMessage}
              </p>
              <div className="mx-auto mt-8 max-w-xs">
                <Link
                  href="/"
                  className="inline-flex w-full items-center justify-center rounded-2xl bg-[#06C755] py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-emerald-600/20 transition active:scale-[0.98]"
                >
                  ログ入力へ
                </Link>
              </div>
            </div>
          </LiffCard>
        </div>
      </LiffScreen>
    );
  }

  return (
    <LiffScreen>
      <div className="mx-auto w-full max-w-xl flex-1 pb-6 pt-2">
        <div className="mb-5 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Link
                href="/"
                className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-800 active:opacity-70"
              >
                <span className="text-lg leading-none">‹</span>
                ログ入力
              </Link>
              <h1 className="mt-3 text-[1.45rem] font-bold tracking-tight text-slate-900">
                工事カレンダー
              </h1>
              <p className="mt-1 text-[13px] text-slate-500">
                現場スケジュールを確認できます
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-2xl bg-slate-200/55 p-1.5 shadow-inner">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white text-lg font-medium text-slate-700 shadow-sm transition active:scale-95"
              aria-label="前の月"
            >
              ‹
            </button>
            <div className="min-w-0 flex-1 text-center">
              <span className="text-[15px] font-bold tabular-nums text-slate-800">
                {ym.year}年 {ym.month}月
              </span>
            </div>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white text-lg font-medium text-slate-700 shadow-sm transition active:scale-95"
              aria-label="次の月"
            >
              ›
            </button>
          </div>
        </div>

        <LiffCard>
          <div className="overflow-x-auto p-3 sm:p-4">
            <div className="grid min-w-[340px] grid-cols-7 gap-1 rounded-2xl bg-slate-100/90 p-1">
              {WEEK_LABELS.map((w) => (
                <div
                  key={w}
                  className="rounded-lg bg-white/90 px-0.5 py-2.5 text-center text-[11px] font-bold tracking-wide text-slate-500"
                >
                  {w}
                </div>
              ))}
              {grid.map((cell, idx) => {
                const accent = cellAccent(cell.date, holidaySet);
                const accentCls =
                  accent === "hol"
                    ? "bg-red-50/95 text-red-700"
                    : accent === "sun"
                      ? "bg-rose-50/60 text-rose-600"
                      : accent === "sat"
                        ? "bg-sky-50/70 text-sky-700"
                        : "bg-white text-slate-800";

                const dayItems: CalendarMonthApiItem[] =
                  cell.dayKey && data?.byDay
                    ? (data.byDay[cell.dayKey] ?? [])
                    : [];

                const isToday = cell.dayKey === todayKey && cell.inMonth;

                return (
                  <div
                    key={`${idx}-${cell.dayKey ?? "x"}`}
                    className={`flex min-h-[118px] flex-col rounded-xl p-1.5 shadow-sm ring-1 ring-slate-200/60 transition-colors ${accentCls} ${cell.inMonth ? "" : "opacity-[0.45]"}`}
                  >
                    <div className="mb-1.5 flex justify-end">
                      <span
                        className={`flex size-7 items-center justify-center rounded-full text-[12px] font-bold tabular-nums leading-none ${isToday ? "bg-[#06C755] text-white shadow-md shadow-emerald-600/30" : "text-current opacity-90"}`}
                      >
                        {cell.dayNum}
                      </span>
                    </div>
                    <ul className="flex flex-1 flex-col gap-1">
                      {dayItems.map((item, j) => {
                        const hue = contractorHue(item.contractorKey);
                        const border = `3px solid hsl(${hue} 46% 48%)`;
                        return (
                          <li key={`${cell.dayKey}-${j}-${item.recordId ?? j}`}>
                            <button
                              type="button"
                              title={
                                item.memo
                                  ? `${item.line1}\n${item.memo}`
                                  : item.line1
                              }
                              onClick={() => openExternal(item.accessEditUrl)}
                              disabled={!item.accessEditUrl?.trim()}
                              className="w-full min-h-[44px] rounded-lg border border-slate-200/90 bg-white/95 px-1.5 py-2 text-left text-[10px] font-semibold leading-snug text-slate-900 shadow-sm outline-none transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
                              style={{ borderLeft: border }}
                            >
                              <span className="line-clamp-3">
                                {item.line1}
                                {item.showKankoCheck ? (
                                  <span
                                    className="ml-0.5 inline-block text-emerald-600"
                                    title="工事報告と一致"
                                  >
                                    ✅
                                  </span>
                                ) : null}
                              </span>
                              {item.line2 ? (
                                <span className="mt-0.5 block truncate text-[9px] font-normal text-slate-600">
                                  {item.line2}
                                </span>
                              ) : null}
                              {item.memo ? (
                                <span className="mt-1 inline-block rounded bg-slate-100 px-1 py-0.5 text-[8px] font-medium text-slate-600">
                                  備考
                                </span>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </LiffCard>

        <p className="mx-auto mt-5 max-w-md px-1 text-center text-[11px] leading-relaxed text-slate-500">
          案件をタップすると @pocket の編集画面を開きます（権限・URL が無い場合は開けません）。
        </p>
      </div>
    </LiffScreen>
  );
}
