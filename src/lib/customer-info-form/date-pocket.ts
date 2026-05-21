/** @pocket DatePicker 向け（YYYY/MM/DD。入力は YYYY-MM-DD 想定） */
export function dateValueForPocket(raw: string): string | null {
  const t = raw.trim();
  if (!t || t === "-") return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}/${iso[2]}/${iso[3]}`;

  const slash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(t);
  if (slash) {
    return `${slash[1]}/${slash[2].padStart(2, "0")}/${slash[3].padStart(2, "0")}`;
  }

  const jp = /^(\d{4})[/.年](\d{1,2})[/.月](\d{1,2})/.exec(t);
  if (jp) {
    return `${jp[1]}/${jp[2].padStart(2, "0")}/${jp[3].padStart(2, "0")}`;
  }

  return null;
}
