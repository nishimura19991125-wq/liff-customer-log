/* =========================================================
 * @pocket Portal (Top) - Sales/PT Ranking Dashboard
 * Data source app: "※直接入力禁止　PT集計表"
 *
 * Period modes:
 *  - 各月（YYYY年M月で選択）
 *  - 四半期（3月起算・2月締め / 3-5, 6-8, 9-11, 12-2）
 *  - 期間指定累計（開始月・終了月を月単位で選択）
 *  - 累計（全期間）
 *
 * Production (Netlify LINE ボットは netlify/lib/clRankingAtpocket が参照):
 *   設定はリポジトリ直下の ranking_pt_dashboard.config.js のみ（ダッシュボードと本番で同一ファイル）。
 *
 * @pocket:
 *   読み込み順: ranking_pt_dashboard.config.js → ranking_pt_dashboard.js。
 *   設定だけ差し替える場合は config ファイルのみ入れ替えればよいです。
 *
 * Counting rule:
 *  - 契約件数はアプリ「1.契約情報入力フォーム」の見出し「CL担当者」がランキングの担当者名と一致するレコードを、見出し「初回契約日」（自動選択時キーワード先頭・以下日付フォールバックあり）により月別化し選択した対象月で集計した件数
 * ========================================================= */
(function () {
  "use strict";

  /* =========================
   * 0) Config
   *
   * 設定値はランタイムでは globalThis.APP_RANKING_DASHBOARD_CONFIG のみを参照します。
   * ─ 編集先: ranking_pt_dashboard.config.js を「このファイルより前」に読み込み（@pocket で差し替えるのもこの1本）
   * ========================= */
  const gt = typeof globalThis !== "undefined" ? globalThis : undefined;
  const CONFIG = gt && gt.APP_RANKING_DASHBOARD_CONFIG ? gt.APP_RANKING_DASHBOARD_CONFIG : null;
  if (!CONFIG) {
    console.error(
      "[PTランキング] CONFIG がありません。ranking_pt_dashboard.config.js を ranking_pt_dashboard.js より先に読み込んでください。",
    );
    return;
  }

  /* =========================
   * 1) Helpers: API
   * ========================= */
  function apiPromise(path, method, params) {
    return new Promise((resolve, reject) => {
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
    let hit = forms.find(f => f && f.name === appName);
    if (!hit) hit = forms[0];
    if (!hit || typeof hit.id === "undefined") throw new Error("APP_NOT_FOUND");
    return hit.id;
  }

  async function getFields(appId) {
    const res = await apiPromise(`/apps/${appId}/fields`, "GET", { page: 1, limit: 1000 });
    return (res && res.fields) ? res.fields : [];
  }

  function getCurrentPageIdSafe() {
    // 1) official helper (if exists)
    try {
      if (atPocket && atPocket.portal && typeof atPocket.portal.getPageId === "function") {
        const pid = atPocket.portal.getPageId();
        if (pid !== null && pid !== undefined && String(pid) !== "") return String(pid);
      }
    } catch (e) {}

    // 2) URL parsing fallback
    try {
      const p = String(window.location && window.location.pathname ? window.location.pathname : "");
      // common patterns: /portal/.../pages/123 or /pages/123
      let m = p.match(/\/pages\/(\d+)/);
      if (m) return String(m[1]);
      m = p.match(/\/page\/(\d+)/);
      if (m) return String(m[1]);
    } catch (e) {}

    // 3) query string fallback
    try {
      const q = new URLSearchParams(window.location && window.location.search ? window.location.search : "");
      const pid = q.get("pageId") || q.get("page") || q.get("p");
      if (pid) return String(pid);
    } catch (e) {}

    return "";
  }

  function pickFieldUniqueId(fields, keywords) {
    if (!Array.isArray(fields)) return "";
    const lowered = (keywords || []).map(k => String(k).toLowerCase());
    for (const f of fields) {
      const cap = (f && f.caption) ? String(f.caption) : "";
      const capL = cap.toLowerCase();
      if (lowered.some(k => k && capL.includes(k))) return f.uniqueId || "";
    }
    return "";
  }

  function pickFieldUniqueIdByExactCaption(fields, caption) {
    if (!Array.isArray(fields) || !caption) return "";
    const target = String(caption).trim().toLowerCase();
    for (const f of fields) {
      const cap = (f && f.caption) ? String(f.caption).trim().toLowerCase() : "";
      if (cap && cap === target) return f.uniqueId || "";
    }
    return "";
  }

  /** 商談データ・商談実施数の期間フィルタ用（APO_FIELD_OVERRIDES.meetingDate または見出し完全一致「初回商談実施日」） */
  function pickApoFirstMeetingDateFieldId(apoFields, apoOver) {
    const over = apoOver || CONFIG.APO_FIELD_OVERRIDES || {};
    if (over.meetingDate) return over.meetingDate;
    return pickFieldUniqueIdByExactCaption(apoFields, "初回商談実施日") || "";
  }

  /**
   * アポ取得情報連携の見出し「AP担当者」フィールドの uniqueId（AP残玉数・集計のAP紐づけ用）。
   * 1) 手動 APO_FIELD_OVERRIDES.salesperson
   * 2) 見出し名完全一致（APO_SALESPERSON_EXACT_CAPTIONS → 「AP担当者」等）
   * 3) 厳密キーワード部分一致
   * 4) 従来の広いキーワード（誤って CL担当者 になるのを防ぐため 1〜3 を先に行う）
   */
  function pickApoAppSalespersonFieldId(apoFields) {
    const o = CONFIG.APO_FIELD_OVERRIDES || {};
    if (o.salesperson) return o.salesperson;
    const exactList = (CONFIG.APO_SALESPERSON_EXACT_CAPTIONS && CONFIG.APO_SALESPERSON_EXACT_CAPTIONS.length)
      ? CONFIG.APO_SALESPERSON_EXACT_CAPTIONS
      : ["AP担当者", "AP 担当者"];
    for (let i = 0; i < exactList.length; i++) {
      const eid = pickFieldUniqueIdByExactCaption(apoFields, exactList[i]);
      if (eid) return eid;
    }
    const strict = CONFIG.APO_SALESPERSON_STRICT_KEYWORDS;
    if (Array.isArray(strict) && strict.length) {
      const sid = pickFieldUniqueId(apoFields, strict);
      if (sid) return sid;
    }
    const kw = CONFIG.APO_FIELD_KEYWORDS || {};
    return pickFieldUniqueId(apoFields, kw.salesperson);
  }

  function getFieldByUniqueId(fields, uniqueId) {
    if (!Array.isArray(fields) || !uniqueId) return null;
    return fields.find((f) => f && String(f.uniqueId || "") === String(uniqueId)) || null;
  }

  /** PT・契約の登録番号突合用（空白正規化・大文字統一） */
  function normalizeRegNoForLinkage(v) {
    return String(extractValue(v) ?? "").trim().replace(/\s+/g, "").toUpperCase();
  }

  /** 契約フォームから APPT登録番号／CLPT登録番号フィールドの uniqueId を取得 */
  function pickContractRegNoFieldIds(contractFields) {
    const to = CONFIG.CONTRACT_FORM_FIELD_OVERRIDES || {};
    const kw = CONFIG.CONTRACT_FORM_FIELD_KEYWORDS || {};
    if (!Array.isArray(contractFields)) return { apptRegNo: "", clptRegNo: "" };
    const apCandidates = [...(kw.apptRegNo || ["APPT登録番号"])];
    const clCandidates = [...(kw.clptRegNo || ["CLPT登録番号"])];
    const apptRegNo =
      (to.apptRegNo !== undefined && to.apptRegNo !== "") ? to.apptRegNo
      : (pickFieldUniqueIdByExactCaption(contractFields, "APPT登録番号")
        || pickFieldUniqueId(contractFields, apCandidates));
    const clptRegNo =
      (to.clptRegNo !== undefined && to.clptRegNo !== "") ? to.clptRegNo
      : (pickFieldUniqueIdByExactCaption(contractFields, "CLPT登録番号")
        || pickFieldUniqueId(contractFields, clCandidates));
    return { apptRegNo, clptRegNo };
  }

  /** 契約フォーム・見出し「顧客氏名」を優先（対象レコード表示用） */
  function pickContractCustomerNameFieldId(contractFields) {
    const to = CONFIG.CONTRACT_FORM_FIELD_OVERRIDES || {};
    const kw = CONFIG.CONTRACT_FORM_FIELD_KEYWORDS || {};
    if (!Array.isArray(contractFields)) return "";
    if (to.customerName !== undefined && to.customerName !== "") return to.customerName;
    const exact = pickFieldUniqueIdByExactCaption(contractFields, "顧客氏名");
    if (exact) return exact;
    return pickFieldUniqueId(contractFields, kw.customerName || ["顧客氏名", "お客様名"]);
  }

  /** 契約フォーム・CLPT 紐付け行の「AP担当」表示用（見出し「AP担当者」を優先） */
  function pickContractApPersonFieldId(contractFields) {
    const to = CONFIG.CONTRACT_FORM_FIELD_OVERRIDES || {};
    const kw = CONFIG.CONTRACT_FORM_FIELD_KEYWORDS || {};
    if (!Array.isArray(contractFields)) return "";
    if (to.apPerson !== undefined && to.apPerson !== "") return to.apPerson;
    const exact = pickFieldUniqueIdByExactCaption(contractFields, "AP担当者");
    if (exact) return exact;
    return pickFieldUniqueId(contractFields, kw.apPerson || ["AP担当者", "AP 担当者"]);
  }

  /**
   * 契約情報入力フォームのレコードから登録番号→レコード配列の索引を構築
   * （同一キーが複数行あればすべて保持）
   */
  function buildContractFormRegNoIndex(contractRecords, apptRegNoId, clptRegNoId) {
    const byAppt = new Map();
    const byClpt = new Map();
    for (const rec of contractRecords || []) {
      const recObj = rec && rec.record ? rec.record : {};
      if (apptRegNoId) {
        const k = normalizeRegNoForLinkage(recObj[apptRegNoId]);
        if (k) {
          if (!byAppt.has(k)) byAppt.set(k, []);
          byAppt.get(k).push(rec);
        }
      }
      if (clptRegNoId) {
        const k = normalizeRegNoForLinkage(recObj[clptRegNoId]);
        if (k) {
          if (!byClpt.has(k)) byClpt.set(k, []);
          byClpt.get(k).push(rec);
        }
      }
    }
    return { byAppt, byClpt };
  }

  /** 対象レコード表示用・契約1件ぶんを整形 */
  function buildContractLinkedDetailRow(contractRec, linkageFm, taxMode, ctx) {
    const recObj = contractRec && contractRec.record ? contractRec.record : {};
    const isExcludeTax = (taxMode || "exclude") === "exclude";
    const salesDisplay = (s) => isExcludeTax ? Math.floor(Number(s || 0) / 1.1) : Number(s || 0);
    let dateStr = "";
    if (linkageFm.date) {
      const d = parseDate(recObj[linkageFm.date]);
      if (d) {
        dateStr = fmtYMDSlash(d);
      } else {
        const raw = String(extractValue(recObj[linkageFm.date]) ?? "").trim();
        dateStr = raw ? raw.replace(/-/g, "/") : "";
      }
    }
    const dutyKind = ctx && ctx.dutyKind === "ap" ? "ap" : "cl";
    const dutyCaption = dutyKind === "ap" ? "AP担当" : "CL担当";
    let dutyName = "";
    if (dutyKind === "ap") {
      dutyName = linkageFm.apPerson ? String(extractValue(recObj[linkageFm.apPerson]) || "").trim() : "";
    } else {
      dutyName = linkageFm.clPerson ? String(extractValue(recObj[linkageFm.clPerson]) || "").trim() : "";
    }
    return {
      detailKind: "contract",
      date: dateStr || "(日付なし)",
      introductionRoute: linkageFm.introductionRoute
        ? String(extractValue(recObj[linkageFm.introductionRoute]) || "").trim() : "",
      customerName: linkageFm.customerName
        ? String(extractValue(recObj[linkageFm.customerName]) || "").trim() : "",
      contractSalesDisplay: linkageFm.sales ? salesDisplay(parseNumber(extractValue(recObj[linkageFm.sales]))) : 0,
      dutyCaption,
      dutyName,
      apptRegOnForm: linkageFm.apptRegNo ? String(extractValue(recObj[linkageFm.apptRegNo]) || "").trim() : "",
      clptRegOnForm: linkageFm.clptRegNo ? String(extractValue(recObj[linkageFm.clptRegNo]) || "").trim() : "",
      ptFromPtSheet: ctx.ptSheet,
      salesFromPtSheet: ctx.salesSheet,
      ptRegNo: ctx.ptRegNo,
      linkLabel: ctx.linkLabel,
    };
  }

  async function fetchAllRecords(appId, fieldIdsCsv) {
    const all = [];
    for (let page = 1; page <= CONFIG.MAX_PAGES_SAFETY; page++) {
      const res = await apiPromise(`/apps/${appId}/records`, "GET", {
        fields: fieldIdsCsv,
        page,
        limit: CONFIG.PAGE_LIMIT,
      });
      const recs = (res && res.records) ? res.records : [];
      all.push(...recs);
      if (recs.length < CONFIG.PAGE_LIMIT) break;
    }
    return all;
  }

  /* =========================
   * 2) Value parsing
   * ========================= */
  function extractValue(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return raw;

    if (Array.isArray(raw)) {
      const parts = raw.map(extractValue).filter(x => x !== null && x !== undefined && String(x).trim() !== "");
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

  function parseNumber(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return isFinite(v) ? v : 0;
    const s = String(v).replace(/,/g, "").trim();
    if (!s) return 0;
    const n = Number(s);
    return isFinite(n) ? n : 0;
  }

  function normalizePersonName(v) {
    return String(v ?? "").trim();
  }

  function parseDate(raw) {
    const v = extractValue(raw);
    if (!v) return null;
    const s = String(v).trim();
    if (!s) return null;

    let t = s.replace(/\//g, "-");
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) t = t + "T00:00:00";
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : d;
  }

  function fmtYMD(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
  }

  /** 対象レコードなど・契約日の表示（yyyy/mm/dd） */
  function fmtYMDSlash(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}/${m}/${da}`;
  }

  /* =========================
   * 3) Period builders
   * ========================= */
  function scanMinMaxDate(records, dateFieldId) {
    let min = null, max = null;
    for (const r of records || []) {
      const recObj = r && r.record ? r.record : {};
      const d = parseDate(recObj[dateFieldId]);
      if (!d) continue;
      if (!min || d.getTime() < min.getTime()) min = d;
      if (!max || d.getTime() > max.getTime()) max = d;
    }
    return { min, max };
  }

  function buildMonthOptions(minDate, maxDate) {
    const opts = [];
    if (!minDate || !maxDate) return opts;

    const first = new Date(minDate.getFullYear(), minDate.getMonth(), 1, 0, 0, 0, 0);
    const last = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1, 0, 0, 0, 0);

    let cur = new Date(last.getTime());
    while (cur.getTime() >= first.getTime()) {
      const y = cur.getFullYear();
      const m = cur.getMonth() + 1;
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const label = `${y}年${m}月`;
      const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
      const end = new Date(y, m, 1, 0, 0, 0, 0);
      opts.push({ key, label, start, end });
      cur = new Date(y, m - 2, 1, 0, 0, 0, 0);
    }
    return opts;
  }

  /** 月選択の初期値: 当月が候補にあれば当月。なければ当月以前で最も新しい月。それもなければ先頭（従来どおり最新月） */
  function pickDefaultMonthKeyFromOptions(monthOptions) {
    if (!monthOptions || !monthOptions.length) return "";
    const now = new Date();
    const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (monthOptions.some((o) => o.key === curKey)) return curKey;
    for (const o of monthOptions) {
      if (o.key <= curKey) return o.key;
    }
    return monthOptions[0].key;
  }

  function fiscalYearFromDate(d) {
    // Fiscal year starts in March and ends in February.
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    return (m >= 3) ? y : (y - 1);
  }

  function quarterStartForDate(d) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    if (m <= 2) return new Date(y - 1, 11, 1, 0, 0, 0, 0); // Dec of previous year
    if (m <= 5) return new Date(y, 2, 1, 0, 0, 0, 0);       // Mar
    if (m <= 8) return new Date(y, 5, 1, 0, 0, 0, 0);       // Jun
    if (m <= 11) return new Date(y, 8, 1, 0, 0, 0, 0);      // Sep
    return new Date(y, 11, 1, 0, 0, 0, 0);                  // Dec
  }

  function quarterIndexFromStartMonth(sm) {
    if (sm === 3) return 1;
    if (sm === 6) return 2;
    if (sm === 9) return 3;
    return 4; // 12
  }

  function quarterRangeLabel(sm) {
    if (sm === 3) return "3-5";
    if (sm === 6) return "6-8";
    if (sm === 9) return "9-11";
    return "12-2";
  }

  function buildQuarterOptions(minDate, maxDate) {
    const opts = [];
    if (!minDate || !maxDate) return opts;

    const minQ = quarterStartForDate(minDate);
    let cur = quarterStartForDate(maxDate);

    while (cur.getTime() >= minQ.getTime()) {
      const y = cur.getFullYear();
      const sm = cur.getMonth() + 1; // 3/6/9/12
      const fy = fiscalYearFromDate(cur);
      const q = quarterIndexFromStartMonth(sm);
      const key = `${y}-${String(sm).padStart(2, "0")}`; // quarter start key
      const start = new Date(y, sm - 1, 1, 0, 0, 0, 0);
      const end = new Date(y, sm - 1 + 3, 1, 0, 0, 0, 0);
      const label = `${fy}年度Q${q}（${quarterRangeLabel(sm)}）`;
      opts.push({ key, label, start, end });

      cur = new Date(y, sm - 1 - 3, 1, 0, 0, 0, 0);
    }

    return opts;
  }

  function buildFiscalYearOptions(minDate, maxDate) {
    const opts = [];
    if (!minDate || !maxDate) return opts;

    const minFY = fiscalYearFromDate(minDate);
    const maxFY = fiscalYearFromDate(maxDate);

    for (let fy = maxFY; fy >= minFY; fy--) {
      // Fiscal year: March (fy) -> Feb (fy+1), end-exclusive at next Mar 1
      const start = new Date(fy, 2, 1, 0, 0, 0, 0);
      const end = new Date(fy + 1, 2, 1, 0, 0, 0, 0);
      // Overlap check with [minDate, maxDate]
      if (end.getTime() <= minDate.getTime()) continue;
      if (start.getTime() > maxDate.getTime()) continue;

      const label = `${fy}年度（${fy}年3月〜${fy + 1}年2月）`;
      opts.push({ key: String(fy), label, start, end });
    }

    return opts;
  }

  /** 月曜始まり・日曜締めの週のMonday日付を取得 */
  function getMondayOfWeek(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const day = x.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const diff = day === 0 ? 6 : day - 1;
    x.setDate(x.getDate() - diff);
    return x;
  }

  /**
   * CLペースメーカー用: 基準日（当日または月末）
   */
  function resolveAsOfDateForSelectedMonth(periodStart, periodEndExclusive, now) {
    const lastDay = new Date(periodEndExclusive.getTime() - 1);
    const lastDayDate = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const selKey = `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, "0")}`;
    const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (selKey > curKey) return null;
    if (selKey < curKey) return lastDayDate;
    return today.getTime() > lastDayDate.getTime() ? lastDayDate : today;
  }

  /** CLペースメーカー: 1か月＝常に4週。経過週＝その月の日数を4分割した区間に基づく（1〜4） */
  function getClMonthPacemakerWeekContext(periodStart, periodEndExclusive, now) {
    const lastDay = new Date(periodEndExclusive.getTime() - 1);
    const daysInMonth = lastDay.getDate();
    const asOf = resolveAsOfDateForSelectedMonth(periodStart, periodEndExclusive, now);
    const weeksInMonth = 4;
    let weeksElapsed = 0;
    if (asOf && daysInMonth > 0) {
      const dayOfMonth = asOf.getDate();
      weeksElapsed = Math.min(4, Math.max(1, Math.ceil((dayOfMonth * 4) / daysInMonth)));
    }
    return { weeksInMonth, weeksElapsed, asOf };
  }

  /**
   * 汎用: CLペースメーカー用の週コンテキストを作る
   * - weeksInMonth は「その期間の週数」を意味する（実装都合で既存のキー名を踏襲）
   * - weeksElapsed は月/四半期/期毎/期間指定の「経過週数」
   */
  function getClPacemakerWeekContextForPeriod(periodStart, periodEndExclusive, now, weeksInPeriod) {
    if (!periodStart || !periodEndExclusive || !weeksInPeriod) return null;

    const endInclusive = new Date(periodEndExclusive.getTime() - 1);
    const startMid = new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate());
    const endMid = new Date(endInclusive.getFullYear(), endInclusive.getMonth(), endInclusive.getDate());
    const asOfMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (asOfMid.getTime() < startMid.getTime()) {
      return { weeksInMonth: weeksInPeriod, weeksElapsed: 0, asOf: null };
    }
    if (asOfMid.getTime() >= endMid.getTime()) {
      return { weeksInMonth: weeksInPeriod, weeksElapsed: weeksInPeriod, asOf: endMid };
    }

    const msDay = 24 * 60 * 60 * 1000;
    const totalDays = Math.floor((endMid.getTime() - startMid.getTime()) / msDay) + 1;
    const elapsedDays = Math.floor((asOfMid.getTime() - startMid.getTime()) / msDay) + 1;
    if (totalDays <= 0 || elapsedDays <= 0) return { weeksInMonth: weeksInPeriod, weeksElapsed: 0, asOf: null };

    const weeksElapsed = Math.min(
      weeksInPeriod,
      Math.max(1, Math.ceil((elapsedDays * weeksInPeriod) / totalDays))
    );
    return { weeksInMonth: weeksInPeriod, weeksElapsed, asOf: asOfMid };
  }

  function buildWeekOptions(minDate, maxDate) {
    const opts = [];
    if (!minDate || !maxDate) return opts;

    let cur = getMondayOfWeek(maxDate);
    const minMonday = getMondayOfWeek(minDate);

    while (cur.getTime() >= minMonday.getTime()) {
      const mon = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), 0, 0, 0, 0);
      const key = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, "0")}-${String(mon.getDate()).padStart(2, "0")}`;
      const endExclusive = new Date(mon.getTime());
      endExclusive.setDate(endExclusive.getDate() + 7);
      const sun = new Date(endExclusive.getTime() - 1);
      const label = `${mon.getFullYear()}年${mon.getMonth() + 1}/${mon.getDate()}〜${sun.getMonth() + 1}/${sun.getDate()}`;
      opts.push({ key, label, start: mon, end: endExclusive });
      cur.setDate(cur.getDate() - 7);
    }
    return opts;
  }

  /**
   * 各表彰集計表の週の既定: 開いた日を含む週（月曜始まり）の週キー。候補にない場合は最も近い週に寄せる。
   */
  function pickDefaultAwardsWeekKey(weekOptions) {
    if (!weekOptions || !weekOptions.length) return "";
    const now = new Date();
    const thisMon = getMondayOfWeek(now);
    const targetKey = `${thisMon.getFullYear()}-${String(thisMon.getMonth() + 1).padStart(2, "0")}-${String(thisMon.getDate()).padStart(2, "0")}`;
    if (weekOptions.some((w) => w.key === targetKey)) return targetKey;
    let best = "";
    for (const w of weekOptions) {
      if (w.key <= targetKey && w.key > best) best = w.key;
    }
    if (best) return best;
    for (const w of weekOptions) {
      if (w.key >= targetKey) return w.key;
    }
    return weekOptions[0].key;
  }

  function buildPeriodFromWeekKey(weekOptions, weekKey) {
    const hit = (weekOptions || []).find(x => x.key === weekKey);
    if (!hit) return null;
    const sun = new Date(hit.end.getTime() - 1);
    return {
      key: `week:${hit.key}`,
      label: "週",
      start: hit.start,
      end: hit.end,
      hint: `${fmtYMD(hit.start)} ～ ${fmtYMD(sun)}`,
    };
  }

  function buildPeriodFromMonthKey(monthOptions, monthKey) {
    const hit = (monthOptions || []).find(x => x.key === monthKey);
    if (!hit) return null;
    return {
      key: `month:${hit.key}`,
      label: hit.label,
      start: hit.start,
      end: hit.end,
      hint: `${fmtYMD(hit.start)} ～ ${fmtYMD(new Date(hit.end.getTime() - 1))}`,
    };
  }

  function buildPeriodFromQuarterKey(quarterOptions, quarterKey) {
    const hit = (quarterOptions || []).find(x => x.key === quarterKey);
    if (!hit) return null;
    return {
      key: `quarter:${hit.key}`,
      label: hit.label,
      start: hit.start,
      end: hit.end,
      hint: `${fmtYMD(hit.start)} ～ ${fmtYMD(new Date(hit.end.getTime() - 1))}`,
    };
  }

  function buildPeriodFromFiscalYearKey(fiscalYearOptions, fiscalYearKey) {
    const hit = (fiscalYearOptions || []).find(x => x.key === fiscalYearKey);
    if (!hit) return null;
    return {
      key: `fiscal:${hit.key}`,
      label: "期毎",
      start: hit.start,
      end: hit.end,
      hint: `${fmtYMD(hit.start)} ～ ${fmtYMD(new Date(hit.end.getTime() - 1))}`,
    };
  }

  function buildPeriodFromRange(monthOptions, startKey, endKey) {
    const s = (monthOptions || []).find(x => x.key === startKey);
    const e = (monthOptions || []).find(x => x.key === endKey);
    if (!s || !e) return null;
    if (s.start.getTime() > e.start.getTime()) return null;

    return {
      key: `range:${s.key}-${e.key}`,
      label: "期間指定累計",
      start: s.start,
      end: e.end, // end-month end (exclusive)
      hint: `${s.label} ～ ${e.label}`,
    };
  }

  function inRange(d, period) {
    if (!d) return false;
    const t = d.getTime();
    if (period.start && t < period.start.getTime()) return false;
    if (period.end && t >= period.end.getTime()) return false;
    return true;
  }

  /* =========================
   * 4) Aggregation
   * ========================= */
  function aggregate(records, fieldMap, period) {
    const m = new Map();
    let scanned = 0, used = 0;
    const needsDateFilter = period && (period.start || period.end);

    for (const r of records || []) {
      scanned++;
      const recObj = r && r.record ? r.record : {};

      const name = normalizePersonName(extractValue(recObj[fieldMap.salesperson]));
      if (!name) continue;

      const date = parseDate(recObj[fieldMap.date]);

      // Period filter: for month/quarter/range require a valid date; for cumulative include even if date missing
      if (needsDateFilter) {
        if (!inRange(date, period)) continue;
      }

      const pt = fieldMap.pt ? parseNumber(extractValue(recObj[fieldMap.pt])) : 0;
      const sales = fieldMap.sales ? parseNumber(extractValue(recObj[fieldMap.sales])) : 0;
      const hasPtForSales = pt !== 0;

      // 契約件数は別アプリ「1.契約情報入力フォーム」のCL担当者で集計するため、ここでは加算しない
      const cur = m.get(name) || { name, pt: 0, sales: 0, count: 0 };
      cur.pt += pt;
      if (hasPtForSales) cur.sales += sales;

      m.set(name, cur);
      used++;
    }

    const arr = Array.from(m.values());
    if (fieldMap.pt) {
      arr.sort((a, b) => (b.pt - a.pt) || (b.sales - a.sales) || (b.count - a.count) || a.name.localeCompare(b.name));
    } else {
      arr.sort((a, b) => (b.sales - a.sales) || (b.count - a.count) || a.name.localeCompare(b.name));
    }

    return { items: arr, scanned, used };
  }

  function aggregateApo(records, fieldMap, filterValue, period) {
    const m = new Map();
    let scanned = 0, used = 0;
    const filterValues = getApoFilterValues(filterValue);
    const excluded = CONFIG.APO_MEETING_EXCLUDED_STATUSES || [];
    const needsDateFilter = period && (period.start || period.end);

    for (const r of records || []) {
      scanned++;
      const recObj = r && r.record ? r.record : {};

      const name = normalizePersonName(extractValue(recObj[fieldMap.salesperson]));
      if (!name) continue;

      const typeVal = String(extractValue(recObj[fieldMap.apoType]) || "").trim();
      if (!typeVal) continue;

      // アポ種別（部分一致）で対象を抽出
      if (!isApoTypeMatched(typeVal, filterValues)) continue;

      // Period filter (requires date for month/quarter/range)
      if (needsDateFilter) {
        const date = parseDate(recObj[fieldMap.date]);
        if (!inRange(date, period)) continue;
      }

      // 見積ステータスから「アポキャン」を判定（部分一致）
      const statusVal = fieldMap.estimateStatus
        ? String(extractValue(recObj[fieldMap.estimateStatus]) || "").trim()
        : "";
      const isCancel = statusVal.includes("アポキャン");
      // 商談実施数：除外ステータス以外（新規・見積依頼済み・商談セット作成済み・商談日調整中・アポキャン以外）
      const isMeeting = !excluded.some((s) => statusVal.includes(s));
      // 契約件数：見積ステータスが即決成約・再商談成約・返待ち成約のいずれか（表記ゆれ・括弧全角化を含む）
      const isContract = matchesApoContractEstimateStatus(statusVal);

      // actualCount: アポ実績数（フィルタ後レコード数）
      // count: アポ件数（アポキャン以外）
      // cancelCount: アポキャン数
      // meetingCount: 商談実施数
      // contractCount: 契約件数（即決成約・再商談成約・返待ち成約）
      const cur = m.get(name) || { name, actualCount: 0, count: 0, cancelCount: 0, meetingCount: 0, contractCount: 0 };
      cur.actualCount += 1;
      if (isCancel) {
        cur.cancelCount += 1;
      } else {
        cur.count += 1;
      }
      if (isMeeting) cur.meetingCount += 1;
      if (isContract) cur.contractCount += 1;
      m.set(name, cur);
      used++;
    }

    const arr = Array.from(m.values());
    // 並び順はアポ実績数を優先
    arr.sort((a, b) => (b.actualCount - a.actualCount) || a.name.localeCompare(b.name));

    return { items: arr, scanned, used };
  }

  function normalizeTamaStatusLabel(s) {
    return String(s == null ? "" : s)
      .replace(/\s+/g, " ")
      .replace(/\(/g, "（")
      .replace(/\)/g, "）")
      .trim();
  }

  function isApoTamaStatus(statusVal) {
    const s = normalizeTamaStatusLabel(statusVal);
    if (!s) return false;
    const list = CONFIG.APO_TAMA_STATUSES || [];
    for (let i = 0; i < list.length; i++) {
      if (s === normalizeTamaStatusLabel(list[i])) return true;
    }
    return false;
  }

  /**
   * 見積ステータスがリストのいずれかに該当するか（完全一致または部分一致）。括弧は全角に揃える。
   * aggregateApo の契約件数・個人別「商談データ」の成約数で共通利用。
   */
  function matchesAnyEstimateStatusPattern(statusVal, statusList) {
    const s = normalizeTamaStatusLabel(statusVal);
    if (!s) return false;
    const arr = Array.isArray(statusList) ? statusList : [];
    for (let i = 0; i < arr.length; i++) {
      const t = normalizeTamaStatusLabel(arr[i]);
      if (t && (s === t || s.includes(t))) return true;
    }
    return false;
  }

  function matchesApoContractEstimateStatus(statusVal) {
    return matchesAnyEstimateStatusPattern(statusVal, CONFIG.APO_CONTRACT_STATUSES);
  }

  /**
   * 否系。単独の「否」は完全一致のみ（「〇〇否」の誤検出を防ぐ）。再商談否・返待ち否は部分一致可。
   */
  function matchesApoDenyEstimateStatus(statusVal) {
    const s = normalizeTamaStatusLabel(statusVal);
    if (!s) return false;
    const d1 = normalizeTamaStatusLabel("再商談否");
    const d2 = normalizeTamaStatusLabel("返待ち否");
    const d0 = normalizeTamaStatusLabel("否");
    if (d1 && (s === d1 || s.includes(d1))) return true;
    if (d2 && (s === d2 || s.includes(d2))) return true;
    if (d0 && s === d0) return true;
    return false;
  }

  /**
   * CL残玉数：CL担当者（アポ取得情報連携）＝ 営業担当名（目標/PT集計）で人数別に件数化。
   * アポ種別フィルタは掛けない。period に start/end があれば日付で絞る。null なら取得済み全レコード（全体累計）。
   */
  function sumApoTamaCountByClPerson(records, fieldMap, period) {
    const m = new Map();
    if (!records || !fieldMap || !fieldMap.clPerson || !fieldMap.estimateStatus) return m;
    const needsDateFilter = period && (period.start || period.end);
    if (needsDateFilter && !fieldMap.date) return m;
    for (const r of records || []) {
      const recObj = r && r.record ? r.record : {};
      if (needsDateFilter) {
        const date = parseDate(recObj[fieldMap.date]);
        if (!inRange(date, period)) continue;
      }
      const clName = normalizePersonName(extractValue(recObj[fieldMap.clPerson]));
      if (!clName) continue;
      const statusVal = extractValue(recObj[fieldMap.estimateStatus]);
      if (!isApoTamaStatus(statusVal)) continue;
      m.set(clName, (m.get(clName) || 0) + 1);
    }
    return m;
  }

  /**
   * AP残玉数：アポ取得情報連携で
   * ・見積ステータスが APO_TAMA_STATUSES（新規/見積依頼済み/見積依頼済（資料のみ）/商談日調整中/商談セット作成済み/再商談日調整中/再商談）のいずれか
   * ・見出し「AP担当者」フィールドの値（fieldMap.salesperson＝ pickApoAppSalespersonFieldId 解決）＝ 営業担当名で突合
   * ・CL担当者とAP担当者が同一人物のレコードは CL残玉側のみに計上し、ここでは除外（支社別の二重計上防止）
   * ・期間は period null のため日付は絞らない（全期間累計）
   */
  function sumApoTamaCountByApPerson(records, fieldMap, period) {
    const m = new Map();
    if (!records || !fieldMap || !fieldMap.salesperson || !fieldMap.estimateStatus) return m;
    const needsDateFilter = period && (period.start || period.end);
    if (needsDateFilter && !fieldMap.date) return m;
    for (const r of records || []) {
      const recObj = r && r.record ? r.record : {};
      if (needsDateFilter) {
        const date = parseDate(recObj[fieldMap.date]);
        if (!inRange(date, period)) continue;
      }
      const apName = normalizePersonName(extractValue(recObj[fieldMap.salesperson]));
      if (!apName) continue;
      if (fieldMap.clPerson) {
        const clName = normalizePersonName(extractValue(recObj[fieldMap.clPerson]));
        if (clName && clName === apName) continue;
      }
      const statusVal = extractValue(recObj[fieldMap.estimateStatus]);
      if (!isApoTamaStatus(statusVal)) continue;
      m.set(apName, (m.get(apName) || 0) + 1);
    }
    return m;
  }

  /**
   * APランキング（bootAp）と同一のフィールド解決。aggregateApo / 目標マージの前提を揃える。
   */
  function buildApoFieldMapForApRanking(apoFields) {
    if (!Array.isArray(apoFields) || !apoFields.length) return null;
    const o = CONFIG.APO_FIELD_OVERRIDES || {};
    const kw = CONFIG.APO_FIELD_KEYWORDS || {};
    const salesperson = o.salesperson || pickApoAppSalespersonFieldId(apoFields);
    const apoType = o.apoType || pickFieldUniqueId(apoFields, kw.apoType);
    const date = o.date || pickFieldUniqueId(apoFields, kw.date);
    const estimateStatus = o.estimateStatus || pickFieldUniqueId(apoFields, kw.estimateStatus);
    if (!salesperson || !apoType || !date || !estimateStatus) return null;
    return { salesperson, apoType, date, estimateStatus };
  }

  /** APランキング「アポ獲得数(actualCount)」と同じ集計だが、アポ種別は全件対象 */
  function sumApoActualCountByPersonAll(records, fieldMap, period) {
    const out = new Map();
    if (!records || !fieldMap || !fieldMap.salesperson) return out;
    for (const r of records || []) {
      const recObj = r && r.record ? r.record : {};
      const name = normalizePersonName(extractValue(recObj[fieldMap.salesperson]));
      if (!name) continue;
      const typeVal = String(extractValue(recObj[fieldMap.apoType]) || "").trim();
      if (!typeVal) continue;
      const needsDateFilter = period && (period.start || period.end);
      if (needsDateFilter) {
        const date = parseDate(recObj[fieldMap.date]);
        if (!inRange(date, period)) continue;
      }
      out.set(name, (out.get(name) || 0) + 1);
    }
    return out;
  }

  /** アポ件数の導入経緯別内訳（導入経緯=アポ種別）を担当者別に集計 */
  function sumApoTypeBreakdownByPersonAll(records, fieldMap, period) {
    const out = new Map();
    if (!records || !fieldMap || !fieldMap.salesperson || !fieldMap.apoType) return out;
    for (const r of records || []) {
      const recObj = r && r.record ? r.record : {};
      const name = normalizePersonName(extractValue(recObj[fieldMap.salesperson]));
      if (!name) continue;
      const typeVal = String(extractValue(recObj[fieldMap.apoType]) || "").trim();
      if (!typeVal) continue;
      const needsDateFilter = period && (period.start || period.end);
      if (needsDateFilter) {
        const date = parseDate(recObj[fieldMap.date]);
        if (!inRange(date, period)) continue;
      }
      let typeMap = out.get(name);
      if (!typeMap) {
        typeMap = new Map();
        out.set(name, typeMap);
      }
      typeMap.set(typeVal, (typeMap.get(typeVal) || 0) + 1);
    }
    return out;
  }

  /** アポ件数の導入経緯別内訳（導入経緯=アポ種別）を全体で集計 */
  function sumApoTypeBreakdownOverallAll(records, fieldMap, period) {
    const out = new Map();
    if (!records || !fieldMap || !fieldMap.apoType) return out;
    for (const r of records || []) {
      const recObj = r && r.record ? r.record : {};
      const typeVal = String(extractValue(recObj[fieldMap.apoType]) || "").trim();
      if (!typeVal) continue;
      const needsDateFilter = period && (period.start || period.end);
      if (needsDateFilter) {
        const date = parseDate(recObj[fieldMap.date]);
        if (!inRange(date, period)) continue;
      }
      out.set(typeVal, (out.get(typeVal) || 0) + 1);
    }
    return out;
  }

  /** 指定導入経緯ごとの件数とアポランク内訳を、担当者別（累計）で集計 */
  function sumApoRankBreakdownByPersonAndTypeAll(records, fieldMap, period, targetTypes) {
    const out = new Map();
    const types = Array.isArray(targetTypes) ? targetTypes.filter((x) => String(x || "").trim()) : [];
    if (!records || !fieldMap || !fieldMap.salesperson || !fieldMap.apoType || !types.length) return out;
    for (const r of records || []) {
      const recObj = r && r.record ? r.record : {};
      const name = normalizePersonName(extractValue(recObj[fieldMap.salesperson]));
      if (!name) continue;
      const apoTypeVal = String(extractValue(recObj[fieldMap.apoType]) || "").trim();
      if (!apoTypeVal) continue;
      const matchedType = types.find((t) => isApoTypeMatched(apoTypeVal, [t]));
      if (!matchedType) continue;
      const needsDateFilter = period && (period.start || period.end);
      if (needsDateFilter) {
        const date = parseDate(recObj[fieldMap.date]);
        if (!inRange(date, period)) continue;
      }
      let perPerson = out.get(name);
      if (!perPerson) {
        perPerson = new Map();
        out.set(name, perPerson);
      }
      let perType = perPerson.get(matchedType);
      if (!perType) {
        perType = { total: 0, rankMap: new Map() };
        perPerson.set(matchedType, perType);
      }
      const rankVal = fieldMap.apoRank ? String(extractValue(recObj[fieldMap.apoRank]) || "").trim() : "";
      const rankKey = rankVal || "(未設定)";
      perType.total += 1;
      perType.rankMap.set(rankKey, (perType.rankMap.get(rankKey) || 0) + 1);
    }
    return out;
  }

  /**
   * 個人別「アポランク比率」と同一の対象種別フィルタ（targetTypes／isApoTypeMatched に合うアポのみ）で、
   * 組織全体のアポランク別件数を集計。cumulativePeriod なら全期間・日付フィルタなし。
   */
  function sumOverallApoRankBreakdownFilteredAll(records, fieldMap, period, targetTypes) {
    const rankMap = new Map();
    const types = Array.isArray(targetTypes) ? targetTypes.filter((x) => String(x || "").trim()) : [];
    if (!records || !fieldMap || !fieldMap.apoType || !types.length) return rankMap;
    for (const r of records || []) {
      const recObj = r && r.record ? r.record : {};
      const apoTypeVal = String(extractValue(recObj[fieldMap.apoType]) || "").trim();
      if (!apoTypeVal) continue;
      const matchedType = types.find((t) => isApoTypeMatched(apoTypeVal, [t]));
      if (!matchedType) continue;
      const needsDateFilter = period && (period.start || period.end);
      if (needsDateFilter) {
        const date = parseDate(recObj[fieldMap.date]);
        if (!inRange(date, period)) continue;
      }
      const rankVal = fieldMap.apoRank ? String(extractValue(recObj[fieldMap.apoRank]) || "").trim() : "";
      const rankKey = rankVal || "(未設定)";
      rankMap.set(rankKey, (rankMap.get(rankKey) || 0) + 1);
    }
    return rankMap;
  }

  function sumMeetingCountByPerson(records, fieldMap, period, statuses) {
    const out = new Map();
    if (!records || !fieldMap || !fieldMap.salesperson || !fieldMap.estimateStatus) return out;
    const statusList = Array.isArray(statuses) ? statuses : [];
    for (const r of records || []) {
      const recObj = r && r.record ? r.record : {};
      const name = normalizePersonName(extractValue(recObj[fieldMap.salesperson]));
      if (!name) continue;
      const needsDateFilter = period && (period.start || period.end);
      if (needsDateFilter) {
        const d = parseDate(recObj[fieldMap.date]);
        if (!inRange(d, period)) continue;
      }
      const statusVal = String(extractValue(recObj[fieldMap.estimateStatus]) || "").trim();
      if (!statusVal) continue;
      const meetingPlaceVal = String(extractValue(recObj[fieldMap.meetingPlace]) || "").trim();
      if (meetingPlaceVal === "オンライン商談") continue;
      const isMatch = statusList.some((s) => statusVal === s || statusVal.includes(s));
      if (!isMatch) continue;
      out.set(name, (out.get(name) || 0) + 1);
    }
    return out;
  }

  function normalizeMeetingStatusResultLabel(statusVal) {
    const s = String(statusVal || "").trim();
    if (s === "即決成約") return "成約";
    /** ドラフト項目名の揺れ（部分一致）は再商談グループへ */
    if (s.includes("再商談日調整中")) return "再商談";
    if (s === "再商談" || s === "再商談成約" || s === "再商談否") return "再商談";
    if (s === "返待ち" || s === "返待ち成約" || s === "返待ち否") return "返待ち";
    if (s === "否") return "否";
    return s;
  }

  /** 初回商談結果（結果比率）の円・内訳から除外する見積ステータス（商談実施件数カウントにはそのまま含む） */
  function shouldExcludeMeetingStatusFromFirstResultPie(statusVal) {
    const s = String(statusVal || "").trim();
    return s.includes("資料送付否");
  }

  function sumMeetingTypeBreakdownByPersonAll(records, fieldMap, period, statuses) {
    const out = new Map();
    if (!records || !fieldMap || !fieldMap.salesperson || !fieldMap.estimateStatus || !fieldMap.apoType) return out;
    const statusList = Array.isArray(statuses) ? statuses : [];
    for (const r of records || []) {
      const recObj = r && r.record ? r.record : {};
      const name = normalizePersonName(extractValue(recObj[fieldMap.salesperson]));
      if (!name) continue;
      const needsDateFilter = period && (period.start || period.end);
      if (needsDateFilter) {
        const d = parseDate(recObj[fieldMap.date]);
        if (!inRange(d, period)) continue;
      }
      const statusVal = String(extractValue(recObj[fieldMap.estimateStatus]) || "").trim();
      if (!statusVal) continue;
      const meetingPlaceVal = String(extractValue(recObj[fieldMap.meetingPlace]) || "").trim();
      if (meetingPlaceVal === "オンライン商談") continue;
      const isMatch = statusList.some((s) => statusVal === s || statusVal.includes(s));
      if (!isMatch) continue;
      const apoTypeVal = String(extractValue(recObj[fieldMap.apoType]) || "").trim() || "(未設定)";
      let typeMap = out.get(name);
      if (!typeMap) {
        typeMap = new Map();
        out.set(name, typeMap);
      }
      typeMap.set(apoTypeVal, (typeMap.get(apoTypeVal) || 0) + 1);
    }
    return out;
  }

  // PT集計表の導入経緯別PT合計（担当者別）
  function sumPtByIntroductionRouteByPersonAll(records, fieldMap, period) {
    const out = new Map();
    if (!records || !fieldMap || !fieldMap.salesperson || !fieldMap.introductionRoute || !fieldMap.pt) return out;
    for (const r of records || []) {
      const recObj = r && r.record ? r.record : {};
      const name = normalizePersonName(extractValue(recObj[fieldMap.salesperson]));
      if (!name) continue;
      const needsDateFilter = period && (period.start || period.end);
      if (needsDateFilter) {
        const d = parseDate(recObj[fieldMap.date]);
        if (!inRange(d, period)) continue;
      }
      const regNoVal = String(extractValue(recObj[fieldMap.regNo]) || "").trim().toUpperCase();
      if (regNoVal.startsWith("PL")) continue;
      const routeVal = String(extractValue(recObj[fieldMap.introductionRoute]) || "").trim() || "(未設定)";
      const ptVal = parseNumber(extractValue(recObj[fieldMap.pt]));
      let routeMap = out.get(name);
      if (!routeMap) {
        routeMap = new Map();
        out.set(name, routeMap);
      }
      routeMap.set(routeVal, (routeMap.get(routeVal) || 0) + ptVal);
    }
    return out;
  }

  // PT集計表の導入経緯別件数（担当者別）
  function sumCountByIntroductionRouteByPersonAll(records, fieldMap, period) {
    const out = new Map();
    if (!records || !fieldMap || !fieldMap.salesperson || !fieldMap.introductionRoute) return out;
    for (const r of records || []) {
      const recObj = r && r.record ? r.record : {};
      const name = normalizePersonName(extractValue(recObj[fieldMap.salesperson]));
      if (!name) continue;
      const needsDateFilter = period && (period.start || period.end);
      if (needsDateFilter) {
        const d = parseDate(recObj[fieldMap.date]);
        if (!inRange(d, period)) continue;
      }
      const regNoVal = String(extractValue(recObj[fieldMap.regNo]) || "").trim().toUpperCase();
      if (regNoVal.startsWith("PL")) continue;
      const routeVal = String(extractValue(recObj[fieldMap.introductionRoute]) || "").trim() || "(未設定)";
      let routeMap = out.get(name);
      if (!routeMap) {
        routeMap = new Map();
        out.set(name, routeMap);
      }
      routeMap.set(routeVal, (routeMap.get(routeVal) || 0) + 1);
    }
    return out;
  }

  // 導入経緯別の成約数（担当者別）
  function sumContractByIntroductionRouteByPersonAll(records, fieldMap, period, statuses) {
    const out = new Map();
    if (!records || !fieldMap || !fieldMap.salesperson || !fieldMap.apoType || !fieldMap.estimateStatus) return out;
    for (const r of records || []) {
      const recObj = r && r.record ? r.record : {};
      const name = normalizePersonName(extractValue(recObj[fieldMap.salesperson]));
      if (!name) continue;
      const needsDateFilter = period && (period.start || period.end);
      if (needsDateFilter) {
        const d = parseDate(recObj[fieldMap.date]);
        if (!inRange(d, period)) continue;
      }
      const statusVal = String(extractValue(recObj[fieldMap.estimateStatus]) || "").trim();
      if (!statusVal) continue;
      const isMatch = matchesAnyEstimateStatusPattern(statusVal, statuses);
      if (!isMatch) continue;
      const routeVal = String(extractValue(recObj[fieldMap.apoType]) || "").trim() || "(未設定)";
      let routeMap = out.get(name);
      if (!routeMap) {
        routeMap = new Map();
        out.set(name, routeMap);
      }
      routeMap.set(routeVal, (routeMap.get(routeVal) || 0) + 1);
    }
    return out;
  }

  function sumMeetingStatusBreakdownByPersonAll(records, fieldMap, period, statuses) {
    const out = new Map();
    if (!records || !fieldMap || !fieldMap.salesperson || !fieldMap.estimateStatus) return out;
    const statusList = Array.isArray(statuses) ? statuses : [];
    for (const r of records || []) {
      const recObj = r && r.record ? r.record : {};
      const name = normalizePersonName(extractValue(recObj[fieldMap.salesperson]));
      if (!name) continue;
      const needsDateFilter = period && (period.start || period.end);
      if (needsDateFilter) {
        const d = parseDate(recObj[fieldMap.date]);
        if (!inRange(d, period)) continue;
      }
      const statusVal = String(extractValue(recObj[fieldMap.estimateStatus]) || "").trim();
      if (!statusVal) continue;
      const meetingPlaceVal = String(extractValue(recObj[fieldMap.meetingPlace]) || "").trim();
      if (meetingPlaceVal === "オンライン商談") continue;
      const isMatch = statusList.some((s) => statusVal === s || statusVal.includes(s));
      if (!isMatch) continue;
      if (shouldExcludeMeetingStatusFromFirstResultPie(statusVal)) continue;
      const groupedStatus = normalizeMeetingStatusResultLabel(statusVal) || "(未設定)";
      let statusMap = out.get(name);
      if (!statusMap) {
        statusMap = new Map();
        out.set(name, statusMap);
      }
      statusMap.set(groupedStatus, (statusMap.get(groupedStatus) || 0) + 1);
    }
    return out;
  }

  function sumMeetingStatusDetailByPersonAll(records, fieldMap, period, statuses) {
    const out = new Map();
    if (!records || !fieldMap || !fieldMap.salesperson || !fieldMap.estimateStatus) return out;
    const statusList = Array.isArray(statuses) ? statuses : [];
    for (const r of records || []) {
      const recObj = r && r.record ? r.record : {};
      const name = normalizePersonName(extractValue(recObj[fieldMap.salesperson]));
      if (!name) continue;
      const needsDateFilter = period && (period.start || period.end);
      if (needsDateFilter) {
        const d = parseDate(recObj[fieldMap.date]);
        if (!inRange(d, period)) continue;
      }
      const statusVal = String(extractValue(recObj[fieldMap.estimateStatus]) || "").trim();
      if (!statusVal) continue;
      const meetingPlaceVal = String(extractValue(recObj[fieldMap.meetingPlace]) || "").trim();
      if (meetingPlaceVal === "オンライン商談") continue;
      const isMatch = statusList.some((s) => statusVal === s || statusVal.includes(s));
      if (!isMatch) continue;
      if (shouldExcludeMeetingStatusFromFirstResultPie(statusVal)) continue;
      const groupedStatus = normalizeMeetingStatusResultLabel(statusVal) || "(未設定)";
      let perPerson = out.get(name);
      if (!perPerson) {
        perPerson = new Map();
        out.set(name, perPerson);
      }
      let detailMap = perPerson.get(groupedStatus);
      if (!detailMap) {
        detailMap = new Map();
        perPerson.set(groupedStatus, detailMap);
      }
      detailMap.set(statusVal, (detailMap.get(statusVal) || 0) + 1);
    }
    return out;
  }

  /** CL商談: 担当者別にせず、アポ種別（導入経緯別）ごとの実施件数だけ全体集計（個人別の商談実施ピーと同一の絞り込み） */
  function sumMeetingTypeBreakdownOverallAll(records, fieldMap, period, statuses) {
    const out = new Map();
    if (!records || !fieldMap || !fieldMap.salesperson || !fieldMap.estimateStatus || !fieldMap.apoType) return out;
    const statusList = Array.isArray(statuses) ? statuses : [];
    for (const r of records || []) {
      const recObj = r && r.record ? r.record : {};
      const name = normalizePersonName(extractValue(recObj[fieldMap.salesperson]));
      if (!name) continue;
      const needsDateFilter = period && (period.start || period.end);
      if (needsDateFilter) {
        const d = parseDate(recObj[fieldMap.date]);
        if (!inRange(d, period)) continue;
      }
      const statusVal = String(extractValue(recObj[fieldMap.estimateStatus]) || "").trim();
      if (!statusVal) continue;
      const meetingPlaceVal = String(extractValue(recObj[fieldMap.meetingPlace]) || "").trim();
      if (meetingPlaceVal === "オンライン商談") continue;
      const isMatch = statusList.some((s) => statusVal === s || statusVal.includes(s));
      if (!isMatch) continue;
      const apoTypeVal = String(extractValue(recObj[fieldMap.apoType]) || "").trim() || "(未設定)";
      out.set(apoTypeVal, (out.get(apoTypeVal) || 0) + 1);
    }
    return out;
  }

  /** 初回商談結果グループごとの全体件数（normalizeMeetingStatusResultLabel と個人別と同一フィルタ） */
  function sumMeetingStatusBreakdownOverallAll(records, fieldMap, period, statuses) {
    const out = new Map();
    if (!records || !fieldMap || !fieldMap.salesperson || !fieldMap.estimateStatus) return out;
    const statusList = Array.isArray(statuses) ? statuses : [];
    for (const r of records || []) {
      const recObj = r && r.record ? r.record : {};
      const name = normalizePersonName(extractValue(recObj[fieldMap.salesperson]));
      if (!name) continue;
      const needsDateFilter = period && (period.start || period.end);
      if (needsDateFilter) {
        const d = parseDate(recObj[fieldMap.date]);
        if (!inRange(d, period)) continue;
      }
      const statusVal = String(extractValue(recObj[fieldMap.estimateStatus]) || "").trim();
      if (!statusVal) continue;
      const meetingPlaceVal = String(extractValue(recObj[fieldMap.meetingPlace]) || "").trim();
      if (meetingPlaceVal === "オンライン商談") continue;
      const isMatch = statusList.some((s) => statusVal === s || statusVal.includes(s));
      if (!isMatch) continue;
      if (shouldExcludeMeetingStatusFromFirstResultPie(statusVal)) continue;
      const groupedStatus = normalizeMeetingStatusResultLabel(statusVal) || "(未設定)";
      out.set(groupedStatus, (out.get(groupedStatus) || 0) + 1);
    }
    return out;
  }

  /**
   * 個人別の meetingStatusDetailMap と同様のグループ別・生ステータス件数だが組織全体で1つの Map。
   * 成約・否カウントに tallyMeetingContractDenyOverallFromGroupedDetail を使う。
   */
  function sumMeetingStatusGroupedDetailOverallAll(records, fieldMap, period, statuses) {
    const out = new Map();
    if (!records || !fieldMap || !fieldMap.salesperson || !fieldMap.estimateStatus) return out;
    const statusList = Array.isArray(statuses) ? statuses : [];
    for (const r of records || []) {
      const recObj = r && r.record ? r.record : {};
      const name = normalizePersonName(extractValue(recObj[fieldMap.salesperson]));
      if (!name) continue;
      const needsDateFilter = period && (period.start || period.end);
      if (needsDateFilter) {
        const d = parseDate(recObj[fieldMap.date]);
        if (!inRange(d, period)) continue;
      }
      const statusVal = String(extractValue(recObj[fieldMap.estimateStatus]) || "").trim();
      if (!statusVal) continue;
      const meetingPlaceVal = String(extractValue(recObj[fieldMap.meetingPlace]) || "").trim();
      if (meetingPlaceVal === "オンライン商談") continue;
      const isMatch = statusList.some((s) => statusVal === s || statusVal.includes(s));
      if (!isMatch) continue;
      if (shouldExcludeMeetingStatusFromFirstResultPie(statusVal)) continue;
      const groupedStatus = normalizeMeetingStatusResultLabel(statusVal) || "(未設定)";
      let detailMap = out.get(groupedStatus);
      if (!detailMap) {
        detailMap = new Map();
        out.set(groupedStatus, detailMap);
      }
      detailMap.set(statusVal, (detailMap.get(statusVal) || 0) + 1);
    }
    return out;
  }

  function tallyMeetingContractDenyOverallFromGroupedDetail(groupedDetailRoot) {
    let meetingContractCount = 0;
    let meetingDenyCount = 0;
    if (!groupedDetailRoot || !groupedDetailRoot.size) return { meetingContractCount, meetingDenyCount };
    for (const detailMap of groupedDetailRoot.values()) {
      if (!detailMap) continue;
      for (const [rawStatus, countVal] of detailMap.entries()) {
        const cnt = countVal || 0;
        if (matchesApoContractEstimateStatus(rawStatus)) meetingContractCount += cnt;
        if (matchesApoDenyEstimateStatus(rawStatus)) meetingDenyCount += cnt;
      }
    }
    return { meetingContractCount, meetingDenyCount };
  }

  let _cacheApoFilterConfigValues = null;
  function getApoFilterValues(filterValue) {
    if (filterValue === CONFIG.APO_FILTER_VALUES && _cacheApoFilterConfigValues) {
      return _cacheApoFilterConfigValues;
    }
    const fromArg = Array.isArray(filterValue)
      ? filterValue
      : (String(filterValue || "").trim() ? [String(filterValue).trim()] : []);

    if (fromArg.length) {
      const out = fromArg
        .filter((v) => String(v || "").trim())
        .map((v) => String(v).trim());
      if (filterValue === CONFIG.APO_FILTER_VALUES) _cacheApoFilterConfigValues = out;
      return out;
    }

    const fromConfig = Array.isArray(CONFIG.APO_FILTER_VALUES) ? CONFIG.APO_FILTER_VALUES : [];
    const fromCfgOut = fromConfig
      .filter((v) => String(v || "").trim())
      .map((v) => String(v).trim());
    if (filterValue === CONFIG.APO_FILTER_VALUES) _cacheApoFilterConfigValues = fromCfgOut;
    return fromCfgOut;
  }

  function isApoTypeMatched(typeVal, filterValues) {
    const tv = String(typeVal || "").trim();
    if (!tv) return false;
    if (!Array.isArray(filterValues) || !filterValues.length) return true;
    return filterValues.some((fv) => tv.includes(fv));
  }

  const APO_RANK_PIE_PALETTE = ["#0f766e", "#7c3aed", "#0369a1", "#4d7c0f", "#b45309", "#be185d", "#475569"];

  /** 項目名のみから決まる色相（データセットや並び順に依存しない／個人別・全体で同色） */
  function stableHueIndexForPieLabel(label) {
    const str = String(label || "");
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** アポランク比率など：ランク規則＋項目名ハッシュで全体・個人別で同色 */
  function getApoRankPieSliceColor(rank, _idxIgnored) {
    const raw = String(rank || "").trim();
    const r = raw.toUpperCase();
    if (r === "A" || raw.includes("Aランク")) return "#dc2626";
    if (r === "B" || raw.includes("Bランク")) return "#2563eb";
    if (r === "C" || raw.includes("Cランク")) return "#d97706";
    const hi = stableHueIndexForPieLabel(raw);
    return APO_RANK_PIE_PALETTE[hi % APO_RANK_PIE_PALETTE.length];
  }

  function getApoFilterLabel(filterValue) {
    const values = getApoFilterValues(filterValue);
    return values.length ? values.join(" / ") : "全件";
  }

  /** APランキングの件数換算対象。APO_RANKING_FILTER_VALUES が空なら APO_FILTER_VALUES にフォールバック */
  function getApoRankingFilterValues() {
    const ranking = Array.isArray(CONFIG.APO_RANKING_FILTER_VALUES) ? CONFIG.APO_RANKING_FILTER_VALUES : [];
    const out = ranking
      .filter((v) => String(v || "").trim())
      .map((v) => String(v).trim());
    if (out.length) return out;
    return getApoFilterValues(CONFIG.APO_FILTER_VALUES);
  }

  /** 導入経緯（アポ種別）・商談タイプなど：個人別ビルダーと同じパレット。同一ラベルは常に同じ色（buildPieSection と全体累計グラフで共通） */
  /** @param {*} _rows 後方互換のため維持（色は項目名のみで決定） */
  function buildApoTypeColorResolver(_rows) {
    const forcedColor = {
      "ダイレクト": "#2f6db0",
      "お客様紹介": "#2f9e44",
      "ソーラーパートナーズ": "#d97706",
    };
    const mutedPalette = [
      "#2f6db0", // blue
      "#d97706", // orange
      "#2f9e44", // green
      "#7c3aed", // purple
      "#0f766e", // teal
      "#b91c1c", // red
      "#a16207", // amber-brown
      "#0369a1", // sky
      "#be185d", // pink
      "#4d7c0f", // lime-green
    ];
    return function resolve(type) {
      const key = String(type || "").trim();
      if (forcedColor[key]) return forcedColor[key];
      if (!key) return "#94a3b8";
      const hi = stableHueIndexForPieLabel(key);
      return mutedPalette[hi % mutedPalette.length];
    };
  }

  /**
   * 稼働終了報告アプリから稼働日数（レコード件数）を担当者別・期間別に集計
   * - 抽出元アプリ: CONFIG.WORK_APP_NAME（稼働終了報告）
   * - 担当者: 営業担当（稼働終了報告の報告者列）
   * - 日付: 報告日
   * - 日数 = 期間内のレコード件数
   * - ピンポン数 / 面談数 / アポ獲得数 = 対象見出しの合計値
   */
  function aggregateWorkDays(records, fieldMap, period) {
    const m = new Map();
    let scanned = 0, used = 0;

    for (const r of records || []) {
      scanned++;
      const recObj = r && r.record ? r.record : {};

      const name = normalizePersonName(extractValue(recObj[fieldMap.salesperson]));
      if (!name) continue;

      const date = parseDate(recObj[fieldMap.date]);
      if (!date) continue;

      const needsDateFilter = period && (period.start || period.end);
      if (needsDateFilter && !inRange(date, period)) continue;

      const pingpongCount = fieldMap.pingpongCount ? parseNumber(extractValue(recObj[fieldMap.pingpongCount])) : 0;
      const interviewCount = fieldMap.interviewCount ? parseNumber(extractValue(recObj[fieldMap.interviewCount])) : 0;
      const apoGetCount = fieldMap.apoGetCount ? parseNumber(extractValue(recObj[fieldMap.apoGetCount])) : 0;

      const cur = m.get(name) || { name, workDays: 0, pingpongCount: 0, interviewCount: 0, apoGetCount: 0 };
      cur.workDays += 1;
      cur.pingpongCount += pingpongCount;
      cur.interviewCount += interviewCount;
      cur.apoGetCount += apoGetCount;
      m.set(name, cur);
      used++;
    }

    const arr = Array.from(m.values());
    return { items: arr, scanned, used };
  }

  /** aggregateWorkDays の items を担当者横断で合算（全体データ分析の「1件アポ取得までの道」用） */
  function reduceWorkAggItemsToTotals(items) {
    return (items || []).reduce(
      (acc, row) => ({
        workDays: acc.workDays + (row.workDays || 0),
        pingpongCount: acc.pingpongCount + (row.pingpongCount || 0),
        interviewCount: acc.interviewCount + (row.interviewCount || 0),
        apoGetCount: acc.apoGetCount + (row.apoGetCount || 0),
      }),
      { workDays: 0, pingpongCount: 0, interviewCount: 0, apoGetCount: 0 }
    );
  }

  function buildGoalMonthMap(records, fieldMap) {
    const map = new Map();
    for (const r of records || []) {
      const recObj = r && r.record ? r.record : {};
      const name = normalizePersonName(extractValue(recObj[fieldMap.salesperson]));
      if (!name) continue;
      const d = parseDate(recObj[fieldMap.date]);
      if (!d) continue;
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const ptT = fieldMap.ptTarget ? parseNumber(extractValue(recObj[fieldMap.ptTarget])) : 0;
      const apoT = fieldMap.apoTarget ? parseNumber(extractValue(recObj[fieldMap.apoTarget])) : 0;
      const plannedWD = fieldMap.plannedWorkDays ? parseNumber(extractValue(recObj[fieldMap.plannedWorkDays])) : 0;
      const branch = fieldMap.branch ? String(extractValue(recObj[fieldMap.branch]) || "").trim() : "";
      let perPerson = map.get(name);
      if (!perPerson) { perPerson = new Map(); map.set(name, perPerson); }
      const cur = perPerson.get(monthKey) || { ptTarget: 0, apoTarget: 0, plannedWorkDays: 0, branch: "" };
      cur.ptTarget += ptT;
      cur.apoTarget += apoT;
      cur.plannedWorkDays += plannedWD;
      if (branch) cur.branch = branch;
      perPerson.set(monthKey, cur);
    }
    return map;
  }

  /** 対象期間内の目標データから担当者の支社を取得（営業データ分析の支社別表記用） */
  function getBranchInPeriod(goalMonthMap, name, period, monthOptions) {
    if (!goalMonthMap || !name) return "";
    const perPerson = goalMonthMap.get(name);
    if (!perPerson || !perPerson.size) return "";
    const keys = getMonthKeysInPeriod(period, monthOptions);
    if (keys && keys.length) {
      for (const k of keys) {
        const v = perPerson.get(k);
        if (v && v.branch) return v.branch;
      }
    } else {
      for (const v of perPerson.values()) {
        if (v && v.branch) return v.branch;
      }
    }
    return "";
  }

  /** goalMonthMap から最大の月キーを取得（apoTarget または ptTarget が入っている月） */
  function getMaxMonthFromGoalMap(goalMonthMap, useApoTarget) {
    if (!goalMonthMap || !goalMonthMap.size) return null;
    let maxKey = null;
    goalMonthMap.forEach((perPerson) => {
      perPerson.forEach((v, monthKey) => {
        const hasVal = useApoTarget ? (v.apoTarget > 0) : (v.ptTarget > 0);
        if (hasVal && (!maxKey || monthKey > maxKey)) maxKey = monthKey;
      });
    });
    return maxKey;
  }

  function getMonthKeysInPeriod(period, monthOptions) {
    if (!period || !monthOptions || !monthOptions.length) return [];
    if (!period.start || !period.end) return null;
    const out = [];
    const startT = period.start.getTime();
    const endT = period.end.getTime();
    for (const mo of monthOptions) {
      const moStart = mo.start.getTime();
      const moEnd = (mo.end || new Date(mo.start.getFullYear(), mo.start.getMonth() + 1, 1, 0, 0, 0, 0)).getTime();
      if (moStart < endT && moEnd > startT) out.push(mo.key);
    }
    return out;
  }

  function sumGoalsInPeriod(goalMonthMap, period, monthOptions) {
    const out = new Map();
    if (!goalMonthMap || !goalMonthMap.size) return out;
    const keys = getMonthKeysInPeriod(period, monthOptions);
    goalMonthMap.forEach((perPerson, name) => {
      let ptT = 0, apoT = 0, plannedWD = 0;
      if (keys === null) {
        perPerson.forEach((v) => {
          ptT += v.ptTarget || 0;
          apoT += v.apoTarget || 0;
          plannedWD += v.plannedWorkDays || 0;
        });
      } else {
        for (const k of keys) {
          const v = perPerson.get(k);
          if (v) {
            ptT += v.ptTarget || 0;
            apoT += v.apoTarget || 0;
            plannedWD += v.plannedWorkDays || 0;
          }
        }
      }
      if (ptT > 0 || apoT > 0 || plannedWD > 0) out.set(name, { ptTarget: ptT, apoTarget: apoT, plannedWorkDays: plannedWD });
    });
    return out;
  }

  // 契約情報入力フォーム：CL担当者別・月別のレコード件数
  function buildContractCountMap(records, dateFieldId, clPersonFieldId, customerStatusFieldId) {
    const map = new Map();
    for (const r of records || []) {
      const recObj = r && r.record ? r.record : {};
      const customerStatus = customerStatusFieldId ? String(extractValue(recObj[customerStatusFieldId]) || "").trim() : "";
      if (customerStatus === "キャンセル") continue;
      const name = normalizePersonName(extractValue(recObj[clPersonFieldId]));
      if (!name) continue;
      const d = parseDate(recObj[dateFieldId]);
      if (!d) continue;
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      let perPerson = map.get(name);
      if (!perPerson) { perPerson = new Map(); map.set(name, perPerson); }
      perPerson.set(monthKey, (perPerson.get(monthKey) || 0) + 1);
    }
    return map;
  }

  function sumContractCountInPeriod(contractCountMap, period, monthOptions) {
    const out = new Map();
    if (!contractCountMap || !contractCountMap.size) return out;
    const keys = getMonthKeysInPeriod(period, monthOptions);
    contractCountMap.forEach((perPerson, name) => {
      let n = 0;
      if (keys === null) {
        perPerson.forEach((c) => { n += c || 0; });
      } else {
        for (const k of keys) {
          n += perPerson.get(k) || 0;
        }
      }
      if (n > 0) out.set(name, n);
    });
    return out;
  }

  /* =========================
   * 5) UI helpers
   * ========================= */
  function ensureStyleOnce() {
    if (document.getElementById("ap-ranking-style-v4")) return;
    const style = document.createElement("style");
    style.id = "ap-ranking-style-v4";
    style.textContent = `
      /* Portal 側で flex/grid 子要素になったとき、内側の横幅で親が広がって見切れないよう min-width を抑制 */
      .apr-wrap {
        margin: 12px 0 18px;
        color: #0f172a;
        width: 100%;
        max-width: 100%;
        min-width: 0;
        box-sizing: border-box;
      }
      .apr-card, .apr-card * { box-sizing: border-box; }
      .apr-card {
        --apr-accent: #2563eb;
        --apr-accent-2: #7c3aed;
        --apr-border: #e2e8f0;
        --apr-soft: #f8fafc;
        --apr-text: #0f172a;
        --apr-muted: #64748b;
        --apr-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
        border: 1px solid var(--apr-border);
        border-radius: 16px;
        background:#fff;
        overflow: hidden;
        max-width: 100%;
        min-width: 0;
        box-shadow: var(--apr-shadow);
      }

      .apr-head {
        padding: 14px 16px;
        border-bottom: 1px solid var(--apr-border);
        display:flex;
        gap:12px;
        align-items:center;
        justify-content:space-between;
        flex-wrap:wrap;
        max-width: 100%;
        min-width: 0;
        background: linear-gradient(180deg, rgba(37,99,235,0.08), rgba(255,255,255,1));
      }
      .apr-title { font-size: clamp(16px, 2.2vw, 18px); font-weight: 900; letter-spacing: 0.01em; line-height: 1.25; flex: 1 1 auto; min-width: 0; word-break: break-word; }
      .apr-meta { font-size: 12px; color: var(--apr-muted); line-height: 1.4; }
      .apr-actions { display:flex; gap:8px; align-items:center; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; max-width: 100%; }

      .apr-btn {
        border:1px solid var(--apr-border);
        background:#fff;
        color: var(--apr-text);
        border-radius: 12px;
        padding: 8px 12px;
        font-size:13px;
        min-height: 36px;
        cursor:pointer;
        box-shadow: 0 1px 0 rgba(15,23,42,0.04);
        transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, transform .05s ease;
      }
      .apr-btn:hover { background: var(--apr-soft); border-color: #cbd5e1; }
      .apr-btn:active { transform: translateY(1px); }
      .apr-btn:focus-visible { outline: 3px solid rgba(37,99,235,0.25); outline-offset: 2px; }

      .apr-body { padding: 12px 16px 16px; max-width: 100%; min-width: 0; box-sizing: border-box; }

      .apr-tabs { display:flex; gap:8px; flex-wrap:wrap; margin: 0 0 12px; align-items: center; }

      /* 上部「表示ページ」: コンパクトなインライン行（大きすぎない） */
      #ap-ranking-switcher-v1 {
        margin: 0 0 6px;
      }
      #ap-ranking-switcher-v1 > .apr-main-tabs {
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
      }

      /* 表示ページ: 一覧タップ式（外枠はタブと同系の細いボーダーで統一） */
      .apr-main-tabs--page-switch {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 0;
        padding: 0;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        background: #fff;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
        overflow: hidden;
        box-sizing: border-box;
      }
      .apr-main-tabs--page-switch .apr-main-switch-label {
        display: block;
        flex: 0 0 auto;
        font-size: 10px;
        font-weight: 800;
        color: #475569;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        line-height: 1.1;
        margin: 0;
        padding: 8px 10px 6px 12px;
        border: 0;
        border-bottom: 1px solid #cbd5e1;
        background: linear-gradient(180deg, #f1f5f9 0%, #e2e8f0 100%);
        border-radius: 0;
      }
      .apr-page-switch-track {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
        gap: 1px;
        width: 100%;
        min-width: 0;
        padding: 1px;
        border: 0;
        border-top: 1px solid #cbd5e1;
        border-radius: 0;
        background: #cbd5e1;
        box-sizing: border-box;
      }
      .apr-page-switch-btn {
        position: relative;
        margin: 0;
        padding: 7px 6px;
        min-height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        line-height: 1.2;
        font-size: 12px;
        font-weight: 800;
        color: #475569;
        border: 1px solid #cbd5e1;
        border-radius: 4px;
        background: #f1f5f9;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: color 0.12s ease, background 0.15s ease, box-shadow 0.2s ease, border-color 0.15s ease;
      }
      .apr-page-switch-btn:hover {
        color: #0f172a;
        background: #fff;
        border-color: #94a3b8;
      }
      .apr-page-switch-btn[aria-selected="true"] {
        color: #0f172a;
        font-weight: 900;
        border: 1px solid #cbd5e1;
        background: #fff;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
        z-index: 1;
      }
      .apr-page-switch-btn[aria-selected="true"]:hover {
        border-color: #94a3b8;
        background: #fff;
      }
      .apr-page-switch-btn:focus-visible {
        outline: 2px solid #3b82f6;
        outline-offset: 2px;
        z-index: 2;
      }
      .apr-main-tabs--page-switch .apr-hint.apr-main-switch-label {
        display: block;
        font-size: 10px;
        font-weight: 800;
        color: #475569;
        line-height: 1.1;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin: 0;
        padding: 8px 10px 6px 12px;
        border: 0;
        border-bottom: 1px solid #cbd5e1;
        background: linear-gradient(180deg, #f1f5f9 0%, #e2e8f0 100%);
      }

      .apr-tab {
        border: 2px solid #cbd5e1;
        background: #fff;
        color: #1e293b;
        border-radius: 999px;
        padding: 10px 14px;
        font-size: 14px;
        font-weight: 800;
        min-height: 40px;
        cursor:pointer;
        transition: background-color .15s ease, border-color .15s ease, color .15s ease, box-shadow .15s ease, transform .08s ease;
        box-shadow: 0 1px 2px rgba(15,23,42,0.04);
      }
      .apr-tab:hover {
        background: #f8fafc;
        border-color: #94a3b8;
        color: #0f172a;
        box-shadow: 0 2px 6px rgba(15,23,42,0.08);
      }
      .apr-tab[aria-selected="true"] {
        border-color: rgba(37,99,235,0.55);
        background: linear-gradient(180deg, #eff6ff, #e0e7ff);
        color: #1e3a8a;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.8);
      }
      .apr-tab:focus-visible { outline: 3px solid rgba(37,99,235,0.35); outline-offset: 2px; }

      /* Period tabs (各月/四半期/期間指定/累計) / 表・ランキング: 選択を強調 */
      .apr-mode-tab[aria-selected="true"] {
        background: linear-gradient(135deg, #2563eb 0%, #4f46e5 55%, #7c3aed 100%);
        color:#fff;
        border-color: transparent;
        text-shadow: 0 1px 1px rgba(0,0,0,0.2);
        box-shadow: 0 6px 18px rgba(37,99,235,0.4), 0 1px 0 rgba(255,255,255,0.15) inset;
      }
      .apr-mode-tab[aria-selected="false"] {
        color: #475569;
        background: #fff;
      }

      /* カード内: 期間・表/ランキング 等の button 行をトラック＋浮き上がり選択 */
      .apr-card .apr-body > .apr-tabs:not(.apr-sales-hub-tabs) {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 6px 8px;
        margin: 0 0 10px;
        border: 1px solid #d1d5db;
        border-radius: 12px;
        background: #e2e8f0;
        box-shadow: inset 0 1px 3px rgba(15, 23, 42, 0.08);
      }
      .apr-card .apr-body > .apr-tabs:not(.apr-sales-hub-tabs) .apr-tab {
        border: 0;
        background: transparent;
        color: #64748b;
        box-shadow: none;
        margin: 0;
      }
      .apr-card .apr-body > .apr-tabs:not(.apr-sales-hub-tabs) .apr-tab[aria-selected="true"] {
        color: #1e1b4b;
        background: #fff;
        box-shadow: 0 1px 4px rgba(15, 23, 42, 0.1);
      }
      .apr-card .apr-body > .apr-tabs:not(.apr-sales-hub-tabs) .apr-mode-tab[aria-selected="false"] {
        background: transparent;
        color: #64748b;
      }
      .apr-card .apr-body > .apr-tabs:not(.apr-sales-hub-tabs) .apr-mode-tab[aria-selected="true"] {
        background: linear-gradient(180deg, #ffffff 0%, #f1f5f9 100%);
        box-shadow: 0 2px 8px rgba(37, 99, 235, 0.18), 0 0 0 1px rgba(99, 102, 241, 0.12);
        color: #1e1b4b;
        text-shadow: none;
      }
      .apr-card .apr-body > .apr-tabs + .apr-tabs {
        margin-top: 2px;
      }

      /* 営業ランキング: CL / AP セグメント切替（iOS 風、他の .apr-tabs には影響しない） */
      .apr-sales-hub-tabs {
        display: flex;
        width: 100%;
        max-width: min(500px, 100%);
        margin: 0 0 16px;
        padding: 4px;
        gap: 4px;
        border-radius: 14px;
        background: #e2e8f0;
        border: 1px solid #cbd5e1;
        box-shadow: inset 0 2px 4px rgba(15, 23, 42, 0.1);
        align-items: stretch;
        box-sizing: border-box;
      }
      .apr-sales-hub-tabs .apr-tab {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 1 1 0;
        min-width: 0;
        min-height: 44px;
        margin: 0;
        font-size: 15px;
        font-weight: 800;
        letter-spacing: 0.03em;
        padding: 10px 14px;
        border-radius: 10px;
        border: 0;
        color: #475569;
        background: transparent;
        box-shadow: none;
        transition: color .12s ease, background .15s ease, box-shadow .2s ease, transform .1s ease;
        cursor: pointer;
      }
      .apr-sales-hub-tabs .apr-tab[aria-selected="false"] { color: #64748b; }
      .apr-sales-hub-tabs .apr-tab[aria-selected="false"]:hover {
        color: #0f172a;
        background: rgba(255, 255, 255, 0.4);
      }
      .apr-sales-hub-tabs .apr-mode-tab[aria-selected="true"] {
        color: #1e1b4b;
        font-weight: 900;
        background: #fff;
        text-shadow: none;
        box-shadow:
          0 3px 12px rgba(15, 23, 42, 0.12),
          0 0 0 1px rgba(99, 102, 241, 0.18),
          inset 0 1px 0 rgba(255, 255, 255, 0.95);
        background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
        border: 0;
      }
      .apr-sales-hub-tabs .apr-mode-tab[aria-selected="true"]:active {
        transform: scale(0.99);
      }
      @media (max-width: 480px) {
        .apr-sales-hub-tabs { max-width: 100%; }
        .apr-sales-hub-tabs .apr-tab { min-height: 46px; font-size: 14px; }
      }

      /* Main switcher selected: high contrast, easy to read */
      .apr-main-tab {
        border-radius: 999px;
        font-weight: 900;
        letter-spacing: 0.01em;
        padding: 8px 14px;
        border-color: transparent;
        background: transparent;
        box-shadow: none;
      }
      .apr-main-tab + .apr-main-tab { margin-left: 2px; }
      .apr-main-tab[aria-selected="true"] {
        background: #ffffff;
        color: var(--apr-text);
        border-color: rgba(148,163,184,0.35);
        box-shadow: inset 0 0 0 1px rgba(148,163,184,0.20), 0 1px 2px rgba(15,23,42,0.08);
      }
      .apr-main-tab[aria-selected="false"] { color: rgba(15,23,42,0.78); }
      .apr-main-tab:hover { background: rgba(255,255,255,0.7); }
      .apr-main-tab:active { transform: translateY(0); }

      .apr-row { display:flex; gap:10px; align-items:center; justify-content:space-between; flex-wrap:wrap; margin: 0 0 10px; }
      .apr-tax-row { justify-content:flex-start; }
      .apr-sales-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 14px 16px;
        align-items: flex-end;
        margin: 0 0 14px;
        padding: 16px 18px;
        border: 1px solid rgba(148, 163, 184, 0.45);
        border-radius: 16px;
        background: linear-gradient(155deg, #ffffff 0%, #f8fafc 40%, #eef2f7 100%);
        box-shadow:
          0 4px 20px rgba(15, 23, 42, 0.07),
          inset 0 1px 0 rgba(255, 255, 255, 0.98);
        max-width: 100%;
        min-width: 0;
        box-sizing: border-box;
      }
      .apr-card .apr-body > .apr-sales-controls {
        position: relative;
        overflow: hidden;
      }
      .apr-card .apr-body > .apr-sales-controls::before {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        height: 3px;
        background: linear-gradient(90deg, #3b82f6, #6366f1, #8b5cf6);
        opacity: 0.85;
        border-radius: 16px 16px 0 0;
        pointer-events: none;
      }
      .apr-sales-control {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        gap: 8px 10px;
        align-items: center;
        min-width: 0;
      }
      .apr-sales-control .apr-hint {
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #64748b;
        margin: 0;
        white-space: nowrap;
        flex: 0 0 auto;
      }
      .apr-sales-control .apr-select {
        min-width: min(160px, 100%);
        max-width: 100%;
        border-radius: 10px;
        min-height: 40px;
        padding: 8px 12px 8px 14px;
      }
      .apr-sales-target { flex-wrap:wrap; }
      .apr-select, .apr-search {
        border: 2px solid #cbd5e1;
        border-radius: 12px;
        padding: 8px 12px;
        font-size: 13px;
        font-weight: 700;
        min-height: 38px;
        background: #fff;
        color: #0f172a;
        box-shadow: 0 1px 2px rgba(15,23,42,0.05);
        transition: border-color .15s ease, box-shadow .15s ease, background .15s ease;
      }
      .apr-select:hover, .apr-search:hover {
        border-color: #94a3b8;
        background: #fcfcfd;
      }
      .apr-select:focus-visible, .apr-search:focus-visible {
        outline: none;
        border-color: rgba(37,99,235,0.75);
        box-shadow: 0 0 0 3px rgba(37,99,235,0.2);
      }
      .apr-search { min-width: min(240px, 100%); width: min(560px, 100%); box-sizing: border-box; }
      .apr-hint {
        font-size: 12px;
        font-weight: 600;
        color: #64748b;
        line-height: 1.4;
        letter-spacing: 0.01em;
      }
      .apr-sales-control > .apr-hint:first-child,
      .apr-sales-controls > .apr-hint { color: #475569; }

      /* データ分析 / CL・AP ランキング: 期間は担当者検索の直下（折返し、横スクロールなし） */
      /* データ分析: カードの overflow:hidden が thead sticky を無効化するため、当該ウィジェットのみ緩める */
      #ap-sales-analysis-root-v1 .apr-card {
        overflow: visible;
        max-width: 100%;
        min-width: 0;
      }

      /*
       * 支社別集計: ポータル／埋め込み側の scroll コンテナや transform が原因で thead の viewport sticky が効かないことがあるため、
       * 表を内側スクロール枠に切り出し、そのスクロール口内で position:sticky が効くようにする。
       */
      #ap-sales-analysis-root-v1 .apr-table-wrap.apr-table-wrap--branch .apr-table-scroll-x {
        max-height: min(78vh, 920px);
        overflow-y: auto;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
        min-width: 0;
        width: 100%;
        max-width: 100%;
      }
      /* スマホ: 表内のネストスクロールは使わず、ページ全体のスクロールのみ */
      @media (max-width: 640px) {
        #ap-sales-analysis-root-v1 .apr-table-wrap.apr-table-wrap--branch .apr-table-scroll-x {
          max-height: none;
          overflow-x: visible;
          overflow-y: visible;
          overscroll-behavior: auto;
          scrollbar-gutter: auto;
        }
      }

      #ap-sales-analysis-root-v1 .apr-search-row,
      #ap-ranking-root-v4 .apr-search-row,
      #ap-apo-ranking-root-v1 .apr-search-row { margin-bottom: 2px; }
      #ap-sales-analysis-root-v1 .apr-period-hint-row,
      #ap-ranking-root-v4 .apr-period-hint-row,
      #ap-apo-ranking-root-v1 .apr-period-hint-row {
        margin: 0 0 10px;
        justify-content: flex-start;
      }
      #ap-sales-analysis-root-v1 .apr-period-hint-row .apr-hint,
      #ap-ranking-root-v4 .apr-period-hint-row .apr-hint,
      #ap-apo-ranking-root-v1 .apr-period-hint-row .apr-hint {
        width: 100%;
        white-space: normal;
        overflow: visible;
        word-break: break-word;
      }

      /* 個人別分析: 円＋凡例の2列を狭いPCでは縦積み、凡例ラベル領域を確保 */
      #ap-sales-analysis-root-v1 .apr-personal-pie-content > div:last-child {
        min-width: 0;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
      }
      #ap-sales-analysis-root-v1 .apr-personal-month-chart-bars {
        max-width: 100%;
        box-sizing: border-box;
      }
      @media (max-width: 1600px) {
        #ap-sales-analysis-root-v1 .apr-personal-pie-content {
          grid-template-columns: 1fr !important;
        }
      }

      /* 全体データ分析: セクション枠・表の格子罫線・スマホでも見切れ防止 */
      #ap-sales-analysis-root-v1 .apr-overall-analysis {
        display: grid;
        gap: 14px;
        min-width: 0;
        max-width: 100%;
        box-sizing: border-box;
      }
      #ap-sales-analysis-root-v1 .apr-overall-section {
        border: 1px solid #94a3b8;
        border-radius: 12px;
        padding: 12px 14px 14px;
        background: #fff;
        box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
        min-width: 0;
        max-width: 100%;
        box-sizing: border-box;
      }
      #ap-sales-analysis-root-v1 .apr-overall-section__title {
        font-size: 15px;
        font-weight: 900;
        color: #0f172a;
        margin: 0 0 10px;
        padding-bottom: 8px;
        border-bottom: 2px solid #94a3b8;
        letter-spacing: 0.02em;
        line-height: 1.35;
        word-break: break-word;
      }
      #ap-sales-analysis-root-v1 .apr-overall-table-wrap.apr-table-wrap {
        margin-top: 0;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        overflow: visible;
        background: #f1f5f9;
      }
      #ap-sales-analysis-root-v1 table.apr-table--overall-analysis {
        width: 100%;
        max-width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        font-size: 13px;
        border: none;
        background: #fff;
      }
      #ap-sales-analysis-root-v1 table.apr-table--overall-analysis thead th {
        position: static;
        background: linear-gradient(180deg, #f1f5f9 0%, #ffffff 100%);
        color: #334155;
        font-weight: 800;
        border: 1px solid #cbd5e1;
        padding: 10px 10px;
        vertical-align: middle;
        word-break: break-word;
        line-height: 1.3;
        box-shadow: none;
      }
      #ap-sales-analysis-root-v1 table.apr-table--overall-analysis tbody td {
        border: 1px solid #e2e8f0;
        padding: 9px 10px;
        vertical-align: top;
        word-break: break-word;
        overflow-wrap: anywhere;
        line-height: 1.35;
      }
      #ap-sales-analysis-root-v1 table.apr-table--overall-analysis tbody tr:nth-child(even) td {
        background: #f8fafc;
      }
      #ap-sales-analysis-root-v1 table.apr-table--overall-analysis .apr-name {
        width: 40%;
        font-weight: 700;
        color: #0f172a;
      }
      #ap-sales-analysis-root-v1 table.apr-table--overall-analysis .apr-num {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      #ap-sales-analysis-root-v1 .apr-overall-section--pie {
        padding-top: 14px;
        padding-bottom: 16px;
      }
      /* 円グラフ行：左列幅を揃え・凡例との縦位置を中央ぞろえ */
      #ap-sales-analysis-root-v1 .apr-overall-pie-slot {
        min-width: 0;
        margin: 0;
        padding: 0;
      }
      #ap-sales-analysis-root-v1 .apr-overall-section__title + .apr-overall-pie-slot {
        margin-top: 2px;
      }
      #ap-sales-analysis-root-v1 .apr-overall-pie-slot + .apr-overall-section__sub,
      #ap-sales-analysis-root-v1 .apr-overall-pie-slot + .apr-overall-pie-hint {
        margin-top: 16px;
      }
      #ap-sales-analysis-root-v1 .apr-overall-section__sub + .apr-overall-pie-hint {
        margin-top: 6px;
      }
      #ap-sales-analysis-root-v1 .apr-overall-section__sub + .apr-overall-pie-slot,
      #ap-sales-analysis-root-v1 .apr-overall-pie-hint + .apr-overall-pie-slot {
        margin-top: 10px;
      }
      #ap-sales-analysis-root-v1 .apr-overall-pie-hint {
        font-size: 12px;
        color: #64748b;
        line-height: 1.45;
        margin: 0;
        word-break: break-word;
      }
      #ap-sales-analysis-root-v1 .apr-overall-meeting-funnel .apr-overall-pie-hint {
        font-size: 12px;
        color: #64748b;
        line-height: 1.4;
        margin: 0 0 10px;
      }
      #ap-sales-analysis-root-v1 .apr-overall-pie-grid {
        display: grid;
        grid-template-columns: minmax(200px, 240px) minmax(0, 1fr);
        gap: 16px 22px;
        align-items: center;
        min-width: 0;
      }
      #ap-sales-analysis-root-v1 .apr-overall-pie-visual {
        display: flex;
        justify-content: center;
        align-items: center;
        min-width: 0;
        padding: 4px 0;
      }
      #ap-sales-analysis-root-v1 .apr-overall-pie-disk {
        width: min(180px, calc(100vw - 80px));
        height: min(180px, calc(100vw - 80px));
        max-width: 180px;
        max-height: 180px;
        border-radius: 50%;
        position: relative;
        box-sizing: border-box;
        margin: 0 auto;
      }
      #ap-sales-analysis-root-v1 .apr-overall-pie-disk-inner {
        position: absolute;
        inset: 18.89%;
        border-radius: 50%;
        background: linear-gradient(180deg, #ffffff, #f8fafc);
        border: 1px solid #d7e0ec;
        box-shadow: inset 0 1px 3px rgba(148,163,184,0.25), 0 2px 8px rgba(15,23,42,0.08);
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        font-size: 12px;
        color: #334155;
        font-weight: 700;
        line-height: 1.35;
        box-sizing: border-box;
      }
      #ap-sales-analysis-root-v1 .apr-overall-pie-legend {
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        padding: 10px 12px;
        background: #fafbfc;
        min-width: 0;
        max-width: 100%;
        box-sizing: border-box;
      }
      #ap-sales-analysis-root-v1 .apr-overall-section__sub {
        font-size: 13px;
        font-weight: 800;
        color: #0f172a;
        margin: 14px 0 8px;
        padding-top: 14px;
        border-top: 1px dashed #cbd5e1;
        line-height: 1.35;
        word-break: break-word;
      }
      #ap-sales-analysis-root-v1 .apr-overall-leg-label {
        font-size: 12px;
        color: #0f172a;
        white-space: normal;
        word-break: break-word;
        overflow-wrap: anywhere;
        line-height: 1.35;
      }
      #ap-sales-analysis-root-v1 .apr-overall-leg-value {
        font-size: 12px;
        color: #334155;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      @media (max-width: 640px) {
        #ap-sales-analysis-root-v1 .apr-overall-section {
          padding: 8px 8px 9px;
          border-radius: 10px;
        }
        #ap-sales-analysis-root-v1 .apr-overall-section__title {
          font-size: clamp(12px, 3.75vw, 14px);
          line-height: 1.32;
          margin-bottom: 6px;
          padding-bottom: 5px;
        }
        #ap-sales-analysis-root-v1 .apr-overall-analysis { gap: 10px; }
        #ap-sales-analysis-root-v1 .apr-overall-table-wrap.apr-table-wrap {
          margin-left: 0;
          margin-right: 0;
          border-radius: 8px;
        }
        #ap-sales-analysis-root-v1 table.apr-table--overall-analysis {
          table-layout: fixed;
          font-size: 11px;
        }
        /* 見出し: 列ごとに縮めて枠内に収める（1列目は長いので最小） */
        #ap-sales-analysis-root-v1 table.apr-table--overall-analysis thead th:nth-child(1) {
          font-size: clamp(9px, 2.85vw, 11px);
          font-weight: 800;
          line-height: 1.26;
          padding: 6px 4px;
          vertical-align: bottom;
          word-break: keep-all;
          overflow-wrap: anywhere;
          width: 40%;
        }
        #ap-sales-analysis-root-v1 table.apr-table--overall-analysis thead th:nth-child(2) {
          font-size: clamp(10px, 3.05vw, 11px);
          line-height: 1.26;
          padding: 6px 3px;
          word-break: keep-all;
          width: 20%;
        }
        #ap-sales-analysis-root-v1 table.apr-table--overall-analysis thead th:nth-child(3) {
          font-size: clamp(10px, 3.05vw, 11px);
          line-height: 1.26;
          padding: 6px 3px;
          word-break: keep-all;
          width: 20%;
        }
        #ap-sales-analysis-root-v1 table.apr-table--overall-analysis thead th:nth-child(4) {
          font-size: clamp(9px, 2.92vw, 10.5px);
          line-height: 1.26;
          padding: 6px 3px;
          word-break: keep-all;
          overflow-wrap: anywhere;
          width: 20%;
        }
        /* 項目列・数値列の本文 */
        #ap-sales-analysis-root-v1 table.apr-table--overall-analysis tbody td {
          padding: 6px 4px;
          line-height: 1.38;
          vertical-align: top;
          hyphens: none;
        }
        #ap-sales-analysis-root-v1 table.apr-table--overall-analysis tbody td.apr-name {
          width: 38%;
          font-size: clamp(10px, 3.15vw, 12px);
          font-weight: 700;
          line-height: 1.42;
          word-break: keep-all;
          overflow-wrap: anywhere;
          white-space: normal;
          box-sizing: border-box;
        }
        #ap-sales-analysis-root-v1 table.apr-table--overall-analysis tbody td.apr-num {
          width: auto;
          text-align: right;
          font-size: clamp(9.5px, 2.95vw, 11px);
          font-weight: 800;
          line-height: 1.38;
          white-space: normal;
          word-break: break-all;
          overflow-wrap: anywhere;
          letter-spacing: -0.02em;
          box-sizing: border-box;
        }
        /* 数値のみの列をやや細字に（桁が多くても枠優先で収まりやすく） */
        #ap-sales-analysis-root-v1 table.apr-table--overall-analysis tbody td.apr-num:nth-child(4) {
          font-size: clamp(9px, 2.75vw, 10.5px);
        }
        #ap-sales-analysis-root-v1 .apr-overall-pie-grid {
          grid-template-columns: 1fr;
          gap: 12px;
          align-items: start;
        }
        #ap-sales-analysis-root-v1 .apr-overall-pie-visual {
          justify-content: center;
        }
        #ap-sales-analysis-root-v1 .apr-overall-pie-legend {
          padding: 8px 8px;
        }
        #ap-sales-analysis-root-v1 .apr-overall-leg-row {
          padding: 5px 0 !important;
          gap: 6px !important;
        }
        #ap-sales-analysis-root-v1 .apr-overall-leg-label {
          font-size: clamp(9.5px, 3vw, 11px) !important;
          line-height: 1.4 !important;
        }
        #ap-sales-analysis-root-v1 .apr-overall-leg-value {
          font-size: clamp(9px, 2.85vw, 10.5px) !important;
          line-height: 1.38 !important;
          white-space: normal !important;
          text-align: right !important;
          max-width: 42%;
          word-break: break-all;
        }
        #ap-sales-analysis-root-v1 .apr-overall-pie-disk-inner {
          font-size: clamp(10px, 3.1vw, 12px);
        }
        #ap-sales-analysis-root-v1 .apr-overall-pie-disk {
          width: min(152px, calc(100vw - 72px));
          height: min(152px, calc(100vw - 72px));
        }
        #ap-sales-analysis-root-v1 .apr-overall-work-metrics {
          grid-template-columns: 1fr !important;
        }
        #ap-sales-analysis-root-v1 .apr-overall-guide-results {
          grid-template-columns: 1fr !important;
        }
        #ap-sales-analysis-root-v1 .apr-overall-meeting-guide-results {
          grid-template-columns: 1fr !important;
        }
      }

      .apr-badges { display:flex; flex-wrap:wrap; gap: 6px; margin: 0 0 10px; }
      .apr-badge {
        display:inline-block;
        border:1px solid rgba(37,99,235,0.18);
        border-radius: 999px;
        padding: 4px 10px;
        font-size:12px;
        color: #1e3a8a;
        background: rgba(37,99,235,0.08);
      }

      /* CL / AP 全体集計（表の上） */
      .apr-total-panel {
        margin: 0 0 12px;
        padding: 12px 14px 14px;
        border: 1px solid var(--apr-border);
        border-radius: 14px;
        background: linear-gradient(180deg, #f8fafc, #fff);
        box-shadow: 0 1px 2px rgba(15,23,42,0.04);
        max-width: 100%;
        min-width: 0;
        box-sizing: border-box;
      }
      .apr-total-panel__head {
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #64748b;
        margin: 0 0 10px;
        padding-bottom: 8px;
        border-bottom: 1px solid #e2e8f0;
      }
      .apr-total-panel__grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 10px 12px;
        align-items: start;
      }
      .apr-total-block {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 10px 12px 12px;
        border-left: 3px solid rgba(37,99,235,0.5);
        min-width: 0;
      }
      .apr-total-block__title {
        font-size: 12px;
        font-weight: 800;
        color: #0f172a;
        margin: 0 0 8px;
        line-height: 1.3;
      }
      .apr-total-block__metrics {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .apr-total-metric {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px 10px;
        align-items: baseline;
        font-size: 12px;
        line-height: 1.35;
        border-bottom: 1px solid #f1f5f9;
        padding-bottom: 5px;
      }
      .apr-total-metric:last-child { border-bottom: none; padding-bottom: 0; }
      .apr-total-metric__k { color: #64748b; font-weight: 600; }
      .apr-total-metric__v { color: #0f172a; font-weight: 800; text-align: right; font-variant-numeric: tabular-nums; }
      @media (max-width: 420px) {
        .apr-total-panel { padding: 10px; }
        .apr-total-panel__grid { grid-template-columns: 1fr; }
      }

      .apr-table-wrap {
        overflow-x: visible;
        border: 1px solid var(--apr-border);
        border-radius: 14px;
        background: #fff;
        max-width: 100%;
        min-width: 0;
        box-sizing: border-box;
      }
      /* Table base (PC) */
      .apr-table { width:100%; border-collapse: separate; border-spacing: 0; font-size: clamp(12px, 1.2vw, 14px); }
      .apr-table th, .apr-table td { padding: 10px 10px; border-bottom: 1px solid var(--apr-border); vertical-align: top; }
      .apr-table thead th {
        position: sticky;
        top: 0;
        z-index: 1;
        text-align:left;
        color:#334155;
        font-weight: 900;
        background: linear-gradient(180deg, #f8fafc, #ffffff);
      }
      .apr-table tbody tr:nth-child(odd) { background: rgba(15,23,42,0.02); }
      .apr-table tbody tr:hover { background: rgba(37,99,235,0.06); }
      .apr-rank { width: 56px; }
      .apr-name { width: 36%; }
      .apr-num { text-align:right; font-variant-numeric: tabular-nums; }
      .apr-table tbody tr:nth-child(1) .apr-rank { color: #b45309; font-weight: 900; }
      .apr-table tbody tr:nth-child(2) .apr-rank { color: #0f766e; font-weight: 900; }
      .apr-table tbody tr:nth-child(3) .apr-rank { color: #1d4ed8; font-weight: 900; }
      .apr-muted { color: var(--apr-muted); }
      .apr-err { color:#b00020; font-size: 12px; }
      .apr-empty { padding: 10px 0; color: var(--apr-muted); font-size: 13px; }
      .apr-crown { display: block; margin-bottom: 2px; font-size: 1.5em; line-height: 1; }
      .apr-crown.apr-crown--inline {
        display: inline-block;
        margin: 0;
        vertical-align: middle;
        font-size: 1.12em;
        line-height: 1;
      }
      .apr-table tbody td.apr-name .apr-name-line {
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
        gap: 4px;
        max-width: 100%;
        min-width: 0;
      }
      .apr-table tbody td.apr-name .apr-name-text {
        min-width: 0;
      }
      .apr-target-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 6px;
      }
      .apr-target-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: 1px solid rgba(148,163,184,0.45);
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 11px;
        color: #334155;
        background: #f8fafc;
      }
      .apr-target-scroll {
        margin-top: 6px;
        max-height: none;
        overflow: visible;
        -webkit-overflow-scrolling: touch;
      }
      .apr-target-list {
        min-width: 0;
        border: none;
        border-radius: 0;
        background: transparent;
        overflow: visible;
      }
      .apr-target-head { display: none; }
      .apr-target-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px 14px;
        padding: 10px 12px;
        font-size: 12px;
        line-height: 1.45;
        border: 1px solid rgba(148,163,184,0.35);
        border-radius: 12px;
        background: #fff;
      }
      .apr-target-row + .apr-target-row { margin-top: 8px; }
      .apr-target-row:hover { border-color: rgba(37,99,235,0.45); background: rgba(239,246,255,0.6); }
      .apr-target-cell {
        display: flex;
        align-items: flex-start;
        justify-content: flex-start;
        gap: 6px;
        min-width: 0;
      }
      .apr-target-cell::before {
        content: attr(data-label) "：";
        color: #64748b;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.01em;
        flex: 0 0 auto;
        min-width: 5.5em;
      }
      .apr-target-cell--num { text-align: left; font-variant-numeric: tabular-nums; }
      .apr-target-cell--center { text-align: left; }
      .apr-target-cell--name {
        white-space: normal;
        word-break: break-word;
        text-align: left;
      }
      .apr-target-cell--date {
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        text-align: left;
      }
      .apr-target-cell--route {
        white-space: normal;
        overflow: visible;
        text-overflow: clip;
        color: #334155;
        text-align: left;
        word-break: break-word;
      }
      .apr-target-inline-row { display: table-row; }
      .apr-target-inline-cell {
        padding: 6px 10px 12px;
        background: rgba(148,163,184,0.06);
      }
      .apr-table--sales.apr-table--branch tbody tr.apr-target-inline-row .apr-target-inline-cell {
        min-width: 0;
      }

      /* PC: テーブル全体のフォントを大きくして見やすく */
      .apr-table { font-size: 15px; }
      .apr-table thead th { font-size: 14px; padding: 12px 14px; }
      .apr-table tbody td { font-size: 15px; padding: 11px 14px; }
      .apr-table .apr-name { font-size: 15px; font-weight: 800; }
      .apr-table .apr-num { font-size: 15px; }

      .apr-table tbody tr.apr-subtotal { background: rgba(37,99,235,0.12); font-weight: 700; font-size: 15px; }
      .apr-table tbody tr.apr-subtotal td { border-top: 2px solid rgba(37,99,235,0.35); padding: 12px 14px; }
      .apr-table tbody tr.apr-subtotal .apr-subtotal-label { font-size: 18px; font-weight: 900; color: #1e40af; letter-spacing: 0.02em; text-align: left; }
      .apr-table tbody tr.apr-subtotal .apr-num { font-size: 15px; font-weight: 800; }

      @media (max-width: 980px) {
        .apr-search { width: 100%; min-width: 0; }
        .apr-table tbody tr.apr-subtotal .apr-subtotal-label { font-size: 15px; }
      }

      /* Compact key-value: PCでやや大きく */
      .apr-kv { display:flex; justify-content:space-between; gap: 10px; }
      .apr-k { color: var(--apr-muted); font-weight: 800; font-size: 12px; text-align: left; }
      .apr-v { color: var(--apr-text); font-weight: 900; font-size: 14px; }

      /* Chart */
      .apr-chart {
        border: 1px solid var(--apr-border);
        border-radius: 14px;
        padding: 12px;
        background: linear-gradient(180deg, rgba(248,250,252,0.9), #ffffff);
        max-width: 100%;
        min-width: 0;
        overflow-x: visible;
        box-sizing: border-box;
      }
      .apr-chart-head { font-weight: 900; color: #0f172a; margin: 0 0 4px; }
      .apr-chart-sub { font-size: 12px; color: var(--apr-muted); margin: 0 0 10px; }
      .apr-chart-list { display:flex; flex-direction: column; gap: 8px; min-width: 0; }
      .apr-chart-row {
        display:grid;
        grid-template-columns: 34px minmax(0, 1fr) minmax(0, 2fr) auto;
        gap: 10px;
        align-items: center;
        padding: 8px 10px;
        border-radius: 12px;
        background: rgba(15,23,42,0.02);
      }
      .apr-chart-row:hover { background: rgba(37,99,235,0.06); }
      .apr-chart-rank {
        width: 34px;
        height: 28px;
        display:flex;
        align-items:center;
        justify-content:center;
        border-radius: 10px;
        font-weight: 900;
        color: #334155;
        background: rgba(15,23,42,0.04);
      }
      .apr-chart-name { font-weight: 800; color: #0f172a; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
      .apr-chart-bar {
        height: 10px;
        border-radius: 999px;
        background: rgba(148,163,184,0.30);
        overflow:hidden;
        min-width: 0;
      }
      .apr-chart-fill {
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, var(--apr-accent), var(--apr-accent-2));
      }
      .apr-chart-val { font-size: 12px; color: #334155; white-space: nowrap; min-width: 0; }
      .apr-chart-subval { margin-top: 2px; font-size: 11px; color: var(--apr-muted); white-space: normal; }

      /* Rank visualization (graph mode) */
      .apr-rankviz { padding: 14px; }
      .apr-ranklist { display:flex; flex-direction: column; gap: 6px; margin-top: 6px; }
      .apr-rankitem {
        display:flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 6px;
        padding: 8px 10px;
        border-radius: 12px;
        background: rgba(15,23,42,0.02);
        min-width: 0;
        box-sizing: border-box;
      }
      .apr-rankitem:hover { background: rgba(37,99,235,0.06); }
      .apr-rankpos { font-weight: 900; color: #334155; white-space: nowrap; }
      .apr-rankname { font-weight: 900; color: #0f172a; min-width: 0; flex: 1 1 9em; overflow-wrap: anywhere; word-break: break-word; }
      .apr-rankpt { font-weight: 800; color: #1e3a8a; }

      /* Size hierarchy: 1 big, 2 large, 3 medium, 4-10 small */
      .apr-rankitem--1 { font-size: 20px; }
      .apr-rankitem--2 { font-size: 18px; }
      .apr-rankitem--3 { font-size: 16px; }
      .apr-rankitem--4,
      .apr-rankitem--5,
      .apr-rankitem--6,
      .apr-rankitem--7,
      .apr-rankitem--8,
      .apr-rankitem--9,
      .apr-rankitem--10 { font-size: 14px; }
      .apr-meeting-status-section {
        position: static;
        padding-bottom: 0;
      }
      .apr-meeting-status-help {
        font-size: 11px;
        color: #64748b;
        text-align: right;
        position: relative;
        margin-top: -20px;
        margin-bottom: 6px;
        padding-right: 0;
        z-index: 5;
      }
      .apr-kpi-tile {
        min-height: 72px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .apr-kpi-guide-tile {
        min-height: 76px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .apr-kpi-label {
        font-size: 11px;
        color: #475569;
      }
      .apr-kpi-sub-label {
        font-size: 11px;
        color: #64748b;
      }
      .apr-kpi-value {
        font-size: 18px;
        font-weight: 800;
        color: #0f172a;
        line-height: 1.2;
      }
      .apr-col-apo { grid-column: 1; }
      .apr-col-meeting { grid-column: 2; }
      .apr-col-pt { grid-column: 3; }
      /* Desktop zoom safety: prevent layout collapse while zoomed in */
      @media (max-width: 1400px) {
        .apr-personal-three-col {
          grid-template-columns: repeat(2, minmax(320px, 1fr)) !important;
        }
        .apr-col-apo { grid-column: 1; }
        .apr-col-meeting { grid-column: 2; }
        .apr-col-pt { grid-column: 1 / -1; }
      }
      @media (max-width: 1180px) {
        .apr-personal-three-col {
          grid-template-columns: 1fr !important;
        }
        .apr-col-apo,
        .apr-col-meeting,
        .apr-col-pt { grid-column: 1 !important; }
        .apr-personal-pie-content {
          grid-template-columns: 1fr !important;
          gap: 10px !important;
        }
        .apr-meeting-status-help {
          margin-top: 8px;
          margin-bottom: 0;
          text-align: right;
        }
      }

      @media (max-width: 640px) {
        #ap-ranking-switcher-v1 {
          margin: 0 0 2px;
        }
        #ap-ranking-switcher-v1 .apr-main-tabs--page-switch .apr-main-switch-label,
        #ap-ranking-switcher-v1 .apr-main-tabs--page-switch .apr-hint.apr-main-switch-label {
          font-size: 9px;
          line-height: 1.05;
          padding: 6px 8px 5px 10px;
        }
        #ap-ranking-switcher-v1 .apr-page-switch-track {
          display: flex;
          flex-direction: row;
          flex-wrap: nowrap;
          align-items: stretch;
          gap: 1px;
          padding: 1px;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: thin;
        }
        #ap-ranking-switcher-v1 .apr-page-switch-btn {
          flex: 1 0 0;
          min-width: 0;
          min-height: 32px;
          font-size: 11px;
          padding: 5px 4px;
        }
        #ap-sales-analysis-root-v1 .apr-search-row .apr-search,
        #ap-ranking-root-v4 .apr-search-row .apr-search,
        #ap-apo-ranking-root-v1 .apr-search-row .apr-search {
          width: 100%;
          min-width: 0;
        }
        #ap-sales-analysis-root-v1 .apr-period-hint-row .apr-hint,
        #ap-ranking-root-v4 .apr-period-hint-row .apr-hint,
        #ap-apo-ranking-root-v1 .apr-period-hint-row .apr-hint {
          font-size: 11px;
        }
        .apr-main-tab { flex-shrink: 0; white-space: nowrap; font-size: 11px; padding: 5px 9px; min-height: 30px; }
        .apr-sales-controls { gap: 6px; margin-bottom: 6px; padding: 8px 10px; }
        /* 営業データ分析: スマホは縦の占有を詰める（表は親ページのみスクロール、スライド／ネストスクロールなし） */
        #ap-sales-analysis-root-v1.apr-wrap { margin-top: 8px; margin-bottom: 12px; }
        #ap-sales-analysis-root-v1 .apr-head { padding: 9px 12px 8px; gap: 10px; }
        #ap-sales-analysis-root-v1 .apr-body { padding: 6px 10px 10px; }
        #ap-sales-analysis-root-v1 .apr-period-hint-row,
        #ap-sales-analysis-root-v1.apr-wrap .apr-period-hint-row { margin: 0 0 5px !important; }
        #ap-sales-analysis-root-v1 .apr-tabs { margin: 0 0 8px; gap: 6px; }
        #ap-sales-analysis-root-v1 .apr-badges { margin: 0 0 5px; gap: 5px; }
        #ap-sales-analysis-root-v1 .apr-badge { padding: 3px 8px; font-size: 11px; }
        #ap-sales-analysis-root-v1 .apr-total-panel {
          margin: 0 0 7px;
          padding: 7px 9px 8px;
          border-radius: 11px;
        }
        #ap-sales-analysis-root-v1 .apr-total-panel__head {
          margin: 0 0 5px;
          padding-bottom: 5px;
        }
        #ap-sales-analysis-root-v1 .apr-total-panel__grid {
          gap: 5px 8px;
        }
        #ap-sales-analysis-root-v1 .apr-total-block {
          padding: 6px 8px 7px;
          border-radius: 8px;
        }
        #ap-sales-analysis-root-v1 .apr-total-block__title {
          margin: 0 0 4px;
        }
        #ap-sales-analysis-root-v1 .apr-total-block__metrics {
          gap: 3px;
        }
        #ap-sales-analysis-root-v1 .apr-total-metric {
          padding-bottom: 3px;
          line-height: 1.25;
          gap: 6px 8px;
        }
        .apr-wrap { margin-top: 10px; margin-bottom: 14px; }
        .apr-card .apr-head { padding: 11px 13px 10px; gap: 10px; }
        .apr-card .apr-body { padding: 8px 12px 11px; }
        .apr-sales-control {
          flex: 1 1 calc(50% - 6px);
          min-width: 150px;
          flex-direction: column;
          align-items: stretch;
          gap: 4px;
        }
        .apr-sales-target {
          flex: 1 1 100%;
          flex-direction: row;
          align-items: center;
        }
        .apr-sales-control .apr-select {
          width: 100%;
          min-width: 0;
          min-height: 32px;
          font-size: 12px;
          padding: 6px 10px;
        }
        .apr-sales-control .apr-hint { font-size: 11px; }
        .apr-chart-row { grid-template-columns: 30px 1fr; grid-template-rows: auto auto auto; }
        .apr-chart-bar { grid-column: 1 / -1; }
        .apr-chart-val { grid-column: 1 / -1; white-space: normal; }
        /* Mobile: reduce overall text size so rank #1 doesn't wrap */
        .apr-rankitem { padding: 7px 9px; }
        .apr-rankitem--1 { font-size: 16px; }
        .apr-rankitem--2 { font-size: 15px; }
        .apr-rankitem--3 { font-size: 14px; }
        .apr-rankitem--4,
        .apr-rankitem--5,
        .apr-rankitem--6,
        .apr-rankitem--7,
        .apr-rankitem--8,
        .apr-rankitem--9,
        .apr-rankitem--10 { font-size: 12px; }
        .apr-target-head,
        .apr-target-row { padding: 5px 8px; gap: 6px; font-size: 11px; }
        .apr-target-list { min-width: 460px; }
        .apr-target-scroll { max-height: 300px; }

        /* Personal analysis: mobile-friendly layout (PC unchanged) */
        .apr-personal-pie-grid {
          grid-template-columns: 1fr !important;
          gap: 10px !important;
        }
        .apr-personal-pie-content {
          grid-template-columns: 1fr !important;
          gap: 8px !important;
        }
        .apr-personal-detail-layout {
          grid-template-columns: 1fr !important;
          gap: 10px !important;
        }
        .apr-personal-detail-pie-wrap {
          grid-template-columns: 1fr !important;
          gap: 8px !important;
        }
        .apr-personal-work-card {
          padding: 10px !important;
        }
        .apr-personal-work-metrics {
          grid-template-columns: 1fr !important;
          gap: 6px !important;
        }
        .apr-meeting-work-metrics {
          grid-template-columns: 1fr !important;
          gap: 6px !important;
        }
        .apr-personal-guide-rates {
          gap: 6px !important;
        }
        .apr-personal-guide-results {
          grid-template-columns: 1fr !important;
          gap: 6px !important;
        }
        .apr-meeting-guide-results {
          grid-template-columns: 1fr !important;
          gap: 6px !important;
        }
        .apr-personal-three-col {
          grid-template-columns: 1fr !important;
          gap: 10px !important;
        }
        .apr-personal-rank-card-grid {
          grid-template-columns: 1fr !important;
          gap: 8px !important;
        }
        .apr-meeting-status-section {
          position: static;
          padding-bottom: 0;
        }
        .apr-meeting-status-help {
          position: static;
          margin-top: 8px;
        }
      }

      /* Default (PC): hide compact mobile columns (sales / apo table) */
      .apr-table--sales .apr-col-m1,
      .apr-table--sales .apr-col-m2 { display: none !important; }
      /* 営業データ分析 PC: 横スクロールなしのため折り返し（ランキングは rank-bordered 側で上書き） */
      #ap-sales-analysis-root-v1 .apr-table--sales thead th,
      #ap-sales-analysis-root-v1 .apr-table--sales tbody td {
        white-space: normal !important;
        word-break: break-word;
        overflow-wrap: anywhere;
      }
      /* CL/AP ランキング（格子罫線以外の表は従来どおり1行） */
      .apr-table--sales:not(.apr-table--rank-bordered) thead th,
      .apr-table--sales:not(.apr-table--rank-bordered) tbody td { white-space: nowrap; }
      /* APランキング PC: 格子罫線以外は見出しを1行で表示 */
      .apr-table--apo:not(.apr-table--rank-bordered) thead th { white-space: nowrap !important; }
      .apr-table--apo .apr-col-apo-m1 { display: none !important; }
      .apr-table--apo .apr-crown { font-size: 2.2em; }
      .apr-table--apo .apr-crown.apr-crown--inline { font-size: 1.12em; }

      /* CL / AP ランキング: 担当者列の名前を中央 */
      .apr-table--sales.apr-table--rank-bordered thead th.apr-name,
      .apr-table--sales.apr-table--rank-bordered tbody td.apr-name {
        text-align: center !important;
      }
      .apr-table--sales.apr-table--rank-bordered tbody td.apr-name .apr-name-line {
        justify-content: center;
        width: 100%;
        max-width: 100%;
      }
      .apr-table--apo thead th.apr-name,
      .apr-table--apo tbody td.apr-name {
        text-align: center !important;
      }
      .apr-table--apo tbody td.apr-name .apr-name-line {
        justify-content: center;
        width: 100%;
        max-width: 100%;
      }

      @media (min-width: 641px) {
      /* CLランキング / APランキング: データ分析に近い格子罫線（PCのみ。スマホは従来の下線のみ） */
      .apr-table-wrap.apr-table-wrap--rank-bordered {
        border-color: #94a3b8;
        border-radius: 12px;
        box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-gutter: stable;
        max-width: 100%;
        min-width: 0;
      }
      .apr-table--rank-bordered {
        border-collapse: collapse;
        border-spacing: 0;
        border: 1px solid #94a3b8;
        /* fixed+100% だと列が潰れ数値が縦組みになるため auto（広いときは親で横スクロール） */
        table-layout: auto;
        width: max-content;
        min-width: 100%;
      }
      .apr-table--rank-bordered thead th {
        position: sticky;
        top: 0;
        z-index: 3;
        text-align: center !important;
        vertical-align: middle;
        color: #334155;
        font-weight: 800;
        padding: 9px 4px;
        border: 1px solid #cbd5e1;
        border-bottom: 2px solid #94a3b8;
        background-color: #f8fafc;
        background-image: linear-gradient(180deg, #f1f5f9 0%, #ffffff 100%);
        box-shadow: 0 2px 5px rgba(15, 23, 42, 0.08);
      }
      .apr-table--rank-bordered thead th.apr-rank,
      .apr-table--rank-bordered tbody td.apr-rank {
        width: 3.1rem;
        min-width: 3rem;
        max-width: 3.75rem;
        box-sizing: border-box;
        text-align: center !important;
      }
      .apr-table--rank-bordered thead th.apr-name,
      .apr-table--rank-bordered tbody td.apr-name {
        width: 13%;
        max-width: 132px;
        min-width: 6rem;
        box-sizing: border-box;
      }
      /* CLランキング: 平均単価列は見出し2行まで、列を極端に狭めない */
      .apr-table--sales.apr-table--rank-bordered thead th.apr-col-avg {
        min-width: 6.75rem !important;
        max-width: 9rem;
        white-space: normal;
        word-break: keep-all;
        overflow-wrap: normal;
        line-height: 1.22;
        padding-left: 4px !important;
        padding-right: 4px !important;
      }
      .apr-table--sales.apr-table--rank-bordered tbody td.apr-col-avg {
        padding-left: 6px;
        padding-right: 6px;
        white-space: nowrap;
        word-break: normal;
      }
      /* 見出し: 単語単位で改行し、1文字縦積みを防ぐ */
      .apr-table--rank-bordered thead th.apr-num:not(.apr-col-m1):not(.apr-col-m2):not(.apr-col-apo-m1) {
        white-space: normal;
        word-break: keep-all;
        overflow-wrap: normal;
        line-height: 1.2;
        min-width: 4.5rem;
        width: auto;
      }
      .apr-table--rank-bordered thead th.apr-col-apo-m1 {
        white-space: normal;
        word-break: keep-all;
        overflow-wrap: normal;
        line-height: 1.2;
        min-width: 8rem;
        width: auto;
      }
      .apr-table--rank-bordered tbody td.apr-col-apo-m1 {
        width: auto;
        min-width: 0;
      }
      .apr-table--rank-bordered thead th.apr-col-m1 {
        white-space: normal;
        word-break: keep-all;
        overflow-wrap: normal;
        min-width: 7rem;
      }
      .apr-table--apo.apr-table--rank-bordered thead th {
        white-space: normal !important;
        word-break: keep-all;
        overflow-wrap: normal;
        line-height: 1.2;
        min-width: 4.25rem;
      }
      .apr-table--rank-bordered tbody td {
        vertical-align: middle;
        padding: 8px 6px;
        border: 1px solid #e2e8f0;
        background-color: #fff;
        line-height: 1.25;
      }
      .apr-table--rank-bordered tbody td.apr-num {
        white-space: nowrap;
        word-break: normal;
        overflow-wrap: normal;
        font-variant-numeric: tabular-nums;
      }
      .apr-table--rank-bordered tbody td.apr-rank {
        white-space: nowrap;
      }
      .apr-table--rank-bordered tbody td.apr-name {
        white-space: normal;
        word-break: break-word;
        overflow-wrap: anywhere;
      }
      .apr-table--rank-bordered tbody tr:nth-child(odd) td {
        background: #fafbfc;
      }
      .apr-table--rank-bordered tbody tr:nth-child(even) td {
        background: #fff;
      }
      .apr-table--rank-bordered tbody tr:hover td {
        background: rgba(37, 99, 235, 0.06);
      }
      .apr-table--rank-bordered tbody tr {
        background: transparent;
      }
      .apr-table--sales.apr-table--rank-bordered thead th.apr-col-sales {
        min-width: 8rem;
      }
      .apr-table--sales.apr-table--rank-bordered thead th.apr-col-cl-pacemaker {
        min-width: 8rem;
      }
      }

      /* 支社別集計 PC（641px以上）: 横スクロールなしのため折り返し */
      @media (min-width: 641px) {
        .apr-table-wrap.apr-table-wrap--branch {
          overflow: visible;
          max-width: 100%;
          min-width: 0;
        }
        .apr-table-wrap.apr-table-wrap--branch .apr-table-scroll-x {
          overflow-x: visible;
          overflow-y: visible;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          -webkit-overflow-scrolling: touch;
        }
        .apr-table.apr-table--branch {
          table-layout: fixed;
          width: 100%;
          min-width: 0;
          max-width: 100%;
          font-size: clamp(11px, 0.88vw, 13px);
          /* collapse は thead の position:sticky と相性が悪いため separate（罫線は各セルの border で維持） */
          border-collapse: separate;
          border-spacing: 0;
          border: 1px solid #94a3b8;
          box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
        }
        .apr-table.apr-table--branch thead th {
          position: sticky;
          top: 0;
          z-index: 28;
          font-size: clamp(10px, 0.8vw, 12px);
          font-weight: 800;
          color: #334155;
          padding: 10px 5px 9px;
          line-height: 1.2;
          white-space: normal;
          word-break: break-word;
          overflow-wrap: anywhere;
          overflow: visible;
          text-overflow: clip;
          vertical-align: middle;
          text-align: center;
          border: 1px solid #cbd5e1;
          border-bottom: 2px solid #94a3b8;
          background-color: #f8fafc;
          background-image: linear-gradient(180deg, #f1f5f9 0%, #ffffff 100%);
          box-shadow: 0 2px 5px rgba(15, 23, 42, 0.1);
        }
        /* 支社別: 平均単価見出しを2行・中央寄せ（PC thead） */
        .apr-table.apr-table--branch thead th.apr-col-avg .apr-th-avg-multiline {
          display: block;
          text-align: center;
          font-weight: 800;
          line-height: 1.35;
        }
        .apr-table.apr-table--branch tbody td {
          padding: 8px 5px;
          line-height: 1.35;
          vertical-align: middle;
          border: 1px solid #e2e8f0;
          color: #0f172a;
        }
        .apr-table.apr-table--branch tbody td.apr-num {
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
          text-align: right;
        }
        .apr-table.apr-table--branch tbody td.apr-name {
          text-align: center;
          font-weight: 800;
        }
        .apr-table.apr-table--branch tbody td.apr-name .apr-name-line {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          max-width: 100%;
          min-width: 0;
        }
        .apr-table.apr-table--branch tbody td.apr-name .apr-crown--inline {
          display: inline-block;
          flex-shrink: 0;
          margin: 0;
          font-size: 1.12em;
          line-height: 1;
          vertical-align: middle;
        }
        .apr-table.apr-table--branch tbody td.apr-name .apr-name-text {
          overflow: visible;
          text-overflow: clip;
          white-space: normal;
          word-break: break-word;
          overflow-wrap: anywhere;
          line-height: 1.35;
          min-width: 0;
        }
        .apr-table.apr-table--branch tbody td.apr-subtotal-label {
          text-align: center;
          vertical-align: middle;
        }
        .apr-table.apr-table--branch .apr-name {
          width: 13%;
          min-width: 5.5em;
          max-width: none;
          white-space: normal;
          word-break: break-word;
          overflow: visible;
          text-overflow: clip;
          line-height: 1.3;
        }
        .apr-table.apr-table--branch .apr-col-branch {
          width: 5.2em;
          white-space: nowrap;
        }
        /* PC: PT ブロックとアポブロックの境界 */
        .apr-table.apr-table--branch thead th.apr-col-apo-goal,
        .apr-table.apr-table--branch tbody td.apr-col-apo-goal {
          border-left: 2px solid rgba(67, 56, 202, 0.42);
        }
        .apr-table.apr-table--branch tbody tr:nth-child(odd):not(.apr-subtotal) {
          background: #fafbfc;
        }
        .apr-table.apr-table--branch tbody tr:nth-child(even):not(.apr-subtotal) {
          background: #fff;
        }
        .apr-table.apr-table--branch tbody tr:not(.apr-subtotal):hover {
          background: rgba(37, 99, 235, 0.07);
        }
        .apr-table.apr-table--branch tbody tr.apr-subtotal {
          font-size: inherit;
          background: linear-gradient(180deg, rgba(219, 234, 254, 0.65) 0%, rgba(239, 246, 255, 0.9) 100%);
        }
        .apr-table.apr-table--branch tbody tr.apr-subtotal td {
          padding: 10px 5px;
          border: 1px solid #93c5fd;
          border-top: 2px solid #3b82f6;
          font-weight: 800;
        }
        .apr-table.apr-table--branch tbody tr.apr-subtotal .apr-subtotal-label {
          font-size: clamp(12px, 1vw, 15px);
          font-weight: 900;
          color: #1e40af;
          white-space: normal;
          line-height: 1.35;
        }
        .apr-table.apr-table--branch tbody tr.apr-subtotal .apr-num {
          font-size: inherit;
          font-weight: 800;
        }
        /* 営業データ分析・支社別: 「指標」列 PT/アポ カード（PC） */
        .apr-table--sales.apr-table--branch .apr-col-m1 {
          text-align: left;
          vertical-align: top !important;
          white-space: normal !important;
          padding: 8px 6px !important;
          box-sizing: border-box;
          min-width: 0;
        }
        .apr-table--sales.apr-table--branch .apr-col-m1.apr-num {
          white-space: normal !important;
          text-align: left;
          font-variant-numeric: unset;
        }
        .apr-table--sales.apr-table--branch .apr-m1-stack--split {
          display: flex;
          flex-direction: column;
          gap: 9px;
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect {
          border-radius: 10px;
          overflow: hidden;
          border: 1px solid rgba(15, 23, 42, 0.1);
          box-shadow: 0 2px 6px rgba(15, 23, 42, 0.05);
          background: rgba(255, 255, 255, 0.95);
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect--pt {
          background: linear-gradient(180deg, rgba(254, 243, 199, 0.35) 0%, rgba(255, 255, 255, 0.98) 55%, rgba(255, 250, 230, 0.25) 100%);
          border-color: rgba(180, 83, 9, 0.22);
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect--apo {
          background: linear-gradient(180deg, rgba(224, 231, 255, 0.42) 0%, rgba(255, 255, 255, 0.98) 55%, rgba(238, 242, 255, 0.35) 100%);
          border-color: rgba(67, 56, 202, 0.22);
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect__head {
          font-size: clamp(10px, 0.78vw, 11px);
          font-weight: 900;
          letter-spacing: 0.05em;
          padding: 6px 10px 5px;
          line-height: 1.3;
          text-align: center;
          text-transform: none;
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect--pt .apr-m1-sect__head {
          color: #92400e;
          background: linear-gradient(180deg, rgba(251, 191, 36, 0.25) 0%, rgba(254, 240, 138, 0.12) 100%);
          border-bottom: 1px solid rgba(180, 83, 9, 0.12);
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect--apo .apr-m1-sect__head {
          color: #3730a3;
          background: linear-gradient(180deg, rgba(129, 140, 248, 0.22) 0%, rgba(199, 210, 254, 0.12) 100%);
          border-bottom: 1px solid rgba(67, 56, 202, 0.14);
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect__grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px 7px;
          padding: 7px 7px 8px;
          align-content: start;
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect__grid .apr-kv {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          justify-content: center;
          gap: 3px;
          min-height: 0;
          margin: 0;
          padding: 6px 8px;
          border: 1px solid rgba(15, 23, 42, 0.07);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.88);
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
          border-bottom: none !important;
          box-sizing: border-box;
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect__grid .apr-k {
          font-size: clamp(10px, 0.76vw, 11px);
          font-weight: 800;
          color: #64748b;
          line-height: 1.25;
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect__grid .apr-k.apr-k--avg-multiline {
          text-align: center;
          line-height: 1.32;
          white-space: normal;
          word-break: keep-all;
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect__grid .apr-v {
          font-size: clamp(11px, 0.92vw, 13px);
          font-weight: 900;
          font-variant-numeric: tabular-nums;
          color: #0f172a;
          text-align: right;
          line-height: 1.25;
        }
        /* 小計行の指標列は視線誘導を弱めずに一体感だけ出す */
        .apr-table--sales.apr-table--branch tbody tr.apr-subtotal .apr-col-m1 .apr-m1-sect__grid .apr-kv {
          background: rgba(255, 255, 255, 0.65);
          border-color: rgba(37, 99, 235, 0.1);
        }
      }

      /* 支社別集計: 支社列を表示しない（並び・小計は branch キーで従来どおり） */
      .apr-table--sales.apr-table--branch-no-col thead th.apr-col-branch,
      .apr-table--sales.apr-table--branch-no-col tbody td.apr-col-branch {
        display: none !important;
      }

      .apr-m1-stack {
        display: block;
      }

      /* Mobile (touch): 参照ファイル同様に項目縦並び（目標・PT・売上…を縦に表示） */
      @media (max-width: 640px) and (hover: none) and (pointer: coarse) {
        .apr-body { padding: 7px 10px 10px; }
        .apr-table-wrap { overflow-x: visible; }
        .apr-table-wrap.apr-table-wrap--branch {
          overflow: visible;
        }
        .apr-table-wrap.apr-table-wrap--branch .apr-table-scroll-x {
          overflow-x: visible;
          -webkit-overflow-scrolling: touch;
        }
        .apr-table.apr-table--branch thead th {
          position: sticky;
          top: 0;
          z-index: 28;
          background-color: #f8fafc;
          background-image: linear-gradient(180deg, #f1f5f9 0%, #ffffff 100%);
          box-shadow: 0 2px 4px rgba(15, 23, 42, 0.08);
        }
        .apr-table { width: 100%; font-size: 14px; table-layout: fixed; }
        .apr-table th, .apr-table td { padding: 7px 6px; }
        .apr-rank { width: 44px; white-space: nowrap; }
        /* 営業データ分析: 担当者 + 指標（目標・PT・売上…を縦並び） */
        .apr-table--sales .apr-name {
          display: table-cell !important;
          width: 34%;
          min-width: 120px;
          max-width: none;
          white-space: normal;
          overflow: visible;
          text-overflow: clip;
          font-size: 13px;
          font-weight: 800;
          color: #0f172a;
          line-height: 1.4;
          word-break: break-word;
        }
        .apr-name { width: 28%; max-width: 28%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; }
        .apr-num { white-space: nowrap; font-size: 14px; }
        .apr-crown { font-size: 2.2em; }
        .apr-table--sales .apr-col-m1 { display: table-cell !important; white-space: normal; padding: 7px 6px !important; min-width: 0; width: 66%; overflow-x: visible; vertical-align: top; }
        .apr-table--sales .apr-col-m1 .apr-kv { display: grid; grid-template-columns: minmax(82px, auto) 1fr; gap: 8px 12px; align-items: center; padding: 3px 0; font-size: 11px; line-height: 1.38; border-bottom: 1px solid rgba(15,23,42,0.06); }
        .apr-table--sales .apr-col-m1 .apr-kv:last-child { border-bottom: none; }
        .apr-table--sales .apr-col-m1 .apr-k { font-size: 11px; font-weight: 800; color: #475569; grid-column: 1; text-align: left; }
        .apr-table--sales .apr-col-m1 .apr-v { font-size: 12px; font-weight: 900; font-variant-numeric: tabular-nums; white-space: nowrap; color: #0f172a; grid-column: 2; text-align: right; }
        .apr-table--sales .apr-col-m1 .apr-kv--branch { display: none !important; }
        .apr-table--sales .apr-col-m2 { display: none !important; }
        .apr-table--sales thead th.apr-col-branch,
        .apr-table--sales thead th.apr-col-goal,
        .apr-table--sales thead th.apr-col-pt,
        .apr-table--sales thead th.apr-col-sales,
        .apr-table--sales thead th.apr-col-avg,
        .apr-table--sales thead th.apr-col-count,
        .apr-table--sales thead th.apr-col-achv,
        .apr-table--sales thead th.apr-col-cl-pacemaker,
        .apr-table--sales thead th.apr-col-apo-goal,
        .apr-table--sales thead th.apr-col-apo-actual,
        .apr-table--sales thead th.apr-col-apo-count,
        .apr-table--sales thead th.apr-col-apo-cancel,
        .apr-table--sales thead th.apr-col-apo-tama-cl,
        .apr-table--sales thead th.apr-col-apo-tama-ap,
        .apr-table--sales thead th.apr-col-apo-achv { display: none !important; }
        .apr-table--sales tbody tr:not(.apr-subtotal) .apr-col-goal,
        .apr-table--sales tbody tr:not(.apr-subtotal) .apr-col-pt,
        .apr-table--sales tbody tr:not(.apr-subtotal) .apr-col-sales,
        .apr-table--sales tbody tr:not(.apr-subtotal) .apr-col-avg,
        .apr-table--sales tbody tr:not(.apr-subtotal) .apr-col-count,
        .apr-table--sales tbody tr:not(.apr-subtotal) .apr-col-achv,
        .apr-table--sales tbody tr:not(.apr-subtotal) .apr-col-cl-pacemaker,
        .apr-table--sales tbody tr:not(.apr-subtotal) .apr-col-branch,
        .apr-table--sales tbody tr:not(.apr-subtotal) .apr-col-apo-goal,
        .apr-table--sales tbody tr:not(.apr-subtotal) .apr-col-apo-actual,
        .apr-table--sales tbody tr:not(.apr-subtotal) .apr-col-apo-count,
        .apr-table--sales tbody tr:not(.apr-subtotal) .apr-col-apo-cancel,
        .apr-table--sales tbody tr:not(.apr-subtotal) .apr-col-apo-tama-cl,
        .apr-table--sales tbody tr:not(.apr-subtotal) .apr-col-apo-tama-ap,
        .apr-table--sales tbody tr:not(.apr-subtotal) .apr-col-apo-achv { display: none !important; }
        .apr-table--sales tbody tr.apr-subtotal { display: table-row !important; visibility: visible !important; background: rgba(37,99,235,0.14) !important; }
        .apr-table--sales tbody tr.apr-subtotal td.apr-subtotal-label,
        .apr-table--sales tbody tr.apr-subtotal td.apr-col-m1 { display: table-cell !important; visibility: visible !important; }
        .apr-table--sales tbody tr.apr-subtotal td:not(.apr-subtotal-label):not(.apr-col-m1) { display: none !important; }
        .apr-table--sales tbody tr.apr-subtotal td { padding: 10px 8px; font-size: 14px; border-top: 2px solid rgba(37,99,235,0.3); }
        .apr-table--sales tbody tr.apr-subtotal td.apr-subtotal-label { font-size: 16px; font-weight: 900; color: #1e40af; padding: 10px 8px; white-space: normal; line-height: 1.32; min-width: 90px; max-width: 45%; box-sizing: border-box; }
        .apr-table--sales tbody tr.apr-subtotal td.apr-subtotal-label .apr-subtotal-branch { white-space: nowrap; }
        .apr-table--sales tbody tr.apr-subtotal td.apr-col-m1 { min-width: 0; box-sizing: border-box; padding: 9px 8px; vertical-align: top; }
        .apr-table--sales tbody tr.apr-subtotal .apr-col-m1 .apr-kv { padding: 4px 0; font-size: 12px; line-height: 1.42; border-bottom: 1px solid rgba(37,99,235,0.12); display: grid; grid-template-columns: minmax(90px, auto) 1fr; gap: 8px 12px; align-items: center; }
        .apr-table--sales tbody tr.apr-subtotal .apr-col-m1 .apr-kv:last-child { border-bottom: none; }
        .apr-table--sales tbody tr.apr-subtotal .apr-col-m1 .apr-k { font-size: 12px; font-weight: 800; color: #334155; grid-column: 1; text-align: left; }
        .apr-table--sales tbody tr.apr-subtotal .apr-col-m1 .apr-v { font-size: 14px; font-weight: 900; font-variant-numeric: tabular-nums; white-space: normal; word-break: break-all; color: #0f172a; grid-column: 2; text-align: right; }
        .apr-target-inline-row { display: table-row; }
        .apr-target-inline-row > .apr-target-inline-cell {
          border-top: none;
          padding: 3px 5px 7px;
          background: rgba(248,250,252,0.95);
        }
        .apr-table--sales.apr-table--branch tbody tr.apr-target-inline-row .apr-target-inline-cell {
          box-sizing: border-box;
          max-width: 100%;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
        .apr-target-meta { gap: 4px; }
        .apr-target-badge { font-size: 10px; padding: 2px 7px; }
        .apr-target-scroll { max-height: none; overflow: visible; }
        .apr-target-list { min-width: 0; }
        .apr-target-head { display: none; }
        .apr-target-row {
          grid-template-columns: 1fr;
          gap: 0;
          padding: 8px 10px;
          font-size: 11px;
          border-radius: 8px;
        }
        .apr-target-cell {
          display: flex;
          flex-direction: row;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
          min-width: 0;
          padding: 4px 0;
          border-bottom: 1px dashed rgba(148,163,184,0.35);
        }
        .apr-target-row .apr-target-cell:last-child { border-bottom: none; }
        .apr-target-cell::before {
          content: attr(data-label);
          color: #64748b;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.01em;
          line-height: 1.35;
          flex: 0 0 auto;
        }
        .apr-target-cell--name,
        .apr-target-cell--route {
          white-space: normal;
          overflow: visible;
          text-overflow: clip;
          line-height: 1.35;
          word-break: break-word;
          text-align: right;
        }
        .apr-target-cell--date { white-space: nowrap; }
        .apr-target-cell--num { text-align: right; }
        .apr-target-cell--center { text-align: right; }
        /* アポランキング: 指標を縦並び（CL の指標列と同様に項目下に区切り線） */
        .apr-table--apo .apr-col-apo-m1 {
          display: table-cell !important;
          white-space: normal;
          padding: 7px 6px;
          min-width: 0;
          width: 66%;
          overflow-x: visible;
          vertical-align: top;
        }
        .apr-table--apo .apr-col-apo-m1 .apr-kv {
          display: grid;
          grid-template-columns: minmax(82px, auto) 1fr;
          gap: 8px 12px;
          align-items: center;
          padding: 4px 0;
          font-size: 11px;
          line-height: 1.45;
          border-bottom: 1px solid rgba(15, 23, 42, 0.06);
        }
        .apr-table--apo .apr-col-apo-m1 .apr-kv:last-child {
          border-bottom: none;
        }
        .apr-table--apo .apr-col-apo-m1 .apr-k {
          font-size: 11px;
          font-weight: 800;
          color: #475569;
          grid-column: 1;
          text-align: left;
        }
        .apr-table--apo .apr-col-apo-m1 .apr-v {
          font-size: 12px;
          font-weight: 900;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          color: #0f172a;
          grid-column: 2;
          text-align: right;
        }
        .apr-table--apo .apr-col-apo-goal,
        .apr-table--apo .apr-col-apo-actual,
        .apr-table--apo .apr-col-apo-count,
        .apr-table--apo .apr-col-apo-meeting,
        .apr-table--apo .apr-col-apo-contract,
        .apr-table--apo .apr-col-apo-cancel,
        .apr-table--apo .apr-col-apo-meeting-rate,
        .apr-table--apo .apr-col-apo-rate,
        .apr-table--apo .apr-col-apo-workdays,
        .apr-table--apo .apr-col-apo-productivity,
        .apr-table--apo .apr-col-apo-pacemaker,
        .apr-table--apo .apr-col-apo-achv { display: none !important; }
      }

      /*
       * スマホ幅: 支社別は「担当者 | 指標」の2列。指標は1行リストで縦幅を最小化し、約2人行が一覧に載るサイズ。
       */
      @media (max-width: 640px) {
        .apr-table-wrap.apr-table-wrap--branch {
          overflow: visible;
        }
        .apr-table-wrap.apr-table-wrap--branch .apr-table-scroll-x {
          overflow-x: visible;
          -webkit-overflow-scrolling: touch;
        }
        .apr-table.apr-table--branch thead th {
          position: sticky;
          top: 0;
          z-index: 28;
          padding: 3px 4px;
          background-color: #f8fafc;
          background-image: linear-gradient(180deg, #f1f5f9 0%, #ffffff 100%);
          box-shadow: 0 2px 4px rgba(15, 23, 42, 0.08);
        }
        /* 見出し: 一覧の縦スクロール量を優先してやや詰める */
        .apr-table--sales.apr-table--branch thead th.apr-name,
        .apr-table--sales.apr-table--branch thead th.apr-col-m1 {
          font-size: 11px;
          font-weight: 800;
          line-height: 1.15;
          vertical-align: middle;
        }
        .apr-table--sales.apr-table--branch {
          width: 100%;
          table-layout: fixed;
          font-size: 11px;
        }
        .apr-table--sales.apr-table--branch th,
        .apr-table--sales.apr-table--branch td {
          padding: 2px 3px;
        }
        .apr-table--sales.apr-table--branch .apr-name {
          display: table-cell !important;
          width: 30%;
          min-width: 88px;
          max-width: 38%;
          box-sizing: border-box;
          white-space: normal;
          overflow: visible;
          text-overflow: clip;
          font-size: 11px;
          font-weight: 800;
          color: #0f172a;
          line-height: 1.15;
          word-break: break-word;
          vertical-align: top;
        }
        .apr-table--sales.apr-table--branch tbody tr:not(.apr-subtotal) .apr-name .apr-name-line {
          gap: 3px;
        }
        .apr-table--sales.apr-table--branch tbody tr:not(.apr-subtotal) .apr-name .apr-crown--inline {
          font-size: 0.95em;
        }
        .apr-table--sales.apr-table--branch .apr-col-m1 {
          display: table-cell !important;
          white-space: normal;
          padding: 1px 2px !important;
          min-width: 0;
          width: auto;
          overflow-x: visible;
          vertical-align: top;
        }
        .apr-table--sales.apr-table--branch .apr-num {
          white-space: nowrap;
          font-size: 11px;
        }
        .apr-table--sales.apr-table--branch thead th.apr-col-branch,
        .apr-table--sales.apr-table--branch thead th.apr-col-goal,
        .apr-table--sales.apr-table--branch thead th.apr-col-pt,
        .apr-table--sales.apr-table--branch thead th.apr-col-sales,
        .apr-table--sales.apr-table--branch thead th.apr-col-avg,
        .apr-table--sales.apr-table--branch thead th.apr-col-count,
        .apr-table--sales.apr-table--branch thead th.apr-col-meeting,
        .apr-table--sales.apr-table--branch thead th.apr-col-achv,
        .apr-table--sales.apr-table--branch thead th.apr-col-cl-pacemaker,
        .apr-table--sales.apr-table--branch thead th.apr-col-apo-goal,
        .apr-table--sales.apr-table--branch thead th.apr-col-apo-actual,
        .apr-table--sales.apr-table--branch thead th.apr-col-apo-count,
        .apr-table--sales.apr-table--branch thead th.apr-col-apo-cancel,
        .apr-table--sales.apr-table--branch thead th.apr-col-apo-tama-cl,
        .apr-table--sales.apr-table--branch thead th.apr-col-apo-tama-ap,
        .apr-table--sales.apr-table--branch thead th.apr-col-apo-achv {
          display: none !important;
        }
        .apr-table--sales.apr-table--branch tbody tr:not(.apr-subtotal) .apr-col-goal,
        .apr-table--sales.apr-table--branch tbody tr:not(.apr-subtotal) .apr-col-pt,
        .apr-table--sales.apr-table--branch tbody tr:not(.apr-subtotal) .apr-col-sales,
        .apr-table--sales.apr-table--branch tbody tr:not(.apr-subtotal) .apr-col-avg,
        .apr-table--sales.apr-table--branch tbody tr:not(.apr-subtotal) .apr-col-count,
        .apr-table--sales.apr-table--branch tbody tr:not(.apr-subtotal) .apr-col-meeting,
        .apr-table--sales.apr-table--branch tbody tr:not(.apr-subtotal) .apr-col-achv,
        .apr-table--sales.apr-table--branch tbody tr:not(.apr-subtotal) .apr-col-cl-pacemaker,
        .apr-table--sales.apr-table--branch tbody tr:not(.apr-subtotal) .apr-col-branch,
        .apr-table--sales.apr-table--branch tbody tr:not(.apr-subtotal) .apr-col-apo-goal,
        .apr-table--sales.apr-table--branch tbody tr:not(.apr-subtotal) .apr-col-apo-actual,
        .apr-table--sales.apr-table--branch tbody tr:not(.apr-subtotal) .apr-col-apo-count,
        .apr-table--sales.apr-table--branch tbody tr:not(.apr-subtotal) .apr-col-apo-cancel,
        .apr-table--sales.apr-table--branch tbody tr:not(.apr-subtotal) .apr-col-apo-tama-cl,
        .apr-table--sales.apr-table--branch tbody tr:not(.apr-subtotal) .apr-col-apo-tama-ap,
        .apr-table--sales.apr-table--branch tbody tr:not(.apr-subtotal) .apr-col-apo-achv {
          display: none !important;
        }
        .apr-table--sales.apr-table--branch tbody tr.apr-subtotal {
          display: table-row !important;
          visibility: visible !important;
          background: rgba(37, 99, 235, 0.14) !important;
        }
        .apr-table--sales.apr-table--branch tbody tr.apr-subtotal td.apr-subtotal-label,
        .apr-table--sales.apr-table--branch tbody tr.apr-subtotal td.apr-col-m1 {
          display: table-cell !important;
          visibility: visible !important;
        }
        .apr-table--sales.apr-table--branch tbody tr.apr-subtotal td:not(.apr-subtotal-label):not(.apr-col-m1) {
          display: none !important;
        }
        .apr-table--sales.apr-table--branch tbody tr.apr-subtotal td {
          padding: 5px 4px;
          font-size: 11px;
          border-top: 2px solid rgba(37, 99, 235, 0.3);
        }
        .apr-table--sales.apr-table--branch tbody tr.apr-subtotal td.apr-subtotal-label {
          font-size: 11px;
          font-weight: 900;
          color: #1e40af;
          padding: 4px 4px;
          white-space: normal;
          line-height: 1.2;
          min-width: 88px;
          max-width: 36%;
          box-sizing: border-box;
          vertical-align: top;
        }
        .apr-table--sales.apr-table--branch tbody tr.apr-subtotal td.apr-subtotal-label .apr-subtotal-branch {
          white-space: normal;
          word-break: break-word;
        }
        .apr-table--sales.apr-table--branch tbody tr.apr-subtotal td.apr-col-m1 {
          min-width: 0;
          box-sizing: border-box;
          padding: 3px 3px;
          vertical-align: top;
        }
        .apr-table--sales.apr-table--branch .apr-col-m1.apr-num {
          white-space: normal !important;
          text-align: left;
          font-variant-numeric: unset;
          vertical-align: top;
        }
        .apr-table--sales.apr-table--branch .apr-m1-stack--split {
          display: flex;
          flex-direction: column;
          gap: 3px;
          align-items: stretch;
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect {
          border-radius: 5px;
          overflow: hidden;
          border: 1px solid rgba(15, 23, 42, 0.09);
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
          background: rgba(255, 255, 255, 0.98);
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect--pt {
          background: linear-gradient(180deg, rgba(254, 243, 199, 0.35) 0%, rgba(255, 255, 255, 0.98) 52%, rgba(255, 251, 235, 0.25) 100%);
          border-color: rgba(180, 83, 9, 0.26);
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect--apo {
          background: linear-gradient(180deg, rgba(224, 231, 255, 0.42) 0%, rgba(255, 255, 255, 0.98) 52%, rgba(238, 242, 255, 0.32) 100%);
          border-color: rgba(67, 56, 202, 0.26);
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect__head {
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.05em;
          padding: 2px 5px;
          line-height: 1.15;
          text-align: center;
          text-transform: none;
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect--pt .apr-m1-sect__head {
          color: #92400e;
          background: linear-gradient(180deg, rgba(251, 191, 36, 0.22) 0%, rgba(254, 240, 138, 0.09) 100%);
          border-bottom: 1px solid rgba(180, 83, 9, 0.1);
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect--apo .apr-m1-sect__head {
          color: #3730a3;
          background: linear-gradient(180deg, rgba(129, 140, 248, 0.22) 0%, rgba(199, 210, 254, 0.07) 100%);
          border-bottom: 1px solid rgba(67, 56, 202, 0.12);
        }
        /* 一覧行・小計とも2列カードではなく1行リスト（約2人行/画面を目標） */
        .apr-table--sales.apr-table--branch .apr-m1-sect__grid {
          display: flex;
          flex-direction: column;
          gap: 0;
          padding: 1px 2px 2px;
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect__grid .apr-kv {
          display: flex;
          flex-direction: row;
          flex-wrap: nowrap;
          align-items: center;
          justify-content: space-between;
          gap: 3px;
          min-height: 0;
          padding: 2px 1px;
          margin: 0;
          border: none !important;
          border-radius: 0 !important;
          background: transparent !important;
          box-shadow: none !important;
          border-bottom: 1px solid rgba(15, 23, 42, 0.06) !important;
          box-sizing: border-box;
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect__grid .apr-kv:last-child {
          border-bottom: none !important;
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect__grid .apr-k {
          flex: 1 1 auto;
          min-width: 0;
          font-size: 10px;
          font-weight: 800;
          color: #64748b;
          text-align: left;
          align-self: auto;
          line-height: 1.12;
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect__grid .apr-kv.apr-kv--avg-branch {
          align-items: flex-start;
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect__grid .apr-k.apr-k--avg-multiline {
          flex: 1 1 auto;
          text-align: left;
          align-self: auto;
          width: auto;
          line-height: 1.12;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: -0.01em;
          white-space: normal;
          word-break: keep-all;
        }
        .apr-table--sales.apr-table--branch .apr-m1-sect__grid .apr-v {
          flex: 0 0 auto;
          font-size: 11px;
          font-weight: 900;
          font-variant-numeric: tabular-nums;
          color: #0f172a;
          text-align: right;
          align-self: auto;
          white-space: nowrap;
          word-break: normal;
          line-height: 1.12;
        }
        .apr-table--sales.apr-table--branch tbody tr.apr-subtotal .apr-m1-sect--pt {
          border-color: rgba(37, 99, 235, 0.28);
        }
        .apr-table--sales.apr-table--branch tbody tr.apr-subtotal .apr-m1-sect--apo {
          border-color: rgba(37, 99, 235, 0.32);
        }
        .apr-table--sales.apr-table--branch tbody tr.apr-subtotal .apr-m1-sect__grid .apr-kv {
          padding: 2px 1px;
          border-bottom-color: rgba(37, 99, 235, 0.1) !important;
        }
        .apr-table--sales.apr-table--branch tbody tr.apr-subtotal .apr-m1-sect__grid .apr-kv.apr-kv--avg-branch {
          align-items: flex-start;
        }
        .apr-table--sales.apr-table--branch tbody tr.apr-subtotal .apr-m1-sect__grid .apr-k {
          color: #334155;
        }
        .apr-table--sales.apr-table--branch tbody tr.apr-subtotal .apr-m1-sect--pt .apr-m1-sect__head {
          background: rgba(37, 99, 235, 0.1);
          color: #1e3a8a;
          border-bottom-color: rgba(37, 99, 235, 0.18);
        }
        .apr-table--sales.apr-table--branch tbody tr.apr-subtotal .apr-m1-sect--apo .apr-m1-sect__head {
          background: rgba(37, 99, 235, 0.12);
          color: #1e3a8a;
          border-bottom-color: rgba(37, 99, 235, 0.2);
        }
      }

      /* 営業データ分析 PDF出力: 印刷時は表のみ・縦向き1ページに収める */
      @media print {
        @page { size: A4; margin: 6mm; }
        html, body { height: 100%; margin: 0; }
        body.apr-print-sales-analysis * { visibility: hidden; }
        body.apr-print-sales-analysis .apr-wrap#ap-sales-analysis-root-v1,
        body.apr-print-sales-analysis .apr-wrap#ap-sales-analysis-root-v1 * { visibility: visible; }
        body.apr-print-sales-analysis .apr-wrap#ap-sales-analysis-root-v1 {
          position: absolute; left: 0; top: 0; width: 100%; height: 100%;
          background: #fff; padding: 0; margin: 0; overflow: hidden;
        }
        body.apr-print-sales-analysis .apr-wrap#ap-sales-analysis-root-v1 .apr-head { display: none !important; }
        body.apr-print-sales-analysis .apr-wrap#ap-sales-analysis-root-v1 .apr-tax-row { display: none !important; }
        body.apr-print-sales-analysis .apr-wrap#ap-sales-analysis-root-v1 .apr-body > .apr-row { display: none !important; }
        body.apr-print-sales-analysis .apr-wrap#ap-sales-analysis-root-v1 .apr-badges,
        body.apr-print-sales-analysis .apr-wrap#ap-sales-analysis-root-v1 .apr-total-panel { display: none !important; }
        body.apr-print-sales-analysis .apr-wrap#ap-sales-analysis-root-v1 .apr-body {
          height: 100%; overflow: hidden; position: relative;
        }
        body.apr-print-sales-analysis .apr-wrap#ap-sales-analysis-root-v1 .apr-body > div {
          position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: hidden;
        }
        body.apr-print-sales-analysis .apr-wrap#ap-sales-analysis-root-v1 .apr-table-wrap {
          transform: scale(0.38); transform-origin: top left;
          width: 263%; min-height: 263%;
          position: absolute; left: 0; top: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "class") e.className = v;
        else if (k === "dataset") {
          for (const [dk, dv] of Object.entries(v)) e.dataset[dk] = dv;
        } else if (k.startsWith("on") && typeof v === "function") {
          e.addEventListener(k.substring(2), v);
        } else {
          e.setAttribute(k, v);
        }
      }
    }
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function numFmt(n) {
    const v = Math.round((n || 0) * 100) / 100;
    return v.toLocaleString("ja-JP");
  }

  function aprTotalMetricRow(k, v) {
    return `<div class="apr-total-metric"><span class="apr-total-metric__k">${k}</span><span class="apr-total-metric__v">${v}</span></div>`;
  }
  function aprTotalBlock(title, innerHtml) {
    return `<section class="apr-total-block" aria-label="${String(title).replace(/"/g, "&quot;")}"><h3 class="apr-total-block__title">${title}</h3><div class="apr-total-block__metrics">${innerHtml}</div></section>`;
  }

  function buildClTotalPanelHtml(p) {
    const m = aprTotalMetricRow;
    const taxLabel = p.taxLabel;
    const gPt = [
      m("PT目標合計", numFmt(p.totals.goal)),
      ...(p.hasPT ? [m("PT合計", numFmt(p.totals.pt))] : []),
      ...(p.hasSales ? [m(`売上合計〔${taxLabel}〕`, numFmt(p.totalSalesDisplay))] : []),
      ...(p.showAvg ? [m(`平均売上単価〔${taxLabel}〕`, numFmt(p.totalAvg))] : []),
      m("契約件数合計", numFmt(p.totals.count)),
      ...(p.showMeeting ? [m("商談実施数合計", numFmt(p.totals.meetingCount))] : []),
      m("全体達成率", p.totalAchv.toFixed(1) + "%"),
    ];
    const gPace = [];
    if (p.showClPacemaker && p.clPacemakerCtx) {
      gPace.push(m("経過週 / 期間週", `${Number(p.clPacemakerCtx.weeksElapsed || 0).toLocaleString("ja-JP")} / ${Number(p.clPacemakerCtx.weeksInMonth || 0).toLocaleString("ja-JP")}`));
      gPace.push(m("全体ペースメーカー", p.clTotalPacemaker != null ? (p.clTotalPacemaker * 100).toFixed(1) + "%" : "—"));
    }
    const blocks = [aprTotalBlock("PT・売上・件数", gPt.join(""))];
    if (gPace.length) {
      blocks.push(aprTotalBlock("週次・ペース", gPace.join("")));
    }
    if (p.showApo) {
      const gApo = [
        m("アポ目標合計", numFmt(p.totals.apoGoal)),
        m("アポ獲得数合計", numFmt(p.totals.actualCount)),
        m("アポ実績数合計", numFmt(p.totals.apoCount)),
        m("アポキャン数合計", numFmt(p.totals.cancelCount)),
        ...(p.showTamaCl ? [m("CL残玉合計", numFmt(p.totals.tama))] : []),
        ...(p.showTamaAp ? [m("AP残玉合計", numFmt(p.totals.tamaAp))] : []),
        m("アポ達成率", p.totalApoAchv.toFixed(1) + "%"),
      ];
      blocks.push(aprTotalBlock("アポ", gApo.join("")));
    }
    return `<div class="apr-total-panel" role="region" aria-label="全体集計"><div class="apr-total-panel__head">全体集計</div><div class="apr-total-panel__grid">${blocks.join("")}</div></div>`;
  }

  function buildApoTotalPanelHtml(totals, totalCancelRate, totalMeetingRate, totalAchv, totalProductivity, totalPacemaker) {
    const m = aprTotalMetricRow;
    const gVol = [
      m("目標合計", numFmt(totals.goal)),
      m("アポ獲得合計", numFmt(totals.actualCount)),
      m("アポ実績合計", numFmt(totals.count)),
      m("商談実施合計", numFmt(totals.meetingCount)),
      m("契約件数合計", numFmt(totals.contractCount)),
      m("アポキャンセル合計", numFmt(totals.cancelCount)),
      m("稼働日数合計", numFmt(totals.workDays)),
    ];
    const gKpi = [
      m("生産性", totalProductivity.toFixed(2)),
      m("全体ペースメーカー", totalPacemaker != null ? (totalPacemaker * 100).toFixed(1) + "%" : "—"),
      m("商談実施率", totalMeetingRate.toFixed(1) + "%"),
      m("アポキャンセル率", totalCancelRate.toFixed(1) + "%"),
      m("達成率", totalAchv.toFixed(1) + "%"),
    ];
    return `<div class="apr-total-panel apr-total-panel--apo" role="region" aria-label="全体集計"><div class="apr-total-panel__head">全体集計</div><div class="apr-total-panel__grid">${aprTotalBlock("件数・実績", gVol.join(""))}${aprTotalBlock("指標", gKpi.join(""))}</div></div>`;
  }

  function renderTable(container, result, fieldMap, query, taxMode, opts) {
    taxMode = taxMode || "exclude";
    const isExcludeTax = taxMode === "exclude";
    const taxLabel = isExcludeTax ? "税抜" : "税込";
    const salesDisplay = (s) => isExcludeTax ? Math.floor(Number(s || 0) / 1.1) : Number(s || 0);
    const showApo = opts && opts.showApo === true;
    const showTamaCl = opts && opts.showTamaCl === true;
    const showTamaAp = opts && opts.showTamaAp === true;
    const showMeeting = opts && opts.showMeeting === true;
    const rankBordered = !!(opts && opts.rankBordered);
    const rankBorderTableClass = rankBordered ? " apr-table--rank-bordered" : "";
    const rankBorderWrapClass = rankBordered ? " apr-table-wrap--rank-bordered" : "";
    const targetBreakdownByName = opts && opts.targetBreakdownByName instanceof Map
      ? opts.targetBreakdownByName
      : null;

    const items = (result.items || [])
      .filter(x => !query || x.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, CONFIG.TOP_N);

    const hasPT = !!fieldMap.pt;
    const hasSales = !!fieldMap.sales;
    const showAvg = hasSales; // 平均売上単価は売上がある場合のみ表示（小数点以下切り捨て）

    const clPacemakerCtx = opts && opts.clPacemaker != null && typeof opts.clPacemaker === "object"
      ? opts.clPacemaker
      : null;
    const showClPacemaker = hasPT && !showApo && !!clPacemakerCtx;

    function formatClPacemakerCell(it, ctx) {
      if (!ctx || !ctx.weeksInMonth || !ctx.weeksElapsed) return "—";
      const g = it.goal != null ? it.goal : 0;
      if (g <= 0) return "—";
      const denom = (g / ctx.weeksInMonth) * ctx.weeksElapsed;
      if (denom <= 0) return "—";
      const p = (it.pt || 0) / denom;
      return (p * 100).toFixed(1) + "%";
    }

    let headCols = showApo
      ? `<th class="apr-num apr-col-branch">支社</th><th class="apr-name">担当者</th>`
      : `<th class="apr-rank">順位</th><th class="apr-name">担当者</th>`;
    headCols += `<th class="apr-num apr-col-m1">指標</th>`;
    if (hasSales) headCols += `<th class="apr-num apr-col-m2">売上〔${taxLabel}〕/ 平均</th>`;
    // Standard columns (show on PC, hidden on mobile)
    headCols += `<th class="apr-num apr-col-goal">PT目標</th>`;
    if (hasPT) headCols += `<th class="apr-num apr-col-pt">PT</th>`;
    if (hasSales) headCols += `<th class="apr-num apr-col-sales">売上〔${taxLabel}〕</th>`;
    if (showAvg) headCols += showApo
      ? `<th class="apr-num apr-col-avg"><span class="apr-th-avg-multiline">平均売上単価<br>〔${taxLabel}〕</span></th>`
      : `<th class="apr-num apr-col-avg">平均売上単価〔${taxLabel}〕</th>`;
    headCols += `<th class="apr-num apr-col-count">契約件数</th>`;
    if (showMeeting) headCols += `<th class="apr-num apr-col-meeting">商談実施数</th>`;
    headCols += `<th class="apr-num apr-col-achv">達成率</th>`;
    if (showClPacemaker) headCols += `<th class="apr-num apr-col-cl-pacemaker">ペースメーカー</th>`;
    if (showApo) {
      headCols += `<th class="apr-num apr-col-apo-goal">アポ目標</th>`;
      headCols += `<th class="apr-num apr-col-apo-actual">アポ獲得数</th>`;
      headCols += `<th class="apr-num apr-col-apo-count">アポ実績数</th>`;
      headCols += `<th class="apr-num apr-col-apo-cancel">アポキャン数</th>`;
      if (showTamaCl) headCols += `<th class="apr-num apr-col-apo-tama-cl">CL残玉数</th>`;
      if (showTamaAp) headCols += `<th class="apr-num apr-col-apo-tama-ap">AP残玉数</th>`;
      headCols += `<th class="apr-num apr-col-apo-achv">アポ達成率</th>`;
    }

    /** thead と同一の論理列数（対象レコード行の colspan／空セル用。colspan が実列数より大きいと table-layout で列幅が異常になり得る） */
    let tableColCount =
      2
      + 1
      + (hasSales ? 1 : 0)
      + 1
      + (hasPT ? 1 : 0)
      + (hasSales ? 1 : 0)
      + (showAvg ? 1 : 0)
      + 1
      + (showMeeting ? 1 : 0)
      + 1
      + (showClPacemaker ? 1 : 0)
      + (showApo
        ? (
          4
          + (showTamaCl ? 1 : 0)
          + (showTamaAp ? 1 : 0)
          + 1
        )
        : 0);

    const totals = (result.items || []).reduce((acc, x) => {
      acc.goal += x.goal != null ? x.goal : 0;
      acc.pt += x.pt || 0;
      acc.sales += x.sales || 0;
      acc.count += x.count || 0;
      if (showMeeting) acc.meetingCount += x.meetingCount || 0;
      if (showApo) {
        acc.apoGoal += x.apoGoal != null ? x.apoGoal : 0;
        acc.actualCount += x.actualCount || 0;
        acc.cancelCount += x.cancelCount || 0;
        acc.apoCount += x.apoCount || 0;
        if (showTamaCl) acc.tama += x.tamaCount || 0;
        if (showTamaAp) acc.tamaAp += x.tamaCountAp || 0;
      }
      return acc;
    }, { goal: 0, pt: 0, sales: 0, count: 0, meetingCount: 0, apoGoal: 0, actualCount: 0, cancelCount: 0, apoCount: 0, tama: 0, tamaAp: 0 });

    const totalSalesDisplay = hasSales ? (result.items || []).reduce((s, x) => s + salesDisplay(x.sales), 0) : 0;
    const totalAvg = (showAvg && totals.count > 0) ? Math.floor(totalSalesDisplay / totals.count) : 0;
    const totalAchv = (totals.goal > 0 && (totals.pt || 0) >= 0) ? (totals.pt / totals.goal) * 100 : 0;
    const totalApoAchv = showApo && totals.apoGoal > 0 ? (totals.actualCount / totals.apoGoal) * 100 : 0;

    // 全体ペースメーカー（PT合計 / ((PT目標/期間週数) * 経過週数)）
    let clTotalPacemaker = null;
    if (showClPacemaker && clPacemakerCtx && (totals.goal || 0) > 0 && (clPacemakerCtx.weeksInMonth || 0) > 0 && (clPacemakerCtx.weeksElapsed || 0) > 0) {
      const denom = (totals.goal / clPacemakerCtx.weeksInMonth) * clPacemakerCtx.weeksElapsed;
      if (denom > 0) clTotalPacemaker = (totals.pt || 0) / denom;
    }

    const totalPanelHtml = buildClTotalPanelHtml({
      taxLabel, hasPT, hasSales, showAvg, showMeeting, showClPacemaker, clPacemakerCtx,
      totals, totalSalesDisplay, totalAvg, totalAchv, clTotalPacemaker, showApo, totalApoAchv, showTamaCl, showTamaAp,
    });

    if (!items.length) {
      container.innerHTML = `
        ${totalPanelHtml}
        <div class="apr-empty">該当データがありません。</div>
      `;
      return;
    }

    const branchSortKey = (br) => {
      const s = String(br || "").trim();
      if (s === "奈良本社") return "0";
      if (!s) return "zzz";
      return "1" + s;
    };

    function buildSubtotalRow(acc, branchLabel, salesDisplay, taxLabel, hasPT, hasSales, showAvg, numFmt) {
      const subDispSales = salesDisplay(acc.sales);
      const subAvg = (showAvg && acc.count > 0) ? Math.floor(salesDisplay(acc.sales) / acc.count) : 0;
      const subAchv = (acc.goal > 0 && acc.pt >= 0) ? (acc.pt / acc.goal) * 100 : 0;
      const subApoAchv = (acc.apoGoal > 0 && acc.actualCount >= 0) ? (acc.actualCount / acc.apoGoal) * 100 : 0;
      const branchSafe = branchLabel ? String(branchLabel).replace(/</g, "&lt;") : "";
      const crown = subAchv >= 100 ? " 💮" : "";
      const subLabelHtml = branchSafe ? `<span class="apr-subtotal-branch">${branchSafe}${crown}</span><br>小計` : "小計";
      return `<tr class="apr-subtotal">
        <td class="apr-num apr-col-branch" data-label="支社"></td>
        <td class="apr-subtotal-label" data-label="小計">${subLabelHtml}</td>
        <td class="apr-num apr-col-m1" data-label="指標">
          <div class="apr-m1-stack apr-m1-stack--split">
          <section class="apr-m1-sect apr-m1-sect--pt" aria-label="PT・売上・契約">
            <div class="apr-m1-sect__head">PT・売上・契約</div>
            <div class="apr-m1-sect__grid">
          <div class="apr-kv"><span class="apr-k">PT目標</span><span class="apr-v">${numFmt(acc.goal)}</span></div>
          ${hasPT ? `<div class="apr-kv"><span class="apr-k">PT</span><span class="apr-v">${numFmt(acc.pt)}</span></div>` : ""}
          ${hasSales ? `<div class="apr-kv"><span class="apr-k">売上〔${taxLabel}〕</span><span class="apr-v">${numFmt(subDispSales)}</span></div>` : ""}
          <div class="apr-kv"><span class="apr-k">件数</span><span class="apr-v">${numFmt(acc.count)}</span></div>
          ${showAvg ? `<div class="apr-kv apr-kv--avg-branch"><span class="apr-k apr-k--avg-multiline">平均売上単価<br>〔${taxLabel}〕</span><span class="apr-v">${numFmt(subAvg)}</span></div>` : ""}
          <div class="apr-kv"><span class="apr-k">達成率</span><span class="apr-v">${subAchv.toFixed(1)}%</span></div>
            </div>
          </section>
          <section class="apr-m1-sect apr-m1-sect--apo" aria-label="アポ">
            <div class="apr-m1-sect__head">アポ</div>
            <div class="apr-m1-sect__grid">
          <div class="apr-kv"><span class="apr-k">アポ目標</span><span class="apr-v">${numFmt(acc.apoGoal)}</span></div>
          <div class="apr-kv"><span class="apr-k">アポ獲得数</span><span class="apr-v">${numFmt(acc.actualCount)}</span></div>
          <div class="apr-kv"><span class="apr-k">アポ実績数</span><span class="apr-v">${numFmt(acc.apoCount)}</span></div>
          <div class="apr-kv"><span class="apr-k">アポキャン数</span><span class="apr-v">${numFmt(acc.cancelCount)}</span></div>
          ${showTamaCl ? `<div class="apr-kv"><span class="apr-k">CL残玉数</span><span class="apr-v">${numFmt(acc.tama || 0)}</span></div>` : ""}
          ${showTamaAp ? `<div class="apr-kv"><span class="apr-k">AP残玉数</span><span class="apr-v">${numFmt(acc.tamaAp || 0)}</span></div>` : ""}
          <div class="apr-kv"><span class="apr-k">アポ達成率</span><span class="apr-v">${subApoAchv.toFixed(1)}%</span></div>
            </div>
          </section>
          </div>
        </td>
        ${hasSales ? `<td class="apr-num apr-col-m2" data-label="売上〔${taxLabel}〕/ 平均">
          <div class="apr-kv"><span class="apr-k">売上〔${taxLabel}〕</span><span class="apr-v">${numFmt(subDispSales)}</span></div>
          ${showAvg ? `<div class="apr-kv"><span class="apr-k">平均</span><span class="apr-v">${numFmt(subAvg)}</span></div>` : ""}
        </td>` : ""}
        <td class="apr-num apr-col-goal" data-label="PT目標">${numFmt(acc.goal)}</td>
        ${hasPT ? `<td class="apr-num apr-col-pt" data-label="PT">${numFmt(acc.pt)}</td>` : ""}
        ${hasSales ? `<td class="apr-num apr-col-sales" data-label="売上〔${taxLabel}〕">${numFmt(subDispSales)}</td>` : ""}
        ${showAvg ? `<td class="apr-num apr-col-avg" data-label="平均売上単価〔${taxLabel}〕">${numFmt(subAvg)}</td>` : ""}
        <td class="apr-num apr-col-count" data-label="契約件数">${numFmt(acc.count)}</td>
        <td class="apr-num apr-col-achv" data-label="達成率">${subAchv.toFixed(1)}%</td>
        <td class="apr-num apr-col-apo-goal" data-label="アポ目標">${numFmt(acc.apoGoal)}</td>
        <td class="apr-num apr-col-apo-actual" data-label="アポ獲得数">${numFmt(acc.actualCount)}</td>
        <td class="apr-num apr-col-apo-count" data-label="アポ実績数">${numFmt(acc.apoCount)}</td>
        <td class="apr-num apr-col-apo-cancel" data-label="アポキャン数">${numFmt(acc.cancelCount)}</td>
        ${showTamaCl ? `<td class="apr-num apr-col-apo-tama-cl" data-label="CL残玉数">${numFmt(acc.tama || 0)}</td>` : ""}
        ${showTamaAp ? `<td class="apr-num apr-col-apo-tama-ap" data-label="AP残玉数">${numFmt(acc.tamaAp || 0)}</td>` : ""}
        <td class="apr-num apr-col-apo-achv" data-label="アポ達成率">${subApoAchv.toFixed(1)}%</td>
      </tr>`;
    }

    let rows = "";
    let currentKey = null;
    let acc = null;
    let branchLabel = "";
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (showApo) {
        const key = branchSortKey(it.branch);
        if (currentKey !== null && key !== currentKey) {
          rows += buildSubtotalRow(acc, branchLabel, salesDisplay, taxLabel, hasPT, hasSales, showAvg, numFmt);
          acc = null;
        }
        if (acc === null) {
          acc = { goal: 0, pt: 0, sales: 0, count: 0, apoGoal: 0, actualCount: 0, apoCount: 0, cancelCount: 0, tama: 0, tamaAp: 0 };
          branchLabel = String(it.branch || "").trim();
        }
        currentKey = key;
        acc.goal += it.goal != null ? it.goal : 0;
        acc.pt += it.pt || 0;
        acc.sales += it.sales || 0;
        acc.count += it.count || 0;
        acc.apoGoal += it.apoGoal != null ? it.apoGoal : 0;
        acc.actualCount += it.actualCount || 0;
        acc.apoCount += it.apoCount || 0;
        acc.cancelCount += it.cancelCount || 0;
        if (showTamaCl) acc.tama += it.tamaCount || 0;
        if (showTamaAp) acc.tamaAp += it.tamaCountAp || 0;
      }
      const dispSales = salesDisplay(it.sales);
      const avg = (showAvg && (it.count || 0) > 0) ? Math.floor(dispSales / (it.count || 0)) : 0;
      const apoAchv = typeof it.apoAchv === "number" ? it.apoAchv : 0;
      const targetDetailHtml = targetBreakdownByName
        ? renderTargetRecordDetailsHtml(targetBreakdownByName.get(it.name), fieldMap, "対象レコードを表示")
        : "";
      const nameSafe = String(it.name || "").replace(/</g, "&lt;");
      const crownBranch = (typeof it.achv === "number" && it.achv >= 100)
        ? '<span class="apr-crown apr-crown--inline" aria-hidden="true">💮</span>'
        : "";
      const nameCellHtml = `<td class="apr-name" data-label="担当者"><span class="apr-name-line">${crownBranch}<span class="apr-name-text">${nameSafe}</span></span></td>`;
      rows += `<tr>
        ${showApo ? `<td class="apr-num apr-col-branch" data-label="支社">${String(it.branch || "").replace(/</g, "&lt;")}</td>` : `<td class="apr-rank" data-label="順位">${i + 1}</td>`}
        ${nameCellHtml}
        <td class="apr-num apr-col-m1" data-label="指標">
          ${showApo ? `<div class="apr-m1-stack apr-m1-stack--split">
          <section class="apr-m1-sect apr-m1-sect--pt" aria-label="PT・売上・契約">
            <div class="apr-m1-sect__head">PT・売上・契約</div>
            <div class="apr-m1-sect__grid">
          <div class="apr-kv"><span class="apr-k">PT目標</span><span class="apr-v">${numFmt(it.goal != null ? it.goal : 0)}</span></div>
          ${hasPT ? `<div class="apr-kv"><span class="apr-k">PT</span><span class="apr-v">${numFmt(it.pt)}</span></div>` : ""}
          ${hasSales ? `<div class="apr-kv"><span class="apr-k">売上〔${taxLabel}〕</span><span class="apr-v">${numFmt(dispSales)}</span></div>` : ""}
          <div class="apr-kv"><span class="apr-k">件数</span><span class="apr-v">${numFmt(it.count)}</span></div>
          ${showMeeting ? `<div class="apr-kv"><span class="apr-k">商談実施数</span><span class="apr-v">${numFmt(it.meetingCount || 0)}</span></div>` : ""}
          ${showAvg ? `<div class="apr-kv apr-kv--avg-branch"><span class="apr-k apr-k--avg-multiline">平均売上単価<br>〔${taxLabel}〕</span><span class="apr-v">${numFmt(avg)}</span></div>` : ""}
          <div class="apr-kv"><span class="apr-k">達成率</span><span class="apr-v">${(typeof it.achv === "number" ? it.achv : 0).toFixed(1)}%</span></div>
            </div>
          </section>
          <section class="apr-m1-sect apr-m1-sect--apo" aria-label="アポ">
            <div class="apr-m1-sect__head">アポ</div>
            <div class="apr-m1-sect__grid">
          <div class="apr-kv"><span class="apr-k">アポ目標</span><span class="apr-v">${numFmt(it.apoGoal != null ? it.apoGoal : 0)}</span></div>
          <div class="apr-kv"><span class="apr-k">アポ獲得数</span><span class="apr-v">${numFmt(it.actualCount || 0)}</span></div>
          <div class="apr-kv"><span class="apr-k">アポ実績数</span><span class="apr-v">${numFmt(it.apoCount || 0)}</span></div>
          <div class="apr-kv"><span class="apr-k">アポキャン数</span><span class="apr-v">${numFmt(it.cancelCount || 0)}</span></div>
          ${showTamaCl ? `<div class="apr-kv"><span class="apr-k">CL残玉数</span><span class="apr-v">${numFmt(it.tamaCount || 0)}</span></div>` : ""}
          ${showTamaAp ? `<div class="apr-kv"><span class="apr-k">AP残玉数</span><span class="apr-v">${numFmt(it.tamaCountAp || 0)}</span></div>` : ""}
          <div class="apr-kv"><span class="apr-k">アポ達成率</span><span class="apr-v">${apoAchv.toFixed(1)}%</span></div>
            </div>
          </section>
          </div>` : `<div class="apr-m1-stack">
          <div class="apr-kv"><span class="apr-k">PT目標</span><span class="apr-v">${numFmt(it.goal != null ? it.goal : 0)}</span></div>
          ${hasPT ? `<div class="apr-kv"><span class="apr-k">PT</span><span class="apr-v">${numFmt(it.pt)}</span></div>` : ""}
          ${hasSales ? `<div class="apr-kv"><span class="apr-k">売上〔${taxLabel}〕</span><span class="apr-v">${numFmt(dispSales)}</span></div>` : ""}
          <div class="apr-kv"><span class="apr-k">件数</span><span class="apr-v">${numFmt(it.count)}</span></div>
          ${showMeeting ? `<div class="apr-kv"><span class="apr-k">商談実施数</span><span class="apr-v">${numFmt(it.meetingCount || 0)}</span></div>` : ""}
          ${showAvg ? `<div class="apr-kv"><span class="apr-k">平均売上単価〔${taxLabel}〕</span><span class="apr-v">${numFmt(avg)}</span></div>` : ""}
          <div class="apr-kv"><span class="apr-k">達成率</span><span class="apr-v">${(typeof it.achv === "number" ? it.achv : 0).toFixed(1)}%</span></div>
          ${showClPacemaker ? `<div class="apr-kv"><span class="apr-k">ペースメーカー</span><span class="apr-v">${formatClPacemakerCell(it, clPacemakerCtx)}</span></div>` : ""}
          </div>`}
        </td>
        ${hasSales ? `<td class="apr-num apr-col-m2" data-label="売上〔${taxLabel}〕/ 平均">
          <div class="apr-kv"><span class="apr-k">売上〔${taxLabel}〕</span><span class="apr-v">${numFmt(dispSales)}</span></div>
          ${showAvg ? `<div class="apr-kv"><span class="apr-k">平均</span><span class="apr-v">${numFmt(avg)}</span></div>` : ""}
        </td>` : ""}
        <td class="apr-num apr-col-goal" data-label="PT目標">${numFmt(it.goal != null ? it.goal : 0)}</td>
        ${hasPT ? `<td class="apr-num apr-col-pt" data-label="PT">${numFmt(it.pt)}</td>` : ""}
        ${hasSales ? `<td class="apr-num apr-col-sales" data-label="売上〔${taxLabel}〕">${numFmt(dispSales)}</td>` : ""}
        ${showAvg ? `<td class="apr-num apr-col-avg" data-label="平均売上単価〔${taxLabel}〕">${numFmt(avg)}</td>` : ""}
        <td class="apr-num apr-col-count" data-label="契約件数">${numFmt(it.count)}</td>
        ${showMeeting ? `<td class="apr-num apr-col-meeting" data-label="商談実施数">${numFmt(it.meetingCount || 0)}</td>` : ""}
        <td class="apr-num apr-col-achv" data-label="達成率">${(typeof it.achv === "number" ? it.achv : 0).toFixed(1)}%</td>
        ${showClPacemaker ? `<td class="apr-num apr-col-cl-pacemaker" data-label="ペースメーカー">${formatClPacemakerCell(it, clPacemakerCtx)}</td>` : ""}
        ${showApo ? `<td class="apr-num apr-col-apo-goal" data-label="アポ目標">${numFmt(it.apoGoal != null ? it.apoGoal : 0)}</td>` : ""}
        ${showApo ? `<td class="apr-num apr-col-apo-actual" data-label="アポ獲得数">${numFmt(it.actualCount || 0)}</td>` : ""}
        ${showApo ? `<td class="apr-num apr-col-apo-count" data-label="アポ実績数">${numFmt(it.apoCount || 0)}</td>` : ""}
        ${showApo ? `<td class="apr-num apr-col-apo-cancel" data-label="アポキャン数">${numFmt(it.cancelCount || 0)}</td>` : ""}
        ${showApo && showTamaCl ? `<td class="apr-num apr-col-apo-tama-cl" data-label="CL残玉数">${numFmt(it.tamaCount || 0)}</td>` : ""}
        ${showApo && showTamaAp ? `<td class="apr-num apr-col-apo-tama-ap" data-label="AP残玉数">${numFmt(it.tamaCountAp || 0)}</td>` : ""}
        ${showApo ? `<td class="apr-num apr-col-apo-achv" data-label="アポ達成率">${apoAchv.toFixed(1)}%</td>` : ""}
      </tr>
      ${(() => {
        if (!targetDetailHtml) return "";
        /**
         * PC 既定では `.apr-table--sales .apr-col-m1,.apr-col-m2` が display:none で列が参加しない。
         * thead/tbody と同じ「参加列数」に合わせないと、colspan が過剰になり右端に空列ができる。
         * 支社別は `.apr-table--branch-no-col` で支社列も不参加のため、その分も除外する。
         * 支社別モバイル（max-width 640px）は担当者＋指標の2列のみ表示のため、対象レコード行の colspan は 2 に合わせる。
         */
        const narrowStackLayout =
          typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
        const dupStacksSuppressedOnPc = !narrowStackLayout;
        let participantCols = tableColCount;
        if (showApo) participantCols -= 1;
        if (dupStacksSuppressedOnPc) participantCols -= 1 + (hasSales ? 1 : 0);
        if (showApo) {
          const spanCols = narrowStackLayout ? 2 : Math.max(1, participantCols);
          return `<tr class="apr-target-inline-row apr-target-inline-row--branch"><td class="apr-target-inline-cell" colspan="${spanCols}">${targetDetailHtml}</td></tr>`;
        }
        const cs = Math.max(1, participantCols - 1);
        return `<tr class="apr-target-inline-row"><td class="apr-rank apr-target-inline-pad" data-label="順位"></td><td class="apr-target-inline-cell" colspan="${cs}">${targetDetailHtml}</td></tr>`;
      })()}`;
    }
    if (showApo && acc !== null) {
      rows += buildSubtotalRow(acc, branchLabel, salesDisplay, taxLabel, hasPT, hasSales, showAvg, numFmt);
    }

    const branchWrapClass = showApo ? " apr-table-wrap--branch" : "";
    const branchTableClass = showApo ? " apr-table--branch apr-table--branch-no-col" : "";
    const branchScrollOpen = showApo ? `<div class="apr-table-scroll-x">` : "";
    const branchScrollClose = showApo ? `</div>` : "";
    container.innerHTML = `
      ${totalPanelHtml}
      <div class="apr-table-wrap${branchWrapClass}${rankBorderWrapClass}">
        ${branchScrollOpen}
        <table class="apr-table apr-table--sales${branchTableClass}${rankBorderTableClass}">
          <thead><tr>${headCols}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${branchScrollClose}
      </div>
    `;
  }

  function buildSalesTargetBreakdownRows(records, fieldMap, period, query, taxMode, contractLinkage) {
    const isExcludeTax = (taxMode || "exclude") === "exclude";
    const salesDisplay = (s) => isExcludeTax ? Math.floor(Number(s || 0) / 1.1) : Number(s || 0);
    const q = String(query || "").trim().toLowerCase();
    const m = new Map();
    let total = 0;
    const byAppt = contractLinkage && contractLinkage.byAppt instanceof Map ? contractLinkage.byAppt : null;
    const byClpt = contractLinkage && contractLinkage.byClpt instanceof Map ? contractLinkage.byClpt : null;
    const linkageFm = contractLinkage && contractLinkage.fm ? contractLinkage.fm : null;

    for (const r of records || []) {
      const recObj = r && r.record ? r.record : {};
      const name = normalizePersonName(extractValue(recObj[fieldMap.salesperson]));
      if (!name) continue;
      if (q && !name.toLowerCase().includes(q)) continue;
      const d = parseDate(recObj[fieldMap.date]);
      const needsDateFilter = period && (period.start || period.end);
      if (needsDateFilter && !inRange(d, period)) continue;
      const pt = fieldMap.pt ? parseNumber(extractValue(recObj[fieldMap.pt])) : 0;
      if (pt === 0) continue;
      const sales = fieldMap.sales ? salesDisplay(parseNumber(extractValue(recObj[fieldMap.sales]))) : 0;
      const customerName = fieldMap.customerName ? String(extractValue(recObj[fieldMap.customerName]) || "").trim() : "";
      const introductionRoute = fieldMap.introductionRoute ? String(extractValue(recObj[fieldMap.introductionRoute]) || "").trim() : "";
      const regRaw = fieldMap.regNo ? extractValue(recObj[fieldMap.regNo]) : "";
      const regKey = normalizeRegNoForLinkage(regRaw);
      if (regKey.startsWith("PL")) continue;

      const cur = m.get(name) || { name, count: 0, pt: 0, sales: 0, details: [] };
      cur.count += 1;
      cur.pt += pt;
      cur.sales += sales;

      const ptDateStr = d ? fmtYMD(d) : "(日付なし)";
      const regDisp = String(regRaw || "").trim();

      if (regKey.startsWith("APPT")) {
        if (linkageFm && byAppt) {
          const hits = byAppt.get(regKey) || [];
          if (hits.length) {
            for (let hi = 0; hi < hits.length; hi++) {
              cur.details.push(buildContractLinkedDetailRow(hits[hi], linkageFm, taxMode, {
                dutyKind: "cl",
                ptSheet: pt,
                salesSheet: sales,
                ptRegNo: regDisp,
                linkLabel: "APPT登録番号",
              }));
            }
          } else {
            cur.details.push({
              detailKind: "miss",
              date: ptDateStr,
              ptRegNo: regDisp,
              linkLabel: "APPT登録番号",
              note: "契約情報入力フォームに該当するレコードがありません。",
              pt,
              sales,
              introductionRoute: introductionRoute || "(未設定)",
              customerName: customerName || "(未設定)",
            });
          }
        } else {
          cur.details.push({
            detailKind: "miss",
            date: ptDateStr,
            ptRegNo: regDisp,
            linkLabel: "APPT登録番号",
            note: "契約情報入力フォームの取得に失敗しているか、「APPT登録番号」フィールドを確認してください。",
            pt,
            sales,
            introductionRoute: introductionRoute || "(未設定)",
            customerName: customerName || "(未設定)",
          });
        }
      } else if (regKey.startsWith("CLPT")) {
        if (linkageFm && byClpt) {
          const hits = byClpt.get(regKey) || [];
          if (hits.length) {
            for (let hi = 0; hi < hits.length; hi++) {
              cur.details.push(buildContractLinkedDetailRow(hits[hi], linkageFm, taxMode, {
                dutyKind: "ap",
                ptSheet: pt,
                salesSheet: sales,
                ptRegNo: regDisp,
                linkLabel: "CLPT登録番号",
              }));
            }
          } else {
            cur.details.push({
              detailKind: "miss",
              date: ptDateStr,
              ptRegNo: regDisp,
              linkLabel: "CLPT登録番号",
              note: "契約情報入力フォームに該当するレコードがありません。",
              pt,
              sales,
              introductionRoute: introductionRoute || "(未設定)",
              customerName: customerName || "(未設定)",
            });
          }
        } else {
          cur.details.push({
            detailKind: "miss",
            date: ptDateStr,
            ptRegNo: regDisp,
            linkLabel: "CLPT登録番号",
            note: "契約情報入力フォームの取得に失敗しているか、「CLPT登録番号」フィールドを確認してください。",
            pt,
            sales,
            introductionRoute: introductionRoute || "(未設定)",
            customerName: customerName || "(未設定)",
          });
        }
      } else {
        cur.details.push({
          detailKind: "legacy",
          date: ptDateStr,
          introductionRoute: introductionRoute || "(未設定)",
          customerName: customerName || "(未設定)",
          pt,
          sales,
        });
      }

      m.set(name, cur);
      total += 1;
    }
    const rows = Array.from(m.values()).sort((a, b) =>
      (b.count - a.count) || (b.pt - a.pt) || (b.sales - a.sales) || a.name.localeCompare(b.name, "ja")
    );
    return { rows, total };
  }

  function renderTargetRecordDetailsHtml(detail, fieldMap, summaryLabel) {
    if (!detail) return "";
    const hasSales = !!fieldMap.sales;
    const esc = (s) => String(s ?? "").replace(/</g, "&lt;");
    const details = detail.details || [];
    const useContractLayout = details.some((d) => d && d.detailKind && d.detailKind !== "legacy");

    const sortKey = (d) => {
      if (d && d.detailKind === "contract") return String(d.date || "");
      return String(d.date || "");
    };

    if (!useContractLayout) {
      const cols = hasSales ? "40px 110px 130px minmax(140px,1fr) 90px 100px" : "40px 110px 130px minmax(180px,1fr) 90px";
      const totalPt = details.reduce((acc, d) => acc + Number(d.pt || 0), 0);
      const totalSales = hasSales ? details.reduce((acc, d) => acc + Number(d.sales || 0), 0) : 0;
      const detailRows = details
        .slice()
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b), "ja"))
        .map((d, idx) => `
        <div class="apr-target-row">
          <span class="apr-target-cell apr-target-cell--center" data-label="No">${idx + 1}</span>
          <span class="apr-target-cell apr-target-cell--date" data-label="日付">${esc(d.date)}</span>
          <span class="apr-target-cell apr-target-cell--route" data-label="導入経緯">${esc(d.introductionRoute)}</span>
          <span class="apr-target-cell apr-target-cell--name" data-label="お客様名">${esc(d.customerName)}</span>
          <span class="apr-target-cell apr-target-cell--num" data-label="PT">${numFmt(d.pt || 0)}</span>
          ${hasSales ? `<span class="apr-target-cell apr-target-cell--num" data-label="売上">${numFmt(d.sales || 0)}</span>` : ""}
        </div>
      `).join("");
      return `
      <details style="margin-top:6px;">
        <summary style="cursor:pointer; font-size:12px; font-weight:700;">${esc(summaryLabel)}（${numFmt(detail.count)}件）</summary>
        <div class="apr-target-meta">
          <span class="apr-target-badge">件数: ${numFmt(detail.count)}件</span>
          <span class="apr-target-badge">PT合計: ${numFmt(totalPt)}</span>
          ${hasSales ? `<span class="apr-target-badge">売上合計: ${numFmt(totalSales)}</span>` : ""}
        </div>
        <div class="apr-target-scroll">
          <div class="apr-target-list" style="--apr-target-cols:${cols};">
            <div class="apr-target-head">
              <span class="apr-target-cell--center">No</span>
              <span>日付</span>
              <span>導入経緯</span>
              <span>お客様名</span>
              <span class="apr-target-cell--num">PT</span>
              ${hasSales ? `<span class="apr-target-cell--num">売上</span>` : ""}
            </div>
            ${detailRows}
          </div>
        </div>
      </details>
    `;
    }

    const totalPt = details.reduce((acc, d) => acc + Number((d.detailKind === "contract" ? d.ptFromPtSheet : d.pt) || 0), 0);
    const totalSalesSheet = hasSales
      ? details.reduce((acc, d) => acc + Number((d.detailKind === "contract" ? d.salesFromPtSheet : d.sales) || 0), 0)
      : 0;
    const totalContractSales = details.reduce((acc, d) => acc + (d.detailKind === "contract" ? Number(d.contractSalesDisplay || 0) : 0), 0);

    /** 紐付・PTの登録番号列は UI から非表示（突合には引き続き利用） */
    const cols = hasSales
      ? "36px minmax(108px,1fr) 88px minmax(100px,1fr) minmax(88px,1fr) minmax(56px,auto) minmax(56px,auto) minmax(56px,auto) minmax(56px,auto)"
      : "36px minmax(108px,1fr) 88px minmax(100px,1fr) minmax(88px,1fr) minmax(56px,auto) minmax(56px,auto)";

    const detailRows = details
      .slice()
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b), "ja"))
      .map((d, idx) => {
        if (d.detailKind === "contract") {
          return `
        <div class="apr-target-row">
          <span class="apr-target-cell apr-target-cell--center" data-label="No">${idx + 1}</span>
          <span class="apr-target-cell apr-target-cell--date" data-label="契約日">${esc(d.date)}</span>
          <span class="apr-target-cell" data-label="${esc(d.dutyCaption || "CL担当")}">${esc(d.dutyName != null ? d.dutyName : "")}</span>
          <span class="apr-target-cell apr-target-cell--route" data-label="導入経緯">${esc(d.introductionRoute)}</span>
          <span class="apr-target-cell apr-target-cell--name" data-label="顧客氏名">${esc(d.customerName)}</span>
          <span class="apr-target-cell apr-target-cell--num" data-label="PT(集計)">${numFmt(d.ptFromPtSheet || 0)}</span>
          ${hasSales ? `<span class="apr-target-cell apr-target-cell--num" data-label="売上(集計)">${numFmt(d.salesFromPtSheet || 0)}</span>` : ""}
          ${hasSales ? `<span class="apr-target-cell apr-target-cell--num" data-label="契約売上">${numFmt(d.contractSalesDisplay || 0)}</span>` : ""}
        </div>`;
        }
        if (d.detailKind === "miss") {
          return `
        <div class="apr-target-row">
          <span class="apr-target-cell apr-target-cell--center" data-label="No">${idx + 1}</span>
          <span class="apr-target-cell apr-target-cell--date" data-label="PT日付">${esc(d.date)}</span>
          <span class="apr-target-cell" data-label="担当">—</span>
          <span class="apr-target-cell apr-target-cell--route" data-label="導入経緯(PT)">${esc(d.introductionRoute)}</span>
          <span class="apr-target-cell apr-target-cell--name" data-label="状況">${esc(d.note)}</span>
          <span class="apr-target-cell apr-target-cell--num" data-label="PT(集計)">${numFmt(d.pt || 0)}</span>
          ${hasSales ? `<span class="apr-target-cell apr-target-cell--num" data-label="売上(集計)">${numFmt(d.sales || 0)}</span>` : ""}
          ${hasSales ? `<span class="apr-target-cell apr-target-cell--num" data-label="契約売上">—</span>` : ""}
        </div>`;
        }
        return `
        <div class="apr-target-row">
          <span class="apr-target-cell apr-target-cell--center" data-label="No">${idx + 1}</span>
          <span class="apr-target-cell apr-target-cell--date" data-label="日付">${esc(d.date)}</span>
          <span class="apr-target-cell" data-label="担当">—</span>
          <span class="apr-target-cell apr-target-cell--route" data-label="導入経緯">${esc(d.introductionRoute)}</span>
          <span class="apr-target-cell apr-target-cell--name" data-label="お客様名(PT)">${esc(d.customerName)}</span>
          <span class="apr-target-cell apr-target-cell--num" data-label="PT(集計)">${numFmt(d.pt || 0)}</span>
          ${hasSales ? `<span class="apr-target-cell apr-target-cell--num" data-label="売上(集計)">${numFmt(d.sales || 0)}</span>` : ""}
          ${hasSales ? `<span class="apr-target-cell apr-target-cell--num" data-label="契約売上">—</span>` : ""}
        </div>`;
      })
      .join("");

    return `
      <details style="margin-top:6px;">
        <summary style="cursor:pointer; font-size:12px; font-weight:700;">${esc(summaryLabel)}（${numFmt(detail.count)}件）</summary>
        <div class="apr-target-meta">
          <span class="apr-target-badge">件数: ${numFmt(detail.count)}件</span>
          <span class="apr-target-badge">PT合計: ${numFmt(totalPt)}</span>
          ${hasSales ? `<span class="apr-target-badge">売上合計(集計): ${numFmt(totalSalesSheet)}</span>` : ""}
          ${hasSales ? `<span class="apr-target-badge">契約売上合計: ${numFmt(totalContractSales)}</span>` : ""}
        </div>
        <div class="apr-target-scroll">
          <div class="apr-target-list" style="--apr-target-cols:${cols};">
            <div class="apr-target-head">
              <span class="apr-target-cell--center">No</span>
              <span>日付</span>
              <span>CL/AP</span>
              <span>導入経緯</span>
              <span>顧客氏名</span>
              <span class="apr-target-cell--num">PT(集計)</span>
              ${hasSales ? `<span class="apr-target-cell--num">売上(集計)</span><span class="apr-target-cell--num">契約売上</span>` : ""}
            </div>
            ${detailRows}
          </div>
        </div>
      </details>
    `;
  }

  function renderSalesChart(container, result, fieldMap, query, metric, taxMode, records, period, contractLinkage) {
    taxMode = taxMode || "exclude";
    const isExcludeTax = taxMode === "exclude";
    const taxLabel = isExcludeTax ? "税抜" : "税込";
    const salesDisplay = (s) => isExcludeTax ? Math.floor(Number(s || 0) / 1.1) : Number(s || 0);

    const hasPT = !!fieldMap.pt;
    const hasSales = !!fieldMap.sales;

    const metricKey = metric || (hasPT ? "pt" : (hasSales ? "sales" : "count"));
    const metricLabel = (metricKey === "pt") ? "PT"
      : (metricKey === "count") ? "件数"
      : (metricKey === "avg") ? `平均売上単価〔${taxLabel}〕`
      : `売上〔${taxLabel}〕`;

    function getValue(it) {
      if (metricKey === "pt") return Number(it.pt || 0);
      if (metricKey === "count") return Number(it.count || 0);
      if (metricKey === "avg") {
        const disp = salesDisplay(it.sales);
        return (it.count || 0) > 0 ? Math.floor(disp / (it.count || 0)) : 0;
      }
      return salesDisplay(it.sales);
    }

    const items = (result.items || [])
      .filter(x => !query || x.name.toLowerCase().includes(query.toLowerCase()))
      .slice()
      .sort((a, b) => (getValue(b) - getValue(a)) || a.name.localeCompare(b.name))
      .slice(0, 10);

    if (!items.length) {
      container.innerHTML = `<div class="apr-empty">該当データがありません。</div>`;
      return;
    }

    const breakdownRows = buildSalesTargetBreakdownRows(records, fieldMap, period, query, taxMode, contractLinkage).rows;
    const breakdownByName = new Map(breakdownRows.map((x) => [x.name, x]));

    let rows = "";
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const rank = i + 1;
      const metricVal = getValue(it);
      const suffixText = (metricKey === "pt")
        ? (hasPT ? `PT：${numFmt(it.pt)}` : `PT：${numFmt(metricVal)}`)
        : `${metricLabel}：${numFmt(metricVal)}`;
      const suffix = suffixText ? `（${suffixText}）` : "";
      const detail = breakdownByName.get(it.name);
      const breakdownHtml = renderTargetRecordDetailsHtml(detail, fieldMap, "対象レコードを表示");
      rows += `
        <div class="apr-rankitem apr-rankitem--${rank}">
          <span class="apr-rankpos">${rank}位：</span>
          <span class="apr-rankname">${it.name}</span>
          ${suffix ? `<span class="apr-rankpt">${suffix}</span>` : ""}
          ${breakdownHtml}
        </div>
      `;
    }

    container.innerHTML = `
      <div class="apr-chart apr-rankviz">
        <div class="apr-chart-head">${metricLabel}ランキング（1位〜10位）</div>
        <div class="apr-chart-sub">※順位（ランキング）をメインに表示（数値は名前の横に表示）</div>
        <div class="apr-ranklist">${rows}</div>
      </div>
    `;
  }

  function renderSalesTargetBreakdownHtml(records, fieldMap, period, query, taxMode, contractLinkage) {
    const breakdown = buildSalesTargetBreakdownRows(records, fieldMap, period, query, taxMode, contractLinkage);
    const rows = breakdown.rows;
    const total = breakdown.total;
    const body = rows.length
      ? rows.map((x) => {
        const innerDetails = renderTargetRecordDetailsHtml(
          { count: x.count, details: x.details || [] },
          fieldMap,
          "対象レコードを表示",
        );
        return `
        <tr>
          <td class="apr-name">
            <div style="font-weight:700;">${String(x.name || "").replace(/</g, "&lt;")}</div>
            ${innerDetails}
          </td>
          <td class="apr-num">${numFmt(x.count)}</td>
          <td class="apr-num">${numFmt(x.pt)}</td>
          ${fieldMap.sales ? `<td class="apr-num">${numFmt(x.sales)}</td>` : ""}
        </tr>
      `;
      }).join("")
      : `<tr><td class="apr-name">該当なし</td><td class="apr-num">0</td><td class="apr-num">0</td>${fieldMap.sales ? `<td class="apr-num">0</td>` : ""}</tr>`;
    return `
      <details style="margin-top:10px;">
        <summary style="cursor:pointer; font-size:12px; font-weight:700;">対象レコード一覧（担当者別・${numFmt(total)}件）</summary>
        <div class="apr-table-wrap" style="margin-top:8px;">
          <table class="apr-table">
            <thead>
              <tr>
                <th class="apr-name">担当者</th>
                <th class="apr-num">対象レコード数</th>
                <th class="apr-num">PT</th>
                ${fieldMap.sales ? `<th class="apr-num">売上</th>` : ""}
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </details>
    `;
  }

  function renderApoTable(container, result, query) {
    const items = (result.items || [])
      .filter(x => !query || x.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, CONFIG.APO_TOP_N || CONFIG.TOP_N);

    const totals = (result.items || []).reduce((acc, x) => {
      acc.goal += x.goal != null ? x.goal : 0;
      acc.actualCount += x.actualCount || 0;
      acc.count += x.count || 0;
      acc.meetingCount += x.meetingCount || 0;
      acc.contractCount += x.contractCount || 0;
      acc.cancelCount += x.cancelCount || 0;
      acc.workDays += x.workDays || 0;
      acc.plannedWorkDays += x.plannedWorkDays || 0;
      return acc;
    }, { goal: 0, actualCount: 0, count: 0, meetingCount: 0, contractCount: 0, cancelCount: 0, workDays: 0, plannedWorkDays: 0 });
    // 全体アポキャンセル率 = アポキャンセル合計 / アポ獲得数合計
    const totalCancelRate = totals.actualCount > 0 ? (totals.cancelCount / totals.actualCount) * 100 : 0;
    // 商談実施率 = 商談実施数合計 / アポ獲得数合計
    const totalMeetingRate = totals.actualCount > 0 ? (totals.meetingCount / totals.actualCount) * 100 : 0;
    // 達成率 = アポ獲得数合計 / 目標合計
    const totalAchv = totals.goal > 0 ? (totals.actualCount / totals.goal) * 100 : 0;
    // 生産性 = アポ獲得合計 / 稼働日数合計
    const totalProductivity = totals.workDays > 0 ? (totals.actualCount / totals.workDays) : 0;
    // 全体ペースメーカー = アポ獲得合計 / (目標合計 / 稼働予定日数合計 * 稼働日数合計)
    let totalPacemaker = null;
    if (totals.goal > 0 && totals.plannedWorkDays > 0 && totals.workDays > 0) {
      const denom = (totals.goal / totals.plannedWorkDays) * totals.workDays;
      if (denom > 0) totalPacemaker = totals.actualCount / denom;
    }

    const totalPanelHtml = buildApoTotalPanelHtml(
      totals, totalCancelRate, totalMeetingRate, totalAchv, totalProductivity, totalPacemaker
    );

    if (!items.length) {
      container.innerHTML = `
        ${totalPanelHtml}
        <div class="apr-empty">該当データがありません。</div>
      `;
      return;
    }

    const headCols =
      `<th class="apr-rank">順位</th>` +
      `<th class="apr-name">AP担当者</th>` +
      // モバイル用コンパクト列
      `<th class="apr-num apr-col-apo-m1">アポ内訳</th>` +
      // PC用標準列
      `<th class="apr-num apr-col-apo-goal">目標</th>` +
      `<th class="apr-num apr-col-apo-actual">アポ獲得数</th>` +
      `<th class="apr-num apr-col-apo-count">アポ実績数</th>` +
      `<th class="apr-num apr-col-apo-meeting">商談実施数</th>` +
      `<th class="apr-num apr-col-apo-contract">契約件数</th>` +
      `<th class="apr-num apr-col-apo-cancel">アポキャン数</th>` +
      `<th class="apr-num apr-col-apo-meeting-rate">商談実施率</th>` +
      `<th class="apr-num apr-col-apo-rate">アポキャンセル率</th>` +
      `<th class="apr-num apr-col-apo-workdays">稼働日数</th>` +
      `<th class="apr-num apr-col-apo-productivity">生産性</th>` +
      `<th class="apr-num apr-col-apo-achv">達成率</th>` +
      `<th class="apr-num apr-col-apo-pacemaker">ペースメーカー</th>`;

    let rows = "";
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      // アポキャンセル率 = アポキャン数 / アポ獲得数
      const rate = (it.actualCount || 0) > 0 ? (it.cancelCount / it.actualCount) * 100 : 0;
      // 商談実施率 = 商談実施数 / アポ獲得数
      const meetingRate = (it.actualCount || 0) > 0 ? ((it.meetingCount || 0) / it.actualCount) * 100 : 0;
      // 生産性 = アポ獲得数 / 稼働日数
      const productivity = (it.workDays || 0) > 0 ? (it.actualCount || 0) / it.workDays : null;
      // ペースメーカー = アポ獲得数 / (目標 / 稼働予定日数 * 稼働日数)
      let pacemaker = null;
      if ((it.goal || 0) > 0 && (it.plannedWorkDays || 0) > 0 && (it.workDays || 0) > 0) {
        const denom = (it.goal / it.plannedWorkDays) * it.workDays;
        if (denom > 0) pacemaker = (it.actualCount || 0) / denom;
      }
      const apNameSafe = String(it.name || "").replace(/</g, "&lt;");
      const apCrown = (typeof it.achv === "number" && it.achv >= 100)
        ? '<span class="apr-crown apr-crown--inline" aria-hidden="true">💮</span>'
        : "";
      rows += `<tr>
        <td class="apr-rank" data-label="順位">${i + 1}</td>
        <td class="apr-name" data-label="AP担当者"><span class="apr-name-line">${apCrown}<span class="apr-name-text">${apNameSafe}</span></span></td>
        <td class="apr-num apr-col-apo-m1" data-label="アポ内訳">
          <div class="apr-kv"><span class="apr-k">目標</span><span class="apr-v">${numFmt(it.goal != null ? it.goal : 0)}</span></div>
          <div class="apr-kv"><span class="apr-k">獲得数</span><span class="apr-v">${numFmt(it.actualCount || 0)}</span></div>
          <div class="apr-kv"><span class="apr-k">実績</span><span class="apr-v">${numFmt(it.count || 0)}</span></div>
          <div class="apr-kv"><span class="apr-k">商談実施数</span><span class="apr-v">${numFmt(it.meetingCount || 0)}</span></div>
          <div class="apr-kv"><span class="apr-k">契約件数</span><span class="apr-v">${numFmt(it.contractCount || 0)}</span></div>
          <div class="apr-kv"><span class="apr-k">キャンセル数</span><span class="apr-v">${numFmt(it.cancelCount || 0)}</span></div>
          <div class="apr-kv"><span class="apr-k">稼働日数</span><span class="apr-v">${numFmt(it.workDays || 0)}</span></div>
          <div class="apr-kv"><span class="apr-k">生産性</span><span class="apr-v">${productivity != null ? productivity.toFixed(2) : "—"}</span></div>
          <div class="apr-kv"><span class="apr-k">商談実施率</span><span class="apr-v">${meetingRate.toFixed(1)}%</span></div>
          <div class="apr-kv"><span class="apr-k">キャンセル率</span><span class="apr-v">${rate.toFixed(1)}%</span></div>
          <div class="apr-kv"><span class="apr-k">達成率</span><span class="apr-v">${(typeof it.achv === "number" ? it.achv : 0).toFixed(1)}%</span></div>
          <div class="apr-kv"><span class="apr-k">ペースメーカー</span><span class="apr-v">${pacemaker != null ? (pacemaker * 100).toFixed(1) + "%" : "—"}</span></div>
        </td>
        <td class="apr-num apr-col-apo-goal" data-label="目標">${numFmt(it.goal != null ? it.goal : 0)}</td>
        <td class="apr-num apr-col-apo-actual" data-label="アポ獲得数">${numFmt(it.actualCount || 0)}</td>
        <td class="apr-num apr-col-apo-count" data-label="アポ実績数">${numFmt(it.count || 0)}</td>
        <td class="apr-num apr-col-apo-meeting" data-label="商談実施数">${numFmt(it.meetingCount || 0)}</td>
        <td class="apr-num apr-col-apo-contract" data-label="契約件数">${numFmt(it.contractCount || 0)}</td>
        <td class="apr-num apr-col-apo-cancel" data-label="アポキャン数">${numFmt(it.cancelCount || 0)}</td>
        <td class="apr-num apr-col-apo-meeting-rate" data-label="商談実施率">${meetingRate.toFixed(1)}%</td>
        <td class="apr-num apr-col-apo-rate" data-label="アポキャンセル率">${rate.toFixed(1)}%</td>
        <td class="apr-num apr-col-apo-workdays" data-label="稼働日数">${numFmt(it.workDays || 0)}</td>
        <td class="apr-num apr-col-apo-productivity" data-label="生産性">${productivity != null ? productivity.toFixed(2) : "—"}</td>
        <td class="apr-num apr-col-apo-achv" data-label="達成率">${(typeof it.achv === "number" ? it.achv : 0).toFixed(1)}%</td>
        <td class="apr-num apr-col-apo-pacemaker" data-label="ペースメーカー">${pacemaker != null ? (pacemaker * 100).toFixed(1) + "%" : "—"}</td>
      </tr>`;
    }

    container.innerHTML = `
      ${totalPanelHtml}
      <div class="apr-table-wrap apr-table-wrap--rank-bordered">
        <table class="apr-table apr-table--apo apr-table--rank-bordered">
          <thead><tr>${headCols}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function renderApoChart(container, result, query) {
    const items = (result.items || [])
      .filter(x => !query || x.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 10);

    if (!items.length) {
      container.innerHTML = `<div class="apr-empty">該当データがありません。</div>`;
      return;
    }

    let rows = "";
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const rank = i + 1;
      const achvText = typeof it.achv === "number" ? it.achv.toFixed(1) + "%" : "—";
      const suffix = `アポ実績：${numFmt(it.count || 0)}（達成率 ${achvText}）`;
      rows += `
        <div class="apr-rankitem apr-rankitem--${rank}">
          <span class="apr-rankpos">${rank}位：</span>
          <span class="apr-rankname">${it.name}</span>
          <span class="apr-rankpt">${suffix}</span>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="apr-chart apr-rankviz">
        <div class="apr-chart-head">ランキング（1位〜10位）</div>
        <div class="apr-chart-sub">※グラフ表示は順位（ランキング）を重視</div>
        <div class="apr-ranklist">${rows}</div>
      </div>
    `;
  }

  /* =========================
   * 5.5) View switcher (Sales / Apo)
   * ========================= */
  const SWITCHER = {
    ROOT_ID: "ap-ranking-switcher-v1",
    PANELS_ID: "ap-ranking-panels-v1",
    VIEW_STORAGE_KEY: "apRankingView:v1",
    /** 旧 localStorage 値。CL/AP は VIEW_SALES_HUB に統一 */
    VIEW_SALES: "sales",
    VIEW_APO: "apo",
    VIEW_SALES_HUB: "salesHub",
    SALES_HUB_ID: "ap-sales-ranking-hub-v1",
    SALES_HUB_SUBVIEW_KEY: "apRankingSalesSubView:v1",
    VIEW_SALES_ANALYSIS: "salesAnalysis",
    VIEW_AWARDS: "awards",
    SALES_ROOT_ID: () => CONFIG.WIDGET_ID,
    APO_ROOT_ID: () => "ap-apo-ranking-root-v1",
    SALES_ANALYSIS_ROOT_ID: () => "ap-sales-analysis-root-v1",
    AWARDS_ROOT_ID: () => "ap-awards-root-v1",
  };

  function readSalesHubSubViewDefault() {
    try {
      const s = localStorage.getItem(SWITCHER.SALES_HUB_SUBVIEW_KEY);
      if (s === "ap" || s === "cl") return s;
    } catch (e) {}
    return "cl";
  }

  function writeSalesHubSubView(sub) {
    try {
      localStorage.setItem(SWITCHER.SALES_HUB_SUBVIEW_KEY, sub === "ap" ? "ap" : "cl");
    } catch (e) {}
  }

  function applySalesHubSubViewDisplay() {
    const salesEl = document.getElementById(SWITCHER.SALES_ROOT_ID());
    const apoEl = document.getElementById(SWITCHER.APO_ROOT_ID());
    if (!salesEl || !apoEl) return;
    const sub = readSalesHubSubViewDefault();
    if (sub === "ap") {
      salesEl.style.display = "none";
      apoEl.style.display = "";
    } else {
      salesEl.style.display = "";
      apoEl.style.display = "none";
    }
  }

  /** 営業ランキング内の CL / AP 切替（セグメントタブ）の表示状態を同期 */
  function syncSalesHubSubTabState(hubEl) {
    if (!hubEl) return;
    const sub = readSalesHubSubViewDefault();
    const wrap = hubEl.querySelector("[data-ap-sales-hub-tabs]");
    if (!wrap) return;
    for (const btn of wrap.querySelectorAll("button.apr-tab[data-sub]")) {
      const k = btn.getAttribute("data-sub");
      const on = (k === "ap" && sub === "ap") || (k === "cl" && sub === "cl");
      btn.setAttribute("aria-selected", String(on));
    }
  }

  /**
   * CLランキング・APランキングを1つの「営業ランキング」ブロックにまとめ、表示種別で切替
   */
  function ensureSalesHubLayout() {
    const panels = document.getElementById(SWITCHER.PANELS_ID);
    if (!panels || document.getElementById(SWITCHER.SALES_HUB_ID)) return;
    const salesEl = document.getElementById(SWITCHER.SALES_ROOT_ID());
    const apoEl = document.getElementById(SWITCHER.APO_ROOT_ID());
    if (!salesEl || !apoEl) return;

    const hub = el("div", { id: SWITCHER.SALES_HUB_ID, class: "apr-wrap" });
    const cur = readSalesHubSubViewDefault();
    const subTabs = el("div", { class: "apr-tabs apr-sales-hub-tabs" });
    subTabs.setAttribute("data-ap-sales-hub-tabs", "1");

    function onPickSub(key) {
      return function () {
        writeSalesHubSubView(key);
        applySalesHubSubViewDisplay();
        syncSalesHubSubTabState(document.getElementById(SWITCHER.SALES_HUB_ID));
      };
    }
    subTabs.appendChild(el("button", {
      class: "apr-tab apr-mode-tab",
      type: "button",
      "data-sub": "cl",
      "aria-selected": String(cur === "cl"),
      onclick: onPickSub("cl"),
    }, "CLランキング"));
    subTabs.appendChild(el("button", {
      class: "apr-tab apr-mode-tab",
      type: "button",
      "data-sub": "ap",
      "aria-selected": String(cur === "ap"),
      onclick: onPickSub("ap"),
    }, "APランキング"));
    hub.appendChild(subTabs);

    panels.insertBefore(hub, salesEl);
    salesEl.remove();
    apoEl.remove();
    hub.appendChild(salesEl);
    hub.appendChild(apoEl);
    applySalesHubSubViewDisplay();
  }

  function readActiveViewDefault() {
    try {
      const v = localStorage.getItem(SWITCHER.VIEW_STORAGE_KEY);
      if (v === SWITCHER.VIEW_SALES || v === SWITCHER.VIEW_APO) {
        try {
          if (v === SWITCHER.VIEW_APO) localStorage.setItem(SWITCHER.SALES_HUB_SUBVIEW_KEY, "ap");
          else localStorage.setItem(SWITCHER.SALES_HUB_SUBVIEW_KEY, "cl");
        } catch (e) {}
        return SWITCHER.VIEW_SALES_HUB;
      }
      if (v === SWITCHER.VIEW_SALES_HUB || v === SWITCHER.VIEW_SALES_ANALYSIS || v === SWITCHER.VIEW_AWARDS) return v;
    } catch (e) {}
    return SWITCHER.VIEW_SALES_HUB;
  }

  function writeActiveView(view) {
    try { localStorage.setItem(SWITCHER.VIEW_STORAGE_KEY, view); } catch (e) {}
  }

  function ensureSwitcher(top) {
    let wrap = document.getElementById(SWITCHER.ROOT_ID);
    let panels = document.getElementById(SWITCHER.PANELS_ID);

    if (!wrap) {
      wrap = el("div", { id: SWITCHER.ROOT_ID, class: "apr-wrap" });
      const tabs = el("div", { class: "apr-tabs apr-main-tabs apr-main-tabs--page-switch" });
      const viewLabel = el("div", { class: "apr-hint apr-main-switch-label" }, "表示");
      const viewTrack = el("div", { class: "apr-page-switch-track", role: "tablist" });
      viewTrack.setAttribute("aria-label", "表示するページ");
      const allViewOptions = [
        { key: SWITCHER.VIEW_SALES_HUB, label: "営業", title: "営業ランキング" },
        { key: SWITCHER.VIEW_SALES_ANALYSIS, label: "分析", title: "データ分析" },
        { key: SWITCHER.VIEW_AWARDS, label: "表彰", title: "各表彰集計表" },
      ];

      function makePageButton(opt, activeKey) {
        const on = opt.key === activeKey;
        const full = opt.title || String(opt.label);
        const b = el("button", {
          type: "button",
          class: "apr-page-switch-btn",
          role: "tab",
          "data-view": opt.key,
          "aria-selected": String(on),
          title: full,
        });
        b.setAttribute("aria-label", full);
        b.textContent = String(opt.label);
        b.addEventListener("click", () => applyView(opt.key));
        return b;
      }

      function applyView(view) {
        // If one of the panels doesn't exist (page gating), auto-fallback.
        const salesEl = document.getElementById(SWITCHER.SALES_ROOT_ID());
        const apoEl = document.getElementById(SWITCHER.APO_ROOT_ID());
        const hubEl = document.getElementById(SWITCHER.SALES_HUB_ID);
        const salesAnalysisEl = document.getElementById(SWITCHER.SALES_ANALYSIS_ROOT_ID());
        const awardsEl = document.getElementById(SWITCHER.AWARDS_ROOT_ID());
        const hasSales = !!salesEl;
        const hasApo = !!apoEl;
        const hasRank = hasSales || hasApo;
        const hasSalesAnalysis = !!salesAnalysisEl;
        const hasAwards = !!awardsEl;

        let v = view;
        if (v === SWITCHER.VIEW_SALES || v === SWITCHER.VIEW_APO) v = SWITCHER.VIEW_SALES_HUB;
        if (v !== SWITCHER.VIEW_SALES_HUB && v !== SWITCHER.VIEW_SALES_ANALYSIS && v !== SWITCHER.VIEW_AWARDS) v = SWITCHER.VIEW_SALES_HUB;
        if (v === SWITCHER.VIEW_SALES_HUB && !hasRank) {
          v = hasSalesAnalysis ? SWITCHER.VIEW_SALES_ANALYSIS : (hasAwards ? SWITCHER.VIEW_AWARDS : v);
        }
        if (v === SWITCHER.VIEW_SALES_ANALYSIS && !hasSalesAnalysis) {
          v = hasRank ? SWITCHER.VIEW_SALES_HUB : (hasAwards ? SWITCHER.VIEW_AWARDS : SWITCHER.VIEW_SALES_ANALYSIS);
        }
        if (v === SWITCHER.VIEW_AWARDS && !hasAwards) {
          v = hasSalesAnalysis ? SWITCHER.VIEW_SALES_ANALYSIS : (hasRank ? SWITCHER.VIEW_SALES_HUB : SWITCHER.VIEW_AWARDS);
        }

        if (hubEl) {
          hubEl.style.display = (v === SWITCHER.VIEW_SALES_HUB) ? "" : "none";
          if (v === SWITCHER.VIEW_SALES_HUB) {
            syncSalesHubSubTabState(hubEl);
            applySalesHubSubViewDisplay();
          }
        } else {
          if (v === SWITCHER.VIEW_SALES_HUB) {
            if (hasSales && hasApo) {
              applySalesHubSubViewDisplay();
            } else if (hasSales) {
              salesEl.style.display = "";
              if (apoEl) apoEl.style.display = "none";
            } else if (hasApo) {
              if (salesEl) salesEl.style.display = "none";
              apoEl.style.display = "";
            }
          } else {
            if (salesEl) salesEl.style.display = "none";
            if (apoEl) apoEl.style.display = "none";
          }
        }
        if (salesAnalysisEl) salesAnalysisEl.style.display = (v === SWITCHER.VIEW_SALES_ANALYSIS) ? "" : "none";
        if (awardsEl) awardsEl.style.display = (v === SWITCHER.VIEW_AWARDS) ? "" : "none";

        const available = allViewOptions.filter((opt) => {
          if (opt.key === SWITCHER.VIEW_SALES_HUB) return hasRank;
          if (opt.key === SWITCHER.VIEW_SALES_ANALYSIS) return hasSalesAnalysis;
          if (opt.key === SWITCHER.VIEW_AWARDS) return hasAwards;
          return false;
        });
        viewTrack.innerHTML = "";
        for (const opt of available) {
          viewTrack.appendChild(makePageButton(opt, v));
        }

        // If only one is present, hide the whole selector row
        const count = available.length;
        tabs.style.display = (count >= 2) ? "" : "none";

        writeActiveView(v);
      }

      tabs.appendChild(viewLabel);
      tabs.appendChild(viewTrack);
      wrap.appendChild(tabs);

      panels = el("div", { id: SWITCHER.PANELS_ID });
      wrap.appendChild(panels);

      if (typeof top.prepend === "function") top.prepend(wrap);
      else top.appendChild(wrap);

      // Initial view
      applyView(readActiveViewDefault());
      // Expose updater for later calls
      wrap.__apApplyView = applyView;
    }

    if (!panels) {
      panels = document.getElementById(SWITCHER.PANELS_ID);
    }

    return { wrap, panels };
  }

  function applySwitcherViewIfPresent() {
    const wrap = document.getElementById(SWITCHER.ROOT_ID);
    if (wrap && typeof wrap.__apApplyView === "function") {
      wrap.__apApplyView(readActiveViewDefault());
    }
  }

  /* =========================
   * 6) Main
   * ========================= */
  
  async function bootApo() {
    ensureStyleOnce();

    // page gating
    const currentPageId = getCurrentPageIdSafe();
    if (String(CONFIG.APO_PAGE_ID || "").trim() !== "") {
      if (currentPageId !== String(CONFIG.APO_PAGE_ID).trim()) return;
    }

    const top = atPocket.portal.getContentTopSpaceElement();
    if (!top) return;

    const WIDGET_ID = "ap-apo-ranking-root-v1";
    if (document.getElementById(WIDGET_ID)) return;

    const root = el("div", { id: WIDGET_ID, class: "apr-wrap" });
    const card = el("div", { class: "apr-card" });

    const head = el("div", { class: "apr-head" });
    head.appendChild(el("div", null,
      `<div class="apr-title">APランキング</div><div class="apr-meta">データ元: ${CONFIG.APO_APP_NAME}</div>`
    ));
    const actions = el("div", { class: "apr-actions" });
    const refreshBtn = el("button", { class: "apr-btn", type: "button" }, "再読み込み");
    const toggleBtn = el("button", { class: "apr-btn", type: "button" }, "非表示");
    actions.appendChild(refreshBtn);
    actions.appendChild(toggleBtn);
    head.appendChild(actions);

    const body = el("div", { class: "apr-body" });
    const controlsRow = el("div", { class: "apr-sales-controls" });
    const modeRow = el("div", { class: "apr-sales-control" });
    const modeSelect = el("select", { class: "apr-select" });
    modeRow.appendChild(el("div", { class: "apr-hint" }, "期間"));
    modeRow.appendChild(modeSelect);
    const viewRow = el("div", { class: "apr-sales-control" });
    const viewSelect = el("select", { class: "apr-select" });
    viewRow.appendChild(el("div", { class: "apr-hint" }, "表示"));
    viewRow.appendChild(viewSelect);
    const selectorRow = el("div", { class: "apr-sales-control apr-sales-target" });
    const searchRow = el("div", { class: "apr-row apr-search-row" });
    const periodHintRow = el("div", { class: "apr-row apr-period-hint-row" });
    const search = el("input", { class: "apr-search", type: "search", placeholder: "AP担当者名で検索" });
    const hint = el("div", { class: "apr-hint" }, "読み込み中...");
    const content = el("div", null, `<div class="apr-muted">読み込み中...</div>`);

    controlsRow.appendChild(modeRow);
    controlsRow.appendChild(viewRow);
    controlsRow.appendChild(selectorRow);
    body.appendChild(controlsRow);
    body.appendChild(searchRow);
    body.appendChild(periodHintRow);
    body.appendChild(content);
    searchRow.appendChild(search);
    periodHintRow.appendChild(hint);

    card.appendChild(head);
    card.appendChild(body);
    root.appendChild(card);

    const s = ensureSwitcher(top);
    if (s && s.panels) s.panels.appendChild(root);
    applySwitcherViewIfPresent();

    function getVisibilityKey() {
      return `apRankingVisible:APO:${CONFIG.APO_APP_NAME}`;
    }
    function setBodyVisible(visible) {
      body.style.display = visible ? "" : "none";
      toggleBtn.textContent = visible ? "非表示" : "表示";
      try { localStorage.setItem(getVisibilityKey(), visible ? "1" : "0"); } catch (e) {}
    }
    function readBodyVisibleDefault() {
      try {
        const v = localStorage.getItem(getVisibilityKey());
        if (v === "0") return false;
      } catch (e) {}
      return true;
    }
    setBodyVisible(readBodyVisibleDefault());

    // State
    let mode = "month"; // month | quarter | range | week | cumulative
    let viewMode = "table"; // table | chart
    let fieldMap = null;
    let records = null;
    let goalMonthMap = null;
    let workFieldMap = null;
    let workRecords = null;
    const computed = new Map();
    let monthOptions = [];
    let quarterOptions = [];
    let weekOptions = [];

    // Selectors
    const monthSelect = el("select", { class: "apr-select" });
    const quarterSelect = el("select", { class: "apr-select" });
    const weekSelect = el("select", { class: "apr-select" });
    const rangeStartSelect = el("select", { class: "apr-select" });
    const rangeEndSelect = el("select", { class: "apr-select" });

    function setHint(text) { hint.textContent = text; }

    function makeOption(value, label) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      return o;
    }

    function getViewKey() {
      return `apRankingViewMode:APO:${CONFIG.APO_APP_NAME}`;
    }
    function readViewModeDefault() {
      try {
        const v = localStorage.getItem(getViewKey());
        if (v === "chart" || v === "table") return v;
      } catch (e) {}
      return "table";
    }
    function setViewMode(v) {
      viewMode = v;
      try { localStorage.setItem(getViewKey(), v); } catch (e) {}
      if (viewSelect) viewSelect.value = v;
      computeAndRender();
    }
    function applyViewSelection(val) {
      if (val === "table") setViewMode("table");
      else if (val === "chart") setViewMode("chart");
    }
    function setMode(nextMode) {
      const validModes = new Set(["month", "week", "quarter", "range", "cumulative"]);
      if (!validModes.has(nextMode) || nextMode === mode) return;
      mode = nextMode;
      modeSelect.value = mode;
      renderSelectors();
      computeAndRender();
    }

    function renderModeTabs() {
      modeSelect.innerHTML = "";
      const modes = [
        { key: "month", label: "各月" },
        { key: "week", label: "週（月〜日）" },
        { key: "quarter", label: "四半期（3月起算・2月締め）" },
        { key: "range", label: "期間指定累計" },
        { key: "cumulative", label: "累計" },
      ];
      for (const m of modes) {
        const o = document.createElement("option");
        o.value = m.key;
        o.textContent = m.label;
        if (m.key === mode) o.selected = true;
        modeSelect.appendChild(o);
      }
    }

    function renderViewTabs() {
      viewSelect.innerHTML = "";
      const opts = [
        { value: "table", label: "表" },
        { value: "chart", label: "ランキング" },
      ];
      for (const o of opts) {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === viewMode) opt.selected = true;
        viewSelect.appendChild(opt);
      }
    }

    function renderSelectors() {
      selectorRow.innerHTML = "";

      if (mode === "month") {
        selectorRow.appendChild(el("div", { class: "apr-hint" }, "対象月"));
        selectorRow.appendChild(monthSelect);
      } else if (mode === "quarter") {
        selectorRow.appendChild(el("div", { class: "apr-hint" }, "対象四半期"));
        selectorRow.appendChild(quarterSelect);
      } else if (mode === "week") {
        selectorRow.appendChild(el("div", { class: "apr-hint" }, "対象週"));
        selectorRow.appendChild(weekSelect);
      } else if (mode === "range") {
        selectorRow.appendChild(el("div", { class: "apr-hint" }, "開始月"));
        selectorRow.appendChild(rangeStartSelect);
        selectorRow.appendChild(el("div", { class: "apr-hint" }, "終了月"));
        selectorRow.appendChild(rangeEndSelect);
      } else {
        selectorRow.appendChild(el("div", { class: "apr-hint" }, "全期間"));
      }
    }

    function getCurrentPeriod() {
      if (mode === "month") return buildPeriodFromMonthKey(monthOptions, monthSelect.value);
      if (mode === "quarter") return buildPeriodFromQuarterKey(quarterOptions, quarterSelect.value);
      if (mode === "week") return buildPeriodFromWeekKey(weekOptions, weekSelect.value);
      if (mode === "range") return buildPeriodFromRange(monthOptions, rangeStartSelect.value, rangeEndSelect.value);
      return { key: "cumulative", label: "累計", start: null, end: null, hint: "全期間" };
    }

    function computeAndRender() {
      if (!records || !fieldMap) return;

      const period = getCurrentPeriod();
      if (!period) {
        content.innerHTML = `<div class="apr-err">期間指定が不正です（開始月 ≤ 終了月 を選択してください）。</div>`;
        setHint("期間指定が不正");
        return;
      }

      const cacheKey = `${mode}:${period.key}`;
      let res = computed.get(cacheKey);
      if (!res) {
        res = aggregateApo(records, fieldMap, getApoRankingFilterValues(), period);
        computed.set(cacheKey, res);
      }
      // 稼働日数（稼働終了報告）を期間内レコード件数で集計
      let workDaysMap = new Map();
      if (workRecords && workFieldMap) {
        const workAgg = aggregateWorkDays(workRecords, workFieldMap, period);
        workDaysMap = new Map(workAgg.items.map(it => [it.name, it.workDays]));
      }
      const goalSums = sumGoalsInPeriod(goalMonthMap, period, monthOptions);
      for (const it of res.items) {
        const g = goalSums.get(it.name);
        it.goal = g ? g.apoTarget : 0;
        it.plannedWorkDays = g ? (g.plannedWorkDays || 0) : 0;
        it.achv = (it.goal > 0 && (it.actualCount || 0) >= 0) ? ((it.actualCount || 0) / it.goal) * 100 : 0;
        it.workDays = workDaysMap.has(it.name) ? workDaysMap.get(it.name) : 0;
      }
      // 目標以外が0でも表に目標を表示：目標のみある人を追加
      if (goalMonthMap && goalMonthMap.size) {
        for (const [name, g] of goalSums) {
          if (g.apoTarget > 0 && !res.items.some((it) => it.name === name)) {
            res.items.push({
              name,
              goal: g.apoTarget,
              plannedWorkDays: g.plannedWorkDays || 0,
              actualCount: 0,
              count: 0,
              cancelCount: 0,
              meetingCount: 0,
              contractCount: 0,
              workDays: workDaysMap.has(name) ? workDaysMap.get(name) : 0,
              achv: 0,
            });
          }
        }
        res.items.sort((a, b) => (b.actualCount - a.actualCount) || a.name.localeCompare(b.name));
      }

      if (period.start && period.end) {
        setHint(`期間: ${period.hint}（${fmtYMD(period.start)} ～ ${fmtYMD(new Date(period.end.getTime() - 1))}）`);
      } else {
        setHint(`期間: ${period.hint}`);
      }

      if (viewMode === "chart") renderApoChart(content, res, search.value || "");
      else renderApoTable(content, res, search.value || "");
    }

    async function loadAndInit() {
      computed.clear();
      content.innerHTML = `<div class="apr-muted">データ取得中...</div>`;
      setHint("アプリ情報取得中...");

      const appId = await getAppIdByName(CONFIG.APO_APP_NAME);

      setHint("フィールド取得中...");
      const fields = await getFields(appId);

      fieldMap = buildApoFieldMapForApRanking(fields);

      if (!fieldMap || !fieldMap.salesperson || !fieldMap.apoType || !fieldMap.date || !fieldMap.estimateStatus) {
        content.innerHTML = `
          <div class="apr-err">
            必須フィールドの特定に失敗しました。<br>
            ・AP担当者<br>
            ・アポ種別<br>
            ・日付（期間指定に必要）<br>
            ・見積ステータス（アポキャン判定用）<br><br>
            対応方法：ranking_pt_dashboard.js の CONFIG.APO_FIELD_OVERRIDES にフィールド識別名（uniqueId）を設定してください。
          </div>
        `;
        setHint("設定が必要です");
        return;
      }

      const wanted = [fieldMap.salesperson, fieldMap.apoType, fieldMap.date, fieldMap.estimateStatus].filter(Boolean);
      const fieldsCsv = wanted.join(",");

      setHint("レコード取得中...（件数により時間がかかります）");
      records = await fetchAllRecords(appId, fieldsCsv);

      setHint(`取得完了: ${records.length.toLocaleString("ja-JP")}件 / 目標データ取得中...`);
      goalMonthMap = null;
      try {
        const goalAppId = await getAppIdByName(CONFIG.GOAL_APP_NAME);
        const goalFields = await getFields(goalAppId);
        const go = CONFIG.GOAL_FIELD_OVERRIDES || {};
        const goalFieldMap = {
          salesperson: go.salesperson || pickFieldUniqueId(goalFields, CONFIG.GOAL_FIELD_KEYWORDS.salesperson),
          date: go.date || pickFieldUniqueId(goalFields, CONFIG.GOAL_FIELD_KEYWORDS.date),
          ptTarget: go.ptTarget || pickFieldUniqueId(goalFields, CONFIG.GOAL_FIELD_KEYWORDS.ptTarget),
          apoTarget: go.apoTarget || pickFieldUniqueId(goalFields, CONFIG.GOAL_FIELD_KEYWORDS.apoTarget),
          plannedWorkDays: go.plannedWorkDays || pickFieldUniqueId(goalFields, CONFIG.GOAL_FIELD_KEYWORDS.plannedWorkDays),
        };
        if (goalFieldMap.salesperson && goalFieldMap.date && goalFieldMap.apoTarget) {
          const goalWanted = [goalFieldMap.salesperson, goalFieldMap.date, goalFieldMap.apoTarget, goalFieldMap.plannedWorkDays].filter(Boolean).join(",");
          const goalRecords = await fetchAllRecords(goalAppId, goalWanted);
          goalMonthMap = buildGoalMonthMap(goalRecords, goalFieldMap);
        }
      } catch (e) { goalMonthMap = null; }

      // 稼働終了報告（稼働日数用）の取得
      workFieldMap = null;
      workRecords = null;
      try {
        const workAppId = await getAppIdByName(CONFIG.WORK_APP_NAME);
        const workFields = await getFields(workAppId);
        const wo = CONFIG.WORK_FIELD_OVERRIDES || {};
        const wf = {
          salesperson: wo.salesperson || pickFieldUniqueId(workFields, CONFIG.WORK_FIELD_KEYWORDS.salesperson),
          date: wo.date || pickFieldUniqueId(workFields, CONFIG.WORK_FIELD_KEYWORDS.date),
        };
        if (wf.salesperson && wf.date) {
          const workWanted = [wf.salesperson, wf.date].join(",");
          workRecords = await fetchAllRecords(workAppId, workWanted);
          workFieldMap = wf;
        }
      } catch (e) {
        workFieldMap = null;
        workRecords = null;
      }

      setHint(`取得完了 / 期間候補生成中...`);

      const now = new Date();
      const mm = scanMinMaxDate(records, fieldMap.date);
      let minDate = mm.min || now;
      let maxDate = mm.max || now;
      // 目標が入ったら月選択に当月以降も表示
      if (goalMonthMap && goalMonthMap.size) {
        const goalMaxKey = getMaxMonthFromGoalMap(goalMonthMap, true);
        if (goalMaxKey) {
          const [gy, gm] = goalMaxKey.split("-").map(Number);
          const goalMaxDate = new Date(gy, gm - 1, 1);
          const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          const effectiveMax = new Date(Math.max(goalMaxDate.getTime(), currentMonthStart.getTime()));
          if (effectiveMax.getTime() > maxDate.getTime()) maxDate = effectiveMax;
        }
      }

      monthOptions = buildMonthOptions(minDate, maxDate);
      quarterOptions = buildQuarterOptions(minDate, maxDate);
      weekOptions = buildWeekOptions(minDate, maxDate);

      monthSelect.innerHTML = "";
      for (const mo of monthOptions) monthSelect.appendChild(makeOption(mo.key, mo.label));

      quarterSelect.innerHTML = "";
      for (const qo of quarterOptions) quarterSelect.appendChild(makeOption(qo.key, qo.label));

      weekSelect.innerHTML = "";
      for (const wo of weekOptions) weekSelect.appendChild(makeOption(wo.key, wo.label));

      rangeStartSelect.innerHTML = "";
      rangeEndSelect.innerHTML = "";
      for (const mo of monthOptions) {
        rangeStartSelect.appendChild(makeOption(mo.key, mo.label));
        rangeEndSelect.appendChild(makeOption(mo.key, mo.label));
      }

      if (monthOptions.length) {
        monthSelect.value = monthOptions[0].key; // latest
        rangeEndSelect.value = monthOptions[0].key; // latest
        rangeStartSelect.value = monthOptions[monthOptions.length - 1].key; // oldest
      }
      if (quarterOptions.length) quarterSelect.value = quarterOptions[0].key; // latest quarter
      if (weekOptions.length) weekSelect.value = weekOptions[0].key; // latest week

      setHint("集計準備完了");
      viewMode = readViewModeDefault();
      renderModeTabs();
      renderViewTabs();
      renderSelectors();
      computeAndRender();
    }

    function showError(e) {
      console.error(e);
      content.innerHTML = `<div class="apr-err">エラーが発生しました。権限/アプリ名/ネットワーク/カスタマイズ設定をご確認ください。</div>`;
      setHint("エラー");
    }

    // Events
    search.addEventListener("input", () => computeAndRender());
    refreshBtn.addEventListener("click", () => loadAndInit().catch(showError));
    toggleBtn.addEventListener("click", () => {
      const isVisible = body.style.display !== "none";
      setBodyVisible(!isVisible);
    });

    modeSelect.addEventListener("change", () => setMode(modeSelect.value));
    viewSelect.addEventListener("change", () => applyViewSelection(viewSelect.value));
    monthSelect.addEventListener("change", () => computeAndRender());
    quarterSelect.addEventListener("change", () => computeAndRender());
    weekSelect.addEventListener("change", () => computeAndRender());
    rangeStartSelect.addEventListener("change", () => computeAndRender());
    rangeEndSelect.addEventListener("change", () => computeAndRender());

    loadAndInit().catch(showError);
  }

async function boot() {
    ensureStyleOnce();

    // page gating（売上ランキング）
    const currentPageId = getCurrentPageIdSafe();
    if (String(CONFIG.SALES_PAGE_ID || '').trim() !== '') {
      if (currentPageId !== String(CONFIG.SALES_PAGE_ID).trim()) return;
    }

    const top = atPocket.portal.getContentTopSpaceElement();
    if (!top) return;
    if (document.getElementById(CONFIG.WIDGET_ID)) return;

    // Root
    const root = el("div", { id: CONFIG.WIDGET_ID, class: "apr-wrap" });
    const card = el("div", { class: "apr-card" });

    // Header
    const head = el("div", { class: "apr-head" });
    head.appendChild(el("div", null,
      `<div class="apr-title">CLランキング</div><div class="apr-meta">データ元: ${CONFIG.APP_NAME}</div>`
    ));
    const actions = el("div", { class: "apr-actions" });
    const refreshBtn = el("button", { class: "apr-btn", type: "button" }, "再読み込み");
    const toggleBtn = el("button", { class: "apr-btn", type: "button" }, "非表示");
    actions.appendChild(refreshBtn);
    actions.appendChild(toggleBtn);
    head.appendChild(actions);

    // Body containers
    const body = el("div", { class: "apr-body" });
    const controlsRow = el("div", { class: "apr-sales-controls" });
    const modeRow = el("div", { class: "apr-sales-control" });
    const modeSelect = el("select", { class: "apr-select" });
    modeRow.appendChild(el("div", { class: "apr-hint" }, "期間"));
    modeRow.appendChild(modeSelect);
    const viewRow = el("div", { class: "apr-sales-control" });
    const viewSelect = el("select", { class: "apr-select" });
    viewRow.appendChild(el("div", { class: "apr-hint" }, "表示"));
    viewRow.appendChild(viewSelect);
    const taxRow = el("div", { class: "apr-sales-control" });
    const taxSelect = el("select", { class: "apr-select" });
    const selectorRow = el("div", { class: "apr-sales-control apr-sales-target" });
    const searchRow = el("div", { class: "apr-row apr-search-row" });
    const periodHintRow = el("div", { class: "apr-row apr-period-hint-row" });
    const search = el("input", { class: "apr-search", type: "search", placeholder: "担当者名で検索" });
    const hint = el("div", { class: "apr-hint" }, "読み込み中...");
    const content = el("div", null, `<div class="apr-muted">読み込み中...</div>`);

    controlsRow.appendChild(modeRow);
    controlsRow.appendChild(viewRow);
    controlsRow.appendChild(taxRow);
    controlsRow.appendChild(selectorRow);
    body.appendChild(controlsRow);
    body.appendChild(searchRow);
    body.appendChild(periodHintRow);
    body.appendChild(content);
    searchRow.appendChild(search);
    periodHintRow.appendChild(hint);

    card.appendChild(head);
    card.appendChild(body);
    root.appendChild(card);

    const s = ensureSwitcher(top);
    if (s && s.panels) s.panels.appendChild(root);
    applySwitcherViewIfPresent();

    // 初期表示/非表示（前回状態を保持）
    setBodyVisible(readBodyVisibleDefault());

    // State
    let mode = "month"; // month | quarter | range | week | cumulative
    let viewMode = "table"; // table | chart
    let chartMetric = "pt"; // pt | count | avg | sales
    let salesTaxMode = "exclude"; // exclude=税抜, include=税込
    let fieldMap = null;
    let records = null;
    let goalMonthMap = null;
    let contractCountMap = null;
    let contractLinkageForTarget = null;
    let apoRecords = null;
    let apoFieldMap = null;
    const computed = new Map();
    let monthOptions = [];
    let fiscalYearOptions = [];
    let quarterOptions = [];
    let weekOptions = [];

    // Selectors
    const monthSelect = el("select", { class: "apr-select" });
    const fiscalYearSelect = el("select", { class: "apr-select" });
    const quarterSelect = el("select", { class: "apr-select" });
    const weekSelect = el("select", { class: "apr-select" });
    const rangeStartSelect = el("select", { class: "apr-select" });
    const rangeEndSelect = el("select", { class: "apr-select" });

    function setHint(text) { hint.textContent = text; }

    function getViewKey() {
      return `apRankingViewMode:SALES:${CONFIG.APP_NAME}`;
    }
    function readViewModeDefault() {
      try {
        const v = localStorage.getItem(getViewKey());
        if (v === "chart" || v === "table") return v;
      } catch (e) {}
      return "table";
    }
    function setViewMode(v) {
      viewMode = v;
      try { localStorage.setItem(getViewKey(), v); } catch (e) {}
      computeAndRender();
    }

    function getMetricKey() {
      return `apRankingChartMetric:SALES:${CONFIG.APP_NAME}`;
    }
    function readMetricDefault() {
      try {
        const v = localStorage.getItem(getMetricKey());
        if (v === "pt" || v === "count" || v === "avg" || v === "sales") return v;
      } catch (e) {}
      return "pt";
    }
    function setMetric(v) {
      chartMetric = v;
      viewMode = "chart";
      try { localStorage.setItem(getMetricKey(), v); } catch (e) {}
      try { localStorage.setItem(getViewKey(), "chart"); } catch (e) {}
      computeAndRender();
    }
    // viewSelect change: decode combined key "table" or "chart:<metric>"
    function applyViewSelection(val) {
      if (val === "table") {
        setViewMode("table");
      } else if (val.startsWith("chart:")) {
        setMetric(val.slice(6));
      }
    }
    function setMode(nextMode) {
      const validModes = new Set(["month", "week", "quarter", "fiscal", "range", "cumulative"]);
      if (!validModes.has(nextMode) || nextMode === mode) return;
      mode = nextMode;
      modeSelect.value = mode;
      renderSelectors();
      computeAndRender();
    }

    function getTaxModeKey() {
      return `apRankingSalesTaxMode:SALES:${CONFIG.APP_NAME}`;
    }
    function readTaxModeDefault() {
      try {
        const v = localStorage.getItem(getTaxModeKey());
        if (v === "exclude" || v === "include") return v;
      } catch (e) {}
      return "exclude";
    }
    function setTaxMode(v) {
      salesTaxMode = v;
      try { localStorage.setItem(getTaxModeKey(), v); } catch (e) {}
      taxSelect.value = v;
      renderViewTabs();
      computeAndRender();
    }
    function renderTaxRow() {
      taxRow.innerHTML = "";
      taxRow.style.display = (fieldMap && fieldMap.sales) ? "" : "none";
      if (!fieldMap || !fieldMap.sales) return;
      taxRow.appendChild(el("div", { class: "apr-hint" }, "売上表示"));
      taxSelect.innerHTML = "";
      const opts = [
        { value: "exclude", label: "税抜" },
        { value: "include", label: "税込" },
      ];
      for (const t of opts) {
        const o = document.createElement("option");
        o.value = t.value;
        o.textContent = t.label;
        if (t.value === salesTaxMode) o.selected = true;
        taxSelect.appendChild(o);
      }
      taxRow.appendChild(taxSelect);
    }

    function getVisibilityKey() {
      return `${CONFIG.VISIBILITY_STORAGE_KEY}:${CONFIG.APP_NAME}`;
    }

    function setBodyVisible(visible) {
      body.style.display = visible ? "" : "none";
      toggleBtn.textContent = visible ? "非表示" : "表示";
      try { localStorage.setItem(getVisibilityKey(), visible ? "1" : "0"); } catch (e) {}
    }

    function readBodyVisibleDefault() {
      try {
        const v = localStorage.getItem(getVisibilityKey());
        if (v === "0") return false;
      } catch (e) {}
      return true;
    }

    function makeOption(value, label) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      return o;
    }

    function renderModeTabs() {
      modeSelect.innerHTML = "";
      const modes = [
        { key: "month", label: "各月" },
        { key: "week", label: "週（月〜日）" },
        { key: "quarter", label: "四半期（3月起算・2月締め）" },
        { key: "fiscal", label: "期毎（年度）" },
        { key: "range", label: "期間指定累計" },
        { key: "cumulative", label: "累計" },
      ];
      for (const m of modes) {
        const o = document.createElement("option");
        o.value = m.key;
        o.textContent = m.label;
        if (m.key === mode) o.selected = true;
        modeSelect.appendChild(o);
      }
    }

    function renderViewTabs() {
      viewSelect.innerHTML = "";

      if (!fieldMap) {
        const opts = [
          { value: "table", label: "表" },
          { value: "chart:" + chartMetric, label: "ランキング" },
        ];
        const curVal = viewMode === "table" ? "table" : "chart:" + chartMetric;
        for (const o of opts) {
          const opt = document.createElement("option");
          opt.value = o.value;
          opt.textContent = o.label;
          if (o.value === curVal) opt.selected = true;
          viewSelect.appendChild(opt);
        }
        return;
      }

      const hasPT = !!fieldMap.pt;
      const hasSales = !!fieldMap.sales;

      const taxLabel = salesTaxMode === "include" ? "税込" : "税抜";
      const opts = [
        { value: "table", label: "表" },
        ...(hasPT ? [{ value: "chart:pt", label: "PTランキング" }] : []),
        { value: "chart:count", label: "件数ランキング" },
        ...(hasSales ? [{ value: "chart:avg", label: `平均売上単価〔${taxLabel}〕ランキング` }] : []),
        ...(hasSales ? [{ value: "chart:sales", label: `売上〔${taxLabel}〕ランキング` }] : []),
      ];

      const curVal = viewMode === "table" ? "table" : "chart:" + chartMetric;
      for (const o of opts) {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === curVal) opt.selected = true;
        viewSelect.appendChild(opt);
      }
    }

    function renderSelectors() {
      selectorRow.innerHTML = "";

      if (mode === "month") {
        selectorRow.appendChild(el("div", { class: "apr-hint" }, "対象月"));
        selectorRow.appendChild(monthSelect);
      } else if (mode === "quarter") {
        selectorRow.appendChild(el("div", { class: "apr-hint" }, "対象四半期"));
        selectorRow.appendChild(quarterSelect);
      } else if (mode === "fiscal") {
        selectorRow.appendChild(el("div", { class: "apr-hint" }, "対象期（年度）"));
        selectorRow.appendChild(fiscalYearSelect);
      } else if (mode === "week") {
        selectorRow.appendChild(el("div", { class: "apr-hint" }, "対象週"));
        selectorRow.appendChild(weekSelect);
      } else if (mode === "range") {
        selectorRow.appendChild(el("div", { class: "apr-hint" }, "開始月"));
        selectorRow.appendChild(rangeStartSelect);
        selectorRow.appendChild(el("div", { class: "apr-hint" }, "終了月"));
        selectorRow.appendChild(rangeEndSelect);
      } else {
        selectorRow.appendChild(el("div", { class: "apr-hint" }, "全期間"));
      }
    }

    function getCurrentPeriod() {
      if (mode === "month") return buildPeriodFromMonthKey(monthOptions, monthSelect.value);
      if (mode === "quarter") return buildPeriodFromQuarterKey(quarterOptions, quarterSelect.value);
      if (mode === "fiscal") return buildPeriodFromFiscalYearKey(fiscalYearOptions, fiscalYearSelect.value);
      if (mode === "week") return buildPeriodFromWeekKey(weekOptions, weekSelect.value);
      if (mode === "range") return buildPeriodFromRange(monthOptions, rangeStartSelect.value, rangeEndSelect.value);
      return { key: "cumulative", label: "累計", start: null, end: null, hint: "全期間" };
    }

    function computeAndRender() {
      if (!records || !fieldMap) return;

      const period = getCurrentPeriod();
      if (!period) {
        content.innerHTML = `<div class="apr-err">期間指定が不正です（開始月 ≤ 終了月 を選択してください）。</div>`;
        setHint("期間指定が不正");
        return;
      }

      const cacheKey = `${mode}:${period.key}`;
      let res = computed.get(cacheKey);
      if (!res) {
        res = aggregate(records, fieldMap, period);
        computed.set(cacheKey, res);
      }
      const goalSums = sumGoalsInPeriod(goalMonthMap, period, monthOptions);
      const contractSums = sumContractCountInPeriod(contractCountMap, period, monthOptions);
      for (const it of res.items) {
        const g = goalSums.get(it.name);
        it.goal = g ? g.ptTarget : 0;
        it.achv = (it.goal > 0 && (it.pt || 0) >= 0) ? ((it.pt || 0) / it.goal) * 100 : 0;
        it.count = contractSums.get(it.name) || 0;
      }
      // CLデータ分析と同じ算出方法で商談実施数を付与
      const meetingFieldMap = {
        salesperson: (apoFieldMap && apoFieldMap.clPerson) ? apoFieldMap.clPerson : "",
        date: apoFieldMap ? (apoFieldMap.meetingDate || apoFieldMap.date) : "",
        estimateStatus: apoFieldMap ? apoFieldMap.estimateStatus : "",
        meetingPlace: apoFieldMap ? apoFieldMap.meetingPlace : "",
      };
      const meetingSums = sumMeetingCountByPerson(apoRecords, meetingFieldMap, period, CONFIG.CL_MEETING_STATUSES);
      for (const it of res.items) {
        it.meetingCount = meetingSums.get(it.name) || 0;
      }
      const hiddenSalesNames = new Set(["トラーチ倶楽部", "卸案件"].map((n) => normalizePersonName(n)));
      const visibleItems = (res.items || []).filter((it) => !hiddenSalesNames.has(normalizePersonName(it.name)));
      const displayRes = { ...res, items: visibleItems };

      // hint (range shows only labels; also show exact range if available)
      if (period.start && period.end) {
        setHint(`期間: ${period.hint}（${fmtYMD(period.start)} ～ ${fmtYMD(new Date(period.end.getTime() - 1))}）`);
      } else {
        setHint(`期間: ${period.hint}`);
      }

      let tableOpts = {};
      if (mode === "month" && period && period.start && period.end) {
        tableOpts = { clPacemaker: getClPacemakerWeekContextForPeriod(period.start, period.end, new Date(), 4) };
      } else if (mode === "week" && period && period.start && period.end) {
        tableOpts = { clPacemaker: getClPacemakerWeekContextForPeriod(period.start, period.end, new Date(), 1) };
      } else if (mode === "quarter" && period && period.start && period.end) {
        tableOpts = { clPacemaker: getClPacemakerWeekContextForPeriod(period.start, period.end, new Date(), 12) };
      } else if (mode === "fiscal" && period && period.start && period.end) {
        tableOpts = { clPacemaker: getClPacemakerWeekContextForPeriod(period.start, period.end, new Date(), 48) };
      } else if (mode === "range" && period && period.start && period.end) {
        const months = getMonthKeysInPeriod(period, monthOptions);
        const monthCount = Array.isArray(months) ? months.length : 0;
        const weeksInPeriod = monthCount * 4;
        if (weeksInPeriod > 0) {
          tableOpts = { clPacemaker: getClPacemakerWeekContextForPeriod(period.start, period.end, new Date(), weeksInPeriod) };
        }
      } else if (mode === "cumulative") {
        const months = Array.isArray(monthOptions) ? monthOptions.length : 0;
        const totalWeeks = months * 4;
        tableOpts = { clPacemaker: { weeksInMonth: totalWeeks, weeksElapsed: totalWeeks, asOf: null } };
      }
      tableOpts.showMeeting = true;

      if (viewMode === "chart") {
        renderSalesChart(content, displayRes, fieldMap, search.value || "", chartMetric, salesTaxMode, records, period, contractLinkageForTarget);
      } else {
        const breakdownRows = buildSalesTargetBreakdownRows(records, fieldMap, period, search.value || "", salesTaxMode, contractLinkageForTarget).rows;
        tableOpts.targetBreakdownByName = new Map(breakdownRows.map((x) => [x.name, x]));
        renderTable(content, displayRes, fieldMap, search.value || "", salesTaxMode, { ...tableOpts, rankBordered: true });
      }
    }

    async function loadAndInit() {
      computed.clear();
      content.innerHTML = `<div class="apr-muted">データ取得中...</div>`;
      setHint("アプリ情報取得中...");

      const appId = await getAppIdByName(CONFIG.APP_NAME);

      setHint("フィールド取得中...");
      const fields = await getFields(appId);

      const o = CONFIG.FIELD_OVERRIDES || {};
      const salespersonId = o.salesperson || pickFieldUniqueId(fields, CONFIG.FIELD_KEYWORDS.salesperson);
      const ptId = o.pt || pickFieldUniqueId(fields, CONFIG.FIELD_KEYWORDS.pt);
      const salesId = o.sales || pickFieldUniqueId(fields, CONFIG.FIELD_KEYWORDS.sales);
      const dateId = o.date || pickFieldUniqueId(fields, CONFIG.FIELD_KEYWORDS.date);
      const customerNameId = o.customerName || pickFieldUniqueId(fields, CONFIG.FIELD_KEYWORDS.customerName);
      const introductionRouteId = o.introductionRoute || pickFieldUniqueId(fields, CONFIG.FIELD_KEYWORDS.introductionRoute);
      const regNoId = o.regNo || pickFieldUniqueId(fields, CONFIG.FIELD_KEYWORDS.regNo);

      fieldMap = { salesperson: salespersonId, pt: ptId, sales: salesId, date: dateId, customerName: customerNameId, introductionRoute: introductionRouteId, regNo: regNoId };

      if (!fieldMap.salesperson || !fieldMap.date) {
        content.innerHTML = `
          <div class="apr-err">
            必須フィールドの特定に失敗しました。<br>
            ・担当者（営業担当）<br>
            ・日付（計上日/契約日 等）<br><br>
            対応方法：ranking_pt_dashboard.js の CONFIG.FIELD_OVERRIDES にフィールド識別名（uniqueId）を設定してください。
          </div>
        `;
        setHint("設定が必要です");
        return;
      }

      const wanted = [fieldMap.salesperson, fieldMap.date].filter(Boolean);
      if (fieldMap.pt) wanted.push(fieldMap.pt);
      if (fieldMap.sales) wanted.push(fieldMap.sales);
      if (fieldMap.customerName) wanted.push(fieldMap.customerName);
      if (fieldMap.introductionRoute) wanted.push(fieldMap.introductionRoute);
      if (fieldMap.regNo) wanted.push(fieldMap.regNo);
      const fieldsCsv = wanted.join(",");

      setHint("レコード取得中...（件数により時間がかかります）");
      records = await fetchAllRecords(appId, fieldsCsv);

      setHint(`取得完了: ${records.length.toLocaleString("ja-JP")}件 / 目標データ取得中...`);
      goalMonthMap = null;
      try {
        const goalAppId = await getAppIdByName(CONFIG.GOAL_APP_NAME);
        const goalFields = await getFields(goalAppId);
        const go = CONFIG.GOAL_FIELD_OVERRIDES || {};
        const goalFieldMap = {
          salesperson: go.salesperson || pickFieldUniqueId(goalFields, CONFIG.GOAL_FIELD_KEYWORDS.salesperson),
          date: go.date || pickFieldUniqueId(goalFields, CONFIG.GOAL_FIELD_KEYWORDS.date),
          ptTarget: go.ptTarget || pickFieldUniqueId(goalFields, CONFIG.GOAL_FIELD_KEYWORDS.ptTarget),
          apoTarget: go.apoTarget || pickFieldUniqueId(goalFields, CONFIG.GOAL_FIELD_KEYWORDS.apoTarget),
        };
        if (goalFieldMap.salesperson && goalFieldMap.date && goalFieldMap.ptTarget) {
          const goalWanted = [goalFieldMap.salesperson, goalFieldMap.date, goalFieldMap.ptTarget].filter(Boolean).join(",");
          const goalRecords = await fetchAllRecords(goalAppId, goalWanted);
          goalMonthMap = buildGoalMonthMap(goalRecords, goalFieldMap);
        }
      } catch (e) { goalMonthMap = null; }

      setHint("契約件数データ取得中...");
      contractCountMap = null;
      contractLinkageForTarget = null;
      try {
        const contractAppId = await getAppIdByName(CONFIG.CONTRACT_FORM_APP_NAME);
        const contractFields = await getFields(contractAppId);
        const to = CONFIG.CONTRACT_FORM_FIELD_OVERRIDES || {};
        const ckw = CONFIG.CONTRACT_FORM_FIELD_KEYWORDS || {};
        const contractDateId = to.date || pickFieldUniqueId(contractFields, ckw.date);
        const contractClPersonId = to.clPerson != null && to.clPerson !== "" ? to.clPerson : pickFieldUniqueId(contractFields, ckw.clPerson);
        const contractApPersonId = pickContractApPersonFieldId(contractFields);
        const contractCustomerStatusId = to.customerStatus != null && to.customerStatus !== ""
          ? to.customerStatus
          : pickFieldUniqueId(contractFields, ckw.customerStatus);
        const contractSalesId = to.sales || pickFieldUniqueId(contractFields, ckw.sales);
        const contractIntroductionRouteId = to.introductionRoute != null && to.introductionRoute !== ""
          ? to.introductionRoute
          : pickFieldUniqueId(contractFields, ckw.introductionRoute);
        const regIds = pickContractRegNoFieldIds(contractFields);
        const contractCustNameId = pickContractCustomerNameFieldId(contractFields);
        if (contractDateId && (contractClPersonId || contractApPersonId || regIds.apptRegNo || regIds.clptRegNo)) {
          const contractWanted = [...new Set([
            contractDateId,
            contractClPersonId,
            contractApPersonId,
            contractCustomerStatusId,
            contractSalesId,
            contractIntroductionRouteId,
            regIds.apptRegNo,
            regIds.clptRegNo,
            contractCustNameId,
          ].filter(Boolean))].join(",");
          const contractRecords = await fetchAllRecords(contractAppId, contractWanted);
          if (contractClPersonId) {
            contractCountMap = buildContractCountMap(contractRecords, contractDateId, contractClPersonId, contractCustomerStatusId);
          }
          const idx = buildContractFormRegNoIndex(contractRecords, regIds.apptRegNo, regIds.clptRegNo);
          contractLinkageForTarget = {
            byAppt: idx.byAppt,
            byClpt: idx.byClpt,
            fm: {
              date: contractDateId,
              sales: contractSalesId,
              introductionRoute: contractIntroductionRouteId,
              clPerson: contractClPersonId,
              apPerson: contractApPersonId,
              customerName: contractCustNameId,
              apptRegNo: regIds.apptRegNo,
              clptRegNo: regIds.clptRegNo,
            },
          };
        }
      } catch (e) { contractCountMap = null; contractLinkageForTarget = null; }

      setHint("商談実施数データ取得中...");
      apoRecords = null;
      apoFieldMap = null;
      try {
        const apoAppId = await getAppIdByName(CONFIG.APO_APP_NAME);
        const apoFields = await getFields(apoAppId);
        const apoOver = CONFIG.APO_FIELD_OVERRIDES || {};
        const apoKw = CONFIG.APO_FIELD_KEYWORDS || {};
        const apoDateId = apoOver.date || pickFieldUniqueIdByExactCaption(apoFields, "初回商談実施日");
        const meetingDateId = pickApoFirstMeetingDateFieldId(apoFields, apoOver) || apoDateId;
        apoFieldMap = {
          clPerson: apoOver.clPerson || pickFieldUniqueId(apoFields, apoKw.clPerson),
          date: apoDateId,
          meetingDate: meetingDateId,
          estimateStatus: apoOver.estimateStatus != null && apoOver.estimateStatus !== ""
            ? apoOver.estimateStatus
            : pickFieldUniqueId(apoFields, apoKw.estimateStatus),
          meetingPlace: apoOver.meetingPlace || pickFieldUniqueId(apoFields, apoKw.meetingPlace),
        };
        if (apoFieldMap.clPerson && apoFieldMap.date) {
          const apoWanted = [...new Set([
            apoFieldMap.clPerson, apoFieldMap.date, apoFieldMap.meetingDate,
            apoFieldMap.estimateStatus, apoFieldMap.meetingPlace,
          ].filter(Boolean))].join(",");
          apoRecords = await fetchAllRecords(apoAppId, apoWanted);
        }
      } catch (e) { apoRecords = null; apoFieldMap = null; }

      setHint(`取得完了 / 期間候補生成中...`);

      const now = new Date();
      const mm = scanMinMaxDate(records, fieldMap.date);
      const minDate = mm.min || now;
      const maxDate = mm.max || now;

      monthOptions = buildMonthOptions(minDate, maxDate);
      quarterOptions = buildQuarterOptions(minDate, maxDate);
      fiscalYearOptions = buildFiscalYearOptions(minDate, maxDate);

      // Populate selects (newest-first)
      monthSelect.innerHTML = "";
      for (const mo of monthOptions) monthSelect.appendChild(makeOption(mo.key, mo.label));

      fiscalYearSelect.innerHTML = "";
      for (const fy of fiscalYearOptions) fiscalYearSelect.appendChild(makeOption(fy.key, fy.label));

      quarterSelect.innerHTML = "";
      for (const qo of quarterOptions) quarterSelect.appendChild(makeOption(qo.key, qo.label));

      weekOptions = buildWeekOptions(minDate, maxDate);
      weekSelect.innerHTML = "";
      for (const wo of weekOptions) weekSelect.appendChild(makeOption(wo.key, wo.label));

      rangeStartSelect.innerHTML = "";
      rangeEndSelect.innerHTML = "";
      for (const mo of monthOptions) {
        rangeStartSelect.appendChild(makeOption(mo.key, mo.label));
        rangeEndSelect.appendChild(makeOption(mo.key, mo.label));
      }

      // Defaults（各月・期間指定の終了月は当月を優先）
      if (monthOptions.length) {
        const defaultMonthKey = pickDefaultMonthKeyFromOptions(monthOptions);
        monthSelect.value = defaultMonthKey;
        rangeEndSelect.value = defaultMonthKey;
        rangeStartSelect.value = monthOptions[monthOptions.length - 1].key; // oldest
      }
      if (fiscalYearOptions.length) fiscalYearSelect.value = fiscalYearOptions[0].key; // latest fiscal year
      if (quarterOptions.length) quarterSelect.value = quarterOptions[0].key; // latest quarter
      if (weekOptions.length) weekSelect.value = weekOptions[0].key; // latest week

      setHint("集計準備完了");
      viewMode = readViewModeDefault();
      chartMetric = readMetricDefault();
      salesTaxMode = readTaxModeDefault();
      renderModeTabs();
      renderViewTabs();
      renderTaxRow();
      renderSelectors();
      computeAndRender();
    }

    function showError(e) {
      console.error(e);
      content.innerHTML = `<div class="apr-err">エラーが発生しました。権限/アプリ名/ネットワーク/カスタマイズ設定をご確認ください。</div>`;
      setHint("エラー");
    }

    // Events
    search.addEventListener("input", () => computeAndRender());
    refreshBtn.addEventListener("click", () => loadAndInit().catch(showError));
    toggleBtn.addEventListener("click", () => {
      const isVisible = body.style.display !== "none";
      setBodyVisible(!isVisible);
    });
    modeSelect.addEventListener("change", () => setMode(modeSelect.value));
    viewSelect.addEventListener("change", () => applyViewSelection(viewSelect.value));
    taxSelect.addEventListener("change", () => setTaxMode(taxSelect.value));
    monthSelect.addEventListener("change", () => computeAndRender());
    fiscalYearSelect.addEventListener("change", () => computeAndRender());
    quarterSelect.addEventListener("change", () => computeAndRender());
    weekSelect.addEventListener("change", () => computeAndRender());
    rangeStartSelect.addEventListener("change", () => computeAndRender());
    rangeEndSelect.addEventListener("change", () => computeAndRender());

    loadAndInit().catch(showError);
  }

  async function bootSalesAnalysis() {
    ensureStyleOnce();

    const top = atPocket.portal.getContentTopSpaceElement();
    if (!top) return;

    const WIDGET_ID = SWITCHER.SALES_ANALYSIS_ROOT_ID();
    if (document.getElementById(WIDGET_ID)) return;

    const root = el("div", { id: WIDGET_ID, class: "apr-wrap" });
    const card = el("div", { class: "apr-card" });

    const head = el("div", { class: "apr-head" });
    head.appendChild(el("div", null,
      `<div class="apr-title">データ分析</div><div class="apr-meta">営業・契約データの集計分析（データ元: ${CONFIG.APP_NAME}）</div>`
    ));
    const actions = el("div", { class: "apr-actions" });
    const refreshBtn = el("button", { class: "apr-btn", type: "button" }, "再読み込み");
    const pdfBtn = el("button", { class: "apr-btn", type: "button" }, "PDF出力");
    const toggleBtn = el("button", { class: "apr-btn", type: "button" }, "非表示");
    actions.appendChild(refreshBtn);
    actions.appendChild(pdfBtn);
    actions.appendChild(toggleBtn);
    head.appendChild(actions);

    const body = el("div", { class: "apr-body" });
    const taxRow = el("div", { class: "apr-row apr-tax-row" });
    const analysisTabsRow = el("div", { class: "apr-tabs" });
    const selectorRow = el("div", { class: "apr-row" });
    const searchRow = el("div", { class: "apr-row apr-search-row" });
    const periodHintRow = el("div", { class: "apr-row apr-period-hint-row" });
    const search = el("input", { class: "apr-search", type: "search", placeholder: "担当者名で検索" });
    const hint = el("div", { class: "apr-hint" }, "読み込み中...");
    const content = el("div", null, `<div class="apr-muted">読み込み中...</div>`);

    body.appendChild(taxRow);
    body.appendChild(analysisTabsRow);
    body.appendChild(selectorRow);
    body.appendChild(searchRow);
    body.appendChild(periodHintRow);
    body.appendChild(content);
    searchRow.appendChild(search);
    periodHintRow.appendChild(hint);

    card.appendChild(head);
    card.appendChild(body);
    root.appendChild(card);

    const s = ensureSwitcher(top);
    if (s && s.panels) s.panels.appendChild(root);
    applySwitcherViewIfPresent();

    function getVisibilityKey() {
      return `apRankingVisible:SALES_ANALYSIS`;
    }
    function setBodyVisible(visible) {
      body.style.display = visible ? "" : "none";
      toggleBtn.textContent = visible ? "非表示" : "表示";
      try { localStorage.setItem(getVisibilityKey(), visible ? "1" : "0"); } catch (e) {}
    }
    function readBodyVisibleDefault() {
      try {
        const v = localStorage.getItem(getVisibilityKey());
        if (v === "0") return false;
      } catch (e) {}
      return true;
    }
    setBodyVisible(readBodyVisibleDefault());

    function setHint(text) { hint.textContent = text; }

    let fieldMap = null;
    let records = null;
    let goalMonthMap = null;
    let contractCountMap = null;
    let contractLinkageForTarget = null;
    let overallIntroRecords = null;
    let overallIntroFieldMap = null;
    let apoRecords = null;
    let apoFieldMap = null;
    let workRecords = null;
    let workFieldMap = null;
    let monthOptions = [];
    let salesTaxMode = "exclude";
    let analysisPage = "branch"; // branch | overall | cl | ap | personal
    const monthSelect = el("select", { class: "apr-select" });
    const personalSelect = el("select", { class: "apr-select" });
    const personalRangeSelect = el("select", { class: "apr-select" });
    let selectedPersonalName = "";
    let personalRangeMode = "6m"; // this | prev | 1y | 6m | 3m

    function getAnalysisPageKey() {
      return `apSalesAnalysisPage:SALES_ANALYSIS`;
    }
    function readAnalysisPageDefault() {
      try {
        const v = localStorage.getItem(getAnalysisPageKey());
        if (v === "branch" || v === "overall" || v === "personal") return v;
      } catch (e) {}
      return "branch";
    }
    function setAnalysisPage(v) {
      analysisPage = (v === "overall" || v === "personal") ? v : "branch";
      try { localStorage.setItem(getAnalysisPageKey(), analysisPage); } catch (e) {}
      renderAnalysisTabs();
      renderSelectors();
      render();
    }
    function renderAnalysisTabs() {
      analysisTabsRow.innerHTML = "";
      const tabs = [
        { key: "branch", label: "支社別集計" },
        { key: "overall", label: "全体データ分析" },
        { key: "personal", label: "個人別分析" },
      ];
      for (const t of tabs) {
        analysisTabsRow.appendChild(el("button", {
          class: "apr-tab",
          type: "button",
          "aria-selected": String(analysisPage === t.key),
          onclick: () => setAnalysisPage(t.key),
        }, t.label));
      }
    }

    function renderSelectors() {
      selectorRow.innerHTML = "";
      selectorRow.style.justifyContent = analysisPage === "personal" ? "flex-start" : "";
      const monthLabel = el("label", { class: "apr-label" }, "対象月: ");
      monthLabel.appendChild(monthSelect);
      selectorRow.appendChild(monthLabel);

      if (analysisPage === "personal") {
        const rangeLabel = el("label", { class: "apr-label" }, "集計期間: ");
        rangeLabel.appendChild(personalRangeSelect);
        selectorRow.appendChild(rangeLabel);
        const personLabel = el("label", { class: "apr-label" }, "営業担当: ");
        personLabel.appendChild(personalSelect);
        selectorRow.appendChild(personLabel);
      }
    }

    function getPersonalRangeKey() {
      return `apSalesAnalysisPersonalRange:SALES_ANALYSIS`;
    }
    function readPersonalRangeDefault() {
      try {
        const v = localStorage.getItem(getPersonalRangeKey());
        if (v === "this" || v === "prev" || v === "1y" || v === "6m" || v === "3m") return v;
      } catch (e) {}
      return "6m";
    }
    function writePersonalRange(v) {
      personalRangeMode = (v === "this" || v === "prev" || v === "1y" || v === "6m" || v === "3m") ? v : "6m";
      try { localStorage.setItem(getPersonalRangeKey(), personalRangeMode); } catch (e) {}
    }
    function getPersonalTargetMonthKey(baseMonthKey) {
      if (!monthOptions || !monthOptions.length) return baseMonthKey;
      const idx = monthOptions.findIndex((m) => m.key === baseMonthKey);
      if (idx < 0) return baseMonthKey;
      if (personalRangeMode === "this") return baseMonthKey;
      if (personalRangeMode === "prev") {
        const prev = monthOptions[idx + 1];
        return prev ? prev.key : baseMonthKey;
      }
      return baseMonthKey;
    }
    function getPersonalRangeMonthCount() {
      if (personalRangeMode === "this" || personalRangeMode === "prev") return 1;
      if (personalRangeMode === "1y") return 12;
      if (personalRangeMode === "3m") return 3;
      return 6;
    }
    function getPersonalRangeLabel() {
      if (personalRangeMode === "this") return "当月";
      if (personalRangeMode === "prev") return "前月";
      if (personalRangeMode === "1y") return "直近1年";
      if (personalRangeMode === "3m") return "直近3ヶ月";
      return "直近6ヶ月";
    }
    function buildPersonalTrailingPeriod(baseMonthKey) {
      if (!monthOptions || !monthOptions.length) return null;
      const targetMonthKey = getPersonalTargetMonthKey(baseMonthKey);
      const baseIdx = Math.max(0, monthOptions.findIndex((m) => m.key === targetMonthKey));
      const count = getPersonalRangeMonthCount();
      const selected = monthOptions.slice(baseIdx, baseIdx + count);
      if (!selected.length) return null;
      const newest = selected[0];
      const oldest = selected[selected.length - 1];
      return {
        key: `personal:${personalRangeMode}:${newest.key}`,
        label: getPersonalRangeLabel(),
        start: oldest.start,
        end: newest.end,
        hint: `${oldest.label} ～ ${newest.label}`,
      };
    }

    function updatePersonalSelector(items, query) {
      const q = String(query || "").trim().toLowerCase();
      const hiddenPersonalNames = new Set(["トラーチ倶楽部", "トレンディ", "卸案件"].map((n) => normalizePersonName(n)));
      const names = Array.from(new Set(
        (items || [])
          .map((it) => String(it.name || "").trim())
          .filter((name) => name && !hiddenPersonalNames.has(normalizePersonName(name)) && (!q || name.toLowerCase().includes(q)))
      )).sort((a, b) => a.localeCompare(b, "ja"));
      let next = selectedPersonalName;
      if (!next || !names.includes(next)) next = names[0] || "";

      personalSelect.innerHTML = "";
      for (const name of names) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        if (name === next) opt.selected = true;
        personalSelect.appendChild(opt);
      }
      selectedPersonalName = next;
    }

    function buildRecentPtRows(name, selectedMonthKey, monthCount) {
      if (!name || !monthOptions || !monthOptions.length) return [];
      const baseIdx = Math.max(0, monthOptions.findIndex((m) => m.key === selectedMonthKey));
      const targetMonths = monthOptions.slice(baseIdx, baseIdx + Math.max(1, monthCount || 6));
      if (!targetMonths.length) return [];

      const ptByMonth = new Map(targetMonths.map((m) => [m.key, 0]));
      for (const r of records || []) {
        const recObj = r && r.record ? r.record : {};
        const recName = normalizePersonName(extractValue(recObj[fieldMap.salesperson]));
        if (!recName || recName !== name) continue;
        const d = parseDate(recObj[fieldMap.date]);
        if (!d) continue;
        for (const mo of targetMonths) {
          if (inRange(d, { start: mo.start, end: mo.end })) {
            const cur = ptByMonth.get(mo.key) || 0;
            ptByMonth.set(mo.key, cur + parseNumber(extractValue(recObj[fieldMap.pt])));
            break;
          }
        }
      }
      return targetMonths
        .slice()
        .reverse()
        .map((mo) => ({ key: mo.key, label: mo.label, pt: ptByMonth.get(mo.key) || 0 }));
    }

    function buildRecentApoRows(name, selectedMonthKey, monthCount) {
      if (!name || !monthOptions || !monthOptions.length || !apoRecords || !apoFieldMap) return [];
      const baseIdx = Math.max(0, monthOptions.findIndex((m) => m.key === selectedMonthKey));
      const targetMonths = monthOptions.slice(baseIdx, baseIdx + Math.max(1, monthCount || 6));
      if (!targetMonths.length) return [];
      const targetTypes = Array.isArray(CONFIG.PERSONAL_APO_BAR_FILTER_VALUES)
        ? CONFIG.PERSONAL_APO_BAR_FILTER_VALUES
        : [];

      const apoByMonth = new Map(targetMonths.map((m) => [m.key, 0]));
      for (const r of apoRecords || []) {
        const recObj = r && r.record ? r.record : {};
        const recName = normalizePersonName(extractValue(recObj[apoFieldMap.salesperson]));
        if (!recName || recName !== name) continue;
        const apoTypeVal = String(extractValue(recObj[apoFieldMap.apoType]) || "").trim();
        if (!apoTypeVal) continue;
        if (!isApoTypeMatched(apoTypeVal, targetTypes)) continue;
        const d = parseDate(recObj[apoFieldMap.date]);
        if (!d) continue;
        for (const mo of targetMonths) {
          if (inRange(d, { start: mo.start, end: mo.end })) {
            apoByMonth.set(mo.key, (apoByMonth.get(mo.key) || 0) + 1);
            break;
          }
        }
      }
      return targetMonths
        .slice()
        .reverse()
        .map((mo) => ({ key: mo.key, label: mo.label, apoCount: apoByMonth.get(mo.key) || 0 }));
    }

    function renderPersonalAnalysisPage(period, item, apoAllCountMap, apoTypeBreakdownMap, ptIntroBreakdownMap, introCountBreakdownMap, meetingTypeBreakdownMap, meetingStatusBreakdownMap, meetingStatusDetailMapByPerson, overallApoTypeRows, personalApoRankByTypeMap, cumulativeWorkStatsMap, cumulativeApoMetricsMap) {
      if (!item) {
        content.innerHTML = `<div class="apr-empty">対象月にデータがある営業担当が見つかりません。</div>`;
        return;
      }
      const monthKey = monthSelect.value || (monthOptions[0] && monthOptions[0].key) || "";
      const targetMonthKey = getPersonalTargetMonthKey(monthKey);
      const monthCount = getPersonalRangeMonthCount();
      const rows = buildRecentPtRows(item.name, targetMonthKey, monthCount);
      const apoRows = buildRecentApoRows(item.name, targetMonthKey, monthCount);
      const maxVal = rows.reduce((m, x) => Math.max(m, x.pt || 0), 0);
      const maxApoVal = apoRows.reduce((m, x) => Math.max(m, x.apoCount || 0), 0);
      const rangeText = period && period.hint ? period.hint : "";
      const apoCountAll = apoAllCountMap && apoAllCountMap.has(item.name) ? (apoAllCountMap.get(item.name) || 0) : 0;
      const apoTypeMap = apoTypeBreakdownMap && apoTypeBreakdownMap.has(item.name) ? apoTypeBreakdownMap.get(item.name) : new Map();
      const apoTypeRows = Array.from(apoTypeMap.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => (b.count - a.count) || a.type.localeCompare(b.type, "ja"));
      const meetingTypeMap = meetingTypeBreakdownMap && meetingTypeBreakdownMap.has(item.name) ? meetingTypeBreakdownMap.get(item.name) : new Map();
      const meetingTypeRows = Array.from(meetingTypeMap.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => (b.count - a.count) || a.type.localeCompare(b.type, "ja"));
      const ptIntroMap = ptIntroBreakdownMap && ptIntroBreakdownMap.has(item.name) ? ptIntroBreakdownMap.get(item.name) : new Map();
      const ptIntroRows = Array.from(ptIntroMap.entries())
        .map(([type, count]) => ({ type, count }))
        .filter((x) => String(x.type || "").trim() !== "(未設定)")
        .sort((a, b) => (b.count - a.count) || a.type.localeCompare(b.type, "ja"));
      const contractIntroMap = introCountBreakdownMap && introCountBreakdownMap.has(item.name) ? introCountBreakdownMap.get(item.name) : new Map();
      const ptAverageRows = ptIntroRows.map((row) => {
        const contractCount = contractIntroMap.get(row.type) || 0;
        const avgPt = contractCount > 0 ? (row.count || 0) / contractCount : 0;
        return { type: row.type, ptTotal: row.count || 0, contractCount, avgPt };
      });
      const ptAverageRowsSorted = ptAverageRows
        .slice()
        .sort((a, b) => (b.avgPt - a.avgPt) || (b.contractCount - a.contractCount) || a.type.localeCompare(b.type, "ja"));
      const ptAverageMax = ptAverageRowsSorted.reduce((m, x) => Math.max(m, x.avgPt || 0), 0);
      const meetingStatusMap = meetingStatusBreakdownMap && meetingStatusBreakdownMap.has(item.name) ? meetingStatusBreakdownMap.get(item.name) : new Map();
      const meetingStatusRows = Array.from(meetingStatusMap.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => (b.count - a.count) || a.type.localeCompare(b.type, "ja"));
      const meetingStatusDetailByGroup = meetingStatusDetailMapByPerson && meetingStatusDetailMapByPerson.has(item.name)
        ? meetingStatusDetailMapByPerson.get(item.name)
        : new Map();
      const meetingExecutionCount = meetingTypeRows.reduce((s, x) => s + (x.count || 0), 0);
      let meetingContractCount = 0;
      let meetingDenyCount = 0;
      for (const detailMap of meetingStatusDetailByGroup.values()) {
        for (const [rawStatus, countVal] of (detailMap || new Map()).entries()) {
          const cnt = countVal || 0;
          if (matchesApoContractEstimateStatus(rawStatus)) meetingContractCount += cnt;
          if (matchesApoDenyEstimateStatus(rawStatus)) meetingDenyCount += cnt;
        }
      }
      const meetingContractRate = meetingExecutionCount > 0 ? (meetingContractCount / meetingExecutionCount) : 0;
      const meetingDenyRate = meetingExecutionCount > 0 ? (meetingDenyCount / meetingExecutionCount) : 0;
      const guideContractDefault = 1;
      const targetTypes = Array.isArray(CONFIG.PERSONAL_APO_BAR_FILTER_VALUES) ? CONFIG.PERSONAL_APO_BAR_FILTER_VALUES : [];
      const personRankByType = personalApoRankByTypeMap && personalApoRankByTypeMap.has(item.name)
        ? personalApoRankByTypeMap.get(item.name)
        : new Map();
      function buildPieSection(rowsForPie, totalLabelText, unitLabel, opts) {
        const getFixedPieColor = buildApoTypeColorResolver(rowsForPie || []);
        const unit = String(unitLabel || "件");
        const noWrapTypeLabel = !!(opts && opts.noWrapTypeLabel);
        const noWrapLegend = !!(opts && opts.noWrapLegend);
        const total = rowsForPie.reduce((s, x) => s + (x.count || 0), 0);
        let cumulativePct = 0;
        const segmentRanges = [];
        const stops = rowsForPie.map((x) => {
          const ratio = total > 0 ? (x.count || 0) / total : 0;
          const start = cumulativePct;
          cumulativePct += ratio * 100;
          const end = cumulativePct;
          segmentRanges.push({ type: String(x.type || ""), start, end, count: x.count || 0 });
          return `${getFixedPieColor(x.type)} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
        });
        const background = stops.length
          ? `conic-gradient(${stops.join(", ")})`
          : "conic-gradient(#e2e8f0 0% 100%)";
        const legendRowsInner = rowsForPie.length
          ? rowsForPie.map((x) => {
            const rate = total > 0 ? ((x.count || 0) / total) * 100 : 0;
            const labelStyle = noWrapTypeLabel
              ? "white-space:nowrap; overflow:visible; text-overflow:clip;"
              : "white-space:normal; overflow:visible; text-overflow:clip; word-break:break-word; overflow-wrap:anywhere; line-height:1.35;";
            return `
              <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; padding:6px 0; border-bottom:1px dashed #e5e7eb; ${noWrapLegend ? "min-width:max-content;" : ""}">
                <div style="display:flex; align-items:flex-start; gap:8px; min-width:0; flex:1 1 auto;">
                  <span style="display:inline-block; width:10px; height:10px; border-radius:2px; background:${getFixedPieColor(x.type)}; flex-shrink:0; margin-top:3px;"></span>
                  <span style="font-size:12px; color:#0f172a; ${labelStyle}">${String(x.type || "").replace(/</g, "&lt;")}</span>
                </div>
                <div style="font-size:12px; color:#334155; white-space:nowrap; flex-shrink:0; text-align:right;">${numFmt(x.count || 0)}${unit} (${rate.toFixed(1)}%)</div>
              </div>
            `;
          }).join("")
          : `<div class="apr-empty" style="padding:10px 0;">該当データがありません。</div>`;
        const legendRows = noWrapLegend
          ? `<div>${legendRowsInner}</div>`
          : legendRowsInner;
        return { total, background, legendRows, totalLabelText, segmentRanges };
      }
      const personalPie = buildPieSection(apoTypeRows, "アポ合計");
      const personalMeetingPie = buildPieSection(meetingTypeRows, "商談実施合計");
      const personalPtPie = buildPieSection(ptIntroRows, "PT合計", "pt", {});
      const personalMeetingStatusPie = buildPieSection(meetingStatusRows, "商談結果合計");
      const detailRows = targetTypes.flatMap((typeName) => {
        const hit = personRankByType.get(typeName) || { total: 0, rankMap: new Map() };
        const rankRows = Array.from((hit.rankMap || new Map()).entries())
          .map(([rank, count]) => ({ rank, count }))
          .sort((a, b) => (b.count - a.count) || String(a.rank).localeCompare(String(b.rank), "ja"));
        if (!rankRows.length) return [];
        return rankRows.map((r) => ({ type: typeName, rank: r.rank, count: r.count || 0 }));
      });
      const rankAggMap = new Map();
      for (const r of detailRows) {
        const rk = String(r.rank || "(未設定)");
        rankAggMap.set(rk, (rankAggMap.get(rk) || 0) + (r.count || 0));
      }
      const rankRowsAll = Array.from(rankAggMap.entries())
        .map(([rank, count]) => ({ rank, count }))
        .sort((a, b) => (b.count - a.count) || String(a.rank).localeCompare(String(b.rank), "ja"));
      const rankTotal = rankRowsAll.reduce((s, x) => s + (x.count || 0), 0);
      let rankCum = 0;
      const rankStops = rankRowsAll.map((x, idx) => {
        const ratio = rankTotal > 0 ? (x.count || 0) / rankTotal : 0;
        const start = rankCum;
        rankCum += ratio * 100;
        const end = rankCum;
        return `${getApoRankPieSliceColor(x.rank, idx)} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
      });
      const rankPieBackground = rankStops.length
        ? `conic-gradient(${rankStops.join(", ")})`
        : "conic-gradient(#e2e8f0 0% 100%)";
      const rankLegendRows = rankRowsAll.length
        ? rankRowsAll.map((x, idx) => {
          const rate = rankTotal > 0 ? ((x.count || 0) / rankTotal) * 100 : 0;
          return `
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; padding:6px 0; border-bottom:1px dashed #e5e7eb;">
              <div style="display:flex; align-items:flex-start; gap:8px; min-width:0; flex:1 1 auto;">
                <span style="display:inline-block; width:10px; height:10px; border-radius:2px; background:${getApoRankPieSliceColor(x.rank, idx)}; flex-shrink:0; margin-top:3px;"></span>
                <span style="font-size:12px; color:#0f172a; white-space:normal; overflow:visible; word-break:break-word; overflow-wrap:anywhere; line-height:1.35;">${String(x.rank || "").replace(/</g, "&lt;")}</span>
              </div>
              <div style="font-size:12px; color:#334155; white-space:nowrap; flex-shrink:0;">${numFmt(x.count || 0)}件 (${rate.toFixed(1)}%)</div>
            </div>
          `;
        }).join("")
        : ``;
      const workStat = cumulativeWorkStatsMap && cumulativeWorkStatsMap.has(item.name)
        ? cumulativeWorkStatsMap.get(item.name)
        : { pingpongCount: 0, interviewCount: 0, apoGetCount: 0 };
      const cumulativeApoStat = cumulativeApoMetricsMap && cumulativeApoMetricsMap.has(item.name)
        ? cumulativeApoMetricsMap.get(item.name)
        : { meetingCount: 0, contractCount: 0, cancelCount: 0, count: 0 };
      const pingpongCount = workStat.pingpongCount || 0;
      const interviewCount = workStat.interviewCount || 0;
      const apoGetCount = workStat.apoGetCount || 0;
      const interviewRate = pingpongCount > 0 ? (interviewCount / pingpongCount) : 0; // 面談率
      const apoGetRate = interviewCount > 0 ? (apoGetCount / interviewCount) : 0; // アポ取得率
      const guideApoDefault = 1;
      const topScale = Math.max(maxVal, maxApoVal, 1);
      const mergedChartRows = rows.map((x, idx) => {
        const apoVal = (apoRows[idx] && apoRows[idx].apoCount) ? apoRows[idx].apoCount : 0;
        const ptH = Math.max(8, Math.round(((x.pt || 0) / topScale) * 180));
        const apoH = Math.max(8, Math.round((apoVal / topScale) * 180));
        return `
        <div style="min-width:108px; flex:1 1 108px; max-width:140px; display:flex; flex-direction:column; align-items:center; gap:6px;">
            <div style="font-size:11px; color:#334155; font-weight:700;">PT ${numFmt(x.pt || 0)} / アポ ${numFmt(apoVal)}</div>
            <div style="height:180px; width:100%; display:flex; align-items:flex-end; justify-content:center; gap:8px;">
              <div title="PT: ${numFmt(x.pt || 0)}" style="width:36px; height:${ptH}px; border-radius:8px 8px 4px 4px; background:linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%); box-shadow:0 4px 10px rgba(29,78,216,0.25);"></div>
              <div title="アポ: ${numFmt(apoVal)}" style="width:36px; height:${apoH}px; border-radius:8px 8px 4px 4px; background:linear-gradient(180deg, #10b981 0%, #047857 100%); box-shadow:0 4px 10px rgba(4,120,87,0.25);"></div>
            </div>
            <div style="font-size:12px; color:#0f172a; font-weight:700; text-align:center;">${x.label}</div>
          </div>
        `;
      }).join("");
      content.innerHTML = `
        <div class="apr-chart apr-rankviz">
          <div class="apr-chart-head">${item.name}｜${getPersonalRangeLabel()} 月別PT / アポ件数</div>
          <div class="apr-chart-sub">${rangeText ? `基準月: ${rangeText}` : "対象月を基準に過去6ヶ月を表示"}</div>
          <div style="margin-top:8px; border:1px solid #dbeafe; border-radius:12px; background:#f8fbff; padding:10px 12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; color:#64748b; margin-bottom:6px;">
              <span>最大 ${numFmt(Math.max(maxVal, maxApoVal))}</span>
              <span><span style="display:inline-block; width:10px; height:10px; border-radius:2px; background:#2563eb; margin-right:4px;"></span>PT <span style="display:inline-block; width:10px; height:10px; border-radius:2px; background:#059669; margin:0 4px 0 10px;"></span>アポ件数</span>
            </div>
            <div class="apr-personal-month-chart-bars" style="display:flex; align-items:flex-end; flex-wrap:wrap; gap:10px; justify-content:flex-start; padding-bottom:4px; border-top:1px dashed #cbd5e1;">
              ${mergedChartRows || `<div class="apr-empty" style="padding:10px 0;">表示できるデータがありません。</div>`}
            </div>
          </div>
          <div style="margin-top:12px; border:1px solid #e5e7eb; border-radius:12px; padding:10px 12px;">
            <div class="apr-personal-three-col" style="display:grid; gap:12px; grid-template-columns: repeat(3, minmax(260px, 1fr)); align-items:start;">
              <div class="apr-personal-pie-item apr-col-apo" style="padding:0;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                  <div style="font-size:12px; color:#64748b;">個人アポ累計（導入経緯別）</div>
                  <div class="apr-chart-sub" style="margin:0;">個人合計: ${numFmt(apoCountAll)}</div>
                </div>
                <div class="apr-personal-pie-content" style="display:grid; gap:12px; grid-template-columns: minmax(220px, 320px) minmax(0, 1fr); align-items:start;">
                  <div style="display:flex; justify-content:center;">
                    <div style="position:relative; width:100%; max-width:340px; height:240px;">
                      <div style="width:180px; height:180px; border-radius:50%; background:${personalPie.background}; border:1px solid #d5deea; position:absolute; left:50%; top:50%; transform:translate(-50%, -50%); box-shadow:0 10px 22px rgba(15,23,42,0.14), inset 0 2px 8px rgba(255,255,255,0.45);">
                        <div style="position:absolute; inset:34px; border-radius:50%; background:linear-gradient(180deg, #ffffff, #f8fafc); border:1px solid #d7e0ec; box-shadow: inset 0 1px 3px rgba(148,163,184,0.25), 0 2px 8px rgba(15,23,42,0.08); display:flex; align-items:center; justify-content:center; text-align:center; font-size:12px; color:#334155; font-weight:700;">
                          ${personalPie.totalLabelText}<br>${numFmt(personalPie.total)}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div>${personalPie.legendRows}</div>
                </div>
                <div class="apr-meeting-status-section" style="margin-top:10px; border-top:1px dashed #e5e7eb; padding-top:10px;">
                  <div style="font-size:12px; color:#64748b; margin-bottom:6px;">個人アポ件数詳細（アポランク比率）</div>
                  <div class="apr-personal-pie-content" style="display:grid; gap:12px; grid-template-columns: minmax(220px, 320px) minmax(0, 1fr); align-items:start;">
                    <div style="display:flex; justify-content:center;">
                      <div style="position:relative; width:100%; max-width:340px; height:240px;">
                        <div style="width:180px; height:180px; border-radius:50%; background:${rankPieBackground}; border:1px solid #d5deea; position:absolute; left:50%; top:50%; transform:translate(-50%, -50%); box-shadow:0 10px 22px rgba(15,23,42,0.14), inset 0 2px 8px rgba(255,255,255,0.45);">
                          <div style="position:absolute; inset:34px; border-radius:50%; background:linear-gradient(180deg, #ffffff, #f8fafc); border:1px solid #d7e0ec; box-shadow: inset 0 1px 3px rgba(148,163,184,0.25), 0 2px 8px rgba(15,23,42,0.08); display:flex; align-items:center; justify-content:center; text-align:center; font-size:12px; color:#334155; font-weight:700;">
                            アポ合計<br>${numFmt(rankTotal)}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div>${rankLegendRows}</div>
                  </div>
                </div>
                <div class="apr-personal-work-card" data-apo-data-card style="margin-top:10px; padding:0;">
                  <div data-apo-data-head style="display:flex; justify-content:space-between; align-items:center; margin:0 0 8px;">
                    <div class="apr-chart-head" style="margin:0; font-size:14px;">アポデータ（累計）</div>
                    <div class="apr-chart-sub" style="margin:0;">対象データ数: ${numFmt(workStat.workDays || 0)}</div>
                  </div>
                  <div class="apr-personal-work-metrics" style="display:grid; gap:8px; grid-template-columns: repeat(3, minmax(0, 1fr));">
                    <div class="apr-kpi-tile" style="padding:8px 10px; border:1px solid #dbeafe; border-radius:10px; background:#f8fbff;">
                      <div class="apr-kpi-label">ピンポン数</div>
                      <strong class="apr-kpi-value">${numFmt(pingpongCount)}</strong>
                    </div>
                    <div class="apr-kpi-tile" style="padding:8px 10px; border:1px solid #dcfce7; border-radius:10px; background:#f7fff9;">
                      <div class="apr-kpi-label">面談数</div>
                      <strong class="apr-kpi-value">${numFmt(interviewCount)}</strong>
                    </div>
                    <div class="apr-kpi-tile" style="padding:8px 10px; border:1px solid #fef3c7; border-radius:10px; background:#fffdf5;">
                      <div class="apr-kpi-label">アポ獲得数</div>
                      <strong class="apr-kpi-value">${numFmt(apoGetCount)}</strong>
                    </div>
                    <div style="grid-column:1 / -1; border:1px solid #dbeafe; border-radius:10px; background:#f8fbff; padding:10px;">
                      <div style="font-weight:800; font-size:13px; color:#1e3a8a; margin-bottom:8px;">1件アポ取得までの道</div>
                      <div style="display:grid; gap:8px;">
                        <div class="apr-personal-guide-rates" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; font-size:12px;">
                          <span style="color:#475569;">面談率</span>
                          <strong style="color:#0f172a;">${pingpongCount > 0 ? (interviewRate * 100).toFixed(1) : "0.0"}%</strong>
                          <span style="color:#94a3b8;">/</span>
                          <span style="color:#475569;">アポ取得率</span>
                          <strong style="color:#0f172a;">${interviewCount > 0 ? (apoGetRate * 100).toFixed(1) : "0.0"}%</strong>
                        </div>
                        <div class="apr-personal-guide-results" style="display:grid; gap:6px; grid-template-columns: repeat(3, minmax(0, 1fr));">
                          <div class="apr-kpi-guide-tile" style="padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px; background:#fff;">
                            <div class="apr-kpi-sub-label">必要ピンポン数</div>
                            <div class="apr-kpi-value"><span data-guide-pingpong>${numFmt(0)}</span></div>
                          </div>
                          <div class="apr-kpi-guide-tile" style="padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px; background:#fff;">
                            <div class="apr-kpi-sub-label">必要面談数</div>
                            <div class="apr-kpi-value"><span data-guide-interview>${numFmt(0)}</span></div>
                          </div>
                          <div class="apr-kpi-guide-tile" style="padding:8px 10px; border:1px solid #93c5fd; border-radius:8px; background:#fff;">
                            <div class="apr-kpi-sub-label">アポ取得数</div>
                            <div style="display:flex; align-items:center; gap:6px; margin-top:2px;">
                              <input data-guide-apo-input type="number" min="0" step="1" value="${numFmt(guideApoDefault)}"
                                style="width:90px; padding:4px 8px; border:1px solid #93c5fd; border-radius:7px; font-size:13px; font-weight:700;">
                              <span class="apr-muted" style="font-size:11px;">変更可</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="apr-personal-pie-item apr-col-meeting" style="padding:0;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                  <div style="font-size:12px; color:#64748b;">商談実施数（導入経緯別）</div>
                  <div class="apr-chart-sub" style="margin:0;">商談実施合計: ${numFmt(personalMeetingPie.total)}</div>
                </div>
                <div class="apr-personal-pie-content" style="display:grid; gap:12px; grid-template-columns: minmax(220px, 320px) minmax(0, 1fr); align-items:start;">
                  <div style="display:flex; justify-content:center;">
                    <div style="position:relative; width:100%; max-width:340px; height:240px;">
                      <div style="width:180px; height:180px; border-radius:50%; background:${personalMeetingPie.background}; border:1px solid #d5deea; position:absolute; left:50%; top:50%; transform:translate(-50%, -50%); box-shadow:0 10px 22px rgba(15,23,42,0.14), inset 0 2px 8px rgba(255,255,255,0.45);">
                        <div style="position:absolute; inset:34px; border-radius:50%; background:linear-gradient(180deg, #ffffff, #f8fafc); border:1px solid #d7e0ec; box-shadow: inset 0 1px 3px rgba(148,163,184,0.25), 0 2px 8px rgba(15,23,42,0.08); display:flex; align-items:center; justify-content:center; text-align:center; font-size:12px; color:#334155; font-weight:700;">
                          ${personalMeetingPie.totalLabelText}<br>${numFmt(personalMeetingPie.total)}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div>${personalMeetingPie.legendRows}</div>
                </div>
                <div style="margin-top:10px; border-top:1px dashed #e5e7eb; padding-top:10px;">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <div style="font-size:12px; color:#64748b;">初回商談結果（結果比率）</div>
                    <div class="apr-chart-sub" style="margin:0;">商談結果合計: ${numFmt(personalMeetingStatusPie.total)}</div>
                  </div>
                  <div class="apr-personal-pie-content" style="display:grid; gap:12px; grid-template-columns: minmax(220px, 320px) minmax(0, 1fr); align-items:start;">
                    <div style="display:flex; justify-content:center;">
                      <div data-meeting-status-host style="position:relative; width:100%; max-width:340px; height:240px;">
                        <div data-meeting-status-pie style="width:180px; height:180px; border-radius:50%; background:${personalMeetingStatusPie.background}; border:1px solid #d5deea; position:absolute; left:50%; top:50%; transform:translate(-50%, -50%); box-shadow:0 10px 22px rgba(15,23,42,0.14), inset 0 2px 8px rgba(255,255,255,0.45); cursor:pointer; touch-action:manipulation;">
                          <div style="position:absolute; inset:34px; border-radius:50%; background:linear-gradient(180deg, #ffffff, #f8fafc); border:1px solid #d7e0ec; box-shadow: inset 0 1px 3px rgba(148,163,184,0.25), 0 2px 8px rgba(15,23,42,0.08); display:flex; align-items:center; justify-content:center; text-align:center; font-size:12px; color:#334155; font-weight:700;">
                            ${personalMeetingStatusPie.totalLabelText}<br>${numFmt(personalMeetingStatusPie.total)}
                          </div>
                        </div>
                        <div data-meeting-status-tooltip style="display:none; position:absolute; inset:0; z-index:30; pointer-events:none;">
                          <div data-meeting-status-tooltip-body style="position:absolute; inset:0; pointer-events:none;"></div>
                        </div>
                      </div>
                    </div>
                    <div>${personalMeetingStatusPie.legendRows}</div>
                  </div>
                  <div class="apr-meeting-status-help">
                    円グラフをタップで詳細表示
                  </div>
                </div>
                <div class="apr-personal-work-card" data-meeting-data-card style="margin-top:10px; padding:0;">
                  <div data-meeting-data-head style="display:flex; justify-content:space-between; align-items:center; margin:0 0 8px;">
                    <div class="apr-chart-head" style="margin:0; font-size:14px;">商談データ</div>
                    <div class="apr-chart-sub" style="margin:0;">対象データ数: ${numFmt(meetingExecutionCount)}</div>
                  </div>
                  <div class="apr-meeting-work-metrics" style="display:grid; gap:8px; grid-template-columns: repeat(3, minmax(0, 1fr));">
                    <div class="apr-kpi-tile" style="padding:8px 10px; border:1px solid #dbeafe; border-radius:10px; background:#f8fbff;">
                      <div class="apr-kpi-label">商談実施数</div>
                      <strong class="apr-kpi-value">${numFmt(meetingExecutionCount)}</strong>
                    </div>
                    <div class="apr-kpi-tile" style="padding:8px 10px; border:1px solid #dcfce7; border-radius:10px; background:#f7fff9;">
                      <div class="apr-kpi-label">成約数</div>
                      <strong class="apr-kpi-value">${numFmt(meetingContractCount)}</strong>
                    </div>
                    <div class="apr-kpi-tile" style="padding:8px 10px; border:1px solid #fee2e2; border-radius:10px; background:#fff7f7;">
                      <div class="apr-kpi-label">否数</div>
                      <strong class="apr-kpi-value">${numFmt(meetingDenyCount)}</strong>
                    </div>
                    <div style="grid-column:1 / -1; border:1px solid #dbeafe; border-radius:10px; background:#f8fbff; padding:10px;">
                      <div style="font-weight:800; font-size:13px; color:#1e3a8a; margin-bottom:8px;">1契約までの道</div>
                      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; font-size:12px;">
                        <span style="color:#475569;">成約率</span>
                        <strong style="color:#0f172a;">${(meetingContractRate * 100).toFixed(1)}%</strong>
                        <span style="color:#94a3b8;">/</span>
                        <span style="color:#475569;">否率</span>
                        <strong style="color:#0f172a;">${(meetingDenyRate * 100).toFixed(1)}%</strong>
                      </div>
                      <div class="apr-meeting-guide-results" style="display:grid; gap:6px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top:8px;">
                        <div class="apr-kpi-guide-tile" style="padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px; background:#fff;">
                          <div class="apr-kpi-sub-label">必要商談実施数</div>
                          <div class="apr-kpi-value"><span data-guide-required-meeting>${meetingContractRate > 0 ? numFmt(Math.ceil(guideContractDefault / meetingContractRate)) : "-"}</span></div>
                        </div>
                        <div class="apr-kpi-guide-tile" style="padding:8px 10px; border:1px solid #93c5fd; border-radius:8px; background:#fff;">
                          <div class="apr-kpi-sub-label">契約数</div>
                          <div style="display:flex; align-items:center; gap:6px; margin-top:2px;">
                            <input data-guide-contract-input type="number" min="0" step="1" value="${numFmt(guideContractDefault)}"
                              style="width:90px; padding:4px 8px; border:1px solid #93c5fd; border-radius:7px; font-size:13px; font-weight:700;">
                            <span class="apr-muted" style="font-size:11px;">変更可</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="apr-personal-pie-item apr-col-pt" style="padding:0;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                  <div style="font-size:12px; color:#64748b;">PT合計（導入経緯別）</div>
                  <div class="apr-chart-sub" style="margin:0;">PT合計: ${numFmt(personalPtPie.total)}</div>
                </div>
                <div class="apr-personal-pie-content" style="display:grid; gap:12px; grid-template-columns: minmax(220px, 320px) minmax(0, 1fr); align-items:start;">
                  <div style="display:flex; justify-content:center;">
                    <div style="position:relative; width:100%; max-width:340px; height:240px;">
                      <div style="width:180px; height:180px; border-radius:50%; background:${personalPtPie.background}; border:1px solid #d5deea; position:absolute; left:50%; top:50%; transform:translate(-50%, -50%); box-shadow:0 10px 22px rgba(15,23,42,0.14), inset 0 2px 8px rgba(255,255,255,0.45);">
                        <div style="position:absolute; inset:34px; border-radius:50%; background:linear-gradient(180deg, #ffffff, #f8fafc); border:1px solid #d7e0ec; box-shadow: inset 0 1px 3px rgba(148,163,184,0.25), 0 2px 8px rgba(15,23,42,0.08); display:flex; align-items:center; justify-content:center; text-align:center; font-size:12px; color:#334155; font-weight:700;">
                          ${personalPtPie.totalLabelText}<br>${numFmt(personalPtPie.total)}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div>${personalPtPie.legendRows}</div>
                </div>
                <div style="margin-top:10px; border-top:1px dashed #e5e7eb; padding-top:10px;">
                  <div style="font-size:12px; color:#64748b; margin-bottom:6px;">導入経緯別PT平均</div>
                  <div style="display:grid; gap:6px; border:1px solid #e2e8f0; border-radius:10px; background:#ffffff; padding:8px;">
                    ${ptAverageRowsSorted.length
                      ? ptAverageRowsSorted.map((r) => {
                        const barPct = (r.contractCount > 0 && ptAverageMax > 0) ? Math.max(4, Math.round(((r.avgPt || 0) / ptAverageMax) * 100)) : 0;
                        const safeType = String(r.type || "").replace(/</g, "&lt;");
                        const avgText = r.contractCount > 0 ? `${numFmt(Math.round(r.avgPt))}pt` : "-";
                        return `
                        <div style="display:grid; gap:4px; padding:6px 2px; border-bottom:1px dashed #e5e7eb;">
                          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                            <div style="font-size:12px; color:#0f172a; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${safeType}</div>
                            <div style="font-size:12px; color:#334155; white-space:nowrap;">${avgText}</div>
                          </div>
                          <div style="height:8px; border-radius:999px; background:#e2e8f0; overflow:hidden;">
                            <div style="height:100%; width:${barPct}%; border-radius:999px; background:linear-gradient(90deg, #2563eb, #38bdf8);"></div>
                          </div>
                          <div style="font-size:11px; color:#64748b; text-align:right;">成約${numFmt(r.contractCount)}件 / PT合計 ${numFmt(r.ptTotal)}pt</div>
                        </div>
                      `;
                      }).join("")
                      : `<div class="apr-empty" style="padding:8px 0;">該当データがありません。</div>`
                    }
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
      const guideInput = content.querySelector("[data-guide-apo-input]");
      const guideInterviewEl = content.querySelector("[data-guide-interview]");
      const guidePingpongEl = content.querySelector("[data-guide-pingpong]");
      const guideContractInput = content.querySelector("[data-guide-contract-input]");
      const guideRequiredMeetingEl = content.querySelector("[data-guide-required-meeting]");
      const recalcActionGuide = () => {
        if (!guideInput || !guideInterviewEl || !guidePingpongEl) return;
        const apoTarget = Math.max(0, parseNumber(guideInput.value));
        // 必要面談数: 面談数 / アポ獲得数（入力アポ取得数分に換算）
        const interviewPerApo = apoGetCount > 0 ? (interviewCount / apoGetCount) : 0;
        const interviewTarget = Math.ceil(interviewPerApo * apoTarget);
        // 必要ピンポン数: ピンポン数 / 面談数 * 必要面談数
        const pingpongPerInterview = interviewCount > 0 ? (pingpongCount / interviewCount) : 0;
        const pingpongTarget = Math.ceil(pingpongPerInterview * interviewTarget);
        guideInterviewEl.textContent = numFmt(interviewTarget);
        guidePingpongEl.textContent = numFmt(pingpongTarget);
      };
      const recalcMeetingGuide = () => {
        if (!guideContractInput || !guideRequiredMeetingEl) return;
        const contractTarget = Math.max(0, parseNumber(guideContractInput.value));
        if (meetingContractRate > 0) {
          const requiredMeetings = Math.ceil(contractTarget / meetingContractRate);
          guideRequiredMeetingEl.textContent = numFmt(requiredMeetings);
        } else {
          guideRequiredMeetingEl.textContent = "-";
        }
      };
      if (guideInput) {
        guideInput.addEventListener("input", recalcActionGuide);
        guideInput.addEventListener("change", recalcActionGuide);
      }
      if (guideContractInput) {
        guideContractInput.addEventListener("input", recalcMeetingGuide);
        guideContractInput.addEventListener("change", recalcMeetingGuide);
      }
      recalcActionGuide();
      recalcMeetingGuide();
      requestAnimationFrame(() => {
        const apoDataCardEl = content.querySelector("[data-apo-data-card]");
        const meetingDataCardEl = content.querySelector("[data-meeting-data-card]");
        if (!apoDataCardEl || !meetingDataCardEl) return;
        if (window.innerWidth <= 640) {
          meetingDataCardEl.style.minHeight = "";
          meetingDataCardEl.style.height = "";
          meetingDataCardEl.style.marginTop = "10px";
          return;
        }
        const sameHeight = `${Math.ceil(apoDataCardEl.getBoundingClientRect().height)}px`;
        meetingDataCardEl.style.minHeight = sameHeight;
        meetingDataCardEl.style.height = sameHeight;
        meetingDataCardEl.style.marginTop = "12px";
      });

      const meetingStatusHostEl = content.querySelector("[data-meeting-status-host]");
      const meetingStatusPieEl = content.querySelector("[data-meeting-status-pie]");
      const meetingStatusTooltipEl = content.querySelector("[data-meeting-status-tooltip]");
      const meetingStatusTooltipBodyEl = content.querySelector("[data-meeting-status-tooltip-body]");
      const segmentRanges = personalMeetingStatusPie.segmentRanges || [];
      const totalMeetingStatus = personalMeetingStatusPie.total || 0;
      if (meetingStatusHostEl && meetingStatusPieEl && meetingStatusTooltipEl && meetingStatusTooltipBodyEl) {
        const closeMeetingStatusTooltip = () => {
          meetingStatusTooltipEl.style.display = "none";
        };
        content.addEventListener("click", (ev) => {
          const target = ev.target;
          if (target instanceof Element && meetingStatusPieEl.contains(target)) return;
          closeMeetingStatusTooltip();
        });
        meetingStatusPieEl.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const pieRect = meetingStatusPieEl.getBoundingClientRect();
          meetingStatusTooltipEl.style.display = "block";
          meetingStatusTooltipBodyEl.innerHTML = "";
          const hostRect = meetingStatusHostEl.getBoundingClientRect();
          const cx = (pieRect.left - hostRect.left) + (pieRect.width / 2);
          const cy = (pieRect.top - hostRect.top) + (pieRect.height / 2);
          const outerR = pieRect.width / 2;
          const tappedX = ev.clientX - pieRect.left;
          const tappedY = ev.clientY - pieRect.top;
          const tappedDx = tappedX - (pieRect.width / 2);
          const tappedDy = tappedY - (pieRect.height / 2);
          const tappedRadius = Math.sqrt((tappedDx * tappedDx) + (tappedDy * tappedDy));
          if (tappedRadius > outerR) return;

          const sliceRows = (segmentRanges || [])
            .filter((seg) => (seg && (seg.count || 0) > 0))
            .map((seg) => {
              const groupType = String(seg.type || "");
              const groupCount = seg.count || 0;
              const midPct = ((seg.start || 0) + (seg.end || 0)) / 2;
              const deg = (midPct / 100) * 360;
              const rad = (deg - 90) * Math.PI / 180;
              const detailMap = meetingStatusDetailByGroup.get(groupType) || new Map();
              const detailRows = Array.from(detailMap.entries())
                .map(([k, v]) => ({ status: k, count: v || 0 }))
                .sort((a, b) => (b.count - a.count) || a.status.localeCompare(b.status, "ja"));
              return { groupType, groupCount, rate: totalMeetingStatus > 0 ? (groupCount / totalMeetingStatus) * 100 : 0, rad, detailRows };
            });

          if (!sliceRows.length) {
            meetingStatusTooltipBodyEl.innerHTML = `<div style="position:absolute; left:50%; top:50%; transform:translate(-50%, -50%); font-size:12px; color:#64748b; background:#ffffff; border:1px solid #dbe4ef; border-radius:10px; padding:8px 10px; box-shadow:0 8px 20px rgba(15,23,42,0.16);">内訳データがありません。</div>`;
            meetingStatusTooltipEl.style.display = "block";
            return;
          }

          const rightItems = [];
          const leftItems = [];
          for (const it of sliceRows) {
            const dirX = Math.cos(it.rad) >= 0 ? 1 : -1;
            const anchorR = outerR - 10;
            const ax = cx + Math.cos(it.rad) * anchorR;
            const ay = cy + Math.sin(it.rad) * anchorR;
            const item = { ...it, dirX, ax, ay };
            if (dirX > 0) rightItems.push(item);
            else leftItems.push(item);
          }
          rightItems.sort((a, b) => a.ay - b.ay);
          leftItems.sort((a, b) => a.ay - b.ay);

          const assignTop = (arr) => {
            let prevTop = -999;
            const gap = 10;
            for (const it of arr) {
              const base = it.ay - 46;
              const top = Math.max(8, Math.min(hostRect.height - 96, Math.max(base, prevTop + gap)));
              it.panelTop = top;
              prevTop = top + 82;
            }
          };
          assignTop(rightItems);
          assignTop(leftItems);

          const calloutHtml = [];
          for (const it of [...rightItems, ...leftItems]) {
            const isSmall = hostRect.width <= 420;
            const panelWidth = isSmall ? 130 : 162;
            const lineLen = isSmall ? 18 : 28;
            const panelLeft = it.dirX > 0
              ? Math.min(hostRect.width - panelWidth - 6, it.ax + lineLen + 6)
              : Math.max(6, it.ax - lineLen - panelWidth - 6);
            const detailHtml = it.detailRows.length
              ? it.detailRows.map((r) => `<div style="display:flex; justify-content:space-between; gap:8px; padding:3px 0; border-top:1px dashed #e2e8f0;"><span style="color:#334155;">${String(r.status || "").replace(/</g, "&lt;")}</span><strong style="white-space:nowrap;">${numFmt(r.count)}件</strong></div>`).join("")
              : `<div style="padding-top:3px; color:#94a3b8;">内訳データなし</div>`;
            calloutHtml.push(`
              <div style="position:absolute; inset:0;">
                <div style="position:absolute; left:${panelLeft.toFixed(1)}px; top:${it.panelTop.toFixed(1)}px; width:${panelWidth}px; max-height:132px; overflow:auto; background:rgba(248, 250, 252, 0.72); border:none; border-radius:10px; box-shadow:0 4px 10px rgba(15,23,42,0.08); padding:7px 8px; pointer-events:auto;">
                  <div style="font-size:11px; font-weight:700; color:#0f172a;">${it.groupType.replace(/</g, "&lt;")}：${numFmt(it.groupCount)}件（${it.rate.toFixed(1)}%）</div>
                  <div style="margin-top:4px; font-size:10px;">${detailHtml}</div>
                </div>
              </div>
            `);
          }
          meetingStatusTooltipBodyEl.innerHTML = calloutHtml.join("");
        });
      }
    }

    function getTaxModeKey() {
      return `apRankingSalesTaxMode:SALES_ANALYSIS`;
    }
    function readTaxModeDefault() {
      try {
        const v = localStorage.getItem(getTaxModeKey());
        if (v === "exclude" || v === "include") return v;
      } catch (e) {}
      return "exclude";
    }
    function setTaxMode(v) {
      salesTaxMode = v;
      try { localStorage.setItem(getTaxModeKey(), v); } catch (e) {}
      renderTaxRow();
      render();
    }
    function renderTaxRow() {
      taxRow.innerHTML = "";
      taxRow.style.display = (fieldMap && fieldMap.sales) ? "" : "none";
      if (!fieldMap || !fieldMap.sales) return;
      taxRow.appendChild(el("div", { class: "apr-hint" }, "売上表示:"));
      const btnExclude = el("button", {
        class: "apr-tab apr-mode-tab",
        type: "button",
        "aria-selected": String(salesTaxMode === "exclude"),
        onclick: () => setTaxMode("exclude"),
      }, "税抜");
      const btnInclude = el("button", {
        class: "apr-tab apr-mode-tab",
        type: "button",
        "aria-selected": String(salesTaxMode === "include"),
        onclick: () => setTaxMode("include"),
      }, "税込");
      taxRow.appendChild(btnExclude);
      taxRow.appendChild(btnInclude);
    }

    function buildOverallBreakdown(recordsSrc, period, keyFieldId) {
      if (!keyFieldId) return { missingField: true, rows: [] };
      const m = new Map();
      for (const r of recordsSrc || []) {
        const recObj = r && r.record ? r.record : {};
        const d = parseDate(recObj[fieldMap.date]);
        if (!inRange(d, period)) continue;
        const keyRaw = extractValue(recObj[keyFieldId]);
        const key = String(keyRaw == null || String(keyRaw).trim() === "" ? "(未設定)" : keyRaw).trim();
        const pt = fieldMap.pt ? parseNumber(extractValue(recObj[fieldMap.pt])) : 0;
        const sales = fieldMap.sales ? parseNumber(extractValue(recObj[fieldMap.sales])) : 0;
        const cur = m.get(key) || { key, count: 0, pt: 0, sales: 0 };
        cur.count += 1;
        cur.pt += pt;
        cur.sales += sales;
        m.set(key, cur);
      }
      const rows = Array.from(m.values()).sort((a, b) =>
        (b.count - a.count) || (b.pt - a.pt) || (b.sales - a.sales) || a.key.localeCompare(b.key, "ja")
      );
      return { missingField: false, rows };
    }

    function buildOverallCountBreakdown(recordsSrc, period, dateFieldId, keyFieldId, apptFieldId, clptFieldId, salesFieldId) {
      if (!dateFieldId || !keyFieldId) return { missingField: true, rows: [] };
      const m = new Map();
      for (const r of recordsSrc || []) {
        const recObj = r && r.record ? r.record : {};
        const d = parseDate(recObj[dateFieldId]);
        if (!inRange(d, period)) continue;
        const keyRaw = extractValue(recObj[keyFieldId]);
        const key = String(keyRaw == null || String(keyRaw).trim() === "" ? "(未設定)" : keyRaw).trim();
        const cur = m.get(key) || { key, count: 0, pt: 0, sales: 0 };
        cur.count += 1;
        const appt = apptFieldId ? parseNumber(extractValue(recObj[apptFieldId])) : 0;
        const clpt = clptFieldId ? parseNumber(extractValue(recObj[clptFieldId])) : 0;
        const sales = salesFieldId ? parseNumber(extractValue(recObj[salesFieldId])) : 0;
        cur.pt += (appt + clpt);
        cur.sales += sales;
        m.set(key, cur);
      }
      const rows = Array.from(m.values()).sort((a, b) =>
        (b.count - a.count) || (b.pt - a.pt) || (b.sales - a.sales) || a.key.localeCompare(b.key, "ja")
      );
      return { missingField: false, rows };
    }

    function renderOverallBreakdownBlock(title, rows, missingField) {
      if (missingField) {
        return `
          <section class="apr-overall-section" aria-label="${String(title).replace(/"/g, "&quot;")}">
            <div class="apr-overall-section__title">${title}</div>
            <div class="apr-muted" style="margin-top:4px;">該当フィールド未設定（自動検出できませんでした）</div>
          </section>
        `;
      }
      if (!rows.length) {
        return `
          <section class="apr-overall-section" aria-label="${String(title).replace(/"/g, "&quot;")}">
            <div class="apr-overall-section__title">${title}</div>
            <div class="apr-muted" style="margin-top:4px;">対象データがありません。</div>
          </section>
        `;
      }
      const hasSales = !!fieldMap.sales;
      const tableRows = rows.slice(0, 30).map((x) => `
        <tr>
          <td class="apr-name">${String(x.key).replace(/</g, "&lt;")}</td>
          <td class="apr-num">${numFmt(x.count)}</td>
          <td class="apr-num">${numFmt(x.pt)}</td>
          ${hasSales ? `<td class="apr-num">${numFmt(x.sales)}</td>` : ""}
        </tr>
      `).join("");
      return `
        <section class="apr-overall-section" aria-label="${String(title).replace(/"/g, "&quot;")}">
          <div class="apr-overall-section__title">${title}</div>
          <div class="apr-table-wrap apr-overall-table-wrap">
            <table class="apr-table apr-table--overall-analysis">
              <thead>
                <tr>
                  <th class="apr-name">項目</th>
                  <th class="apr-num">件数</th>
                  <th class="apr-num">PT</th>
                  ${hasSales ? `<th class="apr-num">売上</th>` : ""}
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
        </section>
      `;
    }

    function renderOverallAnalysisPage(period, overallApoTypeRows, overallApoRankRows, overallWorkFunnelSum, overallMeetingFunnel) {
      const wf = overallWorkFunnelSum && typeof overallWorkFunnelSum === "object"
        ? overallWorkFunnelSum
        : { workDays: 0, pingpongCount: 0, interviewCount: 0, apoGetCount: 0 };
      const mf = overallMeetingFunnel && typeof overallMeetingFunnel === "object"
        ? overallMeetingFunnel
        : {
          executionCount: 0,
          meetingTypeRows: [],
          meetingStatusRows: [],
          contractCount: 0,
          denyCount: 0,
        };
      const meetingExecutionCountOv = mf.executionCount || 0;
      const meetingTypePieRows = Array.isArray(mf.meetingTypeRows) ? mf.meetingTypeRows : [];
      const meetingStatusPieRows = Array.isArray(mf.meetingStatusRows) ? mf.meetingStatusRows : [];
      const meetingContractCountOv = mf.contractCount || 0;
      const meetingDenyCountOv = mf.denyCount || 0;
      const meetingContractRate = meetingExecutionCountOv > 0 ? (meetingContractCountOv / meetingExecutionCountOv) : 0;
      const meetingDenyRate = meetingExecutionCountOv > 0 ? (meetingDenyCountOv / meetingExecutionCountOv) : 0;
      const guideContractDefault = 1;

      const pingpongCount = wf.pingpongCount || 0;
      const interviewCount = wf.interviewCount || 0;
      const apoGetCount = wf.apoGetCount || 0;
      const workDaysTotal = wf.workDays || 0;
      const interviewRate = pingpongCount > 0 ? (interviewCount / pingpongCount) : 0;
      const apoGetRate = interviewCount > 0 ? (apoGetCount / interviewCount) : 0;
      const guideApoDefault = 1;

      const byIntro = (overallIntroRecords && overallIntroFieldMap)
        ? buildOverallCountBreakdown(
          overallIntroRecords,
          period,
          overallIntroFieldMap.date,
          overallIntroFieldMap.introductionRoute,
          overallIntroFieldMap.appt,
          overallIntroFieldMap.clpt,
          overallIntroFieldMap.sales
        )
        : buildOverallBreakdown(records, period, fieldMap.introductionRoute);
      const byStore = buildOverallBreakdown(records, period, fieldMap.store);
      const byMaker = buildOverallBreakdown(records, period, fieldMap.maker);
      const byPayment = buildOverallBreakdown(records, period, fieldMap.paymentMethod);
      const pieRows = Array.isArray(overallApoTypeRows) ? overallApoTypeRows : [];
      const getFixedPieColor = buildApoTypeColorResolver(pieRows);
      const pieTotal = pieRows.reduce((s, x) => s + (x.count || 0), 0);
      let pieCum = 0;
      const pieStops = pieRows.map((x) => {
        const ratio = pieTotal > 0 ? (x.count || 0) / pieTotal : 0;
        const start = pieCum;
        pieCum += ratio * 100;
        const end = pieCum;
        return `${getFixedPieColor(x.type)} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
      });
      const pieBackground = pieStops.length
        ? `conic-gradient(${pieStops.join(", ")})`
        : "conic-gradient(#e2e8f0 0% 100%)";
      const pieLegend = pieRows.map((x) => {
        const rate = pieTotal > 0 ? ((x.count || 0) / pieTotal) * 100 : 0;
        return `
          <div class="apr-overall-leg-row" style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; padding:6px 0; border-bottom:1px dashed #e5e7eb;">
            <div class="apr-overall-leg-left" style="display:flex; align-items:flex-start; gap:8px; min-width:0; flex:1 1 auto;">
              <span class="apr-overall-leg-swatch" style="display:inline-block; width:10px; height:10px; border-radius:2px; background:${getFixedPieColor(x.type)}; flex-shrink:0; margin-top:3px;"></span>
              <span class="apr-overall-leg-label">${String(x.type || "").replace(/</g, "&lt;")}</span>
            </div>
            <div class="apr-overall-leg-value">${numFmt(x.count || 0)}件 (${rate.toFixed(1)}%)</div>
          </div>
        `;
      }).join("");

      const rankRows = Array.isArray(overallApoRankRows) ? overallApoRankRows : [];
      const rankTotal = rankRows.reduce((s, x) => s + (x.count || 0), 0);
      let rankCum = 0;
      const rankPieStops = rankRows.map((x, idx) => {
        const ratio = rankTotal > 0 ? (x.count || 0) / rankTotal : 0;
        const start = rankCum;
        rankCum += ratio * 100;
        const end = rankCum;
        return `${getApoRankPieSliceColor(x.rank, idx)} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
      });
      const rankPieBackground = rankPieStops.length
        ? `conic-gradient(${rankPieStops.join(", ")})`
        : "conic-gradient(#e2e8f0 0% 100%)";
      const rankPieLegend = rankRows.map((x, idx) => {
        const rate = rankTotal > 0 ? ((x.count || 0) / rankTotal) * 100 : 0;
        return `
          <div class="apr-overall-leg-row" style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; padding:6px 0; border-bottom:1px dashed #e5e7eb;">
            <div class="apr-overall-leg-left" style="display:flex; align-items:flex-start; gap:8px; min-width:0; flex:1 1 auto;">
              <span class="apr-overall-leg-swatch" style="display:inline-block; width:10px; height:10px; border-radius:2px; background:${getApoRankPieSliceColor(x.rank, idx)}; flex-shrink:0; margin-top:3px;"></span>
              <span class="apr-overall-leg-label">${String(x.rank || "").replace(/</g, "&lt;")}</span>
            </div>
            <div class="apr-overall-leg-value">${numFmt(x.count || 0)}件 (${rate.toFixed(1)}%)</div>
          </div>
        `;
      }).join("");

      const meetingPieTotalMt = meetingTypePieRows.reduce((s, x) => s + (x.count || 0), 0);
      const getMeetingTypePieColor = buildApoTypeColorResolver(meetingTypePieRows);
      let mtPieCum = 0;
      const meetingTypePieStops = meetingTypePieRows.map((x) => {
        const ratio = meetingPieTotalMt > 0 ? (x.count || 0) / meetingPieTotalMt : 0;
        const start = mtPieCum;
        mtPieCum += ratio * 100;
        const end = mtPieCum;
        return `${getMeetingTypePieColor(x.type)} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
      });
      const meetingTypePieBg = meetingTypePieStops.length
        ? `conic-gradient(${meetingTypePieStops.join(", ")})`
        : "conic-gradient(#e2e8f0 0% 100%)";
      const meetingTypePieLegend = meetingTypePieRows.map((x) => {
        const rate = meetingPieTotalMt > 0 ? ((x.count || 0) / meetingPieTotalMt) * 100 : 0;
        return `
          <div class="apr-overall-leg-row" style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; padding:6px 0; border-bottom:1px dashed #e5e7eb;">
            <div class="apr-overall-leg-left" style="display:flex; align-items:flex-start; gap:8px; min-width:0; flex:1 1 auto;">
              <span class="apr-overall-leg-swatch" style="display:inline-block; width:10px; height:10px; border-radius:2px; background:${getMeetingTypePieColor(x.type)}; flex-shrink:0; margin-top:3px;"></span>
              <span class="apr-overall-leg-label">${String(x.type || "").replace(/</g, "&lt;")}</span>
            </div>
            <div class="apr-overall-leg-value">${numFmt(x.count || 0)}件 (${rate.toFixed(1)}%)</div>
          </div>
        `;
      }).join("");

      const meetingPieTotalMs = meetingStatusPieRows.reduce((s, x) => s + (x.count || 0), 0);
      const getMeetingStatusPieColor = buildApoTypeColorResolver(meetingStatusPieRows);
      let msPieCum = 0;
      const meetingStatusPieStops = meetingStatusPieRows.map((x) => {
        const ratio = meetingPieTotalMs > 0 ? (x.count || 0) / meetingPieTotalMs : 0;
        const start = msPieCum;
        msPieCum += ratio * 100;
        const end = msPieCum;
        return `${getMeetingStatusPieColor(x.type)} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
      });
      const meetingStatusPieBg = meetingStatusPieStops.length
        ? `conic-gradient(${meetingStatusPieStops.join(", ")})`
        : "conic-gradient(#e2e8f0 0% 100%)";
      const meetingStatusPieLegend = meetingStatusPieRows.map((x) => {
        const rate = meetingPieTotalMs > 0 ? ((x.count || 0) / meetingPieTotalMs) * 100 : 0;
        return `
          <div class="apr-overall-leg-row" style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; padding:6px 0; border-bottom:1px dashed #e5e7eb;">
            <div class="apr-overall-leg-left" style="display:flex; align-items:flex-start; gap:8px; min-width:0; flex:1 1 auto;">
              <span class="apr-overall-leg-swatch" style="display:inline-block; width:10px; height:10px; border-radius:2px; background:${getMeetingStatusPieColor(x.type)}; flex-shrink:0; margin-top:3px;"></span>
              <span class="apr-overall-leg-label">${String(x.type || "").replace(/</g, "&lt;")}</span>
            </div>
            <div class="apr-overall-leg-value">${numFmt(x.count || 0)}件 (${rate.toFixed(1)}%)</div>
          </div>
        `;
      }).join("");

      content.innerHTML = `
        <div class="apr-overall-analysis">
          ${renderOverallBreakdownBlock("導入経緯別", byIntro.rows, byIntro.missingField)}
          ${renderOverallBreakdownBlock("施工店別", byStore.rows, byStore.missingField)}
          ${renderOverallBreakdownBlock("メーカー別", byMaker.rows, byMaker.missingField)}
          ${renderOverallBreakdownBlock("支払方法別", byPayment.rows, byPayment.missingField)}
          <section class="apr-overall-section apr-overall-section--pie" aria-label="全体累計（導入経緯別・アポランク比率）">
            <div class="apr-overall-section__title">全体累計（導入経緯別）</div>
            <div class="apr-overall-pie-slot">
              <div class="apr-overall-pie-grid">
                <div class="apr-overall-pie-visual">
                  <div class="apr-overall-pie-disk" style="background:${pieBackground}; border:1px solid #d5deea; box-shadow:0 10px 22px rgba(15,23,42,0.14), inset 0 2px 8px rgba(255,255,255,0.45);">
                    <div class="apr-overall-pie-disk-inner">
                      全体合計<br>${numFmt(pieTotal)}
                    </div>
                  </div>
                </div>
                <div class="apr-overall-pie-legend">${pieLegend || "<div class=\"apr-muted\" style=\"padding:6px 0;\">該当データがありません。</div>"}</div>
              </div>
            </div>
            <div class="apr-overall-section__sub">アポランク比率</div>
            <div class="apr-overall-pie-hint">個人別分析のアポランク比率と同一の種別フィルタ（${String((CONFIG.PERSONAL_APO_BAR_FILTER_VALUES || []).join("・") || "—").replace(/</g, "&lt;")}）のみを対象としたランク別件数</div>
            <div class="apr-overall-pie-slot">
              <div class="apr-overall-pie-grid">
                <div class="apr-overall-pie-visual">
                  <div class="apr-overall-pie-disk" style="background:${rankPieBackground}; border:1px solid #d5deea; box-shadow:0 10px 22px rgba(15,23,42,0.14), inset 0 2px 8px rgba(255,255,255,0.45);">
                    <div class="apr-overall-pie-disk-inner">
                      アポ合計<br>${numFmt(rankTotal)}
                    </div>
                  </div>
                </div>
                <div class="apr-overall-pie-legend">${rankPieLegend || "<div class=\"apr-muted\" style=\"padding:6px 0;\">該当データがありません。</div>"}</div>
              </div>
            </div>
          </section>
          <section class="apr-overall-section apr-overall-work-funnel" aria-label="アポデータ全体累計">
            <div class="apr-overall-section__title">アポデータ（全体累計）</div>
            <div style="font-size:12px; color:#64748b; margin:-4px 0 10px;">個人別分析と同一の算出（面談率・アポ取得率・必要件数）、稼働終了報告の担当者別数値を<strong>全期間</strong>で合算しています。</div>
            <div style="margin:0;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin:0 0 8px;">
                <div class="apr-chart-head" style="margin:0; font-size:14px;">集計概要</div>
                <div class="apr-chart-sub" style="margin:0;">対象稼働日数（レコード数）: ${numFmt(workDaysTotal)}</div>
              </div>
              <div class="apr-overall-work-metrics" style="display:grid; gap:8px; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items:start;">
                <div class="apr-kpi-tile" style="padding:8px 10px; border:1px solid #dbeafe; border-radius:10px; background:#f8fbff;">
                  <div class="apr-kpi-label">ピンポン数</div>
                  <strong class="apr-kpi-value">${numFmt(pingpongCount)}</strong>
                </div>
                <div class="apr-kpi-tile" style="padding:8px 10px; border:1px solid #dcfce7; border-radius:10px; background:#f7fff9;">
                  <div class="apr-kpi-label">面談数</div>
                  <strong class="apr-kpi-value">${numFmt(interviewCount)}</strong>
                </div>
                <div class="apr-kpi-tile" style="padding:8px 10px; border:1px solid #fef3c7; border-radius:10px; background:#fffdf5;">
                  <div class="apr-kpi-label">アポ獲得数</div>
                  <strong class="apr-kpi-value">${numFmt(apoGetCount)}</strong>
                </div>
                <div style="grid-column:1 / -1; border:1px solid #dbeafe; border-radius:10px; background:#f8fbff; padding:10px;">
                  <div style="font-weight:800; font-size:13px; color:#1e3a8a; margin-bottom:8px;">1件アポ取得までの道</div>
                  <div style="display:grid; gap:8px;">
                    <div class="apr-personal-guide-rates" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; font-size:12px;">
                      <span style="color:#475569;">面談率</span>
                      <strong style="color:#0f172a;">${pingpongCount > 0 ? (interviewRate * 100).toFixed(1) : "0.0"}%</strong>
                      <span style="color:#94a3b8;">/</span>
                      <span style="color:#475569;">アポ取得率</span>
                      <strong style="color:#0f172a;">${interviewCount > 0 ? (apoGetRate * 100).toFixed(1) : "0.0"}%</strong>
                    </div>
                    <div class="apr-overall-guide-results" style="display:grid; gap:6px; grid-template-columns: repeat(3, minmax(0, 1fr));">
                      <div class="apr-kpi-guide-tile" style="padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px; background:#fff;">
                        <div class="apr-kpi-sub-label">必要ピンポン数</div>
                        <div class="apr-kpi-value"><span data-overall-guide-pingpong>${numFmt(0)}</span></div>
                      </div>
                      <div class="apr-kpi-guide-tile" style="padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px; background:#fff;">
                        <div class="apr-kpi-sub-label">必要面談数</div>
                        <div class="apr-kpi-value"><span data-overall-guide-interview>${numFmt(0)}</span></div>
                      </div>
                      <div class="apr-kpi-guide-tile" style="padding:8px 10px; border:1px solid #93c5fd; border-radius:8px; background:#fff;">
                        <div class="apr-kpi-sub-label">アポ取得数</div>
                        <div style="display:flex; align-items:center; gap:6px; margin-top:2px;">
                          <input data-overall-guide-apo-input type="number" min="0" step="1" value="${guideApoDefault}"
                            style="width:90px; padding:4px 8px; border:1px solid #93c5fd; border-radius:7px; font-size:13px; font-weight:700;">
                          <span class="apr-muted" style="font-size:11px;">変更可</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section class="apr-overall-section apr-overall-meeting-funnel" aria-label="商談データ全体累計">
            <div class="apr-overall-section__title">商談データ（全体累計）</div>
            <div style="font-size:12px; color:#64748b; margin:-4px 0 12px;">個人別と同様、CL関連アプリのアポ種別・見込み状態・オンライン商談除外を<strong>全期間</strong>で担当者横断集計しています。</div>
            <div style="margin:0;">
              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin:0 0 8px;">
                <div class="apr-chart-head" style="margin:0; font-size:13px;">商談実施数（導入経緯別）</div>
                <div class="apr-chart-sub" style="margin:0;">商談実施合計: ${numFmt(meetingExecutionCountOv)}</div>
              </div>
              <div class="apr-overall-pie-slot">
                <div class="apr-overall-pie-grid">
                  <div class="apr-overall-pie-visual">
                    <div class="apr-overall-pie-disk" style="background:${meetingTypePieBg}; border:1px solid #d5deea; box-shadow:0 10px 22px rgba(15,23,42,0.14), inset 0 2px 8px rgba(255,255,255,0.45);">
                      <div class="apr-overall-pie-disk-inner">
                        商談実施合計<br>${numFmt(meetingPieTotalMt)}
                      </div>
                    </div>
                  </div>
                  <div class="apr-overall-pie-legend">${meetingTypePieLegend || "<div class=\"apr-muted\" style=\"padding:6px 0;\">該当データがありません。</div>"}</div>
                </div>
              </div>
              <div class="apr-overall-section__sub">初回商談結果（結果比率）</div>
              <div class="apr-overall-pie-hint">商談結果合計: ${numFmt(meetingPieTotalMs)}</div>
              <div class="apr-overall-pie-slot">
                <div class="apr-overall-pie-grid">
                  <div class="apr-overall-pie-visual">
                    <div class="apr-overall-pie-disk" style="background:${meetingStatusPieBg}; border:1px solid #d5deea; box-shadow:0 10px 22px rgba(15,23,42,0.14), inset 0 2px 8px rgba(255,255,255,0.45);">
                      <div class="apr-overall-pie-disk-inner">
                        商談結果合計<br>${numFmt(meetingPieTotalMs)}
                      </div>
                    </div>
                  </div>
                  <div class="apr-overall-pie-legend">${meetingStatusPieLegend || "<div class=\"apr-muted\" style=\"padding:6px 0;\">該当データがありません。</div>"}</div>
                </div>
              </div>
              <div style="margin-top:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin:0 0 8px;">
                  <div class="apr-chart-head" style="margin:0; font-size:14px;">商談データ</div>
                  <div class="apr-chart-sub" style="margin:0;">対象データ数: ${numFmt(meetingExecutionCountOv)}</div>
                </div>
                <div class="apr-overall-work-metrics" style="display:grid; gap:8px; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items:start;">
                  <div class="apr-kpi-tile" style="padding:8px 10px; border:1px solid #dbeafe; border-radius:10px; background:#f8fbff;">
                    <div class="apr-kpi-label">商談実施数</div>
                    <strong class="apr-kpi-value">${numFmt(meetingExecutionCountOv)}</strong>
                  </div>
                  <div class="apr-kpi-tile" style="padding:8px 10px; border:1px solid #dcfce7; border-radius:10px; background:#f7fff9;">
                    <div class="apr-kpi-label">成約数</div>
                    <strong class="apr-kpi-value">${numFmt(meetingContractCountOv)}</strong>
                  </div>
                  <div class="apr-kpi-tile" style="padding:8px 10px; border:1px solid #fee2e2; border-radius:10px; background:#fff7f7;">
                    <div class="apr-kpi-label">否数</div>
                    <strong class="apr-kpi-value">${numFmt(meetingDenyCountOv)}</strong>
                  </div>
                  <div style="grid-column:1 / -1; border:1px solid #dbeafe; border-radius:10px; background:#f8fbff; padding:10px;">
                    <div style="font-weight:800; font-size:13px; color:#1e3a8a; margin-bottom:8px;">1契約までの道</div>
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; font-size:12px;">
                      <span style="color:#475569;">成約率</span>
                      <strong style="color:#0f172a;">${(meetingContractRate * 100).toFixed(1)}%</strong>
                      <span style="color:#94a3b8;">/</span>
                      <span style="color:#475569;">否率</span>
                      <strong style="color:#0f172a;">${(meetingDenyRate * 100).toFixed(1)}%</strong>
                    </div>
                    <div class="apr-overall-meeting-guide-results" style="display:grid; gap:6px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top:8px;">
                      <div class="apr-kpi-guide-tile" style="padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px; background:#fff;">
                        <div class="apr-kpi-sub-label">必要商談実施数</div>
                        <div class="apr-kpi-value"><span data-overall-guide-required-meeting>${meetingContractRate > 0 ? numFmt(Math.ceil(guideContractDefault / meetingContractRate)) : "-"}</span></div>
                      </div>
                      <div class="apr-kpi-guide-tile" style="padding:8px 10px; border:1px solid #93c5fd; border-radius:8px; background:#fff;">
                        <div class="apr-kpi-sub-label">契約数</div>
                        <div style="display:flex; align-items:center; gap:6px; margin-top:2px;">
                          <input data-overall-guide-contract-input type="number" min="0" step="1" value="${guideContractDefault}"
                            style="width:90px; padding:4px 8px; border:1px solid #93c5fd; border-radius:7px; font-size:13px; font-weight:700;">
                          <span class="apr-muted" style="font-size:11px;">変更可</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      `;

      const guideInputOverall = content.querySelector("[data-overall-guide-apo-input]");
      const guideInterviewOverall = content.querySelector("[data-overall-guide-interview]");
      const guidePingpongOverall = content.querySelector("[data-overall-guide-pingpong]");
      const recalcOverallApoGuide = () => {
        if (!guideInputOverall || !guideInterviewOverall || !guidePingpongOverall) return;
        const apoTarget = Math.max(0, parseNumber(guideInputOverall.value));
        const interviewPerApo = apoGetCount > 0 ? (interviewCount / apoGetCount) : 0;
        const interviewTarget = Math.ceil(interviewPerApo * apoTarget);
        const pingpongPerInterview = interviewCount > 0 ? (pingpongCount / interviewCount) : 0;
        const pingpongTarget = Math.ceil(pingpongPerInterview * interviewTarget);
        guideInterviewOverall.textContent = numFmt(interviewTarget);
        guidePingpongOverall.textContent = numFmt(pingpongTarget);
      };
      if (guideInputOverall) {
        guideInputOverall.addEventListener("input", recalcOverallApoGuide);
        guideInputOverall.addEventListener("change", recalcOverallApoGuide);
      }
      recalcOverallApoGuide();

      const guideContractInputOverall = content.querySelector("[data-overall-guide-contract-input]");
      const guideRequiredMeetingOverall = content.querySelector("[data-overall-guide-required-meeting]");
      const recalcOverallMeetingGuide = () => {
        if (!guideContractInputOverall || !guideRequiredMeetingOverall) return;
        const contractTarget = Math.max(0, parseNumber(guideContractInputOverall.value));
        if (meetingContractRate > 0) {
          guideRequiredMeetingOverall.textContent = numFmt(Math.ceil(contractTarget / meetingContractRate));
        } else {
          guideRequiredMeetingOverall.textContent = "-";
        }
      };
      if (guideContractInputOverall) {
        guideContractInputOverall.addEventListener("input", recalcOverallMeetingGuide);
        guideContractInputOverall.addEventListener("change", recalcOverallMeetingGuide);
      }
      recalcOverallMeetingGuide();
    }

    function render() {
      if (!fieldMap || !records) return;
      const monthKey = monthSelect.value || (monthOptions[0] && monthOptions[0].key);
      const period = buildPeriodFromMonthKey(monthOptions, monthKey);
      if (!period) {
        content.innerHTML = `<div class="apr-err">対象月を選択してください。</div>`;
        setHint("期間を選択");
        return;
      }
      const personalPeriod = buildPersonalTrailingPeriod(monthKey);
      const activePeriod = (analysisPage === "personal" && personalPeriod) ? personalPeriod : period;
      const res = aggregate(records, fieldMap, activePeriod);
      const goalSums = sumGoalsInPeriod(goalMonthMap, activePeriod, monthOptions);
      const apoSummary = (apoRecords && apoFieldMap) ? aggregateApo(apoRecords, apoFieldMap, CONFIG.APO_FILTER_VALUES, activePeriod) : null;
      const apoMap = apoSummary ? new Map((apoSummary.items || []).map((x) => [x.name, x])) : new Map();
      if (analysisPage === "branch" && apoSummary) {
        const have = new Set((res.items || []).map((x) => x.name));
        for (const [name, g] of goalSums) {
          if (g && g.apoTarget > 0 && !have.has(name)) {
            res.items.push({ name, pt: 0, sales: 0, count: 0 });
            have.add(name);
          }
        }
        for (const x of apoSummary.items || []) {
          if (x && x.name && !have.has(x.name)) {
            res.items.push({ name: x.name, pt: 0, sales: 0, count: 0 });
            have.add(x.name);
          }
        }
      }
      const cumulativePeriod = { start: null, end: null };
      const personalAggPeriod = (analysisPage === "personal" && personalPeriod) ? personalPeriod : cumulativePeriod;
      const cumulativeApoSummary = (apoRecords && apoFieldMap) ? aggregateApo(apoRecords, apoFieldMap, CONFIG.APO_FILTER_VALUES, personalAggPeriod) : { items: [] };
      const cumulativeApoMetricsMap = new Map((cumulativeApoSummary.items || []).map((x) => [x.name, x]));
      const apoAllCountMap = (apoRecords && apoFieldMap) ? sumApoActualCountByPersonAll(apoRecords, apoFieldMap, personalAggPeriod) : new Map();
      const apoTypeBreakdownMap = (apoRecords && apoFieldMap) ? sumApoTypeBreakdownByPersonAll(apoRecords, apoFieldMap, personalAggPeriod) : new Map();
      const ptIntroBreakdownMap = (records && fieldMap)
        ? sumPtByIntroductionRouteByPersonAll(records, {
          salesperson: fieldMap.salesperson,
          introductionRoute: fieldMap.introductionRoute,
          pt: fieldMap.pt,
          regNo: fieldMap.regNo,
          date: fieldMap.date,
        }, personalAggPeriod)
        : new Map();
      const introCountBreakdownMap = (apoRecords && apoFieldMap)
        ? sumContractByIntroductionRouteByPersonAll(apoRecords, {
          salesperson: apoFieldMap.clPerson,
          apoType: apoFieldMap.apoType,
          date: apoFieldMap.date,
          estimateStatus: apoFieldMap.estimateStatus,
        }, personalAggPeriod, CONFIG.APO_CONTRACT_STATUSES)
        : new Map();
      const meetingPeriodDate = apoFieldMap ? (apoFieldMap.meetingDate || apoFieldMap.date) : "";
      const meetingTypeBreakdownMap = (apoRecords && apoFieldMap)
        ? sumMeetingTypeBreakdownByPersonAll(apoRecords, {
          salesperson: apoFieldMap.clPerson,
          apoType: apoFieldMap.apoType,
          date: meetingPeriodDate,
          estimateStatus: apoFieldMap.estimateStatus,
          meetingPlace: apoFieldMap.meetingPlace,
        }, personalAggPeriod, CONFIG.CL_MEETING_STATUSES)
        : new Map();
      const meetingStatusBreakdownMap = (apoRecords && apoFieldMap)
        ? sumMeetingStatusBreakdownByPersonAll(apoRecords, {
          salesperson: apoFieldMap.clPerson,
          date: meetingPeriodDate,
          estimateStatus: apoFieldMap.estimateStatus,
          meetingPlace: apoFieldMap.meetingPlace,
        }, personalAggPeriod, CONFIG.CL_MEETING_STATUSES)
        : new Map();
      const meetingStatusDetailMapByPerson = (apoRecords && apoFieldMap)
        ? sumMeetingStatusDetailByPersonAll(apoRecords, {
          salesperson: apoFieldMap.clPerson,
          date: meetingPeriodDate,
          estimateStatus: apoFieldMap.estimateStatus,
          meetingPlace: apoFieldMap.meetingPlace,
        }, personalAggPeriod, CONFIG.CL_MEETING_STATUSES)
        : new Map();
      const personalApoRankByTypeMap = (apoRecords && apoFieldMap)
        ? sumApoRankBreakdownByPersonAndTypeAll(apoRecords, apoFieldMap, personalAggPeriod, CONFIG.PERSONAL_APO_BAR_FILTER_VALUES)
        : new Map();
      const overallApoTypeRows = (apoRecords && apoFieldMap)
        ? Array.from(sumApoTypeBreakdownOverallAll(apoRecords, apoFieldMap, cumulativePeriod).entries())
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => (b.count - a.count) || a.type.localeCompare(b.type, "ja"))
        : [];
      const overallApoRankRows = (apoRecords && apoFieldMap)
        ? Array.from(sumOverallApoRankBreakdownFilteredAll(
          apoRecords,
          apoFieldMap,
          cumulativePeriod,
          CONFIG.PERSONAL_APO_BAR_FILTER_VALUES
        ).entries())
          .map(([rank, count]) => ({ rank, count }))
          .sort((a, b) => (b.count - a.count) || String(a.rank).localeCompare(String(b.rank), "ja"))
        : [];
      const cumulativeWorkAgg = (workRecords && workFieldMap) ? aggregateWorkDays(workRecords, workFieldMap, personalAggPeriod) : { items: [] };
      const cumulativeWorkStatsMap = new Map((cumulativeWorkAgg.items || []).map((x) => [x.name, x]));
      const overallWorkFunnelSum = (analysisPage === "overall")
        ? reduceWorkAggItemsToTotals(cumulativeWorkAgg.items || [])
        : { workDays: 0, pingpongCount: 0, interviewCount: 0, apoGetCount: 0 };
      const meetingFldOverall = (analysisPage === "overall" && apoRecords && apoFieldMap && apoFieldMap.clPerson)
        ? {
          salesperson: apoFieldMap.clPerson,
          apoType: apoFieldMap.apoType,
          date: meetingPeriodDate || apoFieldMap.date || "",
          estimateStatus: apoFieldMap.estimateStatus,
          meetingPlace: apoFieldMap.meetingPlace,
        }
        : null;
      let overallMeetingFunnel = {
        executionCount: 0,
        meetingTypeRows: [],
        meetingStatusRows: [],
        contractCount: 0,
        denyCount: 0,
      };
      if (meetingFldOverall) {
        const typeMapOv = sumMeetingTypeBreakdownOverallAll(apoRecords, meetingFldOverall, cumulativePeriod, CONFIG.CL_MEETING_STATUSES);
        const meetingTypeRowsOv = Array.from(typeMapOv.entries())
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => (b.count - a.count) || a.type.localeCompare(b.type, "ja"));
        const statusMapOv = sumMeetingStatusBreakdownOverallAll(apoRecords, meetingFldOverall, cumulativePeriod, CONFIG.CL_MEETING_STATUSES);
        const meetingStatusRowsOv = Array.from(statusMapOv.entries())
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => (b.count - a.count) || a.type.localeCompare(b.type, "ja"));
        const groupedDetailOv = sumMeetingStatusGroupedDetailOverallAll(apoRecords, meetingFldOverall, cumulativePeriod, CONFIG.CL_MEETING_STATUSES);
        const cdOv = tallyMeetingContractDenyOverallFromGroupedDetail(groupedDetailOv);
        overallMeetingFunnel = {
          executionCount: meetingTypeRowsOv.reduce((s, x) => s + (x.count || 0), 0),
          meetingTypeRows: meetingTypeRowsOv,
          meetingStatusRows: meetingStatusRowsOv,
          contractCount: cdOv.meetingContractCount,
          denyCount: cdOv.meetingDenyCount,
        };
      }
      const workAgg = (workRecords && workFieldMap) ? aggregateWorkDays(workRecords, workFieldMap, activePeriod) : { items: [] };
      const workDaysMap = new Map((workAgg.items || []).map((x) => [x.name, x.workDays || 0]));
      const contractSums = sumContractCountInPeriod(contractCountMap, activePeriod, monthOptions);
      for (const it of res.items) {
        const g = goalSums.get(it.name);
        it.goal = g ? g.ptTarget : 0;
        it.achv = (it.goal > 0 && (it.pt || 0) >= 0) ? ((it.pt || 0) / it.goal) * 100 : 0;
        it.count = contractSums.get(it.name) || 0;
        it.apoGoal = g ? g.apoTarget : 0;
        it.branch = getBranchInPeriod(goalMonthMap, it.name, activePeriod, monthOptions);
        it.actualCount = 0;
        it.apoCount = 0;
        it.cancelCount = 0;
        it.meetingCount = 0;
        it.contractCount = 0;
        it.workDays = workDaysMap.has(it.name) ? workDaysMap.get(it.name) : 0;
        it.plannedWorkDays = g ? (g.plannedWorkDays || 0) : 0;
        it.apoAchv = 0;
        const apoItem = apoMap.get(it.name);
        if (apoItem) {
          it.actualCount = apoItem.actualCount || 0;
          it.apoCount = apoItem.count || 0;
          it.cancelCount = apoItem.cancelCount || 0;
          it.meetingCount = apoItem.meetingCount || 0;
          it.contractCount = apoItem.contractCount || 0;
          it.apoAchv = (it.apoGoal > 0 && (it.actualCount || 0) >= 0) ? ((it.actualCount || 0) / it.apoGoal) * 100 : 0;
        }
      }
      const branchSortKey = (br) => {
        const s = String(br || "").trim();
        const order = {
          "奈良本社": 0,
          "京都支社": 1,
          "名古屋支社": 2,
          "埼玉支社": 3,
        };
        if (Object.prototype.hasOwnProperty.call(order, s)) return `0${order[s]}`;
        if (!s) return "9zzz";
        return "8" + s;
      };
      if (activePeriod.start && activePeriod.end) {
        setHint(`期間: ${activePeriod.hint}（${fmtYMD(activePeriod.start)} ～ ${fmtYMD(new Date(activePeriod.end.getTime() - 1))}）`);
      } else {
        setHint(activePeriod.hint || "");
      }
      if (analysisPage === "branch") {
        res.items.sort((a, b) => branchSortKey(a.branch).localeCompare(branchSortKey(b.branch)) || (b.pt - a.pt) || (b.sales - a.sales) || a.name.localeCompare(b.name));
        const canTamaCl = !!(apoRecords && apoFieldMap && apoFieldMap.clPerson && apoFieldMap.estimateStatus);
        const canTamaAp = !!(apoRecords && apoFieldMap && apoFieldMap.salesperson && apoFieldMap.estimateStatus);
        if (canTamaCl) {
          const tamaByCl = sumApoTamaCountByClPerson(apoRecords, apoFieldMap, null);
          for (const it of res.items) {
            it.tamaCount = tamaByCl.get(normalizePersonName(it.name)) || 0;
          }
        }
        if (canTamaAp) {
          const tamaByAp = sumApoTamaCountByApPerson(apoRecords, apoFieldMap, null);
          for (const it of res.items) {
            it.tamaCountAp = tamaByAp.get(normalizePersonName(it.name)) || 0;
          }
        }
        const breakdownRows = buildSalesTargetBreakdownRows(records, fieldMap, activePeriod, search.value || "", salesTaxMode, contractLinkageForTarget).rows;
        const targetBreakdownByName = new Map(breakdownRows.map((x) => [x.name, x]));
        renderTable(content, res, fieldMap, search.value || "", salesTaxMode, {
          showApo: true,
          showTamaCl: canTamaCl,
          showTamaAp: canTamaAp,
          targetBreakdownByName,
        });
        return;
      }

      if (analysisPage === "overall") {
        renderOverallAnalysisPage(period, overallApoTypeRows, overallApoRankRows, overallWorkFunnelSum, overallMeetingFunnel);
        return;
      }

      if (analysisPage === "cl") {
        const meetingFieldMap = {
          salesperson: (apoFieldMap && apoFieldMap.clPerson) ? apoFieldMap.clPerson : "",
          date: apoFieldMap ? (apoFieldMap.meetingDate || apoFieldMap.date) : "",
          estimateStatus: apoFieldMap ? apoFieldMap.estimateStatus : "",
          meetingPlace: apoFieldMap ? apoFieldMap.meetingPlace : "",
        };
        const meetingSums = sumMeetingCountByPerson(apoRecords, meetingFieldMap, activePeriod, CONFIG.CL_MEETING_STATUSES);
        for (const it of res.items) {
          it.meetingCount = meetingSums.get(it.name) || 0;
        }
        res.items.sort((a, b) => (b.pt - a.pt) || (b.sales - a.sales) || (b.count - a.count) || a.name.localeCompare(b.name));
        renderTable(content, res, fieldMap, search.value || "", salesTaxMode, { showMeeting: true });
        return;
      }

      if (analysisPage === "personal") {
        const hiddenPersonalNames = new Set(["トラーチ倶楽部", "トレンディ", "卸案件"].map((n) => normalizePersonName(n)));
        const personalItems = (res.items || []).filter((x) => !hiddenPersonalNames.has(normalizePersonName(x.name)));
        updatePersonalSelector(personalItems, search.value || "");
        renderSelectors();
        const selected = personalItems.find((x) => x.name === selectedPersonalName) || null;
        renderPersonalAnalysisPage(activePeriod, selected, apoAllCountMap, apoTypeBreakdownMap, ptIntroBreakdownMap, introCountBreakdownMap, meetingTypeBreakdownMap, meetingStatusBreakdownMap, meetingStatusDetailMapByPerson, overallApoTypeRows, personalApoRankByTypeMap, cumulativeWorkStatsMap, cumulativeApoMetricsMap);
        return;
      }

      // APデータ分析
      if (!apoRecords || !apoFieldMap) {
        content.innerHTML = `<div class="apr-empty">APデータが取得できていないため表示できません。</div>`;
        return;
      }
      const apoRes = aggregateApo(apoRecords, apoFieldMap, CONFIG.APO_FILTER_VALUES, activePeriod);
      for (const it of apoRes.items) {
        const g = goalSums.get(it.name);
        it.goal = g ? g.apoTarget : 0;
        it.plannedWorkDays = g ? (g.plannedWorkDays || 0) : 0;
        it.achv = (it.goal > 0 && (it.actualCount || 0) >= 0) ? ((it.actualCount || 0) / it.goal) * 100 : 0;
        it.workDays = 0;
      }
      renderApoTable(content, apoRes, search.value || "");
    }

    async function loadAndInit() {
      setHint("読み込み中...");
      content.innerHTML = `<div class="apr-muted">読み込み中...</div>`;
      try {
        const appId = await getAppIdByName(CONFIG.APP_NAME);
        const fields = await getFields(appId);
        const over = CONFIG.FIELD_OVERRIDES || {};
        const kw = CONFIG.FIELD_KEYWORDS || {};
        /** CLランキングと同様：OVERRIDE が空文字のときはキーワードで再解決（登録番号未取得だと詳細が常に PT のみレイアウトになる） */
        fieldMap = {
          salesperson: over.salesperson || pickFieldUniqueId(fields, kw.salesperson),
          pt: over.pt || pickFieldUniqueId(fields, kw.pt),
          sales: over.sales || pickFieldUniqueId(fields, kw.sales),
          date: over.date || pickFieldUniqueId(fields, kw.date),
          customerName: over.customerName || pickFieldUniqueId(fields, kw.customerName),
          regNo: over.regNo || pickFieldUniqueId(fields, kw.regNo),
          introductionRoute: over.introductionRoute || pickFieldUniqueId(fields, kw.introductionRoute),
          store: over.store || pickFieldUniqueId(fields, kw.store),
          maker: over.maker || pickFieldUniqueId(fields, kw.maker),
          paymentMethod: over.paymentMethod || pickFieldUniqueId(fields, kw.paymentMethod),
        };
        if (!fieldMap.salesperson || !fieldMap.date) {
          content.innerHTML = `<div class="apr-err">営業データ分析には、担当者・日付フィールドが必要です。</div>`;
          setHint("設定が必要です");
          return;
        }
        const fieldIdsCsv = [
          fieldMap.salesperson, fieldMap.pt, fieldMap.sales, fieldMap.date,
          fieldMap.customerName, fieldMap.regNo,
          fieldMap.introductionRoute, fieldMap.store, fieldMap.maker, fieldMap.paymentMethod,
        ].filter(Boolean).join(",");
        setHint("レコード取得中...");
        records = await fetchAllRecords(appId, fieldIdsCsv);

        setHint(`取得完了: ${records.length.toLocaleString("ja-JP")}件 / 目標データ取得中...`);
        goalMonthMap = null;
        try {
          const goalAppId = await getAppIdByName(CONFIG.GOAL_APP_NAME);
          const goalFields = await getFields(goalAppId);
          const go = CONFIG.GOAL_FIELD_OVERRIDES || {};
          const goalFieldMap = {
            salesperson: go.salesperson || pickFieldUniqueId(goalFields, CONFIG.GOAL_FIELD_KEYWORDS.salesperson),
            date: go.date || pickFieldUniqueId(goalFields, CONFIG.GOAL_FIELD_KEYWORDS.date),
            ptTarget: go.ptTarget || pickFieldUniqueId(goalFields, CONFIG.GOAL_FIELD_KEYWORDS.ptTarget),
            apoTarget: go.apoTarget || pickFieldUniqueId(goalFields, CONFIG.GOAL_FIELD_KEYWORDS.apoTarget),
            branch: go.branch != null && go.branch !== "" ? go.branch : pickFieldUniqueId(goalFields, CONFIG.GOAL_FIELD_KEYWORDS.branch),
          };
          if (goalFieldMap.salesperson && goalFieldMap.date && (goalFieldMap.ptTarget || goalFieldMap.apoTarget)) {
            const goalWanted = [goalFieldMap.salesperson, goalFieldMap.date, goalFieldMap.ptTarget, goalFieldMap.apoTarget, goalFieldMap.branch].filter(Boolean).join(",");
            const goalRecords = await fetchAllRecords(goalAppId, goalWanted);
            goalMonthMap = buildGoalMonthMap(goalRecords, goalFieldMap);
          }
        } catch (e) { goalMonthMap = null; }

        setHint("契約件数データ取得中...");
        contractCountMap = null;
        contractLinkageForTarget = null;
        overallIntroRecords = null;
        overallIntroFieldMap = null;
        try {
          const contractAppId = await getAppIdByName(CONFIG.CONTRACT_FORM_APP_NAME);
          const contractFields = await getFields(contractAppId);
          const to = CONFIG.CONTRACT_FORM_FIELD_OVERRIDES || {};
          const ckw = CONFIG.CONTRACT_FORM_FIELD_KEYWORDS || {};
          const contractDateId = to.date || pickFieldUniqueId(contractFields, ckw.date);
          const contractClPersonId = to.clPerson != null && to.clPerson !== "" ? to.clPerson : pickFieldUniqueId(contractFields, ckw.clPerson);
          const contractApPersonId = pickContractApPersonFieldId(contractFields);
          const contractApptId = to.appt || pickFieldUniqueId(contractFields, ckw.appt);
          const contractClptId = to.clpt || pickFieldUniqueId(contractFields, ckw.clpt);
          const contractSalesId = to.sales || pickFieldUniqueId(contractFields, ckw.sales);
          const contractCustomerStatusId = to.customerStatus != null && to.customerStatus !== ""
            ? to.customerStatus
            : pickFieldUniqueId(contractFields, ckw.customerStatus);
          const contractIntroductionRouteId = to.introductionRoute != null && to.introductionRoute !== ""
            ? to.introductionRoute
            : pickFieldUniqueId(contractFields, ckw.introductionRoute);
          const regIds = pickContractRegNoFieldIds(contractFields);
          const contractCustNameId = pickContractCustomerNameFieldId(contractFields);
          if (contractDateId && (contractClPersonId || contractApPersonId || contractIntroductionRouteId || regIds.apptRegNo || regIds.clptRegNo)) {
            const contractWanted = [...new Set([
              contractDateId,
              contractClPersonId,
              contractApPersonId,
              contractIntroductionRouteId,
              contractApptId,
              contractClptId,
              regIds.apptRegNo,
              regIds.clptRegNo,
              contractSalesId,
              contractCustomerStatusId,
              contractCustNameId,
            ].filter(Boolean))].join(",");
            const contractRecords = await fetchAllRecords(contractAppId, contractWanted);
            if (contractClPersonId) {
              contractCountMap = buildContractCountMap(contractRecords, contractDateId, contractClPersonId, contractCustomerStatusId);
            }
            if (contractIntroductionRouteId) {
              overallIntroRecords = contractRecords;
              overallIntroFieldMap = {
                date: contractDateId,
                introductionRoute: contractIntroductionRouteId,
                appt: contractApptId,
                clpt: contractClptId,
                sales: contractSalesId,
              };
            }
            const idx = buildContractFormRegNoIndex(contractRecords, regIds.apptRegNo, regIds.clptRegNo);
            contractLinkageForTarget = {
              byAppt: idx.byAppt,
              byClpt: idx.byClpt,
              fm: {
                date: contractDateId,
                sales: contractSalesId,
                introductionRoute: contractIntroductionRouteId,
                clPerson: contractClPersonId,
                apPerson: contractApPersonId,
                customerName: contractCustNameId,
                apptRegNo: regIds.apptRegNo,
                clptRegNo: regIds.clptRegNo,
              },
            };
          }
        } catch (e) {
          contractCountMap = null;
          contractLinkageForTarget = null;
          overallIntroRecords = null;
          overallIntroFieldMap = null;
        }

        setHint("アポデータ取得中...");
        apoRecords = null;
        apoFieldMap = null;
        try {
          const apoAppId = await getAppIdByName(CONFIG.APO_APP_NAME);
          const apoFields = await getFields(apoAppId);
          const apoOver = CONFIG.APO_FIELD_OVERRIDES || {};
          const apoKw = CONFIG.APO_FIELD_KEYWORDS || {};
          const firstMeetingDateId = pickApoFirstMeetingDateFieldId(apoFields, apoOver);
          const apRankingFm = buildApoFieldMapForApRanking(apoFields);
          if (apRankingFm) {
            apoFieldMap = {
              salesperson: apRankingFm.salesperson,
              clPerson: apoOver.clPerson || pickFieldUniqueId(apoFields, apoKw.clPerson),
              apoType: apRankingFm.apoType,
              apoRank: apoOver.apoRank || pickFieldUniqueId(apoFields, apoKw.apoRank),
              date: apRankingFm.date,
              meetingDate: firstMeetingDateId || apRankingFm.date,
              estimateStatus: apRankingFm.estimateStatus,
              meetingPlace: apoOver.meetingPlace || pickFieldUniqueId(apoFields, apoKw.meetingPlace),
            };
          } else {
            const apoDateId = apoOver.date || pickFieldUniqueIdByExactCaption(apoFields, "初回商談実施日");
            apoFieldMap = {
              salesperson: apoOver.salesperson || pickApoAppSalespersonFieldId(apoFields),
              clPerson: apoOver.clPerson || pickFieldUniqueId(apoFields, apoKw.clPerson),
              apoType: apoOver.apoType || pickFieldUniqueId(apoFields, apoKw.apoType),
              apoRank: apoOver.apoRank || pickFieldUniqueId(apoFields, apoKw.apoRank),
              date: apoDateId,
              meetingDate: firstMeetingDateId || apoDateId,
              estimateStatus: apoOver.estimateStatus != null && apoOver.estimateStatus !== "" ? apoOver.estimateStatus : pickFieldUniqueId(apoFields, apoKw.estimateStatus),
              meetingPlace: apoOver.meetingPlace || pickFieldUniqueId(apoFields, apoKw.meetingPlace),
            };
          }
          if (apoFieldMap.salesperson && apoFieldMap.apoType) {
            const apoWanted = [...new Set([
              apoFieldMap.salesperson, apoFieldMap.clPerson, apoFieldMap.apoType, apoFieldMap.apoRank,
              apoFieldMap.date, apoFieldMap.meetingDate, apoFieldMap.estimateStatus, apoFieldMap.meetingPlace,
            ].filter(Boolean))].join(",");
            apoRecords = await fetchAllRecords(apoAppId, apoWanted);
          }
        } catch (e) { apoRecords = null; apoFieldMap = null; }

        setHint("稼働終了報告データ取得中...");
        workRecords = null;
        workFieldMap = null;
        try {
          const workAppId = await getAppIdByName(CONFIG.WORK_APP_NAME);
          const workFields = await getFields(workAppId);
          const wo = CONFIG.WORK_FIELD_OVERRIDES || {};
          const wk = CONFIG.WORK_FIELD_KEYWORDS || {};
          const wf = {
            salesperson: wo.salesperson || pickFieldUniqueId(workFields, wk.salesperson),
            date: wo.date || pickFieldUniqueId(workFields, wk.date),
            pingpongCount: wo.pingpongCount || pickFieldUniqueId(workFields, wk.pingpongCount),
            interviewCount: wo.interviewCount || pickFieldUniqueId(workFields, wk.interviewCount),
            apoGetCount: wo.apoGetCount || pickFieldUniqueId(workFields, wk.apoGetCount),
          };
          if (wf.salesperson && wf.date) {
            const workWanted = [wf.salesperson, wf.date, wf.pingpongCount, wf.interviewCount, wf.apoGetCount].filter(Boolean).join(",");
            workRecords = await fetchAllRecords(workAppId, workWanted);
            workFieldMap = wf;
          }
        } catch (e) {
          workRecords = null;
          workFieldMap = null;
        }

        setHint("期間候補生成中...");
        const { min, max } = scanMinMaxDate(records, fieldMap.date);
        monthOptions = buildMonthOptions(min, max);

        salesTaxMode = readTaxModeDefault();
        analysisPage = readAnalysisPageDefault();
        personalRangeMode = readPersonalRangeDefault();
        renderTaxRow();
        renderAnalysisTabs();

        monthSelect.innerHTML = monthOptions.map(o => `<option value="${o.key}">${o.label}</option>`).join("");
        if (monthOptions.length) monthSelect.value = pickDefaultMonthKeyFromOptions(monthOptions);
        personalRangeSelect.innerHTML = [
          { value: "this", label: "当月" },
          { value: "prev", label: "前月" },
          { value: "3m", label: "直近3ヶ月" },
          { value: "6m", label: "直近6ヶ月" },
          { value: "1y", label: "直近1年" },
        ].map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
        personalRangeSelect.value = personalRangeMode;
        renderSelectors();

        monthSelect.addEventListener("change", () => render());
        personalSelect.addEventListener("change", () => {
          selectedPersonalName = personalSelect.value || "";
          render();
        });
        personalRangeSelect.addEventListener("change", () => {
          writePersonalRange(personalRangeSelect.value || "6m");
          render();
        });
        search.addEventListener("input", () => render());
        render();
      } catch (e) {
        console.error(e);
        content.innerHTML = `<div class="apr-err">エラーが発生しました。権限/アプリ名/ネットワークをご確認ください。</div>`;
        setHint("エラー");
      }
    }

    function showError(e) {
      console.error(e);
      content.innerHTML = `<div class="apr-err">エラーが発生しました。</div>`;
      setHint("エラー");
    }

    refreshBtn.addEventListener("click", () => loadAndInit().catch(showError));
    pdfBtn.addEventListener("click", () => {
      document.body.classList.add("apr-print-sales-analysis");
      window.print();
      window.addEventListener("afterprint", function onAfterPrint() {
        window.removeEventListener("afterprint", onAfterPrint);
        document.body.classList.remove("apr-print-sales-analysis");
      });
    });
    toggleBtn.addEventListener("click", () => {
      const isVisible = body.style.display !== "none";
      setBodyVisible(!isVisible);
    });

    loadAndInit().catch(showError);
  }

  async function bootAwards() {
    ensureStyleOnce();

    const top = atPocket.portal.getContentTopSpaceElement();
    if (!top) return;

    const WIDGET_ID = SWITCHER.AWARDS_ROOT_ID();
    if (document.getElementById(WIDGET_ID)) return;

    const root = el("div", { id: WIDGET_ID, class: "apr-wrap" });
    const card = el("div", { class: "apr-card" });

    const head = el("div", { class: "apr-head" });
    head.appendChild(el("div", null,
      `<div class="apr-title">各表彰集計表</div><div class="apr-meta">表彰指標の集計ページ</div>`
    ));
    const actions = el("div", { class: "apr-actions" });
    const refreshBtn = el("button", { class: "apr-btn", type: "button" }, "再読み込み");
    const toggleBtn = el("button", { class: "apr-btn", type: "button" }, "非表示");
    actions.appendChild(refreshBtn);
    actions.appendChild(toggleBtn);
    head.appendChild(actions);

    const body = el("div", { class: "apr-body" });
    const modeRow = el("div", { class: "apr-row", style: "justify-content:flex-start" });
    const modeSelect = el("select", { class: "apr-select" });
    modeRow.appendChild(el("div", { class: "apr-hint" }, "表示項目"));
    modeRow.appendChild(modeSelect);
    const monthRow = el("div", { class: "apr-row", style: "justify-content:flex-start" });
    const monthSelect = el("select", { class: "apr-select" });
    monthRow.appendChild(el("div", { class: "apr-hint" }, "対象月"));
    monthRow.appendChild(monthSelect);
    const weekRow = el("div", { class: "apr-row", style: "justify-content:flex-start" });
    const weekSelect = el("select", { class: "apr-select" });
    weekRow.appendChild(el("div", { class: "apr-hint" }, "対象週"));
    weekRow.appendChild(weekSelect);
    weekRow.style.display = "none";
    const hint = el("div", { class: "apr-hint" }, "読み込み中...");
    const content = el("div", null, `<div class="apr-muted">読み込み中...</div>`);
    body.appendChild(modeRow);
    body.appendChild(monthRow);
    body.appendChild(weekRow);
    body.appendChild(hint);
    body.appendChild(content);

    card.appendChild(head);
    card.appendChild(body);
    root.appendChild(card);

    const s = ensureSwitcher(top);
    if (s && s.panels) s.panels.appendChild(root);
    applySwitcherViewIfPresent();

    function getVisibilityKey() {
      return `apRankingVisible:AWARDS`;
    }
    function setBodyVisible(visible) {
      body.style.display = visible ? "" : "none";
      toggleBtn.textContent = visible ? "非表示" : "表示";
      try { localStorage.setItem(getVisibilityKey(), visible ? "1" : "0"); } catch (e) {}
    }
    function readBodyVisibleDefault() {
      try {
        const v = localStorage.getItem(getVisibilityKey());
        if (v === "0") return false;
      } catch (e) {}
      return true;
    }
    function getAwardsMonthKey() {
      return `apAwardsMonth:${CONFIG.APO_APP_NAME}`;
    }
    function readAwardsMonthDefault() {
      try {
        return localStorage.getItem(getAwardsMonthKey()) || "";
      } catch (e) {}
      return "";
    }
    function writeAwardsMonth(v) {
      try { localStorage.setItem(getAwardsMonthKey(), v || ""); } catch (e) {}
    }
    function getAwardsWeekKey() {
      return `apAwardsWeek:${CONFIG.CONTRACT_FORM_APP_NAME}`;
    }
    function readAwardsWeekDefault() {
      try {
        return localStorage.getItem(getAwardsWeekKey()) || "";
      } catch (e) {}
      return "";
    }
    function writeAwardsWeek(v) {
      try { localStorage.setItem(getAwardsWeekKey(), v || ""); } catch (e) {}
    }
    function getAwardsDisplayModeKey() {
      return `apAwardsDisplayMode:${CONFIG.APO_APP_NAME}`;
    }
    function readAwardsDisplayModeDefault() {
      try {
        const v = localStorage.getItem(getAwardsDisplayModeKey());
        if (v === "tenka" || v === "weekly") return v;
      } catch (e) {}
      return "tenka";
    }
    function writeAwardsDisplayMode(v) {
      try { localStorage.setItem(getAwardsDisplayModeKey(), v || "tenka"); } catch (e) {}
    }

    let apPersonRows = [];
    let apRawCount = 0;
    let apAwardMonthLabel = "対象月なし";
    let apMonthKeys = [];
    let apMonthMapByKey = new Map();
    /** AP天下賞の条件を満たしたレコード（月キー → 行配列） */
    let apAwardRecordsByMonth = new Map();
    let clPersonRows = [];
    let clQualifiedCount = 0;
    let clAwardMonthLabel = "対象月なし";
    let clLoadError = "";
    let clPtRecords = null;
    let clPtFieldMap = null;
    let clContractCountMap = null;
    let clMonthOptions = [];
    let awardMonthKeys = [];
    let apWeeklyPersonRows = [];
    let apWeeklyRawCount = 0;
    let apWeeklyPeriodLabel = "対象週なし";
    let apWeeklyLoadError = "";
    let apWeeklyWeekMapByKey = new Map();
    let apWeeklyWeekOptions = [];
    let clWeeklyPersonRows = [];
    let clWeeklyRawCount = 0;
    let clWeeklyPeriodLabel = "対象週なし";
    let clWeeklyLoadError = "";
    let clWeeklyWeekMapByKey = new Map();
    let clWeeklyWeekOptions = [];
    let weeklyWeekOptions = [];
    let selectedMonthKey = readAwardsMonthDefault();
    let selectedWeekKey = readAwardsWeekDefault();
    let displayMode = readAwardsDisplayModeDefault(); // tenka | weekly

    function renderModeSelector() {
      modeSelect.innerHTML = "";
      const opts = [
        { key: "tenka", label: "AP天下賞 / CL天下賞" },
        { key: "weekly", label: "AP週間表彰 / CL週間表彰" },
      ];
      for (const it of opts) {
        const o = document.createElement("option");
        o.value = it.key;
        o.textContent = it.label;
        if (it.key === displayMode) o.selected = true;
        modeSelect.appendChild(o);
      }
    }

    function renderMonthSelector() {
      monthSelect.innerHTML = "";
      for (const key of awardMonthKeys) {
        const yy = Number(key.slice(0, 4));
        const mm = Number(key.slice(5, 7));
        const o = document.createElement("option");
        o.value = key;
        o.textContent = `${yy}年${mm}月`;
        if (key === selectedMonthKey) o.selected = true;
        monthSelect.appendChild(o);
      }
      monthRow.style.display = (displayMode === "tenka" && awardMonthKeys.length) ? "" : "none";
    }

    function renderWeekSelector() {
      weekSelect.innerHTML = "";
      for (const wo of weeklyWeekOptions) {
        const o = document.createElement("option");
        o.value = wo.key;
        o.textContent = wo.label;
        if (wo.key === selectedWeekKey) o.selected = true;
        weekSelect.appendChild(o);
      }
      weekRow.style.display = (displayMode === "weekly" && weeklyWeekOptions.length) ? "" : "none";
    }

    function mergeAwardMonthKeys(apKeys, clKeys) {
      const s = new Set();
      for (const k of apKeys || []) s.add(k);
      for (const k of clKeys || []) s.add(k);
      return Array.from(s).sort((a, b) => b.localeCompare(a));
    }

    function mergeWeekOptions(apOpts, clOpts) {
      const m = new Map();
      for (const wo of apOpts || []) {
        if (wo && wo.key && !m.has(wo.key)) m.set(wo.key, wo);
      }
      for (const wo of clOpts || []) {
        if (wo && wo.key && !m.has(wo.key)) m.set(wo.key, wo);
      }
      return Array.from(m.values()).sort((a, b) => String(b.key).localeCompare(String(a.key)));
    }

    function computeClAwardForMonth(monthKey) {
      if (!monthKey || !clPtRecords || !clPtFieldMap || !clMonthOptions.length) {
        return { rows: [], qualifiedCount: 0 };
      }
      const period = buildPeriodFromMonthKey(clMonthOptions, monthKey);
      if (!period) return { rows: [], qualifiedCount: 0 };

      const ptRes = aggregate(clPtRecords, clPtFieldMap, period);
      const contractSums = sumContractCountInPeriod(clContractCountMap, period, clMonthOptions);
      const minContracts = Number(CONFIG.CL_AWARD_MIN_CONTRACT_COUNT || 0);
      const minPt = Number(CONFIG.CL_AWARD_MIN_PT || 0);

      const qualified = [];
      for (const it of ptRes.items || []) {
        const pt = Number(it.pt || 0);
        const contractCount = Number(contractSums.get(it.name) || 0);
        if (contractCount >= minContracts && pt >= minPt) {
          qualified.push({ name: it.name, pt, contractCount });
        }
      }
      qualified.sort((a, b) =>
        (b.pt - a.pt) ||
        (b.contractCount - a.contractCount) ||
        a.name.localeCompare(b.name, "ja")
      );

      return { rows: qualified, qualifiedCount: qualified.length };
    }

    function applySelectedMonthAndRender() {
      const monthMap = selectedMonthKey ? (apMonthMapByKey.get(selectedMonthKey) || new Map()) : new Map();
      const personRows = Array.from(monthMap.entries())
        .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], "ja"));
      apPersonRows = personRows;
      apRawCount = Array.from(monthMap.values()).reduce((s, n) => s + (n || 0), 0);
      const clResult = computeClAwardForMonth(selectedMonthKey);
      clPersonRows = clResult.rows;
      clQualifiedCount = clResult.qualifiedCount;
      if (selectedMonthKey) {
        const yy = Number(selectedMonthKey.slice(0, 4));
        const mm = Number(selectedMonthKey.slice(5, 7));
        apAwardMonthLabel = `${yy}年${mm}月度`;
        clAwardMonthLabel = `${yy}年${mm}月度`;
      } else {
        apAwardMonthLabel = "対象月なし";
        clAwardMonthLabel = "対象月なし";
      }
      renderAwardsSummary();
    }

    function applySelectedWeekAndRender() {
      const apWeekMap = selectedWeekKey ? (apWeeklyWeekMapByKey.get(selectedWeekKey) || new Map()) : new Map();
      apWeeklyPersonRows = Array.from(apWeekMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name, "ja"));
      apWeeklyRawCount = apWeeklyPersonRows.length;
      const clWeekMap = selectedWeekKey ? (clWeeklyWeekMapByKey.get(selectedWeekKey) || new Map()) : new Map();
      clWeeklyPersonRows = Array.from(clWeekMap.entries())
        .map(([name, pt]) => ({ name, pt }))
        .sort((a, b) => (b.pt - a.pt) || a.name.localeCompare(b.name, "ja"));
      clWeeklyRawCount = clWeeklyPersonRows.length;
      const hit = (weeklyWeekOptions || []).find((x) => x.key === selectedWeekKey);
      apWeeklyPeriodLabel = hit ? hit.label : "対象週なし";
      clWeeklyPeriodLabel = hit ? hit.label : "対象週なし";
      renderAwardsSummary();
    }

    function escHtml(s) {
      return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function buildApAwardRecordsTableHtml(rows) {
      if (!rows || !rows.length) {
        return `<div class="apr-muted" style="margin-top:8px;font-size:12px;">この月の対象レコードはありません。</div>`;
      }
      const sorted = rows.slice().sort((a, b) => {
        const pa = String(a.person || "");
        const pb = String(b.person || "");
        const personCmp = pa.localeCompare(pb, "ja");
        if (personCmp !== 0) return personCmp;
        const da = String(a.dateLabel || "");
        const db = String(b.dateLabel || "");
        return da.localeCompare(db, "ja");
      });
      let body = "";
      for (let i = 0; i < sorted.length; i++) {
        const it = sorted[i];
        body += `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${escHtml(it.estimateStatus)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${escHtml(it.person)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${escHtml(it.apoType)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;white-space:nowrap;">${escHtml(it.dateLabel)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${escHtml(it.meetingPlace)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${escHtml(String(it.leadTime))}</td>
        </tr>`;
      }
      return `
        <details style="margin-top:10px;">
          <summary style="cursor:pointer; font-size:12px; font-weight:700;">対象レコード一覧を表示（${sorted.length.toLocaleString("ja-JP")}件）</summary>
          <div style="max-height:min(360px,50vh);overflow:auto;border:1px solid #e2e8f0;border-radius:8px;background:#fff;margin-top:6px;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
              <thead>
                <tr style="background:#f1f5f9;position:sticky;top:0;">
                  <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0;">商談結果</th>
                  <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0;">AP担当者</th>
                  <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0;">アポ種別</th>
                  <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0;">アポ取得日</th>
                  <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0;">商談場所</th>
                  <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #e2e8f0;">商談化リードタイム</th>
                </tr>
              </thead>
              <tbody>${body}</tbody>
            </table>
          </div>
        </details>`;
    }

    function renderAwardsSummary() {
      if (displayMode === "weekly") {
        let apWeeklyLines = "";
        for (let i = 0; i < (apWeeklyPersonRows || []).length; i++) {
          const row = apWeeklyPersonRows[i];
          apWeeklyLines += `<div>${row.name} / ${numFmt(row.count)}件</div>`;
        }
        if (!apWeeklyLines) {
          apWeeklyLines = apWeeklyLoadError
            ? `<div class="apr-muted">${apWeeklyLoadError}</div>`
            : `<div class="apr-muted">条件達成者がいません。</div>`;
        }
        let clWeeklyLines = "";
        for (let i = 0; i < (clWeeklyPersonRows || []).length; i++) {
          const row = clWeeklyPersonRows[i];
          clWeeklyLines += `<div>${row.name} / PT${numFmt(row.pt)}</div>`;
        }
        if (!clWeeklyLines) {
          clWeeklyLines = clWeeklyLoadError
            ? `<div class="apr-muted">${clWeeklyLoadError}</div>`
            : `<div class="apr-muted">条件達成者がいません。</div>`;
        }
        content.innerHTML = `
          <div style="display:grid; gap:12px;">
            <div style="border:1px solid #e5e7eb; border-radius:10px; padding:10px 12px;">
              <div><strong>AP週間表彰（${apWeeklyPeriodLabel}）</strong></div>
              <div style="margin-top:6px; display:grid; gap:4px;">${apWeeklyLines}</div>
            </div>
            <div style="border:1px solid #e5e7eb; border-radius:10px; padding:10px 12px;">
              <div><strong>CL週間表彰（${clWeeklyPeriodLabel}）</strong></div>
              <div style="margin-top:6px; display:grid; gap:4px;">${clWeeklyLines}</div>
            </div>
          </div>
          <div class="apr-muted" style="margin-top:8px;">
            AP週間表彰 条件: 契約件数>=2件 / 顧客ステータスがキャンセル以外 / 導入経緯=${getApoFilterLabel(CONFIG.APO_FILTER_VALUES)}
          </div>
          <div class="apr-muted" style="margin-top:4px;">
            CL週間表彰 条件: 週間PT合計>=${numFmt(CONFIG.CL_WEEKLY_MIN_PT)}
          </div>
        `;
        hint.textContent = `週間集計完了: AP条件達成${apWeeklyRawCount.toLocaleString("ja-JP")}名 / CL条件達成${clWeeklyRawCount.toLocaleString("ja-JP")}名`;
        return;
      }

      const apTop2 = (apPersonRows || []).slice(0, 2);
      let apLines = "";
      for (let i = 0; i < apTop2.length; i++) {
        const [person, count] = apTop2[i];
        apLines += `<div>${i + 1}位: ${escHtml(person)} / ${numFmt(count)}件</div>`;
      }
      if (!apLines) apLines = `<div class="apr-muted">対象データがありません。</div>`;

      const apAwardDetailRows = selectedMonthKey ? (apAwardRecordsByMonth.get(selectedMonthKey) || []) : [];
      const apAwardTableHtml = buildApAwardRecordsTableHtml(apAwardDetailRows);

      const clTop2 = (clPersonRows || []).slice(0, 2);
      let clLines = "";
      for (let i = 0; i < clTop2.length; i++) {
        const it = clTop2[i];
        clLines += `<div>${i + 1}位: ${escHtml(it.name)} / 契約${numFmt(it.contractCount)}件 / PT${numFmt(it.pt)}</div>`;
      }
      if (!clLines) {
        clLines = clLoadError
          ? `<div class="apr-muted">${clLoadError}</div>`
          : `<div class="apr-muted">条件達成者がいません。</div>`;
      }

      content.innerHTML = `
        <div style="display:grid; gap:12px;">
          <div style="border:1px solid #dbeafe; border-radius:10px; padding:10px 12px; background:#f8fbff;">
            <div><strong>AP天下賞（${apAwardMonthLabel}）</strong></div>
            <div style="margin-top:6px; display:grid; gap:4px;">${apLines}</div>
            ${apAwardTableHtml}
          </div>
          <div style="border:1px solid #e5e7eb; border-radius:10px; padding:10px 12px;">
            <div><strong>CL天下賞（${clAwardMonthLabel}）</strong></div>
            <div style="margin-top:6px; display:grid; gap:4px;">${clLines}</div>
          </div>
        </div>
        <div class="apr-muted" style="margin-top:8px;">
          AP天下賞 条件: アポ種別=${getApoFilterLabel(CONFIG.APO_FILTER_VALUES)} / 片クロor両クロ=両クロ / 商談場所=宅内テーブル商談 / 商談化リードタイム<=14
        </div>
        <div class="apr-muted" style="margin-top:4px;">
          CL天下賞 条件: 契約件数>=${numFmt(CONFIG.CL_AWARD_MIN_CONTRACT_COUNT)}件 かつ PT>=${numFmt(CONFIG.CL_AWARD_MIN_PT)}
        </div>
      `;
      hint.textContent = `集計完了: AP対象${apRawCount.toLocaleString("ja-JP")}件 / CL条件達成${clQualifiedCount.toLocaleString("ja-JP")}名`;
    }

    async function loadAndRender() {
      hint.textContent = "アプリ情報取得中...";
      content.innerHTML = `<div class="apr-muted">データ取得中...</div>`;
      apAwardRecordsByMonth = new Map();

      const appId = await getAppIdByName(CONFIG.APO_APP_NAME);
      const fields = await getFields(appId);
      const ao = CONFIG.AWARDS_FIELD_OVERRIDES || {};
      const akw = CONFIG.AWARDS_FIELD_KEYWORDS || {};
      const fallbackApo = CONFIG.APO_FIELD_OVERRIDES || {};
      const fallbackApoKw = CONFIG.APO_FIELD_KEYWORDS || {};

      const fieldMap = {
        salesperson: ao.salesperson || fallbackApo.salesperson || pickFieldUniqueId(fields, akw.salesperson || fallbackApoKw.salesperson),
        apoType: ao.apoType || fallbackApo.apoType || pickFieldUniqueId(fields, akw.apoType || fallbackApoKw.apoType),
        date: ao.date || fallbackApo.date || pickFieldUniqueId(fields, akw.date || fallbackApoKw.date),
        estimateStatus: ao.estimateStatus || fallbackApo.estimateStatus || pickFieldUniqueId(fields, akw.estimateStatus || fallbackApoKw.estimateStatus),
        closeType: ao.closeType || pickFieldUniqueId(fields, akw.closeType),
        meetingPlace: ao.meetingPlace || pickFieldUniqueId(fields, akw.meetingPlace),
        leadTime: ao.leadTime || pickFieldUniqueId(fields, akw.leadTime),
      };

      if (!fieldMap.salesperson || !fieldMap.apoType || !fieldMap.date || !fieldMap.closeType || !fieldMap.meetingPlace || !fieldMap.leadTime) {
        content.innerHTML = `
          <div class="apr-err">
            AP天下賞の集計に必要なフィールド特定に失敗しました。<br>
            ・AP担当者（担当者別集計）<br>
            ・アポ種別（${getApoFilterLabel(CONFIG.APO_FILTER_VALUES)} 判定）<br>
            ・アポ取得日（有効データ判定）<br>
            ・片クロor両クロ（両クロ判定）<br>
            ・商談場所（宅内テーブル商談判定）<br>
            ・商談化リードタイム（14以内判定）<br><br>
            対応方法：ranking_pt_dashboard.js の CONFIG.AWARDS_FIELD_OVERRIDES に uniqueId を設定してください。
          </div>
        `;
        hint.textContent = "設定が必要です";
        return;
      }

      const wanted = [fieldMap.salesperson, fieldMap.apoType, fieldMap.date, fieldMap.estimateStatus, fieldMap.closeType, fieldMap.meetingPlace, fieldMap.leadTime]
        .filter(Boolean)
        .join(",");
      hint.textContent = "レコード取得中...";
      const records = await fetchAllRecords(appId, wanted);

      const apAwardByMonth = new Map(); // key: YYYY-MM -> Map(person -> count)
      const apAwardRecordsByMonthLocal = new Map(); // key: YYYY-MM -> Array<detail row>
      const apoTypeFilterValues = getApoFilterValues(CONFIG.APO_FILTER_VALUES);

      for (const r of records || []) {
        const recObj = r && r.record ? r.record : {};
        const person = normalizePersonName(extractValue(recObj[fieldMap.salesperson]));
        if (!person) continue;
        const apoType = String(extractValue(recObj[fieldMap.apoType]) || "").trim();
        if (!isApoTypeMatched(apoType, apoTypeFilterValues)) continue;

        const closeType = String(extractValue(recObj[fieldMap.closeType]) || "").trim();
        if (closeType !== "両クロ") continue;

        const meetingPlace = String(extractValue(recObj[fieldMap.meetingPlace]) || "").trim();
        if (meetingPlace !== "宅内テーブル商談") continue;

        const leadRaw = extractValue(recObj[fieldMap.leadTime]);
        if (leadRaw === null || leadRaw === undefined || String(leadRaw).trim() === "") continue;
        const leadTime = parseNumber(leadRaw);
        if (leadTime > 14) continue;

        const d = parseDate(recObj[fieldMap.date]);
        if (!d) continue;
        const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (!apAwardByMonth.has(mKey)) apAwardByMonth.set(mKey, new Map());
        const per = apAwardByMonth.get(mKey);
        per.set(person, (per.get(person) || 0) + 1);

        let recordId = "";
        if (r && r.id != null && String(r.id).trim() !== "") recordId = String(r.id);
        else if (recObj && recObj.id != null && String(recObj.id).trim() !== "") recordId = String(recObj.id);
        if (!apAwardRecordsByMonthLocal.has(mKey)) apAwardRecordsByMonthLocal.set(mKey, []);
        apAwardRecordsByMonthLocal.get(mKey).push({
          recordId,
          person,
          apoType,
          dateLabel: fmtYMD(d),
          estimateStatus: fieldMap.estimateStatus
            ? String(extractValue(recObj[fieldMap.estimateStatus]) || "").trim()
            : "",
          meetingPlace,
          leadTime,
        });
      }

      apAwardRecordsByMonth = apAwardRecordsByMonthLocal;

      clLoadError = "";
      clPtRecords = null;
      clPtFieldMap = null;
      clContractCountMap = null;
      clMonthOptions = [];
      try {
        const clAppId = await getAppIdByName(CONFIG.APP_NAME);
        const clFields = await getFields(clAppId);
        const over = CONFIG.FIELD_OVERRIDES || {};
        const kw = CONFIG.FIELD_KEYWORDS || {};
        clPtFieldMap = {
          salesperson: over.salesperson || pickFieldUniqueId(clFields, kw.salesperson),
          pt: over.pt || pickFieldUniqueId(clFields, kw.pt),
          date: over.date || pickFieldUniqueId(clFields, kw.date),
        };
        if (!clPtFieldMap.salesperson || !clPtFieldMap.date || !clPtFieldMap.pt) {
          clLoadError = "CL天下賞の集計に必要な担当者/日付/PTフィールドを特定できません。";
        } else {
          const clWanted = [clPtFieldMap.salesperson, clPtFieldMap.pt, clPtFieldMap.date].join(",");
          clPtRecords = await fetchAllRecords(clAppId, clWanted);
          const mm = scanMinMaxDate(clPtRecords, clPtFieldMap.date);
          clMonthOptions = buildMonthOptions(mm.min, mm.max);
        }

        const contractAppId = await getAppIdByName(CONFIG.CONTRACT_FORM_APP_NAME);
        const contractFields = await getFields(contractAppId);
        const to = CONFIG.CONTRACT_FORM_FIELD_OVERRIDES || {};
        const contractDateId = to.date || pickFieldUniqueId(contractFields, CONFIG.CONTRACT_FORM_FIELD_KEYWORDS.date);
        const contractClPersonId = to.clPerson != null && to.clPerson !== ""
          ? to.clPerson
          : pickFieldUniqueId(contractFields, CONFIG.CONTRACT_FORM_FIELD_KEYWORDS.clPerson);
        const contractCustomerStatusId = to.customerStatus != null && to.customerStatus !== ""
          ? to.customerStatus
          : pickFieldUniqueId(contractFields, CONFIG.CONTRACT_FORM_FIELD_KEYWORDS.customerStatus);
        if (!contractDateId || !contractClPersonId) {
          clLoadError = clLoadError || "CL天下賞の契約件数集計に必要な初回契約日（または日付）/CL担当者フィールドを特定できません。";
        } else {
          const contractWanted = [contractDateId, contractClPersonId, contractCustomerStatusId].filter(Boolean).join(",");
          const contractRecords = await fetchAllRecords(contractAppId, contractWanted);
          clContractCountMap = buildContractCountMap(contractRecords, contractDateId, contractClPersonId, contractCustomerStatusId);
        }
      } catch (e) {
        clLoadError = "CL天下賞データ取得でエラーが発生しました。";
        clPtRecords = null;
        clPtFieldMap = null;
        clContractCountMap = null;
        clMonthOptions = [];
      }

      apWeeklyLoadError = "";
      apWeeklyWeekMapByKey = new Map();
      apWeeklyWeekOptions = [];
      try {
        const contractAppId = await getAppIdByName(CONFIG.CONTRACT_FORM_APP_NAME);
        const contractFields = await getFields(contractAppId);
        const to = CONFIG.CONTRACT_FORM_FIELD_OVERRIDES || {};
        const weeklyDateId = to.date || pickFieldUniqueId(contractFields, CONFIG.CONTRACT_FORM_FIELD_KEYWORDS.date);
        const weeklyApPersonId = to.apPerson != null && to.apPerson !== ""
          ? to.apPerson
          : pickFieldUniqueId(contractFields, CONFIG.CONTRACT_FORM_FIELD_KEYWORDS.apPerson);
        const weeklyCustomerStatusId = to.customerStatus != null && to.customerStatus !== ""
          ? to.customerStatus
          : pickFieldUniqueId(contractFields, CONFIG.CONTRACT_FORM_FIELD_KEYWORDS.customerStatus);
        const weeklyIntroductionRouteId = to.introductionRoute != null && to.introductionRoute !== ""
          ? to.introductionRoute
          : pickFieldUniqueId(contractFields, CONFIG.CONTRACT_FORM_FIELD_KEYWORDS.introductionRoute);

        const apPersonField = getFieldByUniqueId(contractFields, weeklyApPersonId);
        const apPersonCaption = String(apPersonField && apPersonField.caption ? apPersonField.caption : "").toLowerCase();
        const pickedPtLikeField = apPersonCaption.includes("appt") || apPersonCaption.includes("ap pt") || apPersonCaption.includes("clpt") || apPersonCaption === "pt";
        const resolvedWeeklyApPersonId = pickedPtLikeField
          ? pickFieldUniqueId(contractFields, ["AP担当者", "AP 担当者", "アポインター", "アポ担当者"])
          : weeklyApPersonId;

        if (!weeklyDateId || !resolvedWeeklyApPersonId || !weeklyCustomerStatusId || !weeklyIntroductionRouteId) {
          apWeeklyLoadError = "AP週間表彰の集計に必要な初回契約日（または日付）/AP担当者/顧客ステータス/導入経緯のフィールドを特定できません。";
        } else {
          const weeklyWanted = [weeklyDateId, resolvedWeeklyApPersonId, weeklyCustomerStatusId, weeklyIntroductionRouteId].join(",");
          const weeklyRecords = await fetchAllRecords(contractAppId, weeklyWanted);
          const mm = scanMinMaxDate(weeklyRecords, weeklyDateId);
          apWeeklyWeekOptions = buildWeekOptions(mm.min, mm.max);

          const rawByWeek = new Map(); // key -> Map(person -> count)
          const apoTypeFilterValuesWeekly = getApoFilterValues(CONFIG.APO_FILTER_VALUES);
          for (const r of weeklyRecords || []) {
            const recObj = r && r.record ? r.record : {};
            const d = parseDate(recObj[weeklyDateId]);
            if (!d) continue;
            const person = normalizePersonName(extractValue(recObj[resolvedWeeklyApPersonId]));
            if (!person) continue;
            const status = String(extractValue(recObj[weeklyCustomerStatusId]) || "").trim();
            if (status.includes("キャンセル")) continue;
            const intro = String(extractValue(recObj[weeklyIntroductionRouteId]) || "").trim();
            if (!isApoTypeMatched(intro, apoTypeFilterValuesWeekly)) continue;
            const mon = getMondayOfWeek(d);
            const weekKey = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, "0")}-${String(mon.getDate()).padStart(2, "0")}`;
            if (!rawByWeek.has(weekKey)) rawByWeek.set(weekKey, new Map());
            const per = rawByWeek.get(weekKey);
            per.set(person, (per.get(person) || 0) + 1);
          }

          // 条件: 週間で2件以上契約になったアポインター
          rawByWeek.forEach((perMap, weekKey) => {
            const qualified = new Map();
            perMap.forEach((count, person) => {
              if ((count || 0) >= 2) qualified.set(person, count);
            });
            apWeeklyWeekMapByKey.set(weekKey, qualified);
          });
        }
      } catch (e) {
        apWeeklyLoadError = "AP週間表彰データ取得でエラーが発生しました。";
        apWeeklyWeekMapByKey = new Map();
        apWeeklyWeekOptions = [];
      }

      clWeeklyLoadError = "";
      clWeeklyWeekMapByKey = new Map();
      clWeeklyWeekOptions = [];
      try {
        const ptAppId = await getAppIdByName(CONFIG.APP_NAME);
        const ptFields = await getFields(ptAppId);
        const over = CONFIG.FIELD_OVERRIDES || {};
        const kw = CONFIG.FIELD_KEYWORDS || {};
        const weeklyClPersonId = over.salesperson || pickFieldUniqueId(ptFields, kw.salesperson);
        const weeklyClPtId = over.pt || pickFieldUniqueId(ptFields, kw.pt);
        const weeklyClDateId = over.date || pickFieldUniqueId(ptFields, kw.date);
        const weeklyRegNoId = over.regNo || pickFieldUniqueId(ptFields, kw.regNo);

        if (!weeklyClPersonId || !weeklyClPtId || !weeklyClDateId || !weeklyRegNoId) {
          clWeeklyLoadError = "CL週間表彰の集計に必要な営業担当/PT/日付/登録番号のフィールドを特定できません。";
        } else {
          const weeklyWanted = [weeklyClPersonId, weeklyClPtId, weeklyClDateId, weeklyRegNoId].join(",");
          const weeklyPtRecords = await fetchAllRecords(ptAppId, weeklyWanted);
          const mm = scanMinMaxDate(weeklyPtRecords, weeklyClDateId);
          clWeeklyWeekOptions = buildWeekOptions(mm.min, mm.max);

          const sumByWeek = new Map(); // key -> Map(person -> ptSum)
          for (const r of weeklyPtRecords || []) {
            const recObj = r && r.record ? r.record : {};
            const d = parseDate(recObj[weeklyClDateId]);
            if (!d) continue;
            const person = normalizePersonName(extractValue(recObj[weeklyClPersonId]));
            if (!person) continue;
            const regNo = String(extractValue(recObj[weeklyRegNoId]) || "").trim().toUpperCase();
            if (!regNo.includes("CLPT")) continue;
            const pt = parseNumber(extractValue(recObj[weeklyClPtId]));
            if (!isFinite(pt) || pt <= 0) continue;

            const mon = getMondayOfWeek(d);
            const weekKey = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, "0")}-${String(mon.getDate()).padStart(2, "0")}`;
            if (!sumByWeek.has(weekKey)) sumByWeek.set(weekKey, new Map());
            const per = sumByWeek.get(weekKey);
            per.set(person, (per.get(person) || 0) + pt);
          }

          const minPt = Number(CONFIG.CL_WEEKLY_MIN_PT || 0);
          sumByWeek.forEach((perMap, weekKey) => {
            const qualified = new Map();
            perMap.forEach((ptSum, person) => {
              if ((ptSum || 0) >= minPt) qualified.set(person, ptSum);
            });
            clWeeklyWeekMapByKey.set(weekKey, qualified);
          });
        }
      } catch (e) {
        clWeeklyLoadError = "CL週間表彰データ取得でエラーが発生しました。";
        clWeeklyWeekMapByKey = new Map();
        clWeeklyWeekOptions = [];
      }

      apMonthMapByKey = apAwardByMonth;
      apMonthKeys = Array.from(apAwardByMonth.keys()).sort((a, b) => b.localeCompare(a));
      awardMonthKeys = mergeAwardMonthKeys(apMonthKeys, clMonthOptions.map((o) => o.key));
      weeklyWeekOptions = mergeWeekOptions(apWeeklyWeekOptions, clWeeklyWeekOptions);
      if (!selectedMonthKey || !awardMonthKeys.includes(selectedMonthKey)) {
        selectedMonthKey = pickDefaultMonthKeyFromOptions(awardMonthKeys.map((k) => ({ key: k })));
      }
      if (!selectedWeekKey || !weeklyWeekOptions.some((x) => x.key === selectedWeekKey)) {
        selectedWeekKey = pickDefaultAwardsWeekKey(weeklyWeekOptions);
      }
      renderMonthSelector();
      renderWeekSelector();
      if (displayMode === "weekly") applySelectedWeekAndRender();
      else applySelectedMonthAndRender();
    }

    function showError(e) {
      console.error(e);
      content.innerHTML = `<div class="apr-err">エラーが発生しました。権限/アプリ名/ネットワーク/設定をご確認ください。</div>`;
      hint.textContent = "エラー";
    }

    refreshBtn.addEventListener("click", () => loadAndRender().catch(showError));
    toggleBtn.addEventListener("click", () => {
      const isVisible = body.style.display !== "none";
      setBodyVisible(!isVisible);
    });
    monthSelect.addEventListener("change", () => {
      selectedMonthKey = monthSelect.value || "";
      writeAwardsMonth(selectedMonthKey);
      applySelectedMonthAndRender();
    });
    weekSelect.addEventListener("change", () => {
      selectedWeekKey = weekSelect.value || "";
      writeAwardsWeek(selectedWeekKey);
      applySelectedWeekAndRender();
    });
    modeSelect.addEventListener("change", () => {
      displayMode = modeSelect.value || "tenka";
      writeAwardsDisplayMode(displayMode);
      renderMonthSelector();
      renderWeekSelector();
      if (displayMode === "weekly") applySelectedWeekAndRender();
      else applySelectedMonthAndRender();
    });

    setBodyVisible(readBodyVisibleDefault());
    renderModeSelector();
    loadAndRender().catch(showError);
  }

  atPocket.events.on("portal.index.show", function () {
    boot();
    bootApo();
    bootSalesAnalysis();
    bootAwards();
    ensureSalesHubLayout();
    applySwitcherViewIfPresent();
  });
})();