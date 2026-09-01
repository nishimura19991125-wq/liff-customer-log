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
  ApoAcquisitionFormPayload,
  ApoAcquisitionValues,
} from "@/lib/apo-acquisition-types";
import {
  APO_ATTACHMENT_MAX_BYTES,
  APO_ATTACHMENT_MAX_FILES,
  apoAcquisitionFeedbackIsError,
} from "@/lib/apo-attachment";
import {
  hasApoDesiredManufacturerOther,
  APO_DESIRED_MANUFACTURER_OTHER,
} from "@/lib/apo-desired-manufacturer";
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

/**
 * アポ取得時入力（/apo-acquisition）。
 *
 * ⚠ **アプリ内にこの画面への導線は無い。**
 *
 * アポ情報一覧（/apo-list）の「新規登録」ボタンから来ていたが、そのボタンは
 * 削除済み。アポの新規登録は別のウェブページで行う運用に変更された。
 * 画面とコードは残してあるが、URL を直に開かないと到達できない。
 *
 * 残してある理由は、使わないことが確定してから消すほうが安全なため。
 * この画面は Dropbox 連携・監査ログ・自動採番に繋がっており、消すと
 * それらへ影響が及ぶ可能性がある。
 *
 * 消すときは、少なくとも次を一緒に確認すること。
 *   src/app/api/apo-acquisition/**        フォーム定義・登録・添付
 *   src/lib/apo-acquisition-*             項目定義・必須条件・サーバ処理
 *   src/lib/apo-attachment-upload.ts      添付の Dropbox 連携
 *   src/lib/apo-record-lookup.ts          登録直後の recordId 照合
 *   src/lib/apo-detail-fields.ts          一覧の詳細表示（**こちらは使用中**）
 */

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] text-slate-900 shadow-sm disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

/** その他メーカーの領域。「その他」チェックの aria-controls が指す */
const OTHER_MANUFACTURER_REGION_ID = "apo-other-manufacturer";

/**
 * 画面側の上限。サーバと同じ定数を見る。
 * ここで弾くのは無駄な送信を減らすためで、判断はサーバが持つ
 */
const MAX_FILE_BYTES = APO_ATTACHMENT_MAX_BYTES;
const MAX_FILES_PER_FIELD = APO_ATTACHMENT_MAX_FILES;

function parseCheckboxValue(raw: string): Set<string> {
  return new Set(
    raw
      .split(/[,、\n]/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function joinCheckboxValue(selected: Set<string>): string {
  return [...selected].join(",");
}

/**
 * 添付は base64 にせず File のまま持つ。
 * レコード登録とは別のリクエストで、1件ずつ multipart で送る
 * （まとめて JSON に載せると 5MB×5件で 33MB ほどになり本文の上限に当たる）
 */
type PendingAttachment = {
  file: File;
  /** 送信結果。未送信は null */
  error: string | null;
  done: boolean;
};

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
    // checkboxGroupText は @pocket 側がテキスト型なだけで、画面は同じ形
    case "checkboxGroupText":
    case "checkboxGroup":
      control = (
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((opt) => {
            const selected = parseCheckboxValue(value);
            const checked = selected.has(opt);
            return (
              <label
                key={opt}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium ${
                  checked
                    ? "border-orange-400 bg-orange-50 text-orange-900 dark:border-orange-500 dark:bg-orange-950/40 dark:text-orange-100"
                    : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                }`}
              >
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300 text-orange-500"
                  checked={checked}
                  disabled={disabled}
                  {...(field.key === "desiredManufacturer" &&
                  opt === APO_DESIRED_MANUFACTURER_OTHER
                    ? {
                        // このチェックで「その他メーカー」欄が出入りする
                        "aria-expanded": checked,
                        "aria-controls": OTHER_MANUFACTURER_REGION_ID,
                      }
                    : {})}
                  onChange={() => {
                    const next = new Set(selected);
                    if (checked) next.delete(opt);
                    else next.add(opt);
                    handle(joinCheckboxValue(next));
                  }}
                />
                {opt}
              </label>
            );
          })}
        </div>
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
    <div className="block space-y-1.5">
      {label}
      {control}
      {field.hint ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {field.hint}
        </p>
      ) : null}
    </div>
  );
}

type FileFieldRowProps = {
  field: ApoAcquisitionFieldMeta;
  files: PendingAttachment[];
  disabled: boolean;
  onChange: (key: ApoAcquisitionFieldKey, files: PendingAttachment[]) => void;
  onError: (message: string) => void;
  /** 失敗した1件だけを送り直す。登録前は null */
  onRetry: ((key: ApoAcquisitionFieldKey, index: number) => void) | null;
};

function FileFieldRow({
  field,
  files,
  disabled,
  onChange,
  onError,
  onRetry,
}: FileFieldRowProps) {
  if (!field.present) return null;

  const handleSelect = (list: FileList | null) => {
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
      next.push({ file, error: null, done: false });
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
          handleSelect(e.target.files);
          e.target.value = "";
        }}
      />
      {field.hint ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {field.hint}
        </p>
      ) : (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          画像またはPDF（1件5MBまで・最大{MAX_FILES_PER_FIELD}件）
        </p>
      )}
      {files.length > 0 ? (
        <ul className="space-y-1">
          {files.map((entry, index) => (
            <li
              key={`${entry.file.name}-${index}`}
              className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-700 dark:bg-slate-800/60 dark:text-slate-200"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{entry.file.name}</span>
                {/* 送信済み・失敗が一目で分かるようにする */}
                {entry.done ? (
                  <span className="text-[11px] text-emerald-700 dark:text-emerald-400">
                    送信済み
                  </span>
                ) : entry.error ? (
                  <span
                    role="alert"
                    aria-live="assertive"
                    className="text-[11px] text-red-700 dark:text-red-400"
                  >
                    {entry.error}
                  </span>
                ) : null}
              </span>
              {/* 失敗した1件だけを送り直す。成功した分は送り直さない */}
              {entry.error && !entry.done && onRetry ? (
                <button
                  type="button"
                  className="shrink-0 font-medium text-orange-600 disabled:opacity-50 dark:text-orange-400"
                  disabled={disabled}
                  onClick={() => onRetry(field.key, index)}
                >
                  再送
                </button>
              ) : null}
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
    Partial<Record<ApoAcquisitionFieldKey, PendingAttachment[]>>
  >({});
  /** 送信中のファイルの位置。何件目を送っているか画面に出すため */
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  /**
   * 登録が済んだかどうか。
   *
   * null 以外になったら**二度と登録要求を出さない**。
   * @pocket がレコード ID を返さないことがあり、以前はそれを失敗として
   * 見せていたため、押し直しで重複レコードが増えていた。
   * ID を特定できたかどうかに関わらず、作成が通った時点でここを埋める。
   *
   * recordId は添付の送信先。特定できなかったときは null で、
   * 添付は送れないが登録そのものは成功として扱う
   */
  const [created, setCreated] = useState<{ recordId: string | null } | null>(
    null,
  );
  const createdRecordId = created?.recordId ?? null;
  /** 共有リンクの保存だけ落ちたか。貼り直しの導線を出す */
  const [linkUnsaved, setLinkUnsaved] = useState(false);

  /**
   * その他メーカーを出すか。希望メーカーで「その他」を選んだときだけ。
   * 判定は src/lib 側（保存時の必須判定と同じ関数）
   */
  const showsOtherManufacturer = hasApoDesiredManufacturerOther(
    values.desiredManufacturer,
  );

  /** 通知文を赤字・alert で出すか。判定は src/lib 側 */
  const feedbackIsError = apoAcquisitionFeedbackIsError(feedback ?? "");

  /** まだ送っていない添付の件数 */
  const pendingAttachmentCount = Object.values(files).reduce(
    (n, list) => n + (list ?? []).filter((f) => !f.done).length,
    0,
  );
  /**
   * 登録が済み、送り直す添付も無い状態。
   * ここで「登録」を押させると重複レコードになるので、
   * ボタンは入力のやり直しに切り替える
   */
  const finished =
    created !== null && (!created.recordId || pendingAttachmentCount === 0);

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
    (key: ApoAcquisitionFieldKey, next: PendingAttachment[]) => {
      setFiles((prev) => ({ ...prev, [key]: next }));
    },
    [],
  );

  /** 1件分の送信結果を書き戻す。他の行はそのまま */
  const markAttachment = useCallback(
    (
      key: ApoAcquisitionFieldKey,
      index: number,
      patch: { done: boolean; error: string | null },
    ) => {
      setFiles((prev) => {
        const list = prev[key];
        const target = list?.[index];
        if (!target) return prev;
        const next = [...list];
        next[index] = { ...target, ...patch };
        return { ...prev, [key]: next };
      });
    },
    [],
  );

  /** 登録が最後まで通ったときだけ入力を空にする */
  const resetForm = useCallback(() => {
    if (!form?.configured) return;
    setValues({
      apStaff: form.defaults.apStaffName,
      apoAcquiredDate: form.defaults.apoAcquiredYmd,
    });
    setFiles({});
    setCreated(null);
    setLinkUnsaved(false);
  }, [form]);

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

  /**
   * 添付を1件だけ送る。
   *
   * まとめて送らないのは、5MB×5件を JSON に載せると 33MB ほどになり
   * 本文の上限に当たるため。1件ずつなら1リクエストは 5MB 以内に収まる。
   *
   * Dropbox には削除権限が無く、上げたファイルは取り消せない。
   * だから全体をまとめて成功・失敗にせず、1件ごとに結果を残す
   */
  const sendAttachment = useCallback(
    async (
      recordId: string,
      token: string,
      key: ApoAcquisitionFieldKey,
      index: number,
      file: File,
    ): Promise<{ sent: boolean; linkSaved: boolean }> => {
      const body = new FormData();
      body.append("file", file);
      try {
        const res = await fetch(
          `/api/apo-acquisition/records/${encodeURIComponent(recordId)}/attachments`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body,
          },
        );
        const parsed = (await res.json().catch(() => ({}))) as {
          error?: string;
          linkSaved?: boolean;
        };
        if (!res.ok) throw new Error(parsed.error ?? "送信に失敗しました");
        markAttachment(key, index, { done: true, error: null });
        // ファイルは上がったがリンクだけ落ちた場合がある
        return { sent: true, linkSaved: parsed.linkSaved !== false };
      } catch (e) {
        markAttachment(key, index, {
          done: false,
          error: e instanceof Error ? e.message : "送信に失敗しました",
        });
        return { sent: false, linkSaved: true };
      }
    },
    [markAttachment],
  );

  /** 未送信の添付をまとめて順に送る。送信済みは飛ばす */
  const uploadAttachments = useCallback(
    async (recordId: string, token: string): Promise<number> => {
      const pending: {
        key: ApoAcquisitionFieldKey;
        index: number;
        file: File;
      }[] = [];
      for (const key of Object.keys(files) as ApoAcquisitionFieldKey[]) {
        (files[key] ?? []).forEach((entry, index) => {
          if (!entry.done) pending.push({ key, index, file: entry.file });
        });
      }
      if (pending.length === 0) return 0;

      let failed = 0;
      let linkMissing = false;
      for (let i = 0; i < pending.length; i += 1) {
        const item = pending[i]!;
        setUploadProgress({ current: i + 1, total: pending.length });
        const r = await sendAttachment(
          recordId,
          token,
          item.key,
          item.index,
          item.file,
        );
        if (!r.sent) failed += 1;
        if (!r.linkSaved) linkMissing = true;
      }

      setUploadProgress(null);
      setLinkUnsaved(linkMissing);
      return failed;
    },
    [files, sendAttachment],
  );

  /** 失敗した1件だけを送り直す */
  const retryAttachment = useCallback(
    (key: ApoAcquisitionFieldKey, index: number) => {
      const entry = (files[key] ?? [])[index];
      if (!idToken || !createdRecordId || !entry || entry.done) return;
      void (async () => {
        setSubmitting(true);
        setFeedback(null);
        setUploadProgress({ current: 1, total: 1 });
        try {
          const r = await sendAttachment(
            createdRecordId,
            idToken,
            key,
            index,
            entry.file,
          );
          if (!r.linkSaved) setLinkUnsaved(true);
          if (r.sent) setFeedback(`${entry.file.name}を送信しました`);
        } finally {
          setUploadProgress(null);
          setSubmitting(false);
        }
      })();
    },
    [files, idToken, createdRecordId, sendAttachment],
  );

  /** 共有リンクだけを貼り直す */
  const handleRetryLink = useCallback(async () => {
    if (!idToken || !createdRecordId) return;
    setSubmitting(true);
    try {
      await liffAuthedJsonFetch<{ ok?: boolean }>(
        `/api/apo-acquisition/records/${encodeURIComponent(createdRecordId)}/attachments`,
        idToken,
        { method: "PUT" },
      );
      setLinkUnsaved(false);
      setFeedback("共有リンクを保存しました");
    } catch (e) {
      setFeedback(
        isLiffSwrError(e) ? e.message : "共有リンクの保存に失敗しました",
      );
    } finally {
      setSubmitting(false);
    }
  }, [idToken, createdRecordId]);

  const handleSubmit = useCallback(async () => {
    if (!idToken || !form?.configured || !form.writeEnabled) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      /**
       * 登録と添付を別のリクエストに分ける。
       *
       * created が埋まっているのは「登録は済んでいる」状態。
       * ここで作り直すと重複レコードになるので、絶対に登録要求を出さない。
       * 残っている添付だけを送り直す
       */
      let target = created;
      if (!target) {
        const res = await liffAuthedJsonFetch<{
          ok?: boolean;
          recordId?: string;
        }>("/api/apo-acquisition/records", idToken, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apStaffName: values.apStaff ?? form.defaults.apStaffName,
            values,
          }),
        });
        /**
         * ここに来た時点でレコードは作成済み。
         * recordId が空でも「登録できた」として確定させる
         * （空のまま失敗と伝えると、押し直しで重複が増える）
         */
        target = { recordId: res.recordId?.trim() || null };
        setCreated(target);
      }

      const pending = Object.values(files).reduce(
        (n, list) => n + (list ?? []).filter((f) => !f.done).length,
        0,
      );

      if (pending === 0) {
        setFeedback("アポ取得情報を登録しました");
        resetForm();
        return;
      }

      if (!target.recordId) {
        /**
         * レコードは作られているが、@pocket が ID を返さず一覧照合でも
         * 特定できなかった。添付だけ諦める。
         * 「失敗しました」とは伝えない（実際には登録されている）
         */
        setFeedback(
          "アポ取得情報を登録しました。ただし添付ファイルは保存できませんでした。お手数ですが @pocket から直接ご登録ください。",
        );
        return;
      }

      const failed = await uploadAttachments(target.recordId, idToken);
      if (failed > 0) {
        setFeedback(
          `アポ取得情報を登録しました。添付${failed}件の送信に失敗しました。「失敗した添付を送り直す」でやり直せます。`,
        );
        return;
      }

      setFeedback("アポ取得情報を登録しました");
      resetForm();
    } catch (e) {
      if (isLiffSwrError(e) && e.status === 401) {
        setPhase("session-expired");
        return;
      }
      setFeedback(isLiffSwrError(e) ? e.message : "通信に失敗しました");
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  }, [idToken, form, values, files, created, uploadAttachments, resetForm]);

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
                /**
                 * その他メーカーは「その他」を選んだときだけ出す。
                 * 外しても values からは消さないので、選び直せば入力値が戻る
                 */
                .filter(
                  (f) =>
                    f.key !== "otherManufacturer" || showsOtherManufacturer,
                )
                /**
                 * 添付欄は保存先（DROPBOX_APO_ROOT_PATH）が設定されている
                 * ときだけ出す。未設定でも登録そのものは通す
                 */
                .filter((f) => f.kind !== "file" || form.attachmentEnabled)
                .map((field) =>
                  field.kind === "file" ? (
                    <FileFieldRow
                      key={field.key}
                      field={field}
                      files={files[field.key] ?? []}
                      disabled={submitting}
                      onChange={setFieldFiles}
                      onError={setFeedback}
                      onRetry={createdRecordId ? retryAttachment : null}
                    />
                  ) : field.key === "otherManufacturer" ? (
                    /* 出ているときだけ必須。* の表示を実際の条件に合わせる */
                    <div id={OTHER_MANUFACTURER_REGION_ID}>
                      <FieldRow
                        key={field.key}
                        field={{ ...field, required: true }}
                        value={values[field.key] ?? ""}
                        disabled={submitting}
                        onChange={setValue}
                        onBlur={handleFieldBlur}
                      />
                    </div>
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

              {/* 何件目を送っているかを伝える。読み上げは控えめに */}
              <p
                role="status"
                aria-live="polite"
                className="text-[12px] text-slate-500 dark:text-slate-400"
              >
                {uploadProgress
                  ? `添付を送信中… ${uploadProgress.current}件目 / ${uploadProgress.total}件`
                  : ""}
              </p>

              {feedback ? (
                <p
                  role={feedbackIsError ? "alert" : "status"}
                  aria-live={feedbackIsError ? "assertive" : "polite"}
                  className={`text-[13px] ${
                    feedbackIsError
                      ? "text-red-600 dark:text-red-400"
                      : "text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  {feedback}
                </p>
              ) : null}

              {/*
                ファイルは上がったのにリンクの保存だけ落ちた場合。
                放っておくと @pocket を直接触るしかなくなるので、
                ここから貼り直せるようにしておく
              */}
              {linkUnsaved && createdRecordId ? (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="space-y-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                >
                  <p>
                    ファイルは保存されましたが、ドロップボックスURL
                    の保存に失敗しました。
                  </p>
                  <button
                    type="button"
                    className="font-medium underline disabled:opacity-50"
                    disabled={submitting}
                    onClick={() => void handleRetryLink()}
                  >
                    URL を保存し直す
                  </button>
                </div>
              ) : null}

              {/*
                登録が済んだあとは登録要求を出さない。
                @pocket は作成しても ID を返さないことがあり、
                「失敗に見えて実は登録されている」状態で押し直すと
                重複レコードが増えるため
              */}
              <LiffPrimaryButton
                type="button"
                onClick={() => {
                  if (finished) {
                    // 前回の知らせを残したまま次の入力に入らせない
                    setFeedback(null);
                    resetForm();
                    return;
                  }
                  void handleSubmit();
                }}
                disabled={submitting}
              >
                {submitting
                  ? "送信中…"
                  : finished
                    ? "続けて新規登録する"
                    : created
                      ? "失敗した添付を送り直す"
                      : "アポ取得情報を登録"}
              </LiffPrimaryButton>
            </div>
          </LiffCard>
        ) : null}
      </main>
    </LiffScreen>
  );
}
