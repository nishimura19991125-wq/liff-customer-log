"use client";

import { useState } from "react";

type NewsItem = {
  category: string;
  date: string;
  isNew: boolean;
  title: string;
};

const CATEGORIES = [
  "ALL",
  "EVENT & LIVE",
  "RELEASE",
  "MEDIA",
  "MEMBERSHIP",
  "OTHER",
  "SHOP",
] as const;

const NEWS_DATA: NewsItem[] = [
  {
    category: "EVENT & LIVE",
    date: "2026.07.15",
    isNew: true,
    title:
      "VRコンサートツアー再来！全国7都市にて開催決定！ただいまより先行販売スタート！",
  },
  {
    category: "MEMBERSHIP",
    date: "2026.07.14",
    isNew: true,
    title:
      "日本5thシングル リリース記念プレミアムライブ 会員招待企画のご案内",
  },
  {
    category: "RELEASE",
    date: "2026.07.10",
    isNew: false,
    title:
      "日本5thシングル 本日発売！各種音楽配信サービスでも配信開始しました。",
  },
  {
    category: "MEDIA",
    date: "2026.07.05",
    isNew: false,
    title:
      "音楽番組出演情報を更新しました。放送スケジュールをチェックしてください。",
  },
  {
    category: "SHOP",
    date: "2026.06.28",
    isNew: false,
    title: "オフィシャルショップにて新作グッズの受注販売がスタートしました。",
  },
  {
    category: "OTHER",
    date: "2026.06.20",
    isNew: false,
    title: "公式サイトメンテナンスのお知らせ。",
  },
];

/** NEWS 風の社内掲示板（サンプルデータ・タブ絞り込み＋タイトル部分一致検索） */
export function BulletinBoard() {
  const [category, setCategory] = useState<string>("ALL");
  const [keyword, setKeyword] = useState("");

  const kw = keyword.trim().toLowerCase();
  const items = NEWS_DATA.filter((item) => {
    const matchCategory = category === "ALL" || item.category === category;
    const matchKeyword = kw === "" || item.title.toLowerCase().includes(kw);
    return matchCategory && matchKeyword;
  });

  return (
    <div className="mt-4">
      <nav className="-mx-1 mb-5 flex gap-5 overflow-x-auto px-1 pb-1">
        {CATEGORIES.map((c) => {
          const active = c === category;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`relative shrink-0 whitespace-nowrap pb-1.5 text-[13px] transition-colors ${
                active
                  ? "font-bold text-slate-900 dark:text-white"
                  : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {c}
              {active ? (
                <span className="absolute inset-x-0 -bottom-0.5 h-0.5 rounded bg-slate-900 dark:bg-white" />
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="relative mb-6">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-slate-400"
          aria-hidden
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="NEWS 検索"
          className="w-full rounded-full border-none bg-slate-100 py-3.5 pl-12 pr-5 text-[15px] text-slate-700 outline-none placeholder:text-slate-400 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>

      {items.length === 0 ? (
        <p className="py-16 text-center text-[14px] text-slate-400">
          該当するお知らせはありません。
        </p>
      ) : (
        <ul className="border-t border-slate-200 dark:border-slate-700">
          {items.map((item, index) => (
            <li
              key={`${item.date}-${index}`}
              className="border-b border-slate-200 dark:border-slate-700"
            >
              <a
                href="#"
                className="block py-5 transition-opacity hover:opacity-55"
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-[12px] font-bold tracking-wide text-pink-600 dark:text-pink-400">
                    [ {item.category} ]
                  </span>
                  <span className="text-[12px] text-slate-400">
                    {item.date}
                  </span>
                  {item.isNew ? (
                    <span className="text-[10px] font-bold tracking-wider text-pink-600 dark:text-pink-400">
                      NEW
                    </span>
                  ) : null}
                </div>
                <p className="text-[15px] leading-relaxed text-slate-800 dark:text-slate-100">
                  {item.title}
                </p>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
