"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  LiffAccountBar,
  LiffCard,
  LiffLoadingBlock,
  LiffPageHeader,
  LiffPrimaryButton,
  LiffScreen,
  LiffSessionExpiredPanel,
  LiffStaffBindPanel,
  LiffStaffBindingConfigNotice,
} from "@/components/liff-chrome";
import { resetLiffScroll } from "@/components/liff-scroll-reset";
import { initLiffAndGetToken } from "@/lib/liff-session";
import {
  CustomerNameSplitInput,
  isCustomerNameFieldLabel,
  isFuriganaFieldLabel,
} from "@/components/customer-name-split-input";
import {
  CustomerInfoEditForm,
  type CustomerInfoFormFieldApi,
} from "@/components/customer-info-edit-form";
import {
  CustomerInfoSaveBar,
  type CustomerInfoSaveFeedback,
} from "@/components/customer-info-save-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";
import { applyCustomerInfoFormChange } from "@/lib/customer-info-form/form-change";
import {
  expandNamePartsInValues,
  joinJapaneseFullName,
  splitJapaneseFullName,
  syncCombinedNameFields,
} from "@/lib/customer-info-form/name-parts";
import { filterKatakanaInput } from "@/lib/customer-info-form/katakana-input";
import { inferPanelComboFromValues } from "@/lib/customer-info-form/panel-combo";
import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";
import {
  findMissingRequiredCustomerInfoFields,
  formatCustomerInfoRequiredValidationError,
} from "@/lib/customer-info-form/validate";
import { isCustomerStatusCancelled } from "@/lib/customer-status-label";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

/** iOS Safari は 16px 未満の input フォーカスで自動ズームするため text-base を使う */
const INPUT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 shadow-inner outline-none ring-1 ring-slate-100 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200";

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
  usesFormSchema?: boolean;
  display: Array<{ fieldId: string; label: string; value: string }>;
  formFields?: CustomerInfoFormFieldApi[];
  formValues?: CustomerInfoFormValues;
  missingCaptions?: string[];
  editableFields?: EditableField[];
  editableFieldIdsConfigured?: boolean;
};

type View = "search" | "edit";

export default function CustomerInfoPage() {
  return (
    <Suspense
      fallback={
        <LiffScreen>
          <LiffLoadingBlock message="読み込み中…" />
        </LiffScreen>
      }
    >
      <CustomerInfoPageContent />
    </Suspense>
  );
}

function CustomerInfoPageContent() {
  const searchParams = useSearchParams();
  const recordIdFromUrl = searchParams.get("recordId")?.trim() ?? "";
  const openedFromUrlRef = useRef(false);

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
  const [pendingRecords, setPendingRecords] = useState<SearchHit[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [detail, setDetail] = useState<RecordDetail | null>(null);
  const [editValues, setEditValues] = useState<CustomerInfoFormValues>({});
  const [formFields, setFormFields] = useState<CustomerInfoFormFieldApi[]>([]);
  const [missingCaptions, setMissingCaptions] = useState<string[] | undefined>();
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] =
    useState<CustomerInfoSaveFeedback | null>(null);
  const [requiredFieldErrors, setRequiredFieldErrors] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const saveBarRef = useRef<HTMLDivElement>(null);

  const editIsCancelled = useMemo(() => {
    if (view !== "edit" || !detail) return false;
    const fromForm = editValues.customerStatus?.trim();
    if (fromForm) return isCustomerStatusCancelled(fromForm);
    const row = detail.display.find((r) => r.label.trim() === "顧客ステータス");
    return isCustomerStatusCancelled(row?.value);
  }, [view, detail, editValues.customerStatus]);

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

  const loadPendingRecords = useCallback(async () => {
    const token = idToken;
    if (!token || needsStaffBind || account.loading || !account.boundStaffName) {
      setPendingRecords([]);
      return;
    }
    setPendingLoading(true);
    try {
      const res = await fetch("/api/customer-info/pending-records", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as {
        records?: SearchHit[];
        error?: string;
      };
      if (res.status === 401 && isLineSessionExpiredPayload(data)) {
        setPhase("session-expired");
        return;
      }
      setPendingRecords(data.records ?? []);
    } catch {
      setPendingRecords([]);
    } finally {
      setPendingLoading(false);
    }
  }, [idToken, needsStaffBind, account.loading, account.boundStaffName]);

  useEffect(() => {
    if (phase !== "ready" || view !== "search") return;
    void loadPendingRecords();
  }, [phase, view, loadPendingRecords, account.boundStaffName]);

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

  useEffect(() => {
    resetLiffScroll();
  }, [view]);

  useEffect(() => {
    if (!saveFeedback || !saveBarRef.current) return;
    saveBarRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [saveFeedback]);

  const openRecord = useCallback(
    async (
      recordId: string,
      opts?: { clearSaveFeedback?: boolean },
    ) => {
      const token = idToken;
      if (!token) return;
      setLoadingRecord(true);
      if (opts?.clearSaveFeedback !== false) {
        setSaveFeedback(null);
      }
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
        if (data.usesFormSchema && data.formFields?.length) {
          const initial: CustomerInfoFormValues = data.formValues
            ? { ...data.formValues }
            : {};
          if (!data.formValues) {
            for (const f of data.formFields) {
              initial[f.key] = f.value;
            }
          }
          initial.panelCombo = inferPanelComboFromValues(initial);
          setEditValues(initial);
          setFormFields(data.formFields);
          setMissingCaptions(data.missingCaptions);
          setRequiredFieldErrors(new Set());
        } else {
          const initial: CustomerInfoFormValues = {};
          for (const f of data.editableFields ?? []) {
            initial[f.fieldId] = f.value;
          }
          setEditValues(initial);
          setFormFields([]);
          setMissingCaptions(undefined);
        }
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

  useEffect(() => {
    if (
      phase !== "ready" ||
      !idToken ||
      !recordIdFromUrl ||
      openedFromUrlRef.current ||
      needsStaffBind
    ) {
      return;
    }
    openedFromUrlRef.current = true;
    void openRecord(recordIdFromUrl);
  }, [phase, idToken, recordIdFromUrl, needsStaffBind, openRecord]);

  const handleSave = useCallback(async () => {
    const token = idToken;
    if (!token || !detail) return;

    if (detail.usesFormSchema && formFields.length > 0) {
      const valuesForValidate = syncCombinedNameFields(
        expandNamePartsInValues(editValues),
      );
      const missing = findMissingRequiredCustomerInfoFields(
        formFields.map((f) => ({
          key: f.key,
          label: f.label,
          type: f.type,
          required: f.required,
        })),
        valuesForValidate,
      );
      if (missing.length > 0) {
        setRequiredFieldErrors(new Set(missing.map((f) => f.key)));
        setSaveFeedback({
          kind: "err",
          text: formatCustomerInfoRequiredValidationError(missing),
        });
        return;
      }
    }

    setRequiredFieldErrors(new Set());
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
          body: JSON.stringify(
            detail.usesFormSchema
              ? {
                  formValues: syncCombinedNameFields(
                    expandNamePartsInValues(editValues),
                  ),
                }
              : { fields: editValues },
          ),
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
      const savedAt = new Date().toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
      });
      setSaveFeedback({
        kind: "ok",
        text: "お客様情報を @pocket に保存しました",
        savedAt,
      });
      await openRecord(detail.recordId, { clearSaveFeedback: false });
    } catch {
      setSaveFeedback({ kind: "err", text: "通信に失敗しました" });
    } finally {
      setSaving(false);
    }
  }, [idToken, detail, editValues, formFields, openRecord]);

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
        <main className="liff-page-main mx-auto w-full max-w-lg flex-1 py-6">
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
      <main className="liff-page-main mx-auto w-full max-w-lg flex-1 py-6">
        <Link
          href="/"
          className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-800 active:opacity-70 dark:text-emerald-300"
        >
          <span className="text-lg leading-none">‹</span>
          メニューへ
        </Link>

        <LiffPageHeader
          title={view === "edit" ? "契約情報入力" : "お客様情報入力"}
          subtitle={
            view === "edit"
              ? "契約情報を編集して @pocket に保存します。"
              : "お客様名で検索し、該当レコードを編集して @pocket に保存します。"
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
          {view === "search" ? (
            <LiffCard>
              <div className="px-4 py-4">
                {pendingLoading ? (
                  <p className="mb-4 text-[13px] text-slate-500">
                    未入力の案件を読み込んでいます…
                  </p>
                ) : pendingRecords.length > 0 ? (
                  <div className="mb-5">
                    <p className="mb-2 text-[12px] font-bold text-amber-900">
                      入力ステータス：未入力
                    </p>
                    <ul className="flex flex-col gap-2">
                      {pendingRecords.map((row) => (
                        <li key={row.recordId}>
                          <button
                            type="button"
                            className="w-full rounded-xl border-2 border-amber-300/80 bg-amber-50/90 px-3 py-3 text-left shadow-sm ring-1 ring-amber-200/60 transition active:scale-[0.99] disabled:opacity-50"
                            disabled={loadingRecord}
                            onClick={() => void openRecord(row.recordId)}
                          >
                            <p className="text-[15px] font-bold text-amber-950">
                              {row.customerName}
                            </p>
                            {row.subtitle ? (
                              <p className="mt-0.5 text-[12px] font-medium text-amber-800/85">
                                {row.subtitle}
                              </p>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <label className="block">
                  <span className="mb-1 block text-[12px] font-bold text-slate-700">
                    お客様名で検索
                  </span>
                  <input
                    type="text"
                    inputMode="search"
                    autoComplete="off"
                    enterKeyHint="search"
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
                    void loadPendingRecords();
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
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <p className="text-[12px] font-bold text-slate-700">
                    契約情報入力
                  </p>
                  {editIsCancelled ? (
                    <span className="inline-flex items-center rounded-full bg-slate-200 px-2.5 py-0.5 text-[11px] font-bold text-slate-700 dark:bg-slate-600/70 dark:text-slate-100">
                      キャンセル
                    </span>
                  ) : null}
                </div>
                {detail.usesFormSchema && formFields.length > 0 ? (
                  <CustomerInfoEditForm
                    formFields={formFields}
                    values={editValues}
                    saving={saving}
                    missingCaptions={missingCaptions}
                    requiredFieldErrors={requiredFieldErrors}
                    idToken={idToken}
                    onChange={(key, value) => {
                      setRequiredFieldErrors((prev) => {
                        if (!prev.has(key)) return prev;
                        const next = new Set(prev);
                        next.delete(key);
                        return next;
                      });
                      setEditValues((prev) =>
                        applyCustomerInfoFormChange(prev, key, value),
                      );
                    }}
                  />
                ) : (detail.editableFields?.length ?? 0) === 0 ? (
                  <p className="text-[13px] leading-relaxed text-slate-500">
                    編集可能な項目を読み込めませんでした。@pocket
                    の列見出しがフォーム定義と一致しているか確認してください。
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {(detail.editableFields ?? []).map((field) => {
                      const raw = editValues[field.fieldId] ?? "";
                      if (
                        isCustomerNameFieldLabel(field.label) ||
                        isFuriganaFieldLabel(field.label)
                      ) {
                        const isFuri = isFuriganaFieldLabel(field.label);
                        const { family, given } = splitJapaneseFullName(raw);
                        return (
                          <CustomerNameSplitInput
                            key={field.fieldId}
                            groupLabel={field.label}
                            familyValue={family}
                            givenValue={given}
                            familyLabel={isFuri ? "セイ" : "苗字"}
                            givenLabel={isFuri ? "メイ" : "名前"}
                            familyPlaceholder={isFuri ? "例：ヤマダ" : "例：山田"}
                            givenPlaceholder={isFuri ? "例：タロウ" : "例：太郎"}
                            familyAutoComplete={
                              isFuri ? undefined : "family-name"
                            }
                            givenAutoComplete={isFuri ? undefined : "given-name"}
                            disabled={saving}
                            required
                            katakanaOnly={isFuri}
                            onFamilyChange={(nextFamily) =>
                              setEditValues((prev) => ({
                                ...prev,
                                [field.fieldId]: joinJapaneseFullName(
                                  isFuri
                                    ? filterKatakanaInput(nextFamily)
                                    : nextFamily,
                                  given,
                                ),
                              }))
                            }
                            onGivenChange={(nextGiven) =>
                              setEditValues((prev) => ({
                                ...prev,
                                [field.fieldId]: joinJapaneseFullName(
                                  family,
                                  isFuri
                                    ? filterKatakanaInput(nextGiven)
                                    : nextGiven,
                                ),
                              }))
                            }
                          />
                        );
                      }
                      return (
                      <label key={field.fieldId} className="block">
                        <span className="mb-1 block text-[12px] font-semibold text-slate-700">
                          {field.label}
                        </span>
                        <input
                          type="text"
                          className={INPUT_CLASS}
                          value={raw}
                          onChange={(e) =>
                            setEditValues((prev) => ({
                              ...prev,
                              [field.fieldId]: e.target.value,
                            }))
                          }
                          disabled={saving}
                        />
                      </label>
                      );
                    })}
                  </div>
                )}
                <CustomerInfoSaveBar
                  ref={saveBarRef}
                  saving={saving}
                  disabled={
                    needsStaffBind ||
                    (detail.usesFormSchema
                      ? formFields.length === 0
                      : (detail.editableFields?.length ?? 0) === 0)
                  }
                  feedback={saveFeedback}
                  onSave={() => void handleSave()}
                />
              </div>
            </LiffCard>
          ) : null}
        </div>
      </main>
    </LiffScreen>
  );
}
