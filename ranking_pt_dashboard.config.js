"use strict";

/**
 * PT ランキングダッシュボード設定（この1ファイルだけで完結）。
 *
 * - Netlify（LINE ボット）: netlify/lib/clRankingAtpocket.js が require します。
 * - @pocket: カスタムJSの順を「このファイル → ranking_pt_dashboard.js」。このファイルだけ差し替え可能。
 *
 * 実行環境によって module.exports と globalThis.APP_RANKING_DASHBOARD_CONFIG の両方に同じオブジェクトを公開します。
 */
const RANKING_DASHBOARD_CONFIG = {
  APP_NAME: "※直接入力禁止　PT集計表",

  // Recommended: explicitly set field unique IDs.
  // Example: salesperson:"field_xxx", pt:"field_yyy", sales:"field_zzz", date:"field_aaa"
  FIELD_OVERRIDES: {
    salesperson: "", // 営業担当（担当者名）
    pt: "", // PT
    sales: "", // 売上（任意）
    date: "", // 計上日/契約日/日付 等
    customerName: "", // お客様名（詳細レコード表示用）
    regNo: "", // 登録番号（APPT始まりは契約件数0）
    introductionRoute: "", // 導入経緯（全体データ分析）
    store: "", // 施工店（全体データ分析）
    maker: "", // メーカー（全体データ分析）
    paymentMethod: "", // 支払方法（全体データ分析）
  },

  FIELD_KEYWORDS: {
    salesperson: ["営業担当", "担当者", "担当", "営業", "AP", "クローザー", "CL"],
    pt: ["PT", "ポイント", "point", "pt"],
    sales: ["売上", "金額", "受注金額", "契約金額", "税込", "税抜", "販売単価"],
    date: ["計上日", "契約日", "日付", "実績日", "売上日", "登録日", "PT加算日"],
    customerName: ["お客様名"],
    regNo: ["登録番号"],
    introductionRoute: ["導入経緯"],
    store: ["施工店"],
    maker: ["メーカー"],
    paymentMethod: ["支払方法", "支払い方法"],
  },

  TOP_N: 30,
  PAGE_LIMIT: 1000,
  MAX_PAGES_SAFETY: 200,
  WIDGET_ID: "ap-ranking-root-v4",

  // 表示/非表示の状態を保持するキー
  VISIBILITY_STORAGE_KEY: "apRankingVisible:PT",

  /* ====== アポランキング（別ページ表示） ====== */
  APO_APP_NAME: "アポ取得情報連携",

  // 別ページに出したい場合はページIDを指定（空なら全ページに出ます）
  // 例: APO_PAGE_ID: 1234
  APO_PAGE_ID: "",
  // 売上ランキングを特定ページに限定したい場合（空なら全ページ）
  SALES_PAGE_ID: "",

  APO_FIELD_OVERRIDES: {
    salesperson: "", // AP担当者
    clPerson: "", // CL担当者（CLデータ分析の商談実施数用）
    apoType: "", // アポ種別
    apoRank: "", // アポランク（個人アポ件数詳細用）
    date: "", // （任意）日付。期間機能を追加する場合に使用
    meetingDate: "", // （任意）商談データ・商談実施数の期間用。空なら見出し「初回商談実施日」
    estimateStatus: "", // 見積ステータス（アポキャン判定用）
    meetingPlace: "", // 商談場所（オンライン商談の除外判定用）
  },

  /* ====== LINE「本日の商談」（アポ取得情報連携） ====== */
  /** 本日の商談として返す見積ステータス（部分一致）。空配列ならステータスで絞りません */
  MEETING_SCHEDULE_STATUSES: [
    "商談セット作成済み",
    "商談日調整中",
    "再商談日調整中",
    "再商談",
    "新規",
    "見積依頼済み",
  ],
  /** 本日の商談から除外する見積ステータス（部分一致。再商談の誤包含より先に判定） */
  MEETING_SCHEDULE_EXCLUDED_STATUSES: ["再商談否", "再商談成約"],
  /** 導入経緯（アポ種別）の LINE 表示名 */
  MEETING_SCHEDULE_INTRODUCTION_ROUTE_LABELS: {
    ソーラーパートナーズ: "SP案件",
    ダイレクト: "DC案件",
  },
  MEETING_SCHEDULE_FIELD_OVERRIDES: {
    scheduledDate: "", // 商談日（空なら見出し「商談・資料送付予定日時」で自動解決）
    customerName: "", // お客様名
    city: "", // 市区郡（「○○市」表示。空なら見出し「市区郡」で自動解決）
    meetingTime: "", // 並び順用（任意）
  },
  MEETING_SCHEDULE_FIELD_KEYWORDS: {
    scheduledDate: ["商談・資料送付予定日時", "商談資料送付予定日時"],
    customerName: ["お客様名", "顧客氏名", "顧客名", "お客様"],
    city: ["市区郡", "市区町村", "市", "住所", "都道府県", "エリア", "地域", "訪問先"],
    meetingTime: ["商談予定時刻", "商談時刻", "予定時刻", "開始時刻", "商談時間", "時間"],
  },

  /* ====== LINE「本日の商談結果」（アポ取得情報連携・商談予定と同アプリ） ====== */
  /** 見積ステータスがこれなら詳細の「→」は「不明」（部分一致） */
  MEETING_RESULT_UNKNOWN_STATUS: "商談セット作成済み",
  MEETING_RESULT_FIELD_OVERRIDES: {
    meetingResult: "", // 初回商談結果
    closeType: "", // 片クロor両クロ
    apoAcquiredDate: "", // アポ獲得集計用（空なら「アポ取得日」）
  },
  MEETING_RESULT_FIELD_KEYWORDS: {
    meetingResult: ["初回商談結果", "商談結果"],
    closeType: ["片クロor両クロ", "片クロ", "両クロ"],
    apoAcquiredDate: ["アポ取得日", "アポ日", "取得日"],
  },
  /** アポ獲得集計の対象アポ種別（導入経緯・部分一致）。既定はダイレクトのみ */
  MEETING_RESULT_APO_ACQUIRED_APO_TYPES: ["ダイレクト"],

  /* ====== LINE「本日の工事案件」（別 @pocket アプリ） ====== */
  /** @pocket アプリ名（必ず設定。例: 工事予定管理） */
  CONSTRUCTION_APP_NAME: "工事登録アプリ",
  /** 空配列ならステータスで絞りません */
  CONSTRUCTION_SCHEDULE_STATUSES: [],
  CONSTRUCTION_SCHEDULE_EXCLUDED_STATUSES: [],
  /** 住宅ステータスがこの値のとき、施工予定日の代わりに下記4日付で本日判定 */
  CONSTRUCTION_NEW_HOUSING_LABEL: "新築",
  CONSTRUCTION_SCHEDULE_FIELD_OVERRIDES: {
    scheduledDate: "",
    customerName: "",
    housingStatus: "",
    preparationDate: "",
    panelConstructionDate: "",
    electricalWorkDate: "",
    appSetupDate: "",
    manufacturer: "",
    constructionHandler: "",
    contractor: "",
    city: "",
    workContent: "",
    assignee: "",
    store: "",
    status: "",
  },
  CONSTRUCTION_SCHEDULE_FIELD_KEYWORDS: {
    scheduledDate: [
      "施工予定日",
      "工事予定日時",
      "施工予定日時",
      "工事日",
      "予定日時",
      "施工日",
    ],
    customerName: ["お客様名", "顧客氏名", "顧客名", "お客様"],
    housingStatus: ["住宅ステータス", "住宅状況", "建物ステータス"],
    preparationDate: ["仕込み日", "仕込日", "仕込み"],
    panelConstructionDate: ["パネル工事日", "パネル工事"],
    electricalWorkDate: ["電気工事日", "電気工事"],
    appSetupDate: ["アプリ設定日", "アプリ設定"],
    manufacturer: ["メーカー"],
    constructionHandler: ["工事対応者", "工事担当", "施工担当", "現場担当", "担当者"],
    contractor: ["施工会社", "施工業者"],
    city: ["市区郡", "市区町村", "市", "住所"],
    workContent: ["工事内容", "工種", "工事種別", "作業内容"],
    assignee: ["施工担当", "担当者", "現場担当", "工事担当"],
    store: ["施工店", "店舗"],
    status: ["ステータス", "工事ステータス", "進捗", "状態"],
  },

  /* ====== LINE「本日の工事結果」（工事報告アプリ） ====== */
  /** @pocket アプリ名（工事登録アプリとは別） */
  CONSTRUCTION_RESULT_APP_NAME: "工事報告",
  /** 工事ステータスがこれなら「→不明」（部分一致）。空配列なら工事結果未入力のみ不明 */
  CONSTRUCTION_RESULT_UNKNOWN_STATUSES: ["未施工", "施工予定", "予定"],
  /** 完工件数に数えるステータス（部分一致） */
  CONSTRUCTION_RESULT_COMPLETED_STATUSES: ["完工", "完了", "施工完了"],
  CONSTRUCTION_REPORT_FIELD_OVERRIDES: {
    customerName: "",
    constructionHandler: "",
    contractor: "",
    constructionResult: "",
    status: "",
  },
  /* ====== LINE「工事空き枠」「工事優先順位」（工事登録アプリ） ====== */
  /** 本日から何日先まで表示するか */
  CONSTRUCTION_SLOT_MAX_DAYS_AHEAD: 30,
  /** 空き枠とみなすステータス（部分一致）。空配列なら「お客様名が未入力」を空き枠とする */
  CONSTRUCTION_SLOT_STATUSES: ["空き", "空枠", "予約可"],
  /** 表示する地方の順序 */
  CONSTRUCTION_SLOT_REGION_ORDER: ["関西", "中部", "関東"],
  /** レコードがなくても固定文を出す地方（例: 中部＝都度確認） */
  CONSTRUCTION_SLOT_STATIC_REGION_MESSAGES: {
    中部: "都度確認",
  },
  /**
   * 地方別ルール（施工会社で地方判定・日数は土日祝除く営業日）
   * 関西: 全て可能＝本日から8営業日以上 / 244＝それ以外で5営業日以上
   * 関東: 関西の各閾値＋2営業日（businessDayDelta）
   * 期日＝空き枠日から deadlineOffset 営業日前（DEADLINE_EXTRA で微調整可）
   * 関西: 全て可能9・244は6営業日前 / 関東: 関西+2（11・8）
   */
  /** 期日をさらに進める営業日数（0＝offsetどおり） */
  CONSTRUCTION_SLOT_DEADLINE_EXTRA_BUSINESS_DAYS: 0,
  /** 祝日の追加（YYYY-MM-DD）。自動判定に加えて会社休業日等を指定 */
  CONSTRUCTION_SLOT_PUBLIC_HOLIDAYS_EXTRA: [],
  /** 関東ルールを関西＋N営業日で自動算出（関東に数値を書かない場合） */
  CONSTRUCTION_SLOT_KANTO_BUSINESS_DAY_DELTA: 2,
  CONSTRUCTION_SLOT_REGION_RULES: {
    関西: {
      contractor: "Roof10",
      contractorMatch: ["Roof10", "roof10", "ルーフ10"],
      fullConditionLabel: "全て可能",
      limitedConditionLabel: "244・ブラックパネルのみ",
      fullMinDays: 8,
      limitedMinDays: 5,
      deadlineOffsetFull: 9,
      deadlineOffsetLimited: 6,
    },
    関東: {
      contractor: "東亜電巧",
      contractorMatch: ["東亜電巧", "東亜"],
      businessDayDelta: 2,
    },
  },

  CONSTRUCTION_REPORT_FIELD_KEYWORDS: {
    customerName: ["お客様名", "顧客氏名", "顧客名", "お客様"],
    constructionHandler: ["工事対応者", "工事担当", "施工担当", "現場担当", "担当者"],
    contractor: ["施工会社", "施工業者"],
    constructionResult: ["工事結果", "施工結果", "報告内容", "結果", "完工結果"],
    status: ["ステータス", "工事ステータス", "進捗", "状態"],
  },

  APO_FIELD_KEYWORDS: {
    salesperson: ["AP担当者", "AP 担当者", "担当者", "営業担当", "営業", "AP"],
    clPerson: ["CL担当者", "CL 担当者"],
    apoType: ["アポ種別", "アポタイプ", "種別"],
    apoRank: ["アポランク", "ランク", "APランク", "アポ ランク"],
    date: ["初回商談実施日", "日付", "登録日", "作成日", "実績日", "アポ日", "取得日"],
    estimateStatus: ["見積ステータス", "見積ｽﾃｰﾀｽ", "見積ステータス区分"],
    meetingPlace: ["商談場所"],
  },
  /** 見出し名が完全一致のとき最優先（AP残玉等・集計の「AP担当者」列） */
  APO_SALESPERSON_EXACT_CAPTIONS: ["AP担当者", "AP 担当者"],
  /** 完全一致に失敗した場合の次候補（その後、広い salesperson キーワード） */
  APO_SALESPERSON_STRICT_KEYWORDS: [
    "AP担当者",
    "AP 担当者",
    "AP担当",
    "アポインター",
    "アポ担当者",
  ],
  AWARDS_FIELD_OVERRIDES: {
    salesperson: "", // AP担当者
    apoType: "", // アポ種別
    date: "", // 日付
    estimateStatus: "", // 見積ステータス（対象レコード表示用）
    closeType: "", // 片クロor両クロ
    meetingPlace: "", // 商談場所
    leadTime: "", // 商談化リードタイム
  },
  AWARDS_FIELD_KEYWORDS: {
    salesperson: ["AP担当者", "AP 担当者", "担当者", "営業担当", "営業", "AP"],
    apoType: ["アポ種別", "アポタイプ", "種別"],
    date: ["アポ取得日", "日付", "登録日", "作成日", "実績日", "アポ日", "取得日"],
    estimateStatus: ["見積ステータス", "見積ｽﾃｰﾀｽ", "見積ステータス区分"],
    closeType: ["片クロor両クロ", "片クロ", "両クロ"],
    meetingPlace: ["商談場所"],
    leadTime: ["商談化リードタイム", "リードタイム"],
  },

  /* ====== 稼働日数用アプリ（稼働終了報告） ====== */
  WORK_APP_NAME: "稼働終了報告",
  WORK_FIELD_OVERRIDES: {
    salesperson: "", // 営業担当（稼働終了報告の見出しが「報告者」でも可）
    date: "", // 報告日
    pingpongCount: "", // ピンポン数
    interviewCount: "", // 面談数
    apoGetCount: "", // アポ獲得数
  },
  WORK_FIELD_KEYWORDS: {
    salesperson: ["報告者", "担当者", "営業担当", "営業"],
    date: ["報告日", "日付", "登録日"],
    pingpongCount: ["ピンポン数", "ピンポン", "訪問数"],
    interviewCount: ["面談数", "面談", "商談数"],
    apoGetCount: ["アポ獲得数", "獲得アポ数", "アポ数"],
  },

  APO_FILTER_VALUE: "ダイレクト",
  APO_FILTER_VALUES: ["ダイレクト", "お客様紹介"],
  /** APランキングの件数換算対象（アポ種別・部分一致）。空なら APO_FILTER_VALUES を使用 */
  APO_RANKING_FILTER_VALUES: ["ダイレクト", "お客様紹介", "(DC)工務店OBリスト"],
  PERSONAL_APO_BAR_FILTER_VALUES: ["ダイレクト", "お客様紹介", "(DC)工務店OBリスト"],
  APO_TOP_N: 30,
  CL_AWARD_MIN_CONTRACT_COUNT: 6,
  CL_AWARD_MIN_PT: 5000000,
  CL_WEEKLY_MIN_PT: 2000000,
  CL_MEETING_STATUSES: [
    "再商談日調整中",
    "再商談",
    "返待ち",
    "即決成約",
    "再商談成約",
    "返待ち成約",
    "否",
    "再商談否",
    "返待ち否",
    "クーリングオフ",
  ],
  /** 商談実施数：見積ステータスが以下以外の案件を集計（部分一致で除外） */
  APO_MEETING_EXCLUDED_STATUSES: ["新規", "見積依頼済み", "商談セット作成済み", "商談日調整中", "アポキャン"],
  /** 契約件数：見積ステータスが以下のいずれかの案件を集計 */
  APO_CONTRACT_STATUSES: ["即決成約", "再商談成約", "返待ち成約"],
  /**
   * 残玉数の見積ステータス（CL残玉・AP残玉の両方。アポ取得情報連携）
   * 期間は日付で絞らない＝全期間累計（取得済みレコード範囲）
   * - CL残玉: 見出し「CL担当者」の値 ＝ 営業担当
   * - AP残玉: 見出し「AP担当者」の値 ＝ 営業担当（フィールド解決は APO_SALESPERSON_EXACT_CAPTIONS 等）
   */
  APO_TAMA_STATUSES: [
    "新規",
    "見積依頼済み",
    "見積依頼済（資料のみ）",
    "商談日調整中",
    "商談セット作成済み",
    "再商談日調整中",
    "再商談",
  ],

  /* ====== 目標アプリ（営業 / アポ 共通） ====== */
  GOAL_APP_NAME: "目標登録(月次)",
  GOAL_FIELD_OVERRIDES: {
    salesperson: "",
    date: "",
    ptTarget: "",
    apoTarget: "",
    branch: "", // 支社（営業データ分析の支社別表記用）
    plannedWorkDays: "", // 稼働予定日数
  },
  GOAL_FIELD_KEYWORDS: {
    salesperson: ["担当者", "営業担当", "営業", "AP担当者", "AP 担当者"],
    date: ["対象月", "月", "年月", "日付", "登録日"],
    ptTarget: ["目標粗利", "粗利目標", "PT目標", "目標PT"],
    apoTarget: ["アポ獲得件数", "アポ獲得数", "アポ目標", "アポ件数目標"],
    branch: ["支社"],
    plannedWorkDays: ["稼働予定日数", "稼働予定日", "稼働予定"],
  },

  /* ====== 契約情報アプリ（件数集計・表彰等で共有） ====== */
  CONTRACT_FORM_APP_NAME: "1.契約情報入力フォーム",
  CONTRACT_FORM_FIELD_OVERRIDES: {
    date: "", // 初回契約日/日付（CONTRACT_FORM_FIELD_KEYWORDS.date 参照）
    appt: "", // APPT（旧）
    clpt: "", // CLPT（旧）
    /** 見出し名「APPT登録番号」— PTシートの登録番号（APPT始まり）と突合わせる */
    apptRegNo: "",
    /** 見出し名「CLPT登録番号」— PTシートの登録番号（CLPT始まり）と突合わせる */
    clptRegNo: "",
    customerName: "", // 顧客氏名（対象レコード・契約フォーム側の表示用）
    count: "", // 契約件数
    sales: "", // 契約金額
    clPerson: "", // CL担当者（クロージングランキング契約件数集計用）
    apPerson: "", // AP担当者（AP週間表彰用）
    customerStatus: "", // 顧客ステータス（AP週間表彰のキャンセル判定用）
    introductionRoute: "", // 導入経緯（AP週間表彰の対象判定用）
  },
  CONTRACT_FORM_FIELD_KEYWORDS: {
    date: ["初回契約日", "日付", "計上日", "実績日", "登録日"],
    appt: ["APPT", "AP PT"],
    clpt: ["CLPT", "CL PT"],
    apptRegNo: ["APPT登録番号"],
    clptRegNo: ["CLPT登録番号"],
    customerName: ["顧客氏名", "お客様名"],
    count: ["契約件数", "件数"],
    sales: ["契約金額", "売上", "金額", "受注金額", "税込", "税抜"],
    clPerson: ["CL担当者", "CL 担当者"],
    apPerson: ["AP担当者", "AP 担当者", "アポインター", "アポ担当者"],
    customerStatus: ["顧客ステータス", "顧客ｽﾃｰﾀｽ", "顧客状態", "ステータス"],
    introductionRoute: ["導入経緯"],
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = RANKING_DASHBOARD_CONFIG;
}

(function assignRankingDashboardGlobal(g) {
  if (!g || typeof g !== "object") return;
  g.APP_RANKING_DASHBOARD_CONFIG = RANKING_DASHBOARD_CONFIG;
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : typeof window !== "undefined"
      ? window
      : undefined,
);
