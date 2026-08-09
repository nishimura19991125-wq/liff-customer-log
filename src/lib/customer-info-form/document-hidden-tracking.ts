import {
  CUSTOMER_DOCUMENT_SPECS,
  customerDocumentSpecByKey,
} from "@/lib/customer-documents-spec";
import { isCustomerInfoFormFieldVisible } from "@/lib/customer-info-form/rules";
import { CUSTOMER_INFO_FORM_FIELD_MAP } from "@/lib/customer-info-form/schema";
import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";

/**
 * 「システムが書いた不要」だけを取り消すための追跡（タスクG）。
 *
 * 背景:
 *   条件により非表示になった書類項目には hiddenValue（＝「不要」）が書かれるが、
 *   条件が変わって表示に戻っても値が戻らず、「不要」のまま保存されていた。
 *   「不要」は isDocumentStatusAlert のアラート集合に無いため、
 *   回収していないのに「書類は揃っている」と見なされていた。
 *
 * 方針:
 *   同一の編集セッション内で、**システムが書いた「不要」だけ**を未回収系へ戻す。
 *   人が自分で選んだ「不要」は保持する（営業が意図的に選ぶ正当なケースがある）。
 *
 * ⚠ 追跡は画面内の状態（ref / state）でのみ保持する。
 *   localStorage / sessionStorage は使わない。
 * ⚠ 画面を開き直すと追跡は消える。したがって
 *   **既に @pocket に保存済みの「不要」は、この仕組みの対象外**。
 *   自動では直らない（既存データの扱いは別途判断）。
 */

/** hiddenValue 未設定時の既定（rules.ts の HIDDEN_DASH と同じ） */
const HIDDEN_DASH = "-";

/** 書類項目の表示条件に影響するキー。これ以外の変更では書類項目に触れない */
export const DOCUMENT_VISIBILITY_TRIGGER_KEYS: ReadonlySet<string> = new Set([
  "paymentMethod",
  "installationType",
  "preApplication",
]);

function hiddenValueForDocumentKey(key: string): string {
  return CUSTOMER_INFO_FORM_FIELD_MAP.get(key)?.hiddenValue ?? HIDDEN_DASH;
}

export type DocumentHiddenReconcileResult = {
  values: CustomerInfoFormValues;
  /** システムが hiddenValue を書いた項目（次回の照合に持ち回る） */
  autoFilled: Set<string>;
};

/**
 * hiddenValue 適用の前後を突き合わせ、
 *   - 非表示になった項目のうち**システムが上書きしたもの**を記録する
 *   - 表示に戻った項目のうち**記録があるもの**を未回収系へ戻す
 *
 * before: applyCustomerInfoHiddenDefaultsToValues を通す前の values
 * after:  通した後の values
 */
export function reconcileDocumentHiddenDefaults(opts: {
  before: CustomerInfoFormValues;
  after: CustomerInfoFormValues;
  autoFilled: ReadonlySet<string>;
}): DocumentHiddenReconcileResult {
  const values: CustomerInfoFormValues = { ...opts.after };
  const autoFilled = new Set(opts.autoFilled);

  for (const spec of CUSTOMER_DOCUMENT_SPECS) {
    const key = spec.key;
    const hiddenValue = hiddenValueForDocumentKey(key);
    const visible = isCustomerInfoFormFieldVisible(key, values);

    if (!visible) {
      const beforeValue = (opts.before[key] ?? "").trim();
      const afterValue = (values[key] ?? "").trim();
      // 記録するのは「システムが値を書き換えた」場合だけ。
      // 元から hiddenValue（＝人が「不要」を選んでいた）なら記録しない。
      // 記録すると、表示に戻ったとき人の選択を消してしまう。
      if (afterValue === hiddenValue && beforeValue !== hiddenValue) {
        autoFilled.add(key);
      }
      continue;
    }

    // 表示に戻った。システムが書いた分だけ未回収系へ戻す
    if (autoFilled.has(key)) {
      values[key] = spec.pendingValue;
      autoFilled.delete(key);
    }
  }

  return { values, autoFilled };
}

/**
 * その項目を人が明示的に操作した（ラジオ選択・アップロードによる自動更新）。
 * 以降は人の意図として扱い、リセット対象から外す。
 */
export function forgetDocumentAutoFilled(
  autoFilled: ReadonlySet<string>,
  key: string,
): Set<string> {
  const next = new Set(autoFilled);
  next.delete(key);
  return next;
}

/** リセット先（未回収系）。テスト・画面から参照する */
export function documentPendingValue(key: string): string | null {
  return customerDocumentSpecByKey(key)?.pendingValue ?? null;
}
