/** 太陽光パネル容量(kW)・小数点以下は最大3桁（四捨五入しない） */
export const DECIMAL_KW_MAX_FRACTION_DIGITS = 3;

export type DecimalKwParts = {
  intPart: string;
  fracPart: string;
};

/** 入力中の文字列を整数部・小数部に分解（小数第4位以降は切り捨て） */
export function parseDecimalKwInput(raw: string): DecimalKwParts {
  let s = raw.normalize("NFKC").trim().replace(/,/g, "");
  if (s === "" || s === "-") return { intPart: "", fracPart: "" };

  const negative = s.startsWith("-");
  if (negative) s = s.slice(1);

  let intPart = "";
  let fracPart = "";
  const dot = s.indexOf(".");
  if (dot >= 0) {
    intPart = s.slice(0, dot).replace(/[^\d]/g, "");
    fracPart = s
      .slice(dot + 1)
      .replace(/[^\d]/g, "")
      .slice(0, DECIMAL_KW_MAX_FRACTION_DIGITS);
  } else {
    intPart = s.replace(/[^\d]/g, "");
  }

  if (negative && (intPart || fracPart)) {
    intPart = intPart ? `-${intPart}` : "-0";
  }

  return { intPart, fracPart };
}

export function formatDecimalKwParts(parts: DecimalKwParts): string {
  const { intPart, fracPart } = parts;
  if (!intPart && !fracPart) return "";
  if (!fracPart) return intPart;
  if (!intPart) return `0.${fracPart}`;
  return `${intPart}.${fracPart}`;
}

/** 画面入力用（入力のたびに呼ぶ） */
export function formatDecimalKwInput(raw: string): string {
  const parts = parseDecimalKwInput(raw);
  const formatted = formatDecimalKwParts(parts);

  const normalized = raw.normalize("NFKC").trim().replace(/,/g, "");
  if (!normalized) return formatted;

  const negative = normalized.startsWith("-");
  const body = negative ? normalized.slice(1) : normalized;

  // 「5.」のように小数部をこれから入力する段階では末尾の "." を残す
  if (body.endsWith(".") && !formatted.endsWith(".")) {
    const int = parts.intPart || (negative ? "-0" : "0");
    return `${int}.`;
  }

  return formatted;
}

/** @pocket から読み取った値を表示用に整形（四捨五入なし・最大3桁） */
export function formatDecimalKwFromPocket(raw: string): string {
  const t = raw.trim();
  // 非表示時に自動投入されたプレースホルダ 0 は空欄として扱う（再編集時の見た目）
  if (!t || t === "-" || t === "0") return "";
  return formatDecimalKwParts(parseDecimalKwInput(t));
}

/** @pocket 保存用（有効な数値のみ。四捨五入・ゼロ埋めなし） */
export function decimalKwForPocket(raw: string): string | null {
  const parts = parseDecimalKwInput(raw);
  if (!parts.intPart && !parts.fracPart) return null;
  return formatDecimalKwParts(parts);
}

/** 必須チェック用：有効な容量が入っているか */
export function hasDecimalKwValue(raw: string): boolean {
  const parts = parseDecimalKwInput(raw);
  if (!parts.intPart && !parts.fracPart) return false;
  const n = Number(formatDecimalKwParts(parts));
  return Number.isFinite(n);
}
