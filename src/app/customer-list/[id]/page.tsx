"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  LiffAccountBar,
  LiffCard,
  LiffGhostLink,
  LiffLoadingBlock,
  LiffMark,
  LiffPageHeader,
  LiffScreen,
  LiffSessionExpiredPanel,
  LiffStaffBindPanel,
  LiffStaffBindingConfigNotice,
} from "@/components/liff-chrome";
import { MapNavigationButton } from "@/components/map-navigation-button";
import { resetLiffScroll } from "@/components/liff-scroll-reset";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import { initLiffAndGetToken } from "@/lib/liff-session";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";
import { safeHttpsUrl } from "@/lib/safe-external-url";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

type DocumentRow = {
  key: string;
  label: string;
  value: string;
  isMissing: boolean;
};

type DetailPayload = {
  recordId: string;
  customerName: string;
  subtitle: string;
  isDocumentMissing: boolean;
  isSubsidyTarget: boolean;
  combinedSubsidyName: string | null;
  isConstructionDateUnset: boolean;
  isCancelled: boolean;
  constructionDate: string;
  subsidyPresence: string;
  documents: DocumentRow[];
  summary: Array<{ label: string; value: string }>;
  pinpointAddress: string;
  normalAddress: string;
  /** Dropbox 顧客フォルダの共有リンク。未設定・不正な値のときは空文字 */
  dropboxLink?: string;
};

export default function CustomerDetailPage() {
  const params = useParams();
  const recordId =
    typeof params.id === "string" ? params.id.trim() : "";

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
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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
        setPhase("loading");
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

  const loadDetail = useCallback(async (token: string, rid: string) => {
    setLoadError(null);
    setPhase("loading");
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(rid)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as DetailPayload & {
        error?: string;
        needsStaffBind?: boolean;
      };
      if (isLineSessionExpiredPayload(data)) {
        setPhase("session-expired");
        return;
      }
      if (!res.ok) {
        setLoadError(data.error ?? "詳細の取得に失敗しました");
        setDetail(null);
        setPhase("ready");
        return;
      }
      setDetail(data);
      setPhase("ready");
    } catch (e) {
      console.error(e);
      setLoadError("通信エラーが発生しました");
      setPhase("ready");
    }
  }, []);

  useEffect(() => {
    if (!idToken || !recordId || needsStaffBind) return;
    void loadDetail(idToken, recordId);
  }, [idToken, recordId, needsStaffBind, loadDetail]);

  useEffect(() => {
    if (phase === "ready") resetLiffScroll();
  }, [phase, detail]);

  if (phase === "init") {
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
        <LiffPageHeader title="顧客カルテ" />
        <p className="text-sm text-rose-600">{errorMessage}</p>
        <LiffGhostLink href="/customer-list">一覧へ戻る</LiffGhostLink>
      </LiffScreen>
    );
  }

  if (!recordId) {
    return (
      <LiffScreen>
        <LiffPageHeader title="顧客カルテ" />
        <p className="text-sm text-rose-600">案件IDが不正です</p>
        <LiffGhostLink href="/customer-list">一覧へ戻る</LiffGhostLink>
      </LiffScreen>
    );
  }

  return (
    <LiffScreen>
      {/*
        1行目: アカウントアイコン（左）／「一覧」リンク（右）
        2行目: 情報確認バッジ ＋ 顧客名 ＋ T番号
        以前は「顧客名と一覧が同じ行」「その下にアカウント名」の2行構成だった。
        行数は増やさず入れ替えている
      */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <LiffAccountBar
          loading={account.loading}
          pictureUrl={account.pictureUrl}
          boundStaffName={account.boundStaffName}
          bindingEnabled={account.bindingEnabled}
        />
        <LiffGhostLink href="/customer-list">一覧</LiffGhostLink>
      </div>

      {/*
        バッジ・顧客名・T番号を1行に収める。LiffPageHeader は subtitle を
        名前の下の行に描くため、ここでは使わずに組んでいる
      */}
      <div className="mb-5 flex min-w-0 items-center gap-2 sm:gap-3">
        <LiffMark />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h1 className="min-w-0 truncate text-[1.35rem] font-bold leading-tight tracking-tight text-slate-900 dark:text-white">
            {detail?.customerName ?? "顧客カルテ"}
          </h1>
          <span className="shrink-0 text-[13px] leading-snug text-slate-500 dark:text-slate-400">
            {detail?.subtitle || "担当案件の詳細"}
          </span>
        </div>
      </div>

      <LiffStaffBindingConfigNotice message={account.bindingConfigError} />
      <LiffStaffBindPanel
        staff={account.staff}
        bindingEnabled={account.bindingEnabled}
        boundStaffName={account.boundStaffName}
        accountLoading={account.loading}
        onBind={account.bindStaff}
      />

      {phase === "loading" ? (
        <LiffLoadingBlock message="カルテを読み込み中…" />
      ) : null}

      <div
        className={
          needsStaffBind
            ? "pointer-events-none opacity-[0.35] saturate-50"
            : undefined
        }
      >
      {phase === "ready" ? (
        <>
          {loadError ? (
            <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {loadError}
            </p>
          ) : null}

          {detail ? (
            <>
              {detail.isSubsidyTarget && detail.combinedSubsidyName ? (
                <div
                  className="mb-4 rounded-2xl border-2 border-sky-300 bg-sky-50 px-4 py-4 text-[14px] font-medium leading-relaxed text-sky-950 sm:text-[15px]"
                  role="alert"
                >
                  💡 【重要】この案件は『{detail.combinedSubsidyName}』の対象です。写真の撮影漏れや、申請書類の回収漏れがないよう、現場での確認を徹底してください。
                </div>
              ) : null}

              <div className="mb-4">
                <MapNavigationButton
                  pinpointAddress={detail.pinpointAddress}
                  normalAddress={detail.normalAddress}
                />
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                {detail.isCancelled ? (
                  <span className="inline-flex items-center rounded-xl bg-slate-200 px-3 py-2 text-[14px] font-semibold text-slate-800 dark:bg-slate-600/60 dark:text-slate-100">
                    キャンセル
                  </span>
                ) : null}
                {detail.isDocumentMissing ? (
                  <span className="inline-flex items-center rounded-xl bg-rose-100 px-3 py-2 text-[14px] font-semibold text-rose-800">
                    ⚠️ 書類未回収
                  </span>
                ) : null}
                {detail.isConstructionDateUnset ? (
                  <span className="inline-flex items-center rounded-xl bg-amber-100 px-3 py-2 text-[14px] font-semibold text-amber-900">
                    ⏳ 工事日未定
                  </span>
                ) : null}
              </div>

              <LiffCard>
                <div className="border-b border-slate-100 px-4 py-3">
                  <h2 className="text-base font-bold text-slate-900">基本情報</h2>
                </div>
                {/*
                  行の並びと値の組み立てはサーバ側（customer-crm-detail.ts）に
                  一本化している。ここで固定行を足すと、以前の「補助金有無が
                  2回出る」重複が再発するので追加しないこと
                */}
                <dl className="divide-y divide-slate-100 px-4">
                  {detail.summary.map((row) => (
                    <div
                      key={`${row.label}-${row.value}`}
                      className="grid grid-cols-[minmax(7rem,38%)_1fr] gap-2 py-3 text-[15px]"
                    >
                      <dt className="font-medium text-slate-500">{row.label}</dt>
                      <dd className="break-words text-slate-900">{row.value}</dd>
                    </div>
                  ))}
                  {/*
                    Dropbox フォルダ。サーバ側でも https:// のみ通しているが、
                    href に置く直前でもう一度確かめる（同じ判定関数を使う）
                  */}
                  {(() => {
                    const href = safeHttpsUrl(detail.dropboxLink);
                    return (
                      <div className="grid grid-cols-[minmax(7rem,38%)_1fr] gap-2 py-3 text-[15px]">
                        <dt className="font-medium text-slate-500">
                          書類フォルダ
                        </dt>
                        <dd className="break-words text-slate-900">
                          {href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center rounded-lg border border-sky-300 bg-sky-50 px-2.5 py-1 text-[13px] font-bold text-sky-900 transition active:scale-[0.98] active:bg-sky-100"
                            >
                              Dropboxを開く
                            </a>
                          ) : (
                            <span className="text-slate-500">未設定</span>
                          )}
                        </dd>
                      </div>
                    );
                  })()}
                </dl>
              </LiffCard>

              <section className="mt-5">
                <h2 className="mb-3 text-base font-bold text-slate-900">
                  書類チェックリスト（16項目）
                </h2>
                <ul className="flex flex-col gap-2">
                  {detail.documents.map((doc) => (
                    <li
                      key={doc.key}
                      className={`rounded-2xl border px-4 py-3.5 text-[15px] ${
                        doc.isMissing
                          ? "border-rose-200 bg-rose-50"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <p
                        className={`font-semibold leading-snug ${
                          doc.isMissing ? "text-rose-800" : "text-slate-800"
                        }`}
                      >
                        {doc.label}
                      </p>
                      <p
                        className={`mt-1 text-sm ${
                          doc.isMissing
                            ? "font-bold text-rose-700"
                            : "text-slate-600"
                        }`}
                      >
                        {doc.value}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>

              <div className="mt-6 pb-2">
                <Link
                  href={`/customer-info?recordId=${encodeURIComponent(detail.recordId)}`}
                  className="inline-flex w-full items-center justify-center rounded-2xl bg-[#06C755] py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-emerald-600/20 transition active:scale-[0.98]"
                >
                  お客様情報を編集
                </Link>
              </div>
            </>
          ) : null}
        </>
      ) : null}
      </div>
    </LiffScreen>
  );
}
