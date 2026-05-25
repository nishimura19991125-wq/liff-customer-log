"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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
        <p className="text-sm text-rose-600">{errorMessage}</p>
        <LiffGhostLink href="/">トップへ戻る</LiffGhostLink>
      </LiffScreen>
    );
  }

  return (
    <LiffScreen>
      <LiffPageHeader
        title="担当顧客一覧"
        subtitle="自分の担当案件の書類・工事日・補助金を一覧で確認"
        action={
          <LiffGhostLink href="/">トップ</LiffGhostLink>
        }
      />

      <LiffAccountBar
        loading={account.loading}
        pictureUrl={account.pictureUrl}
        boundStaffName={account.boundStaffName}
        bindingEnabled={account.bindingEnabled}
      />

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
          <nav
            className="mb-4 flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]"
            aria-label="絞り込み"
          >
            {FILTER_TABS.map((tab) => {
              const active = filter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={`shrink-0 rounded-2xl px-4 py-3 text-[15px] font-semibold transition active:scale-[0.98] ${
                    active
                      ? "bg-slate-900 text-white shadow-md"
                      : "border border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {listLoading ? (
            <LiffLoadingBlock message="案件を読み込み中…" />
          ) : (
            <div className="flex flex-col gap-3">
              {listFeedback && customers.length === 0 ? (
                <p className="rounded-xl bg-slate-50 px-4 py-3 text-center text-sm text-slate-600">
                  {listFeedback}
                </p>
              ) : null}

              {customers.map((row) => (
                <Link
                  key={row.recordId}
                  href={`/customer-list/${encodeURIComponent(row.recordId)}`}
                  className="block min-h-[4.5rem] rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition active:scale-[0.99] active:bg-slate-50"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-bold leading-snug text-slate-900">
                        {row.customerName}
                      </p>
                      {row.subtitle ? (
                        <p className="mt-1 text-sm text-slate-500">{row.subtitle}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {row.isDocumentMissing ? (
                      <span className="inline-flex items-center rounded-xl bg-rose-100 px-3 py-1.5 text-[13px] font-semibold text-rose-800">
                        ⚠️ 書類未回収
                      </span>
                    ) : null}
                    {row.isSubsidyTarget && row.combinedSubsidyName ? (
                      <span
                        className="inline-flex max-w-full min-w-0 items-center rounded-xl bg-sky-100 px-3 py-1.5 text-[12px] font-semibold text-sky-900 sm:text-[13px]"
                        title={`補助金: ${row.combinedSubsidyName}`}
                      >
                        <span className="truncate">
                          💰 補助金: {row.combinedSubsidyName}
                        </span>
                      </span>
                    ) : null}
                    {row.isConstructionDateUnset ? (
                      <span className="inline-flex items-center rounded-xl bg-amber-100 px-3 py-1.5 text-[13px] font-semibold text-amber-900">
                        ⏳ 工事日未定
                      </span>
                    ) : null}
                  </div>
                </Link>
              ))}
            </div>
          )}
      </div>
    </LiffScreen>
  );
}
