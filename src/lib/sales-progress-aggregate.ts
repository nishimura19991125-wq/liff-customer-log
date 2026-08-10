/**
 * 営業進捗（目標に対する達成率）の集計（タスクK）。
 *
 * ここは純粋関数だけを置く。@pocket の呼び出しも列の解決も行わない。
 * 呼び出し側が「氏名で正規化済みの目標行・実績行」を渡す。
 *
 * ■ 突合について
 * 目標と実績は氏名文字列で突合する。正規化は既存の normApClStaffName に
 * 一本化しており、このファイルでは新しい正規化を定義しない。渡ってくる
 * staffName は正規化済みである前提。
 *
 * ■ プライバシー（K-3）
 * 本人以外の個人成績は返さない。部署別・支社別は集計値のみを扱い、
 * 所属人数がしきい値（既定2名）に満たないグループは実質的に個人の数字に
 * なるため、数値を伏せる（suppressed）。
 */

/** 目標が未登録の実績をまとめる先。個人名ではないラベル */
export const SALES_PROGRESS_UNASSIGNED_GROUP = "目標未登録";

/** これ未満の人数のグループは数値を伏せる */
export const SALES_PROGRESS_DEFAULT_MIN_GROUP_MEMBERS = 2;

/** 目標1行（担当者ごと・対象月ぶん） */
export type SalesTargetRow = {
  /** normApClStaffName 済み */
  staffName: string;
  department: string;
  branch: string;
  apoCount: number;
  pt: number;
  contractCount: number;
};

/** 実績（担当者ごとに集計済み） */
export type SalesActualRow = {
  /** normApClStaffName 済み */
  staffName: string;
  apoCount: number;
  pt: number;
  contractCount: number;
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
  contract: SalesProgressMetric;
};

export type SalesProgressGroupRow = {
  label: string;
  /** このグループに属する人数（目標または実績があった人） */
  memberCount: number;
  /** 人数が少なく個人の数字になるため数値を伏せたか */
  suppressed: boolean;
  /** suppressed のときは null */
  metrics: SalesProgressMetrics | null;
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

export function buildSalesProgressMetrics(
  actual: { pt: number; apoCount: number; contractCount: number },
  target: { pt: number; apoCount: number; contractCount: number },
): SalesProgressMetrics {
  return {
    pt: computeAchievement(actual.pt, target.pt),
    apo: computeAchievement(actual.apoCount, target.apoCount),
    contract: computeAchievement(actual.contractCount, target.contractCount),
  };
}

const ZERO = { pt: 0, apoCount: 0, contractCount: 0 };

function sumInto(
  acc: { pt: number; apoCount: number; contractCount: number },
  row: { pt: number; apoCount: number; contractCount: number },
): void {
  acc.pt += safeNumber(row.pt);
  acc.apoCount += safeNumber(row.apoCount);
  acc.contractCount += safeNumber(row.contractCount);
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
 * 担当者名 → 部署／支社。目標行そのものから作る。
 *
 * 実績側（PT集計表・アポ取得情報）に部署・支社の列は無いため、
 * 目標行の所属を実績にも適用する。こうすると、同じ人の目標と実績が
 * 必ず同じグループに入る。
 */
function buildGroupByStaff(
  targets: SalesTargetRow[],
  pick: "department" | "branch",
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of targets) {
    const name = row.staffName;
    if (!name || map.has(name)) continue;
    const group = (pick === "department" ? row.department : row.branch).trim();
    if (!group) continue;
    map.set(name, group);
  }
  return map;
}

/**
 * 部署別・支社別の集計。
 *
 * 目標が無い担当者の実績は SALES_PROGRESS_UNASSIGNED_GROUP にまとめる。
 * 捨てると全社合計と部署別合計が合わなくなり、数字を信用できなくなるため。
 */
export function aggregateSalesProgressByGroup(
  targets: SalesTargetRow[],
  actuals: SalesActualRow[],
  pick: "department" | "branch",
  opts?: { minGroupMembers?: number },
): SalesProgressGroupRow[] {
  const minMembers = Math.max(
    1,
    opts?.minGroupMembers ?? SALES_PROGRESS_DEFAULT_MIN_GROUP_MEMBERS,
  );
  const groupByStaff = buildGroupByStaff(targets, pick);

  type Bucket = {
    label: string;
    target: { pt: number; apoCount: number; contractCount: number };
    actual: { pt: number; apoCount: number; contractCount: number };
    members: Set<string>;
  };
  const buckets = new Map<string, Bucket>();

  const bucketFor = (label: string): Bucket => {
    let b = buckets.get(label);
    if (!b) {
      b = { label, target: { ...ZERO }, actual: { ...ZERO }, members: new Set() };
      buckets.set(label, b);
    }
    return b;
  };

  for (const row of targets) {
    if (!row.staffName) continue;
    const label =
      (pick === "department" ? row.department : row.branch).trim() ||
      SALES_PROGRESS_UNASSIGNED_GROUP;
    const b = bucketFor(label);
    sumInto(b.target, row);
    b.members.add(row.staffName);
  }

  for (const row of actuals) {
    if (!row.staffName) continue;
    const label =
      groupByStaff.get(row.staffName) ?? SALES_PROGRESS_UNASSIGNED_GROUP;
    const b = bucketFor(label);
    sumInto(b.actual, row);
    b.members.add(row.staffName);
  }

  const rows: SalesProgressGroupRow[] = [...buckets.values()].map((b) => {
    const memberCount = b.members.size;
    const suppressed = memberCount < minMembers;
    return {
      label: b.label,
      memberCount,
      suppressed,
      metrics: suppressed ? null : buildSalesProgressMetrics(b.actual, b.target),
    };
  });

  // 目標の大きい順。伏せた行と目標未登録は最後に置く
  return rows.sort((a, b) => {
    const aLast = a.label === SALES_PROGRESS_UNASSIGNED_GROUP ? 1 : 0;
    const bLast = b.label === SALES_PROGRESS_UNASSIGNED_GROUP ? 1 : 0;
    if (aLast !== bLast) return aLast - bLast;
    if (a.suppressed !== b.suppressed) return a.suppressed ? 1 : -1;
    const at = a.metrics?.pt.target ?? -1;
    const bt = b.metrics?.pt.target ?? -1;
    if (at !== bt) return bt - at;
    return a.label.localeCompare(b.label, "ja");
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
