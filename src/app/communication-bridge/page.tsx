"use client";

import liff from "@line/liff";
import { useEffect, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import {
  LiffAccountBar,
  LiffCard,
  LiffGhostLink,
  LiffLoadingBlock,
  LiffPageHeader,
  LiffPrimaryButton,
  LiffScreen,
  LiffSessionExpiredPanel,
  LiffStaffBindPanel,
  LiffStaffBindingConfigNotice,
} from "@/components/liff-chrome";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import { isLiffSwrSessionExpired } from "@/lib/liff-swr";
import { initLiffAndGetToken } from "@/lib/liff-session";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();
const APP_NAME = "コミュニケーションブリッジカレンダー";

type BridgeApiBody = {
  configured?: boolean;
  disabled?: boolean;
  appName?: string;
  portalUrl?: string;
  error?: string;
};

function openAtPocketUrl(url: string) {
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

export default function CommunicationBridgePage() {
  const [phase, setPhase] = useState<
    "init" | "need-login" | "ready" | "error" | "session-expired"
  >(() => (LIFF_ID ? "init" : "error"));
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    LIFF_ID ? null : "NEXT_PUBLIC_LIFF_ID が設定されていません",
  );
  const [idToken, setIdToken] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const account = useLiffAccountStrip(idToken, phase === "ready");
  const needsStaffBind =
    account.bindingEnabled &&
    !account.boundStaffName &&
    !account.loading &&
    account.staff.length > 0;

  const canFetchBridge =
    Boolean(idToken) &&
    (!account.bindingEnabled ||
      Boolean(account.boundStaffName) ||
      (!account.loading && account.staff.length === 0));

  const { data, error: swrError, isLoading } = useLiffSwr<BridgeApiBody>(
    canFetchBridge ? "/api/communication-bridge" : null,
    idToken,
  );

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
    if (!swrError || phase !== "ready") return;
    if (isLiffSwrSessionExpired(swrError)) {
      setPhase("session-expired");
      return;
    }
    setFeedback(swrError.message);
  }, [swrError, phase]);

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
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-red-700">
                {errorMessage}
              </p>
            </div>
          </LiffCard>
        </div>
      </LiffScreen>
    );
  }

  if (phase === "session-expired") {
    return <LiffSessionExpiredPanel />;
  }

  const portalUrl = data?.portalUrl?.trim() ?? "";
  const configured = Boolean(data?.configured && portalUrl);
  const disabledMessage =
    data?.error ??
    "Netlify の環境変数（COMMUNICATION_BRIDGE_CALENDAR_1 など）を確認してください。";

  return (
    <LiffScreen>
      <main className="liff-page-main mx-auto w-full max-w-lg flex-1 py-6">
        <LiffPageHeader
          title={APP_NAME}
          subtitle={`@pocket アプリ「${APP_NAME}」`}
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
          <LiffGhostLink href="/">メニューへ戻る</LiffGhostLink>
        </div>

        <LiffStaffBindingConfigNotice message={account.bindingConfigError} />
        <LiffStaffBindPanel
          staff={account.staff}
          bindingEnabled={account.bindingEnabled}
          boundStaffName={account.boundStaffName}
          accountLoading={account.loading}
          onBind={account.bindStaff}
        />

        {feedback ? (
          <p className="mb-4 text-[14px] leading-relaxed text-red-700 dark:text-red-300">
            {feedback}
          </p>
        ) : null}

        {needsStaffBind ? (
          <div className="mt-4">
            <LiffCard>
              <p className="px-5 py-6 text-[15px] leading-relaxed text-slate-600 dark:text-slate-300">
                スタッフ名簿と紐づけてからご利用ください。
              </p>
            </LiffCard>
          </div>
        ) : isLoading ? (
          <LiffLoadingBlock message="設定を確認しています" />
        ) : configured ? (
          <div className="mt-4">
            <LiffCard>
              <div className="flex flex-col gap-4 px-5 py-6">
                <p className="text-[15px] leading-relaxed text-slate-600 dark:text-slate-300">
                  @pocket の「{data?.appName ?? APP_NAME}
                  」をブラウザで開きます。ポータルにカレンダーが表示されます。
                </p>
                <LiffPrimaryButton
                  type="button"
                  onClick={() => openAtPocketUrl(portalUrl)}
                >
                  {APP_NAME}を開く
                </LiffPrimaryButton>
              </div>
            </LiffCard>
          </div>
        ) : (
          <div className="mt-4">
            <LiffCard>
              <p className="whitespace-pre-wrap px-5 py-6 text-[15px] leading-relaxed text-slate-600 dark:text-slate-300">
                現在この機能は利用できません。
                {disabledMessage ? `\n${disabledMessage}` : ""}
              </p>
            </LiffCard>
          </div>
        )}
      </main>
    </LiffScreen>
  );
}
