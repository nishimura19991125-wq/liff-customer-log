/** 稼働終了報告の対象事業部（名簿の部署・事業部列と NFKC 完全一致） */
export const WORK_END_REPORT_ELIGIBLE_DEPARTMENTS = [
  "DC事業部",
  "工務店アライアンス事業部",
] as const;

function nfkcDepartmentLabel(value: string): string {
  return value.normalize("NFKC").trim();
}

function eligibleDepartmentsFromEnv(): string[] {
  const raw = process.env.WORK_END_REPORT_ELIGIBLE_DEPARTMENTS?.trim();
  if (!raw) return [...WORK_END_REPORT_ELIGIBLE_DEPARTMENTS];
  const parsed = raw
    .split(",")
    .map((s) => nfkcDepartmentLabel(s))
    .filter(Boolean);
  return parsed.length > 0 ? parsed : [...WORK_END_REPORT_ELIGIBLE_DEPARTMENTS];
}

export function workEndReportEligibleDepartmentLabels(): string[] {
  return eligibleDepartmentsFromEnv();
}

export function isWorkEndReportEligibleDepartment(
  department: string | null | undefined,
): boolean {
  const label = department ? nfkcDepartmentLabel(department) : "";
  if (!label) return false;
  const allowed = new Set(
    workEndReportEligibleDepartmentLabels().map(nfkcDepartmentLabel),
  );
  return allowed.has(label);
}

export function workEndReportIneligibleMessage(
  department: string | null | undefined,
): string {
  const allowed = workEndReportEligibleDepartmentLabels().join("・");
  if (!department?.trim()) {
    return `稼働終了報告は ${allowed} の社員のみ利用できます。名簿の部署・事業部を確認してください。`;
  }
  return `稼働終了報告は ${allowed} の社員のみ利用できます（現在: ${department.trim()}）。`;
}
