"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * 【一時的な調査用パネル】
 *
 * 目標登録(月次)アプリの構成を LIFF の画面から確認するための一時的なものです。
 * **調査完了後、/api/_probe/sales-target ごと削除してください。**
 * 削除するのは次の3つです。
 *   1. このファイル
 *   2. src/app/page.tsx の <SalesTargetProbePanel /> と import
 *   3. src/app/api/%5Fprobe/sales-target/route.ts
 * 併せて Netlify の PROBE_ENABLED を外してください。
 *
 * PROBE_ENABLED が無効なら調査ルートが 404 を返すため、このパネルは
 * 何も描きません（表示可否はサーバ側の設定だけで決まります）。
 *
 * 新しいタブは開きません。LIFF の WebView では開けないことがあるためです。
 */

const PROBE_PATH = "/api/_probe/sales-target";

type Phase = "checking" | "hidden" | "ready";

/** LIFF の WebView は navigator.clipboard が無い / 権限が無いことがある */
async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 権限拒否・非セキュアコンテキストなど。手動選択へ落とす
  }
  return false;
}

export function SalesTargetProbePanel({
  idToken,
}: {
  idToken: string | null;
}) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [loading, setLoading] = useState(false);
  const [json, setJson] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  // 有効かどうかだけ先に確かめる。@pocket は呼ばれない軽い問い合わせ
  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${PROBE_PATH}?check=1`, {
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

  const run = useCallback(async () => {
    if (!idToken || loading) return;
    setLoading(true);
    setMessage("");
    setJson("");
    try {
      const res = await fetch(PROBE_PATH, {
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
      setOpen(true);
      if (!res.ok) {
        setMessage(`エラー応答（HTTP ${res.status}）。内容を確認してください`);
      }
    } catch {
      setMessage("通信に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [idToken, loading]);

  const copy = useCallback(async () => {
    if (!json) return;
    const ok = await writeToClipboard(json);
    if (ok) {
      setMessage("コピーしました");
      return;
    }
    // 自動コピーができない端末。全選択して手動コピーしてもらう
    textRef.current?.focus();
    textRef.current?.select();
    setMessage("全選択しました。長押しなどでコピーしてください");
  }, [json]);

  if (phase !== "ready") return null;

  return (
    <div className="mt-6 rounded-xl border border-dashed border-slate-300 p-3 dark:border-slate-600">
      <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
        調査用（一時）: 目標登録アプリの構成
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={loading || !idToken}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => void run()}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
        >
          {loading ? "取得中…" : "取得する"}
        </button>
        {json ? (
          <>
            <button
              type="button"
              onClick={() => void copy()}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition active:scale-[0.98] dark:border-slate-600 dark:text-slate-200"
            >
              コピーする
            </button>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="rounded-lg px-2 py-1.5 text-[12px] font-semibold text-slate-500 dark:text-slate-400"
            >
              {open ? "閉じる" : "開く"}
            </button>
          </>
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

      {open && json ? (
        <div id={bodyId} className="mt-2">
          {/*
            新しいタブは開かず、この画面にそのまま出す。
            textarea にしているのは、自動コピーができない端末でも
            全選択して手で拾えるようにするため
          */}
          <textarea
            ref={textRef}
            readOnly
            rows={16}
            value={json}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="調査結果の JSON"
            className="w-full rounded-lg border border-slate-300 bg-slate-50 p-2 font-mono text-[11px] leading-relaxed text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
      ) : null}
    </div>
  );
}
