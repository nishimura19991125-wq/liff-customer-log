"use client";

import liff from "@line/liff";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  LiffAccountBar,
  LiffCard,
  LiffLoadingBlock,
  LiffPageHeader,
  LiffPrimaryButton,
  LiffScreen,
  LiffSessionExpiredPanel,
  LiffStaffBindPanel,
} from "@/components/liff-chrome";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

const INPUT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] text-slate-900 shadow-inner outline-none ring-1 ring-slate-100 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200";

type SearchHit = {
  recordId: string;
  customerName: string;
  subtitle: string;
};

type EditableField = {
  fieldId: string;
  label: string;
  value: string;
};

type RecordDetail = {
  recordId: string;
  display: Array<{ fieldId: string; label: string; value: string }>;
  editableFields: EditableField[];
  editableFieldIdsConfigured: boolean;
};

type View = "search" | "edit";

export default function CustomerInfoPage() {
  const [phase, setPhase] = useState<
    | "init"
    | "need-login"
    | "loading"
    | "ready"
    | "error"
    | "disabled"
    | "session-expired"
  >(() => (LIFF_ID ? "init" : "error"));
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    LIFF_ID ? null : "NEXT_PUBLIC_LIFF_ID が設定されていません",
  );
  const [idToken, setIdToken] = useState<string | null>(null);
  const [view, setView] = useState<View>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [detail, setDetail] = useState<RecordDetail | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

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
          setErrorMessage("LINE の ID トークンを取得できませんでした。");
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

  const handleSearch = useCallback(async () => {
    const token = idToken;
    const q = searchQuery.trim();
    if (!token || !q) {
      setSearchFeedback("お客様名を入力してください");
      return;
    }
    setSearching(true);
    setSearchFeedback(null);
    setResults([]);
    setDetail(null);
    setView("search");
    try {
      const res = await fetch(
        `/api/customer-info/search?${new URLSearchParams({ q })}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = (await res.json()) as {
        results?: SearchHit[];
        error?: string;
        disabled?: boolean;
      };
      if (res.status === 401 && isLineSessionExpiredPayload(data)) {
        setPhase("session-expired");
        return;
      }
      if (res.status === 503 && data.disabled) {
        setErrorMessage(data.error ?? "お客様情報アプリが未設定です");
        setPhase("disabled");
        return;
      }
      if (!res.ok) {
        setSearchFeedback(data.error ?? "検索に失敗しました");
        return;
      }
      const list = data.results ?? [];
      setResults(list);
      if (list.length === 0) {
        setSearchFeedback("該当するお客様が見つかりませんでした");
      }
    } catch {
      setSearchFeedback("通信に失敗しました");
    } finally {
      setSearching(false);
    }
  }, [idToken, searchQuery]);

  const openRecord = useCallback(
    async (recordId: string) => {
      const token = idToken;
      if (!token) return;
      setLoadingRecord(true);
      setSaveFeedback(null);
      try {
        const res = await fetch(
          `/api/customer-info/records/${encodeURIComponent(recordId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const data = (await res.json()) as RecordDetail & {
          error?: string;
        };
        if (res.status === 401 && isLineSessionExpiredPayload(data)) {
          setPhase("session-expired");
          return;
        }
        if (!res.ok) {
          setSearchFeedback(data.error ?? "レコードの取得に失敗しました");
          return;
        }
        const initial: Record<string, string> = {};
        for (const f of data.editableFields) {
          initial[f.fieldId] = f.value;
        }
        setEditValues(initial);
        setDetail(data);
        setView("edit");
      } catch {
        setSearchFeedback("通信に失敗しました");
      } finally {
        setLoadingRecord(false);
      }
    },
    [idToken],
  );

  const handleSave = useCallback(async () => {
    const token = idToken;
    if (!token || !detail) return;
    setSaving(true);
    setSaveFeedback(null);
    try {
      const res = await fetch(
        `/api/customer-info/records/${encodeURIComponent(detail.recordId)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ fields: editValues }),
        },
      );
      const data = (await res.json()) as { error?: string; ok?: boolean };
      if (res.status === 401 && isLineSessionExpiredPayload(data)) {
        setPhase("session-expired");
        return;
      }
      if (!res.ok) {
        setSaveFeedback({
          kind: "err",
          text: data.error ?? "保存に失敗しました",
        });
        return;
      }
      setSaveFeedback({ kind: "ok", text: "保存しました。@pocket に反映済みです。" });
      await openRecord(detail.recordId);
    } catch {
      setSaveFeedback({ kind: "err", text: "通信に失敗しました" });
    } finally {
      setSaving(false);
    }
  }, [idToken, detail, editValues, openRecord]);

  if (phase === "init" || phase === "loading") {
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

  if (phase === "error" || phase === "disabled") {
    return (
      <LiffScreen>
        <main className="mx-auto w-full max-w-lg flex-1 py-6">
          <Link
            href="/"
            className="mb-4 inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-800"
          >
            ‹ メニューへ
          </Link>
          <p className="rounded-xl bg-red-50 px-4 py-3 text-[14px] text-red-800">
            {errorMessage}
          </p>
        </main>
      </LiffScreen>
    );
  }

  return (
    <LiffScreen>
      <main className="mx-auto w-full max-w-lg flex-1 py-6">
        <nav className="mb-3 flex items-center justify-between gap-2">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-800 active:opacity-70"
          >
            <span className="text-lg leading-none">‹</span>
            メニューへ
          </Link>
          <LiffAccountBar
            loading={account.loading}
            pictureUrl={account.pictureUrl}
            boundStaffName={account.boundStaffName}
            bindingEnabled={account.bindingEnabled}
          />
        </nav>

        <LiffPageHeader
          title="お客様情報入力"
          subtitle="お客様名で検索し、該当レコードを編集して @pocket に保存します。"
        />

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
          {view === "search" ? (
            <LiffCard>
              <div className="px-4 py-4">
                <label className="block">
                  <span className="mb-1 block text-[12px] font-bold text-slate-700">
                    お客様名で検索
                  </span>
                  <input
                    type="search"
                    className={INPUT_CLASS}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="例：山田"
                    disabled={searching || needsStaffBind}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSearch();
                    }}
                  />
                </label>
                <div className="mt-3">
                  <LiffPrimaryButton
                    type="button"
                    disabled={searching || needsStaffBind || !searchQuery.trim()}
                    onClick={() => void handleSearch()}
                  >
                    {searching ? "検索中…" : "検索"}
                  </LiffPrimaryButton>
                </div>
                {searchFeedback ? (
                  <p className="mt-3 text-[13px] font-semibold leading-relaxed text-slate-600">
                    {searchFeedback}
                  </p>
                ) : null}
                {results.length > 0 ? (
                  <ul className="mt-4 flex flex-col gap-2">
                    {results.map((row) => (
                      <li key={row.recordId}>
                        <button
                          type="button"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-3 text-left shadow-sm ring-1 ring-slate-100 transition active:scale-[0.99] disabled:opacity-50"
                          disabled={loadingRecord}
                          onClick={() => void openRecord(row.recordId)}
                        >
                          <p className="text-[15px] font-bold text-slate-900">
                            {row.customerName}
                          </p>
                          {row.subtitle ? (
                            <p className="mt-0.5 text-[12px] text-slate-500">
                              {row.subtitle}
                            </p>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </LiffCard>
          ) : detail ? (
            <LiffCard>
              <div className="px-4 py-4">
                <button
                  type="button"
                  className="mb-3 text-[13px] font-semibold text-emerald-800"
                  onClick={() => {
                    setView("search");
                    setDetail(null);
                    setSaveFeedback(null);
                  }}
                >
                  ‹ 検索結果に戻る
                </button>
                {detail.display.length > 0 ? (
                  <div className="mb-4 rounded-xl bg-slate-50/90 px-3 py-3 ring-1 ring-slate-100">
                    <p className="mb-2 text-[11px] font-bold text-slate-600">
                      レコード情報
                    </p>
                    <dl className="flex flex-col gap-2">
                      {detail.display.map((row) => (
                        <div key={row.fieldId}>
                          <dt className="text-[11px] font-semibold text-slate-500">
                            {row.label}
                          </dt>
                          <dd className="text-[14px] font-medium text-slate-900">
                            {row.value || "—"}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ) : null}
                <p className="mb-2 text-[12px] font-bold text-slate-700">
                  編集
                </p>
                {detail.editableFields.length === 0 ? (
                  <p className="text-[13px] leading-relaxed text-slate-500">
                    編集可能な項目はまだ設定されていません。環境変数
                    CUSTOMER_INFO_EDITABLE_FIELD_IDS
                    で指定すると、ここに入力欄が表示されます（未設定時はお客様名のみ編集可能です）。
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {detail.editableFields.map((field) => (
                      <label key={field.fieldId} className="block">
                        <span className="mb-1 block text-[12px] font-semibold text-slate-700">
                          {field.label}
                        </span>
                        <input
                          type="text"
                          className={INPUT_CLASS}
                          value={editValues[field.fieldId] ?? ""}
                          onChange={(e) =>
                            setEditValues((prev) => ({
                              ...prev,
                              [field.fieldId]: e.target.value,
                            }))
                          }
                          disabled={saving}
                        />
                      </label>
                    ))}
                  </div>
                )}
                <div className="mt-4">
                  <LiffPrimaryButton
                    type="button"
                    disabled={
                      saving ||
                      needsStaffBind ||
                      detail.editableFields.length === 0
                    }
                    onClick={() => void handleSave()}
                  >
                    {saving ? "保存中…" : "保存して @pocket に反映"}
                  </LiffPrimaryButton>
                </div>
                {saveFeedback ? (
                  <p
                    className={`mt-3 text-[13px] font-semibold leading-relaxed ${
                      saveFeedback.kind === "ok"
                        ? "text-emerald-800"
                        : "text-red-700"
                    }`}
                  >
                    {saveFeedback.text}
                  </p>
                ) : null}
              </div>
            </LiffCard>
          ) : null}
        </div>
      </main>
    </LiffScreen>
  );
}
