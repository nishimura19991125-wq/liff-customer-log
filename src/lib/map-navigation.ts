/** マップナビ用 URL 組み立て（クライアント・サーバー共通） */

export type MapNavigationInput = {
  pinpointAddress?: string | null;
  normalAddress?: string | null;
};

export type MapNavigationResult = {
  mapUrl: string;
  label: string;
  mode: "pinpoint-url" | "pinpoint-query" | "normal-address";
};

const NAV_PREFIX_PINPOINT = "http://googleusercontent.com/maps.google.com/5";
const NAV_PREFIX_NORMAL = "http://googleusercontent.com/maps.google.com/6";

export function trimMapAddressValue(
  raw: string | null | undefined,
): string {
  const v = (raw ?? "").normalize("NFKC").trim();
  if (!v || v === "-") return "";
  return v;
}

/**
 * ピンポイント住所・住所から Google マップ遷移先を決定。
 * 1. ピンポイントが http(s) URL → そのまま
 * 2. ピンポイントにその他文字列 → ナビ用スキーム（5）
 * 3. ピンポイント空で住所あり → ナビ用スキーム（6）
 * 4. 両方空 → null
 */
export function buildMapNavigation(
  input: MapNavigationInput,
): MapNavigationResult | null {
  const pinpoint = trimMapAddressValue(input.pinpointAddress);
  const normal = trimMapAddressValue(input.normalAddress);

  if (pinpoint) {
    const lower = pinpoint.toLowerCase();
    if (lower.startsWith("http://") || lower.startsWith("https://")) {
      return {
        mapUrl: pinpoint,
        label: "📍 ピンポイントナビ開始",
        mode: "pinpoint-url",
      };
    }
    return {
      mapUrl: `${NAV_PREFIX_PINPOINT}${encodeURIComponent(pinpoint)}`,
      label: "📍 ピンポイントナビ開始",
      mode: "pinpoint-query",
    };
  }

  if (normal) {
    return {
      mapUrl: `${NAV_PREFIX_NORMAL}${encodeURIComponent(normal)}`,
      label: "🚗 住所でナビ開始",
      mode: "normal-address",
    };
  }

  return null;
}
