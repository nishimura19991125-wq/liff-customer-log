"use client";

import { use, useEffect, useState } from "react";

import { ApoDetailGroups } from "@/components/apo-detail-groups";
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
import { ThemeToggle } from "@/components/theme-toggle";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import type { ApoDetailPayload } from "@/lib/apo-detail-types";
import { initLiffAndGetToken } from "@/lib/liff-session";
import { LIFF_SWR_DEFAULT_OPTIONS, isLiffSwrSessionExpired } from "@/lib/liff-swr";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

export default function ApoDetailPage({
  params,
}: {
  params: Promise<{ recordId: string }>;
}) {
  const { recordId } = use(params);

  const [phase, setPhase] = useState<
    "init" | "need-login" | "ready" | "error"
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

  const canFetch =
    Boolean(idToken) &&
    phase === "ready" &&
    !needsStaffBind &&
    !account.loading &&
    Boolean(account.boundStaffName || !account.bindingEnabled);

  const { data, error: swrError, isLoading } = useLiffSwr<
    ApoDetailPayload & { needsStaffBind?: boolean; disabled?: boolean; error?: string }
  >(
    canFetch ? `/api/apo-list/${encodeURIComponent(recordId)}` : null,
    idToken,
    LIFF_SWR_DEFAULT_OPTIONS,
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

  /** 一度立ったら戻らない値なので派生値として持つ（/apo-list と同じ） */
  const sessionExpired = Boolean(swrError && isLiffSwrSessionExpired(swrError));

  if (sessionExpired) {
    return (
      <LiffScreen>
        <LiffSessionExpiredPanel />
      </LiffScreen>
    );
  }

  if (phase === "need-login") {
    return (
      <LiffScreen>
        <main className="liff-page-main mx-auto w-full max-w-lg flex-1 py-6">
          <p className="text-center text-sm text-slate-600 dark:text-slate-300">
            LINE ログインへ移動しています…
          </p>
        </main>
      </LiffScreen>
    );
  }

  if (phase === "error") {
    return (
      <LiffScreen>
        <LiffPageHeader title="アポ情報" />
        <p className="text-sm text-rose-600 dark:text-rose-400">{errorMessage}</p>
        <LiffGhostLink href="/apo-list">アポ情報一覧へ</LiffGhostLink>
      </LiffScreen>
    );
  }

  /**
   * 見えない案件（担当外・存在しない）は本文にまとめて出す。
   * どちらも同じ扱いにして、案件の有無を伝えない
   */
  const notAvailable = Boolean(swrError) || Boolean(data?.error);

  return (
    <LiffScreen>
      <LiffPageHeader
        title="アポ情報"
        subtitle={data?.customerName || undefined}
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
        <LiffGhostLink href="/apo-list">アポ情報一覧へ</LiffGhostLink>
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
        {isLoading && !data ? (
          <LiffLoadingBlock message="アポ情報を読み込み中…" />
        ) : notAvailable ? (
          <LiffCard>
            <p className="px-4 py-6 text-center text-[14px] text-slate-600 dark:text-slate-300">
              この案件は表示できません。一覧からお選びください。
            </p>
          </LiffCard>
        ) : data && !data.configured ? (
          <LiffCard>
            <p className="px-4 py-6 text-center text-[14px] text-slate-600 dark:text-slate-300">
              アポ情報は環境変数設定後に利用できます。
            </p>
          </LiffCard>
        ) : data ? (
          <>
            {/* お客様名は11項目に含まれないが、どの案件か示すために出す */}
            <p className="mb-3 px-1 text-[18px] font-bold leading-snug text-slate-900 dark:text-white">
              {data.customerName || "（名称未設定）"}
            </p>
            <ApoDetailGroups groups={data.groups} />
          </>
        ) : null}
      </div>
    </LiffScreen>
  );
}
