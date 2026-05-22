import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";

/** プルダウンに既存値を残す（名簿リスト外の保存値でも表示できるように） */
export function mergeStaffNameOptions(
  options: string[],
  currentValue: string | undefined,
): string[] {
  const merged = new Set(options);
  const t = normApClStaffName(currentValue);
  if (t) merged.add(t);
  return [...merged].sort((a, b) => a.localeCompare(b, "ja"));
}
