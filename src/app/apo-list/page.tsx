"use client";

import { useEffect, useMemo, useState } from "react";

import { ApoListRows } from "@/components/apo-list-rows";
import { ApoListScopeTabs } from "@/components/apo-list-scope-tabs";
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
import { ThemeToggle } from "@/components/theme-toggle";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import { filterApoListRows, type ApoListScope } from "@/lib/apo-list-filter";
import type { ApoListPayload } from "@/lib/apo-list-types";
import { initLiffAndGetToken } from "@/lib/liff-session";
import { LIFF_SWR_DEFAULT_OPTIONS, isLiffSwrSessionExpired } from "@/lib/liff-swr";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

export default function ApoListPage() {
  const [phase, setPhase] = useState<
    "init" | "need-login" | "ready" | "error"
  >(() => (LIFF_ID ? "init" : "error"));
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    LIFF_ID ? null : "NEXT_PUBLIC_LIFF_ID が設定されていません",
  );
  const [idToken, setIdToken] = useState<string | null>(null);
  /** 初期表示は「進行中」 */
  const [scope, setScope] = useState<ApoListScope>("open");

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
    ApoListPayload & { needsStaffBind?: boolean; disabled?: boolean }
  >(canFetch ? "/api/apo-list" : null, idToken, LIFF_SWR_DEFAULT_OPTIONS);

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

  /**
   * セッション切れ。既存ページは useEffect で phase を書き換えているが、
   * 一度立ったら戻らない値なので、ここでは派生値として持つ。
   * 挙動は同じで、effect 内の setState を増やさずに済む
   */
  const sessionExpired = Boolean(
    swrError && isLiffSwrSessionExpired(swrError),
  );

  useEffect(() => {
    if (phase === "ready") resetLiffScroll();
  }, [phase, scope]);

  /** 絞り込みは画面側で行う。取得は一度きりで、切り替えても再取得しない */
  const visibleRows = useMemo(
    () => filterApoListRows(data?.rows ?? [], scope),
    [data?.rows, scope],
  );

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
        <LiffPageHeader title="アポ情報一覧" />
        <p className="text-sm text-rose-600 dark:text-rose-400">{errorMessage}</p>
        <LiffGhostLink href="/">メニューへ</LiffGhostLink>
      </LiffScreen>
    );
  }

  return (
    <LiffScreen>
      <LiffPageHeader
        title="アポ情報一覧"
        subtitle={`${visibleRows.length}件`}
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
        <div className="mb-4">
          <ApoListScopeTabs value={scope} onChange={setScope} />
        </div>

        <div id="apo-list-panel" role="tabpanel" aria-labelledby={`apo-list-tab-${scope}`}>
          {isLoading && !data ? (
            <LiffLoadingBlock message="アポ情報を読み込み中…" />
          ) : data?.error ? (
            <LiffCard>
              <p className="px-4 py-6 text-center text-[14px] text-red-700 dark:text-red-300">
                {data.error}
              </p>
            </LiffCard>
          ) : data && !data.configured ? (
            <LiffCard>
              <p className="px-4 py-6 text-center text-[14px] text-slate-600 dark:text-slate-300">
                アポ情報は環境変数設定後に利用できます。
              </p>
            </LiffCard>
          ) : (
            <ApoListRows rows={visibleRows} idToken={idToken} />
          )}
        </div>
      </div>
    </LiffScreen>
  );
}
