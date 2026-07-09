export type InternalEventsScheduleStep = {
  mark: string;
  title: string;
  duration?: string;
  notes?: string[];
  subItems?: string[];
};

export type InternalEventsDaySection = {
  title?: string;
  notes?: string[];
  steps?: InternalEventsScheduleStep[];
  items?: string[];
};

export type InternalEventsDayBlock = {
  timeRange: string;
  sections: InternalEventsDaySection[];
};

export type InternalEventsContent =
  | { type: "text"; paragraphs: string[] }
  | { type: "bullet-list"; heading?: string; items: string[] }
  | {
      type: "schedule";
      timeRange: string;
      steps: InternalEventsScheduleStep[];
    }
  | { type: "day-schedule"; blocks: InternalEventsDayBlock[] };

export type InternalEventsSection = {
  slug: string;
  title: string;
  description: string;
  content: InternalEventsContent;
};

export const INTERNAL_EVENTS_SECTIONS: InternalEventsSection[] = [
  {
    slug: "morning-assembly",
    title: "朝礼の流れ",
    description: "部署朝礼の進行手順を確認します。",
    content: {
      type: "text",
      paragraphs: [
        "部署朝礼の流れは準備中です。内容が決まり次第、ここに掲載します。",
      ],
    },
  },
  {
    slug: "weekly-wednesday-schedule",
    title: "毎週水曜日のスケジュール",
    description: "毎週水曜日の社内スケジュールを確認します。",
    content: {
      type: "day-schedule",
      blocks: [
        {
          timeRange: "8:00～9:30",
          sections: [{ title: "幹部会議" }],
        },
        {
          timeRange: "9:30〜10:00",
          sections: [
            {
              steps: [
                { mark: "①", title: "ラジオ体操", duration: "3分" },
                { mark: "②", title: "神棚挨拶", duration: "1分" },
                {
                  mark: "③",
                  title:
                    "あいさつチェック(あかるく、いきいき、さわやかに、つたわる)・聞き手の姿勢",
                  duration: "1分",
                },
                {
                  mark: "④",
                  title: "理念浸透",
                  duration: "10分",
                  notes: ["司会者が2名指名"],
                  subItems: [
                    "月曜日：企業理念",
                    "火曜日：ミッション",
                    "水曜日：For Happiness",
                    "木曜日：ビジョン",
                    "金曜日：行動規範、社員心得",
                    "土曜日：共通認識①～⑤",
                    "日曜日：共通認識⑥～⑩",
                  ],
                },
                {
                  mark: "⑤",
                  title: "ありがとうカード",
                  duration: "最大5分",
                  notes: [
                    "代表者3名あてる ※司会者も含む",
                    "一斉にありがとうカードを渡す",
                  ],
                },
                {
                  mark: "⑥",
                  title: "週間表彰",
                  duration: "5分",
                  subItems: [
                    "週間の成約件数が2件以上 → AP対象",
                    "週間の粗利金額2,000,000pt以上 → CL対象",
                    "月～日 ※日曜日締め",
                  ],
                },
                {
                  mark: "⑦",
                  title: "週間MVP",
                  duration: "5分",
                  notes: ["1人"],
                },
              ],
            },
          ],
        },
        {
          timeRange: "10:00〜11:00",
          sections: [
            {
              title: "各部署の責任者で議論",
              notes: ["※各部署の責任者のみ"],
              items: [
                "★工事部 → 羽野主任",
                "★施工管理課 → 栗尾主任",
                "★経理課 → 松岡次長",
                "★人事課 → 笠井主任",
                "★事務管理課 → 細谷係長・山下係長",
                "★DX推進課 → 西村係長",
                "★DC事業部 → 森澤次長",
                "★アライアンス事業部 → 羽野課長",
                "★ネット集客事業部 → 松浪主任",
                "★トラーチ倶楽部 → 大山次長",
              ],
            },
            {
              title: "他メンバー",
              items: ["事務 → 実務", "営業 → アポロープレ"],
            },
          ],
        },
        {
          timeRange: "11:00〜12:00",
          sections: [
            {
              title: "各部署に分かれて周知事項共有（議事録）",
              notes: ["ラブコール内容周知及び再発防止"],
            },
          ],
        },
        {
          timeRange: "12:00〜13:00",
          sections: [{ title: "昼休憩" }],
        },
        {
          timeRange: "13:00～",
          sections: [{ title: "営業メンバー以外は実務" }],
        },
        {
          timeRange: "13:00〜14:00",
          sections: [
            { title: "営業進捗会議" },
            { title: "トラーチ倶楽部　進捗会議" },
          ],
        },
        {
          timeRange: "14:00〜",
          sections: [
            {
              items: [
                "クローザー → クロージングロープレ",
                "アポインター → アポ活動（別支社同行など）",
              ],
            },
          ],
        },
      ],
    },
  },
  {
    slug: "contacts",
    title: "連絡先一覧",
    description: "社内の連絡先を確認します。",
    content: {
      type: "text",
      paragraphs: [
        "連絡先一覧は準備中です。内容が決まり次第、ここに掲載します。",
      ],
    },
  },
  {
    slug: "line-send-list",
    title: "LINE自動送信リスト",
    description: "LINE自動送信リストを確認します。",
    content: {
      type: "bullet-list",
      heading: "LINE自動送信リスト",
      items: [
        "本日の商談",
        "本日の商談結果",
        "本日の工事案件",
        "本日の工事結果",
        "工事優先順位",
        "本日の出勤者",
        "工事対応者未定（水曜日からの一週間分）",
        "CLランキング",
        "APランキング",
        "営業成績",
        "卸案件の書類進捗",
        "トラーチの書類進捗",
      ],
    },
  },
  {
    slug: "trarchi-culture",
    title: "トラーチの文化",
    description: "トラーチの文化・方針を確認します。",
    content: {
      type: "text",
      paragraphs: [
        "トラーチの文化に関する内容は準備中です。内容が決まり次第、ここに掲載します。",
      ],
    },
  },
];

export function internalEventsSectionBySlug(
  slug: string,
): InternalEventsSection | null {
  const t = slug.trim();
  return INTERNAL_EVENTS_SECTIONS.find((s) => s.slug === t) ?? null;
}
