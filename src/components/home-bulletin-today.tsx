"use client";

import Link from "next/link";
import { useMemo } from "react";

import { LiffCard } from "@/components/liff-chrome";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import {
  bulletinTodayLabelJst,
  type BulletinListResponse,
} from "@/lib/bulletin-types";
import { LIFF_SWR_DEFAULT_OPTIONS } from "@/lib/liff-swr";

type Props = {
  idToken: string | null;
  disabled?: boolean;
};

const HOME_PREVIEW_LIMIT = 5;

export function HomeBulletinToday({ idToken, disabled = false }: Props) {
  const swrPath = idToken && !disabled ? "/api/bulletin" : null;

  const { data, isLoading } = useLiffSwr<BulletinListResponse>(
    swrPath,
    idToken,
    LIFF_SWR_DEFAULT_OPTIONS,
  );

  const today = bulletinTodayLabelJst();
  const items = useMemo(
    () => (data?.posts ?? []).filter((post) => post.date === today),
    [data?.posts, today],
  );
  const preview = items.slice(0, HOME_PREVIEW_LIMIT);
  const restCount = items.length - preview.length;

  if (disabled) return null;

  if (isLoading && !data) {
    return (
      <section aria-label="本日のお知らせ（読み込み中）">
        <LiffCard>
          <div className="px-4 py-4">
            <p className="text-[14px] text-slate-500 dark:text-slate-400">
              本日のお知らせを読み込み中…
            </p>
          </div>
        </LiffCard>
      </section>
    );
  }

  if (!data?.configured || data.error) return null;
  if (items.length === 0) return null;

  return (
    <section aria-label="本日のお知らせ">
      <LiffCard>
        <div className="px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[15px] font-bold text-slate-900 dark:text-white">
                本日のお知らせ
              </p>
              <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">
                {today} · 全 {items.length} 件
              </p>
            </div>
            <Link
              href="/bulletin"
              className="shrink-0 rounded-lg px-2 py-1 text-[13px] font-semibold text-pink-700 active:bg-pink-50 dark:text-pink-300 dark:active:bg-pink-950/40"
            >
              掲示板 ›
            </Link>
          </div>

          <ul className="mt-3 flex flex-col gap-2">
            {preview.map((item) => (
              <li key={item.id}>
                <Link
                  href="/bulletin"
                  className="flex items-start gap-2 rounded-xl bg-pink-50/80 px-3 py-2.5 transition active:scale-[0.99] dark:bg-pink-950/20"
                >
                  <span
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-pink-500"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 text-[14px] font-semibold leading-snug text-slate-900 dark:text-white">
                    {item.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {restCount > 0 ? (
            <Link
              href="/bulletin"
              className="mt-3 block text-center text-[13px] font-semibold text-pink-700 underline underline-offset-2 dark:text-pink-300"
            >
              他 {restCount} 件を見る
            </Link>
          ) : null}
        </div>
      </LiffCard>
    </section>
  );
}
