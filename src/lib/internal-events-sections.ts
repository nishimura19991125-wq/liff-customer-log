export type InternalEventsSection = {
  slug: string;
  title: string;
  description: string;
  /** 詳細ページ本文（段落ごと） */
  body: string[];
};

export const INTERNAL_EVENTS_SECTIONS: InternalEventsSection[] = [
  {
    slug: "morning-assembly",
    title: "朝礼の流れ",
    description: "部署朝礼の進行手順を確認します。",
    body: ["部署朝礼の流れは準備中です。内容が決まり次第、ここに掲載します。"],
  },
  {
    slug: "company-morning-assembly",
    title: "全体朝礼の流れ",
    description: "全体朝礼の進行手順を確認します。",
    body: ["全体朝礼の流れは準備中です。内容が決まり次第、ここに掲載します。"],
  },
  {
    slug: "contacts",
    title: "連絡先一覧",
    description: "社内の連絡先を確認します。",
    body: ["連絡先一覧は準備中です。内容が決まり次第、ここに掲載します。"],
  },
  {
    slug: "line-send-list",
    title: "LINE自動送信リスト",
    description: "LINE自動送信リストを確認します。",
    body: [
      `【LINE自動送信リスト】

・本日の商談
・本日の商談結果
・本日の工事案件
・本日の工事結果
・工事優先順位
・本日の出勤者
・工事対応者未定（水曜日からの一週間分）
・CLランキング
・APランキング
・営業成績
・卸案件の書類進捗
・トラーチの書類進捗`,
    ],
  },
  {
    slug: "trarchi-culture",
    title: "トラーチの文化",
    description: "トラーチの文化・方針を確認します。",
    body: ["トラーチの文化に関する内容は準備中です。内容が決まり次第、ここに掲載します。"],
  },
];

export function internalEventsSectionBySlug(
  slug: string,
): InternalEventsSection | null {
  const t = slug.trim();
  return INTERNAL_EVENTS_SECTIONS.find((s) => s.slug === t) ?? null;
}
