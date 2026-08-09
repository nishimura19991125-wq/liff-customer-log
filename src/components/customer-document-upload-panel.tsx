"use client";

import { useId, useRef, useState } from "react";

import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";
import { DOCUMENT_ALLOWED_EXTENSIONS } from "@/lib/document-upload-name";

/**
 * 書類1項目分のアップロード欄（タスクF-7）。
 *
 * customer-info-edit-form.tsx が既に1,000行を超えているため別コンポーネントに切り出し、
 * 呼び出し側は表示条件の判定と結果の反映だけを行う。
 *
 * 送信は**1ファイルずつ順次**。Netlify Functions のボディ上限（約6MB）を
 * 並列送信で踏まないようにするため。
 */

const ACCEPT_ATTR = DOCUMENT_ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",");

type UploadOutcome = {
  fileName: string;
  statusUpdated: boolean;
  status?: string;
  warning?: string;
};

function formatMegabytes(bytes: number): string {
  return String(Math.floor(bytes / 1_000_000));
}

export function CustomerDocumentUploadPanel({
  recordId,
  documentKey,
  documentLabel,
  idToken,
  maxBytes,
  disabled,
  onUploaded,
  onSessionExpired,
}: {
  recordId: string;
  documentKey: string;
  documentLabel: string;
  idToken: string | null;
  maxBytes: number;
  disabled?: boolean;
  /** 1件成功するたびに呼ばれる。完了値でラジオを切り替えるのに使う */
  onUploaded: (result: { status?: string; statusUpdated: boolean }) => void;
  onSessionExpired?: () => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState<UploadOutcome[]>([]);

  const oversized = files.filter((f) => f.size > maxBytes);
  const canSubmit =
    Boolean(idToken) &&
    !disabled &&
    !uploading &&
    files.length > 0 &&
    oversized.length === 0;

  function pickFiles(list: FileList | null) {
    setErrors([]);
    setDone([]);
    setProgress(null);
    setFiles(list ? Array.from(list) : []);
  }

  function clearSelection() {
    setFiles([]);
    setErrors([]);
    setProgress(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function uploadOne(file: File, token: string): Promise<UploadOutcome> {
    const body = new FormData();
    body.set("documentKey", documentKey);
    body.set("file", file);

    const res = await fetch(
      `/api/customer-info/records/${encodeURIComponent(recordId)}/documents/upload`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
      },
    );

    const raw = await res.text();
    let data: {
      error?: string;
      fileName?: string;
      statusUpdated?: boolean;
      status?: string;
      warning?: string;
    } = {};
    if (raw.trim()) {
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        data = {};
      }
    }

    if (res.status === 401 && isLineSessionExpiredPayload(data)) {
      onSessionExpired?.();
      throw new Error("__session_expired__");
    }
    if (!res.ok) {
      throw new Error(
        data.error?.trim() || `送信に失敗しました（HTTP ${res.status}）`,
      );
    }

    return {
      fileName: data.fileName ?? file.name,
      statusUpdated: data.statusUpdated === true,
      status: data.status,
      warning: data.warning,
    };
  }

  async function handleUpload() {
    const token = idToken;
    if (!token || files.length === 0) return;

    setUploading(true);
    setErrors([]);
    setDone([]);

    const succeeded: UploadOutcome[] = [];
    const failed: string[] = [];
    // 成功した分は残す。失敗した分だけ選択に残して再送できるようにする
    const retry: File[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      setProgress({ done: i, total: files.length });
      try {
        const outcome = await uploadOne(file, token);
        succeeded.push(outcome);
        onUploaded({
          status: outcome.status,
          statusUpdated: outcome.statusUpdated,
        });
      } catch (e) {
        if (e instanceof Error && e.message === "__session_expired__") {
          setUploading(false);
          setProgress(null);
          return;
        }
        retry.push(file);
        failed.push(
          `${file.name}: ${e instanceof Error ? e.message : "送信に失敗しました"}`,
        );
      }
    }

    setProgress({ done: files.length, total: files.length });
    setDone(succeeded);
    setErrors(failed);
    setFiles(retry);
    if (retry.length === 0 && inputRef.current) inputRef.current.value = "";
    setUploading(false);
  }

  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
      <label
        htmlFor={inputId}
        className="block text-[11px] font-bold text-slate-600"
      >
        {documentLabel}のファイルを添付
      </label>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        disabled={disabled || uploading}
        onChange={(e) => pickFiles(e.target.files)}
        className="mt-1 block w-full text-[12px] text-slate-700 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 file:text-[12px] file:font-bold file:text-slate-700"
      />
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        PDF・JPG・PNG・HEIC／1ファイル {formatMegabytes(maxBytes)}MB まで。
        アップロードすると「{documentLabel}」が完了状態に切り替わります。
      </p>

      {files.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {files.map((f) => {
            const tooBig = f.size > maxBytes;
            return (
              <li
                key={`${f.name}-${f.size}-${f.lastModified}`}
                className={`text-[11px] leading-relaxed ${
                  tooBig ? "font-bold text-red-700" : "text-slate-700"
                }`}
              >
                {f.name}
                {tooBig ? "（サイズ超過）" : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {oversized.length > 0 ? (
        <p
          role="alert"
          aria-live="assertive"
          className="mt-1.5 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-[11px] font-bold leading-relaxed text-red-800"
        >
          ファイルサイズが大きすぎます（上限{formatMegabytes(maxBytes)}MB）。
          分割するか、画質を下げて再撮影してください。
        </p>
      ) : null}

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void handleUpload()}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:bg-slate-300"
        >
          {uploading ? "送信中…" : "アップロード"}
        </button>
        {files.length > 0 && !uploading ? (
          <button
            type="button"
            onClick={clearSelection}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[12px] font-semibold text-slate-600"
          >
            選択を解除
          </button>
        ) : null}
      </div>

      {/* 進捗は常に DOM に置く。表示のたびに要素を作り直すと読み上げが飛ぶため */}
      <p
        role="status"
        aria-live="polite"
        className="mt-1.5 text-[11px] font-bold text-slate-700"
      >
        {uploading && progress
          ? `${progress.total}件中${Math.min(progress.done + 1, progress.total)}件目を送信中…`
          : ""}
      </p>

      {done.length > 0 ? (
        <div
          role="status"
          aria-live="polite"
          className="mt-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-emerald-900"
        >
          <p className="font-bold">{done.length}件をアップロードしました</p>
          <ul className="mt-0.5 space-y-0.5">
            {done.map((d) => (
              <li key={d.fileName}>{d.fileName}</li>
            ))}
          </ul>
          {done.some((d) => !d.statusUpdated) ? (
            <p
              role="alert"
              aria-live="assertive"
              className="mt-1 font-bold text-amber-900"
            >
              ファイルは保存されましたが、ステータスの更新に失敗しました。手動で変更してください。
            </p>
          ) : null}
        </div>
      ) : null}

      {errors.length > 0 ? (
        <div
          role="alert"
          aria-live="assertive"
          className="mt-1.5 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-red-800"
        >
          <p className="font-bold">
            {errors.length}件の送信に失敗しました（選択に残しています。再度アップロードしてください）
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {errors.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
