/**
 * 営業進捗（目標に対する達成率）の集計（タスクK）。
 *
 * ここは純粋関数だけを置く。@pocket の呼び出しも列の解決も行わない。
 * 呼び出し側が「氏名で正規化済みの目標行・実績行」を渡す。
 *
 * ■ 指標
 * PT とアポのみ。成約件数は目標が入力されていないため対象外。
 *
 * ■ 突合について
 * 目標と実績は氏名文字列で突合する。正規化は既存の normApClStaffName に
 * 一本化しており、このファイルでは新しい正規化を定義しない。渡ってくる
 * staffName は正規化済みである前提。
 *
 * ■ 個人成績の扱い（タスクL で方針変更）
 * タスクK では本人以外の個人成績を返さない方針だったが、利用者が全員社員で
 * あることから、既存の /sales-dashboard と同じく全社員に公開する方針へ
 * 変更した。支社別の行は担当者ごとの内訳（members）を持つ。
 * 認証と名簿への紐付けが必須である点は変わらない。
 */

/** 所属が決まらない行の既定の寄せ先。支社別では「その他」を渡して使う */
export const SALES_PROGRESS_UNASSIGNED_GROUP = "目標未登録";

/** 目標1行（担当者ごと・対象月ぶん） */
export type SalesTargetRow = {
  /** normApClStaffName 済み */
  staffName: string;
  /** 振り分け済みの支社名（その他を含む） */
  branch: string;
  apoCount: number;
  pt: number;
};

/** 実績（担当者ごとに集計済み） */
export type SalesActualRow = {
  /** normApClStaffName 済み */
  staffName: string;
  apoCount: number;
  pt: number;
};

export type SalesProgressMetric = {
  actual: number;
  target: number;
  /** 目標が0または未設定なら null。画面では「—」を出す（0除算を避ける） */
  ratePercent: number | null;
  /** バーの塗り幅 0〜100。100%超でも振り切れないよう頭打ちにする */
  barPercent: number;
};

export type SalesProgressMetrics = {
  pt: SalesProgressMetric;
  apo: SalesProgressMetric;
};

/** 指標の切り替え。画面上部の PT / アポ に対応する */
export type SalesProgressMetricKey = "pt" | "apo";

/** 支社の内訳1人分（タスクL） */
export type SalesProgressStaffRow = {
  staffName: string;
  metrics: SalesProgressMetrics;
};

export type SalesProgressGroupRow = {
  label: string;
  /** このグループに属する人数（目標または実績があった人） */
  memberCount: number;
  metrics: SalesProgressMetrics;
  /** 担当者ごとの内訳。既定は PT 実績の降順 */
  members: SalesProgressStaffRow[];
};

export type SalesProgressMatchSummary = {
  /** 目標はあるが実績が1件も無い担当者数 */
  targetsWithoutActual: number;
  /** 実績はあるが目標が無い担当者数（表記ゆれ・未登録の疑い） */
  actualsWithoutTarget: number;
  /** 目標側の担当者名が空で捨てた行数 */
  targetRowsWithoutName: number;
  /** 実績側の担当者名が空で捨てた行数 */
  actualRowsWithoutName: number;
};

function safeNumber(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/**
 * 達成率。目標が0以下・未設定なら null を返す（画面は「—」）。
 * 小数第1位まで（136.9 など）。
 */
export function computeAchievement(
  actualRaw: number,
  targetRaw: number,
): SalesProgressMetric {
  const actual = safeNumber(actualRaw);
  const target = safeNumber(targetRaw);

  if (target <= 0) {
    return { actual, target, ratePercent: null, barPercent: 0 };
  }

  const ratePercent = Math.round((actual / target) * 1000) / 10;
  // 100%超でバーが枠から出ないようにする。数値は ratePercent 側で出す
  const barPercent = Math.min(100, Math.max(0, ratePercent));
  return { actual, target, ratePercent, barPercent };
}

type Totals = { pt: number; apoCount: number };

const ZERO: Totals = { pt: 0, apoCount: 0 };

export function buildSalesProgressMetrics(
  actual: Totals,
  target: Totals,
): SalesProgressMetrics {
  return {
    pt: computeAchievement(actual.pt, target.pt),
    apo: computeAchievement(actual.apoCount, target.apoCount),
  };
}

function sumInto(acc: Totals, row: Totals): void {
  acc.pt += safeNumber(row.pt);
  acc.apoCount += safeNumber(row.apoCount);
}

/**
 * 本人の数字だけを取り出す。
 * 目標が無い場合も実績は返す（達成率は「—」になる）。
 */
export function pickSelfSalesProgress(
  targets: SalesTargetRow[],
  actuals: SalesActualRow[],
  selfStaffName: string,
): {
  metrics: SalesProgressMetrics;
  /** 対象月の目標が1件も無いか */
  targetMissing: boolean;
} {
  const self = selfStaffName.trim();
  if (!self) {
    return {
      metrics: buildSalesProgressMetrics({ ...ZERO }, { ...ZERO }),
      targetMissing: true,
    };
  }

  const target = { ...ZERO };
  let targetFound = false;
  for (const row of targets) {
    if (row.staffName !== self) continue;
    targetFound = true;
    sumInto(target, row);
  }

  const actual = { ...ZERO };
  for (const row of actuals) {
    if (row.staffName !== self) continue;
    sumInto(actual, row);
  }

  return {
    metrics: buildSalesProgressMetrics(actual, target),
    targetMissing: !targetFound,
  };
}

/** 全社合計。人数によらず常に返す（個人を特定できないため） */
export function buildCompanySalesProgress(
  targets: SalesTargetRow[],
  actuals: SalesActualRow[],
): SalesProgressMetrics {
  const target = { ...ZERO };
  for (const row of targets) sumInto(target, row);
  const actual = { ...ZERO };
  for (const row of actuals) sumInto(actual, row);
  return buildSalesProgressMetrics(actual, target);
}

/**
 * 担当者名 → 支社。目標行そのものから作る。
 *
 * 実績側（PT集計表・アポ取得情報）に支社の列は無いため、目標行の所属を
 * 実績にも適用する。こうすると、同じ人の目標と実績が必ず同じ行に入る。
 */
function buildGroupByStaff(targets: SalesTargetRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of targets) {
    const name = row.staffName;
    if (!name || map.has(name)) continue;
    const group = row.branch.trim();
    if (!group) continue;
    map.set(name, group);
  }
  return map;
}

/**
 * 支社別の集計。
 *
 * 支社が決まらない行（目標が無い担当者の実績・支社が空の目標）は
 * fallbackLabel へ寄せる。捨てると支社別の合計が全社合計と合わなくなり、
 * 数字を信用できなくなる。呼び出し側は「その他」を渡す。
 *
 * ensureLabels を渡すと、その並び順で行を作る。データが無い支社も
 * 0 の行として残るので、月を切り替えても見出しの位置が動かない。
 */
export function aggregateSalesProgressByBranch(
  targets: SalesTargetRow[],
  actuals: SalesActualRow[],
  opts?: { fallbackLabel?: string; ensureLabels?: string[] },
): SalesProgressGroupRow[] {
  const fallback = opts?.fallbackLabel ?? SALES_PROGRESS_UNASSIGNED_GROUP;
  const groupByStaff = buildGroupByStaff(targets);

  type Bucket = {
    label: string;
    target: Totals;
    actual: Totals;
    /** 担当者名 → その人の目標・実績。内訳（members）の元になる */
    members: Map<string, { target: Totals; actual: Totals }>;
  };
  const buckets = new Map<string, Bucket>();

  const bucketFor = (label: string): Bucket => {
    let b = buckets.get(label);
    if (!b) {
      b = { label, target: { ...ZERO }, actual: { ...ZERO }, members: new Map() };
      buckets.set(label, b);
    }
    return b;
  };

  const memberOf = (b: Bucket, name: string) => {
    let m = b.members.get(name);
    if (!m) {
      m = { target: { ...ZERO }, actual: { ...ZERO } };
      b.members.set(name, m);
    }
    return m;
  };

  // 並び順を固定するため、先に枠だけ作る
  for (const label of opts?.ensureLabels ?? []) bucketFor(label);

  for (const row of targets) {
    if (!row.staffName) continue;
    const b = bucketFor(row.branch.trim() || fallback);
    sumInto(b.target, row);
    sumInto(memberOf(b, row.staffName).target, row);
  }

  for (const row of actuals) {
    if (!row.staffName) continue;
    const b = bucketFor(groupByStaff.get(row.staffName) ?? fallback);
    sumInto(b.actual, row);
    sumInto(memberOf(b, row.staffName).actual, row);
  }

  const rows: SalesProgressGroupRow[] = [...buckets.values()].map((b) => ({
    label: b.label,
    memberCount: b.members.size,
    metrics: buildSalesProgressMetrics(b.actual, b.target),
    members: sortSalesProgressStaffRows(
      [...b.members.entries()].map(([staffName, v]) => ({
        staffName,
        metrics: buildSalesProgressMetrics(v.actual, v.target),
      })),
      "pt",
    ),
  }));

  const order = opts?.ensureLabels;
  if (order && order.length > 0) {
    const rank = new Map(order.map((label, i) => [label, i] as const));
    return rows.sort((a, b) => {
      const ar = rank.get(a.label) ?? Number.MAX_SAFE_INTEGER;
      const br = rank.get(b.label) ?? Number.MAX_SAFE_INTEGER;
      if (ar !== br) return ar - br;
      return a.label.localeCompare(b.label, "ja");
    });
  }

  // 並びの指定が無ければ目標の大きい順。寄せ先は最後に置く
  return rows.sort((a, b) => {
    const aLast = a.label === fallback ? 1 : 0;
    const bLast = b.label === fallback ? 1 : 0;
    if (aLast !== bLast) return aLast - bLast;
    if (a.metrics.pt.target !== b.metrics.pt.target) {
      return b.metrics.pt.target - a.metrics.pt.target;
    }
    return a.label.localeCompare(b.label, "ja");
  });
}

/**
 * 内訳の並び替え（タスクL）。
 *
 * **選んでいる指標の実績の降順**にする。表示しているのがアポなのに PT 順で
 * 並んでいると、読み手には順不同に見えるため。
 * 実績が同じときは目標の大きい順、それも同じなら氏名順で安定させる。
 *
 * サーバは既定（PT 順）で返し、画面は選択中の指標でこの関数を掛け直す。
 * 並び順をサーバの応答に持たせないので、切り替えで再取得しない。
 */
export function sortSalesProgressStaffRows<T extends SalesProgressStaffRow>(
  rows: T[],
  metric: SalesProgressMetricKey,
): T[] {
  return [...rows].sort((a, b) => {
    const am = a.metrics[metric];
    const bm = b.metrics[metric];
    if (am.actual !== bm.actual) return bm.actual - am.actual;
    if (am.target !== bm.target) return bm.target - am.target;
    return a.staffName.localeCompare(b.staffName, "ja");
  });
}

/**
 * 突合できなかった件数。運用で気づけるようサーバログへ出す用（K-1）。
 * 氏名そのものは返さない。
 */
export function summarizeSalesProgressMatching(
  targets: SalesTargetRow[],
  actuals: SalesActualRow[],
  opts?: { targetRowsWithoutName?: number; actualRowsWithoutName?: number },
): SalesProgressMatchSummary {
  const targetNames = new Set(targets.map((r) => r.staffName).filter(Boolean));
  const actualNames = new Set(actuals.map((r) => r.staffName).filter(Boolean));

  let targetsWithoutActual = 0;
  for (const n of targetNames) {
    if (!actualNames.has(n)) targetsWithoutActual += 1;
  }
  let actualsWithoutTarget = 0;
  for (const n of actualNames) {
    if (!targetNames.has(n)) actualsWithoutTarget += 1;
  }

  return {
    targetsWithoutActual,
    actualsWithoutTarget,
    targetRowsWithoutName: opts?.targetRowsWithoutName ?? 0,
    actualRowsWithoutName: opts?.actualRowsWithoutName ?? 0,
  };
}

// ─────────────────────────────────────────────────── 表示用の整形

/** PT・売上は3桁区切り */
export function formatSalesProgressNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("ja-JP");
}

/** 達成率は小数第1位まで。目標が0/未設定なら「—」 */
export function formatSalesProgressRate(ratePercent: number | null): string {
  if (ratePercent === null || !Number.isFinite(ratePercent)) return "—";
  return `${ratePercent.toFixed(1)}%`;
}
