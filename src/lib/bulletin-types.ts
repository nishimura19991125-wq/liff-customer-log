/** 掲示板の共有型（サーバー・クライアント共通・server-only にしない） */

/** カテゴリー（@pocket のテキスト列・投稿時のプルダウン選択肢） */
export const BULLETIN_CATEGORY_ALL = "ALL" as const;

export const BULLETIN_CATEGORIES = [
  BULLETIN_CATEGORY_ALL,
  "営業",
  "経理",
  "事務",
  "DX",
  "工事",
  "人事",
  "トラーチ倶楽部",
] as const;

export type BulletinCategory = (typeof BULLETIN_CATEGORIES)[number];

const BULLETIN_CATEGORY_LABEL_MAP: Record<BulletinCategory, string> = {
  ALL: "全体",
  営業: "営業",
  経理: "経理",
  事務: "事務",
  DX: "DX",
  工事: "工事",
  人事: "人事",
  トラーチ倶楽部: "トラーチ倶楽部",
};

export function bulletinCategoryLabel(value: string): string {
  if (isBulletinCategory(value)) return BULLETIN_CATEGORY_LABEL_MAP[value];
  return value;
}

export function isBulletinCategory(value: string): value is BulletinCategory {
  return (BULLETIN_CATEGORIES as readonly string[]).includes(value);
}

/** タグ（@pocket のチェックボックス列の選択肢） */
export const BULLETIN_TAGS = [
  "社長",
  "営業",
  "事務",
  "DX",
  "経理",
  "人事",
  "工事",
  "金利",
  "補助金",
  "納品",
  "トラーチ倶楽部",
  "燃料費調整額",
] as const;

export type BulletinTag = (typeof BULLETIN_TAGS)[number];

export type BulletinPost = {
  id: string;
  /** カテゴリー列（テキスト） */
  category: string;
  /** チェックボックス列（複数選択） */
  tags: string[];
  date: string;
  title: string;
  body: string;
};

export type BulletinListResponse = {
  configured: boolean;
  configError?: string;
  error?: string;
  posts?: BulletinPost[];
};

export function isBulletinTag(value: string): value is BulletinTag {
  return (BULLETIN_TAGS as readonly string[]).includes(value);
}

/** 掲示板の日付表示（JST・"2026.07.16"） */
export function bulletinTodayLabelJst(d = new Date()): string {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
  }).format(d);
  const [y, m, day] = key.split("-");
  return `${y}.${m}.${day}`;
}

/** 閲覧者（既読）1件 */
export type BulletinViewer = {
  name: string;
  date: string;
};

export type BulletinViewersResponse = {
  configured: boolean;
  viewers?: BulletinViewer[];
};
