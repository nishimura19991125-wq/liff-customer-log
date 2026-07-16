"use client";

import liff from "@line/liff";
import { useEffect, useState, type FormEvent } from "react";

import { useBulletinRead } from "@/hooks/use-bulletin-read";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import {
  BULLETIN_CATEGORIES,
  BULLETIN_TAGS,
  bulletinCategoryLabel,
  bulletinTodayLabelJst,
  isBulletinCategory,
  type BulletinListResponse,
  type BulletinPost,
} from "@/lib/bulletin-types";
import { liffAuthedJsonFetch, isLiffSwrSessionExpired } from "@/lib/liff-swr";
import { useLiffIdToken } from "@/lib/liff-id-token-context";

const TABS = BULLETIN_CATEGORIES;
const TAG_TABS = ["ALL", ...BULLETIN_TAGS] as const;
const DEFAULT_CATEGORY_FOR_POST = "営業";

type BulletinFormData = {
  category: string;
  tags: string[];
  title: string;
  body: string;
};

/** お知らせの全文表示（画面全体） */
function PostTagsAndDate({
  tags,
  date,
  today,
  className,
}: {
  tags: string[];
  date: string;
  today: string;
  className?: string;
}) {
  if (tags.length === 0 && !date) return null;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 ${className ?? ""}`}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
          {tag}
        </span>
      ))}
      {date ? (
        <span className="text-[12px] text-slate-400">{date}</span>
      ) : null}
      {date === today ? (
        <span className="text-[10px] font-bold tracking-wider text-pink-600 dark:text-pink-400">
          NEW
        </span>
      ) : null}
    </div>
  );
}

/** お知らせの全文表示（画面全体） */
function PostDetail({
  post,
  today,
  onClose,
  onEdit,
}: {
  post: BulletinPost;
  today: string;
  onClose: () => void;
  onEdit: () => void;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-slate-950"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <button
          type="button"
          onClick={onClose}
          aria-label="一覧に戻る"
          className="-ml-1 flex size-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-5"
            aria-hidden
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <span className="text-[14px] font-medium text-slate-600 dark:text-slate-300">
          お知らせ
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          {post.category ? (
            <span className="text-[12px] font-bold tracking-wide text-pink-600 dark:text-pink-400">
              [ {bulletinCategoryLabel(post.category)} ]
            </span>
          ) : null}
        </div>

        <PostTagsAndDate
          tags={post.tags}
          date={post.date}
          today={today}
          className="mb-4"
        />

        <h2 className="text-[20px] font-bold leading-relaxed text-slate-900 dark:text-white">
          {post.title}
        </h2>
        {post.body ? (
          <p className="mt-4 whitespace-pre-wrap text-[15px] leading-[1.85] text-slate-700 dark:text-slate-200">
            {post.body}
          </p>
        ) : null}
      </div>

      <footer className="shrink-0 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
        <button
          type="button"
          onClick={onEdit}
          className="flex w-full items-center justify-center gap-1.5 rounded-full bg-slate-900 py-3 text-[14px] font-bold text-white transition active:scale-[0.99] dark:bg-white dark:text-slate-900"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-[14px]"
            aria-hidden
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          編集する
        </button>
      </footer>
    </div>
  );
}

/** 投稿・編集の共通フォーム（自身で入力状態を保持） */
function PostForm({
  initial,
  submitting,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: BulletinFormData;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (data: BulletinFormData) => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState(initial.category);
  const [tags, setTags] = useState<string[]>(initial.tags);
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);

  function toggleTag(tag: string) {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const t = title.trim();
    const b = body.trim();
    if (!t || !b || submitting) return;
    onSubmit({ category, tags, title: t, body: b });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
    >
      <div className="mb-3">
        <label className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
          カテゴリー
          <span className="ml-1 text-pink-600 dark:text-pink-400">*</span>
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] text-slate-800 outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        >
          {BULLETIN_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {bulletinCategoryLabel(c)}
            </option>
          ))}
        </select>
      </div>
      <div className="mb-3">
        <label className="mb-2 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
          タグ
        </label>
        <div className="flex flex-wrap gap-2">
          {BULLETIN_TAGS.map((tag) => {
            const selected = tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`rounded-full border px-3 py-1.5 text-[13px] transition ${
                  selected
                    ? "border-pink-500 bg-pink-50 font-bold text-pink-600 dark:border-pink-400 dark:bg-pink-950/40 dark:text-pink-300"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mb-3">
        <label className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
          タイトル
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="お知らせのタイトル"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] text-slate-800 outline-none placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />
      </div>
      <div className="mb-3">
        <label className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
          詳細
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="お知らせの内容を入力してください"
          rows={4}
          className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-4 py-2 text-[13px] font-medium text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          キャンセル
        </button>
        <button
          type="submit"
          disabled={submitting || title.trim() === "" || body.trim() === ""}
          className="rounded-full bg-slate-900 px-5 py-2 text-[13px] font-bold text-white transition active:scale-[0.98] disabled:opacity-40 dark:bg-white dark:text-slate-900"
        >
          {submitting ? "保存中…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

/** 社内掲示板（@pocket 掲示板アプリに保存＝全員で共有） */
export function BulletinBoard() {
  const idToken = useLiffIdToken();

  const { data, error, isLoading, mutate } = useLiffSwr<BulletinListResponse>(
    idToken ? "/api/bulletin" : null,
    idToken,
  );

  const [activeCategory, setActiveCategory] = useState<string>("ALL");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedPost, setSelectedPost] = useState<BulletinPost | null>(null);
  const [lineUserId, setLineUserId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const { isRead, markRead } = useBulletinRead(lineUserId);

  useEffect(() => {
    if (!idToken) {
      setLineUserId("");
      return;
    }
    let cancelled = false;
    void liff
      .getProfile()
      .then((profile) => {
        if (!cancelled) setLineUserId(profile.userId);
      })
      .catch(() => {
        if (!cancelled) setLineUserId("");
      });
    return () => {
      cancelled = true;
    };
  }, [idToken]);

  const posts = data?.posts ?? [];
  const notConfigured = data?.configured === false;
  const today = bulletinTodayLabelJst();

  const kw = keyword.trim().toLowerCase();
  const items = posts.filter((item) => {
    const matchCategory =
      activeCategory === "ALL" || item.category === activeCategory;
    const matchTag =
      activeTags.length === 0 ||
      activeTags.every((tag) => item.tags.includes(tag));
    const matchKeyword =
      kw === "" ||
      item.title.toLowerCase().includes(kw) ||
      item.body.toLowerCase().includes(kw) ||
      item.category.toLowerCase().includes(kw) ||
      item.tags.some((t) => t.toLowerCase().includes(kw)) ||
      bulletinCategoryLabel(item.category).toLowerCase().includes(kw);
    return matchCategory && matchTag && matchKeyword;
  });

  async function submitPost(
    payload: Record<string, unknown>,
    method: "POST" | "PUT",
    onSuccess: () => void,
    successMsg: string,
  ) {
    if (!idToken || submitting) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await liffAuthedJsonFetch<BulletinListResponse>(
        "/api/bulletin",
        idToken,
        {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      await mutate(res, { revalidate: false });
      onSuccess();
      setFeedback(successMsg);
    } catch (err) {
      if (isLiffSwrSessionExpired(err)) {
        setFeedback("ログインの有効期限が切れました。画面を更新してください。");
      } else {
        setFeedback(err instanceof Error ? err.message : "処理に失敗しました");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleCreate(formData: BulletinFormData) {
    void submitPost(
      formData,
      "POST",
      () => setCreateOpen(false),
      "投稿しました",
    );
  }

  function handleUpdate(recordId: string, formData: BulletinFormData) {
    void submitPost(
      { recordId, ...formData },
      "PUT",
      () => setEditingId(null),
      "更新しました",
    );
  }

  function startEdit(post: BulletinPost) {
    markRead(post.id);
    setCreateOpen(false);
    setSelectedPost(null);
    setFeedback(null);
    setEditingId(post.id);
  }

  function openPost(post: BulletinPost) {
    markRead(post.id);
    setSelectedPost(post);
  }

  function toggleActiveTag(tag: string) {
    if (tag === "ALL") {
      setActiveTags([]);
      return;
    }
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  return (
    <div className="mt-4">
      <nav className="-mx-1 mb-5 flex gap-5 overflow-x-auto px-1 pb-1">
        {TABS.map((c) => {
          const active = c === activeCategory;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setActiveCategory(c)}
              className={`relative shrink-0 whitespace-nowrap pb-1.5 text-[13px] transition-colors ${
                active
                  ? "font-bold text-slate-900 dark:text-white"
                  : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {bulletinCategoryLabel(c)}
              {active ? (
                <span className="absolute inset-x-0 -bottom-0.5 h-0.5 rounded bg-slate-900 dark:bg-white" />
              ) : null}
            </button>
          );
        })}
      </nav>

      <nav className="-mx-1 mb-4 flex gap-5 overflow-x-auto px-1 pb-1">
        {TAG_TABS.map((t) => {
          const active = t === "ALL" ? activeTags.length === 0 : activeTags.includes(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggleActiveTag(t)}
              className={`relative shrink-0 whitespace-nowrap pb-1.5 text-[13px] transition-colors ${
                active
                  ? "font-bold text-slate-900 dark:text-white"
                  : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {t === "ALL" ? "ALL" : t}
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
            {createOpen ? (
              <PostForm
                initial={{
                  category: DEFAULT_CATEGORY_FOR_POST,
                  tags: [],
                  title: "",
                  body: "",
                }}
                submitting={submitting}
                submitLabel="投稿する"
                onSubmit={handleCreate}
                onCancel={() => {
                  setCreateOpen(false);
                  setFeedback(null);
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setCreateOpen(true);
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
                  {editingId === item.id ? (
                    <div className="py-5">
                      <PostForm
                        initial={{
                          category: isBulletinCategory(item.category)
                            ? item.category
                        : DEFAULT_CATEGORY_FOR_POST,
                          tags: item.tags,
                          title: item.title,
                          body: item.body,
                        }}
                        submitting={submitting}
                        submitLabel="更新する"
                        onSubmit={(formData) =>
                          handleUpdate(item.id, formData)
                        }
                        onCancel={() => {
                          setEditingId(null);
                          setFeedback(null);
                        }}
                      />
                    </div>
                  ) : (
                    <div
                      className={`py-5 pl-3 transition ${
                        isRead(item.id)
                          ? "border-l-2 border-transparent"
                          : "border-l-2 border-pink-500 bg-pink-50/50 dark:bg-pink-950/15"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => openPost(item)}
                        className="block w-full text-left transition hover:opacity-70"
                      >
                        <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                          {!isRead(item.id) ? (
                            <span
                              className="size-2 shrink-0 rounded-full bg-pink-500"
                              aria-hidden
                            />
                          ) : null}
                          {item.category ? (
                            <span
                              className={`text-[12px] tracking-wide ${
                                isRead(item.id)
                                  ? "font-medium text-slate-500 dark:text-slate-400"
                                  : "font-bold text-pink-600 dark:text-pink-400"
                              }`}
                            >
                              [ {bulletinCategoryLabel(item.category)} ]
                            </span>
                          ) : null}
                          {!isRead(item.id) ? (
                            <span className="text-[10px] font-bold tracking-wider text-pink-600 dark:text-pink-400">
                              未読
                            </span>
                          ) : null}
                        </div>
                        <PostTagsAndDate
                          tags={item.tags}
                          date={item.date}
                          today={today}
                          className="mb-1.5"
                        />
                        <p
                          className={`text-[15px] leading-relaxed ${
                            isRead(item.id)
                              ? "font-medium text-slate-600 dark:text-slate-400"
                              : "font-bold text-slate-900 dark:text-white"
                          }`}
                        >
                          {item.title}
                        </p>
                        {item.body ? (
                          <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[14px] leading-relaxed text-slate-600 dark:text-slate-300">
                            {item.body}
                          </p>
                        ) : null}
                      </button>
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-[12px] font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-800 dark:border-slate-600 dark:text-slate-400 dark:hover:text-slate-200"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="size-[13px]"
                            aria-hidden
                          >
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                          編集
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {selectedPost ? (
        <PostDetail
          post={selectedPost}
          today={today}
          onClose={() => setSelectedPost(null)}
          onEdit={() => startEdit(selectedPost)}
        />
      ) : null}
    </div>
  );
}
