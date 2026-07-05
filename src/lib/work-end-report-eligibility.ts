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
    .split(/[,、]/)
    .map((s) => s.trim())
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

  for (const allowed of workEndReportEligibleDepartmentLabels()) {
    const target = nfkcDepartmentLabel(allowed);
    if (label === target) return true;

    if (target === "DC事業部") {
      if (
        label === "DC" ||
        label === "ＤＣ" ||
        /^DC/i.test(label) ||
        label.includes("DC事業部") ||
        label.includes("ＤＣ事業部")
      ) {
        return true;
      }
    }

    if (target.includes("工務店アライアンス") && label.includes("工務店アライアンス")) {
      return true;
    }
  }

  return false;
}
