"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * 【一時的な移行用パネル】
 *
 * 既存顧客の Dropboxリンク を一括で埋めるための操作パネル（タスクN）。
 * **移行完了後、/api/_migrate/dropbox-link ごと削除してください。**
 * 削除するのは次の4つです。
 *   1. このファイル
 *   2. src/app/page.tsx の <DropboxLinkMigrationPanel /> と import
 *   3. src/app/api/%5Fmigrate/dropbox-link/route.ts
 *   4. Netlify の MIGRATE_ENABLED
 *
 * MIGRATE_ENABLED が無効なら移行ルートが 404 を返すため、このパネルは
 * 何も描きません（表示可否はサーバ側の設定だけで決まります）。
 *
 * ■ 書き込みを伴うので、調査用パネルより一段慎重にしてある
 *   - 既定の操作は「確認（書き込まない）」。実行は別のボタン
 *   - 実行ボタンは確認を1枚挟む
 *   - 新しいタブは開かず、結果はこの画面に出す（LIFF では開けないことがある）
 *
 * ■ 自動で続きを実行する
 * サーバは Netlify Free の実行上限10秒に収まるところで打ち切り、
 * remaining（残り）を返す。ここでは remaining が 0 になるまで呼び直す。
 * 止めたくなったら「停止」を押す。**押した回が終わった時点で止まる**
 * （書き込みの途中では止めない。中途半端なレコードを作らないため）。
 */

const MIGRATE_PATH = "/api/_migrate/dropbox-link";

type Phase = "checking" | "hidden" | "ready";

type MigrationResponse = {
  dryRun?: boolean;
  matched?: number;
  remaining?: number;
  processed?: number;
  succeeded?: number;
  failed?: Array<{ tNumber: string; reason: string }>;
  stoppedByRateLimit?: boolean;
  stoppedByFailures?: boolean;
  stoppedByBudget?: boolean;
  error?: string;
};

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
  const [rounds, setRounds] = useState(0);
  const [totalSucceeded, setTotalSucceeded] = useState(0);
  const bodyId = useId();
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  /** 「停止」を押したか。実行中のループから読む */
  const stopRef = useRef(false);

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

  /** 1回ぶん呼ぶ。整形した JSON と解釈済みの結果を返す */
  const callOnce = useCallback(
    async (
      dryRun: boolean,
    ): Promise<{ ok: boolean; data: MigrationResponse; pretty: string }> => {
      const qs = new URLSearchParams({ dryRun: dryRun ? "1" : "0" });
      const res = await fetch(`${MIGRATE_PATH}?${qs.toString()}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken ?? ""}` },
      });
      const raw = await res.text();
      let data: MigrationResponse = {};
      let pretty = raw;
      try {
        data = JSON.parse(raw) as MigrationResponse;
        pretty = JSON.stringify(data, null, 2);
      } catch {
        // JSON でなければ生のまま出す
      }
      return { ok: res.ok, data, pretty };
    },
    [idToken],
  );

  const dryRun = useCallback(async () => {
    if (!idToken || running) return;
    setRunning(true);
    setMessage("確認中…");
    setJson("");
    try {
      const { ok, data, pretty } = await callOnce(true);
      setJson(pretty);
      setMessage(
        ok
          ? "確認しました（書き込んでいません）"
          : `エラー応答: ${data.error ?? "不明"}`,
      );
    } catch {
      setMessage("通信に失敗しました");
    } finally {
      setRunning(false);
    }
  }, [idToken, running, callOnce]);

  /** remaining が 0 になるまで繰り返す */
  const runAll = useCallback(async () => {
    if (!idToken || running) return;
    stopRef.current = false;
    setRunning(true);
    setConfirming(false);
    setRounds(0);
    setTotalSucceeded(0);
    setJson("");

    let round = 0;
    let total = 0;
    try {
      // 上限は暴走防止のバックストップ。通常は remaining が 0 になって抜ける
      for (let i = 0; i < 500; i++) {
        round += 1;
        setRounds(round);
        setMessage(`実行中… ${round}回目（これまで ${total} 件）`);

        const { ok, data, pretty } = await callOnce(false);
        setJson(pretty);

        if (!ok) {
          setMessage(`中断しました: ${data.error ?? "エラー応答"}`);
          return;
        }

        total += data.succeeded ?? 0;
        setTotalSucceeded(total);

        if (data.stoppedByRateLimit) {
          setMessage(
            `利用上限に達したため中断しました（これまで ${total} 件）。しばらく待ってから再開してください`,
          );
          return;
        }
        if (data.stoppedByFailures) {
          setMessage(
            `失敗が続いたため中断しました（これまで ${total} 件）。結果の failed を確認してください`,
          );
          return;
        }
        if ((data.remaining ?? 0) <= 0) {
          setMessage(`完了しました（合計 ${total} 件）`);
          return;
        }
        if ((data.succeeded ?? 0) === 0) {
          // 進まなくなった。同じ失敗を繰り返さないよう止める
          setMessage(
            `1件も書き込めなかったため中断しました（これまで ${total} 件）。結果の failed を確認してください`,
          );
          return;
        }
        if (stopRef.current) {
          setMessage(
            `停止しました（これまで ${total} 件・残り ${data.remaining} 件）`,
          );
          return;
        }
      }
      setMessage(`回数の上限に達したため中断しました（合計 ${total} 件）`);
    } catch {
      setMessage(`通信に失敗しました（これまで ${total} 件）`);
    } finally {
      setRunning(false);
      stopRef.current = false;
    }
  }, [idToken, running, callOnce]);

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
      <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        1回あたり8秒で区切り、残りが無くなるまで自動で繰り返します
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={running || !idToken}
          aria-controls={bodyId}
          onClick={() => void dryRun()}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
        >
          確認する（書き込まない）
        </button>

        {running ? (
          <button
            type="button"
            onClick={() => {
              stopRef.current = true;
              setMessage("この回が終わったら停止します…");
            }}
            className="rounded-lg border border-slate-400 px-3 py-1.5 text-[12px] font-bold text-slate-700 transition active:scale-[0.98] dark:border-slate-500 dark:text-slate-200"
          >
            停止
          </button>
        ) : confirming ? (
          <>
            <span className="text-[12px] font-bold text-amber-900 dark:text-amber-300">
              残りが無くなるまで書き込みます。よろしいですか
            </span>
            <button
              type="button"
              onClick={() => void runAll()}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-bold text-white transition active:scale-[0.98]"
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
            disabled={!idToken}
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

      {rounds > 0 ? (
        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
          {rounds}回実行 / 書き込み {totalSucceeded} 件
        </p>
      ) : null}

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
