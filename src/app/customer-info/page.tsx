"use client";

import Link from "next/link";

import { LiffCard, LiffPageHeader, LiffScreen } from "@/components/liff-chrome";

export default function CustomerInfoPage() {
  return (
    <LiffScreen>
      <main className="mx-auto w-full max-w-lg flex-1 py-6">
        <nav className="mb-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-800 active:opacity-70"
          >
            <span className="text-lg leading-none">‹</span>
            メニューへ
          </Link>
        </nav>

        <LiffPageHeader
          title="お客様情報入力"
          subtitle="入力項目や送信処理などは今後追加します。"
        />

        <LiffCard>
          <div className="px-5 py-12 text-center text-[14px] leading-relaxed text-slate-500">
            準備中です。
          </div>
        </LiffCard>
      </main>
    </LiffScreen>
  );
}
