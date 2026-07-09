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
    title: "朝礼の流れ（水曜日以外）",
    description: "水曜日以外の朝礼の進行手順を確認します。",
    content: {
      type: "day-schedule",
      blocks: [
        {
          timeRange: "9:28～",
          sections: [
            {
              title: "LINEビデオ通話をスタート",
              notes: ["※グループは、シントラーチ"],
            },
          ],
        },
        {
          timeRange: "9:30～",
          sections: [{ title: "朝礼開始" }],
        },
        {
          timeRange: "9:31～9:33",
          sections: [
            {
              title: "朝礼時の心得を確認",
              notes: ["→以下文面を読み上げる"],
              items: [
                "■あいさつ(話し手)",
                "あかるく",
                "いきいき",
                "さわやかに",
                "伝わる",
                "■すなお(聞き手フォロワーシップ)",
                "すごい",
                "なるほど",
                "面白い",
                "■(聞き手　信頼関係構築)",
                "笑顔 / 視線 / 姿勢",
                "身だしなみ・服装チェック",
                "スマイルチェック",
              ],
            },
          ],
        },
        {
          timeRange: "9:33～9:35",
          sections: [
            {
              title: "コミュニケーションブリッジ",
              notes: [
                "1. 司会者が当日のページを読む",
                "（読む箇所は写真の赤枠）",
              ],
            },
          ],
        },
        {
          timeRange: "9:35～9:36",
          sections: [
            {
              notes: [
                "2. 司会者が読んだ内容について感想を述べる",
                "（感想は1分でまとめる）",
              ],
            },
          ],
        },
        {
          timeRange: "9:36～9:39",
          sections: [
            {
              notes: [
                "3. 読んだ内容について合計2名指名し感想を述べてもらい",
                "それについて司会者がそれぞれ感想を述べる",
                "（感想は1分でまとめる）",
              ],
            },
          ],
        },
        {
          timeRange: "9:39～9:41",
          sections: [
            {
              title: "経営理念・共通認識",
              notes: ["1. 司会者が指定のページからピックアップして読む"],
              items: [
                "月曜日：企業理念",
                "火曜日：ミッション",
                "水曜日：For Happiness",
                "木曜日：ビジョン",
                "金曜日：行動規範、社員心得",
                "土曜日：共通認識①～⑤",
                "日曜日：共通認識⑥～⑩",
              ],
            },
          ],
        },
        {
          timeRange: "9:41～9:42",
          sections: [
            {
              notes: [
                "2. 読んだページについて感想（エピソードトーク）を述べる",
                "（感想は1分でまとめる）",
              ],
            },
          ],
        },
        {
          timeRange: "9:42～9:45",
          sections: [
            {
              notes: [
                "3. 読んだ内容について合計2名指名し感想を述べてもらい",
                "それについて司会者がそれぞれ感想を述べる",
                "（感想は1分でまとめる）",
              ],
            },
          ],
        },
        {
          timeRange: "9:45～9:46",
          sections: [
            {
              title: "事務（各自共有事項あれば）",
              notes: ["※公式LINEの要返信案件を共有"],
            },
          ],
        },
        {
          timeRange: "9:46～9:47",
          sections: [{ title: "経理部（松岡次長、秋山係長、近藤係長）" }],
        },
        {
          timeRange: "9:47～9:48",
          sections: [{ title: "DX事業部（西村係長、冨田主任）" }],
        },
        {
          timeRange: "9:48～9:49",
          sections: [{ title: "人事（笠井主任、松村係員）" }],
        },
        {
          timeRange: "9:49～9:50",
          sections: [{ title: "工事部（羽野主任、栗尾主任、岩切係員）" }],
        },
        {
          timeRange: "9:50～9:51",
          sections: [{ title: "DC事業部（森澤次長、中尾主任など）" }],
        },
        {
          timeRange: "9:51～9:52",
          sections: [{ title: "ネット集客事業部（松浪主任、藤岡主任）" }],
        },
        {
          timeRange: "9:52～9:53",
          sections: [{ title: "アライアンス（羽野課長、河野係長）" }],
        },
        {
          timeRange: "9:53～9:54",
          sections: [{ title: "トラーチ倶楽部（大山次長、松岡次長、敏蔭係員）" }],
        },
        {
          timeRange: "9:54～9:55",
          sections: [{ title: "栄田本部長" }],
        },
        {
          timeRange: "9:55～9:57",
          sections: [{ title: "康祐専務から総括" }],
        },
        {
          timeRange: "9:57～9:59",
          sections: [{ title: "基泰社長から総括" }],
        },
        {
          timeRange: "9:59～10:00",
          sections: [
            {
              title: "気持ちが入る言葉もしくは一言で締める",
              notes: ["スイッチオン3連発"],
            },
          ],
        },
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
