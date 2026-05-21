import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";

/** パネル品番②に「-」以外があれば「有」、なければ「無」 */
export function inferPanelComboFromPanelModel2(
  panelModel2: string | undefined,
): "無" | "有" {
  const v = (panelModel2 ?? "").trim();
  if (v && v !== "-") return "有";
  return "無";
}

export function inferPanelComboFromValues(
  values: CustomerInfoFormValues,
): "無" | "有" {
  return inferPanelComboFromPanelModel2(values.panelModel2);
}
