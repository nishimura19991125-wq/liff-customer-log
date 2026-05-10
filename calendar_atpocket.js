/* =========================================================
 * @pocket Portal — 工事カレンダー（月表示）
 * SaaS: アットポケット（Web API は /apps/...）。レコード編集 URL は一覧 API の accessEditUrl に準拠。
 * データ元: アプリ「工事登録アプリ」
 *  - 日付: 見出し「施工予定日」
 *  - 住宅ステータス（4区分+その他）/ 工事空枠。新築・産業用は4日程見出しで日付表示
 *  - メーカー行の下の行に備考トグル（工事登録の備考）。本文が空なら非表示
 *  - 工事報告（T番号突合）: 同じTの複数行のうちいずれかが期待と一致で✅。報告内容が「残工」なら【残工】以外のチップ先頭に【延期】（新築・産業用・残工日チップは除く）
 *  - 月切替「工事未定案件登録」→ @pocket の新規レコード画面（URL 末尾 …/records/create。CONFIG.RECORD_NEW_URL_TEMPLATE で上書き可）
 * ========================================================= */
(function () {
  "use strict";

  const CONFIG = {
    /** 工事登録アプリ（@pocket のアプリ名と一致させる） */
    APP_NAME: "工事登録アプリ",

    /**
     * 工事報告アプリ（T番号で工事登録と突合。見出し「報告内容」が所定文ならチップに✅。「残工」なら【残工】以外のチップに【延期】／新築・産業用・残工日チップは【延期】しない）
     * 新築・産業: 4日程行ごと（仕込完了等）。それ以外: 完工。取得失敗時は✅非表示
     */
    REPORT_APP_NAME: "工事報告",

    WIDGET_ID: "ap-calendar-root-v1",
    STYLEDOM_ID: "ap-calendar-style-v66",

    /** 空なら全ポータルページ。特定ページにだけ出す場合はページIDを入れる */
    PAGE_ID: "",

    /** 追加で「祝日」扱いする日（自社休みなど）: ["YYYY-MM-DD", ...] */
    EXTRA_HOLIDAYS: [],

    /**
     * true: 前後が祝日に挟まれた「国民の休日」も祝色（赤）に含める
     * false: 公衆の法定的休日＋振替＋日曜・土曜のみ色分け（見た目は一般的なカレンダーに近い）
     */
    INCLUDE_SANDWICH_NATIONAL_HOLIDAY: false,

    /**
     * フィールド uniqueId。空なら下記キーワード / 主要見出し名の完全一致で自動検出
     * （施工予定日・お客様名の見出し名が違う場合はここに入れると確実）
     */
    FIELD_OVERRIDES: {
      title: "",         // お客様名
      contractor: "",    // 施工会社（お客様名が空の行の表示に使用）
      housingStatus: "", // 住宅ステータス（新築案件・既築案件・トラーチ倶楽部案件・産業用案件）
      shigumi: "",        // 仕込日（新築/産業用の4日程用）
      panelWork: "",     // パネル工事日
      electricWork: "",  // 電気工事日
      appSettingsDay: "", // アプリ設定日
      startDate: "",     // 施工予定日
      endDate: "",       // 任意
      memo: "",          // 任意
      tNumber: "",         // T番号（工事報告のT番号と同じキーで突合）
      /** 入力ステータスが「残工」のときだけ残工日をカレンダーに出す（見出し名が違う場合は uniqueId 指定） */
      inputStatus: "",
      zankoDay: "",      // 残工日
      manufacturer: "",  // メーカー（2行目は『』内にフル表記）
      panelCapacity: "", // パネル容量 kW（2行目: …kW）
      batteryCapacity: "", // 蓄電池容量 kWh（2行目: …kWh）
    },

    /** 工事報告アプリ用 FIELD_OVERRIDES（T番号・報告内容の uniqueId。空なら見出し名で検出） */
    REPORT_FIELD_OVERRIDES: {
      tNumber: "",
      reportContent: "", // 報告内容
    },

    /**
     * レコード編集の URL。空のときは一覧 API が返す accessEditUrl を使います（推奨）。
     * 取れない場合だけプレースホルダ: "/apps/{appId}/record/{recordId}/edit" 等（自環境のパスに合わせる）
     */
    RECORD_EDIT_URL_TEMPLATE: "",

    /**
     * 「レコード追加」画面の URL。`{appId}` を差し替えます（工事登録アプリ＝APP_NAME）。
     * 空のときは accessEditUrl から推測（@pocket の画面は一覧が …/records?viewType=… 、新規作成は …/records/create）。
     */
    RECORD_NEW_URL_TEMPLATE: "",

    /**
     * 部分一致。同一アプリ内で誤爆する場合は FIELD_OVERRIDES に uniqueId を指定
     * 日付は「施工予定日」を最優先（解決は見出し完全一致 → 下記の順）
     */
    FIELD_KEYWORDS: {
      title: ["お客様名", "顧客名", "顧客", "件名", "施主", "名"],
      contractor: ["施工会社", "施工者", "施工店", "工務店", "工務店名", "施工店名", "施工元", "業者"],
      startDate: ["施工予定日", "予定日", "着工日", "工事日", "日付"],
      endDate: ["終了日", "完工日", "期日", "〆", "〆日"],
      memo: ["メモ", "内容", "備考", "詳細"],
      housingStatus: ["住宅ステータス", "住宅 ステータス", "住ステ"],
      shigumi: ["仕込日", "しごみ"],
      panelWork: ["パネル工事日", "パネル"],
      electricWork: ["電気工事日", "電気工事"],
      appSettingsDay: ["アプリ設定日", "アプリ設定"],
      /** 部分一致。パネルは「パネル工事日」と曖昧に重ならないよう「パネル容量」優先 */
      manufacturer: ["メーカー"],
      panelCapacity: ["パネル容量"],
      batteryCapacity: ["蓄電池容量", "蓄電池"],
      inputStatus: ["入力ステータス"],
      zankoDay: ["残工日"],
    },

    PAGE_LIMIT: 1000,
    MAX_PAGES_SAFETY: 200,
  };

  function apiPromise(path, method, params) {
    return new Promise(function (resolve, reject) {
      atPocket.api(path, method, params || {}, function (result) {
        resolve(result);
      }, function (err) {
        reject(err);
      });
    });
  }

  async function getAppIdByName(appName) {
    const res = await apiPromise("/apps/forms", "GET", { name: appName, page: 1, limit: 1000 });
    const forms = (res && res.forms) ? res.forms : [];
    var hit = forms.find(function (f) { return f && f.name === appName; });
    if (!hit) hit = forms[0];
    if (!hit || typeof hit.id === "undefined") throw new Error("APP_NOT_FOUND");
    return hit.id;
  }

  async function getFields(appId) {
    const res = await apiPromise("/apps/" + appId + "/fields", "GET", { page: 1, limit: 1000 });
    return (res && res.fields) ? res.fields : [];
  }

  function getCurrentPageIdSafe() {
    try {
      if (atPocket && atPocket.portal && typeof atPocket.portal.getPageId === "function") {
        const pid = atPocket.portal.getPageId();
        if (pid !== null && pid !== undefined && String(pid) !== "") return String(pid);
      }
    } catch (e) {}
    try {
      const p = String(window.location && window.location.pathname ? window.location.pathname : "");
      var m = p.match(/\/pages\/(\d+)/);
      if (m) return String(m[1]);
      m = p.match(/\/page\/(\d+)/);
      if (m) return String(m[1]);
    } catch (e) {}
    try {
      const q = new URLSearchParams(window.location && window.location.search ? window.location.search : "");
      const pid = q.get("pageId") || q.get("page") || q.get("p");
      if (pid) return String(pid);
    } catch (e) {}
    return "";
  }

  function pickFieldUniqueId(fields, keywords) {
    if (!Array.isArray(fields)) return "";
    const lowered = (keywords || []).map(function (k) { return String(k).toLowerCase(); });
    for (var i = 0; i < fields.length; i++) {
      const f = fields[i];
      const cap = (f && f.caption) ? String(f.caption) : "";
      const capL = cap.toLowerCase();
      if (lowered.some(function (k) { return k && capL.indexOf(k) >= 0; })) return f.uniqueId || "";
    }
    return "";
  }

  function pickFieldUniqueIdByExactCaption(fields, caption) {
    if (!Array.isArray(fields) || !caption) return "";
    const target = String(caption).trim().toLowerCase();
    for (var i = 0; i < fields.length; i++) {
      const f = fields[i];
      const cap = (f && f.caption) ? String(f.caption).trim().toLowerCase() : "";
      if (cap && cap === target) return f.uniqueId || "";
    }
    return "";
  }

  function extractValue(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return raw;
    if (Array.isArray(raw)) {
      const parts = raw.map(extractValue).filter(function (x) {
        return x !== null && x !== undefined && String(x).trim() !== "";
      });
      return parts.join(", ");
    }
    if (typeof raw === "object") {
      if ("value" in raw) return raw.value;
      if ("name" in raw) return raw.name;
      if ("label" in raw) return raw.label;
      if ("text" in raw) return raw.text;
      try { return JSON.stringify(raw); } catch (e) { return String(raw); }
    }
    return String(raw);
  }

  function parseDate(raw) {
    const v = extractValue(raw);
    if (!v) return null;
    const s = String(v).trim();
    if (!s) return null;
    var t = s.replace(/\//g, "-");
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) t = t + "T00:00:00";
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : d;
  }

  function ymdKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  }

  function addDays(d, n) {
    const x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }

  /**
   * 春分の日（3月）·秋分の日（9月）— 内閣府公布日（2010年版〜 概ね）
   * 年範囲外は欠番（該年の春分/秋分祝のみスキップ）
   */
  var SHUNBUN_DAY = (function () {
    var t = { 2010: 21, 2011: 20, 2012: 20, 2013: 20, 2014: 20, 2015: 20, 2016: 20, 2017: 20, 2018: 20, 2019: 20, 2020: 20, 2021: 20, 2022: 21, 2023: 21, 2024: 20, 2025: 20, 2026: 20, 2027: 20, 2028: 20, 2029: 20, 2030: 20, 2031: 20, 2032: 20, 2033: 20, 2034: 20, 2035: 20, 2036: 20, 2037: 20, 2038: 20, 2039: 20, 2040: 20, 2041: 20, 2042: 20, 2043: 20, 2044: 20, 2045: 20, 2046: 20, 2047: 20, 2048: 20, 2049: 20, 2050: 20 };
    return t;
  })();
  var SHUUBUN_DAY = (function () {
    var t = { 2010: 23, 2011: 23, 2012: 22, 2013: 23, 2014: 23, 2015: 23, 2016: 22, 2017: 23, 2018: 23, 2019: 23, 2020: 22, 2021: 23, 2022: 23, 2023: 23, 2024: 22, 2025: 23, 2026: 23, 2027: 23, 2028: 22, 2029: 23, 2030: 23, 2031: 23, 2032: 22, 2033: 23, 2034: 23, 2035: 23, 2036: 22, 2037: 23, 2038: 23, 2039: 23, 2040: 22, 2041: 23, 2042: 23, 2043: 23, 2044: 22, 2045: 23, 2046: 23, 2047: 23, 2048: 22, 2049: 23, 2050: 23 };
    return t;
  })();

  function getNthWeekdayInMonth(y, monthIndex, weekday, nth) {
    var firstW = new Date(y, monthIndex, 1).getDay();
    var off = (weekday - firstW + 7) % 7;
    return 1 + off + (nth - 1) * 7;
  }

  function addKeysFromDate(set, y, m, d) {
    if (d < 1) return;
    var last = new Date(y, m + 1, 0).getDate();
    if (d > last) return;
    set.add(ymdKey(new Date(y, m, d, 0, 0, 0, 0)));
  }

  function buildJapanHolidayYmdSet(y) {
    var h = new Set();
    addKeysFromDate(h, y, 0, 1);
    addKeysFromDate(h, y, 0, getNthWeekdayInMonth(y, 0, 1, 2));
    addKeysFromDate(h, y, 1, 11);
    addKeysFromDate(h, y, 1, 23);
    var sp = SHUNBUN_DAY[y];
    if (sp) addKeysFromDate(h, y, 2, sp);
    addKeysFromDate(h, y, 3, 29);
    addKeysFromDate(h, y, 4, 3);
    addKeysFromDate(h, y, 4, 4);
    addKeysFromDate(h, y, 4, 5);
    addKeysFromDate(h, y, 6, getNthWeekdayInMonth(y, 6, 1, 3));
    addKeysFromDate(h, y, 7, 11);
    addKeysFromDate(h, y, 8, getNthWeekdayInMonth(y, 8, 1, 3));
    var au = SHUUBUN_DAY[y];
    if (au) addKeysFromDate(h, y, 8, au);
    addKeysFromDate(h, y, 9, getNthWeekdayInMonth(y, 9, 1, 2));
    addKeysFromDate(h, y, 10, 3);
    addKeysFromDate(h, y, 10, 23);
    (CONFIG.EXTRA_HOLIDAYS || []).forEach(function (k) {
      if (k && String(k).slice(0, 4) === String(y)) h.add(String(k).trim());
    });
    h = applySubstituteHolidays(new Set(h), y);
    if (CONFIG.INCLUDE_SANDWICH_NATIONAL_HOLIDAY) h = applySandwichNationalHolidays(new Set(h), y);
    return h;
  }

  /**
   * 日曜の祝日 → 振替休日
   * 衝突時は「国民の祝日（振替前の固定カレンダー上の日）」のある日まで進める（内閣府取扱いに準拠）。
   * h.has(t) で振替日を飛ばすと、こどもの日（日）→ 振替5/6 のあと 5/5 処理で 5/7 まで延びる誤りになる。
   */
  function applySubstituteHolidays(base, y) {
    var h = new Set(base);
    var fixed = new Set(base);
    var i;
    for (i = 0; i < 2; i++) {
      var copy = Array.from(h);
      copy.forEach(function (key) {
        var p = key.split("-");
        var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 0, 0, 0, 0);
        if (d.getDay() !== 0) return;
        var t = addDays(d, 1);
        var guard = 0;
        while (fixed.has(ymdKey(t)) && guard < 10) {
          t = addDays(t, 1);
          guard += 1;
        }
        h.add(ymdKey(t));
      });
    }
    return h;
  }

  /** 国民の休日（前日・翌日が祝に挟まれた平日）— INCLUDE_SANDWICH_NATIONAL_HOLIDAY 時のみ */
  function applySandwichNationalHolidays(base, y) {
    var h = new Set(base);
    var i;
    for (i = 1; i <= 12; i++) {
      var lastD = new Date(y, i, 0).getDate();
      var di;
      for (di = 1; di <= lastD; di++) {
        var cur = new Date(y, i - 1, di, 0, 0, 0, 0);
        if (cur.getDay() === 0 || cur.getDay() === 6) continue;
        var k = ymdKey(cur);
        if (h.has(k)) continue;
        if (h.has(ymdKey(addDays(cur, -1))) && h.has(ymdKey(addDays(cur, 1)))) h.add(k);
      }
    }
    return h;
  }

  var _holSetCache = {};

  function getJapanHolidayYmdSetForYear(y) {
    const flag = CONFIG.INCLUDE_SANDWICH_NATIONAL_HOLIDAY ? "1" : "0";
    const ck = y + "_" + flag;
    if (_holSetCache[ck]) return _holSetCache[ck];
    _holSetCache[ck] = buildJapanHolidayYmdSet(y);
    return _holSetCache[ck];
  }

  function isJapanPublicOrSubstituteHoliday(date) {
    const k = ymdKey(date);
    if ((CONFIG.EXTRA_HOLIDAYS || []).indexOf(k) >= 0) return true;
    const y = date.getFullYear();
    if (y < 2010 || y > 2050) return false;
    return getJapanHolidayYmdSetForYear(y).has(k);
  }

  /**
   * セル用: 祝日 > 日曜/土曜 > 平日
   * @returns クラス名
   */
  function getDayAccentClass(d) {
    if (isJapanPublicOrSubstituteHoliday(d)) return "apc-cell--hol";
    var w = d.getDay();
    if (w === 0) return "apc-cell--sun";
    if (w === 6) return "apc-cell--sat";
    return "apc-cell--weekday";
  }

  async function fetchAllRecords(appId, fieldIdsCsv) {
    const all = [];
    for (var page = 1; page <= CONFIG.MAX_PAGES_SAFETY; page++) {
      const res = await apiPromise("/apps/" + appId + "/records", "GET", {
        fields: fieldIdsCsv,
        page: page,
        limit: CONFIG.PAGE_LIMIT,
      });
      const recs = (res && res.records) ? res.records : [];
      for (var i = 0; i < recs.length; i++) all.push(recs[i]);
      if (recs.length < CONFIG.PAGE_LIMIT) break;
    }
    return all;
  }

  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    if (attrs) {
      Object.entries(attrs).forEach(function (kv) {
        const k = kv[0];
        const v = kv[1];
        if (k === "class") e.className = v;
        else if (k === "dataset" && v && typeof v === "object") {
          Object.entries(v).forEach(function (d) { e.dataset[d[0]] = d[1]; });
        } else if (k.length >= 2 && k.slice(0, 2) === "on" && typeof v === "function") {
          e.addEventListener(k.substring(2), v);
        } else {
          e.setAttribute(k, v);
        }
      });
    }
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  /** 施工会社（キー1つにつき1色）。下から順に使い、足りない分は HSL 自動色 */
  var CONTRACTOR_COLOR_PALETTE = [
    { bg: "#ecfdf5", bd: "#047857", fg: "#022c22" },
    { bg: "#e0f2fe", bd: "#0369a1", fg: "#0c4a6e" },
    { bg: "#fff7ed", bd: "#c2410c", fg: "#7c2d12" },
    { bg: "#faf5ff", bd: "#7c3aed", fg: "#4c1d95" },
    { bg: "#fef2f2", bd: "#dc2626", fg: "#7f1d1d" },
    { bg: "#f0fdf4", bd: "#16a34a", fg: "#14532d" },
    { bg: "#f5f3ff", bd: "#5b21b6", fg: "#2e1065" },
    { bg: "#ecfeff", bd: "#0891b2", fg: "#164e63" },
    { bg: "#fffbeb", bd: "#b45309", fg: "#78350f" },
    { bg: "#fdf2f8", bd: "#be185d", fg: "#831843" },
    { bg: "#e8f4ff", bd: "#2563eb", fg: "#1e3a8a" },
    { bg: "#f1f5f9", bd: "#64748b", fg: "#0f172a" },
  ];

  var UNSET_CONTRACTOR_KEY = "__UNSET__";

  /** 施工会社キー → 0..(会社数-1) の一対一（同じ名は同じ色、名が違えば違う番号＝違う色） */
  var contractorKeyToPaletteIndex = Object.create(null);

  function contractorKeyForColorLookup(companyName) {
    if (companyName == null) return UNSET_CONTRACTOR_KEY;
    const t = String(companyName).trim();
    return t ? t : UNSET_CONTRACTOR_KEY;
  }

  function rebuildContractorKeyColorMap(allEvents) {
    contractorKeyToPaletteIndex = Object.create(null);
    const M = {};
    const evs = allEvents || [];
    for (var i = 0; i < evs.length; i++) {
      M[contractorKeyFromEvent(evs[i])] = true;
    }
    const keys = sortContractorKeyList(Object.keys(M));
    for (var j = 0; j < keys.length; j++) {
      contractorKeyToPaletteIndex[keys[j]] = j;
    }
  }

  function paletteEntryByIndex(i) {
    if (i < CONTRACTOR_COLOR_PALETTE.length) {
      return CONTRACTOR_COLOR_PALETTE[i];
    }
    const h = (i * 137.508) % 360;
    return {
      bg: "hsl(" + h + ", 62%, 92%)",
      bd: "hsl(" + h + ", 48%, 36%)",
      fg: "hsl(" + h + ", 45%, 15%)",
    };
  }

  function contractorKeyFromEvent(ev) {
    if (!ev) return UNSET_CONTRACTOR_KEY;
    if (ev.contractorNameForColor == null) return UNSET_CONTRACTOR_KEY;
    const s = String(ev.contractorNameForColor).trim();
    return s ? s : UNSET_CONTRACTOR_KEY;
  }

  function sortContractorKeyList(keys) {
    return (keys || []).slice().sort(function (a, b) {
      if (a === UNSET_CONTRACTOR_KEY) return 1;
      if (b === UNSET_CONTRACTOR_KEY) return -1;
      return a.localeCompare(b, "ja");
    });
  }

  function displayNameForContractorKey(key) {
    return key === UNSET_CONTRACTOR_KEY ? "施工会社未設定" : String(key);
  }

  /** 工事一覧の表示名（お客様名）が検索文字列に含まれるか。空の query は全件通過。 */
  function listTitleMatchesQuery(title, query) {
    const q = String(query || "").trim();
    if (!q) return true;
    const t = String(title != null ? title : "");
    if (!t) return false;
    return t.toLowerCase().indexOf(q.toLowerCase()) >= 0;
  }

  /** チップ1行目: ［4日程］【区分】+お客様名＋様。それ以外はお客様名＋様（空枠等は従来どおり） */
  function displayNameLine1OnChip(row) {
    if (!row || row.category === "empty") {
      return String(row && row.title != null ? row.title : "");
    }
    const t = String(row.title != null ? row.title : "");
    const s = t.trim();
    if (s === "" || s === "（空枠）") return t;
    var nameLine = s.endsWith("様") ? t : (t + "様");
    if (row.segmentLabel) {
      return bracketKubunFromSegmentLabel(row.segmentLabel) + nameLine;
    }
    return nameLine;
  }

  /** チップ1行目: displayNameLine1OnChip に加え、報告内容が「残工」なら先頭に【延期】（新築・産業用・残工日チップは付けない） */
  function displayNameLine1OnChipWithReport(row) {
    const base = displayNameLine1OnChip(row);
    if (!row || row.category === "empty") return base;
    const seg = row.segmentLabel != null ? String(row.segmentLabel) : "";
    if (seg === "残工日") return base;
    const hk = row.housingStatusKey;
    if (hk === "新築案件" || hk === "産業用案件") return base;
    if (row.reportPostponed === true) return "【延期】" + base;
    return base;
  }

  /** displayNameLine1OnChipWithReport と同条件で【延期】が付く表示行か（フィルター用） */
  function rowShowsPostponedPrefix(row) {
    if (!row || row.category === "empty") return false;
    const seg = row.segmentLabel != null ? String(row.segmentLabel) : "";
    if (seg === "残工日") return false;
    const hk = row.housingStatusKey;
    if (hk === "新築案件" || hk === "産業用案件") return false;
    return row.reportPostponed === true;
  }

  /** チップ2行目: 『メーカー』 数値kW / 数値kWh 形式（空なら ""） */
  function displayNameLine2OnChip(row) {
    if (!row || row.category === "empty") return "";
    const s = (row.chipSpecLine2 != null && String(row.chipSpecLine2) !== "") ? String(row.chipSpecLine2) : "";
    return s;
  }

  /** ツールチップ・セル title 用（改行区切り） */
  function displayTitleOnChip(row) {
    const a = displayNameLine1OnChipWithReport(row);
    const b = displayNameLine2OnChip(row);
    if (!b) return a;
    return a + "\n" + b;
  }

  function applyContractorPaletteToNode(node, companyName, isEmpty) {
    if (!node || !node.style) return;
    const key = contractorKeyForColorLookup(companyName);
    const idx0 = contractorKeyToPaletteIndex[key];
    const idx = (typeof idx0 === "number" && !isNaN(idx0)) ? idx0 : 0;
    const p = paletteEntryByIndex(idx);
    try {
      node.style.setProperty("background-color", p.bg, "important");
      node.style.setProperty("border-color", p.bd, "important");
      node.style.setProperty("color", p.fg, "important");
      node.style.setProperty("border-width", isEmpty ? "2px" : "1px");
      node.style.setProperty("border-style", isEmpty ? "dashed" : "solid");
    } catch (e) {
      node.style.backgroundColor = p.bg;
      node.style.borderColor = p.bd;
      node.style.color = p.fg;
    }
  }

  function ensureStyleOnce() {
    if (document.getElementById(CONFIG.STYLEDOM_ID)) return;
    const style = document.createElement("style");
    style.id = CONFIG.STYLEDOM_ID;
    style.textContent = [
      "#" + CONFIG.WIDGET_ID + " {",
      "  margin: 12px 0 18px; color: #0f172a; box-sizing: border-box;",
      "  width: 100%; max-width: 100%; min-width: 0;",
      "}",
      "#" + CONFIG.WIDGET_ID + " * { box-sizing: border-box; }",
      "#" + CONFIG.WIDGET_ID + " .apc-card {",
      "  --apc-border: #e2e8f0; --apc-soft: #f8fafc; --apc-muted: #64748b; --apc-accent: #2563eb;",
      "  border: 1px solid var(--apc-border); border-radius: 16px; background: #fff;",
      "  overflow: hidden; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);",
      "  -webkit-font-smoothing: antialiased;",
      "  -moz-osx-font-smoothing: grayscale;",
      "  text-rendering: geometricPrecision;",
      "}",
      "/* 見出し行: ranking_pt_dashboard.js の .apr-head / .apr-btn に合わせる */",
      "#" + CONFIG.WIDGET_ID + " .apc-head {",
      "  padding: 14px 16px; border-bottom: 1px solid var(--apc-border); display: block;",
      "  background: linear-gradient(180deg, rgba(37,99,235,0.08), rgba(255,255,255,1));",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-head__brand { min-width: 0; display: flex; flex-direction: column; gap: 0; width: 100%; }",
      "#" + CONFIG.WIDGET_ID + " .apc-head__top {",
      "  display: flex; flex-direction: row; flex-wrap: nowrap; align-items: center; justify-content: space-between;",
      "  gap: 8px 10px; width: 100%; min-width: 0;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-title {",
      "  font-size: clamp(16px, 0.55rem + 1.35vw, 20px); font-weight: 900; letter-spacing: 0.01em; line-height: 1.25; color: #0f172a; margin: 0;",
      "  flex: 1 1 auto; min-width: 0; text-align: left;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-meta { font-size: clamp(11px, 0.28rem + 0.85vw, 13px); color: var(--apc-muted); line-height: 1.45; }",
      "#" + CONFIG.WIDGET_ID + " .apc-head__brand .apc-meta { margin: 6px 0 0; }",
      "#" + CONFIG.WIDGET_ID + " .apc-head .apc-actions {",
      "  display: flex; flex-direction: row; flex-wrap: nowrap; align-items: center; gap: 8px; flex-shrink: 0;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-card--body-hidden .apc-body { display: none; }",
      "#" + CONFIG.WIDGET_ID + " .apc-btn {",
      "  border: 1px solid var(--apc-border); background: #fff; border-radius: 10px; padding: 8px 14px;",
      "  font-size: 13px; min-height: 36px; cursor: pointer; color: #0f172a;",
      "  transition: background-color .15s, border-color .15s, box-shadow .15s, transform .05s;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-btn--ghost {",
      "  background: #f8fafc; color: #475569; border-color: #e2e8f0; font-weight: 600;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-btn--ghost:hover { background: #f1f5f9; border-color: #cbd5e1; color: #334155; }",
      "#" + CONFIG.WIDGET_ID + " .apc-btn:hover { background: var(--apc-soft); border-color: #cbd5e1; }",
      "#" + CONFIG.WIDGET_ID + " .apc-btn--ghost.apc-btn:hover { background: #f1f5f9; }",
      "#" + CONFIG.WIDGET_ID + " .apc-btn:active { transform: translateY(1px); }",
      "/* ranking_pt_dashboard.js の .apr-btn と同系（見出しの再読み込み・表示/非表示のみ） */",
      "#" + CONFIG.WIDGET_ID + " .apc-btn.apc-btn--toolbar {",
      "  border-radius: 12px; padding: 8px 12px; font-weight: 500;",
      "  box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04);",
      "  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, transform .05s ease;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-btn.apc-btn--toolbar:hover { background: var(--apc-soft); border-color: #cbd5e1; }",
      "#" + CONFIG.WIDGET_ID + " .apc-btn.apc-btn--toolbar:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.25); outline-offset: 2px; }",
      "#" + CONFIG.WIDGET_ID + " .apc-sr-only {",
      "  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; white-space: nowrap;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-filters--panel {",
      "  margin: 0; padding: 11px 14px; border-radius: 12px;",
      "  border: 1px solid #e0e7ff; background: linear-gradient(145deg, #fafbff 0%, #eef2ff 55%, #f8fafc 100%);",
      "  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05);",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-filters__row {",
      "  display: flex; flex-wrap: wrap; align-items: stretch; gap: 10px; margin-top: 2px;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-filters__title--sub {",
      "  margin: 5px 0 4px; font-size: 12px; font-weight: 800; color: #475569; letter-spacing: 0.02em;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-filters__chip-legend {",
      "  margin: 4px 0 7px; padding: 8px 10px; border-radius: 10px;",
      "  background: rgba(255,255,255,0.7); border: 1px solid #e2e8f0;",
      "  font-size: 11px; line-height: 1.5; color: #475569;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-filters__chip-legend__line { margin: 0 0 4px; }",
      "#" + CONFIG.WIDGET_ID + " .apc-filters__chip-legend__line:last-child { margin-bottom: 0; }",
      "#" + CONFIG.WIDGET_ID + " .apc-filters__row--search {",
      "  display: flex; flex-wrap: nowrap; align-items: stretch; gap: 8px; width: 100%; margin-top: 0;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-search {",
      "  flex: 1; min-width: 0; min-height: 36px; padding: 6px 10px; font-size: 14px; border: 1px solid #cbd5e1; border-radius: 10px;",
      "  background: #fff; color: #0f172a; font-family: inherit;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-search::placeholder { color: #94a3b8; font-size: 13px; }",
      "#" + CONFIG.WIDGET_ID + " .apc-search:focus { outline: 2px solid #818cf8; outline-offset: 0; border-color: #a5b4fc; }",
      "#" + CONFIG.WIDGET_ID + " .apc-search-clear { flex-shrink: 0; min-height: 36px; min-width: 4em; font-size: 12px; padding: 6px 10px; }",
      "#" + CONFIG.WIDGET_ID + " .apc-filters__kicker {",
      "  display: block; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: #64748b; margin: 0 0 4px;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-filters__title {",
      "  font-size: 13px; font-weight: 800; color: #0f172a; margin: 0 0 6px; letter-spacing: 0.02em;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-filters__subhead {",
      "  font-size: 12px; font-weight: 700; color: #475569; margin: 2px 0 6px; line-height: 1.3;",
      "}",
      "/* 住宅ステータス見出しと「すべて表示/非表示」を同一行（PC: 左から並べる） */",
      "#" + CONFIG.WIDGET_ID + " .apc-filters__housing-bar {",
      "  display: flex; flex-direction: row; flex-wrap: wrap; align-items: center;",
      "  justify-content: flex-start; gap: 8px 12px; width: 100%; min-width: 0; box-sizing: border-box; margin: 0 0 2px;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-filters__housing-bar .apc-filters__subhead {",
      "  margin: 0; flex: 0 1 auto; min-width: 0; line-height: 1.3;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-filters__housing-bar .apc-filters__cat-actions {",
      "  margin: 0; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-start;",
      "  gap: 6px 8px; flex-shrink: 0;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-filters__housing-bar .apc-filters__cat-actions .apc-btn {",
      "  flex: 0 0 auto; min-width: 0; white-space: nowrap;",
      "}",
      "/* 表示するカテゴリ: 住ステ5 + 追加4 を同一5列グリッドで列揃え */",
      "#" + CONFIG.WIDGET_ID + " .apc-filters__pill-matrix {",
      "  display: grid;",
      "  grid-template-columns: repeat(5, minmax(0, 1fr));",
      "  gap: 8px;",
      "  margin: 0 0 7px;",
      "  width: 100%;",
      "  box-sizing: border-box;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-filters__pill-matrix > .apc-pill--toggle {",
      "  min-width: 0;",
      "  max-width: none;",
      "  width: 100%;",
      "  min-height: 0;",
      "  box-sizing: border-box;",
      "  display: flex;",
      "  flex-direction: column;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-filters__pill-matrix > .apc-pill--toggle .apc-pill__ui {",
      "  flex: 1 1 auto;",
      "  min-height: 62px;",
      "  width: 100%;",
      "  box-sizing: border-box;",
      "  align-items: flex-start;",
      "  padding: 8px 10px;",
      "  gap: 6px;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-filters__pill-matrix > .apc-pill--toggle .apc-pill__text { gap: 3px; }",
      "#" + CONFIG.WIDGET_ID + " .apc-filters__pill-matrix > .apc-pill--toggle .apc-pill__name { font-size: 12.5px; line-height: 1.25; }",
      "#" + CONFIG.WIDGET_ID + " .apc-filters__pill-matrix > .apc-pill--toggle .apc-pill__hint {",
      "  font-size: 9.5px;",
      "  line-height: 1.35;",
      "  font-weight: 600;",
      "  display: -webkit-box;",
      "  -webkit-line-clamp: 3;",
      "  -webkit-box-orient: vertical;",
      "  overflow: hidden;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-pill--toggle {",
      "  position: relative; display: flex; flex: 1; min-width: 0; max-width: 220px; cursor: pointer; border-radius: 12px;",
      "  transition: box-shadow 0.2s, transform 0.1s, border-color 0.2s, background 0.2s;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-pill--toggle:active { transform: scale(0.99); }",
      "#" + CONFIG.WIDGET_ID + " .apc-pill--toggle .apc-pill__ui {",
      "  display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 10px 12px; border-radius: 12px;",
      "  border: 2px solid #cbd5e1; background: #fff; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-pill--on .apc-pill__ui {",
      "  border-color: #4f46e5; background: linear-gradient(180deg, #ffffff 0%, #eef2ff 100%);",
      "  box-shadow: 0 0 0 1px rgba(79, 70, 229, 0.2), 0 4px 12px rgba(79, 70, 229, 0.12);",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-pill--toggle:hover .apc-pill__ui { border-color: #94a3b8; }",
      "#" + CONFIG.WIDGET_ID + " .apc-pill--on:hover .apc-pill__ui { border-color: #6366f1; }",
      "#" + CONFIG.WIDGET_ID + " .apc-pill__mark {",
      "  flex: 0 0 18px; width: 18px; height: 18px; border-radius: 5px; border: 2px solid #94a3b8; margin-top: 1px; background: #fff;",
      "  transition: background 0.15s, border-color 0.15s;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-pill--on .apc-pill__mark {",
      "  border-color: #4f46e5; background: #4f46e5 url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 10'%3E%3Cpath fill='none' stroke='%23fff' stroke-width='2' d='M1 5l3.5 3.5L11 1'/%3E%3C/svg%3E\") center / 10px 8px no-repeat;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-pill__text { min-width: 0; display: flex; flex-direction: column; gap: 1px; }",
      "#" + CONFIG.WIDGET_ID + " .apc-pill__name { font-size: 13px; font-weight: 800; color: #0f172a; line-height: 1.2; }",
      "#" + CONFIG.WIDGET_ID + " .apc-pill__hint { font-size: 10px; font-weight: 600; color: #64748b; line-height: 1.25; }",
      "#" + CONFIG.WIDGET_ID + " .apc-pill--on .apc-pill__name { color: #312e81; }",
      "#" + CONFIG.WIDGET_ID + " .apc-pill--on .apc-pill__hint { color: #5b6398; }",
      "#" + CONFIG.WIDGET_ID + " .apc-corp-legend { margin-top: 10px; padding-top: 10px; border-top: 1px solid #e2e8f0; }",
      "#" + CONFIG.WIDGET_ID + " .apc-corp-legend__title { font-size: 12px; font-weight: 800; color: #334155; margin: 0 0 4px; }",
      "#" + CONFIG.WIDGET_ID + " .apc-corp-legend__hint { font-size: 10px; color: #64748b; margin: 0 0 6px; line-height: 1.35; }",
      "#" + CONFIG.WIDGET_ID + " .apc-corp-legend__row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }",
      "#" + CONFIG.WIDGET_ID + " .apc-corp-legend__actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }",
      "#" + CONFIG.WIDGET_ID + " .apc-corp-legend__actions button { font-size: 11px; padding: 4px 10px; min-height: 28px; }",
      "#" + CONFIG.WIDGET_ID + " .apc-filters__cat-actions { margin: 2px 0 7px; }",
      "#" + CONFIG.WIDGET_ID + " .apc-corp-legend__item {",
      "  display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 8px;",
      "  border: 1px solid #e2e8f0; background: #fff; cursor: pointer; user-select: none; transition: box-shadow 0.15s;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-corp-legend__item:hover { box-shadow: 0 2px 6px rgba(15, 23, 42, 0.06); }",
      "#" + CONFIG.WIDGET_ID + " .apc-corp-legend__item input { width: 14px; height: 14px; flex-shrink: 0; cursor: pointer; accent-color: #4f46e5; }",
      "#" + CONFIG.WIDGET_ID + " .apc-corp-legend__sw { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; box-sizing: border-box; border: 1px solid rgba(0,0,0,0.12); }",
      "#" + CONFIG.WIDGET_ID + " .apc-corp-legend__labeltext { display: inline-flex; align-items: baseline; flex-wrap: wrap; gap: 4px 6px; min-width: 0; flex: 1; }",
      "#" + CONFIG.WIDGET_ID + " .apc-corp-legend__name { font-size: 11px; font-weight: 700; color: #0f172a; max-width: 12em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 1; min-width: 0; }",
      "#" + CONFIG.WIDGET_ID + " .apc-corp-legend__listcount {",
      "  font-size: 10px; font-weight: 700; color: #4f46e5; background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 6px; padding: 1px 6px; white-space: nowrap; flex-shrink: 0; line-height: 1.35;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-corp-legend--empty { font-size: 11px; color: #94a3b8; padding: 4px 0; }",
      "#" + CONFIG.WIDGET_ID + " .apc-nav { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }",
      "#" + CONFIG.WIDGET_ID + " .apc-month-label { min-width: 9em; text-align: center; font-size: clamp(14px, 0.4rem + 1vw, 17px); font-weight: 800; color: #0f172a; }",
      "/* 本文エリア: 余白のリズム。フィルタとカレンダー塊を分ける */",
      "#" + CONFIG.WIDGET_ID + " .apc-body {",
      "  padding: 14px; display: flex; flex-direction: column; gap: 12px; min-width: 0; background: #fff;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-filters--panel { margin: 0; }",
      "#" + CONFIG.WIDGET_ID + " .apc-calendar-section {",
      "  display: flex; flex-direction: column; gap: 8px; min-width: 0;",
      "  padding: 10px 12px 12px; border-radius: 12px; border: 1px solid #e2e8f0; background: #f8fafc;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-area { min-width: 0; width: 100%; }",
      "#" + CONFIG.WIDGET_ID + " .apc-calendar-section > .apc-area > .apc-grid-wrap { border-color: #cbd5e1; background: #f1f5f9; }",
      "#" + CONFIG.WIDGET_ID + " .apc-month-nav {",
      "  display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-month-nav .apc-nav { flex: 1 1 auto; min-width: 0; }",
      "#" + CONFIG.WIDGET_ID + " .apc-month-nav .apc-btn--pending-register {",
      "  flex: 0 1 auto; align-self: center; white-space: nowrap; font-weight: 700;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-grid-wrap { border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background: #f1f5f9; }",
      "/* 曜日行と日付マスを同一 grid に載せ、列幅を常に一致させる（別 grid だと丸め誤差でずれる） */",
      "#" + CONFIG.WIDGET_ID + " .apc-grid-sync {",
      "  display: grid;",
      "  grid-template-columns: repeat(7, minmax(0, 1fr));",
      "  grid-template-rows: auto;",
      "  grid-auto-rows: minmax(68px, auto);",
      "  gap: 1px;",
      "  background: #cbd5e1;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-dow-hd {",
      "  background: #e2e8f0; padding: 6px 4px; font-size: 11px; font-weight: 800;",
      "  text-align: center; color: #334155; border-bottom: 1px solid #94a3b8; box-sizing: border-box;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-dow-hd.apc-dow--sun { color: #b91c1c; background: #fee2e2; }",
      "#" + CONFIG.WIDGET_ID + " .apc-dow-hd.apc-dow--sat { color: #1d4ed8; background: #dbeafe; }",
      "/* 行の高さは中身分まで確保（min-height:0 系の巻取りで2行目が欠けない） */",
      "#" + CONFIG.WIDGET_ID + " .apc-cell { min-height: 0; background: #fff; padding: 4px 4px 5px; position: relative; display: flex; flex-direction: column; align-items: stretch; align-content: flex-start; overflow: visible; }",
      "#" + CONFIG.WIDGET_ID + " .apc-cell--other { background: #f8fafc; color: #94a3b8; }",
      "#" + CONFIG.WIDGET_ID + " .apc-cell--weekday { background: #ffffff; }",
      "#" + CONFIG.WIDGET_ID + " .apc-cell--weekday .apc-daynum { color: #0f172a; font-weight: 800; }",
      "#" + CONFIG.WIDGET_ID + " .apc-cell--today { box-shadow: inset 0 0 0 2px rgba(37,99,235,0.45); }",
      "#" + CONFIG.WIDGET_ID + " .apc-daynum { font-size: 12px; font-weight: 800; line-height: 1.1; margin-bottom: 2px; color: #0f172a; }",
      "#" + CONFIG.WIDGET_ID + " .apc-cell--other .apc-daynum { color: #94a3b8; font-weight: 600; }",
      "#" + CONFIG.WIDGET_ID + " .apc-cell--sun { background: #fff7f7; }",
      "#" + CONFIG.WIDGET_ID + " .apc-cell--sun .apc-daynum { color: #b91c1c; }",
      "#" + CONFIG.WIDGET_ID + " .apc-cell--sat { background: #eff6ff; }",
      "#" + CONFIG.WIDGET_ID + " .apc-cell--sat .apc-daynum { color: #1d4ed8; }",
      "#" + CONFIG.WIDGET_ID + " .apc-cell--hol { background: #fff1f2; }",
      "#" + CONFIG.WIDGET_ID + " .apc-cell--hol .apc-daynum { color: #b91c1c; font-weight: 900; }",
      "#" + CONFIG.WIDGET_ID + " .apc-cell--other.apc-cell--sun { background: #faf5f5; }",
      "#" + CONFIG.WIDGET_ID + " .apc-cell--other.apc-cell--sun .apc-daynum { color: #b91c1c; opacity: 0.7; }",
      "#" + CONFIG.WIDGET_ID + " .apc-cell--other.apc-cell--sat { background: #f3f8ff; }",
      "#" + CONFIG.WIDGET_ID + " .apc-cell--other.apc-cell--sat .apc-daynum { color: #1d4ed8; opacity: 0.7; }",
      "#" + CONFIG.WIDGET_ID + " .apc-cell--other.apc-cell--hol { background: #fef2f2; }",
      "#" + CONFIG.WIDGET_ID + " .apc-cell--other.apc-cell--hol .apc-daynum { color: #b91c1c; opacity: 0.75; }",
      "/* 枠内は中身の最小高を維持（0 にすると1件でも行高が足りず2行目が欠ける） */",
      "#" + CONFIG.WIDGET_ID + " .apc-chips {",
      "  display: flex; flex-direction: column; align-items: stretch; align-content: flex-start; justify-content: flex-start; gap: 2px;",
      "  flex: 1 1 auto; min-height: min-content; max-width: 100%;",
      "  max-height: 220px; overflow-y: auto; overflow-x: hidden;",
      "  -webkit-overflow-scrolling: touch; margin-top: 1px;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-chip__sub {",
      "  display: flex; flex-direction: column; align-items: stretch; align-self: stretch;",
      "  width: 100%; min-width: 0; box-sizing: border-box;",
      "  margin: 0; padding: 1px 0 0; gap: 3px;",
      "  border-top: 1px solid rgba(148,163,184,0.35);",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-chip__spec-row {",
      "  display: flex; flex-direction: row; flex-wrap: nowrap; align-items: center;",
      "  gap: 6px; width: 100%; min-width: 0; box-sizing: border-box;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-chip__spec-row .apc-chip__line2 {",
      "  border-top: none; padding: 0 0 2px; margin: 0;",
      "  flex: 1 1 auto; min-width: 0; width: auto;",
      "  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-chip__memo-row {",
      "  display: flex; flex-direction: row; flex-wrap: nowrap; align-items: center;",
      "  justify-content: flex-start; width: 100%; min-width: 0; box-sizing: border-box;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-chip-memo-host {",
      "  flex: 1 1 auto; margin-left: 0; min-width: 0; width: 100%; max-width: 100%;",
      "  text-align: left;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-chip-memo-host .apc-chip-memo {",
      "  display: block; width: 100%; vertical-align: top; text-align: left;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-chip-memo { margin: 0; padding: 0; box-sizing: border-box; min-width: 0;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-chip-memo > summary.apc-chip-memo__sum {",
      "  cursor: pointer; list-style: none; margin: 0; user-select: none;",
      "  box-sizing: border-box;",
      "  width: 100%;",
      "  min-height: 0;",
      "  min-width: 0;",
      "  padding: 0 0 2px;",
      "  border: none;",
      "  border-radius: 0;",
      "  background: transparent;",
      "  box-shadow: none;",
      "  font-size: 10px; line-height: 1.45; font-weight: 600; color: #334155;",
      "  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;",
      "  text-decoration: none;",
      "  -webkit-tap-highlight-color: rgba(37, 99, 235, 0.12);",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-chip-memo > summary.apc-chip-memo__sum::-webkit-details-marker { display: none; }",
      "#" + CONFIG.WIDGET_ID + " .apc-chip-memo > summary.apc-chip-memo__sum::marker { content: none; }",
      "#" + CONFIG.WIDGET_ID + " .apc-chip-memo > summary.apc-chip-memo__sum:hover { color: #1e293b; text-decoration: none; }",
      "#" + CONFIG.WIDGET_ID + " .apc-chip-memo[open] > summary.apc-chip-memo__sum { color: #334155; text-decoration: none; }",
      "#" + CONFIG.WIDGET_ID + " .apc-chip-memo > summary.apc-chip-memo__sum:focus-visible {",
      "  outline: 2px solid rgba(37, 99, 235, 0.35); outline-offset: 2px; border-radius: 2px;",
      "  text-decoration: none;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-chip-memo-host .apc-chip-memo > summary.apc-chip-memo__sum {",
      "  display: flex; flex-direction: row; flex-wrap: nowrap; align-items: center;",
      "  justify-content: flex-start; gap: 4px;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-chip-memo__tri {",
      "  display: inline-block; flex-shrink: 0;",
      "  font-size: 10px; line-height: 1;",
      "  color: #64748b;",
      "  text-decoration: none;",
      "  transition: transform 0.22s ease, color 0.18s ease;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-chip-memo[open] .apc-chip-memo__tri { transform: rotate(-180deg); color: #64748b; }",
      "#" + CONFIG.WIDGET_ID + " .apc-chip-memo__lbl {",
      "  vertical-align: middle;",
      "  font: inherit;",
      "  letter-spacing: inherit;",
      "  color: inherit;",
      "  text-align: left;",
      "  text-decoration: none;",
      "  flex: 0 1 auto;",
      "  min-width: 0;",
      "  overflow: hidden;",
      "  text-overflow: ellipsis;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-chip-memo__body {",
      "  margin-top: 4px; padding: 8px 10px; border-radius: 6px;",
      "  border: 1px solid #e2e8f0;",
      "  background: #ffffff;",
      "  box-shadow: none;",
      "  font-size: 10px; line-height: 1.45; font-weight: 600; color: #334155;",
      "  white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere;",
      "  max-height: 140px; overflow-y: auto; -webkit-overflow-scrolling: touch;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-chip, #" + CONFIG.WIDGET_ID + " .apc-corp-btn {",
      "  font-size: 10px; line-height: 1.25; border-radius: 5px; padding: 3px 5px 4px; font-weight: 600;",
      "  box-sizing: border-box; width: 100%; min-width: 0;",
      "  display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start;",
      "  min-height: min-content; height: max-content; max-height: none;",
      "  border: 1px solid #cbd5e1; text-align: left; flex: 0 0 auto; flex-shrink: 0; overflow: visible;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-chip__inner {",
      "  display: flex; flex-direction: column; align-items: stretch; width: 100%; min-width: 0; text-align: left !important;",
      "  min-height: min-content; box-sizing: border-box; flex: 0 0 auto; overflow: visible;",
      "}",
      "/* チップは div[role=button]（2行目が <button> のUA枠で切れないよう） */",
      "#" + CONFIG.WIDGET_ID + " .apc-corp-btn {",
      "  font-family: inherit; margin: 0; line-height: 1.25; cursor: pointer; text-align: left !important; user-select: text;",
      "  -webkit-tap-highlight-color: rgba(37, 99, 235, 0.12); transition: filter 0.12s; justify-content: flex-start; align-items: stretch;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-corp-btn:hover { filter: brightness(0.9); }",
      "#" + CONFIG.WIDGET_ID + " .apc-corp-btn:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; }",
      "#" + CONFIG.WIDGET_ID + " .apc-chip__row1 {",
      "  display: flex; align-items: center; justify-content: flex-start; gap: 2px; min-width: 0; width: 100%;",
      "  text-align: left !important; flex: 0 0 auto; min-height: 0; overflow: visible;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-chip__name-text { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }",
      "#" + CONFIG.WIDGET_ID + " .apc-chip__line2 {",
      "  display: block; width: 100%; box-sizing: border-box; min-width: 0;",
      "  align-self: stretch; text-align: left !important; margin: 0; padding: 2px 0 0; border-top: 1px solid rgba(148,163,184,0.35);",
      "  font-size: 10px; line-height: 1.45; font-weight: 600; color: #334155; word-wrap: break-word; overflow-wrap: anywhere; word-break: break-word;",
      "  white-space: normal; max-width: 100%; overflow: visible; flex: 0 0 auto; min-height: min-content; padding-bottom: 2px;",
      "}",
      "#" + CONFIG.WIDGET_ID + " .apc-chip__kanko { flex-shrink: 0; font-size: 11px; line-height: 1; }",
      "#" + CONFIG.WIDGET_ID + " .apc-error { color: #b91c1c; font-size: 13px; padding: 8px 0; }",
      "",
      "/* スマホ専用（~640px）。640px 超のレイアウトは上記のまま。 */",
      "/* 見出し行の横幅・外余白: ranking_pt_dashboard.js の .apr-wrap / .apr-head に合わせる */",
      "@media (max-width: 640px) {",
      "  #" + CONFIG.WIDGET_ID + " { margin: 12px 0 18px; max-width: 100%; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-wrap { max-width: 100%; min-width: 0; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-card { border-radius: 12px; }",
      "  /* 1行目: 見出し左・再読み込み/表示/非表示は右（ranking .apr-head と同じ内側 14px 16px） */",
      "  #" + CONFIG.WIDGET_ID + " .apc-head { padding: 14px 16px; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-head__top { flex-wrap: nowrap; align-items: center; justify-content: flex-start; gap: 6px; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-title { font-size: 16px; text-align: left; flex: 0 1 auto; min-width: 0; margin-right: auto; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-head__brand .apc-meta { font-size: 10px; line-height: 1.45; text-align: left; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-head .apc-actions { width: auto; margin: 0; padding: 0; flex-shrink: 0; gap: 4px; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-head .apc-btn--toolbar { padding: 8px 12px; min-height: 36px; font-size: 13px; white-space: nowrap; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-month-nav { margin: 0 0 6px; gap: 6px; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-month-nav .apc-btn--pending-register {",
      "    flex-basis: 100%; width: 100%; min-height: 44px; font-size: 13px; white-space: normal; text-align: center; line-height: 1.25;",
      "  }",
      "  #" + CONFIG.WIDGET_ID + " .apc-nav {",
      "    display: grid; grid-template-columns: auto 1fr auto; grid-template-rows: auto auto;",
      "    gap: 6px 4px; align-items: center; width: 100%;",
      "  }",
      "  #" + CONFIG.WIDGET_ID + " .apc-nav .apc-btn:nth-child(1) { grid-column: 1; grid-row: 1; min-width: 44px; min-height: 44px; padding: 0 6px; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-nav .apc-month-label { grid-column: 2; grid-row: 1; min-width: 0; width: 100%; font-size: 14px; line-height: 1.2; white-space: normal; display: flex; align-items: center; justify-content: center; padding: 0 4px; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-nav .apc-btn:nth-child(3) { grid-column: 3; grid-row: 1; min-width: 44px; min-height: 44px; padding: 0 6px; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-nav .apc-btn:nth-child(4) { grid-column: 1 / -1; grid-row: 2; width: 100%; min-height: 44px; font-size: 13px; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-body { padding: 10px; gap: 10px; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-calendar-section { padding: 10px; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-btn { -webkit-tap-highlight-color: rgba(37, 99, 235, 0.15); }",
      "  /* 表示するカテゴリ〜施工店: 余白＋チェック箇所は横並び（グリッド） */",
      "  #" + CONFIG.WIDGET_ID + " .apc-filters--panel { margin: 0 0 6px; padding: 7px 9px; border-radius: 10px; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-filters__kicker { font-size: 9px; margin: 0 0 2px; letter-spacing: 0.06em; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-filters__title { font-size: 12px; font-weight: 800; margin: 0 0 3px; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-filters__chip-legend { margin: 3px 0 6px; padding: 7px 9px; font-size: 10px; line-height: 1.45; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-filters__housing-bar { gap: 6px; margin: 0 0 2px; align-items: center; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-filters__housing-bar .apc-filters__subhead { font-size: 10px; margin: 0; line-height: 1.2; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-filters__housing-bar .apc-filters__cat-actions {",
      "    margin: 0; justify-content: flex-end; gap: 4px; flex: 0 0 auto; flex-wrap: wrap;",
      "  }",
      "  #" + CONFIG.WIDGET_ID + " .apc-filters__housing-bar .apc-filters__cat-actions .apc-btn {",
      "    flex: 0 0 auto; min-width: 0; min-height: 34px; font-size: 11px; padding: 4px 8px; white-space: nowrap; touch-action: manipulation;",
      "  }",
      "  /* 表示するカテゴリ: 2列（住ステ5件目は全幅・下段は4ピルが2×2） */",
      "  #" + CONFIG.WIDGET_ID + " .apc-filters__pill-matrix {",
      "    grid-template-columns: repeat(2, minmax(0, 1fr));",
      "    gap: 6px;",
      "    margin: 0 0 6px;",
      "  }",
      "  #" + CONFIG.WIDGET_ID + " .apc-filters__pill-matrix > .apc-pill--toggle:nth-child(5) { grid-column: 1 / -1; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-filters__pill-matrix > .apc-pill--toggle .apc-pill__ui {",
      "    min-height: 0;",
      "    padding: 7px 8px;",
      "    gap: 6px;",
      "    align-items: center;",
      "  }",
      "  #" + CONFIG.WIDGET_ID + " .apc-filters__pill-matrix > .apc-pill--toggle .apc-pill__text { flex-direction: column; align-items: flex-start; gap: 1px; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-filters__pill-matrix > .apc-pill--toggle .apc-pill__name { font-size: 12.5px; line-height: 1.2; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-filters__pill-matrix > .apc-pill--toggle .apc-pill__hint {",
      "    font-size: 8.5px;",
      "    line-height: 1.2;",
      "    -webkit-line-clamp: 2;",
      "    -webkit-box-orient: vertical;",
      "    overflow: hidden;",
      "  }",
      "  #" + CONFIG.WIDGET_ID + " .apc-filters__pill-matrix > .apc-pill--toggle .apc-pill__mark {",
      "    flex: 0 0 16px; width: 16px; height: 16px; margin-top: 0; border-radius: 3px;",
      "  }",
      "  #" + CONFIG.WIDGET_ID + " .apc-filters__row { flex-direction: column; align-items: stretch; gap: 5px; margin-top: 0; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-filters__title--sub { font-size: 10px; margin: 2px 0 2px; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-filters__cat-actions { margin: 2px 0 4px; justify-content: stretch; gap: 4px; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-filters__cat-actions .apc-btn { flex: 1; min-width: 0; min-height: 36px; font-size: 11px; padding: 5px 8px; touch-action: manipulation; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-filters__row--search { flex-direction: row; flex-wrap: nowrap; align-items: stretch; gap: 6px; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-search { min-height: 44px; font-size: 16px; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-search-clear { min-height: 44px; min-width: 4.5em; padding: 8px 10px; touch-action: manipulation; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-pill--toggle { min-width: 0; max-width: none; width: 100%; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-corp-legend { margin-top: 6px; padding-top: 6px; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-corp-legend__title { font-size: 10px; line-height: 1.25; margin: 0 0 1px; font-weight: 800; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-corp-legend__hint { font-size: 9px; margin: 0 0 3px; line-height: 1.3; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-corp-legend__actions { display: flex; flex-wrap: wrap; justify-content: stretch; gap: 4px; margin: 0 0 3px; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-corp-legend__actions .apc-btn { flex: 1; min-width: 0; min-height: 36px; font-size: 11px; padding: 5px 8px; touch-action: manipulation; }",
      "  /* 施工店: 2 列グリッドで横並び */",
      "  #" + CONFIG.WIDGET_ID + " .apc-corp-legend__row {",
      "    display: grid;",
      "    grid-template-columns: repeat(2, minmax(0, 1fr));",
      "    align-content: start;",
      "    gap: 5px;",
      "  }",
      "  #" + CONFIG.WIDGET_ID + " .apc-corp-legend__item {",
      "    padding: 4px 5px; min-height: 0; min-width: 0; align-items: center; border-radius: 6px; gap: 4px;",
      "  }",
      "  #" + CONFIG.WIDGET_ID + " .apc-corp-legend__item input { width: 16px; height: 16px; flex-shrink: 0; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-corp-legend__sw { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-corp-legend__labeltext { min-width: 0; flex: 1; gap: 2px 4px; align-items: center; flex-wrap: nowrap; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-corp-legend__name {",
      "    max-width: 100%; font-size: 11.5px; font-weight: 700; color: #0f172a; flex: 1; min-width: 0;",
      "    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;",
      "  }",
      "  #" + CONFIG.WIDGET_ID + " .apc-corp-legend__listcount { font-size: 9.5px; padding: 1px 4px; line-height: 1.2; border-radius: 3px; flex-shrink: 0; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-corp-legend--empty { font-size: 10px; line-height: 1.35; padding: 2px 0; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-grid-wrap { border-radius: 8px; overflow: hidden; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-grid-sync { grid-auto-rows: minmax(58px, auto); }",
      "  #" + CONFIG.WIDGET_ID + " .apc-dow-hd { font-size: 9px; font-weight: 800; padding: 4px 1px; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-cell { padding: 2px 1px 3px; min-width: 0; overflow: visible; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-daynum { font-size: 10px; margin-bottom: 1px; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-chips { min-height: min-content; max-height: 150px; gap: 2px; touch-action: pan-y; align-items: stretch; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-chip, #" + CONFIG.WIDGET_ID + " .apc-corp-btn {",
      "    font-size: 10px; line-height: 1.25; padding: 2px 3px 3px; border-radius: 4px; min-height: min-content; height: max-content; max-height: none; touch-action: manipulation;",
      "  }",
      "  #" + CONFIG.WIDGET_ID + " .apc-chip__kanko { font-size: 10px; }",
      "  /* 予定チップ: メーカー／容量行は非表示。備考トグルありの下段だけ残す */",
      "  #" + CONFIG.WIDGET_ID + " .apc-chip__sub:not(.apc-chip__sub--memo) { display: none; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-chip__line2 { display: none; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-chip-memo-host { width: 100%; max-width: 100%; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-chip-memo > summary.apc-chip-memo__sum {",
      "    width: 100%;",
      "    min-height: 0;",
      "    min-width: 0;",
      "    padding: 0 0 2px;",
      "    align-items: center;",
      "    justify-content: flex-start;",
      "    touch-action: manipulation;",
      "    text-decoration: none;",
      "  }",
      "  #" + CONFIG.WIDGET_ID + " .apc-chip-memo__lbl { font: inherit; text-align: left; text-decoration: none; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-chip-memo__tri { font-size: 10px; flex-shrink: 0; }",
      "  #" + CONFIG.WIDGET_ID + " .apc-chip-memo__body {",
      "    max-height: 100px; font-size: 10px; line-height: 1.45; font-weight: 600;",
      "    padding: 8px 10px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px;",
      "  }",
      "}",
    ].join("\n");
    document.head.appendChild(style);
  }

  function resolveFieldIds(fields) {
    const o = CONFIG.FIELD_OVERRIDES || {};
    const kw = CONFIG.FIELD_KEYWORDS || {};
    return {
      title: o.title
        || pickFieldUniqueIdByExactCaption(fields, "お客様名")
        || pickFieldUniqueId(fields, kw.title),
      contractor: o.contractor
        || pickFieldUniqueIdByExactCaption(fields, "施工会社")
        || pickFieldUniqueIdByExactCaption(fields, "施工店")
        || pickFieldUniqueIdByExactCaption(fields, "工務店")
        || pickFieldUniqueId(fields, kw.contractor),
      startDate: o.startDate
        || pickFieldUniqueIdByExactCaption(fields, "施工予定日")
        || pickFieldUniqueId(fields, kw.startDate),
      endDate: o.endDate || pickFieldUniqueId(fields, kw.endDate),
      memo: o.memo || pickFieldUniqueId(fields, kw.memo),
      housingStatus: o.housingStatus
        || pickFieldUniqueIdByExactCaption(fields, "住宅ステータス")
        || pickFieldUniqueId(fields, kw.housingStatus || []),
      shigumi: o.shigumi
        || pickFieldUniqueIdByExactCaption(fields, "仕込日")
        || pickFieldUniqueId(fields, kw.shigumi || []),
      panelWork: o.panelWork
        || pickFieldUniqueIdByExactCaption(fields, "パネル工事日")
        || pickFieldUniqueId(fields, kw.panelWork || []),
      electricWork: o.electricWork
        || pickFieldUniqueIdByExactCaption(fields, "電気工事日")
        || pickFieldUniqueId(fields, kw.electricWork || []),
      appSettingsDay: o.appSettingsDay
        || pickFieldUniqueIdByExactCaption(fields, "アプリ設定日")
        || pickFieldUniqueId(fields, kw.appSettingsDay || []),
      tNumber: o.tNumber
        || pickFieldUniqueIdByExactCaption(fields, "T番号")
        || pickFieldUniqueId(fields, ["T番号", "T no", "T No"]),
      manufacturer: o.manufacturer
        || pickFieldUniqueIdByExactCaption(fields, "メーカー")
        || pickFieldUniqueId(fields, kw.manufacturer || ["メーカー"]),
      panelCapacity: o.panelCapacity
        || pickFieldUniqueIdByExactCaption(fields, "パネル容量")
        || pickFieldUniqueId(fields, kw.panelCapacity || ["パネル容量"]),
      batteryCapacity: o.batteryCapacity
        || pickFieldUniqueIdByExactCaption(fields, "蓄電池容量")
        || pickFieldUniqueIdByExactCaption(fields, "蓄電池")
        || pickFieldUniqueId(fields, kw.batteryCapacity || ["蓄電池容量", "蓄電池"]),
      inputStatus: o.inputStatus
        || pickFieldUniqueIdByExactCaption(fields, "入力ステータス")
        || pickFieldUniqueId(fields, kw.inputStatus || ["入力ステータス"]),
      zankoDay: o.zankoDay
        || pickFieldUniqueIdByExactCaption(fields, "残工日")
        || pickFieldUniqueId(fields, kw.zankoDay || ["残工日"]),
    };
  }

  function resolveReportFieldIds(fields) {
    const o = CONFIG.REPORT_FIELD_OVERRIDES || {};
    return {
      tNumber: o.tNumber
        || pickFieldUniqueIdByExactCaption(fields, "T番号")
        || pickFieldUniqueId(fields, ["T番号", "T no", "T No"]),
      reportContent: o.reportContent
        || pickFieldUniqueIdByExactCaption(fields, "報告内容")
        || pickFieldUniqueId(fields, ["報告内容"]),
    };
  }

  function parseNumberFromFieldRaw(raw) {
    if (raw == null) return null;
    const v = extractValue(raw);
    if (v == null) return null;
    if (typeof v === "number" && isFinite(v)) return v;
    const s0 = String(v).replace(/,/g, "").replace(/，/g, "").replace(/\r\n/g, "\n").split("\n")[0].trim();
    const m = s0.match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    const n = parseFloat(m[0]);
    return isNaN(n) ? null : n;
  }

  /** メーカー: 先頭行をそのまま（チップ2行目の『』内表記用） */
  function manufacturerFullFromRaw(raw) {
    if (raw == null) return "";
    const v = extractValue(raw);
    if (v == null) return "";
    const t = String(v).split(/\r?\n/)[0].trim();
    return t;
  }

  /** 小数点以下がすべて0のときは表記を付けない（1 → "1" / 1.2 → "1.2"） */
  function formatNumberOmitAllZeroDecimal(n, maxDecimalPlaces) {
    if (n == null || !isFinite(n)) return "";
    return String(parseFloat(n.toFixed(maxDecimalPlaces)));
  }

  function formatPanelCapKwFromRaw(raw) {
    const n = parseNumberFromFieldRaw(raw);
    if (n == null) return "";
    return formatNumberOmitAllZeroDecimal(n, 3) + "kW";
  }

  function formatBatteryKwhFromRaw(raw) {
    const n = parseNumberFromFieldRaw(raw);
    if (n == null) return "";
    return formatNumberOmitAllZeroDecimal(n, 1) + "kWh";
  }

  /**
   * チップ2行目（例: 『SHARP』 6.16kW / 9.5kWh）
   * メーカーがあるときは『』の直後に半角スペース。kW / kWh は「 / 」区切り（片方のみのときは区切りなし）
   */
  function buildChipSpecLine2(recObj, fids) {
    if (!fids || !recObj) return "";
    const m = fids.manufacturer ? manufacturerFullFromRaw(recObj[fids.manufacturer]) : "";
    const pStr = fids.panelCapacity ? formatPanelCapKwFromRaw(recObj[fids.panelCapacity]) : "";
    const bStr = fids.batteryCapacity ? formatBatteryKwhFromRaw(recObj[fids.batteryCapacity]) : "";
    if (!m && !pStr && !bStr) return "";
    var out = m ? ("『" + m + "』") : "";
    if (pStr && bStr) {
      out += (m ? " " : "") + pStr + " / " + bStr;
    } else if (pStr) {
      out += (m ? " " : "") + pStr;
    } else {
      out += (m ? " " : "") + bStr;
    }
    return out;
  }

  function normalizeTNumberKey(raw) {
    if (raw == null || isBlankDisplayStr(String(raw))) return null;
    return String(raw).replace(/\s+/g, " ").trim();
  }

  /**
   * 新築・産業: 日付行の区分配（buildCalendarSegments のラベル）に応じた「報告内容」期待値。
   * 区分配なし（施工予定日のみ行・その他住ステ等）は 完工
   */
  function expectedReportStatusLabel(segmentLabel) {
    const s = segmentLabel != null && String(segmentLabel) !== "" ? String(segmentLabel) : "";
    if (s === "仕込日") return "仕込完了";
    if (s === "パネル工事日") return "パネル工事完了";
    if (s === "電気工事日") return "電気工事完了";
    if (s === "アプリ設定日") return "アプリ設定完了";
    return "完工";
  }

  /** 見出し「報告内容」の先頭行が expected と一致（プルダウン1行想定） */
  function isReportContentExactMatch(raw, expected) {
    if (expected == null || String(expected) === "") return false;
    if (raw == null) return false;
    const v = extractValue(raw);
    if (v == null) return false;
    const t = String(v).replace(/\r\n/g, "\n").split("\n")[0].replace(/\s+/g, " ").trim();
    return t === String(expected);
  }

  /** 工事登録「入力ステータス」の先頭行が「残工」と一致（報告内容と同じ正規化） */
  function isInputStatusZanko(raw) {
    return isReportContentExactMatch(raw, "残工");
  }

  /** 工事登録「入力ステータス」の先頭行が「新規」と一致 */
  function isInputStatusShinki(raw) {
    return isReportContentExactMatch(raw, "新規");
  }

  /**
   * 同一Tの工事報告のうち、見出し「報告内容」の先頭行が「残工」と一致するものがあるか
   */
  function evHasReportPostponed(ev) {
    if (!ev || ev.category !== "list") return false;
    const list = ev._reportContentRaws;
    if (!list || !list.length) return false;
    for (var zi = 0; zi < list.length; zi++) {
      if (isReportContentExactMatch(list[zi], "残工")) return true;
    }
    return false;
  }

  /**
   * 同一T番号の工事報告が複数ある場合、いずれかの「報告内容」が期待値なら✅。
   * いっぺんが「残工」でも、他レコードが完工等なら✅（その他のレコードで条件を満たす場合）
   */
  function rowMatchesReportKanko(ev, segmentLabel) {
    if (!ev || ev.category !== "list") return false;
    const expected = expectedReportStatusLabel(segmentLabel);
    const list = ev._reportContentRaws;
    if (!list || !list.length) return false;
    for (var ri = 0; ri < list.length; ri++) {
      if (isReportContentExactMatch(list[ri], expected)) return true;
    }
    return false;
  }

  /** T番号ごとに工事報告レコードの「報告内容」を配列で保持（同じTで複数行をまとめる） */
  function buildTNumberToReportContentMap(records, rf) {
    const m = new Map();
    if (!rf || !rf.tNumber || !rf.reportContent) return m;
    for (var i = 0; i < (records || []).length; i++) {
      const rec = records[i];
      const recObj = rec && rec.record ? rec.record : rec;
      if (!recObj) continue;
      const tRaw = extractValue(recObj[rf.tNumber]);
      const k = normalizeTNumberKey(tRaw);
      if (!k) continue;
      const cRaw = recObj[rf.reportContent];
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(cRaw);
    }
    return m;
  }

  function attachReportContentFromTNumberMap(ev, tnumToContent) {
    if (!ev) return;
    ev._reportContentRaws = null;
    if (ev.category !== "list" || !tnumToContent || typeof tnumToContent.get !== "function") return;
    if (!ev.tNumberKey) return;
    const v = tnumToContent.get(ev.tNumberKey);
    if (v == null) {
      ev._reportContentRaws = [];
    } else {
      ev._reportContentRaws = Array.isArray(v) ? v.slice() : [v];
    }
  }

  function getRecordIdFromListItem(rec) {
    if (!rec) return null;
    if (rec.recordId != null && rec.recordId !== "") return rec.recordId;
    if (rec.id != null && rec.id !== "") return rec.id;
    return null;
  }

  function getAccessEditUrlFromListItem(rec) {
    if (!rec || rec.accessEditUrl == null) return "";
    return String(rec.accessEditUrl).trim();
  }

  function resolveRecordEditUrl(row, appId) {
    if (row && row.accessEditUrl) return String(row.accessEditUrl).trim();
    if (!row || row.recordId == null || appId == null) return "";
    const t = (CONFIG.RECORD_EDIT_URL_TEMPLATE || "").trim();
    if (!t) return "";
    return t.replace(/\{appId\}/g, String(appId)).replace(/\{recordId\}/g, String(row.recordId));
  }

  function navigateToRecordEdit(url) {
    if (!url) return;
    try {
      window.location.assign(url);
    } catch (e) {
      try { window.location.href = url; } catch (e2) {}
    }
  }

  /** REST 形式 …/record(s)/{レコードID}(/edit) を …/record(s)/create に（@pocket の「+ 新規作成」と同じ末尾） */
  function deriveRestStyleRecordNewFromEdit(editUrl) {
    if (!editUrl) return "";
    var s = String(editUrl).trim();
    if (!s) return "";
    var q = "";
    var qi = s.search(/[?#]/);
    if (qi >= 0) {
      q = s.slice(qi);
      s = s.slice(0, qi);
    }
    s = s.replace(/\/edit\/?$/i, "");
    s = s.replace(/\/+$/, "");
    var m = s.match(/^(.*\/records\/)[^/]+$/i);
    if (m) return m[1] + "create" + q;
    m = s.match(/^(.*\/record\/)[^/]+$/i);
    if (m) return m[1] + "create" + q;
    return "";
  }

  /**
   * accessEditUrl から「レコード追加」画面の URL を推測。
   * @pocket: 一覧は …/records?viewType=… 、新規作成は …/records/create（+ 新規作成ボタンと同じ）。
   * kintone 互換 UI のときだけ …/k/{appId}/edit を使う。
   */
  function deriveRecordCreateUrlFromSampleEdit(editUrl) {
    if (!editUrl) return "";
    var raw = String(editUrl).trim();
    if (!raw) return "";
    var baseHref = "";
    try {
      if (typeof window !== "undefined" && window.location && window.location.href) {
        baseHref = window.location.href;
      }
    } catch (e) {}
    try {
      var u = new URL(raw, baseHref || "http://localhost/");
      var path = u.pathname.replace(/\/+$/, "");
      path = path.replace(/\/edit$/i, "");
      var apRecords = path.match(/^(.*\/apps\/[^/]+\/records\/)[^/]+$/i);
      if (apRecords) {
        u.pathname = apRecords[1] + "create";
        u.hash = "";
        return u.toString();
      }
      var apRecord = path.match(/^(.*\/apps\/[^/]+\/record\/)[^/]+$/i);
      if (apRecord) {
        u.pathname = apRecord[1] + "create";
        u.hash = "";
        return u.toString();
      }
      /* 編集 URL が …/apps/{id}/records のみ（クエリで一覧）に近い場合 */
      var apRecOnly = path.match(/^(.*\/apps\/[^/]+\/records)$/i);
      if (apRecOnly) {
        u.pathname = apRecOnly[1] + "/create";
        u.search = "";
        u.hash = "";
        return u.toString();
      }
      path = u.pathname.replace(/\/+$/, "");
      var km = path.match(/^(.*?\/k\/\d+)(\/.*)?$/);
      if (km) {
        u.pathname = km[1] + "/edit";
        u.hash = "";
        return u.toString();
      }
    } catch (e2) {}
    return deriveRestStyleRecordNewFromEdit(raw);
  }

  /** 工事登録アプリの新規入力へ遷移する URL。sampleAccessEditUrl は一覧の accessEditUrl を1件でもあれば load で保存したもの */
  function resolveRecordNewUrl(appId, sampleAccessEditUrl) {
    if (appId === null || appId === undefined || String(appId).trim() === "") return "";
    const id = String(appId).trim();
    const t = (CONFIG.RECORD_NEW_URL_TEMPLATE || "").trim();
    if (t) return t.replace(/\{appId\}/g, id);
    const derived = deriveRecordCreateUrlFromSampleEdit(sampleAccessEditUrl);
    if (derived) return derived;
    return "/apps/" + encodeURIComponent(id) + "/records/create";
  }

  function isBlankDisplayStr(raw) {
    if (raw === null || raw === undefined) return true;
    return String(raw).replace(/\s/g, "").length === 0;
  }

  /** 見出し「住宅ステータス」の4値。一致しない・空欄は OTHER */
  var HOUSING_STATUS_EXACT = ["新築案件", "既築案件", "トラーチ倶楽部案件", "産業用案件"];
  var HOUSING_STATUS_OTHER = "__HS_OTHER__";

  function resolveHousingStatusKey(raw) {
    if (raw == null || isBlankDisplayStr(String(raw))) return HOUSING_STATUS_OTHER;
    const t = String(raw).replace(/\s+/g, " ").trim();
    for (var i = 0; i < HOUSING_STATUS_EXACT.length; i++) {
      if (t === HOUSING_STATUS_EXACT[i]) return HOUSING_STATUS_EXACT[i];
    }
    for (var j = 0; j < HOUSING_STATUS_EXACT.length; j++) {
      const ex = HOUSING_STATUS_EXACT[j];
      if (t.indexOf(ex) >= 0) return ex;
    }
    return HOUSING_STATUS_OTHER;
  }

  function shortHousingStatusLabel(hk) {
    if (hk == null || hk === HOUSING_STATUS_OTHER) return "その他";
    if (hk === "新築案件") return "新築";
    if (hk === "既築案件") return "既築";
    if (hk === "トラーチ倶楽部案件") return "トラーチ";
    if (hk === "産業用案件") return "産業用";
    return String(hk);
  }

  /** 新築/産業用: 4見出しの日付。空の見出しは含めない */
  function buildCalendarSegmentsForQuadStatus(recObj, fids) {
    if (!fids) return null;
    const out = [];
    const defs = [
      { id: fids.shigumi, L: "仕込日" },
      { id: fids.panelWork, L: "パネル工事日" },
      { id: fids.electricWork, L: "電気工事日" },
      { id: fids.appSettingsDay, L: "アプリ設定日" },
    ];
    for (var i = 0; i < defs.length; i++) {
      if (!defs[i].id) continue;
      const raw = extractValue(recObj[defs[i].id]);
      const pd = parseDate(raw);
      if (pd) out.push({ date: startOfDay(pd), label: defs[i].L });
    }
    return out.length > 0 ? out : null;
  }

  function shortScheduleSegmentLabel(longLabel) {
    const s = String(longLabel || "");
    if (s === "残工日") return "残工";
    if (s === "仕込日") return "仕込";
    if (s === "パネル工事日") return "パネル";
    if (s === "電気工事日") return "電気";
    if (s === "アプリ設定日") return "アプリ";
    return s;
  }

  /** 【】内の表記（例: 電気工事日→「電気工事」） */
  function bracketInnerKoujiSegment(segmentLabel) {
    const s = String(segmentLabel || "");
    if (s === "残工日") return "残工";
    if (s === "仕込日") return "仕込工事";
    if (s === "パネル工事日") return "パネル工事";
    if (s === "電気工事日") return "電気工事";
    if (s === "アプリ設定日") return "アプリ設定";
    return shortScheduleSegmentLabel(s) + "工事";
  }

  function bracketKubunFromSegmentLabel(segmentLabel) {
    const s = String(segmentLabel || "");
    if (s === "残工日") return "【残工】";
    return "【" + bracketInnerKoujiSegment(segmentLabel) + "】";
  }

  function recordToEvent(rec, fids) {
    const recObj = rec && rec.record ? rec.record : {};
    const nameRaw = fids.title ? extractValue(recObj[fids.title]) : null;
    const nameTrim = (nameRaw != null && !isBlankDisplayStr(nameRaw)) ? String(nameRaw).trim() : "";
    const coColorRaw = fids.contractor ? extractValue(recObj[fids.contractor]) : null;
    const coForColor = (coColorRaw != null && !isBlankDisplayStr(coColorRaw)) ? String(coColorRaw).trim() : "";
    var displayTitle;
    var category;
    if (nameTrim.length === 0) {
      category = "empty";
      displayTitle = coForColor || "（空枠）";
    } else {
      category = "list";
      displayTitle = nameTrim;
    }
    const memo = fids.memo ? String(extractValue(recObj[fids.memo]) || "") : "";
    var housingStatusKey = HOUSING_STATUS_OTHER;
    if (category === "list" && fids.housingStatus) {
      const hsRaw = extractValue(recObj[fids.housingStatus]);
      housingStatusKey = resolveHousingStatusKey(hsRaw);
    }
    var calendarSegments = null;
    if (category === "list" && (housingStatusKey === "新築案件" || housingStatusKey === "産業用案件")) {
      calendarSegments = buildCalendarSegmentsForQuadStatus(recObj, fids);
    }
    var start;
    var end;
    if (category === "empty") {
      const sEmpty = parseDate(recObj[fids.startDate]);
      if (!sEmpty) return null;
      start = startOfDay(sEmpty);
      end = fids.endDate ? parseDate(recObj[fids.endDate]) : null;
      if (end) end = startOfDay(end);
      if (end && end.getTime() < start.getTime()) end = null;
    } else {
      if (calendarSegments && calendarSegments.length > 0) {
        const tms = [];
        for (var si = 0; si < calendarSegments.length; si++) {
          tms.push(calendarSegments[si].date.getTime());
        }
        start = startOfDay(new Date(Math.min.apply(null, tms)));
        end = startOfDay(new Date(Math.max.apply(null, tms)));
      } else {
        const s0 = parseDate(recObj[fids.startDate]);
        if (!s0) return null;
        start = startOfDay(s0);
        end = fids.endDate ? parseDate(recObj[fids.endDate]) : null;
        if (end) end = startOfDay(end);
        if (end && end.getTime() < start.getTime()) end = null;
      }
    }
    var tNumberKey = null;
    if (fids.tNumber) {
      const tRaw = extractValue(recObj[fids.tNumber]);
      tNumberKey = normalizeTNumberKey(tRaw);
    }
    var chipSpecLine2 = "";
    if (category === "list") {
      chipSpecLine2 = buildChipSpecLine2(recObj, fids) || "";
    }
    var zankoCalendarSegment = null;
    if (category === "list" && fids.inputStatus && fids.zankoDay && isInputStatusZanko(recObj[fids.inputStatus])) {
      const zankoParsed = parseDate(recObj[fids.zankoDay]);
      if (zankoParsed) zankoCalendarSegment = { date: startOfDay(zankoParsed), label: "残工日" };
    }
    var inputStatusIsShinki = false;
    if (category === "list" && fids.inputStatus && isInputStatusShinki(recObj[fids.inputStatus])) {
      inputStatusIsShinki = true;
    }
    return {
      start: start,
      end: end,
      title: displayTitle,
      memo: memo,
      category: category,
      contractorNameForColor: coForColor,
      housingStatusKey: housingStatusKey,
      calendarSegments: calendarSegments,
      zankoCalendarSegment: zankoCalendarSegment,
      inputStatusIsShinki: inputStatusIsShinki,
      record: rec,
      recordId: getRecordIdFromListItem(rec),
      accessEditUrl: getAccessEditUrlFromListItem(rec),
      tNumberKey: tNumberKey,
      _reportContentRaws: null,
      chipSpecLine2: chipSpecLine2,
    };
  }

  function eventOverlapsMonth(viewYear, viewMonth, ev) {
    if (!ev) return false;
    const monthStart = new Date(viewYear, viewMonth, 1, 0, 0, 0, 0);
    const monthEndEx = new Date(viewYear, viewMonth + 1, 1, 0, 0, 0, 0);
    function dayInViewMonth(d) {
      const d0 = startOfDay(d);
      return d0.getTime() >= monthStart.getTime() && d0.getTime() < monthEndEx.getTime();
    }
    if (ev.zankoCalendarSegment && dayInViewMonth(ev.zankoCalendarSegment.date)) return true;
    if (ev.calendarSegments && ev.calendarSegments.length > 0) {
      for (var si = 0; si < ev.calendarSegments.length; si++) {
        const d0 = startOfDay(ev.calendarSegments[si].date);
        if (d0.getTime() >= monthStart.getTime() && d0.getTime() < monthEndEx.getTime()) return true;
      }
      return false;
    }
    const s0 = startOfDay(ev.start);
    var e0 = ev.end ? startOfDay(ev.end) : s0;
    if (e0.getTime() < s0.getTime()) e0 = s0;
    if (e0.getTime() < monthStart.getTime() || s0.getTime() >= monthEndEx.getTime()) return false;
    return true;
  }

  function listEventHousingInAllowedSet(ev, allowedSet) {
    if (ev.category !== "list" || !allowedSet) return true;
    const hk = ev.housingStatusKey != null ? ev.housingStatusKey : HOUSING_STATUS_OTHER;
    return allowedSet.has(hk);
  }

  function contractorKeysInCalendarMonth(viewYear, viewMonth, allEvents, anyListOn, emptyOn, searchQuery, housingAllowedSet) {
    const M = {};
    const q = String(searchQuery || "").trim();
    const allowH = housingAllowedSet;
    const evs = allEvents || [];
    for (var i = 0; i < evs.length; i++) {
      const ev = evs[i];
      if (ev && ev.category === "empty") { if (!emptyOn) continue; } else { if (!anyListOn) continue; }
      if (ev && ev.category === "list" && !listEventHousingInAllowedSet(ev, allowH)) continue;
      if (q) {
        if (ev.category === "empty") continue;
        if (!listTitleMatchesQuery(ev.title, q)) continue;
      }
      if (!eventOverlapsMonth(viewYear, viewMonth, ev)) continue;
      M[contractorKeyFromEvent(ev)] = true;
    }
    return sortContractorKeyList(Object.keys(M));
  }

  /** お客様名あり＝1件/レコード。住宅ステータス・検索（お客様名）を反映。 */
  function listCaseCountByContractorInMonth(viewYear, viewMonth, allEvents, searchQuery, housingAllowedSet) {
    const q = String(searchQuery || "").trim();
    const allowH = housingAllowedSet;
    const counts = Object.create(null);
    for (var i = 0; i < (allEvents || []).length; i++) {
      const ev = allEvents[i];
      if (!ev || ev.category !== "list") continue;
      if (allowH && !listEventHousingInAllowedSet(ev, allowH)) continue;
      if (q && !listTitleMatchesQuery(ev.title, q)) continue;
      if (!eventOverlapsMonth(viewYear, viewMonth, ev)) continue;
      const k = contractorKeyFromEvent(ev);
      counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
  }

  function eventsForDisplayMonth(viewYear, viewMonth, events) {
    const monthStart = new Date(viewYear, viewMonth, 1, 0, 0, 0, 0);
    const monthEndEx = new Date(viewYear, viewMonth + 1, 1, 0, 0, 0, 0);
    const out = [];
    for (var i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.calendarSegments && ev.calendarSegments.length > 0) {
        for (var sg = 0; sg < ev.calendarSegments.length; sg++) {
          const seg = ev.calendarSegments[sg];
          const d0 = startOfDay(seg.date);
          if (d0.getTime() < monthStart.getTime() || d0.getTime() >= monthEndEx.getTime()) continue;
          out.push({
            dayKey: ymdKey(d0),
            title: ev.title,
            segmentLabel: seg.label,
            memo: ev.memo,
            recordId: ev.recordId,
            accessEditUrl: ev.accessEditUrl,
            category: ev.category,
            contractorNameForColor: ev.contractorNameForColor,
            housingStatusKey: ev.housingStatusKey,
            reportKankoComplete: rowMatchesReportKanko(ev, seg.label),
            reportPostponed: evHasReportPostponed(ev),
            chipSpecLine2: ev.chipSpecLine2 != null ? ev.chipSpecLine2 : "",
            inputStatusIsShinki: ev.inputStatusIsShinki === true,
          });
        }
      } else {
      const s0 = startOfDay(ev.start);
      var e0 = ev.end ? startOfDay(ev.end) : s0;
      if (e0.getTime() < s0.getTime()) e0 = s0;
      if (e0.getTime() < monthStart.getTime() || s0.getTime() >= monthEndEx.getTime()) {
        /* 当月にレンジなし。残工日のみ当月の可能性あり → 下で zanko を試す */
      } else {
      const segStart = s0.getTime() < monthStart.getTime() ? monthStart : s0;
      const segEnd = e0.getTime() >= monthEndEx.getTime() ? addDays(monthEndEx, -1) : e0;
      for (var d = new Date(segStart.getTime()); d.getTime() <= segEnd.getTime(); d = addDays(d, 1)) {
        out.push({
          dayKey: ymdKey(d),
          title: ev.title,
          segmentLabel: "",
          memo: ev.memo,
          recordId: ev.recordId,
          accessEditUrl: ev.accessEditUrl,
          category: ev.category,
          contractorNameForColor: ev.contractorNameForColor,
          housingStatusKey: ev.housingStatusKey,
          reportKankoComplete: rowMatchesReportKanko(ev, ""),
          reportPostponed: evHasReportPostponed(ev),
          chipSpecLine2: ev.chipSpecLine2 != null ? ev.chipSpecLine2 : "",
          inputStatusIsShinki: ev.inputStatusIsShinki === true,
        });
      }
      }
      }
      if (ev.category === "list" && ev.zankoCalendarSegment) {
        const zx = ev.zankoCalendarSegment;
        const dZ = startOfDay(zx.date);
        if (dZ.getTime() >= monthStart.getTime() && dZ.getTime() < monthEndEx.getTime()) {
          out.push({
            dayKey: ymdKey(dZ),
            title: ev.title,
            segmentLabel: zx.label,
            memo: ev.memo,
            recordId: ev.recordId,
            accessEditUrl: ev.accessEditUrl,
            category: ev.category,
            contractorNameForColor: ev.contractorNameForColor,
            housingStatusKey: ev.housingStatusKey,
            reportKankoComplete: rowMatchesReportKanko(ev, zx.label),
            reportPostponed: false,
            chipSpecLine2: ev.chipSpecLine2 != null ? ev.chipSpecLine2 : "",
            inputStatusIsShinki: ev.inputStatusIsShinki === true,
          });
        }
      }
    }
    return out;
  }

  function groupByDayKey(rows) {
    const map = {};
    for (var i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!map[r.dayKey]) map[r.dayKey] = [];
      map[r.dayKey].push(r);
    }
    return map;
  }

  /** セル/ツールチップ用: 完了一致時の表記 */
  function reportKankoCellSuffix(row) {
    if (!row || !row.reportKankoComplete) return "";
    return "（工事報告・" + expectedReportStatusLabel(row.segmentLabel) + "）";
  }

  /** 日セル全体の title（1行目に【区分】・【延期】含む／2行＋報告照合）※残工日チップは【延期】なし */
  function displayTitleForCellTooltip(x) {
    if (!x || !x.title) return "";
    const l1 = displayNameLine1OnChipWithReport(x);
    const l2 = displayNameLine2OnChip(x);
    var body = l1;
    if (l2) body = body + "\n" + l2;
    return body + reportKankoCellSuffix(x);
  }

  /** チップ内：1行目お客様名＋（該当時）✅、メーカー／容量は1行目、その下の行に備考トグル */
  function appendChipNameAndKanko(container, line1, line2, showKanko, kankoCheckTitle, memoPlain) {
    if (!container) return;
    container.textContent = "";
    const inner = el("div", { class: "apc-chip__inner" });
    const row1 = el("span", { class: "apc-chip__row1" });
    row1.appendChild(el("span", { class: "apc-chip__name-text" }, line1));
    if (showKanko) {
      const tip = (kankoCheckTitle != null && String(kankoCheckTitle) !== "")
        ? String(kankoCheckTitle)
        : "工事報告：報告内容と一致";
      row1.appendChild(el("span", { class: "apc-chip__kanko", title: tip }, "✅"));
    }
    inner.appendChild(row1);
    const hasLine2 = line2 != null && String(line2).trim() !== "";
    const hasMemo = memoPlain != null && String(memoPlain) !== "";
    if (hasLine2 || hasMemo) {
      var subCls = "apc-chip__sub";
      if (hasLine2) subCls += " apc-chip__sub--spec";
      if (hasMemo) subCls += " apc-chip__sub--memo";
      const sub = el("div", { class: subCls });
      if (hasLine2) {
        const specRow = el("div", { class: "apc-chip__spec-row" });
        specRow.appendChild(el("span", { class: "apc-chip__line2" }, String(line2)));
        sub.appendChild(specRow);
      }
      if (hasMemo) {
        const memoRow = el("div", { class: "apc-chip__memo-row" });
        const memoHost = el("div", { class: "apc-chip-memo-host" });
        appendMemoDetailsIntoChipSub(memoHost, memoPlain);
        memoRow.appendChild(memoHost);
        sub.appendChild(memoRow);
      }
      inner.appendChild(sub);
    }
    container.appendChild(inner);
  }

  /** チップ下に表示する備考テキスト（空・空白のみなら ""） */
  function chipMemoPlainText(row) {
    if (!row || row.memo == null) return "";
    const s = String(row.memo).replace(/\r\n/g, "\n").trim();
    if (s === "" || isBlankDisplayStr(s)) return "";
    return s;
  }

  /** .apc-chip-memo-host 内に備考 details を追加（クリックは編集に伝播しない） */
  function appendMemoDetailsIntoChipSub(hostEl, memoPlain) {
    if (!hostEl || !memoPlain) return;
    const det = el("details", {
      class: "apc-chip-memo",
      "aria-label": "備考を表示",
    });
    const sum = el("summary", {
      class: "apc-chip-memo__sum",
      title: "工事登録の備考を開く",
    });
    sum.appendChild(el("span", { class: "apc-chip-memo__tri", "aria-hidden": "true" }, "▽"));
    sum.appendChild(el("span", { class: "apc-chip-memo__lbl" }, "備考"));
    const body = el("div", { class: "apc-chip-memo__body" });
    body.textContent = memoPlain;
    det.appendChild(sum);
    det.appendChild(body);
    function stop(e) {
      e.stopPropagation();
    }
    det.addEventListener("click", stop);
    det.addEventListener("keydown", stop);
    hostEl.appendChild(det);
  }

  function buildCalendarGrid(viewYear, viewMonth, dayToItems, appId) {
    const firstDow = new Date(viewYear, viewMonth, 1).getDay();
    const lastDate = new Date(viewYear, viewMonth + 1, 0).getDate();
    const prevLast = new Date(viewYear, viewMonth, 0).getDate();
    const now = new Date();
    const todayKey = ymdKey(now);

    const cells = [];
    var i;
    for (i = 0; i < firstDow; i++) {
      const d = prevLast - firstDow + i + 1;
      cells.push({ type: "other", date: new Date(viewYear, viewMonth - 1, d, 0, 0, 0, 0), inMonth: false });
    }
    for (i = 1; i <= lastDate; i++) {
      cells.push({ type: "in", date: new Date(viewYear, viewMonth, i, 0, 0, 0, 0), inMonth: true });
    }
    var nextFill = 1;
    while (cells.length % 7 !== 0 || cells.length < 42) {
      cells.push({ type: "other", date: new Date(viewYear, viewMonth + 1, nextFill, 0, 0, 0, 0), inMonth: false });
      nextFill += 1;
    }

    const grid = el("div", { class: "apc-grid-wrap" });
    const sync = el("div", { class: "apc-grid-sync" });
    [
      { t: "日", c: "apc-dow--sun" },
      { t: "月", c: "" },
      { t: "火", c: "" },
      { t: "水", c: "" },
      { t: "木", c: "" },
      { t: "金", c: "" },
      { t: "土", c: "apc-dow--sat" }
    ].forEach(function (x) {
      const hdCls = "apc-dow-hd" + (x.c ? " " + x.c : "");
      sync.appendChild(el("span", { class: hdCls, role: "columnheader" }, x.t));
    });
    for (i = 0; i < cells.length; i++) {
      const c = cells[i];
      const k = ymdKey(c.date);
      const isToday = k === todayKey;
      var list = (dayToItems && dayToItems[k]) ? dayToItems[k].slice() : [];
      list.sort(function (a, b) {
        const ta = (a && a.title) ? String(a.title) : "";
        const tb = (b && b.title) ? String(b.title) : "";
        const c0 = ta.localeCompare(tb, "ja");
        if (c0 !== 0) return c0;
        const sa = (a && a.segmentLabel) ? String(a.segmentLabel) : "";
        const sb = (b && b.segmentLabel) ? String(b.segmentLabel) : "";
        return sa.localeCompare(sb, "ja");
      });
      const show = list;
      var acc = getDayAccentClass(c.date);
      if (!c.inMonth && acc === "apc-cell--weekday") acc = "";
      const cell = el("div", {
        class: "apc-cell" + (c.inMonth ? "" : " apc-cell--other") + (isToday && c.inMonth ? " apc-cell--today" : "") + (acc ? " " + acc : ""),
        title: list.map(function (x) {
          if (!x || !x.title) return "";
          return displayTitleForCellTooltip(x);
        }).filter(Boolean).join(" / "),
      });
      cell.appendChild(el("div", { class: "apc-daynum" }, String(c.date.getDate())));
      const ch = el("div", { class: "apc-chips" });
      for (var j = 0; j < show.length; j++) {
        (function (row) {
          const url = resolveRecordEditUrl(row, appId);
          const isEmpty = row && row.category === "empty";
          if (url) {
            const tRaw = String(row && row.title != null ? row.title : "");
            const tLine1 = isEmpty ? tRaw : displayNameLine1OnChipWithReport(row);
            const tLine2 = isEmpty ? "" : displayNameLine2OnChip(row);
            const showKanko = !isEmpty && row.reportKankoComplete === true;
            const kankoCheckTitle = isEmpty
              ? ""
              : ("工事報告：報告内容＝" + expectedReportStatusLabel(row && row.segmentLabel));
            const btn = el("div", {
              class: "apc-chip apc-corp-btn" + (isEmpty ? " apc-chip--empty" : ""),
              role: "button",
              tabindex: "0",
              title: "クリックでレコードを編集" + (isEmpty ? "（空枠）" : "")
                + (!isEmpty && row.segmentLabel ? "｜" + row.segmentLabel : "")
                + (!isEmpty && row.housingStatusKey
                ? "｜" + shortHousingStatusLabel(row.housingStatusKey) : "")
                + (row.contractorNameForColor ? "｜施工: " + row.contractorNameForColor : "")
                + (showKanko ? "｜" + kankoCheckTitle : ""),
            });
            const memoP = chipMemoPlainText(row);
            appendChipNameAndKanko(btn, tLine1, tLine2, showKanko, kankoCheckTitle, memoP);
            applyContractorPaletteToNode(btn, row && row.contractorNameForColor, isEmpty);
            (function (editUrl) {
              function go(e) {
                e.preventDefault();
                e.stopPropagation();
                navigateToRecordEdit(editUrl);
              }
              function onKey(e) {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigateToRecordEdit(editUrl);
                }
              }
              btn.addEventListener("click", go);
              btn.addEventListener("keydown", onKey);
            })(url);
            ch.appendChild(btn);
          } else {
            const tRaw2 = String(row && row.title != null ? row.title : "");
            const tLine1b = isEmpty ? tRaw2 : displayNameLine1OnChipWithReport(row);
            const tLine2b = isEmpty ? "" : displayNameLine2OnChip(row);
            const showKanko2 = !isEmpty && row.reportKankoComplete === true;
            const kankoCheckTitle2 = isEmpty
              ? ""
              : ("工事報告：報告内容＝" + expectedReportStatusLabel(row && row.segmentLabel));
            const div = el("div", {
              class: "apc-chip" + (isEmpty ? " apc-chip--empty" : ""),
              title: (row && row.recordId != null)
                ? ("編集用URLを取得できません（CONFIG.RECORD_EDIT_URL_TEMPLATE または API の accessEditUrl）"
                + (!isEmpty && row.segmentLabel ? "｜" + row.segmentLabel : "")
                + (!isEmpty && row.housingStatusKey ? "｜" + shortHousingStatusLabel(row.housingStatusKey) : "")
                + (showKanko2 ? "｜" + kankoCheckTitle2 : ""))
                : "",
            });
            appendChipNameAndKanko(div, tLine1b, tLine2b, showKanko2, kankoCheckTitle2, chipMemoPlainText(row));
            applyContractorPaletteToNode(div, row && row.contractorNameForColor, isEmpty);
            ch.appendChild(div);
          }
        })(show[j]);
      }
      cell.appendChild(ch);
      sync.appendChild(cell);
    }
    grid.appendChild(sync);
    return grid;
  }

  function boot() {
    ensureStyleOnce();

    if (String(CONFIG.PAGE_ID || "").trim() !== "") {
      if (getCurrentPageIdSafe() !== String(CONFIG.PAGE_ID).trim()) return;
    }

    const top = atPocket.portal.getContentTopSpaceElement();
    if (!top) return;
    if (document.getElementById(CONFIG.WIDGET_ID)) return;

    const root = el("div", { id: CONFIG.WIDGET_ID, class: "apc-wrap" });
    const card = el("div", { class: "apc-card" });
    const head = el("div", { class: "apc-head" });
    const headTop = el("div", { class: "apc-head__top" });
    const actions = el("div", { class: "apc-actions" });
    const refreshBtn = el("button", { class: "apc-btn apc-btn--toolbar", type: "button" }, "再読み込み");
    const bodyToggleBtn = el("button", {
      type: "button",
      class: "apc-btn apc-btn--toolbar apc-body-toggle",
      "aria-expanded": "true",
      "aria-controls": CONFIG.WIDGET_ID + "-body",
      title: "フィルター・カレンダー欄の表示を切り替え",
    }, "非表示");
    const monthNavRow = el("div", { class: "apc-month-nav" });
    const nav = el("div", { class: "apc-nav" });
    const prevBtn = el("button", { class: "apc-btn", type: "button" }, "‹ 前月");
    const nextBtn = el("button", { class: "apc-btn", type: "button" }, "次月 ›");
    const todayBtn = el("button", { class: "apc-btn", type: "button" }, "今月");
    const monthLabel = el("div", { class: "apc-month-label" }, "");
    const pendingRegisterBtn = el("button", {
      type: "button",
      class: "apc-btn apc-btn--toolbar apc-btn--pending-register",
      disabled: true,
      title: "「" + CONFIG.APP_NAME + "」の新規レコード入力を開く",
      "aria-label": CONFIG.APP_NAME + "の新規レコード入力を開く",
    }, "工事未定案件登録");
    nav.appendChild(prevBtn);
    nav.appendChild(monthLabel);
    nav.appendChild(nextBtn);
    nav.appendChild(todayBtn);
    monthNavRow.appendChild(nav);
    monthNavRow.appendChild(pendingRegisterBtn);
    headTop.appendChild(el("div", { class: "apc-title" }, "工事カレンダー"));
    actions.appendChild(refreshBtn);
    actions.appendChild(bodyToggleBtn);
    headTop.appendChild(actions);
    const headBrand = el("div", { class: "apc-head__brand" });
    headBrand.appendChild(headTop);
    headBrand.appendChild(el("div", { class: "apc-meta" },
      CONFIG.APP_NAME + "｜新築・産業用は4日程。他区分は施工予定日。色＝施工会社"
    ));
    head.appendChild(headBrand);
    const body = el("div", { class: "apc-body", id: CONFIG.WIDGET_ID + "-body" });
    const filterBar = el("div", { class: "apc-filters apc-filters--panel" });
    filterBar.appendChild(el("span", { class: "apc-filters__kicker" }, "表示条件"));
    filterBar.appendChild(el("div", { class: "apc-filters__title" }, "表示するカテゴリ"));
    const housingHeadRow = el("div", { class: "apc-filters__housing-bar" });
    housingHeadRow.appendChild(el("div", { class: "apc-filters__subhead" }, "住宅ステータス"));
    filterBar.appendChild(housingHeadRow);
    const pillMatrix = el("div", { class: "apc-filters__pill-matrix" });
    const housingCheckboxes = [];
    const HOUSING_PILL_CFG = [
      { key: "新築案件", name: "新築", hint: "新築案件" },
      { key: "既築案件", name: "既築", hint: "既築案件" },
      { key: "トラーチ倶楽部案件", name: "トラーチ倶楽部", hint: "トラーチ倶楽部案件" },
      { key: "産業用案件", name: "産業用", hint: "産業用案件" },
      { key: HOUSING_STATUS_OTHER, name: "その他", hint: "上記以外・空欄" },
    ];
    for (var hp = 0; hp < HOUSING_PILL_CFG.length; hp++) {
      const cfg = HOUSING_PILL_CFG[hp];
      const cbH = el("input", {
        type: "checkbox",
        class: "apc-sr-only",
        "data-housing-key": cfg.key,
        "aria-label": cfg.name + "（" + cfg.hint + "）を表示",
      });
      cbH.checked = true;
      housingCheckboxes.push(cbH);
      const labelH = el("label", { class: "apc-pill--toggle apc-pill--on" });
      labelH.appendChild(cbH);
      const uiH = el("div", { class: "apc-pill__ui" });
      uiH.appendChild(el("span", { class: "apc-pill__mark", "aria-hidden": "true" }));
      const txtH = el("div", { class: "apc-pill__text" });
      txtH.appendChild(el("span", { class: "apc-pill__name" }, cfg.name));
      txtH.appendChild(el("span", { class: "apc-pill__hint" }, cfg.hint));
      uiH.appendChild(txtH);
      labelH.appendChild(uiH);
      pillMatrix.appendChild(labelH);
    }
    const cbEmpty = el("input", { type: "checkbox", class: "apc-sr-only", "aria-label": "工事空枠を表示" });
    cbEmpty.checked = true;
    const labelEmpty = el("label", { class: "apc-pill--toggle apc-pill--on" });
    labelEmpty.appendChild(cbEmpty);
    const uiEmpty = el("div", { class: "apc-pill__ui" });
    uiEmpty.appendChild(el("span", { class: "apc-pill__mark", "aria-hidden": "true" }));
    const txtEmpty = el("div", { class: "apc-pill__text" });
    txtEmpty.appendChild(el("span", { class: "apc-pill__name" }, "工事空枠"));
    txtEmpty.appendChild(el("span", { class: "apc-pill__hint" }, "お客様名が空欄の案件"));
    uiEmpty.appendChild(txtEmpty);
    labelEmpty.appendChild(uiEmpty);
    pillMatrix.appendChild(labelEmpty);
    const cbZanko = el("input", {
      type: "checkbox",
      class: "apc-sr-only",
      "data-chip-filter": "zanko",
      "aria-label": "【残工】チップ（残工日）を表示",
    });
    cbZanko.checked = true;
    const labelZanko = el("label", { class: "apc-pill--toggle apc-pill--on" });
    labelZanko.appendChild(cbZanko);
    const uiZanko = el("div", { class: "apc-pill__ui" });
    uiZanko.appendChild(el("span", { class: "apc-pill__mark", "aria-hidden": "true" }));
    const txtZanko = el("div", { class: "apc-pill__text" });
    txtZanko.appendChild(el("span", { class: "apc-pill__name" }, "残工"));
    txtZanko.appendChild(el("span", { class: "apc-pill__hint" }, "【残工】・残工日のチップ"));
    uiZanko.appendChild(txtZanko);
    labelZanko.appendChild(uiZanko);
    pillMatrix.appendChild(labelZanko);
    const cbPostponed = el("input", {
      type: "checkbox",
      class: "apc-sr-only",
      "data-chip-filter": "postponed",
      "aria-label": "【延期】が付く日程チップを表示",
    });
    cbPostponed.checked = true;
    const labelPostponed = el("label", { class: "apc-pill--toggle apc-pill--on" });
    labelPostponed.appendChild(cbPostponed);
    const uiPostponed = el("div", { class: "apc-pill__ui" });
    uiPostponed.appendChild(el("span", { class: "apc-pill__mark", "aria-hidden": "true" }));
    const txtPostponed = el("div", { class: "apc-pill__text" });
    txtPostponed.appendChild(el("span", { class: "apc-pill__name" }, "延期"));
    txtPostponed.appendChild(el("span", { class: "apc-pill__hint" }, "【延期】付きの日程チップ"));
    uiPostponed.appendChild(txtPostponed);
    labelPostponed.appendChild(uiPostponed);
    pillMatrix.appendChild(labelPostponed);
    const cbShinki = el("input", {
      type: "checkbox",
      class: "apc-sr-only",
      "data-chip-filter": "shinki",
      "aria-label": "入力ステータスが新規の案件の日程チップを表示",
    });
    cbShinki.checked = true;
    const labelShinki = el("label", { class: "apc-pill--toggle apc-pill--on" });
    labelShinki.appendChild(cbShinki);
    const uiShinki = el("div", { class: "apc-pill__ui" });
    uiShinki.appendChild(el("span", { class: "apc-pill__mark", "aria-hidden": "true" }));
    const txtShinki = el("div", { class: "apc-pill__text" });
    txtShinki.appendChild(el("span", { class: "apc-pill__name" }, "新規"));
    txtShinki.appendChild(el("span", { class: "apc-pill__hint" }, "入力ステータスが新規"));
    uiShinki.appendChild(txtShinki);
    labelShinki.appendChild(uiShinki);
    pillMatrix.appendChild(labelShinki);
    filterBar.appendChild(pillMatrix);
    filterBar.appendChild(el("div", { class: "apc-filters__title apc-filters__title--sub" }, "チップの区分・記号"));
    const chipLegend = el("div", { class: "apc-filters__chip-legend" });
    chipLegend.appendChild(el("div", { class: "apc-filters__chip-legend__line" },
      "【仕込工事】【パネル工事】【電気工事】【アプリ設定】… 新築・産業用の各工事日"));
    chipLegend.appendChild(el("div", { class: "apc-filters__chip-legend__line" },
      "【残工】… 工事登録で入力ステータスが残工の案件の「残工日」（下の「残工」チェックで表示切替）"));
    chipLegend.appendChild(el("div", { class: "apc-filters__chip-legend__line" },
      "【延期】… 工事報告の報告内容が残工のとき、その他の日程チップの先頭に付与（新築・産業用・【残工】チップは除く／下の「延期」チェックで表示切替）"));
    chipLegend.appendChild(el("div", { class: "apc-filters__chip-legend__line" },
      "新規案件… 工事登録で入力ステータスが新規の案件の日程チップ（下の「新規」チェックで表示切替。見た目のラベルは他案件と同じです）"));
    chipLegend.appendChild(el("div", { class: "apc-filters__chip-legend__line" },
      "✅ … 完工案件"));
    filterBar.appendChild(chipLegend);
    const categoryActRow = el("div", { class: "apc-corp-legend__actions apc-filters__cat-actions" });
    const catBtnAll = el("button", { type: "button", class: "apc-btn" }, "すべて表示");
    const catBtnNone = el("button", { type: "button", class: "apc-btn" }, "すべて非表示");
    catBtnAll.addEventListener("click", function () {
      for (var ci = 0; ci < housingCheckboxes.length; ci++) housingCheckboxes[ci].checked = true;
      cbEmpty.checked = true;
      cbZanko.checked = true;
      cbPostponed.checked = true;
      cbShinki.checked = true;
      syncPillClasses();
      render();
    });
    catBtnNone.addEventListener("click", function () {
      for (var cj = 0; cj < housingCheckboxes.length; cj++) housingCheckboxes[cj].checked = false;
      cbEmpty.checked = false;
      cbZanko.checked = false;
      cbPostponed.checked = false;
      cbShinki.checked = false;
      syncPillClasses();
      render();
    });
    categoryActRow.appendChild(catBtnAll);
    categoryActRow.appendChild(catBtnNone);
    housingHeadRow.appendChild(categoryActRow);
    filterBar.appendChild(el("div", { class: "apc-filters__title apc-filters__title--sub" }, "お客様名で探す"));
    const searchRow = el("div", { class: "apc-filters__row apc-filters__row--search" });
    const searchField = el("input", {
      type: "search",
      class: "apc-search",
      placeholder: "お客様名の一部（住ステがオンの案件のみ）",
      "aria-label": "お客様名で部分一致。住宅ステータスをオンにした一覧案件の氏名。空欄で解除",
      autocapitalize: "off",
      autocomplete: "off",
    });
    const searchClear = el("button", { type: "button", class: "apc-btn apc-search-clear" }, "クリア");
    searchRow.appendChild(searchField);
    searchRow.appendChild(searchClear);
    filterBar.appendChild(searchRow);
    const corpSection = el("div", { class: "apc-corp-legend" });
    filterBar.appendChild(corpSection);
    function getHousingAllowedSet() {
      const S = new Set();
      for (var a = 0; a < housingCheckboxes.length; a++) {
        if (housingCheckboxes[a].checked) {
          S.add(housingCheckboxes[a].getAttribute("data-housing-key"));
        }
      }
      return S;
    }
    function isAnyHousingOn() {
      for (var b = 0; b < housingCheckboxes.length; b++) {
        if (housingCheckboxes[b].checked) return true;
      }
      return false;
    }
    function syncPillClasses() {
      for (var si = 0; si < housingCheckboxes.length; si++) {
        const cb = housingCheckboxes[si];
        const lab = cb && cb.closest ? cb.closest("label") : null;
        if (lab) lab.classList.toggle("apc-pill--on", cb.checked);
      }
      labelEmpty.classList.toggle("apc-pill--on", cbEmpty.checked);
      labelZanko.classList.toggle("apc-pill--on", cbZanko.checked);
      labelPostponed.classList.toggle("apc-pill--on", cbPostponed.checked);
      labelShinki.classList.toggle("apc-pill--on", cbShinki.checked);
    }
    const area = el("div", { class: "apc-area" });
    const calendarSection = el("div", { class: "apc-calendar-section" });
    calendarSection.appendChild(monthNavRow);
    calendarSection.appendChild(area);
    body.appendChild(filterBar);
    body.appendChild(calendarSection);
    for (var hx = 0; hx < housingCheckboxes.length; hx++) {
      housingCheckboxes[hx].addEventListener("change", function () { syncPillClasses(); render(); });
    }
    cbEmpty.addEventListener("change", function () { syncPillClasses(); render(); });
    cbZanko.addEventListener("change", function () { syncPillClasses(); render(); });
    cbPostponed.addEventListener("change", function () { syncPillClasses(); render(); });
    cbShinki.addEventListener("change", function () { syncPillClasses(); render(); });
    var searchDebounceT = 0;
    function scheduleSearchRender() {
      if (searchDebounceT) clearTimeout(searchDebounceT);
      searchDebounceT = setTimeout(function () { searchDebounceT = 0; render(); }, 200);
    }
    searchField.addEventListener("input", scheduleSearchRender);
    searchField.addEventListener("search", function () { render(); });
    searchClear.addEventListener("click", function () {
      searchField.value = "";
      try { searchField.focus(); } catch (e) {}
      render();
    });
    card.appendChild(head);
    card.appendChild(body);
    (function (cardNode, showBtn) {
      function setCalendarBodyVisible(show) {
        if (show) {
          cardNode.classList.remove("apc-card--body-hidden");
        } else {
          cardNode.classList.add("apc-card--body-hidden");
        }
        showBtn.setAttribute("aria-expanded", show ? "true" : "false");
        showBtn.textContent = show ? "非表示" : "表示";
      }
      showBtn.addEventListener("click", function (e) {
        e.preventDefault();
        setCalendarBodyVisible(cardNode.classList.contains("apc-card--body-hidden"));
      });
    })(card, bodyToggleBtn);
    root.appendChild(card);
    top.appendChild(root);

    var viewYear = new Date().getFullYear();
    var viewMonth = new Date().getMonth();

    function setMonthLabel() {
      monthLabel.textContent = viewYear + "年 " + (viewMonth + 1) + "月";
    }

    function showError(e) {
      const msg = (e && e.message) ? String(e.message) : String(e);
      area.innerHTML = "";
      area.appendChild(el("div", { class: "apc-error" },
        "読み込みに失敗しました: " + msg
      ));
    }

    var cached = { events: [], fids: null, appId: null, sampleAccessEditUrl: "" };
    var companyShowSet = new Set();
    var lastContractorKeyList = [];

    function rebuildContractorFilterAndLegend() {
      corpSection.classList.remove("apc-corp-legend--empty");
      const anyHousing0 = isAnyHousingOn();
      const emptyOn0 = cbEmpty.checked;
      const yLabel = viewYear;
      const mLabel = viewMonth + 1;
      const monthScopeText = yLabel + "年" + mLabel + "月";
      const allowedH0 = getHousingAllowedSet();
      const q = anyHousing0 ? String(searchField.value || "").trim() : "";
      const keys = contractorKeysInCalendarMonth(viewYear, viewMonth, cached.events, anyHousing0, emptyOn0, q, allowedH0);
      const previousKeys = new Set(lastContractorKeyList);
      const prevShow = new Set(companyShowSet);
      lastContractorKeyList = keys.slice();
      companyShowSet = new Set();
      for (var j = 0; j < keys.length; j++) {
        const k = keys[j];
        if (previousKeys.size === 0) {
          companyShowSet.add(k);
        } else if (previousKeys.has(k)) {
          if (prevShow.has(k)) companyShowSet.add(k);
        } else {
          companyShowSet.add(k);
        }
      }

      while (corpSection.firstChild) corpSection.removeChild(corpSection.firstChild);
      if (keys.length === 0) {
        corpSection.classList.add("apc-corp-legend--empty");
        const emptyMsg = (!anyHousing0 && !emptyOn0)
          ? "表示カテゴリがすべてオフのため、施工会社の凡例はありません。"
          : (q
            ? "「" + q + "」に一致するお客様名の" + monthScopeText + "の予定はありません。文言・他月をご確認ください。"
            : (monthScopeText + "のカレンダーに入っている施工店はありません（日付欄の上の月切替で他月を表示）。"));
        const emptyEl = el("div", { class: "apc-corp-legend--empty" });
        emptyEl.textContent = emptyMsg;
        corpSection.appendChild(emptyEl);
        return;
      }

      const listCounts = anyHousing0
        ? listCaseCountByContractorInMonth(viewYear, viewMonth, cached.events, q, allowedH0)
        : null;
      const title = el("div", { class: "apc-corp-legend__title" });
      title.textContent = "この月の施工店と色（" + monthScopeText + "）" + (q ? " · 絞「" + q + "」" : "");
      const hint = el("p", { class: "apc-corp-legend__hint" },
        anyHousing0
          ? (monthScopeText + "に予定のある施工店だけ表示。紫の「一覧○件」は、住宅ステータス・検索条件を含む工事一覧の月内件数" + (q ? "（氏名の検索に一致）" : "") + "。同一レコード1件。色ぷちは施工会社。お客様名の検索は部分一致。チェックで店ごと表示ON/OFF。")
          : (monthScopeText + "。一覧を見るには、上の「住宅ステータス」を1件以上オンにしてください。色ぷちは施工会社。お客様名検索は住ステがオンのとき有効。件数も同条件。")
      );
      const actRow = el("div", { class: "apc-corp-legend__actions" });
      const btnAll = el("button", { type: "button", class: "apc-btn" }, "すべて表示");
      const btnNone = el("button", { type: "button", class: "apc-btn" }, "すべて非表示");
      function syncCorpCheckboxes() {
        const inps = corpSection.querySelectorAll("input.apc-corp-ck");
        for (var s = 0; s < inps.length; s++) {
          const inp = inps[s];
          const k = inp.getAttribute("data-corp-key");
          if (k != null) inp.checked = companyShowSet.has(k);
        }
      }
      btnAll.addEventListener("click", function () {
        for (var a = 0; a < keys.length; a++) companyShowSet.add(keys[a]);
        syncCorpCheckboxes();
        render();
      });
      btnNone.addEventListener("click", function () {
        companyShowSet = new Set();
        syncCorpCheckboxes();
        render();
      });
      actRow.appendChild(btnAll);
      actRow.appendChild(btnNone);
      corpSection.appendChild(title);
      corpSection.appendChild(hint);
      corpSection.appendChild(actRow);
      const row = el("div", { class: "apc-corp-legend__row" });
      for (j = 0; j < keys.length; j++) {
        (function (key) {
          const displayName = displayNameForContractorKey(key);
          const n = (listCounts && listCounts[key] != null) ? listCounts[key] : 0;
          const label = el("label", { class: "apc-corp-legend__item" });
          const sw = el("div", { class: "apc-corp-legend__sw" });
          applyContractorPaletteToNode(sw, key === UNSET_CONTRACTOR_KEY ? null : key, false);
          const nameRow = el("span", { class: "apc-corp-legend__labeltext" });
          nameRow.appendChild(el("span", { class: "apc-corp-legend__name", title: displayName }, displayName));
          if (anyHousing0) {
            nameRow.appendChild(el("span", {
              class: "apc-corp-legend__listcount",
              title: monthScopeText + "内の、住ステ・検索条件に合う一覧件数。同一レコード＝1件。",
            }, "一覧" + n + "件"));
          }
          const ariaShow = "「" + displayName + "」を" + (anyHousing0 ? "表示（一覧" + n + "件·この月）" : "表示");
          const ck = el("input", {
            type: "checkbox",
            class: "apc-corp-ck",
            "data-corp-key": key,
            "aria-label": ariaShow,
          });
          ck.checked = companyShowSet.has(key);
          ck.addEventListener("change", function () {
            if (ck.checked) companyShowSet.add(key);
            else companyShowSet.delete(key);
            render();
          });
          label.appendChild(ck);
          label.appendChild(sw);
          label.appendChild(nameRow);
          row.appendChild(label);
        })(keys[j]);
      }
      corpSection.appendChild(row);
    }

    function render() {
      rebuildContractorKeyColorMap(cached.events);
      rebuildContractorFilterAndLegend();
      const anyH = isAnyHousingOn();
      const emptyOn = cbEmpty.checked;
      const allowedHR = getHousingAllowedSet();
      const qR = (anyH && String(searchField.value || "").trim()) ? String(searchField.value).trim() : "";
      const filtered = (cached.events || []).filter(function (ev) {
        if (ev && ev.category === "empty") {
          if (!emptyOn) return false;
        } else {
          if (!anyH) return false;
          if (ev.category === "list" && !listEventHousingInAllowedSet(ev, allowedHR)) return false;
        }
        if (qR) {
          if (ev.category === "empty") return false;
          if (!listTitleMatchesQuery(ev.title, qR)) return false;
        }
        const k = contractorKeyFromEvent(ev);
        return companyShowSet.has(k);
      });
      const rowsAll = eventsForDisplayMonth(viewYear, viewMonth, filtered);
      const showZankoChip = cbZanko.checked;
      const showPostponedChip = cbPostponed.checked;
      const showShinkiChip = cbShinki.checked;
      const rows = [];
      for (var ri = 0; ri < rowsAll.length; ri++) {
        const rw = rowsAll[ri];
        if (!showZankoChip && String(rw.segmentLabel || "") === "残工日") continue;
        if (!showPostponedChip && rowShowsPostponedPrefix(rw)) continue;
        if (!showShinkiChip && rw.inputStatusIsShinki === true) continue;
        rows.push(rw);
      }
      const byDay = groupByDayKey(rows);
      setMonthLabel();
      var newUrl = resolveRecordNewUrl(cached.appId, cached.sampleAccessEditUrl);
      pendingRegisterBtn.disabled = !newUrl;
      area.innerHTML = "";
      area.appendChild(buildCalendarGrid(viewYear, viewMonth, byDay, cached.appId));
    }

    function fetchReportTNumberMap() {
      const name = String(CONFIG.REPORT_APP_NAME || "").trim();
      if (!name) return Promise.resolve(new Map());
      return getAppIdByName(name)
        .then(function (reportId) {
          return getFields(reportId).then(function (rfList) {
            const rf = resolveReportFieldIds(rfList);
            if (!rf.tNumber || !rf.reportContent) return new Map();
            return fetchAllRecords(reportId, [rf.tNumber, rf.reportContent].join(",")).then(function (recs) {
              return buildTNumberToReportContentMap(recs, rf);
            });
          });
        })
        .catch(function () {
          return new Map();
        });
    }

    function load() {
      return getAppIdByName(CONFIG.APP_NAME)
        .then(function (id) { return getFields(id).then(function (fields) { return { id: id, fields: fields }; }); })
        .then(function (pack) {
          const fids = resolveFieldIds(pack.fields);
          if (!fids.startDate) throw new Error("「施工予定日」に相当するフィールドを特定できません。見出し名を確認するか FIELD_OVERRIDES.startDate（uniqueId）を指定してください。");
          const need = [
            fids.startDate, fids.title, fids.contractor, fids.housingStatus,
            fids.shigumi, fids.panelWork, fids.electricWork, fids.appSettingsDay,
            fids.endDate, fids.memo, fids.tNumber,
            fids.manufacturer, fids.panelCapacity, fids.batteryCapacity,
            fids.inputStatus, fids.zankoDay,
          ].filter(Boolean);
          return fetchAllRecords(pack.id, need.join(",")).then(function (records) {
            return fetchReportTNumberMap().then(function (tnumToReportContent) {
              const events = [];
              var sampleAccessEditUrl = "";
              for (var r = 0; r < records.length; r++) {
                var su = getAccessEditUrlFromListItem(records[r]);
                if (su && !sampleAccessEditUrl) sampleAccessEditUrl = su;
                const ev = recordToEvent(records[r], fids);
                if (ev) {
                  attachReportContentFromTNumberMap(ev, tnumToReportContent);
                  events.push(ev);
                }
              }
              cached = {
                events: events,
                fids: fids,
                appId: pack.id,
                sampleAccessEditUrl: sampleAccessEditUrl,
              };
              render();
            });
          });
        });
    }

    prevBtn.addEventListener("click", function () {
      if (viewMonth === 0) { viewMonth = 11; viewYear -= 1; } else { viewMonth -= 1; }
      render();
    });
    nextBtn.addEventListener("click", function () {
      if (viewMonth === 11) { viewMonth = 0; viewYear += 1; } else { viewMonth += 1; }
      render();
    });
    todayBtn.addEventListener("click", function () {
      const t = new Date();
      viewYear = t.getFullYear();
      viewMonth = t.getMonth();
      render();
    });
    pendingRegisterBtn.addEventListener("click", function (e) {
      e.preventDefault();
      var nu = resolveRecordNewUrl(cached.appId, cached.sampleAccessEditUrl);
      if (nu) navigateToRecordEdit(nu);
    });
    refreshBtn.addEventListener("click", function () { load().catch(showError); });

    setMonthLabel();
    area.appendChild(el("div", { class: "apc-meta" }, "読み込み中…"));
    load().catch(showError);
  }

  atPocket.events.on("portal.index.show", function () {
    boot();
  });
})();
