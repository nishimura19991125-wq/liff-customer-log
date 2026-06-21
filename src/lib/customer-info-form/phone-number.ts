const MOBILE_PREFIXES = ["070", "080", "090"] as const;

/** 数字のみ（最大11桁） */
export function parsePhoneDigits(raw: string): string {
  return raw.normalize("NFKC").replace(/[^\d]/g, "").slice(0, 11);
}

/**
 * 電話番号表示形式（ハイフン区切り）。
 * 携帯・070/080/090 系は 3-4-4、03/06 は 2-4-4、その他市外局番は 3-3-4 等。
 */
export function formatPhoneNumberInput(raw: string): string {
  const d = parsePhoneDigits(raw);
  if (!d) return "";

  if (d.startsWith("0120")) {
    if (d.length <= 4) return d;
    if (d.length <= 7) return `${d.slice(0, 4)}-${d.slice(4)}`;
    return `${d.slice(0, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
  }
  if (d.startsWith("0800")) {
    if (d.length <= 4) return d;
    if (d.length <= 7) return `${d.slice(0, 4)}-${d.slice(4)}`;
    return `${d.slice(0, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
  }

  const isMobile =
    d.length >= 11 ||
    MOBILE_PREFIXES.some((p) => d.startsWith(p) && d.length > p.length);

  if (isMobile) {
    if (d.length <= 3) return d;
    if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  }

  if (d.startsWith("03") || d.startsWith("06")) {
    if (d.length <= 2) return d;
    if (d.length <= 6) return `${d.slice(0, 2)}-${d.slice(2)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
  }

  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

/** @pocket から読み取った値を表示用に整形 */
export function formatPhoneFromPocket(raw: string): string {
  const digits = parsePhoneDigits(raw);
  if (!digits) return "";
  return formatPhoneNumberInput(digits);
}

export function isValidPhoneNumberFormat(formatted: string): boolean {
  const digits = parsePhoneDigits(formatted);
  if (digits.length !== 10 && digits.length !== 11) return false;
  return formatPhoneNumberInput(digits) === formatted.trim();
}

/** @pocket 転記用（10〜11桁が揃いハイフン付き形式に整形できるときのみ） */
export function phoneNumberForPocket(raw: string): string | null {
  const formatted = formatPhoneNumberInput(raw);
  if (!isValidPhoneNumberFormat(formatted)) return null;
  return formatted;
}
