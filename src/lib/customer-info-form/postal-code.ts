const POSTAL_HYPHEN_RE = /^\d{3}-\d{4}$/;

/** 郵便番号表示形式（000-0000） */
export function formatPostalCodeInput(raw: string): string {
  const digits = raw.normalize("NFKC").replace(/[^\d]/g, "").slice(0, 7);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

export function isValidPostalCodeFormat(formatted: string): boolean {
  return POSTAL_HYPHEN_RE.test(formatted.trim());
}

export function postalCodeDigits(formatted: string): string {
  return formatted.replace(/-/g, "");
}

export type PostalCodeLookupResult = {
  prefecture: string;
  city: string;
  address: string;
};

/** zipcloud API で住所を取得（7桁・ハイフン形式が有効なときのみ） */
export async function lookupPostalCodeAddress(
  formatted: string,
): Promise<PostalCodeLookupResult | null> {
  if (!isValidPostalCodeFormat(formatted)) return null;
  const zipcode = postalCodeDigits(formatted);
  const url = `https://zipcloud.ibsnet.co.jp/api/search?zipcode=${encodeURIComponent(zipcode)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    status?: number;
    results?: Array<{
      address1?: string;
      address2?: string;
      address3?: string;
    } | null>;
  };
  if (data.status !== 200 || !data.results?.[0]) return null;
  const row = data.results[0];
  const prefecture = (row.address1 ?? "").trim();
  const city = (row.address2 ?? "").trim();
  const town = (row.address3 ?? "").trim();
  if (!prefecture && !city) return null;
  return { prefecture, city, address: town };
}
