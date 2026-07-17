"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, FormEvent, ReactNode } from "react";
import { useState } from "react";

import { FortuneRankBadge } from "@/components/fortune-rank-badge";
import { triggerLiffRelogin } from "@/lib/liff-session";

/** LIFF / モバイル WebView 向け：背景・セーフエリア・最大幅 */
export function LiffScreen({ children }: { children: ReactNode }) {
  return (
    <div className="liff-screen flex min-h-dvh min-w-0 flex-col bg-slate-50 text-slate-800 transition-all duration-300 dark:bg-slate-900 dark:text-slate-100">
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
  titleClassName?: string;
  subtitleClassName?: string;
};

export function LiffPageHeader({
  title,
  subtitle,
  action,
  titleClassName,
  subtitleClassName,
}: LiffPageHeaderProps) {
  return (
    <header className="mb-5 flex items-start gap-2 sm:gap-3">
      <LiffMark />
      <div className="min-w-0 flex-1 overflow-hidden pt-0.5">
        <h1
          className={
            titleClassName ??
            "text-[1.35rem] font-bold leading-tight tracking-tight text-slate-900 dark:text-white"
          }
        >
          {title}
        </h1>
        {subtitle ? (
          <p
            className={
              subtitleClassName ??
              "mt-1 text-[13px] leading-snug text-slate-500 dark:text-slate-400"
            }
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {action ? (
        <div className="flex shrink-0 items-start gap-1 pt-0.5 sm:gap-2">
          {action}
        </div>
      ) : null}
    </header>
  );
}

export function LiffCard({ children }: { children: ReactNode }) {
  return (
    <div className="cyber-card min-w-0 max-w-full overflow-hidden text-slate-800 backdrop-blur-md dark:text-slate-100">
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
      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold text-emerald-800 transition duration-300 active:bg-emerald-50 dark:text-emerald-300 dark:active:bg-emerald-950/50"
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
            className="size-11 animate-spin rounded-full border-2 border-emerald-200 border-t-[#06C755] dark:border-emerald-800 dark:border-t-emerald-400"
            aria-hidden
          />
          <p className="text-center text-[15px] font-medium text-slate-600 dark:text-slate-300">
            {message}
          </p>
        </div>
        {footer}
      </div>
    </LiffScreen>
  );
}

/** LINE の ID トークン期限切れなど：エラー表示ではなく再ログインへ誘導 */
export function LiffSessionExpiredPanel({
  footer,
  liffId = process.env.NEXT_PUBLIC_LIFF_ID?.trim(),
}: {
  footer?: ReactNode;
  liffId?: string;
}) {
  return (
    <LiffScreen>
      <div className="flex flex-1 flex-col justify-center py-10">
        <LiffCard>
          <div className="px-5 py-8 text-center">
            <p className="text-[16px] font-bold leading-snug text-slate-900 dark:text-white">
              ログインの有効期限が切れました
            </p>
            <p className="mt-3 text-[14px] leading-relaxed text-slate-600 dark:text-slate-300">
              セキュリティのため、定期的に再ログインが必要です。下のボタンから LINE
              に再度ログインしてください。
            </p>
            <div className="mt-8">
              <LiffPrimaryButton
                type="button"
                onClick={() => {
                  if (liffId) {
                    void triggerLiffRelogin(liffId);
                    return;
                  }
                  window.location.reload();
                }}
              >
                LINE で再ログイン
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
      className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3.5 text-[14px] font-semibold text-slate-800 shadow-sm transition-all duration-300 active:scale-[0.99] active:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:shadow-none dark:active:bg-slate-700"
    >
      <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-lg text-[#06C755] dark:bg-emerald-950/60 dark:text-emerald-400">
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      <span className="text-slate-400 dark:text-slate-500" aria-hidden>
        ›
      </span>
    </Link>
  );
}

/**
 * ログイン中ユーザー表示：@pocket スタッフ名簿の名前とアイコンのみ（見出し行と同じ高さに載せる想定）。
 * アイコンは LIFF プロフィール画像（名簿側に写真が無いため）。
 * fortuneRank があるときは名前の直下に運勢バッジ、その下に「もっと見る」を表示できる。
 */
export function LiffAccountBar({
  loading,
  pictureUrl,
  boundStaffName,
  bindingEnabled,
  fortuneRank,
  fortuneExpanded,
  onFortuneToggle,
}: {
  loading?: boolean;
  pictureUrl?: string;
  boundStaffName?: string | null;
  bindingEnabled?: boolean;
  /** 今日のおみくじ運勢（例: 超大吉）。未設定時は名前のみ */
  fortuneRank?: string | null;
  fortuneExpanded?: boolean;
  onFortuneToggle?: () => void;
}) {
  if (loading) {
    return (
      <div
        className="flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-3 shadow-sm transition-all duration-300 dark:border-slate-700 dark:bg-slate-800"
        aria-busy
      >
        <div className="size-10 shrink-0 animate-pulse rounded-full bg-slate-200/80 dark:bg-slate-600" />
        <div className="h-4 w-24 animate-pulse rounded bg-slate-200/75 dark:bg-slate-600" />
      </div>
    );
  }

  const staffName = boundStaffName?.trim() ?? "";
  const showBindHint = bindingEnabled && !staffName;
  const rank = fortuneRank?.trim() ?? "";
  const showFortuneMore = Boolean(rank && onFortuneToggle);

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
    <div
      className={`flex max-w-[min(100%,14rem)] items-center gap-2 border border-slate-200 bg-white pl-1 pr-3 shadow-sm backdrop-blur-sm transition-all duration-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white ${
        rank ? "rounded-2xl py-1.5" : "rounded-full py-1"
      }`}
    >
      {pictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- LIFF の外部プロフィール画像
        <img
          src={pictureUrl}
          alt=""
          className="size-10 shrink-0 rounded-full object-cover ring-1 ring-slate-200/80 dark:ring-slate-600"
        />
      ) : (
        <div
          className={`flex size-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold ring-1 ring-slate-200/80 dark:ring-slate-600 ${
            showBindHint
              ? "bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
              : "bg-gradient-to-br from-emerald-100 to-emerald-200 text-emerald-800 dark:from-emerald-900 dark:to-emerald-800 dark:text-emerald-200"
          }`}
        >
          {avatarLetter}
        </div>
      )}
      <div className="min-w-0 flex flex-col items-end gap-0.5">
        <p
          className={`truncate text-right text-[15px] font-bold leading-tight tracking-tight ${
            showBindHint
              ? "text-amber-950 dark:text-amber-100"
              : "text-slate-800 dark:text-white"
          }`}
        >
          {label}
        </p>
        {rank ? <FortuneRankBadge rank={rank} size="sm" /> : null}
        {showFortuneMore ? (
          <button
            type="button"
            className="mt-0.5 inline-flex items-center gap-0.5 rounded-md px-0.5 py-0.5 text-[10px] font-semibold leading-none tracking-wide text-amber-700/90 transition hover:bg-amber-50 hover:text-amber-900 active:scale-[0.98] dark:text-amber-300/90 dark:hover:bg-amber-950/40 dark:hover:text-amber-200"
            aria-expanded={fortuneExpanded}
            aria-controls="home-daily-omikuji"
            onClick={onFortuneToggle}
          >
            {fortuneExpanded ? "閉じる" : "もっと見る"}
            <svg
              width="10"
              height="10"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden
              className={`opacity-70 transition ${fortuneExpanded ? "rotate-180" : ""}`}
            >
              <path
                d="M3 4.5 6 7.5 9 4.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** LINE 紐付け用の環境変数が未設定のとき */
export function LiffStaffBindingConfigNotice({
  message,
}: {
  message?: string | null;
}) {
  const text = message?.trim();
  if (!text) return null;
  return (
    <div className="mb-3 rounded-2xl border border-red-200/90 bg-red-50/95 px-4 py-3 text-[12px] leading-relaxed text-red-900 shadow-sm ring-1 ring-red-100/80 transition-all duration-300 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-900/40">
      <p className="font-bold">LINE 紐付けの設定が不足しています</p>
      <p className="mt-1">{text}</p>
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
    "min-h-[48px] w-full rounded-xl border border-slate-200 bg-white px-4 text-base text-slate-900 outline-none transition-all duration-300 focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/25 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

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
    <div className="mb-3 rounded-2xl border border-amber-200/90 bg-amber-50/90 px-4 py-3 shadow-sm ring-1 ring-amber-100/80 transition-all duration-300 dark:border-amber-800/60 dark:bg-amber-950/40 dark:ring-amber-900/40">
      <p className="text-[13px] font-bold text-amber-950 dark:text-amber-100">
        スタッフ名簿と紐づけ（必須）
      </p>
      <p className="mt-1 text-[12px] leading-snug text-amber-900/85 dark:text-amber-200/85">
        利用前に一覧から自分の名前を選んでください（稼働状況が「稼働」の社員のみ表示）。@pocket
        のスタッフ名簿に LINE ID が保存されます。
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

const menuCardIconToneClass = {
  emerald:
    "bg-gradient-to-br from-emerald-50 to-emerald-100/70 text-[#06C755] dark:from-emerald-950/80 dark:to-emerald-900/50 dark:text-emerald-400",
  blue: "bg-gradient-to-br from-blue-50 to-blue-100/70 text-blue-500 dark:from-blue-950/80 dark:to-blue-900/50 dark:text-blue-400",
} as const;

/** トップメニュー用の大きな選択カード */
export function LiffMenuCard({
  href,
  title,
  description,
  icon,
  disabled,
  iconTone = "emerald",
}: {
  href: string;
  title: string;
  description?: string;
  icon: ReactNode;
  /** true のとき遷移不可（スタッフ未紐付けなど） */
  disabled?: boolean;
  iconTone?: keyof typeof menuCardIconToneClass;
}) {
  const iconWrap = menuCardIconToneClass[iconTone];
  const cls =
    "cyber-card group flex items-stretch gap-4 p-5 text-slate-800 transition-all duration-300 active:scale-[0.99] dark:text-slate-100 dark:hover:shadow-[0_0_14px_rgba(16,185,129,0.12)]";

  if (disabled) {
    return (
      <div
        role="link"
        aria-disabled="true"
        aria-label={`${title}（スタッフ紐付け後に利用できます）`}
        className={`${cls} cursor-not-allowed opacity-45`}
      >
        <span
          className={`flex size-[3.25rem] shrink-0 items-center justify-center rounded-2xl text-[1.65rem] leading-none ${iconWrap}`}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1 py-0.5">
          <p className="text-[1.05rem] font-bold leading-snug text-slate-800 dark:text-slate-100">
            {title}
          </p>
          {description ? (
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
              {description}
            </p>
          ) : null}
        </div>
        <span
          className="self-center text-xl font-light text-slate-300 dark:text-slate-500"
          aria-hidden
        >
          ›
        </span>
      </div>
    );
  }

  return (
    <Link href={href} className={cls}>
      <span
        className={`flex size-[3.25rem] shrink-0 items-center justify-center rounded-2xl text-[1.65rem] leading-none ${iconWrap}`}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 py-0.5">
        <p className="text-[1.05rem] font-bold leading-snug text-slate-800 dark:text-slate-100">
          {title}
        </p>
        {description ? (
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
            {description}
          </p>
        ) : null}
      </div>
      <span
        className="self-center text-xl font-light text-slate-300 group-active:text-slate-400 dark:text-slate-500 dark:group-active:text-slate-400"
        aria-hidden
      >
        ›
      </span>
    </Link>
  );
}

/** トップ：本日の未完了レコードへ直行するショートカット */
export function LiffContinueShortcutLink({
  href,
  customerName,
  subtitle,
}: {
  href: string;
  customerName: string;
  /** T番号など（同名の続きが複数あるとき） */
  subtitle?: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-2xl border-2 border-amber-400/90 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3.5 shadow-[0_8px_28px_-10px_rgba(245,158,11,0.45)] ring-1 ring-amber-200/80 transition-all duration-300 active:scale-[0.99] dark:border-amber-600/70 dark:from-amber-950/50 dark:to-orange-950/40 dark:ring-amber-800/50"
    >
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-lg"
        aria-hidden
      >
        ✎
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold leading-snug text-amber-950 dark:text-amber-100">
          <span className="text-amber-800 dark:text-amber-300">（未完了）</span>
          {customerName}様の続きを入力する
        </p>
        {subtitle ? (
          <p className="mt-0.5 truncate text-[12px] font-medium text-amber-800/80 dark:text-amber-300/80">
            {subtitle}
          </p>
        ) : null}
      </div>
      <span className="shrink-0 text-lg font-light text-amber-700" aria-hidden>
        ›
      </span>
    </Link>
  );
}
