import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { fetchAppFields, fetchRecordById } from "@/lib/atpocket";
import { auditLogEnabled, recordAuditLog } from "@/lib/audit-log";
import { computeAuditChanges } from "@/lib/audit-log-changes";
import { writePocketRecordWithImportKey } from "@/lib/atpocket-write-with-import-key";
import {
  pocketFieldUniqueIdByCaption,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";
import {
  customerInfoAppId,
  customerInfoImportKeyFieldId,
  customerInfoPocketAuth1,
  customerInfoPocketAuthWrite,
} from "@/lib/customer-info-config";
import { findCustomerInfoRecordIdByUniqueKeyCached } from "@/lib/customer-info-key-lookup-cache";
import { fieldCaptionByUniqueId } from "@/lib/customer-info-record";

/**
 * 工事カレンダーで変更した工事対応者を、お客様情報アプリにも書き込む（タスクP）。
 *
 * ■ なぜ両方に書くのか
 * 工事対応者を工事カレンダー側だけ更新しても @pocket に残らない、という報告が
 * あった。書き込み自体は成功しており、@pocket 側のアプリ間連携
 * （お客様情報 → 工事カレンダー）が古い値で上書きしていた。
 * 両方に同じ値を入れておけば、連携が走っても結果が変わらない。
 *
 * ■ 一方向だけにする理由
 * お客様情報の編集画面にも工事対応者の欄があるが、そこからカレンダーへ
 * 戻す仕組みは作らない。双方向にすると往復による無限ループや @pocket 側の
 * 連携との競合を招く。必要性が見えてから検討する。
 */

/** @pocket の「工事対応者」列（お客様情報アプリ側） */
export const CUSTOMER_INFO_CONSTRUCTION_HANDLER_CAPTION = "工事対応者";

/**
 * お客様情報アプリの工事対応者列を解決する。
 * 環境変数を優先し、未設定なら見出しの完全一致で引く（他の CUSTOMER_INFO_* と同じ方式）。
 */
export function resolveCustomerInfoConstructionHandlerFieldId(
  appFields: AtPocketFieldRow[],
): string | null {
  const env = process.env.CUSTOMER_INFO_CONSTRUCTION_HANDLER_FIELD_ID?.trim();
  if (env) {
    return resolveConfiguredFieldToSchemaUniqueId(env, appFields);
  }
  return pocketFieldUniqueIdByCaption(
    appFields,
    CUSTOMER_INFO_CONSTRUCTION_HANDLER_CAPTION,
  );
}

export type CustomerInfoHandlerWriteResult =
  /** 書き込み済み */
  | { kind: "written"; recordId: string }
  /**
   * 書いていないが業務は続けてよい。warning は画面に出す。
   * - not-found: T番号で該当レコードを引けなかった
   * - not-configured: アプリ ID・取込キー・工事対応者列のいずれかが未解決
   */
  | { kind: "skipped"; reason: "not-found" | "not-configured"; warning: string }
  /** 書き込みに失敗した。呼び出し側は工事カレンダーへの書き込みも行わないこと */
  | { kind: "failed"; error: string };

const NOT_FOUND_WARNING =
  "工事カレンダーは更新しましたが、お客様情報の該当レコードが見つかりませんでした。";

function notConfiguredWarning(detail: string): string {
  return `工事カレンダーは更新しましたが、お客様情報への反映ができませんでした（${detail}）。`;
}

/**
 * お客様情報アプリの工事対応者を、工事カレンダーへ書くのと同じ値で更新する。
 *
 * ■ 既存値は常に上書きする（保護しない）
 * AP/CL担当者は「操作者の氏名が勝手に入る」事故があったため、変更が無ければ
 * 送らない防御（decideApClStaffPut）と、既存レコードには初期値を載せない
 * 防御（sync-construction-to-customer-info）を入れている。
 * 工事対応者はそれらとは性質が違う。
 *   - 値の出どころが「操作者自身」ではなく「画面で明示的に選んだ社員」で、
 *     取り違えて他人の名前が入る経路が無い
 *   - 変更されうる運用項目で、変更したのに反映されないほうが問題になる
 * そのため保護は入れず、常に上書きする。
 * この違いを崩す（AP/CL と同じ保護を足す／逆に AP/CL の保護を外す）ときは、
 * 上記の前提が変わっていないかを先に確認すること。
 */
export async function writeConstructionHandlerToCustomerInfo(opts: {
  /** 工事アプリ側で確定した T番号（お客様情報アプリの取込キーと同じ値） */
  tNumber: string;
  /** 工事カレンダーへ書くのと同じ、名簿から解決した氏名 */
  handlerName: string;
  /** 監査ログの実行者解決に使う */
  lineUserId: string;
}): Promise<CustomerInfoHandlerWriteResult> {
  const tNumber = opts.tNumber.trim();
  const handlerName = opts.handlerName.trim();
  if (!tNumber || !handlerName) {
    return {
      kind: "skipped",
      reason: "not-configured",
      warning: notConfiguredWarning("T番号または工事対応者名が空です"),
    };
  }

  const appId = customerInfoAppId();
  if (!appId) {
    return {
      kind: "skipped",
      reason: "not-configured",
      warning: notConfiguredWarning("CUSTOMER_INFO_APP_ID が未設定です"),
    };
  }

  const importKeyEnv = customerInfoImportKeyFieldId();
  if (!importKeyEnv) {
    return {
      kind: "skipped",
      reason: "not-configured",
      warning: notConfiguredWarning(
        "CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID が未設定です",
      ),
    };
  }

  try {
    const readAuth = customerInfoPocketAuth1();
    const appFields = await fetchAppFields(appId, readAuth, {
      operation: "customer-info:工事対応者連携(列定義)",
      appEnv: "CUSTOMER_INFO_APP_ID",
    });

    const keyFieldId = resolveConfiguredFieldToSchemaUniqueId(
      importKeyEnv,
      appFields,
    );
    if (!keyFieldId) {
      return {
        kind: "skipped",
        reason: "not-configured",
        warning: notConfiguredWarning(
          `取込キー「${importKeyEnv}」がお客様情報アプリの列定義と一致しません`,
        ),
      };
    }

    const handlerFieldId =
      resolveCustomerInfoConstructionHandlerFieldId(appFields);
    if (!handlerFieldId) {
      // 設定漏れ。業務は止めないが、気づけるようログには残す
      console.error(
        "[customer-info-construction-handler] お客様情報アプリの「工事対応者」列を解決できません。" +
          "CUSTOMER_INFO_CONSTRUCTION_HANDLER_FIELD_ID を設定するか、見出しを確認してください",
      );
      return {
        kind: "skipped",
        reason: "not-configured",
        warning: notConfiguredWarning(
          "お客様情報アプリの「工事対応者」列を特定できません",
        ),
      };
    }

    const recordId = await findCustomerInfoRecordIdByUniqueKeyCached(
      keyFieldId,
      tNumber,
    );
    if (!recordId) {
      console.warn(
        `[customer-info-construction-handler] T番号「${tNumber}」に一致するお客様情報レコードが見つかりません`,
      );
      return { kind: "skipped", reason: "not-found", warning: NOT_FOUND_WARNING };
    }

    // 監査ログの「変更前」。取得に失敗しても書き込みは止めない
    let before: Record<string, unknown> | null = null;
    if (auditLogEnabled()) {
      try {
        const row = await fetchRecordById(appId, recordId, readAuth);
        if (row?.record && typeof row.record === "object") {
          before = row.record as Record<string, unknown>;
        }
      } catch (e) {
        console.warn(
          "[customer-info-construction-handler] 監査ログ用の更新前レコード取得に失敗",
          e,
        );
      }
    }

    // T番号は取込キー。値が分かっているので payload に載せて余分な取得を省く
    const payload: Record<string, unknown> = {
      [keyFieldId]: tNumber,
      [handlerFieldId]: handlerName,
    };

    await writePocketRecordWithImportKey({
      appId,
      recordId,
      payload,
      importKeyFieldId: keyFieldId,
      writeAuth: customerInfoPocketAuthWrite(),
    });

    // ベストエフォート。工事カレンダー側とは対象アプリIDが違うので経路を判別できる
    await recordAuditLog({
      lineUserId: opts.lineUserId,
      operation: "update",
      targetAppId: appId,
      targetRecordId: recordId,
      targetTNumber: tNumber,
      changes: computeAuditChanges(before, payload, {
        labelOf: (fieldId) => fieldCaptionByUniqueId(appFields, fieldId),
      }),
    });

    return { kind: "written", recordId };
  } catch (e) {
    console.error("[customer-info-construction-handler]", e);
    const detail = e instanceof Error ? e.message : String(e);
    return { kind: "failed", error: detail };
  }
}
