export type OrgChartUnit = {
  title: string;
  subtitle?: string;
  staff: string[];
  branches?: OrgChartUnit[];
};

export type OrgChartHeadquarters = {
  title: string;
  departments: OrgChartUnit[];
};

export type OrgChartData = {
  leadership: string[];
  coaches: string[];
  externalAdvisors: string[];
  headquarters: OrgChartHeadquarters[];
  memberCompanies: string[];
};

export const ORG_CHART_DATA: OrgChartData = {
  leadership: [
    "株主総会",
    "代表取締役　稲場基泰",
    "専務取締役　稲場康祐",
    "執行役員　栄田成葵",
  ],
  coaches: [
    "【相談所】山崎顧問",
    "【アポインター特化コーチ】栄田執行役員",
    "【クローザー特化コーチ】大山次長",
  ],
  externalAdvisors: [
    "阪口顧問（経営戦略）",
    "金沢顧問（営業力開発）",
    "山崎顧問（社員育成）",
    "長友顧問（組織戦略）",
    "荒武顧問（法律・契約書作成）",
    "中村顧問（労務）",
    "島田顧問（税務）",
    "西川顧問（財務）",
    "絆JAPAN相談役（スマート商材）",
    "樋口顧問（HP構築・Web集客）",
    "岡兄弟（SNS戦略）",
    "Place&Ability・EISHIN（採用）",
    "櫻井顧問（メディアPR）",
    "高橋相談役（政治・官僚対応）",
    "アチーブメント・日創研（研修・育成）",
  ],
  headquarters: [
    {
      title: "施工本部",
      departments: [
        {
          title: "工事部",
          staff: ["TL 羽野主任", "岩切係員"],
        },
        {
          title: "施工管理部",
          staff: ["TL 栗尾主任"],
        },
      ],
    },
    {
      title: "管理本部",
      departments: [
        {
          title: "経理・総務課",
          staff: ["TL 松岡次長", "秋山係長", "近藤係長"],
        },
        {
          title: "人事・広報・SNS運用課",
          staff: ["TL 笠井主任", "松村係員"],
        },
      ],
    },
    {
      title: "営業推進部",
      departments: [
        {
          title: "事務管理課",
          staff: [
            "TL 山下係長",
            "TL 細谷係長",
            "白羽主任",
            "栗尾主任（兼）",
            "高橋係員",
            "江戸係員",
            "今井さん",
          ],
        },
        {
          title: "DX事業課",
          staff: ["TL 西村係長", "富田主任"],
        },
      ],
    },
    {
      title: "営業本部",
      departments: [
        {
          title: "DC事業部",
          subtitle: "責任者　森澤次長",
          branches: [
            {
              title: "奈良本社",
              staff: ["TL 中尾主任", "岩田係員", "石田係員", "大木圭係員"],
            },
            {
              title: "京都支社",
              staff: ["TL 河野係長", "若松係員"],
            },
            {
              title: "名古屋支社",
              staff: [
                "TL 松浪主任",
                "加藤主任",
                "丸山係員",
                "瀬島係員",
                "阪本係員",
              ],
            },
            {
              title: "関東支社",
              staff: [
                "TL 羽野課長（兼）",
                "朝岡主任",
                "藤岡主任",
                "田中係員",
                "大木巴係員",
              ],
            },
          ],
          staff: [],
        },
        {
          title: "営業推進事業部",
          branches: [
            {
              title: "ネット集客事業部",
              staff: [
                "TL 羽野課長（兼）",
                "藤岡主任（兼）",
                "松浪主任（兼）",
              ],
            },
            {
              title: "アライアンス事業部",
              staff: [
                "TL 羽野課長",
                "森澤次長（兼）",
                "大山次長（兼）",
                "河野係長（兼）",
                "朝岡主任（兼）",
              ],
            },
          ],
          staff: [],
        },
        {
          title: "産業用事業部",
          staff: ["TL 大山次長（兼）", "山下係長（兼）"],
        },
        {
          title: "トラーチ倶楽部",
          staff: [
            "TL 大山次長",
            "松岡次長（兼）",
            "山口係員",
            "敵蔭係員",
            "江戸係員（兼）",
          ],
        },
      ],
    },
  ],
  memberCompanies: [
    "株式会社絆（香川）",
    "株式会社泰昌（愛知）",
    "株式会社満天（新潟）",
    "株式会社佐藤（東京）",
    "株式会社猫神（千葉）",
    "株式会社山根組（愛知）",
    "SAKAI株式会社（大分）",
    "株式会社ミヤケン（群馬）",
    "匠建設株式会社（山口）",
    "株式会社セイリョウ（愛知）",
    "株式会社大直工務店（福島）",
    "カワバタ建設株式会社（福井）",
    "サティスホーム株式会社（三重）",
    "ユニージャパン株式会社（東京）",
    "大分ベスト不動産株式会社（大分）",
  ],
};
