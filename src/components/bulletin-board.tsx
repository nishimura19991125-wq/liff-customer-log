"use client";

import { useState, type FormEvent } from "react";

import { useLiffSwr } from "@/hooks/use-liff-swr";
import {
  BULLETIN_CATEGORIES,
  type BulletinListResponse,
} from "@/lib/bulletin-types";
import { liffAuthedJsonFetch, isLiffSwrSessionExpired } from "@/lib/liff-swr";
import { useLiffIdToken } from "@/lib/liff-id-token-context";

const TABS = ["ALL", ...BULLETIN_CATEGORIES] as const;

function todayLabel(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

/** 社内掲示板（@pocket 掲示板アプリに保存＝全員で共有） */
export function BulletinBoard() {
  const idToken = useLiffIdToken();

  const { data, error, isLoading, mutate } = useLiffSwr<BulletinListResponse>(
    idToken ? "/api/bulletin" : null,
    idToken,
  );

  const [category, setCategory] = useState<string>("ALL");
  const [keyword, setKeyword] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [formCategory, setFormCategory] = useState<string>(
    BULLETIN_CATEGORIES[0],
  );
  const [formTitle, setFormTitle] = useState("");
  const [formBody, setFormBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const posts = data?.posts ?? [];
  const notConfigured = data?.configured === false;
  const today = todayLabel();

  const kw = keyword.trim().toLowerCase();
  const items = posts.filter((item) => {
    const matchCategory = category === "ALL" || item.category === category;
    const matchKeyword =
      kw === "" ||
      item.title.toLowerCase().includes(kw) ||
      item.body.toLowerCase().includes(kw);
    return matchCategory && matchKeyword;
  });

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!idToken || submitting) return;
    const title = formTitle.trim();
    const bodyText = formBody.trim();
    if (!title || !bodyText) return;

    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await liffAuthedJsonFetch<BulletinListResponse>(
        "/api/bulletin",
        idToken,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: formCategory,
            title,
            body: bodyText,
          }),
        },
      );
      await mutate(res, { revalidate: false });
      setFormTitle("");
      setFormBody("");
      setFormOpen(false);
      setFeedback("投稿しました");
    } catch (err) {
      if (isLiffSwrSessionExpired(err)) {
        setFeedback(
          "ログインの有効期限が切れました。画面を更新してください。",
        );
      } else {
        setFeedback(err instanceof Error ? err.message : "投稿に失敗しました");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-4">
      <nav className="-mx-1 mb-5 flex gap-5 overflow-x-auto px-1 pb-1">
        {TABS.map((c) => {
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

      <div className="relative mb-4">
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
          placeholder="お知らせ検索"
          className="w-full rounded-full border-none bg-slate-100 py-3.5 pl-12 pr-5 text-[15px] text-slate-700 outline-none placeholder:text-slate-400 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>

      {notConfigured ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-[13px] leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          掲示板は未設定です。Netlify の環境変数に{" "}
          <span className="font-mono">BULLETIN_APP_ID</span> と掲示板用 API
          キー（<span className="font-mono">BULLETIN_ATPOCKET_API_KEY</span>{" "}
          ほか）を設定してください。
          {data?.configError ? (
            <span className="mt-2 block text-[12px] text-amber-800 dark:text-amber-200">
              {data.configError}
            </span>
          ) : null}
        </div>
      ) : (
        <>
          <div className="mb-6">
            {formOpen ? (
              <form
                onSubmit={handleSubmit}
                className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
              >
                <div className="mb-3">
                  <label className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                    カテゴリ
                  </label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] text-slate-800 outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {BULLETIN_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mb-3">
                  <label className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                    タイトル
                  </label>
                  <input
                    type="text"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="お知らせのタイトル"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] text-slate-800 outline-none placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="mb-3">
                  <label className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                    詳細
                  </label>
                  <textarea
                    value={formBody}
                    onChange={(e) => setFormBody(e.target.value)}
                    placeholder="お知らせの内容を入力してください"
                    rows={4}
                    className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setFormOpen(false);
                      setFeedback(null);
                    }}
                    className="rounded-full px-4 py-2 text-[13px] font-medium text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    disabled={
                      submitting ||
                      formTitle.trim() === "" ||
                      formBody.trim() === ""
                    }
                    className="rounded-full bg-slate-900 px-5 py-2 text-[13px] font-bold text-white transition active:scale-[0.98] disabled:opacity-40 dark:bg-white dark:text-slate-900"
                  >
                    {submitting ? "投稿中…" : "投稿する"}
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setFormOpen(true);
                  setFeedback(null);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 py-3 text-[14px] font-bold text-white transition active:scale-[0.99] dark:bg-white dark:text-slate-900"
              >
                <span className="text-[18px] leading-none">＋</span>
                お知らせを投稿
              </button>
            )}
          </div>

          {feedback ? (
            <p
              className={`mb-4 text-center text-[13px] font-medium ${
                feedback.includes("失敗") || feedback.includes("切れ")
                  ? "text-amber-700 dark:text-amber-300"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {feedback}
            </p>
          ) : null}

          {isLoading && posts.length === 0 ? (
            <p className="py-16 text-center text-[14px] text-slate-400">
              読み込み中…
            </p>
          ) : error ? (
            <p className="py-16 text-center text-[14px] text-amber-600 dark:text-amber-400">
              お知らせの取得に失敗しました。画面を更新してください。
            </p>
          ) : items.length === 0 ? (
            <p className="py-16 text-center text-[14px] text-slate-400">
              {posts.length === 0
                ? "まだお知らせはありません。「お知らせを投稿」から追加できます。"
                : "該当するお知らせはありません。"}
            </p>
          ) : (
            <ul className="border-t border-slate-200 dark:border-slate-700">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="border-b border-slate-200 dark:border-slate-700"
                >
                  <div className="py-5">
                    <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {item.category ? (
                        <span className="text-[12px] font-bold tracking-wide text-pink-600 dark:text-pink-400">
                          [ {item.category} ]
                        </span>
                      ) : null}
                      {item.date ? (
                        <span className="text-[12px] text-slate-400">
                          {item.date}
                        </span>
                      ) : null}
                      {item.date === today ? (
                        <span className="text-[10px] font-bold tracking-wider text-pink-600 dark:text-pink-400">
                          NEW
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[15px] font-bold leading-relaxed text-slate-900 dark:text-white">
                      {item.title}
                    </p>
                    {item.body ? (
                      <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-slate-600 dark:text-slate-300">
                        {item.body}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
