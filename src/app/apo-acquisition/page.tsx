"use client";

import { useCallback, useEffect, useState } from "react";

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
import { ThemeToggle } from "@/components/theme-toggle";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import type {
  ApoAcquisitionFieldKey,
  ApoAcquisitionFieldMeta,
  ApoAcquisitionFileAttachment,
  ApoAcquisitionFormPayload,
  ApoAcquisitionValues,
} from "@/lib/apo-acquisition-types";
import { initLiffAndGetToken } from "@/lib/liff-session";
import {
  formatPostalCodeInput,
  isValidPostalCodeFormat,
  lookupPostalCodeAddress,
} from "@/lib/customer-info-form/postal-code";
import {
  LIFF_SWR_DEFAULT_OPTIONS,
  isLiffSwrError,
  isLiffSwrSessionExpired,
  liffAuthedJsonFetch,
} from "@/lib/liff-swr";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] text-slate-900 shadow-sm disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES_PER_FIELD = 5;

async function readFileAsAttachment(file: File): Promise<ApoAcquisitionFileAttachment> {
  const contentBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const match = /^data:[^;]+;base64,(.+)$/i.exec(result);
      resolve(match?.[1] ?? "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("ファイルの読み込みに失敗しました"));
    reader.readAsDataURL(file);
  });
  return {
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    contentBase64,
  };
}

function ApoGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 7h8M8 11h8M8 15h5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <rect
        x="4"
        y="3"
        width="16"
        height="18"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M16 17l3 3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

type FieldRowProps = {
  field: ApoAcquisitionFieldMeta;
  value: string;
  disabled: boolean;
  onChange: (key: ApoAcquisitionFieldKey, value: string) => void;
  onBlur?: (key: ApoAcquisitionFieldKey) => void;
};

function FieldRow({ field, value, disabled, onChange, onBlur }: FieldRowProps) {
  if (!field.present) return null;

  const label = (
    <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
      {field.label}
      {field.required ? <span className="ml-0.5 text-red-500">*</span> : null}
    </span>
  );

  const handle = (v: string) => onChange(field.key, v);

  let control: React.ReactNode;
  switch (field.kind) {
    case "textarea":
      control = (
        <textarea
          className={`${inputClass} min-h-[80px] resize-y`}
          value={value}
          onChange={(e) => handle(e.target.value)}
          disabled={disabled}
          placeholder={field.placeholder}
        />
      );
      break;
    case "date":
      control = (
        <input
          type="date"
          className={inputClass}
          value={value}
          onChange={(e) => handle(e.target.value)}
          disabled={disabled}
        />
      );
      break;
    case "datetime":
      control = (
        <input
          type="datetime-local"
          className={inputClass}
          value={value}
          onChange={(e) => handle(e.target.value)}
          disabled={disabled}
        />
      );
      break;
    case "select":
    case "staffSelect":
      control = (
        <select
          className={inputClass}
          value={value}
          onChange={(e) => handle(e.target.value)}
          disabled={disabled}
        >
          <option value="">
            {field.kind === "staffSelect" && (field.options?.length ?? 0) === 0
              ? "CL担当者が見つかりません"
              : "未選択"}
          </option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
      break;
    default:
      control = (
        <input
          className={inputClass}
          value={value}
          onChange={(e) => handle(e.target.value)}
          onBlur={() => onBlur?.(field.key)}
          disabled={disabled}
          placeholder={field.placeholder}
        />
      );
  }

  return (
    <label className="block space-y-1.5">
      {label}
      {control}
      {field.hint ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {field.hint}
        </p>
      ) : null}
    </label>
  );
}

type FileFieldRowProps = {
  field: ApoAcquisitionFieldMeta;
  files: ApoAcquisitionFileAttachment[];
  disabled: boolean;
  onChange: (key: ApoAcquisitionFieldKey, files: ApoAcquisitionFileAttachment[]) => void;
  onError: (message: string) => void;
};

function FileFieldRow({
  field,
  files,
  disabled,
  onChange,
  onError,
}: FileFieldRowProps) {
  if (!field.present) return null;

  const handleSelect = async (list: FileList | null) => {
    if (!list?.length) return;
    const next = [...files];
    for (const file of Array.from(list)) {
      if (next.length >= MAX_FILES_PER_FIELD) {
        onError(`添付は${MAX_FILES_PER_FIELD}件までです`);
        break;
      }
      if (file.size > MAX_FILE_BYTES) {
        onError(`${file.name}が大きすぎます（5MBまで）`);
        continue;
      }
      try {
        next.push(await readFileAsAttachment(file));
      } catch {
        onError(`${file.name}の読み込みに失敗しました`);
      }
    }
    onChange(field.key, next);
  };

  return (
    <div className="block space-y-1.5">
      <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
        {field.label}
        {field.required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </span>
      <input
        type="file"
        className={`${inputClass} file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-slate-700 dark:file:bg-slate-800 dark:file:text-slate-200`}
        accept={field.accept ?? "image/*,.pdf,application/pdf"}
        multiple
        disabled={disabled}
        onChange={(e) => {
          void handleSelect(e.target.files);
          e.target.value = "";
        }}
      />
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        画像またはPDF（1件5MBまで・最大{MAX_FILES_PER_FIELD}件）
      </p>
      {files.length > 0 ? (
        <ul className="space-y-1">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-700 dark:bg-slate-800/60 dark:text-slate-200"
            >
              <span className="truncate">{file.name}</span>
              <button
                type="button"
                className="shrink-0 text-red-600 disabled:opacity-50 dark:text-red-400"
                disabled={disabled}
                onClick={() =>
                  onChange(
                    field.key,
                    files.filter((_, i) => i !== index),
                  )
                }
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function ApoAcquisitionPage() {
  const [phase, setPhase] = useState<
    "init" | "need-login" | "ready" | "error" | "session-expired"
  >(() => (LIFF_ID ? "init" : "error"));
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    LIFF_ID ? null : "NEXT_PUBLIC_LIFF_ID が設定されていません",
  );
  const [idToken, setIdToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [values, setValues] = useState<ApoAcquisitionValues>({});
  const [files, setFiles] = useState<
    Partial<Record<ApoAcquisitionFieldKey, ApoAcquisitionFileAttachment[]>>
  >({});

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

  const { data: form, error: formError, isLoading } = useLiffSwr<
    ApoAcquisitionFormPayload & { needsStaffBind?: boolean; error?: string }
  >(
    canFetch ? "/api/apo-acquisition/form" : null,
    idToken,
    LIFF_SWR_DEFAULT_OPTIONS,
  );

  const fillAddressFromPostal = useCallback(async (code: string) => {
    if (!isValidPostalCodeFormat(code)) return;
    const hit = await lookupPostalCodeAddress(code);
    if (!hit) return;
    setValues((prev) => ({
      ...prev,
      prefecture: hit.prefecture,
      city: hit.city,
      town: hit.address,
    }));
  }, []);

  const setValue = useCallback(
    (key: ApoAcquisitionFieldKey, value: string) => {
      if (key === "postalCode") {
        const formatted = formatPostalCodeInput(value);
        setValues((prev) => ({ ...prev, postalCode: formatted }));
        if (isValidPostalCodeFormat(formatted)) {
          void fillAddressFromPostal(formatted);
        }
        return;
      }
      setValues((prev) => ({ ...prev, [key]: value }));
    },
    [fillAddressFromPostal],
  );

  const handleFieldBlur = useCallback(
    (key: ApoAcquisitionFieldKey) => {
      if (key !== "postalCode") return;
      const code = (values.postalCode ?? "").trim();
      void fillAddressFromPostal(code);
    },
    [fillAddressFromPostal, values.postalCode],
  );

  const setFieldFiles = useCallback(
    (key: ApoAcquisitionFieldKey, next: ApoAcquisitionFileAttachment[]) => {
      setFiles((prev) => ({ ...prev, [key]: next }));
    },
    [],
  );

  useEffect(() => {
    if (!form?.configured) return;
    setValues((prev) => {
      const next = { ...prev };
      if (!next.apoAcquiredDate) {
        next.apoAcquiredDate = form.defaults.apoAcquiredYmd;
      }
      if (!next.apStaff) {
        next.apStaff = form.defaults.apStaffName;
      }
      return next;
    });
  }, [form]);

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
    if (formError && isLiffSwrSessionExpired(formError)) {
      setPhase("session-expired");
    }
  }, [formError]);

  const handleSubmit = useCallback(async () => {
    if (!idToken || !form?.configured || !form.writeEnabled) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await liffAuthedJsonFetch<{ ok?: boolean }>(
        "/api/apo-acquisition/records",
        idToken,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apStaffName: values.apStaff ?? form.defaults.apStaffName,
            values,
            files,
          }),
        },
      );
      setFeedback("アポ取得情報を登録しました");
      setValues({
        apStaff: form.defaults.apStaffName,
        apoAcquiredDate: form.defaults.apoAcquiredYmd,
      });
      setFiles({});
    } catch (e) {
      if (isLiffSwrError(e) && e.status === 401) {
        setPhase("session-expired");
        return;
      }
      setFeedback(isLiffSwrError(e) ? e.message : "通信に失敗しました");
    } finally {
      setSubmitting(false);
    }
  }, [idToken, form, values, files]);

  if (phase === "init" || phase === "need-login") {
    return (
      <LiffScreen>
        <LiffLoadingBlock message="読み込み中…" />
      </LiffScreen>
    );
  }

  if (phase === "session-expired") {
    return (
      <LiffScreen>
        <LiffSessionExpiredPanel
          footer={<LiffGhostLink href="/">トップへ</LiffGhostLink>}
        />
      </LiffScreen>
    );
  }

  if (phase === "error") {
    return (
      <LiffScreen>
        <LiffCard>
          <p className="px-5 py-6 text-[14px] text-red-600">{errorMessage}</p>
        </LiffCard>
      </LiffScreen>
    );
  }

  return (
    <LiffScreen>
      <main className="liff-page-main mx-auto w-full max-w-lg flex-1 py-6">
        <LiffPageHeader
          title="アポ取得時入力"
          subtitle="アポ取得情報連携へ新規登録します"
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
          <LiffGhostLink href="/">← トップへ</LiffGhostLink>
        </div>

        <LiffStaffBindingConfigNotice message={account.bindingConfigError} />
        <LiffStaffBindPanel
          staff={account.staff}
          bindingEnabled={account.bindingEnabled}
          boundStaffName={account.boundStaffName}
          accountLoading={account.loading}
          onBind={account.bindStaff}
        />

        {needsStaffBind ? (
          <p className="text-[14px] text-slate-600 dark:text-slate-400">
            スタッフ名簿と紐付けてからご利用ください。
          </p>
        ) : isLoading ? (
          <LiffLoadingBlock message="フォームを読み込み中…" />
        ) : form && !form.configured ? (
          <LiffCard>
            <p className="px-5 py-6 text-[14px] text-amber-800 dark:text-amber-200">
              {form.configError ??
                "アポ取得情報連携の設定を確認してください（SALES_DASHBOARD_APO_APP_ID 等）"}
            </p>
          </LiffCard>
        ) : form && !form.writeEnabled ? (
          <LiffCard>
            <p className="px-5 py-6 text-[14px] text-amber-800 dark:text-amber-200">
              登録用 API キー（SALES_DASHBOARD_APO_ATPOCKET_API_KEY_2）が未設定です。
            </p>
          </LiffCard>
        ) : form ? (
          <LiffCard>
            <div className="space-y-4 px-5 py-6">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-500 dark:bg-orange-950/40 dark:text-orange-300">
                  <ApoGlyph />
                </span>
                <p className="text-[12px] text-slate-500 dark:text-slate-400">
                  見積ステータスは「{form.defaults.estimateStatus}」で登録されます
                </p>
              </div>

              {form.fields
                .filter((f) => f.present)
                .map((field) =>
                  field.kind === "file" ? (
                    <FileFieldRow
                      key={field.key}
                      field={field}
                      files={files[field.key] ?? []}
                      disabled={submitting}
                      onChange={setFieldFiles}
                      onError={setFeedback}
                    />
                  ) : (
                    <FieldRow
                      key={field.key}
                      field={field}
                      value={values[field.key] ?? ""}
                      disabled={submitting}
                      onChange={setValue}
                      onBlur={handleFieldBlur}
                    />
                  ),
                )}

              {feedback ? (
                <p
                  className={`text-[13px] ${
                    feedback.includes("登録しました")
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {feedback}
                </p>
              ) : null}

              <LiffPrimaryButton
                type="button"
                onClick={() => void handleSubmit()}
                disabled={submitting}
              >
                {submitting ? "登録中…" : "アポ取得情報を登録"}
              </LiffPrimaryButton>
            </div>
          </LiffCard>
        ) : null}
      </main>
    </LiffScreen>
  );
}
