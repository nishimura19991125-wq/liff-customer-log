"use client";

import liff from "@line/liff";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  LiffAccountBar,
  LiffCard,
  LiffDirectUrlLinks,
  LiffGhostLink,
  LiffLoadingBlock,
  LiffScreen,
  LiffStaffBindPanel,
} from "@/components/liff-chrome";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import type {
  CalendarApiPayload,
  CalendarMonthApiItem,
} from "@/lib/calendar-api-types";
import { EMPTY_FILL_HOUSING_STATUS_VALUES } from "@/lib/calendar-empty-fill-options";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

const WEEK_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;
const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

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

function parseDayKey(dayKey: string): Date | null {
  const p = dayKey.split("-").map(Number);
  if (p.length !== 3 || p.some((n) => Number.isNaN(n))) return null;
  const d = new Date(p[0], p[1] - 1, p[2]);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDayHeading(dayKey: string): string {
  const dt = parseDayKey(dayKey);
  if (!dt) return dayKey;
  const w = WEEKDAY_JA[dt.getDay()];
  return `${dt.getMonth() + 1}月${dt.getDate()}日（${w}）`;
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

function weekHeaderClass(i: number): string {
  if (i === 0) return "text-red-600 bg-red-50/95";
  if (i === 6) return "text-sky-700 bg-sky-50/95";
  return "text-slate-600 bg-white/95";
}

function countCasesAndSlots(items: CalendarMonthApiItem[]): {
  cases: number;
  emptySlots: number;
} {
  let cases = 0;
  let emptySlots = 0;
  for (const x of items) {
    if (x.category === "empty") emptySlots += 1;
    else cases += 1;
  }
  return { cases, emptySlots };
}

function EmptySlotCard({
  item,
  idToken,
  onSaved,
}: {
  item: CalendarMonthApiItem;
  idToken: string | null;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [housingStatus, setHousingStatus] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const rid = item.recordId?.trim();
  const canSubmit = Boolean(rid && idToken);

  async function handleSubmit() {
    if (!rid || !idToken) return;
    const name = customerName.trim();
    const hs = housingStatus.trim();
    if (!name || !hs) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/calendar/fill-empty-slot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          recordId: rid,
          customerName: name,
          housingStatus: hs,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFeedback({
          kind: "err",
          text: data.error ?? "保存に失敗しました",
        });
        return;
      }
      setCustomerName("");
      setHousingStatus("");
      setOpen(false);
      await onSaved();
      setFeedback({
        kind: "ok",
        text: "保存しました。@pocket にも反映済みです。",
      });
    } catch {
      setFeedback({ kind: "err", text: "通信に失敗しました" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-400 bg-slate-50 px-4 py-4 shadow-sm ring-1 ring-slate-200/80">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-lg border border-dashed border-slate-400 bg-white px-2 py-0.5 text-[11px] font-extrabold tracking-wide text-slate-700">
          工事空枠
        </span>
      </div>
      <p className="text-[15px] font-bold leading-snug text-slate-900">
        {item.line1}
        {item.showKankoCheck ? (
          <span className="ml-1 text-emerald-600">✅</span>
        ) : null}
      </p>
      {item.line2 ? (
        <p className="mt-2 text-[13px] font-semibold leading-relaxed text-slate-600">
          {item.line2}
        </p>
      ) : null}
      {item.memo ? (
        <p className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-[13px] leading-relaxed text-slate-700 whitespace-pre-wrap ring-1 ring-slate-100">
          {item.memo}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex flex-1 min-w-[8rem] items-center justify-center rounded-xl bg-[#06C755] px-3 py-2.5 text-[13px] font-bold text-white shadow-sm transition active:scale-[0.99] disabled:opacity-50 sm:flex-none"
          disabled={!rid}
          onClick={() => {
            setOpen((o) => !o);
            setFeedback(null);
          }}
        >
          {open ? "入力を閉じる" : "情報を入力"}
        </button>
        {item.accessEditUrl?.trim() ? (
          <button
            type="button"
            className="inline-flex flex-1 min-w-[8rem] items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[13px] font-bold text-slate-700 shadow-sm transition active:scale-[0.99] sm:flex-none"
            onClick={() => openExternal(item.accessEditUrl)}
          >
            @pocket で開く
          </button>
        ) : null}
      </div>

      {!rid ? (
        <p className="mt-3 text-[12px] font-semibold text-amber-800">
          レコードIDが取得できないため、この画面からは保存できません。@pocket
          で開いて編集してください。
        </p>
      ) : null}

      {open ? (
        <div className="mt-4 border-t border-slate-200/90 pt-4">
          <p className="mb-3 text-[12px] leading-relaxed text-slate-600">
            住宅ステータスとお客様名を登録すると、@pocket のレコードが更新され、カレンダーでは「案件」として表示されます。
          </p>
          <label className="block">
            <span className="mb-1 block text-[12px] font-bold text-slate-700">
              住宅ステータス{" "}
              <span className="font-semibold text-red-600">必須</span>
            </span>
            <select
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] text-slate-900 shadow-inner outline-none ring-1 ring-slate-100 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200"
              value={housingStatus}
              onChange={(e) => setHousingStatus(e.target.value)}
              disabled={submitting || !canSubmit}
            >
              <option value="">選択してください</option>
              {EMPTY_FILL_HOUSING_STATUS_VALUES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-[12px] font-bold text-slate-700">
              お客様名{" "}
              <span className="font-semibold text-red-600">必須</span>
            </span>
            <input
              type="text"
              autoComplete="name"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] text-slate-900 shadow-inner outline-none ring-1 ring-slate-100 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="例：山田太郎"
              disabled={submitting || !canSubmit}
            />
          </label>
          <button
            type="button"
            className="mt-4 w-full rounded-xl bg-slate-800 py-3 text-[14px] font-bold text-white shadow-sm transition active:scale-[0.99] disabled:opacity-50"
            disabled={
              submitting ||
              !customerName.trim() ||
              !housingStatus.trim() ||
              !canSubmit
            }
            onClick={() => void handleSubmit()}
          >
            {submitting ? "保存中…" : "保存してカレンダーに反映"}
          </button>
        </div>
      ) : null}

      {feedback ? (
        <p
          className={`mt-3 whitespace-pre-wrap text-[13px] font-semibold leading-relaxed ${
            feedback.kind === "ok" ? "text-emerald-800" : "text-red-700"
          }`}
        >
          {feedback.text}
        </p>
      ) : null}
    </div>
  );
}

function NewConstructionRecordPanel({
  idToken,
  open,
  onToggleOpen,
  onSaved,
}: {
  idToken: string | null;
  open: boolean;
  onToggleOpen: () => void;
  onSaved: () => Promise<void>;
}) {
  const [customerName, setCustomerName] = useState("");
  const [housingStatus, setHousingStatus] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const canSubmit = Boolean(idToken);

  async function handleSubmit() {
    if (!idToken) return;
    const name = customerName.trim();
    const hs = housingStatus.trim();
    if (!name || !hs) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/calendar/create-record", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          customerName: name,
          housingStatus: hs,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFeedback({
          kind: "err",
          text: data.error ?? "登録に失敗しました",
        });
        return;
      }
      setCustomerName("");
      setHousingStatus("");
      await onSaved();
      setFeedback({
        kind: "ok",
        text: "登録しました。@pocket で T番号が採番されています。カレンダーを更新しました。",
      });
    } catch {
      setFeedback({ kind: "err", text: "通信に失敗しました" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm ring-1 ring-slate-100">
      <button
        type="button"
        className="w-full rounded-xl bg-[#06C755] py-3 text-[14px] font-bold text-white shadow-sm transition active:scale-[0.99]"
        onClick={() => {
          onToggleOpen();
          setFeedback(null);
        }}
      >
        {open ? "入力を閉じる" : "新規作成"}
      </button>

      {open ? (
        <div className="mt-4 border-t border-slate-200/90 pt-4">
          <p className="mb-3 text-[12px] leading-relaxed text-slate-600">
            住宅ステータスとお客様名を入力して登録します。T番号は @pocket
            の自動採番により付与されます（空枠の更新と同じ項目です）。
          </p>
          <label className="block">
            <span className="mb-1 block text-[12px] font-bold text-slate-700">
              住宅ステータス{" "}
              <span className="font-semibold text-red-600">必須</span>
            </span>
            <select
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] text-slate-900 shadow-inner outline-none ring-1 ring-slate-100 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200"
              value={housingStatus}
              onChange={(e) => setHousingStatus(e.target.value)}
              disabled={submitting || !canSubmit}
            >
              <option value="">選択してください</option>
              {EMPTY_FILL_HOUSING_STATUS_VALUES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-[12px] font-bold text-slate-700">
              お客様名{" "}
              <span className="font-semibold text-red-600">必須</span>
            </span>
            <input
              type="text"
              autoComplete="name"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] text-slate-900 shadow-inner outline-none ring-1 ring-slate-100 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="例：山田太郎"
              disabled={submitting || !canSubmit}
            />
          </label>
          {!idToken ? (
            <p className="mt-3 text-[12px] font-semibold text-amber-800">
              ログイン情報がありません。この画面からは登録できません。
            </p>
          ) : null}
          <button
            type="button"
            className="mt-4 w-full rounded-xl bg-slate-800 py-3 text-[14px] font-bold text-white shadow-sm transition active:scale-[0.99] disabled:opacity-50"
            disabled={
              submitting ||
              !customerName.trim() ||
              !housingStatus.trim() ||
              !canSubmit
            }
            onClick={() => void handleSubmit()}
          >
            {submitting ? "登録中…" : "登録してカレンダーを更新"}
          </button>
        </div>
      ) : null}

      {feedback ? (
        <p
          className={`mt-3 whitespace-pre-wrap text-[13px] font-semibold leading-relaxed ${
            feedback.kind === "ok" ? "text-emerald-800" : "text-red-700"
          }`}
        >
          {feedback.text}
        </p>
      ) : null}
    </div>
  );
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
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [newRecordOpen, setNewRecordOpen] = useState(false);

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
      let body: { error?: string } = {};
      try {
        body = (await res.json()) as { error?: string };
      } catch {
        /* ignore */
      }
      const base =
        body.error ??
        (res.status === 429
          ? "アクセスが集中しています。少し待ってから再度お試しください。"
          : "読み込みに失敗しました");
      setErrorMessage(base);
      setPhase("error");
      return;
    }

    const payload = (await res.json()) as CalendarApiPayload;
    setData(payload);
    setPhase("ready");
  }, []);

  const [idToken, setIdToken] = useState<string | null>(null);

  const account = useLiffAccountStrip(idToken, phase === "ready");
  const needsStaffBind =
    account.bindingEnabled &&
    !account.boundStaffName &&
    !account.loading &&
    account.staff.length > 0;

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
    }, 120);
    return () => clearTimeout(t);
  }, [idToken, ym.year, ym.month, loadCalendar]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const tk = ymdKey(today);
      if (ym.year === today.getFullYear() && ym.month === today.getMonth() + 1) {
        setSelectedDayKey(tk);
      } else {
        const d = `${ym.year}-${String(ym.month).padStart(2, "0")}-01`;
        setSelectedDayKey(d);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [ym.year, ym.month, today]);

  const holidaySet = useMemo(
    () => new Set(data?.holidayKeys ?? []),
    [data?.holidayKeys],
  );

  const grid = useMemo(
    () => buildMonthGrid(ym.year, ym.month),
    [ym.year, ym.month],
  );

  const todayKey = ymdKey(today);

  const selectedItems: CalendarMonthApiItem[] = useMemo(() => {
    if (!selectedDayKey || !data?.byDay) return [];
    return data.byDay[selectedDayKey] ?? [];
  }, [data, selectedDayKey]);

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

  function selectDay(cell: GridCell) {
    if (!cell.inMonth || !cell.dayKey) return;
    setSelectedDayKey(cell.dayKey);
  }

  if (phase === "init" || phase === "need-login") {
    return (
      <LiffLoadingBlock
        message="LINE でログインしています"
        footer={<LiffGhostLink href="/">メニューへ</LiffGhostLink>}
      />
    );
  }

  if (phase === "loading") {
    return (
      <LiffLoadingBlock
        message="カレンダーを読み込んでいます"
        footer={<LiffGhostLink href="/">メニューへ</LiffGhostLink>}
      />
    );
  }

  if (phase === "error" || phase === "disabled") {
    return (
      <LiffScreen>
        <div className="flex flex-1 flex-col justify-center py-8">
          <div className="mb-6 text-center">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-[14px] font-semibold text-emerald-800"
            >
              <span aria-hidden>‹</span>
              メニューへ戻る
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
                  メニューへ
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
      <div className="mx-auto w-full max-w-xl flex-1 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
        <div className="mb-4 flex flex-col gap-4">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-800 active:opacity-70"
            >
              <span className="text-lg leading-none">‹</span>
              メニューへ
            </Link>
            <div className="mt-3 flex items-start justify-between gap-3">
              <h1 className="min-w-0 flex-1 text-[1.35rem] font-bold leading-tight tracking-tight text-slate-900">
                工事カレンダー
              </h1>
              <div className="flex shrink-0 items-start pt-0.5">
                <LiffAccountBar
                  loading={account.loading}
                  pictureUrl={account.pictureUrl}
                  boundStaffName={account.boundStaffName}
                  bindingEnabled={account.bindingEnabled}
                />
              </div>
            </div>
            <p className="mt-1 text-[14px] leading-snug text-slate-500">
              日付をタップで下に一覧表示。工事空枠は「情報を入力」からお客様名を登録できます。案件は
              @pocket を開けます。
            </p>
          </div>
        </div>

        <LiffStaffBindPanel
          staff={account.staff}
          bindingEnabled={account.bindingEnabled}
          boundStaffName={account.boundStaffName}
          accountLoading={account.loading}
          onBind={account.bindStaff}
        />

        <div className="relative">
          {needsStaffBind ? (
            <div
              className="absolute inset-0 z-20 flex justify-center rounded-2xl bg-white/70 px-3 pt-5 backdrop-blur-[2px]"
              role="status"
            >
              <p className="max-w-sm text-center text-[13px] font-bold leading-snug text-amber-950">
                先に上の一覧から名前を選んで紐づけてください
              </p>
            </div>
          ) : null}
          <div
            className={
              needsStaffBind
                ? "pointer-events-none opacity-[0.35] saturate-50"
                : undefined
            }
          >
            <div className="mb-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 ring-1 ring-slate-200/80">
              <span className="size-2 rounded-full bg-[#06C755]" aria-hidden />
              今日
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800 ring-1 ring-emerald-100">
              緑
              <span className="font-normal text-emerald-700/90">案件の件数</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-400 bg-slate-50 px-2.5 py-1 font-semibold text-slate-700">
              点線枠
              <span className="font-normal text-slate-600">工事空枠の件数</span>
            </span>
          </div>

          <NewConstructionRecordPanel
            idToken={idToken}
            open={newRecordOpen}
            onToggleOpen={() => setNewRecordOpen((o) => !o)}
            onSaved={async () => {
              const t = idToken;
              if (!t) return;
              await loadCalendar(t, ym.year, ym.month);
            }}
          />

          <div className="flex items-center gap-2 rounded-2xl bg-slate-200/55 p-1.5 shadow-inner">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white text-xl font-medium text-slate-700 shadow-sm transition active:scale-95"
              aria-label="前の月"
            >
              ‹
            </button>
            <div className="min-w-0 flex-1 text-center">
              <span className="text-[1.05rem] font-bold tabular-nums text-slate-800">
                {ym.year}年 {ym.month}月
              </span>
            </div>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white text-xl font-medium text-slate-700 shadow-sm transition active:scale-95"
              aria-label="次の月"
            >
              ›
            </button>
          </div>
        </div>

        <LiffCard>
          <div className="w-full p-2 sm:p-4">
            {/* grid-cols-7 は画面幅いっぱいに収め、セルは min-w-0 で縮小可能にする（横スクロールなし） */}
            <div className="grid w-full grid-cols-7 gap-px rounded-xl bg-slate-300/90 p-px sm:gap-0.5 sm:rounded-2xl sm:p-0.5">
              {WEEK_LABELS.map((w, wi) => (
                <div
                  key={w}
                  className={`min-w-0 rounded-lg px-0 py-2 text-center text-[10px] font-extrabold leading-none tracking-wide sm:rounded-xl sm:py-2.5 sm:text-[11px] ${weekHeaderClass(wi)}`}
                >
                  {w}
                </div>
              ))}
              {grid.map((cell, idx) => {
                const accent = cellAccent(cell.date, holidaySet);
                const accentCls =
                  accent === "hol"
                    ? "bg-red-50/98 text-red-800"
                    : accent === "sun"
                      ? "bg-rose-50/90 text-rose-700"
                      : accent === "sat"
                        ? "bg-sky-50/90 text-sky-800"
                        : "bg-white text-slate-800";

                const dayItems: CalendarMonthApiItem[] =
                  cell.dayKey && data?.byDay
                    ? (data.byDay[cell.dayKey] ?? [])
                    : [];

                const isToday = cell.dayKey === todayKey && cell.inMonth;
                const isSelected =
                  Boolean(cell.dayKey && selectedDayKey === cell.dayKey);
                const { cases: caseCount, emptySlots: emptyCount } =
                  countCasesAndSlots(dayItems);

                return (
                  <div
                    key={`${idx}-${cell.dayKey ?? "x"}`}
                    role="button"
                    tabIndex={cell.inMonth ? 0 : -1}
                    className={`flex min-h-[3.25rem] min-w-0 flex-col rounded-lg p-0.5 shadow-sm ring-1 ring-slate-200/70 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#06C755] sm:min-h-[4.25rem] sm:rounded-xl sm:p-1 ${accentCls} ${cell.inMonth ? "cursor-pointer active:brightness-[0.97]" : "cursor-default opacity-[0.42]"} ${isSelected ? "z-[1] ring-2 ring-[#06C755] ring-offset-1 ring-offset-white" : ""}`}
                    onClick={() => selectDay(cell)}
                    onKeyDown={(e) => {
                      if (!cell.inMonth) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectDay(cell);
                      }
                    }}
                  >
                    <div className="flex justify-center sm:justify-end">
                      <span
                        className={`flex size-6 items-center justify-center rounded-full text-[11px] font-bold tabular-nums leading-none sm:size-7 sm:text-[12px] ${isToday ? "bg-[#06C755] text-white shadow-sm shadow-emerald-700/25" : "bg-white/75 text-current ring-1 ring-black/[0.06]"}`}
                      >
                        {cell.dayNum}
                      </span>
                    </div>
                    <div className="mt-auto flex min-h-[18px] flex-col items-center justify-end gap-0.5 pb-0.5 sm:min-h-[22px] sm:gap-1">
                      {caseCount > 0 ? (
                        <span
                          className="inline-flex max-w-full items-center justify-center rounded-full bg-emerald-600 px-1 py-px text-[8px] font-extrabold tabular-nums leading-none text-white ring-1 ring-emerald-700/20 sm:text-[9px]"
                          title={`案件（お客様名のある工事）${caseCount}件`}
                        >
                          案件{caseCount}
                        </span>
                      ) : null}
                      {emptyCount > 0 ? (
                        <span
                          className="inline-flex max-w-full items-center justify-center rounded border border-dashed border-slate-500 bg-white px-1 py-px text-[8px] font-extrabold tabular-nums leading-none text-slate-700 sm:text-[9px]"
                          title={`工事空枠${emptyCount}件`}
                        >
                          空枠{emptyCount}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </LiffCard>

        {selectedDayKey ? (
          <section className="mt-5" aria-labelledby="day-detail-heading">
            <h2
              id="day-detail-heading"
              className="mb-3 px-1 text-[15px] font-bold text-slate-800"
            >
              {formatDayHeading(selectedDayKey)}の予定
            </h2>
            <LiffCard>
              <div className="px-4 py-4 sm:px-5">
                {selectedItems.length === 0 ? (
                  <p className="py-6 text-center text-[14px] text-slate-500">
                    この日の予定はありません
                  </p>
                ) : (
                  <div className="flex flex-col gap-6">
                    {(() => {
                      const caseItems = selectedItems.filter(
                        (i) => i.category === "list",
                      );
                      const emptyItems = selectedItems.filter(
                        (i) => i.category === "empty",
                      );

                      const renderCaseCard = (
                        item: CalendarMonthApiItem,
                        i: number,
                      ) => {
                        const hue = contractorHue(item.contractorKey);
                        const leftBorder = `4px solid hsl(${hue} 44% 46%)`;
                        return (
                          <li
                            key={`detail-${selectedDayKey}-case-${i}-${item.recordId ?? i}`}
                          >
                            <button
                              type="button"
                              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm ring-1 ring-slate-100 transition active:scale-[0.99] disabled:opacity-60"
                              style={{ borderLeft: leftBorder }}
                              disabled={!item.accessEditUrl?.trim()}
                              onClick={() => openExternal(item.accessEditUrl)}
                            >
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                <span className="inline-flex rounded-lg bg-emerald-600 px-2 py-0.5 text-[11px] font-extrabold tracking-wide text-white shadow-sm">
                                  案件
                                </span>
                                {item.housingShort ? (
                                  <span className="text-[11px] font-bold text-slate-500">
                                    {item.housingShort}
                                  </span>
                                ) : null}
                              </div>
                              <p className="text-[15px] font-bold leading-snug text-slate-900">
                                {item.line1}
                                {item.showKankoCheck ? (
                                  <span className="ml-1 text-emerald-600">
                                    ✅
                                  </span>
                                ) : null}
                              </p>
                              {item.line2 ? (
                                <p className="mt-2 text-[13px] font-semibold leading-relaxed text-slate-600">
                                  {item.line2}
                                </p>
                              ) : null}
                              {item.memo ? (
                                <p className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-[13px] leading-relaxed text-slate-700 whitespace-pre-wrap ring-1 ring-slate-100">
                                  {item.memo}
                                </p>
                              ) : null}
                              <p className="mt-3 text-[11px] font-semibold text-[#06C755]">
                                タップして @pocket で開く →
                              </p>
                            </button>
                          </li>
                        );
                      };

                      return (
                        <>
                          {caseItems.length > 0 ? (
                            <div>
                              <h3 className="mb-2 flex items-center gap-2 px-0.5 text-[12px] font-extrabold uppercase tracking-wider text-emerald-800">
                                <span
                                  className="size-2 rounded-full bg-emerald-600"
                                  aria-hidden
                                />
                                案件（お客様名のある工事）
                              </h3>
                              <ul className="flex flex-col gap-3">
                                {caseItems.map((item, i) =>
                                  renderCaseCard(item, i),
                                )}
                              </ul>
                            </div>
                          ) : null}

                          {emptyItems.length > 0 ? (
                            <div>
                              <h3 className="mb-2 flex items-center gap-2 px-0.5 text-[12px] font-extrabold uppercase tracking-wider text-slate-600">
                                <span
                                  className="size-2 rounded border border-dashed border-slate-500 bg-slate-100"
                                  aria-hidden
                                />
                                工事空枠
                              </h3>
                              <ul className="flex flex-col gap-3">
                                {emptyItems.map((item, i) => (
                                  <li
                                    key={`detail-${selectedDayKey}-empty-${i}-${item.recordId ?? i}`}
                                  >
                                    <EmptySlotCard
                                      item={item}
                                      idToken={idToken}
                                      onSaved={async () => {
                                        const t = idToken;
                                        if (!t) return;
                                        await loadCalendar(t, ym.year, ym.month);
                                      }}
                                    />
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            </LiffCard>
          </section>
        ) : null}
          </div>
        </div>
        <LiffDirectUrlLinks
          className="mt-6"
          links={[
            { path: "/", label: "メニュー（トップ）" },
            { path: "/customer-info", label: "お客様情報入力" },
            { path: "/calendar", label: "工事カレンダー（このページ）" },
          ]}
        />
      </div>
    </LiffScreen>
  );
}
