"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * 【一時的な移行用パネル】
 *
 * 既存顧客の Dropboxリンク を一括で埋めるための操作パネル（タスクN）。
 * **移行完了後、/api/_migrate/dropbox-link ごと削除してください。**
 * 削除するのは次の3つです。
 *   1. このファイル
 *   2. src/app/page.tsx の <DropboxLinkMigrationPanel /> と import
 *   3. src/app/api/%5Fmigrate/dropbox-link/route.ts
 * 併せて Netlify の MIGRATE_ENABLED を外してください。
 *
 * MIGRATE_ENABLED が無効なら移行ルートが 404 を返すため、このパネルは
 * 何も描きません（表示可否はサーバ側の設定だけで決まります）。
 *
 * ■ 書き込みを伴うので、調査用パネルより一段慎重にしてある
 *   - 既定は「確認（書き込まない）」。実行は別のボタン
 *   - 実行ボタンは確認ダイアログを1枚挟む
 *   - 新しいタブは開かず、結果はこの画面に出す（LIFF では開けないことがある）
 */

const MIGRATE_PATH = "/api/_migrate/dropbox-link";

type Phase = "checking" | "hidden" | "ready";

export function DropboxLinkMigrationPanel({
  idToken,
}: {
  idToken: string | null;
}) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [running, setRunning] = useState(false);
  const [json, setJson] = useState("");
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [limit, setLimit] = useState(50);
  const bodyId = useId();
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  // 有効かどうかだけ先に確かめる。@pocket も Dropbox も呼ばれない
  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${MIGRATE_PATH}?check=1`, {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (cancelled) return;
        setPhase(res.ok ? "ready" : "hidden");
      } catch {
        if (!cancelled) setPhase("hidden");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idToken]);

  const run = useCallback(
    async (dryRun: boolean) => {
      if (!idToken || running) return;
      setRunning(true);
      setMessage(dryRun ? "確認中…" : "実行中…（時間がかかります）");
      setJson("");
      try {
        const qs = new URLSearchParams({
          dryRun: dryRun ? "1" : "0",
          limit: String(limit),
        });
        const res = await fetch(`${MIGRATE_PATH}?${qs.toString()}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}` },
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
            ? dryRun
              ? "確認しました（書き込んでいません）"
              : "実行しました。結果を確認してください"
            : `エラー応答（HTTP ${res.status}）`,
        );
      } catch {
        setMessage("通信に失敗しました");
      } finally {
        setRunning(false);
        setConfirming(false);
      }
    },
    [idToken, running, limit],
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

  return (
    <div className="mt-3 rounded-xl border border-dashed border-amber-400 p-3 dark:border-amber-600">
      <p className="text-[11px] font-bold text-amber-800 dark:text-amber-300">
        移行用（一時）: 既存顧客の Dropboxリンク 一括紐付け
      </p>

      <label className="mt-2 flex items-center gap-2 text-[12px] text-slate-600 dark:text-slate-300">
        1回の件数
        <input
          type="number"
          min={1}
          max={200}
          value={limit}
          disabled={running}
          onChange={(e) => setLimit(Number(e.target.value) || 50)}
          className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-[12px] dark:border-slate-600 dark:bg-slate-900 dark:text-white"
        />
      </label>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={running || !idToken}
          aria-controls={bodyId}
          onClick={() => void run(true)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
        >
          {running ? "処理中…" : "確認する（書き込まない）"}
        </button>

        {confirming ? (
          <>
            <span className="text-[12px] font-bold text-amber-900 dark:text-amber-300">
              {limit}件を書き込みます。よろしいですか
            </span>
            <button
              type="button"
              disabled={running}
              onClick={() => void run(false)}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-bold text-white transition active:scale-[0.98] disabled:opacity-50"
            >
              実行する
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
            className="rounded-lg border border-amber-400 px-3 py-1.5 text-[12px] font-bold text-amber-900 transition active:scale-[0.98] disabled:opacity-50 dark:border-amber-600 dark:text-amber-300"
          >
            書き込む…
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
        <textarea
          id={bodyId}
          ref={textRef}
          readOnly
          rows={16}
          value={json}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="移行結果の JSON"
          className="mt-2 w-full rounded-lg border border-slate-300 bg-slate-50 p-2 font-mono text-[11px] leading-relaxed text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />
      ) : null}
    </div>
  );
}
