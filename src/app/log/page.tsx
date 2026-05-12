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
  LiffStaffBindPanel,
} from "@/components/liff-chrome";
import { LIFF_PROFILE_CACHE_KEY } from "@/hooks/use-liff-account-strip";

type Staff = { id: string; name: string };

type StaffApiPayload = {
  staff?: Staff[];
  boundStaff?: { id: string; name: string } | null;
  lineUserId?: string;
  error?: string;
  bindingEnabled?: boolean;
};

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

export default function LogPage() {
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
  const [idToken, setIdToken] = useState<string | null>(null);
  const [accountStrip, setAccountStrip] = useState<{
    displayName: string;
    pictureUrl: string;
    lineUserId: string;
    boundStaffName: string | null;
    bindingEnabled: boolean;
  } | null>(null);

  const [staffRecordId, setStaffRecordId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [content, setContent] = useState("");

  const needsStaffBind =
    phase === "ready" &&
    Boolean(accountStrip?.bindingEnabled) &&
    !accountStrip?.boundStaffName &&
    staff.length > 0;

  const inputClass =
    "min-h-[48px] w-full rounded-xl border border-slate-200 bg-white px-4 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/25";

  const loadStaff = useCallback(async (idToken: string) => {
    setPhase("loading-staff");
    setErrorMessage(null);
    setAccountStrip(null);

    let profile: {
      displayName: string;
      pictureUrl?: string;
      userId: string;
    };
    try {
      const p = await liff.getProfile();
      profile = {
        displayName: p.displayName,
        pictureUrl: p.pictureUrl,
        userId: p.userId,
      };
      try {
        sessionStorage.setItem(
          LIFF_PROFILE_CACHE_KEY,
          JSON.stringify({
            displayName: p.displayName,
            pictureUrl: p.pictureUrl,
            userId: p.userId,
          }),
        );
      } catch {
        /* ignore */
      }
    } catch {
      setErrorMessage("LINE プロフィールを取得できませんでした");
      setPhase("error");
      return;
    }

    const res = await fetch("/api/staff", {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const data = (await res.json()) as StaffApiPayload;

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
    setAccountStrip({
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl ?? "",
      lineUserId: profile.userId,
      boundStaffName: data.boundStaff?.name ?? null,
      bindingEnabled: Boolean(data.bindingEnabled),
    });
    setPhase("ready");
  }, []);

  const bindLineStaff = useCallback(
    async (
      staffRecordId: string,
    ): Promise<{ ok: boolean; error?: string }> => {
      const token = idToken;
      if (!token) {
        return { ok: false, error: "ログイン情報がありません" };
      }
      try {
        const res = await fetch("/api/staff/bind", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ staffRecordId }),
        });
        const payload = (await res.json()) as {
          boundStaff?: { name?: string };
          error?: string;
        };
        if (!res.ok) {
          return {
            ok: false,
            error:
              typeof payload.error === "string"
                ? payload.error
                : "紐付けに失敗しました",
          };
        }
        const n = payload.boundStaff?.name?.trim();
        setAccountStrip((prev) =>
          prev ? { ...prev, boundStaffName: n ?? prev.boundStaffName } : prev,
        );
        return { ok: true };
      } catch {
        return { ok: false, error: "通信に失敗しました" };
      }
    },
    [idToken],
  );

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

        setIdToken(token);
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

    if (needsStaffBind) {
      setErrorMessage(
        "先に上の一覧から名前を選び、スタッフ名簿と紐づけてください。",
      );
      return;
    }

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
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        const base = data.error ?? "送信に失敗しました";
        setErrorMessage(
          data.detail ? `${base}\n${data.detail}` : base,
        );
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
      <LiffLoadingBlock
        message={
          phase === "loading-staff"
            ? "担当者マスタを読み込んでいます"
            : "LINE でログインしています"
        }
      />
    );
  }

  if (phase === "error") {
    return (
      <LiffScreen>
        <div className="flex flex-1 flex-col justify-center py-10">
          <LiffCard>
            <div className="px-5 py-8 text-center">
              <p className="text-[15px] leading-relaxed text-red-700 whitespace-pre-wrap">
                {errorMessage}
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-8 rounded-xl px-6 py-3 text-[14px] font-semibold text-slate-700 underline underline-offset-2"
              >
                再読み込み
              </button>
            </div>
          </LiffCard>
        </div>
      </LiffScreen>
    );
  }

  if (phase === "done") {
    return (
      <LiffScreen>
        <div className="flex flex-1 flex-col items-center justify-center gap-8 py-12">
          <div className="flex size-20 items-center justify-center rounded-full bg-emerald-100 text-[2.5rem] shadow-inner">
            ✓
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-slate-900">登録完了</p>
            <p className="mt-2 text-[14px] text-slate-500">
              ご入力ありがとうございました
            </p>
          </div>
          <div className="w-full max-w-xs px-2">
            <LiffPrimaryButton type="button" onClick={handleClose}>
              閉じる
            </LiffPrimaryButton>
          </div>
        </div>
      </LiffScreen>
    );
  }

  return (
    <LiffScreen>
      <main className="mx-auto w-full max-w-lg flex-1 py-4">
        <nav className="mb-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-800 active:opacity-70"
          >
            <span className="text-lg leading-none">‹</span>
            メニューへ
          </Link>
        </nav>

        {accountStrip ? (
          <LiffAccountBar
            displayName={accountStrip.displayName}
            pictureUrl={accountStrip.pictureUrl}
            lineUserId={accountStrip.lineUserId}
            boundStaffName={accountStrip.boundStaffName}
            bindingEnabled={accountStrip.bindingEnabled}
          />
        ) : null}

        {accountStrip ? (
          <LiffStaffBindPanel
            staff={staff}
            bindingEnabled={accountStrip.bindingEnabled}
            boundStaffName={accountStrip.boundStaffName}
            accountLoading={false}
            onBind={bindLineStaff}
          />
        ) : null}

        <LiffPageHeader
          title="顧客対応ログ"
          subtitle={
            needsStaffBind
              ? "先にスタッフ名簿と紐づけてから入力・送信してください"
              : "対応内容を入力して送信してください"
          }
        />

        <LiffCard>
          <form
            onSubmit={handleSubmit}
            className={`flex flex-col gap-6 px-5 py-7 sm:px-7 ${needsStaffBind ? "pointer-events-none opacity-[0.42]" : ""}`}
          >
            <label className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold tracking-wide text-slate-600">
                担当者
              </span>
              <select
                required
                value={staffRecordId}
                onChange={(e) => setStaffRecordId(e.target.value)}
                className={`${inputClass} appearance-none bg-[length:1rem] bg-[right_0.85rem_center] bg-no-repeat pr-10`}
                style={{
                  backgroundImage:
                    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='m19 9-7 7-7-7'/%3E%3C/svg%3E\")",
                }}
              >
                <option value="">選択してください</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold tracking-wide text-slate-600">
                顧客名
              </span>
              <input
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className={inputClass}
                placeholder="お客様のお名前"
                autoComplete="name"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold tracking-wide text-slate-600">
                対応内容
              </span>
              <textarea
                required
                rows={6}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className={`${inputClass} min-h-[160px] resize-y py-3 leading-relaxed`}
                placeholder="ここに対応内容を記入してください"
              />
            </label>

            {errorMessage ? (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] leading-relaxed text-red-800 whitespace-pre-wrap"
              >
                {errorMessage}
              </div>
            ) : null}

            <LiffPrimaryButton
              type="submit"
              disabled={phase === "submitting" || needsStaffBind}
            >
              {phase === "submitting" ? "送信中…" : "送信する"}
            </LiffPrimaryButton>
          </form>
        </LiffCard>
      </main>
    </LiffScreen>
  );
}
