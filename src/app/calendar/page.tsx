"use client";

import liff from "@line/liff";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  LiffAccountBar,
  LiffCard,
  LiffGhostLink,
  LiffLoadingBlock,
  LiffScreen,
  LiffSessionExpiredPanel,
  LiffStaffBindPanel,
  LiffStaffBindingConfigNotice,
} from "@/components/liff-chrome";
import { MapNavigationButton } from "@/components/map-navigation-button";
import { NewsMarquee } from "@/components/news-marquee";
import { ThemeToggle } from "@/components/theme-toggle";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import { applyCalendarRecordPatch } from "@/lib/calendar-apply-patch";
import type {
  CalendarApiPayload,
  CalendarMonthApiItem,
  CalendarRecordMonthPatch,
} from "@/lib/calendar-api-types";
import {
  EMPTY_FILL_HOUSING_STATUS_NEW_BUILD,
  EMPTY_FILL_HOUSING_STATUS_VALUES,
} from "@/lib/calendar-empty-fill-options";
import { isLiffSwrSessionExpired, liffAuthedJsonFetch } from "@/lib/liff-swr";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";
import { initLiffAndGetToken, refreshLiffIdToken } from "@/lib/liff-session";
import { mergeStaffNameOptions } from "@/lib/staff-name-options";

type HandlerStaffRow = {
  staffRecordId: string;
  name: string;
  label: string;
};

function parseConstructionHandlerStaffApiPayload(payload: {
  handlers?: unknown;
  registrants?: unknown;
}): HandlerStaffRow[] {
  const raw = payload.handlers ?? payload.registrants;
  if (!Array.isArray(raw)) return [];
  const out: HandlerStaffRow[] = [];
  for (const x of raw) {
    if (typeof x !== "object" || x === null) continue;
    const o = x as Record<string, unknown>;
    const sid =
      typeof o.staffRecordId === "string"
        ? o.staffRecordId.trim()
        : o.staffRecordId != null
          ? String(o.staffRecordId).trim()
          : "";
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const label =
      typeof o.label === "string" ? o.label.trim() : name;
    if (!sid || !name) continue;
    out.push({ staffRecordId: sid, name, label: label || name });
  }
  return out;
}

const HANDLER_STAFF_SELECT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] text-slate-900 shadow-inner outline-none ring-1 ring-slate-100 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200";

/** `type="date"` 専用（見た目は HANDLER_STAFF_SELECT_CLASS と揃え、globals.css で iOS/Android 調整） */
const CALENDAR_DATE_INPUT_CLASS = "calendar-date-input";

function ConstructionHandlerStaffSelect({
  submitting,
  canSubmit,
  handlerListStatus,
  handlerListError,
  handlerRows,
  selectedHandlerStaffId,
  setSelectedHandlerStaffId,
}: {
  submitting: boolean;
  canSubmit: boolean;
  handlerListStatus: "idle" | "loading" | "ok" | "err";
  handlerListError: string;
  handlerRows: HandlerStaffRow[];
  selectedHandlerStaffId: string;
  setSelectedHandlerStaffId: (id: string) => void;
}) {
  const selectDisabled =
    submitting ||
    !canSubmit ||
    handlerListStatus === "idle" ||
    handlerListStatus === "loading" ||
    handlerListStatus === "err" ||
    (handlerListStatus === "ok" && handlerRows.length === 0);

  let placeholder = "選択してください";
  if (handlerListStatus === "idle" || handlerListStatus === "loading") {
    placeholder = "読み込み中…";
  } else if (handlerListStatus === "err") {
    placeholder = "取得できませんでした";
  } else if (handlerRows.length === 0) {
    placeholder = "該当する社員がありません";
  }

  return (
    <label className="mt-3 block">
      <span className="mb-1 block text-[12px] font-bold text-slate-700">
        工事対応者{" "}
        <span className="font-semibold text-red-600">必須</span>
        <span className="block text-[11px] font-normal leading-snug text-slate-500">
          スタッフ名簿のうち、工事対応稼働状況が「稼働」の社員のみ表示します。
        </span>
      </span>
      <select
        className={HANDLER_STAFF_SELECT_CLASS}
        aria-label="工事対応者"
        value={selectedHandlerStaffId}
        onChange={(e) => setSelectedHandlerStaffId(e.target.value)}
        disabled={selectDisabled}
      >
        <option value="">{placeholder}</option>
        {handlerListStatus === "ok"
          ? handlerRows.map((row) => (
              <option key={row.staffRecordId} value={row.staffRecordId}>
                {row.label}
              </option>
            ))
          : null}
      </select>
      {handlerListStatus === "err" && handlerListError ? (
        <p className="mt-1 text-[12px] leading-relaxed text-red-700">
          {handlerListError}
        </p>
      ) : null}
      {handlerListStatus === "ok" && handlerRows.length === 0 ? (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-900 ring-1 ring-amber-100">
          工事対応稼働状況が「稼働」の社員がありません。@pocket
          のスタッフ名簿を確認してください。
        </p>
      ) : null}
    </label>
  );
}

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

function calendarSubmitCatchMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (
    e instanceof TypeError ||
    /failed to fetch|networkerror|load failed|network/i.test(msg)
  ) {
    return "通信に失敗しました。処理に時間がかかりすぎた可能性があります。工事アプリに登録されている場合はカレンダーを更新して確認してください。";
  }
  return msg.trim() || "通信に失敗しました";
}

async function idTokenForConstructionSubmit(
  current: string | null,
  onSessionExpired?: () => void,
): Promise<string | null> {
  if (LIFF_ID) {
    const fresh = await refreshLiffIdToken(LIFF_ID);
    if (!fresh) {
      onSessionExpired?.();
      return null;
    }
    return fresh;
  }
  return current;
}

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
  if (i === 0) {
    return "text-red-600 bg-red-50/95 dark:text-red-200 dark:bg-red-950/60";
  }
  if (i === 6) {
    return "text-sky-700 bg-sky-50/95 dark:text-sky-200 dark:bg-sky-950/60";
  }
  return "text-slate-600 bg-white/95 dark:text-white dark:bg-slate-800/90";
}

function countDayBadges(items: CalendarMonthApiItem[]): {
  newBuild: number;
  existing: number;
  emptySlots: number;
} {
  let newBuild = 0;
  let existing = 0;
  let emptySlots = 0;
  for (const x of items) {
    if (x.category === "empty") {
      emptySlots += 1;
      continue;
    }
    if (x.housingShort === "新築") newBuild += 1;
    else if (x.housingShort === "既築") existing += 1;
  }
  return { newBuild, existing, emptySlots };
}

function EmptySlotCard({
  item,
  idToken,
  viewYear,
  viewMonth,
  onSaved,
  onSessionExpired,
  constructionHandlerUsesStaffDirectory,
}: {
  item: CalendarMonthApiItem;
  idToken: string | null;
  viewYear: number;
  viewMonth: number;
  onSaved: (patch?: CalendarRecordMonthPatch | null) => Promise<void>;
  onSessionExpired?: () => void;
  /** undefined: 工事対応者なし。true: スタッフ名簿。false: 工事対応者フィールドのみ設定でスタッフ側不足 */
  constructionHandlerUsesStaffDirectory?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [housingStatus, setHousingStatus] = useState<string>("");
  const [selectedHandlerStaffId, setSelectedHandlerStaffId] =
    useState("");
  const [handlerRows, setHandlerRows] = useState<HandlerStaffRow[]>([]);
  const [handlerListStatus, setHandlerListStatus] = useState<
    "idle" | "loading" | "ok" | "err"
  >("idle");
  const [handlerListError, setHandlerListError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);
  const [shigumiDate, setShigumiDate] = useState("");
  const [panelWorkDate, setPanelWorkDate] = useState("");
  const [electricWorkDate, setElectricWorkDate] = useState("");
  const [appSettingsDayDate, setAppSettingsDayDate] = useState("");

  const handlerFromStaff =
    constructionHandlerUsesStaffDirectory === true;
  const handlerMisconfigured =
    constructionHandlerUsesStaffDirectory === false;

  const rid = item.recordId?.trim();
  const canSubmit = Boolean(rid && idToken);

  const isNewBuildHousing =
    housingStatus === EMPTY_FILL_HOUSING_STATUS_NEW_BUILD;

  useEffect(() => {
    if (housingStatus !== EMPTY_FILL_HOUSING_STATUS_NEW_BUILD) {
      setShigumiDate("");
      setPanelWorkDate("");
      setElectricWorkDate("");
      setAppSettingsDayDate("");
    }
  }, [housingStatus]);

  useEffect(() => {
    if (!open || !idToken || !handlerFromStaff) {
      if (!open) {
        setSelectedHandlerStaffId("");
        setHandlerRows([]);
        setHandlerListStatus("idle");
        setHandlerListError("");
      }
      return;
    }

    let cancelled = false;

    (async () => {
      setSelectedHandlerStaffId("");
      setHandlerRows([]);
      setHandlerListStatus("loading");
      setHandlerListError("");
      try {
        const res = await fetch("/api/calendar/construction-handler-staff", {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = (await res.json()) as {
          handlers?: unknown;
          registrants?: unknown;
          error?: string;
        };
        if (cancelled) return;
        if (res.status === 401 && isLineSessionExpiredPayload(data)) {
          onSessionExpired?.();
          setHandlerListStatus("err");
          setHandlerListError(
            "ログインの有効期限が切れました。画面を更新してください。",
          );
          return;
        }
        if (!res.ok) {
          setHandlerListStatus("err");
          setHandlerListError(
            typeof data.error === "string"
              ? data.error
              : "工事対応者リストを取得できませんでした",
          );
          return;
        }
        setHandlerRows(parseConstructionHandlerStaffApiPayload(data));
        setHandlerListStatus("ok");
      } catch {
        if (!cancelled) {
          setHandlerListStatus("err");
          setHandlerListError("通信に失敗しました");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, idToken, handlerFromStaff, onSessionExpired]);

  const handlerBlocking =
    handlerMisconfigured ||
    (handlerFromStaff &&
      (handlerListStatus !== "ok" ||
        handlerRows.length === 0 ||
        !selectedHandlerStaffId.trim()));

  async function handleSubmit() {
    if (!rid) return;
    const name = customerName.trim();
    const hs = housingStatus.trim();
    if (!name || !hs) return;
    if (handlerFromStaff) {
      if (handlerListStatus !== "ok" || handlerRows.length === 0) return;
      if (!selectedHandlerStaffId.trim()) return;
    }
    if (handlerMisconfigured) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const token = await idTokenForConstructionSubmit(idToken, onSessionExpired);
      if (!token) return;
      const res = await fetch("/api/calendar/fill-empty-slot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          recordId: rid,
          customerName: name,
          housingStatus: hs,
          viewYear,
          viewMonth,
          ...(handlerFromStaff
            ? {
                constructionHandlerStaffRecordId:
                  selectedHandlerStaffId.trim(),
              }
            : {}),
          ...(hs === EMPTY_FILL_HOUSING_STATUS_NEW_BUILD
            ? {
                ...(shigumiDate.trim()
                  ? { shigumiDate: shigumiDate.trim() }
                  : {}),
                ...(panelWorkDate.trim()
                  ? { panelWorkDate: panelWorkDate.trim() }
                  : {}),
                ...(electricWorkDate.trim()
                  ? { electricWorkDate: electricWorkDate.trim() }
                  : {}),
                ...(appSettingsDayDate.trim()
                  ? { appSettingsDayDate: appSettingsDayDate.trim() }
                  : {}),
              }
            : {}),
        }),
      });
      const rawBody = await res.text();
      let data: {
        error?: string;
        customerInfoSynced?: boolean;
        constructionSaved?: boolean;
        calendarPatch?: CalendarRecordMonthPatch;
      } = {};
      if (rawBody.trim()) {
        try {
          data = JSON.parse(rawBody) as typeof data;
        } catch {
          data = {};
        }
      }
      if (!res.ok) {
        if (res.status === 401 && isLineSessionExpiredPayload(data)) {
          onSessionExpired?.();
          return;
        }
        if (data.constructionSaved) {
          setCustomerName("");
          setHousingStatus("");
          setSelectedHandlerStaffId("");
          setShigumiDate("");
          setPanelWorkDate("");
          setElectricWorkDate("");
          setAppSettingsDayDate("");
          setOpen(false);
          try {
            await onSaved(data.calendarPatch ?? null);
          } catch {
            /* 保存済みのため UI はエラー表示を優先 */
          }
        }
        const gatewayTimeout =
          res.status === 504 ||
          res.status === 408 ||
          (res.status === 502 && !data.error?.trim() && !data.constructionSaved);
        setFeedback({
          kind: "err",
          text:
            data.error?.trim() ||
            (gatewayTimeout
              ? "処理がタイムアウトしたか、サーバーが応答を返せませんでした。工事アプリに登録されている可能性があります。カレンダーを更新して確認してください。"
              : data.constructionSaved
                ? "工事アプリへの保存は完了しましたが、お客様情報アプリへの連携に失敗しました。"
                : `保存に失敗しました（HTTP ${res.status}）。しばらくしてから再度お試しください。`),
        });
        return;
      }
      setCustomerName("");
      setHousingStatus("");
      setSelectedHandlerStaffId("");
      setShigumiDate("");
      setPanelWorkDate("");
      setElectricWorkDate("");
      setAppSettingsDayDate("");
      setOpen(false);
      try {
        await onSaved(data.calendarPatch ?? null);
      } catch (e) {
        setFeedback({ kind: "err", text: calendarSubmitCatchMessage(e) });
        return;
      }
      setFeedback({
        kind: "ok",
        text: data.customerInfoSynced
          ? "保存しました。@pocket に反映し、お客様情報アプリにも連携しました。"
          : "保存しました。@pocket にも反映済みです。",
      });
    } catch (e) {
      setFeedback({ kind: "err", text: calendarSubmitCatchMessage(e) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-w-0 rounded-2xl border-2 border-dashed border-slate-400/75 bg-slate-50/95 px-4 py-4 shadow-inner shadow-slate-200/40 ring-1 ring-slate-200/70">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-full border border-dashed border-slate-400/70 bg-slate-200/90 px-2 py-0.5 text-[9px] font-extrabold tracking-wide text-slate-700 ring-1 ring-white/80">
          工事空枠
        </span>
      </div>
      <p className="text-[17px] font-bold leading-snug text-slate-900 sm:text-lg">
        {item.line1}
        {item.showKankoCheck ? (
          <span className="ml-1 text-xl text-emerald-600 sm:text-[1.35rem]">
            ✅
          </span>
        ) : null}
      </p>
      {item.line2 ? (
        <p className="mt-2 text-[15px] font-semibold leading-relaxed text-slate-600 sm:text-base">
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
        <div className="mt-4 min-w-0 border-t border-slate-200/90 pt-4">
          <p className="mb-3 text-[12px] leading-relaxed text-slate-600">
            {isNewBuildHousing ? (
              <>
                住宅ステータスが「新築案件」のときは、お客様名に加えて工事日程を任意で指定できます（未入力でも保存できます）。工事対応者フィールドが有効な場合のみ工事対応者は必須です。その他は
                @pocket の編集画面で入力してください。
              </>
            ) : (
              <>
                住宅ステータス・お客様名・工事対応者（設定時）を登録すると、@pocket
                のレコードが更新され、カレンダーでは「案件」として表示されます。その他の項目は
                @pocket の編集画面で入力してください。
              </>
            )}
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
          {isNewBuildHousing ? (
            <>
              <p className="mt-4 mb-2 text-[12px] font-bold text-slate-700">
                工事日程
                <span className="font-medium text-slate-500">
                  {" "}
                  （すべて任意・カレンダーから選択）
                </span>
              </p>
              <label className="block">
                <span className="mb-1 block text-[12px] font-bold text-slate-700">
                  仕込日
                </span>
                <div className="construction-schedule-date-field">
                  <input
                    type="date"
                    className={CALENDAR_DATE_INPUT_CLASS}
                    value={shigumiDate}
                    onChange={(e) => setShigumiDate(e.target.value)}
                    disabled={submitting || !canSubmit}
                  />
                </div>
              </label>
              <label className="mt-3 block">
                <span className="mb-1 block text-[12px] font-bold text-slate-700">
                  パネル工事日
                </span>
                <div className="construction-schedule-date-field">
                  <input
                    type="date"
                    className={CALENDAR_DATE_INPUT_CLASS}
                    value={panelWorkDate}
                    onChange={(e) => setPanelWorkDate(e.target.value)}
                    disabled={submitting || !canSubmit}
                  />
                </div>
              </label>
              <label className="mt-3 block">
                <span className="mb-1 block text-[12px] font-bold text-slate-700">
                  電気工事日
                </span>
                <div className="construction-schedule-date-field">
                  <input
                    type="date"
                    className={CALENDAR_DATE_INPUT_CLASS}
                    value={electricWorkDate}
                    onChange={(e) => setElectricWorkDate(e.target.value)}
                    disabled={submitting || !canSubmit}
                  />
                </div>
              </label>
              <label className="mt-3 block">
                <span className="mb-1 block text-[12px] font-bold text-slate-700">
                  アプリ設定日
                </span>
                <div className="construction-schedule-date-field">
                  <input
                    type="date"
                    className={CALENDAR_DATE_INPUT_CLASS}
                    value={appSettingsDayDate}
                    onChange={(e) => setAppSettingsDayDate(e.target.value)}
                    disabled={submitting || !canSubmit}
                  />
                </div>
              </label>
            </>
          ) : null}
          {handlerMisconfigured ? (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[12px] font-semibold leading-relaxed text-amber-900 ring-1 ring-amber-100">
              工事対応者にスタッフ名簿を使うには、STAFF_APP_ID・STAFF_NAME_FIELD_ID・STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID
              を設定してください。
            </p>
          ) : null}
          {handlerFromStaff ? (
            <ConstructionHandlerStaffSelect
              submitting={submitting}
              canSubmit={canSubmit}
              handlerListStatus={handlerListStatus}
              handlerListError={handlerListError}
              handlerRows={handlerRows}
              selectedHandlerStaffId={selectedHandlerStaffId}
              setSelectedHandlerStaffId={setSelectedHandlerStaffId}
            />
          ) : null}
          <button
            type="button"
            className="mt-4 w-full rounded-xl bg-slate-800 py-3 text-[14px] font-bold text-white shadow-sm transition active:scale-[0.99] disabled:opacity-50"
            disabled={
              submitting ||
              !customerName.trim() ||
              !housingStatus.trim() ||
              !canSubmit ||
              handlerBlocking
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
  viewYear,
  viewMonth,
  onSaved,
  onSessionExpired,
}: {
  idToken: string | null;
  open: boolean;
  onToggleOpen: () => void;
  viewYear: number;
  viewMonth: number;
  onSaved: (patch?: CalendarRecordMonthPatch | null) => Promise<void>;
  onSessionExpired?: () => void;
}) {
  const [customerName, setCustomerName] = useState("");
  const [housingStatus, setHousingStatus] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);
  const [shigumiDate, setShigumiDate] = useState("");
  const [panelWorkDate, setPanelWorkDate] = useState("");
  const [electricWorkDate, setElectricWorkDate] = useState("");
  const [appSettingsDayDate, setAppSettingsDayDate] = useState("");
  const [scheduledStartDate, setScheduledStartDate] = useState("");
  const [contractor, setContractor] = useState("");
  const [contractorOptions, setContractorOptions] = useState<string[]>([]);
  const [contractorOptionsLoading, setContractorOptionsLoading] =
    useState(false);
  const [contractorOptionsConfigured, setContractorOptionsConfigured] =
    useState(false);

  const canSubmit = Boolean(idToken);

  const isNewBuildHousing =
    housingStatus === EMPTY_FILL_HOUSING_STATUS_NEW_BUILD;

  useEffect(() => {
    if (housingStatus !== EMPTY_FILL_HOUSING_STATUS_NEW_BUILD) {
      setShigumiDate("");
      setPanelWorkDate("");
      setElectricWorkDate("");
      setAppSettingsDayDate("");
    }
  }, [housingStatus]);

  useEffect(() => {
    if (!idToken || !open) {
      setContractorOptions([]);
      setContractorOptionsLoading(false);
      setContractorOptionsConfigured(false);
      return;
    }
    let cancelled = false;
    setContractorOptionsLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/calendar/construction-contractors", {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = (await res.json()) as {
          options?: string[];
          configured?: boolean;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setContractorOptions([]);
          setContractorOptionsConfigured(false);
          return;
        }
        setContractorOptions(data.options ?? []);
        setContractorOptionsConfigured(data.configured !== false);
      } catch {
        if (!cancelled) {
          setContractorOptions([]);
          setContractorOptionsConfigured(false);
        }
      } finally {
        if (!cancelled) setContractorOptionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idToken, open]);

  const contractorSelectOptions = useMemo(
    () => mergeStaffNameOptions(contractorOptions, contractor),
    [contractorOptions, contractor],
  );

  async function handleSubmit() {
    const name = customerName.trim();
    const hs = housingStatus.trim();
    if (!name || !hs) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const token = await idTokenForConstructionSubmit(idToken, onSessionExpired);
      if (!token) return;
      const res = await fetch("/api/calendar/create-record", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          customerName: name,
          housingStatus: hs,
          viewYear,
          viewMonth,
          ...(scheduledStartDate.trim()
            ? { scheduledStartDate: scheduledStartDate.trim() }
            : {}),
          ...(contractor.trim() ? { contractor: contractor.trim() } : {}),
          ...(hs === EMPTY_FILL_HOUSING_STATUS_NEW_BUILD
            ? {
                ...(shigumiDate.trim()
                  ? { shigumiDate: shigumiDate.trim() }
                  : {}),
                ...(panelWorkDate.trim()
                  ? { panelWorkDate: panelWorkDate.trim() }
                  : {}),
                ...(electricWorkDate.trim()
                  ? { electricWorkDate: electricWorkDate.trim() }
                  : {}),
                ...(appSettingsDayDate.trim()
                  ? { appSettingsDayDate: appSettingsDayDate.trim() }
                  : {}),
              }
            : {}),
        }),
      });
      const rawBody = await res.text();
      let data: {
        error?: string;
        customerInfoSynced?: boolean;
        constructionSaved?: boolean;
        calendarPatch?: CalendarRecordMonthPatch;
      } = {};
      if (rawBody.trim()) {
        try {
          data = JSON.parse(rawBody) as typeof data;
        } catch {
          data = {};
        }
      }
      if (!res.ok) {
        if (res.status === 401 && isLineSessionExpiredPayload(data)) {
          onSessionExpired?.();
          return;
        }
        if (data.constructionSaved) {
          setCustomerName("");
          setHousingStatus("");
          setShigumiDate("");
          setPanelWorkDate("");
          setElectricWorkDate("");
          setAppSettingsDayDate("");
          setScheduledStartDate("");
          setContractor("");
          await onSaved(data.calendarPatch ?? null);
        }
        const gatewayTimeout =
          res.status === 504 ||
          res.status === 408 ||
          (res.status === 502 && !data.error?.trim() && !data.constructionSaved);
        const fallback = gatewayTimeout
          ? "処理がタイムアウトしたか、サーバーが応答を返せませんでした。工事アプリに登録されている可能性があります。カレンダーを更新して確認してください。"
          : data.constructionSaved
            ? "工事アプリへの登録は完了しましたが、お客様情報アプリへの連携に失敗しました。"
            : `登録に失敗しました（HTTP ${res.status}）。しばらくしてから再度お試しください。`;
        setFeedback({
          kind: "err",
          text: data.error?.trim() || fallback,
        });
        return;
      }
      setCustomerName("");
      setHousingStatus("");
      setShigumiDate("");
      setPanelWorkDate("");
      setElectricWorkDate("");
      setAppSettingsDayDate("");
      setScheduledStartDate("");
      setContractor("");
      try {
        await onSaved(data.calendarPatch ?? null);
      } catch (e) {
        setFeedback({ kind: "err", text: calendarSubmitCatchMessage(e) });
        return;
      }
      setFeedback({
        kind: "ok",
        text: data.customerInfoSynced
          ? "登録しました。@pocket で T番号が採番され、お客様情報アプリにも連携しました。"
          : "登録しました。@pocket で T番号が採番されています。",
      });
    } catch (e) {
      setFeedback({ kind: "err", text: calendarSubmitCatchMessage(e) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm ring-1 ring-slate-100">
      <button
        type="button"
        className="w-full rounded-xl bg-[#06C755] px-2 py-3 text-[12px] font-bold leading-none tracking-tight text-white shadow-sm transition active:scale-[0.99] whitespace-nowrap sm:text-[13px]"
        onClick={() => {
          onToggleOpen();
          setFeedback(null);
        }}
      >
        {open ? "閉じる" : "新規登録"}
      </button>

      {open ? (
        <div className="mt-4 min-w-0 border-t border-slate-200/90 pt-4">
          <p className="mb-3 text-[12px] leading-relaxed text-slate-600">
            工事日未定案件や、工事日程を都度調整する案件をここから登録します。住宅ステータス・お客様名は必須です。施工予定日・施工会社は任意です。
            {isNewBuildHousing
              ? " 新築案件のときは仕込日などの工事日程も任意で指定できます。"
              : null}
            T番号は @pocket の自動採番により付与されます。
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
          <label className="mt-3 block">
            <span className="mb-1 block text-[12px] font-bold text-slate-700">
              施工予定日
              <span className="font-medium text-slate-500"> （任意）</span>
            </span>
            <div className="construction-schedule-date-field">
              <input
                type="date"
                className={CALENDAR_DATE_INPUT_CLASS}
                value={scheduledStartDate}
                onChange={(e) => setScheduledStartDate(e.target.value)}
                disabled={submitting || !canSubmit}
              />
            </div>
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-[12px] font-bold text-slate-700">
              施工会社
              <span className="font-medium text-slate-500"> （任意）</span>
            </span>
            <select
              className={HANDLER_STAFF_SELECT_CLASS}
              value={contractor}
              onChange={(e) => setContractor(e.target.value)}
              disabled={submitting || !canSubmit || contractorOptionsLoading}
            >
              <option value="">
                {contractorOptionsLoading
                  ? "一覧を読み込み中…"
                  : contractorOptionsConfigured
                    ? "選択してください"
                    : "一覧を取得できません"}
              </option>
              {contractorSelectOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              {contractorOptionsLoading
                ? "取引先会社一覧を読み込み中…"
                : contractorOptionsConfigured
                  ? "取引先会社一覧（会社種別＝施工店・取引状況＝取引中）から選択"
                  : "TRADING_PARTNER_APP_ID および取引先列の環境変数を確認してください"}
            </p>
          </label>
          {isNewBuildHousing ? (
            <>
              <p className="mt-4 mb-2 text-[12px] font-bold text-slate-700">
                工事日程
                <span className="font-medium text-slate-500">
                  {" "}
                  （すべて任意・カレンダーから選択）
                </span>
              </p>
              <label className="block">
                <span className="mb-1 block text-[12px] font-bold text-slate-700">
                  仕込日
                </span>
                <div className="construction-schedule-date-field">
                  <input
                    type="date"
                    className={CALENDAR_DATE_INPUT_CLASS}
                    value={shigumiDate}
                    onChange={(e) => setShigumiDate(e.target.value)}
                    disabled={submitting || !canSubmit}
                  />
                </div>
              </label>
              <label className="mt-3 block">
                <span className="mb-1 block text-[12px] font-bold text-slate-700">
                  パネル工事日
                </span>
                <div className="construction-schedule-date-field">
                  <input
                    type="date"
                    className={CALENDAR_DATE_INPUT_CLASS}
                    value={panelWorkDate}
                    onChange={(e) => setPanelWorkDate(e.target.value)}
                    disabled={submitting || !canSubmit}
                  />
                </div>
              </label>
              <label className="mt-3 block">
                <span className="mb-1 block text-[12px] font-bold text-slate-700">
                  電気工事日
                </span>
                <div className="construction-schedule-date-field">
                  <input
                    type="date"
                    className={CALENDAR_DATE_INPUT_CLASS}
                    value={electricWorkDate}
                    onChange={(e) => setElectricWorkDate(e.target.value)}
                    disabled={submitting || !canSubmit}
                  />
                </div>
              </label>
              <label className="mt-3 block">
                <span className="mb-1 block text-[12px] font-bold text-slate-700">
                  アプリ設定日
                </span>
                <div className="construction-schedule-date-field">
                  <input
                    type="date"
                    className={CALENDAR_DATE_INPUT_CLASS}
                    value={appSettingsDayDate}
                    onChange={(e) => setAppSettingsDayDate(e.target.value)}
                    disabled={submitting || !canSubmit}
                  />
                </div>
              </label>
            </>
          ) : null}
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
    | "init"
    | "need-login"
    | "loading"
    | "ready"
    | "error"
    | "disabled"
    | "session-expired"
  >(() => (LIFF_ID ? "init" : "error"));
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    LIFF_ID ? null : "NEXT_PUBLIC_LIFF_ID が設定されていません",
  );
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [newRecordOpen, setNewRecordOpen] = useState(false);
  const [idToken, setIdToken] = useState<string | null>(null);

  const calendarPath = useMemo(() => {
    if (!idToken) return null;
    const qs = new URLSearchParams({
      year: String(ym.year),
      month: String(ym.month),
    });
    return `/api/calendar?${qs}`;
  }, [idToken, ym.year, ym.month]);

  const {
    data,
    error: calendarError,
    isLoading: calendarLoading,
    mutate: mutateCalendar,
  } = useLiffSwr<CalendarApiPayload>(calendarPath, idToken);

  useEffect(() => {
    if (!idToken) return;
    if (calendarError) {
      if (isLiffSwrSessionExpired(calendarError)) {
        setPhase("session-expired");
        return;
      }
      if (calendarError.status === 503) {
        const body = calendarError.body as { error?: string } | null;
        setErrorMessage(
          body?.error ??
            "工事カレンダーは環境変数 CALENDAR_APP_ID 設定後に利用できます。",
        );
        setPhase("disabled");
        return;
      }
      setErrorMessage(calendarError.message);
      setPhase("error");
      return;
    }
    if (data) {
      setErrorMessage(null);
      setPhase("ready");
    } else if (calendarLoading) {
      setPhase("loading");
      setErrorMessage(null);
    }
  }, [idToken, data, calendarError, calendarLoading]);

  const applyCalendarSaveToView = useCallback(
    async (patch?: CalendarRecordMonthPatch | null) => {
      const t = idToken;
      if (!t) return;
      if (patch) {
        void mutateCalendar(
          (prev) => (prev ? applyCalendarRecordPatch(prev, patch) : prev),
          { revalidate: false },
        );
        const primaryDay = patch.dayKeys[0];
        if (primaryDay) setSelectedDayKey(primaryDay);
      }
      const qs = new URLSearchParams({
        year: String(ym.year),
        month: String(ym.month),
        refresh: "1",
      });
      await mutateCalendar(
        () =>
          liffAuthedJsonFetch<CalendarApiPayload>(
            `/api/calendar?${qs}`,
            t,
          ),
        { revalidate: false },
      );
    },
    [idToken, ym.year, ym.month, mutateCalendar],
  );

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
        const result = await initLiffAndGetToken(LIFF_ID);
        if (cancelled) return;
        if (result.status === "redirecting") {
          setPhase("need-login");
          return;
        }
        setIdToken(result.token);
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

  if (phase === "session-expired" || (phase === "ready" && account.sessionExpired)) {
    return (
      <LiffSessionExpiredPanel
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
      <div className="liff-page-main mx-auto w-full max-w-xl flex-1 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
        <div className="mb-4 flex flex-col gap-4">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-800 active:opacity-70 dark:text-emerald-300"
            >
              <span className="text-lg leading-none">‹</span>
              メニューへ
            </Link>
            <div className="mt-3 flex items-start justify-between gap-3">
              <h1 className="min-w-0 flex-1 text-[1.35rem] font-bold leading-tight tracking-tight text-slate-900 dark:text-white">
                工事カレンダー
              </h1>
              <div className="flex shrink-0 items-start gap-2 pt-0.5">
                <ThemeToggle />
                <LiffAccountBar
                  loading={account.loading}
                  pictureUrl={account.pictureUrl}
                  boundStaffName={account.boundStaffName}
                  bindingEnabled={account.bindingEnabled}
                />
              </div>
            </div>
            <p className="mt-1 text-[14px] leading-snug text-slate-500 dark:text-slate-300">
              日付をタップで下に一覧表示。工事空枠は「情報を入力」からお客様名を登録できます。案件は
              @pocket を開けます。
            </p>
          </div>
        </div>

        <NewsMarquee
          staffName={account.boundStaffName}
          className="-mx-4 mb-4 sm:-mx-0"
        />

        <LiffStaffBindingConfigNotice message={account.bindingConfigError} />
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
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 ring-1 ring-slate-200/80">
              <span className="size-1.5 rounded-full bg-[#06C755]" aria-hidden />
              <span className="font-bold text-slate-700">今日</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 font-bold text-blue-900 ring-1 ring-blue-100">
              <span className="rounded bg-blue-500 px-1 py-px text-[8px] font-extrabold text-white">
                新
              </span>
              <span className="font-semibold text-blue-800/95">新築工事</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 font-bold text-orange-900 ring-1 ring-orange-100">
              <span className="rounded bg-orange-500 px-1 py-px text-[8px] font-extrabold text-white">
                既
              </span>
              <span className="font-semibold text-orange-800/95">既築工事</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-400/80 bg-slate-100/90 px-2 py-0.5 text-[10px] font-bold text-slate-700 ring-1 ring-slate-200/60">
              点線枠
              <span className="font-semibold text-slate-600">
                工事空枠がある日
              </span>
            </span>
          </div>

          <NewConstructionRecordPanel
            idToken={idToken}
            open={newRecordOpen}
            onToggleOpen={() => setNewRecordOpen((o) => !o)}
            viewYear={ym.year}
            viewMonth={ym.month}
            onSaved={applyCalendarSaveToView}
            onSessionExpired={() => setPhase("session-expired")}
          />

          <div className="flex items-center gap-2 rounded-2xl bg-slate-200/55 p-1.5 shadow-inner dark:bg-slate-800/80">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white text-xl font-medium text-slate-700 shadow-sm transition active:scale-95 dark:bg-slate-700 dark:text-white dark:shadow-none"
              aria-label="前の月"
            >
              ‹
            </button>
            <div className="min-w-0 flex-1 text-center">
              <span className="text-[1.05rem] font-bold tabular-nums text-slate-800 dark:text-white">
                {ym.year}年 {ym.month}月
              </span>
            </div>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white text-xl font-medium text-slate-700 shadow-sm transition active:scale-95 dark:bg-slate-700 dark:text-white dark:shadow-none"
              aria-label="次の月"
            >
              ›
            </button>
          </div>
        </div>

        <LiffCard>
          <div className="w-full p-2 sm:p-4">
            {/* grid-cols-7 は画面幅いっぱいに収め、セルは min-w-0 で縮小可能にする（横スクロールなし） */}
            <div className="grid w-full grid-cols-7 gap-px rounded-xl bg-slate-300/90 p-px dark:bg-slate-600/80 sm:gap-0.5 sm:rounded-2xl sm:p-0.5">
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
                const accentClsBase =
                  accent === "hol"
                    ? "bg-red-50/98 text-red-800 dark:bg-red-950/70 dark:text-red-100"
                    : accent === "sun"
                      ? "bg-rose-50/90 text-rose-700 dark:bg-rose-950/60 dark:text-rose-100"
                      : accent === "sat"
                        ? "bg-sky-50/90 text-sky-800 dark:bg-sky-950/60 dark:text-sky-100"
                        : "bg-white text-slate-800 dark:bg-slate-800/95 dark:text-white";

                const dayItems: CalendarMonthApiItem[] =
                  cell.dayKey && data?.byDay
                    ? (data.byDay[cell.dayKey] ?? [])
                    : [];

                const isToday = cell.dayKey === todayKey && cell.inMonth;
                const isSelected =
                  Boolean(cell.dayKey && selectedDayKey === cell.dayKey);
                const {
                  newBuild: newBuildCount,
                  existing: existingCount,
                  emptySlots: emptyCount,
                } = countDayBadges(dayItems);

                const hasEmptySlots = cell.inMonth && emptyCount > 0;
                const accentCls = hasEmptySlots
                  ? accent === "hol"
                    ? "bg-red-50/88 text-red-900 dark:bg-red-950/65 dark:text-red-100"
                    : accent === "sun"
                      ? "bg-rose-50/88 text-rose-900 dark:bg-rose-950/55 dark:text-rose-100"
                      : accent === "sat"
                        ? "bg-sky-50/88 text-sky-900 dark:bg-sky-950/55 dark:text-sky-100"
                        : "bg-slate-100/98 text-slate-800 dark:bg-slate-700/90 dark:text-white"
                  : accentClsBase;

                const cellFrameCls = hasEmptySlots
                  ? "border-2 border-dashed border-slate-400/70 shadow-inner shadow-slate-200/30"
                  : "shadow-sm ring-1 ring-slate-200/70";

                return (
                  <div
                    key={`${idx}-${cell.dayKey ?? "x"}`}
                    role="button"
                    tabIndex={cell.inMonth ? 0 : -1}
                    className={`flex min-h-[3.25rem] min-w-0 flex-col rounded-lg p-0.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#06C755] sm:min-h-[4.25rem] sm:rounded-xl sm:p-1 ${accentCls} ${cellFrameCls} ${cell.inMonth ? "cursor-pointer active:brightness-[0.97]" : "cursor-default opacity-[0.42]"} ${isSelected ? "z-[1] ring-2 ring-[#06C755] ring-offset-1 ring-offset-white dark:ring-offset-slate-900" : ""}`}
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
                        className={`flex size-6 items-center justify-center rounded-full text-[11px] font-bold tabular-nums leading-none sm:size-7 sm:text-[12px] ${isToday ? "bg-[#06C755] text-white shadow-sm shadow-emerald-700/25" : "bg-white/75 text-current ring-1 ring-black/[0.06] dark:bg-slate-900/50 dark:ring-white/10"}`}
                      >
                        {cell.dayNum}
                      </span>
                    </div>
                    <div className="mt-auto flex min-h-[18px] flex-wrap items-center justify-center gap-0.5 pb-0.5 sm:min-h-[22px] sm:gap-1">
                      {newBuildCount > 0 ? (
                        <span
                          className="inline-flex max-w-[48%] shrink-0 items-center justify-center rounded bg-blue-500 px-1 py-[1px] text-[7px] font-bold tabular-nums leading-none text-white sm:max-w-none sm:text-[10px]"
                          title={`新築工事 ${newBuildCount}件`}
                        >
                          新{newBuildCount}
                        </span>
                      ) : null}
                      {existingCount > 0 ? (
                        <span
                          className="inline-flex max-w-[48%] shrink-0 items-center justify-center rounded bg-orange-500 px-1 py-[1px] text-[7px] font-bold tabular-nums leading-none text-white sm:max-w-none sm:text-[10px]"
                          title={`既築工事 ${existingCount}件`}
                        >
                          既{existingCount}
                        </span>
                      ) : null}
                      {emptyCount > 0 ? (
                        <span
                          className="inline-flex max-w-full items-center justify-center rounded-full border border-dashed border-slate-500/55 bg-slate-200/95 px-1.5 py-[2px] text-[7px] font-extrabold tabular-nums leading-none text-slate-700 ring-1 ring-white/60 sm:text-[8px]"
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
              className="mb-3 px-1 text-[15px] font-bold text-slate-800 dark:text-white"
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
                            <div
                              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100"
                              style={{ borderLeft: leftBorder }}
                            >
                              <button
                                type="button"
                                className="w-full px-4 py-4 text-left transition active:scale-[0.99] active:bg-slate-50 disabled:opacity-60"
                                disabled={!item.accessEditUrl?.trim()}
                                onClick={() => openExternal(item.accessEditUrl)}
                              >
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                  <span className="inline-flex rounded-full bg-emerald-600 px-2 py-0.5 text-[9px] font-extrabold tracking-wide text-white shadow-sm ring-1 ring-emerald-800/20">
                                    案件
                                  </span>
                                  {item.housingShort ? (
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 ring-1 ring-slate-200/80">
                                      {item.housingShort}
                                    </span>
                                  ) : null}
                                </div>
                                <p className="text-[17px] font-bold leading-snug text-slate-900 sm:text-lg">
                                  {item.line1}
                                  {item.showKankoCheck ? (
                                    <span className="ml-1 text-xl text-emerald-600 sm:text-[1.35rem]">
                                      ✅
                                    </span>
                                  ) : null}
                                </p>
                                {item.line2 ? (
                                  <p className="mt-2 text-[15px] font-semibold leading-relaxed text-slate-600 sm:text-base">
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
                              <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                                <MapNavigationButton
                                  pinpointAddress={item.pinpointAddress}
                                  normalAddress={item.normalAddress}
                                />
                              </div>
                            </div>
                          </li>
                        );
                      };

                      return (
                        <>
                          {caseItems.length > 0 ? (
                            <div>
                              <h3 className="mb-2 px-0.5">
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-emerald-900 ring-1 ring-emerald-200/90">
                                  <span
                                    className="size-1.5 shrink-0 rounded-full bg-emerald-600"
                                    aria-hidden
                                  />
                                  案件（お客様名のある工事）
                                </span>
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
                              <h3 className="mb-2 px-0.5">
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-slate-400/70 bg-slate-200/85 px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-slate-700 ring-1 ring-white/70">
                                  <span
                                    className="size-1.5 shrink-0 rounded-sm border border-dashed border-slate-500 bg-white"
                                    aria-hidden
                                  />
                                  工事空枠
                                </span>
                              </h3>
                              <ul className="flex flex-col gap-3">
                                {emptyItems.map((item, i) => (
                                  <li
                                    key={`detail-${selectedDayKey}-empty-${i}-${item.recordId ?? i}`}
                                  >
                                    <EmptySlotCard
                                      item={item}
                                      idToken={idToken}
                                      viewYear={ym.year}
                                      viewMonth={ym.month}
                                      constructionHandlerUsesStaffDirectory={
                                        data?.emptyFillConstructionHandlerUsesStaffDirectory ??
                                        data?.emptyFillConstructionRegistrantUsesStaffDirectory
                                      }
                                      onSaved={applyCalendarSaveToView}
                                      onSessionExpired={() =>
                                        setPhase("session-expired")
                                      }
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
      </div>
    </LiffScreen>
  );
}
