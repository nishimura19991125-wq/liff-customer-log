"use client";

import liff from "@line/liff";
import { useCallback, useEffect, useState } from "react";

type Staff = { id: string; name: string };

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

export default function Home() {
  const [phase, setPhase] = useState<
    | "init"
    | "need-login"
    | "loading-staff"
    | "ready"
    | "submitting"
    | "done"
    | "error"
  >(() => (LIFF_ID ? "init" : "error"));
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    LIFF_ID ? null : "NEXT_PUBLIC_LIFF_ID が設定されていません",
  );
  const [staff, setStaff] = useState<Staff[]>([]);

  const [staffRecordId, setStaffRecordId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [content, setContent] = useState("");

  const loadStaff = useCallback(async (idToken: string) => {
    setPhase("loading-staff");
    setErrorMessage(null);

    const res = await fetch("/api/staff", {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const data = (await res.json()) as { staff?: Staff[]; error?: string };

    if (res.status === 401) {
      setErrorMessage(
        "認証に失敗しました。LINE から開き直してください。",
      );
      setPhase("error");
      return;
    }

    if (!res.ok) {
      setErrorMessage(data.error ?? "担当者一覧を読み込めませんでした");
      setPhase("error");
      return;
    }

    setStaff(data.staff ?? []);
    setPhase("ready");
  }, []);

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
          setErrorMessage(
            "LINE の ID トークンを取得できませんでした。チャネル設定を確認してください。",
          );
          setPhase("error");
          return;
        }

        await loadStaff(token);
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
  }, [loadStaff]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (phase !== "ready" || !LIFF_ID) return;

    const selected = staff.find((s) => s.id === staffRecordId);
    if (!selected) {
      setErrorMessage("担当者を選択してください");
      return;
    }

    const token = liff.getIDToken();
    if (!token) {
      setErrorMessage(
        "LINE の認証情報が無効です。LINE から開き直してください。",
      );
      return;
    }

    setPhase("submitting");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          staffRecordId: selected.id,
          customerName,
          content,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setErrorMessage(data.error ?? "送信に失敗しました");
        setPhase("ready");
        return;
      }
      setPhase("done");
    } catch (err) {
      console.error(err);
      setErrorMessage("送信に失敗しました");
      setPhase("ready");
    }
  }

  function handleClose() {
    try {
      if (typeof window !== "undefined" && liff.isInClient()) {
        liff.closeWindow();
        return;
      }
    } catch {
      /* LIFF 未初期化 */
    }
    window.location.reload();
  }

  if (phase === "init" || phase === "need-login" || phase === "loading-staff") {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center bg-zinc-100 px-4 py-16">
        <p className="text-zinc-700">
          {phase === "loading-staff"
            ? "担当者マスタを読み込み中…"
            : "ログイン処理中…"}
        </p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 bg-zinc-100 px-4 py-16">
        <p className="max-w-md text-center text-red-700">{errorMessage}</p>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 bg-zinc-100 px-4 py-16">
        <p className="text-lg font-medium text-zinc-900">登録完了</p>
        <button
          type="button"
          onClick={handleClose}
          className="rounded-lg bg-emerald-600 px-6 py-3 text-white hover:bg-emerald-700"
        >
          閉じる
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-full flex-1 bg-zinc-100 px-4 py-10">
      <main className="mx-auto w-full max-w-lg rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
        <h1 className="mb-6 text-xl font-semibold text-zinc-900">
          顧客対応ログ入力
        </h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-800">担当者</span>
            <select
              required
              value={staffRecordId}
              onChange={(e) => setStaffRecordId(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
            >
              <option value="">選択してください</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-800">顧客名</span>
            <input
              type="text"
              required
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
              placeholder="顧客名を入力"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-800">対応内容</span>
            <textarea
              required
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="resize-y rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
              placeholder="対応内容を入力"
            />
          </label>

          {errorMessage ? (
            <p className="text-sm text-red-600">{errorMessage}</p>
          ) : null}

          <button
            type="submit"
            disabled={phase === "submitting"}
            className="mt-2 rounded-lg bg-emerald-600 py-3 font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {phase === "submitting" ? "送信中…" : "送信"}
          </button>
        </form>
      </main>
    </div>
  );
}
