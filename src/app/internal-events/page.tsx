"use client";

import { useEffect, useState } from "react";

import {
  LiffAccountBar,
  LiffCard,
  LiffGhostLink,
  LiffPageHeader,
  LiffScreen,
  LiffSessionExpiredPanel,
  LiffStaffBindPanel,
  LiffStaffBindingConfigNotice,
} from "@/components/liff-chrome";
import { ThemeToggle } from "@/components/theme-toggle";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import { initLiffAndGetToken } from "@/lib/liff-session";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

export default function InternalEventsPage() {
  const [phase, setPhase] = useState<
    "init" | "need-login" | "ready" | "error" | "session-expired"
  >(() => (LIFF_ID ? "init" : "error"));
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
    void (async () => {
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

  if (phase === "init" || phase === "need-login") {
    return (
      <LiffScreen>
        <LiffPageHeader title="社内イベント" />
        <p className="py-10 text-center text-[14px] text-slate-500">
          {phase === "need-login" ? "LINE ログインへ移動しています…" : "読み込み中…"}
        </p>
      </LiffScreen>
    );
  }

  if (phase === "error") {
    return (
      <LiffScreen>
        <LiffPageHeader title="社内イベント" />
        <p className="py-10 text-center text-[14px] text-red-700">{errorMessage}</p>
        <LiffGhostLink href="/">ホームへ</LiffGhostLink>
      </LiffScreen>
    );
  }

  if (phase === "session-expired") {
    return (
      <LiffScreen>
        <LiffPageHeader title="社内イベント" />
        <LiffSessionExpiredPanel />
        <LiffGhostLink href="/">ホームへ</LiffGhostLink>
      </LiffScreen>
    );
  }

  return (
    <LiffScreen>
      <LiffPageHeader
        title="社内イベント"
        subtitle="社内イベントの情報を確認します"
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
      <LiffStaffBindingConfigNotice message={account.bindingConfigError} />
      <LiffStaffBindPanel
        staff={account.staff}
        bindingEnabled={account.bindingEnabled}
        boundStaffName={account.boundStaffName}
        accountLoading={account.loading}
        onBind={account.bindStaff}
      />
      {needsStaffBind ? null : (
        <div className="mt-6">
          <LiffCard>
            <div className="px-5 py-6">
              <p className="text-[15px] font-semibold text-slate-800 dark:text-slate-100">
                社内イベント
              </p>
              <p className="mt-2 text-[14px] leading-relaxed text-slate-600 dark:text-slate-400">
                社内イベントの一覧・詳細は今後ここに表示します。
              </p>
            </div>
          </LiffCard>
        </div>
      )}
      <div className="mt-6">
        <LiffGhostLink href="/">ホームへ</LiffGhostLink>
      </div>
    </LiffScreen>
  );
}
