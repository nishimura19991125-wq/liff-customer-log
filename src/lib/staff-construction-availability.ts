import "server-only";

/** @pocket のセル値を比較用のプレーン文字列に寄せる */
export function pocketTableCellToPlainString(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw).trim();
  }
  if (Array.isArray(raw)) {
    return raw
      .map((item) => pocketTableCellToPlainString(item))
      .filter(Boolean)
      .join(" ");
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const value = o.value;
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value).trim();
    }
    if (Array.isArray(value)) {
      return pocketTableCellToPlainString(value);
    }
    const label = o.label;
    if (typeof label === "string") return label.trim();
    const text = o.text;
    if (typeof text === "string") return text.trim();
    const displayValue = o.displayValue;
    if (typeof displayValue === "string") return displayValue.trim();
    const caption = o.caption;
    if (typeof caption === "string") return caption.trim();
  }
  return String(raw).trim();
}

/**
 * 単一選択セルの表示用文字列。
 * value が選択肢 ID のことがあるため、label / text / displayValue を優先する。
 */
export function pocketSelectCellDisplayString(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw).trim();
  }
  if (Array.isArray(raw)) {
    return raw
      .map((item) => pocketSelectCellDisplayString(item))
      .filter(Boolean)
      .join(" ");
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const key of [
      "label",
      "text",
      "displayValue",
      "caption",
      "name",
    ] as const) {
      const v = o[key];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number" || typeof v === "boolean") {
        return String(v).trim();
      }
    }
    const value = o.value;
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value).trim();
    }
    if (Array.isArray(value)) return pocketSelectCellDisplayString(value);
  }
  return String(raw).trim();
}

export function nfkcNormalize(input: string): string {
  return input.normalize("NFKC").trim();
}

/** ラジオ／単一選択などから、照合用の候補文字列を集める（value が ID・label が「稼働」のケースに対応） */
function collectStatusCandidateStrings(raw: unknown, out: string[]): void {
  if (raw === undefined || raw === null) return;
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    const t = String(raw).trim();
    if (t) out.push(t);
    return;
  }
  if (Array.isArray(raw)) {
    for (const item of raw) collectStatusCandidateStrings(item, out);
    return;
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const key of [
      "label",
      "text",
      "displayValue",
      "caption",
      "name",
      "value",
    ] as const) {
      const v = o[key];
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        const t = String(v).trim();
        if (t) out.push(t);
      } else if (v != null) {
        collectStatusCandidateStrings(v, out);
      }
    }
  }
}

/**
 * 工事対応稼働状況が activeLabel と一致するとき true。
 * ラジオの value が選択肢 ID でも、label「稼働」なら一致とみなす。
 * 「非稼働」は誤検知しない。
 */
export function staffConstructionAvailabilityIsActive(
  rawStatus: unknown,
  activeLabel: string,
): boolean {
  const want = nfkcNormalize(activeLabel || "稼働");
  if (!want) return false;

  const candidates: string[] = [];
  collectStatusCandidateStrings(rawStatus, candidates);
  const plain = pocketTableCellToPlainString(rawStatus);
  if (plain) candidates.push(plain);

  const normalized = [
    ...new Set(candidates.map((c) => nfkcNormalize(c)).filter(Boolean)),
  ];
  if (normalized.length === 0) return false;

  if (normalized.some((n) => n.includes("非") && n.includes(want))) {
    return false;
  }
  if (normalized.some((n) => n === want)) return true;
  // 「工事対応：稼働」など付帯文言がある場合
  if (want === "稼働") {
    return normalized.some(
      (n) => n.includes("稼働") && !n.includes("非稼働") && !n.includes("非 稼働"),
    );
  }
  return normalized.some((n) => n.includes(want));
}
