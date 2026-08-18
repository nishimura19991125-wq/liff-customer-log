import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import {
  CONTRACT_NOTIFICATION_EXTRA_FIELDS,
  buildContractNotificationText,
  shouldSendContractNotification,
} from "@/lib/contract-notification";
import type { ContractNotificationExtraValues } from "@/lib/contract-notification";
import { resolveCustomerInfoFormFieldId } from "@/lib/customer-info-form/resolve-fields";
import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";
import { readCustomerInfoFieldValue } from "@/lib/customer-info-record";
import {
  googleChatContractWebhookConfigured,
  sendGoogleChatContractMessage,
} from "@/lib/google-chat";

/**
 * 契約速報（タスクR）のサーバ側の段取り。
 *
 * 本文の組み立ては純粋関数（contract-notification.ts）、送信は
 * google-chat.ts に分けてあり、ここは「読む・判定する・呼ぶ」だけを持つ。
 * route.ts に直接書かないための置き場所。
 */

/** 送信に失敗したときに画面へ出す文言 */
export const CONTRACT_NOTIFICATION_FAILURE_WARNING =
  "契約速報の送信に失敗しました。DX事業部へ連絡してください。";

export type ContractNotificationExtraFieldIds = {
  tNumber: string | null;
  batteryLocation: string | null;
};

/**
 * フォームスキーマに無い列（T番号・蓄電池設置箇所）の uniqueId を解決する。
 *
 * 解決方法はフォームと同じ resolveCustomerInfoFormFieldId に揃える
 * （CUSTOMER_INFO_FIELD_T_NUMBER / _BATTERY_LOCATION を優先し、
 * 未設定なら見出し完全一致）。新しい解決ロジックは書かない。
 */
export function resolveContractNotificationExtraFieldIds(
  appFields: AtPocketFieldRow[],
): ContractNotificationExtraFieldIds {
  const ids: ContractNotificationExtraFieldIds = {
    tNumber: null,
    batteryLocation: null,
  };
  for (const def of CONTRACT_NOTIFICATION_EXTRA_FIELDS) {
    ids[def.key] =
      resolveCustomerInfoFormFieldId(def.key, def.caption, appFields) || null;
  }
  return ids;
}

/** 解決できた列だけを取り出す（fetchRecordById の fields= に足す） */
export function contractNotificationExtraFieldIdList(
  ids: ContractNotificationExtraFieldIds,
): string[] {
  return [ids.tNumber, ids.batteryLocation].filter(
    (id): id is string => Boolean(id),
  );
}

/**
 * 保存前レコードから、フォームに出ない値を読む。
 *
 * どちらもこの保存では書き換わらない列なので、保存前の値をそのまま使う。
 */
export function readContractNotificationExtraValues(
  recObj: Record<string, unknown> | null,
  ids: ContractNotificationExtraFieldIds,
): ContractNotificationExtraValues {
  if (!recObj) return { tNumber: "", batteryLocation: "" };
  return {
    tNumber: ids.tNumber ? readCustomerInfoFieldValue(recObj, ids.tNumber) : "",
    batteryLocation: ids.batteryLocation
      ? readCustomerInfoFieldValue(recObj, ids.batteryLocation)
      : "",
  };
}

export type ContractNotificationOutcome =
  | { kind: "sent" }
  | {
      kind: "skipped";
      reason: "not-triggered" | "not-configured" | "send-skipped";
    }
  | { kind: "failed"; warning: string };

/**
 * 入力ステータスが「未入力 → 入力完了」に変わったときだけ契約速報を送る。
 *
 * @pocket への保存が成功したあとに呼ぶこと。保存に失敗したのに通知が飛ぶ
 * 事態を避けるため、呼び出し順は updateRecord のあとに固定する。
 * 例外は投げない。失敗しても保存は成功のままにし、warning を返す。
 */
export async function notifyContractCompleted(input: {
  values: CustomerInfoFormValues;
  /** 保存前の入力ステータス。読めなかったときは null（＝送らない） */
  beforeInputStatus: string | null;
  extras: ContractNotificationExtraValues;
}): Promise<ContractNotificationOutcome> {
  try {
    return await runContractNotification(input);
  } catch (e) {
    // ここで投げると、保存が済んでいるのに PUT がエラー応答になる。
    // 何が起きても保存は成功のままにし、警告に落とす。
    // 例外メッセージにはレコードの中身が載りうるので種別だけ出す
    console.error(
      "[contract-notification] 契約速報の処理で想定外の例外",
      JSON.stringify({
        tNumber: input.extras.tNumber,
        name: e instanceof Error ? e.name : "unknown",
      }),
    );
    return { kind: "failed", warning: CONTRACT_NOTIFICATION_FAILURE_WARNING };
  }
}

async function runContractNotification(input: {
  values: CustomerInfoFormValues;
  beforeInputStatus: string | null;
  extras: ContractNotificationExtraValues;
}): Promise<ContractNotificationOutcome> {
  if (
    !shouldSendContractNotification(
      input.beforeInputStatus,
      input.values.inputStatus,
    )
  ) {
    return { kind: "skipped", reason: "not-triggered" };
  }

  // 環境変数が未設定なら送信をスキップし、エラーにしない
  if (!googleChatContractWebhookConfigured()) {
    return { kind: "skipped", reason: "not-configured" };
  }

  const text = buildContractNotificationText({
    values: input.values,
    ...input.extras,
  });

  const result = await sendGoogleChatContractMessage(text);
  if (result.kind === "sent") return { kind: "sent" };
  if (result.kind === "skipped") return { kind: "skipped", reason: "send-skipped" };

  // 出してよいのは T番号・エラーの種類・HTTP ステータスまで。
  // Webhook URL とレコードの中身は出さない
  console.error(
    "[contract-notification] 契約速報の送信に失敗",
    JSON.stringify({
      tNumber: input.extras.tNumber,
      reason: result.reason,
      status: result.status,
    }),
  );
  return { kind: "failed", warning: CONTRACT_NOTIFICATION_FAILURE_WARNING };
}
