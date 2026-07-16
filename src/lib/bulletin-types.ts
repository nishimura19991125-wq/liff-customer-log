/** 掲示板の共有型（サーバー・クライアント共通・server-only にしない） */

export const BULLETIN_CATEGORIES = [
  "営業",
  "経理",
  "事務",
  "DX",
  "工事",
  "人事",
] as const;

export type BulletinCategory = (typeof BULLETIN_CATEGORIES)[number];

export type BulletinPost = {
  id: string;
  category: string;
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

export function isBulletinCategory(value: string): value is BulletinCategory {
  return (BULLETIN_CATEGORIES as readonly string[]).includes(value);
}
