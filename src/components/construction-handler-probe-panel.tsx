"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * 【一時的な調査用パネル】
 *
 * 工事対応者の書き込みが反映されない件の原因究明用。
 * **原因が判明したら削除してください。** 削除するのは次の4つです。
 *   1. このファイル
 *   2. src/app/page.tsx の <ConstructionHandlerProbePanel /> と import
 *   3. src/app/api/%5Fprobe/construction-handler/route.ts
 *   4. Netlify の PROBE_ENABLED
 *
 * PROBE_ENABLED が無効なら調査ルートが 404 を返すため、このパネルは
 * 何も描きません（表示可否はサーバ側の設定だけで決まります）。
 *
 * ブラウザで直接叩くと LINE の認証ヘッダが付かず 401 になるため、
 * LIFF の画面から id token 付きで呼べるようにしています。
 *
 * 既定は「調べるだけ」。書き込みは別のボタンで、確認を1枚挟みます。
 */

const PROBE_PATH = "/api/_probe/construction-handler";

type Phase = "checking" | "hidden" | "ready";

export function ConstructionHandlerProbePanel({
  idToken,
}: {
  idToken: string | null;
}) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [running, setRunning] = useState(false);
  const [recordId, setRecordId] = useState("");
  const [value, setValue] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [json, setJson] = useState("");
  const [message, setMessage] = useState("");
  const bodyId = useId();
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  // 有効かどうかだけ確かめる。recordId なしで呼ぶと 400 が返るので、
  // 404（無効）と 400（有効）で見分ける
  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(PROBE_PATH, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });
        if (cancelled) return;
        setPhase(res.status === 404 ? "hidden" : "ready");
      } catch {
        if (!cancelled) setPhase("hidden");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idToken]);

  const run = useCallback(
    async (write: boolean) => {
      if (!idToken || running) return;
      if (!recordId.trim()) {
        setMessage("レコードIDを入れてください");
        return;
      }
      setRunning(true);
      setConfirming(false);
      setMessage(write ? "書き込み中…" : "取得中…");
      setJson("");
      try {
        const res = await fetch(PROBE_PATH, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            recordId: recordId.trim(),
            ...(write ? { value: value.trim(), write: true } : {}),
          }),
        });
        const raw = await res.text();
        let pretty = raw;
        try {
          pretty = JSON.stringify(JSON.parse(raw), null, 2);
        } catch {
          // JSON でなければ生のまま出す
        }
        setJson(pretty);
        setMessage(
          res.ok
            ? write
              ? "書き込みました。reflected と putResponse を確認してください"
              : "取得しました"
            : `エラー応答（HTTP ${res.status}）`,
        );
      } catch {
        setMessage("通信に失敗しました");
      } finally {
        setRunning(false);
      }
    },
    [idToken, running, recordId, value],
  );

  const copy = useCallback(async () => {
    if (!json) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
        setMessage("コピーしました");
        return;
      }
    } catch {
      // 権限拒否・非セキュアコンテキストなど。手動選択へ落とす
    }
    textRef.current?.focus();
    textRef.current?.select();
    setMessage("全選択しました。長押しなどでコピーしてください");
  }, [json]);

  if (phase !== "ready") return null;

  const inputClass =
    "w-full min-w-0 rounded-lg border border-slate-300 px-2 py-1 text-[12px] dark:border-slate-600 dark:bg-slate-900 dark:text-white";

  return (
    <div className="mt-3 rounded-xl border border-dashed border-sky-400 p-3 dark:border-sky-600">
      <p className="text-[11px] font-bold text-sky-800 dark:text-sky-300">
        調査用（一時）: 工事対応者の書き込み
      </p>

      <div className="mt-2 flex flex-col gap-1.5">
        <label className="text-[11px] text-slate-600 dark:text-slate-300">
          工事レコードID
          <input
            type="text"
            inputMode="numeric"
            value={recordId}
            disabled={running}
            placeholder="例: 3228"
            onChange={(e) => setRecordId(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-[11px] text-slate-600 dark:text-slate-300">
          書き込む工事対応者名（書き込むときだけ）
          <input
            type="text"
            value={value}
            disabled={running}
            placeholder="例: トラーチ倶楽部"
            onChange={(e) => setValue(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={running || !idToken}
          aria-controls={bodyId}
          onClick={() => void run(false)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
        >
          {running ? "処理中…" : "調べる（書き込まない）"}
        </button>

        {confirming ? (
          <>
            <span className="text-[12px] font-bold text-sky-900 dark:text-sky-300">
              このレコードに書き込みます。よろしいですか
            </span>
            <button
              type="button"
              disabled={running}
              onClick={() => void run(true)}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-[12px] font-bold text-white transition active:scale-[0.98] disabled:opacity-50"
            >
              書き込む
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg px-2 py-1.5 text-[12px] font-semibold text-slate-500 dark:text-slate-400"
            >
              やめる
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={running || !idToken}
            onClick={() => setConfirming(true)}
            className="rounded-lg border border-sky-400 px-3 py-1.5 text-[12px] font-bold text-sky-900 transition active:scale-[0.98] disabled:opacity-50 dark:border-sky-600 dark:text-sky-300"
          >
            書き込んで試す…
          </button>
        )}

        {json ? (
          <button
            type="button"
            onClick={() => void copy()}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition active:scale-[0.98] dark:border-slate-600 dark:text-slate-200"
          >
            コピーする
          </button>
        ) : null}
      </div>

      {/* 要素は出し入れせず常に置いて読み上げの取りこぼしを防ぐ */}
      <p
        role="status"
        aria-live="polite"
        className={
          message
            ? "mt-1 text-[11px] font-bold text-slate-600 dark:text-slate-300"
            : "sr-only"
        }
      >
        {message}
      </p>

      {json ? (
        <>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
            ⚠ 工事レコードの全項目（顧客名を含む）が入っています。共有する前に
            中身を確認してください
          </p>
          <textarea
            id={bodyId}
            ref={textRef}
            readOnly
            rows={18}
            value={json}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="調査結果の JSON"
            className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 p-2 font-mono text-[11px] leading-relaxed text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
        </>
      ) : null}
    </div>
  );
}
