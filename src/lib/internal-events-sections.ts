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
    body: [
      `9:30〜10:00
①ラジオ体操　3分
②神棚挨拶　1分
③あいさつチェック(あかるく、いきいき、さわやかに、つたわる)・聞き手の姿勢　1分
④理念浸透　10分
→司会者が2名指名
月曜日：企業理念
火曜日：ミッション
水曜日：For Happiness
木曜日：ビジョン
金曜日：行動規範、社員心得
土曜日：共通認識①～⑤
日曜日：共通認識⑥～⑩
⑤ありがとうカード　最大5分
代表者3名あてる※司会者も含む
一斉にありがとうカードを渡す
⑥週間表彰　5分
週間の成約件数が2件以上→AP対象
週間の粗利金額2,000,000pt以上→CL対象
月～日※日曜日締め
⑦週間MVP
1人　5分`,
    ],
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
