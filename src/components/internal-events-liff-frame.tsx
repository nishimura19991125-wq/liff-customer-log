"use client";

import { useEffect, useState, type ReactNode } from "react";

import {
  LiffAccountBar,
  LiffGhostLink,
  LiffPageHeader,
  LiffScreen,
  LiffSessionExpiredPanel,
  LiffStaffBindPanel,
  LiffStaffBindingConfigNotice,
} from "@/components/liff-chrome";
import { ThemeToggle } from "@/components/theme-toggle";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import { LiffIdTokenProvider } from "@/lib/liff-id-token-context";
import { initLiffAndGetToken } from "@/lib/liff-session";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

export function InternalEventsLiffFrame({
  title,
  subtitle,
  children,
  backHref = "/internal-events",
  backLabel = "社内イベントへ",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  const [phase, setPhase] = useState<
    "init" | "need-login" | "ready" | "error" | "session-expired"
  >(() => (LIFF_ID ? "init" : "error"));
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    LIFF_ID ? null : "NEXT_PUBLIC_LIFF_ID が設定されていません",
  );
  const [idToken, setIdToken] = useState<string | null>(null);

  const account = useLiffAccountStrip(idToken, phase === "ready");

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
        <LiffPageHeader title={title} />
        <p className="py-10 text-center text-[14px] text-slate-500">
          {phase === "need-login" ? "LINE ログインへ移動しています…" : "読み込み中…"}
        </p>
      </LiffScreen>
    );
  }

  if (phase === "error") {
    return (
      <LiffScreen>
        <LiffPageHeader title={title} />
        <p className="py-10 text-center text-[14px] text-red-700">{errorMessage}</p>
        <LiffGhostLink href={backHref}>{backLabel}</LiffGhostLink>
      </LiffScreen>
    );
  }

  if (phase === "session-expired") {
    return (
      <LiffScreen>
        <LiffPageHeader title={title} />
        <LiffSessionExpiredPanel />
        <LiffGhostLink href={backHref}>{backLabel}</LiffGhostLink>
      </LiffScreen>
    );
  }

  return (
    <LiffScreen>
      <LiffPageHeader
        title={title}
        subtitle={subtitle}
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
      <LiffIdTokenProvider idToken={idToken}>{children}</LiffIdTokenProvider>
      <div className="mt-6 flex flex-col gap-3">
        {backHref !== "/" ? (
          <LiffGhostLink href={backHref}>{backLabel}</LiffGhostLink>
        ) : null}
        <LiffGhostLink href="/">ホームへ</LiffGhostLink>
      </div>
    </LiffScreen>
  );
}
