"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import {
  LiffAccountBar,
  LiffGhostLink,
  LiffLoadingBlock,
  LiffPageHeader,
  LiffScreen,
  LiffSessionExpiredPanel,
  LiffStaffBindPanel,
  LiffStaffBindingConfigNotice,
} from "@/components/liff-chrome";
import { resetLiffScroll } from "@/components/liff-scroll-reset";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import { initLiffAndGetToken } from "@/lib/liff-session";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

type CrmFilter = "all" | "missing_docs" | "no_construction_date" | "subsidy";

type CustomerRow = {
  recordId: string;
  customerName: string;
  subtitle: string;
  isDocumentMissing: boolean;
  isSubsidyTarget: boolean;
  combinedSubsidyName: string | null;
  isConstructionDateUnset: boolean;
};

const FILTER_TABS: Array<{ id: CrmFilter; label: string }> = [
  { id: "all", label: "すべて" },
  { id: "missing_docs", label: "未回収あり" },
  { id: "no_construction_date", label: "工事日未定" },
  { id: "subsidy", label: "補助金対象" },
];

function ChevronRightIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function CustomerListPage() {
  const [phase, setPhase] = useState<
    | "init"
    | "need-login"
    | "loading"
    | "ready"
    | "error"
    | "session-expired"
  >(() => (LIFF_ID ? "init" : "error"));
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    LIFF_ID ? null : "NEXT_PUBLIC_LIFF_ID が設定されていません",
  );
  const [idToken, setIdToken] = useState<string | null>(null);
  const [filter, setFilter] = useState<CrmFilter>("all");
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listFeedback, setListFeedback] = useState<string | null>(null);

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

  const loadCustomers = useCallback(
    async (token: string, nextFilter: CrmFilter) => {
      setListLoading(true);
      setListFeedback(null);
      try {
        const res = await fetch(
          `/api/customers?filter=${encodeURIComponent(nextFilter)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const data = (await res.json()) as {
          customers?: CustomerRow[];
          error?: string;
          disabled?: boolean;
          needsStaffBind?: boolean;
        };
        if (isLineSessionExpiredPayload(data)) {
          setPhase("session-expired");
          return;
        }
        if (!res.ok) {
          setListFeedback(data.error ?? "一覧の取得に失敗しました");
          setCustomers([]);
          return;
        }
        if (data.needsStaffBind) {
          setCustomers([]);
          return;
        }
        setCustomers(data.customers ?? []);
        if ((data.customers?.length ?? 0) === 0) {
          setListFeedback("該当する案件はありません");
        }
      } catch (e) {
        console.error(e);
        setListFeedback("通信エラーが発生しました");
        setCustomers([]);
      } finally {
        setListLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (phase !== "ready" || !idToken || needsStaffBind) return;
    void loadCustomers(idToken, filter);
  }, [phase, idToken, filter, needsStaffBind, loadCustomers]);

  useEffect(() => {
    if (phase === "ready") resetLiffScroll();
  }, [phase, filter]);

  if (phase === "init" || phase === "loading") {
    return (
      <LiffScreen>
        <LiffLoadingBlock message="読み込み中…" />
      </LiffScreen>
    );
  }

  if (phase === "session-expired") {
    return (
      <LiffScreen>
        <LiffSessionExpiredPanel />
      </LiffScreen>
    );
  }

  if (phase === "error") {
    return (
      <LiffScreen>
        <LiffPageHeader title="担当顧客一覧" />
        <p className="text-sm text-rose-600 dark:text-rose-400">{errorMessage}</p>
        <LiffGhostLink href="/">メニューへ</LiffGhostLink>
      </LiffScreen>
    );
  }

  return (
    <LiffScreen>
      <LiffPageHeader
        title="担当顧客一覧"
        subtitle="自分の担当案件の書類・工事日・補助金を一覧で確認"
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

      <div className="mb-4">
        <LiffGhostLink href="/">メニューへ</LiffGhostLink>
      </div>

      <LiffStaffBindingConfigNotice message={account.bindingConfigError} />
      <LiffStaffBindPanel
        staff={account.staff}
        bindingEnabled={account.bindingEnabled}
        boundStaffName={account.boundStaffName}
        accountLoading={account.loading}
        onBind={account.bindStaff}
      />

      <div
        className={
          needsStaffBind
            ? "pointer-events-none opacity-[0.35] saturate-50"
            : undefined
        }
      >
          <div className="relative mb-4">
            <nav
              className="flex gap-2 overflow-x-auto pb-2 pl-0.5 pr-10 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              aria-label="絞り込み"
            >
              {FILTER_TABS.map((tab) => {
                const active = filter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilter(tab.id)}
                    className={`shrink-0 rounded-2xl px-4 py-2.5 text-[15px] transition-all duration-300 active:scale-[0.98] ${
                      active
                        ? "bg-emerald-600 font-bold text-white shadow-md shadow-emerald-600/25"
                        : "bg-slate-100 font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </nav>
            <div
              className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-slate-50 to-transparent dark:from-slate-900"
              aria-hidden
            />
          </div>

          {listLoading ? (
            <LiffLoadingBlock message="案件を読み込み中…" />
          ) : (
            <div className="flex flex-col gap-3">
              {listFeedback && customers.length === 0 ? (
                <p className="rounded-xl bg-slate-50 px-4 py-3 text-center text-sm text-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
                  {listFeedback}
                </p>
              ) : null}

              {customers.map((row) => (
                <Link
                  key={row.recordId}
                  href={`/customer-list/${encodeURIComponent(row.recordId)}`}
                  className="group flex min-h-[4.5rem] items-stretch gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition-all duration-300 active:scale-[0.99] active:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:shadow-none dark:active:bg-slate-700/80"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-bold leading-snug text-slate-800 dark:text-white">
                      {row.customerName}
                    </p>
                    {row.subtitle ? (
                      <p className="mt-1 text-xs text-slate-400">{row.subtitle}</p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {row.isDocumentMissing ? (
                        <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-1 text-xs font-medium text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
                          ⚠ 書類未回収
                        </span>
                      ) : null}
                      {row.isSubsidyTarget && row.combinedSubsidyName ? (
                        <span
                          className="inline-flex max-w-full min-w-0 items-center rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-900 dark:bg-sky-950/50 dark:text-sky-200"
                          title={`補助金: ${row.combinedSubsidyName}`}
                        >
                          <span className="truncate">
                            💰 補助金: {row.combinedSubsidyName}
                          </span>
                        </span>
                      ) : null}
                      {row.isConstructionDateUnset ? (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                          ⌛ 工事日未定
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <span
                    className="flex size-9 shrink-0 items-center justify-center self-center rounded-full bg-slate-100 text-slate-400 transition-colors duration-300 group-active:bg-slate-200 dark:bg-slate-700/80 dark:text-slate-500 dark:group-active:bg-slate-600"
                    aria-hidden
                  >
                    <ChevronRightIcon />
                  </span>
                </Link>
              ))}
            </div>
          )}
      </div>
    </LiffScreen>
  );
}
