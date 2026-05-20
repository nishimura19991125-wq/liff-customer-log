export const PAYMENT_METHOD_OPTIONS = [
  "ソーラーローン",
  "頭金+ソーラーローン",
  "現金一括",
  "住宅ローン組込",
  "提携先より振込",
] as const;

export const FIT_TYPE_OPTIONS = ["FIT", "非FIT"] as const;

export const SUBSIDY_OR_PREAPPLICATION_OPTIONS = [
  "無",
  "都道府県+市区町村",
  "都道府県",
  "市区町村",
  "その他",
  "都道府県+市区町村+その他",
  "市区町村+その他",
  "都道府県+その他",
] as const;

export const INDOOR_SURVEY_STATUS_OPTIONS = ["未実施", "実施済み"] as const;

export const PAYMENT_METHODS_WITH_LOAN = new Set<string>([
  "ソーラーローン",
  "頭金+ソーラーローン",
]);

export const PAYMENT_METHODS_WITH_CASH = new Set<string>([
  "頭金+ソーラーローン",
  "現金一括",
]);

export function subsidyIncludesPrefecture(s: string): boolean {
  return (
    s === "都道府県+市区町村" ||
    s === "都道府県" ||
    s === "都道府県+市区町村+その他" ||
    s === "都道府県+その他"
  );
}

export function subsidyIncludesCity(s: string): boolean {
  return (
    s === "都道府県+市区町村" ||
    s === "市区町村" ||
    s === "都道府県+市区町村+その他" ||
    s === "市区町村+その他"
  );
}

export function subsidyIncludesOther(s: string): boolean {
  return (
    s === "その他" ||
    s === "都道府県+市区町村+その他" ||
    s === "市区町村+その他" ||
    s === "都道府県+その他"
  );
}
