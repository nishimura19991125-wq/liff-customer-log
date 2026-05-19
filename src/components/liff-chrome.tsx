"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, FormEvent, ReactNode } from "react";
import { useState } from "react";

import { LIFF_PROFILE_CACHE_KEY } from "@/lib/liff-profile-cache-key";

/** LIFF / モバイル WebView 向け：背景・セーフエリア・最大幅 */
export function LiffScreen({ children }: { children: ReactNode }) {
  return (
    <div className="liff-screen flex min-h-dvh min-w-0 flex-col text-slate-900">
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-5">
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
      {action ? (
        <div className="flex shrink-0 items-start pt-0.5">{action}</div>
      ) : null}
    </header>
  );
}

export function LiffCard({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-[1.35rem] border border-white/70 bg-white/85 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.12)] ring-1 ring-slate-200/60 backdrop-blur-md">
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

/** LINE の ID トークン期限切れなど：エラー表示ではなく再ログインへ誘導 */
export function LiffSessionExpiredPanel({ footer }: { footer?: ReactNode }) {
  return (
    <LiffScreen>
      <div className="flex flex-1 flex-col justify-center py-10">
        <LiffCard>
          <div className="px-5 py-8 text-center">
            <p className="text-[16px] font-bold leading-snug text-slate-900">
              ログインの有効期限が切れました
            </p>
            <p className="mt-3 text-[14px] leading-relaxed text-slate-600">
              セキュリティのため、定期的に再ログインが必要です。下のボタンで画面を更新すると、LINE
              から再度ログインできます。
            </p>
            <div className="mt-8">
              <LiffPrimaryButton
                type="button"
                onClick={() => {
                  try {
                    sessionStorage.removeItem(LIFF_PROFILE_CACHE_KEY);
                  } catch {
                    /* ignore */
                  }
                  window.location.reload();
                }}
              >
                画面を更新して再ログイン
              </LiffPrimaryButton>
            </div>
          </div>
        </LiffCard>
        {footer ? (
          <div className="mt-6 flex justify-center">{footer}</div>
        ) : null}
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

/**
 * ログイン中ユーザー表示：@pocket スタッフ名簿の名前とアイコンのみ（見出し行と同じ高さに載せる想定）。
 * アイコンは LIFF プロフィール画像（名簿側に写真が無いため）。
 */
export function LiffAccountBar({
  loading,
  pictureUrl,
  boundStaffName,
  bindingEnabled,
}: {
  loading?: boolean;
  pictureUrl?: string;
  boundStaffName?: string | null;
  bindingEnabled?: boolean;
}) {
  if (loading) {
    return (
      <div
        className="flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/90 py-1 pl-1 pr-3 shadow-sm"
        aria-busy
      >
        <div className="size-10 shrink-0 animate-pulse rounded-full bg-slate-200/80" />
        <div className="h-4 w-24 animate-pulse rounded bg-slate-200/75" />
      </div>
    );
  }

  const staffName = boundStaffName?.trim() ?? "";
  const showBindHint = bindingEnabled && !staffName;

  const avatarLetter = staffName
    ? staffName.slice(0, 1)
    : showBindHint
      ? "?"
      : "—";

  const label = staffName
    ? staffName
    : showBindHint
      ? "名前を選択…"
      : "未登録";

  return (
    <div className="flex max-w-[min(100%,14rem)] items-center gap-2 rounded-full border border-slate-200/90 bg-white/95 py-1 pl-1 pr-3 shadow-sm backdrop-blur-sm">
      {pictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- LIFF の外部プロフィール画像
        <img
          src={pictureUrl}
          alt=""
          className="size-10 shrink-0 rounded-full object-cover ring-1 ring-slate-200/80"
        />
      ) : (
        <div
          className={`flex size-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold ring-1 ring-slate-200/80 ${
            showBindHint
              ? "bg-amber-50 text-amber-900"
              : "bg-gradient-to-br from-emerald-100 to-emerald-200 text-emerald-800"
          }`}
        >
          {avatarLetter}
        </div>
      )}
      <p
        className={`truncate text-right text-[15px] font-bold leading-tight tracking-tight ${
          showBindHint ? "text-amber-950" : "text-slate-900"
        }`}
      >
        {label}
      </p>
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
  staff: { id: string; name: string; importKey?: string }[];
  bindingEnabled: boolean;
  boundStaffName: string | null;
  accountLoading?: boolean;
  onBind: (
    staffRecordId: string,
    staffImportKey?: string,
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
    const sel = staff.find((s) => s.id === selectedId);
    const r = await onBind(selectedId, sel?.importKey);
    setBusy(false);
    if (!r.ok) setError(r.error ?? "紐付けに失敗しました");
  }

  return (
    <div className="mb-3 rounded-2xl border border-amber-200/90 bg-amber-50/90 px-4 py-3 shadow-sm ring-1 ring-amber-100/80">
      <p className="text-[13px] font-bold text-amber-950">
        スタッフ名簿と紐づけ（必須）
      </p>
      <p className="mt-1 text-[12px] leading-snug text-amber-900/85">
        利用前に一覧から自分の名前を選んでください。@pocket のスタッフ名簿に LINE
        ID が保存されます。
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
  disabled,
}: {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
  /** true のとき遷移不可（スタッフ未紐付けなど） */
  disabled?: boolean;
}) {
  const cls =
    "group flex items-stretch gap-4 rounded-[1.35rem] border border-slate-200/90 bg-white/95 p-5 shadow-[0_10px_36px_-14px_rgba(15,23,42,0.18)] ring-1 ring-slate-200/55 transition active:scale-[0.99]";

  if (disabled) {
    return (
      <div
        role="link"
        aria-disabled="true"
        aria-label={`${title}（スタッフ紐付け後に利用できます）`}
        className={`${cls} cursor-not-allowed opacity-45`}
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
          className="self-center text-xl font-light text-slate-300"
          aria-hidden
        >
          ›
        </span>
      </div>
    );
  }

  return (
    <Link href={href} className={cls}>
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
