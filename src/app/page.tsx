"use client";

import liff from "@line/liff";
import { useEffect, useState } from "react";

import {
  LiffAccountBar,
  LiffCard,
  LiffLoadingBlock,
  LiffMenuCard,
  LiffPageHeader,
  LiffScreen,
  LiffStaffBindPanel,
} from "@/components/liff-chrome";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";

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

function LogGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 2v6h6M16 13H8M16 17H8M10 9H8"
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
                className="mt-8 rounded-xl px-6 py-3 text-[14px] font-semibold text-slate-700 underline underline-offset-2"
              >
                再読み込み
              </button>
            </div>
          </LiffCard>
        </div>
      </LiffScreen>
    );
  }

  return (
    <LiffScreen>
      <main className="mx-auto w-full max-w-lg flex-1 py-6">
        <LiffAccountBar
          loading={account.loading}
          displayName={account.displayName}
          pictureUrl={account.pictureUrl}
          lineUserId={account.lineUserId}
          boundStaffName={account.boundStaffName}
          bindingEnabled={account.bindingEnabled}
        />
        <LiffStaffBindPanel
          staff={account.staff}
          bindingEnabled={account.bindingEnabled}
          boundStaffName={account.boundStaffName}
          accountLoading={account.loading}
          onBind={account.bindStaff}
        />
        <LiffPageHeader
          title="情報確認くん"
          subtitle={
            needsStaffBind
              ? "先にスタッフ名簿と紐づけてから、メニューをお選びください"
              : "メニューから利用する機能を選んでください"
          }
        />

        <div className="mt-6 flex flex-col gap-4">
          <LiffMenuCard
            href="/log"
            title="顧客対応ログ入力"
            description="担当者・顧客名・対応内容を記録して送信します。"
            icon={<LogGlyph />}
            disabled={needsStaffBind}
          />
          <LiffMenuCard
            href="/calendar"
            title="工事カレンダー"
            description="工事予定を月表示で確認し、詳細から @pocket を開けます。"
            icon={<CalendarGlyph />}
            disabled={needsStaffBind}
          />
        </div>
      </main>
    </LiffScreen>
  );
}
