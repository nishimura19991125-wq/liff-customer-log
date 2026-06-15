"use client";

import { useEffect, useState } from "react";

import { HomeDailyOmikujiCard } from "@/components/home-daily-omikuji-card";
import { HomeMissingDocumentsAlert } from "@/components/home-missing-documents-alert";
import { NewsMarquee } from "@/components/news-marquee";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  LiffAccountBar,
  LiffCard,
  LiffContinueShortcutLink,
  LiffLoadingBlock,
  LiffMenuCard,
  LiffPageHeader,
  LiffScreen,
  LiffSessionExpiredPanel,
  LiffStaffBindPanel,
  LiffStaffBindingConfigNotice,
} from "@/components/liff-chrome";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import { initLiffAndGetToken } from "@/lib/liff-session";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";

type ContinueShortcut = {
  recordId: string;
  customerName: string;
  subtitle?: string;
};

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

function CalendarGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 2v3M16 2v3M3.5 9.09h17M21 8.5V17c0 3-1.5 5-5 5H8c-3.5 0-5-2-5-5V8.5c0-3 1.5-5 5-5h8c3.5 0 5 2 5 5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CustomerInfoGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 12h6m-6 4h4m6 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CustomerListGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SalesDashboardGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AttendanceGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M12 7v5l3 2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InternalCommonGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M9 13h1M9 17h1M14 9h1M14 13h1M14 17h1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CommunicationBridgeGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 10h8M8 14h5M7 18l-3 2V6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H9l-2 2z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function HomeHubPage() {
  const [phase, setPhase] = useState<"init" | "need-login" | "ready" | "error">(
    () => (LIFF_ID ? "init" : "error"),
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    LIFF_ID ? null : "NEXT_PUBLIC_LIFF_ID が設定されていません",
  );
  const [idToken, setIdToken] = useState<string | null>(null);
  const [continueShortcuts, setContinueShortcuts] = useState<
    ContinueShortcut[]
  >([]);
  const [internalMenuOpen, setInternalMenuOpen] = useState(false);

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

  useEffect(() => {
    if (
      phase !== "ready" ||
      !idToken ||
      needsStaffBind ||
      account.loading ||
      !account.boundStaffName
    ) {
      setContinueShortcuts([]);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/customer-info/continue-shortcut", {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = (await res.json()) as {
          shortcuts?: ContinueShortcut[];
          error?: string;
        };
        if (cancelled) return;
        if (res.status === 401 && isLineSessionExpiredPayload(data)) {
          setContinueShortcuts([]);
          return;
        }
        setContinueShortcuts(data.shortcuts ?? []);
      } catch {
        if (!cancelled) setContinueShortcuts([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [phase, idToken, needsStaffBind, account.loading, account.boundStaffName]);

  if (phase === "init" || phase === "need-login") {
    return (
      <LiffLoadingBlock
        message={
          phase === "need-login"
            ? "LINE でログインしています"
            : "アプリを起動しています"
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
              <p className="text-[15px] leading-relaxed text-red-700 whitespace-pre-wrap">
                {errorMessage}
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-8 rounded-xl px-6 py-3 text-[14px] font-semibold text-slate-700 underline underline-offset-2 dark:text-slate-300"
              >
                再読み込み
              </button>
            </div>
          </LiffCard>
        </div>
      </LiffScreen>
    );
  }

  if (phase === "ready" && account.sessionExpired) {
    return <LiffSessionExpiredPanel />;
  }

  return (
    <LiffScreen>
      <main className="liff-page-main mx-auto w-full max-w-lg flex-1 py-6">
        <LiffPageHeader
          title="情報確認くん"
          subtitle={
            needsStaffBind
              ? "先にスタッフ名簿と紐づけてから、メニューをお選びください"
              : "メニューから利用する機能を選んでください"
          }
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

        <NewsMarquee
          staffName={account.boundStaffName}
          className="-mx-4 mb-4 sm:-mx-5"
        />

        {account.boundStaffName && !needsStaffBind ? (
          <p className="mt-4 text-[15px] font-semibold text-slate-800 dark:text-white">
            {account.boundStaffName} さん、おつかれさまです
          </p>
        ) : null}

        {!needsStaffBind ? (
          <HomeDailyOmikujiCard staffName={account.boundStaffName} />
        ) : null}

        <HomeMissingDocumentsAlert
          idToken={idToken}
          boundStaffName={account.boundStaffName}
          disabled={needsStaffBind || account.loading}
        />

        <LiffStaffBindingConfigNotice message={account.bindingConfigError} />
        <LiffStaffBindPanel
          staff={account.staff}
          bindingEnabled={account.bindingEnabled}
          boundStaffName={account.boundStaffName}
          accountLoading={account.loading}
          onBind={account.bindStaff}
        />

        <div className="mt-6 flex flex-col gap-4">
          <LiffMenuCard
            href="/calendar"
            title="工事カレンダー"
            description="工事予定を月表示で確認し、詳細から @pocket を開けます。"
            icon={<CalendarGlyph />}
            disabled={needsStaffBind}
          />
          <div className="flex flex-col gap-2">
            <LiffMenuCard
              href="/customer-info"
              title="お客様情報入力"
              description="お客様名で検索し、@pocket のレコードを編集します。"
              icon={<CustomerInfoGlyph />}
              disabled={needsStaffBind}
            />
            <LiffMenuCard
              href="/customer-list"
              title="担当顧客一覧"
              description="担当案件の書類・工事日・補助金を一覧で確認します。"
              icon={<CustomerListGlyph />}
              disabled={needsStaffBind}
            />
            {continueShortcuts.length > 0 ? (
              <div className="flex flex-col gap-2" role="list">
                {continueShortcuts.map((row) => (
                  <LiffContinueShortcutLink
                    key={row.recordId}
                    href={`/customer-info?recordId=${encodeURIComponent(row.recordId)}`}
                    customerName={row.customerName}
                    subtitle={row.subtitle}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setInternalMenuOpen((open) => !open)}
              disabled={needsStaffBind}
              aria-expanded={internalMenuOpen}
              aria-controls="internal-common-menu"
              className={`cyber-card group flex w-full items-stretch gap-4 p-5 text-left text-slate-800 transition-all duration-300 active:scale-[0.99] dark:text-slate-100 dark:hover:shadow-[0_0_14px_rgba(16,185,129,0.12)] ${
                needsStaffBind ? "cursor-not-allowed opacity-45" : ""
              }`}
            >
              <span className="flex size-[3.25rem] shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100/70 text-blue-500 text-[1.65rem] leading-none dark:from-blue-950/80 dark:to-blue-900/50 dark:text-blue-400">
                <InternalCommonGlyph />
              </span>
              <div className="min-w-0 flex-1 py-0.5">
                <p className="text-[1.05rem] font-bold leading-snug text-slate-800 dark:text-slate-100">
                  社内共通
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
                  営業ダッシュボード・勤怠管理・コミュニケーションブリッジカレンダーを表示します。
                </p>
              </div>
              <span
                className={`self-center text-xl font-light text-slate-400 transition-transform duration-200 dark:text-slate-500 ${
                  internalMenuOpen ? "rotate-90" : ""
                }`}
                aria-hidden
              >
                ›
              </span>
            </button>
            {internalMenuOpen ? (
              <div
                id="internal-common-menu"
                className="flex flex-col gap-2 pl-2"
              >
                <LiffMenuCard
                  href="/sales-dashboard"
                  title="営業ダッシュボード"
                  description="当月の売上KPIや営業成績ランキングをリアルタイムで確認します。"
                  icon={<SalesDashboardGlyph />}
                  iconTone="blue"
                  disabled={needsStaffBind}
                />
                <LiffMenuCard
                  href="/attendance"
                  title="勤怠管理"
                  description="出勤・退勤を打刻し、@pocket の勤怠アプリに記録します。"
                  icon={<AttendanceGlyph />}
                  iconTone="blue"
                  disabled={needsStaffBind}
                />
                <LiffMenuCard
                  href="/communication-bridge"
                  title="コミュニケーションブリッジカレンダー"
                  description="工事カレンダーと同じ月表示で予定を確認し、@pocket の案件を開けます。"
                  icon={<CommunicationBridgeGlyph />}
                  iconTone="blue"
                  disabled={needsStaffBind}
                />
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </LiffScreen>
  );
}
