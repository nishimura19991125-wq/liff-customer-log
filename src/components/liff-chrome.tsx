"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, FormEvent, ReactNode } from "react";
import { useState } from "react";

/** LIFF / モバイル WebView 向け：背景・セーフエリア・最大幅 */
export function LiffScreen({ children }: { children: ReactNode }) {
  return (
    <div className="liff-screen min-h-dvh flex flex-col text-slate-900">
      <div className="flex flex-1 flex-col px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-5">
        {children}
      </div>
    </div>
  );
}

export function LiffMark() {
  return (
    <div
      className="flex size-10 shrink-0 flex-col items-center justify-center rounded-2xl bg-[#06C755] px-0.5 text-[9px] font-black leading-[1.05] tracking-tight text-white shadow-md shadow-emerald-700/20"
      aria-hidden
    >
      <span>情報</span>
      <span>確認</span>
    </div>
  );
}

type LiffPageHeaderProps = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
};

export function LiffPageHeader({ title, subtitle, action }: LiffPageHeaderProps) {
  return (
    <header className="mb-5 flex items-start gap-3">
      <LiffMark />
      <div className="min-w-0 flex-1 pt-0.5">
        <h1 className="text-[1.35rem] font-bold leading-tight tracking-tight text-slate-900">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-[13px] leading-snug text-slate-500">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0 pt-1">{action}</div> : null}
    </header>
  );
}

export function LiffCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[1.35rem] border border-white/70 bg-white/85 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.12)] ring-1 ring-slate-200/60 backdrop-blur-md">
      {children}
    </div>
  );
}

export function LiffPrimaryButton({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex w-full items-center justify-center rounded-2xl bg-[#06C755] py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-emerald-600/20 transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}

export function LiffGhostLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold text-emerald-800 transition active:bg-emerald-50"
    >
      {children}
    </Link>
  );
}

export function LiffLoadingBlock({
  message,
  footer,
}: {
  message: string;
  footer?: ReactNode;
}) {
  return (
    <LiffScreen>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-16">
        <div className="flex flex-col items-center gap-4">
          <div
            className="size-11 rounded-full border-2 border-emerald-200 border-t-[#06C755] animate-spin"
            aria-hidden
          />
          <p className="text-center text-[15px] font-medium text-slate-600">
            {message}
          </p>
        </div>
        {footer}
      </div>
    </LiffScreen>
  );
}

export function LiffNavPill({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3.5 text-[14px] font-semibold text-slate-800 shadow-sm transition active:scale-[0.99] active:bg-slate-50"
    >
      <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-lg text-[#06C755]">
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      <span className="text-slate-400" aria-hidden>
        ›
      </span>
    </Link>
  );
}

/** 右上：LINE プロフィールとスタッフ名簿紐付け（最大2つの LINE ID はサーバーで照合） */
export function LiffAccountBar({
  loading,
  displayName,
  pictureUrl,
  lineUserId,
  boundStaffName,
}: {
  loading?: boolean;
  displayName?: string;
  pictureUrl?: string;
  lineUserId?: string;
  boundStaffName?: string | null;
}) {
  if (loading) {
    return (
      <div className="flex w-full justify-end pb-2">
        <div
          className="h-11 w-40 max-w-[85vw] animate-pulse rounded-full bg-slate-200/75"
          aria-hidden
        />
      </div>
    );
  }

  const shortId =
    lineUserId && lineUserId.length > 14
      ? `${lineUserId.slice(0, 8)}…${lineUserId.slice(-4)}`
      : (lineUserId ?? "");

  const lineName = displayName?.trim() ?? "";
  const staffName = boundStaffName?.trim() ?? "";
  /** 主表示はスタッフ名簿の社員名（未紐付け時は LINE 表示名） */
  const primary = staffName || lineName || "LINE";
  const avatarLetter = (staffName || lineName || "L").slice(0, 1);

  return (
    <div className="flex w-full justify-end pb-2">
      <div className="flex max-w-[min(100%,22rem)] items-center gap-2 rounded-full border border-slate-200/90 bg-white/95 py-1 pl-1 pr-3 shadow-sm backdrop-blur-sm">
        {pictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- LIFF の外部プロフィール画像
          <img
            src={pictureUrl}
            alt=""
            className="size-9 shrink-0 rounded-full object-cover ring-1 ring-slate-200/80"
          />
        ) : (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-100 to-emerald-200 text-[13px] font-bold text-emerald-800 ring-1 ring-slate-200/80">
            {avatarLetter}
          </div>
        )}
        <div className="min-w-0 flex-1 text-right leading-tight">
          <p className="truncate text-[13px] font-bold text-slate-900">{primary}</p>
          {staffName ? (
            lineName ? (
              <p className="truncate text-[11px] text-slate-500">LINE: {lineName}</p>
            ) : null
          ) : (
            <p className="truncate text-[11px] text-amber-800">
              スタッフ名簿と未紐付け（@pocket に LINE ID を登録）
            </p>
          )}
          {shortId ? (
            <p className="truncate font-mono text-[10px] text-slate-400 tabular-nums">
              {shortId}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** 初回：スタッフ名簿と LINE を一覧から紐づけ（@pocket に LINE ID を書き込む） */
export function LiffStaffBindPanel({
  staff,
  bindingEnabled,
  boundStaffName,
  accountLoading,
  onBind,
}: {
  staff: { id: string; name: string }[];
  bindingEnabled: boolean;
  boundStaffName: string | null;
  accountLoading?: boolean;
  onBind: (
    staffRecordId: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (
    !bindingEnabled ||
    boundStaffName ||
    accountLoading ||
    staff.length === 0
  ) {
    return null;
  }

  const selectClass =
    "min-h-[48px] w-full rounded-xl border border-slate-200 bg-white px-4 text-base text-slate-900 outline-none transition focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/25";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedId) {
      setError("リストから自分の名前を選択してください");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await onBind(selectedId);
    setBusy(false);
    if (!r.ok) setError(r.error ?? "紐付けに失敗しました");
  }

  return (
    <div className="mb-3 rounded-2xl border border-amber-200/90 bg-amber-50/90 px-4 py-3 shadow-sm ring-1 ring-amber-100/80">
      <p className="text-[13px] font-bold text-amber-950">
        初回：スタッフ名簿と紐づけ
      </p>
      <p className="mt-1 text-[12px] leading-snug text-amber-900/85">
        一覧から自分の名前を選ぶと、スタッフ名簿に LINE ID が保存されます。
      </p>
      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2">
        <select
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setError(null);
          }}
          className={`${selectClass} appearance-none bg-[length:1rem] bg-[right_0.85rem_center] bg-no-repeat pr-10`}
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='m19 9-7 7-7-7'/%3E%3C/svg%3E\")",
          }}
          aria-label="スタッフ名を選択"
        >
          <option value="">名前を選択…</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {error ? (
          <p className="text-[12px] leading-snug text-red-700">{error}</p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-[#06C755] py-3 text-[14px] font-semibold text-white shadow-md shadow-emerald-700/15 transition active:scale-[0.99] disabled:opacity-50"
        >
          {busy ? "保存中…" : "この名前で紐づける"}
        </button>
      </form>
    </div>
  );
}

/** トップメニュー用の大きな選択カード */
export function LiffMenuCard({
  href,
  title,
  description,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex items-stretch gap-4 rounded-[1.35rem] border border-slate-200/90 bg-white/95 p-5 shadow-[0_10px_36px_-14px_rgba(15,23,42,0.18)] ring-1 ring-slate-200/55 transition active:scale-[0.99]"
    >
      <span className="flex size-[3.25rem] shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-50 to-emerald-100/70 text-[1.65rem] leading-none text-[#06C755]">
        {icon}
      </span>
      <div className="min-w-0 flex-1 py-0.5">
        <p className="text-[1.05rem] font-bold leading-snug text-slate-900">
          {title}
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
          {description}
        </p>
      </div>
      <span
        className="self-center text-xl font-light text-slate-300 group-active:text-slate-400"
        aria-hidden
      >
        ›
      </span>
    </Link>
  );
}
