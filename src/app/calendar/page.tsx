"use client";

import liff from "@line/liff";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

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

  if (phase === "init" || phase === "need-login" || phase === "loading") {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 bg-zinc-100 px-4 py-16">
        <p className="text-zinc-700">
          {phase === "loading" ? "工事カレンダーを読み込み中…" : "ログイン処理中…"}
        </p>
        {phase === "loading" ? (
          <Link
            href="/"
            className="text-sm text-emerald-700 underline underline-offset-2"
          >
            ログ入力へ戻る
          </Link>
        ) : null}
      </div>
    );
  }

  if (phase === "error" || phase === "disabled") {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 bg-zinc-100 px-4 py-16">
        <p className="max-w-md whitespace-pre-wrap text-center text-red-700">
          {errorMessage}
        </p>
        <Link
          href="/"
          className="rounded-lg bg-zinc-800 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-900"
        >
          ログ入力へ戻る
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-full flex-1 bg-zinc-100 px-3 py-6 pb-10">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-sm font-medium text-emerald-800 underline-offset-2 hover:underline"
            >
              ← ログ入力
            </Link>
            <h1 className="text-lg font-semibold text-zinc-900">工事カレンダー</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50"
            >
              前月
            </button>
            <span className="min-w-[8rem] text-center text-sm font-semibold text-zinc-800">
              {ym.year}年{ym.month}月
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50"
            >
              翌月
            </button>
          </div>
        </header>

        <div className="overflow-x-auto rounded-xl bg-white p-2 shadow-sm ring-1 ring-zinc-200">
          <div className="grid grid-cols-7 gap-px rounded-lg bg-zinc-200">
            {WEEK_LABELS.map((w) => (
              <div
                key={w}
                className="bg-zinc-50 px-1 py-2 text-center text-[11px] font-bold text-zinc-600"
              >
                {w}
              </div>
            ))}
            {grid.map((cell, idx) => {
              const accent = cellAccent(cell.date, holidaySet);
              const accentCls =
                accent === "hol"
                  ? "text-red-600 bg-red-50"
                  : accent === "sun"
                    ? "text-red-500 bg-white"
                    : accent === "sat"
                      ? "text-blue-600 bg-white"
                      : "text-zinc-800 bg-white";

              const dayItems: CalendarMonthApiItem[] =
                cell.dayKey && data?.byDay
                  ? (data.byDay[cell.dayKey] ?? [])
                  : [];

              const isToday = cell.dayKey === todayKey && cell.inMonth;

              return (
                <div
                  key={`${idx}-${cell.dayKey ?? "x"}`}
                  className={`min-h-[120px] p-1 ${accentCls} ${cell.inMonth ? "" : "opacity-55"}`}
                >
                  <div
                    className={`mb-1 flex justify-end ${isToday ? "font-bold ring-1 ring-emerald-500 ring-offset-1 rounded-full px-1.5 py-0.5 inline-flex ml-auto" : ""}`}
                  >
                    <span className="text-[11px] tabular-nums">{cell.dayNum}</span>
                  </div>
                  <ul className="flex flex-col gap-1">
                    {dayItems.map((item, j) => {
                      const hue = contractorHue(item.contractorKey);
                      const border = `3px solid hsl(${hue} 42% 42%)`;
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
                            className="w-full rounded border border-zinc-200 bg-zinc-50/90 px-1 py-1 text-left text-[10px] leading-snug text-zinc-900 hover:bg-white disabled:cursor-default disabled:opacity-80"
                            style={{ borderLeft: border }}
                          >
                            <span className="line-clamp-3 text-[10px] font-semibold">
                              {item.line1}
                              {item.showKankoCheck ? (
                                <span className="ml-0.5 text-emerald-600" title="工事報告と一致">
                                  ✅
                                </span>
                              ) : null}
                            </span>
                            {item.line2 ? (
                              <span className="mt-0.5 block truncate text-[9px] text-zinc-600">
                                {item.line2}
                              </span>
                            ) : null}
                            {item.memo ? (
                              <span className="mt-0.5 block truncate text-[9px] text-zinc-500">
                                備考あり
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

        <p className="mt-3 text-center text-[11px] text-zinc-500">
          チップをタップすると @pocket のレコード編集を開きます（権限・URL の有無により無効な場合があります）。
        </p>
      </div>
    </div>
  );
}
