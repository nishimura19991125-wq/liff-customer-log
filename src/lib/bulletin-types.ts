/** 掲示板の共有型（サーバー・クライアント共通・server-only にしない） */

/** カテゴリー（@pocket のテキスト列・投稿時のプルダウン選択肢） */
export const BULLETIN_CATEGORIES = [
  "営業",
  "経理",
  "事務",
  "DX",
  "工事",
  "人事",
  "トラーチ倶楽部",
] as const;

export type BulletinCategory = (typeof BULLETIN_CATEGORIES)[number];

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
