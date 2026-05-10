"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

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
      className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#06C755] text-[13px] font-bold text-white shadow-md shadow-emerald-700/20"
      aria-hidden
    >
      LIFF
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
