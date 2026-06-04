"use client";

import { useEffect, useState } from "react";

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
        </div>
      </main>
    </LiffScreen>
  );
}
