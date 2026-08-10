"use client";

import { useEffect, useMemo, useState } from "react";

import { parseFortuneHeadline } from "@/components/fortune-rank-badge";
import { HomeCompactSummaries } from "@/components/home-compact-summaries";
import { HomeConstructionHandlerCases } from "@/components/home-construction-handler-cases";
import { HomeDailyOmikujiCard } from "@/components/home-daily-omikuji-card";
// 【一時的な調査用】確認が済んだら削除すること（sales-target-probe-panel.tsx 参照）
import { SalesTargetProbePanel } from "@/components/sales-target-probe-panel";
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
import { useDailyOmikujiShownToday } from "@/hooks/use-daily-omikuji-shown-today";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import { buildDailyBusinessFortuneView } from "@/lib/home-business-fortune";
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

function InternalEventGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 2v3M16 2v3M3.5 9.09h17M21 8.5V17c0 3-1.5 5-5 5H8c-3.5 0-5-2-5-5V8.5c0-3 1.5-5 5-5h8c3.5 0 5 2 5 5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 13l1.5 3h-3L12 13z"
        stroke="currentColor"
        strokeWidth="1.6"
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

function WorkEndReportGlyph() {
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
        d="M9 9l6 6M15 9l-6 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BulletinGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="3"
        y="4"
        width="18"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M7 9h10M7 13h7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="18" cy="6" r="2.4" fill="currentColor" />
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
  const [omikujiExpanded, setOmikujiExpanded] = useState(false);
  const [isBulletinBoardVisible, setIsBulletinBoardVisible] = useState(true);

  const account = useLiffAccountStrip(idToken, phase === "ready");
  const needsStaffBind =
    account.bindingEnabled &&
    !account.boundStaffName &&
    !account.loading &&
    account.staff.length > 0;
  const omikujiShownToday = useDailyOmikujiShownToday(
    needsStaffBind ? null : account.boundStaffName,
  );
  const fortuneRank = useMemo(() => {
    if (!omikujiShownToday || !account.boundStaffName?.trim()) return null;
    const view = buildDailyBusinessFortuneView(account.boundStaffName, {
      department: account.boundStaffDepartment,
      staffRole: account.boundStaffRole,
    });
    return parseFortuneHeadline(view.headline).rank;
  }, [
    omikujiShownToday,
    account.boundStaffName,
    account.boundStaffDepartment,
    account.boundStaffRole,
  ]);

  useEffect(() => {
    if (!fortuneRank) setOmikujiExpanded(false);
  }, [fortuneRank]);

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
                fortuneRank={fortuneRank}
                fortuneExpanded={omikujiExpanded}
                onFortuneToggle={
                  fortuneRank
                    ? () => setOmikujiExpanded((v) => !v)
                    : undefined
                }
              />
            </div>
          }
        />

        {isBulletinBoardVisible ? (
          <div className="mt-4">
            {!needsStaffBind ? (
              <HomeCompactSummaries
                idToken={idToken}
                boundStaffName={account.boundStaffName}
                lineUserId={account.lineUserId}
                disabled={false}
                onClose={() => setIsBulletinBoardVisible(false)}
              >
                <HomeConstructionHandlerCases
                  idToken={idToken}
                  boundStaffName={account.boundStaffName}
                  disabled={needsStaffBind || account.loading}
                />
              </HomeCompactSummaries>
            ) : account.boundStaffName ? (
              <p className="text-[15px] font-semibold text-slate-800 dark:text-white">
                {account.boundStaffName} さん、おつかれさまです
              </p>
            ) : null}
          </div>
        ) : !needsStaffBind ? (
          <button
            type="button"
            onClick={() => setIsBulletinBoardVisible(true)}
            className="mt-4 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-[13px] font-semibold text-slate-700 shadow-sm transition-colors active:scale-[0.99] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            aria-label="掲示板を再表示"
          >
            掲示板（タップで表示）
          </button>
        ) : account.boundStaffName ? (
          <p className="mt-4 text-[15px] font-semibold text-slate-800 dark:text-white">
            {account.boundStaffName} さん、おつかれさまです
          </p>
        ) : null}

        <div className="mt-4 flex flex-col gap-3">
          {!needsStaffBind ? (
            <HomeDailyOmikujiCard
              staffName={account.boundStaffName}
              department={account.boundStaffDepartment}
              staffRole={account.boundStaffRole}
              expanded={omikujiExpanded}
            />
          ) : null}
        </div>

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
                  営業ダッシュボード・勤怠管理・稼働終了報告・社内イベント・コミュニケーションブリッジを表示します。
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
                  href="/work-end-report"
                  title="稼働終了報告"
                  description="@pocket に本日分の稼働終了報告を登録します。"
                  icon={<WorkEndReportGlyph />}
                  iconTone="blue"
                  disabled={needsStaffBind}
                />
                <LiffMenuCard
                  href="/internal-events"
                  title="社内イベント"
                  description="朝礼の流れ（水曜日以外）・連絡先・トラーチの文化など社内情報を確認します。"
                  icon={<InternalEventGlyph />}
                  iconTone="blue"
                  disabled={needsStaffBind}
                />
                <LiffMenuCard
                  href="/bulletin"
                  title="掲示板"
                  description="社内のお知らせをカテゴリ別に確認します。"
                  icon={<BulletinGlyph />}
                  iconTone="blue"
                  disabled={needsStaffBind}
                />
                <LiffMenuCard
                  href="/communication-bridge"
                  title="コミュニケーションブリッジ"
                  icon={<CommunicationBridgeGlyph />}
                  iconTone="blue"
                  disabled={needsStaffBind}
                />
              </div>
            ) : null}
          </div>
        </div>

        {/*
          【一時的な調査用】目標登録アプリの構成を確認するためのボタン。
          調査が済んだら、この1行と import、components/sales-target-probe-panel.tsx、
          app/api/%5Fprobe/sales-target/route.ts をまとめて削除すること。
          PROBE_ENABLED が無効なら調査ルートが 404 を返し、何も表示されない。
        */}
        <SalesTargetProbePanel idToken={idToken} />
      </main>
    </LiffScreen>
  );
}
