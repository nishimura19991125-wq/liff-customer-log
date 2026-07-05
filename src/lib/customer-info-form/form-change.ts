import {
  PAYMENT_METHODS_WITH_CASH,
  PAYMENT_METHODS_WITH_LOAN,
} from "@/lib/customer-info-form/options";
import {
  commaIntegerForPocket,
  formatCommaInteger,
  parseCommaIntegerDigits,
} from "@/lib/customer-info-form/numeric-comma";
import {
  syncCombinedNameFields,
} from "@/lib/customer-info-form/name-parts";
import { filterKatakanaInput } from "@/lib/customer-info-form/katakana-input";
import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";

function norm(v: string | undefined): string {
  return (v ?? "").trim();
}

function sumCommaFields(...raws: string[]): string {
  let total = 0;
  for (const raw of raws) {
    const d = parseCommaIntegerDigits(raw);
    if (!d) continue;
    const n = Number(d);
    if (Number.isFinite(n)) total += n;
  }
  return total > 0 ? formatCommaInteger(String(total)) : "";
}

/** 支払方法に応じて契約金額を現金・ローンから自動算出 */
export function syncContractAmountFromPayment(
  values: CustomerInfoFormValues,
): CustomerInfoFormValues {
  const payment = norm(values.paymentMethod);
  const cash = norm(values.cashAmount);
  const loan = norm(values.loanAmount);

  let contract = norm(values.contractAmount);
  if (payment === "ソーラーローン") {
    contract = loan;
  } else if (payment === "頭金+ソーラーローン") {
    contract = sumCommaFields(cash, loan);
  } else if (payment === "現金一括") {
    contract = cash;
  }
  if (contract === norm(values.contractAmount)) return values;
  return { ...values, contractAmount: contract };
}

/** 単一フィールド変更後の values（契約金額の連動を含む） */
export function applyCustomerInfoFormChange(
  prev: CustomerInfoFormValues,
  key: string,
  value: string,
): CustomerInfoFormValues {
  const next: CustomerInfoFormValues = { ...prev, [key]: value };

  if (
    key === "paymentMethod" ||
    key === "cashAmount" ||
    key === "loanAmount"
  ) {
    return syncCombinedNameFields(syncContractAmountFromPayment(next));
  }
  if (
    key === "customerFamilyName" ||
    key === "customerGivenName" ||
    key === "furiganaFamily" ||
    key === "furiganaGiven"
  ) {
    const nextValue =
      key === "furiganaFamily" || key === "furiganaGiven"
        ? filterKatakanaInput(value)
        : value;
    return syncCombinedNameFields({ ...prev, [key]: nextValue });
  }
  return next;
}

/** 契約金額が現金+ローンと連動する支払方法か */
export function isContractAmountDerived(paymentMethod: string): boolean {
  const p = paymentMethod.trim();
  return (
    PAYMENT_METHODS_WITH_LOAN.has(p) || PAYMENT_METHODS_WITH_CASH.has(p)
  );
}

export function contractAmountForPocket(values: CustomerInfoFormValues): string {
  const synced = syncContractAmountFromPayment(values);
  return commaIntegerForPocket(synced.contractAmount ?? "") ?? "";
}
