/**
 * お客様情報の編集画面から変更できない工事日程の項目。
 *
 * 施工予定日の割り当ては工事カレンダーからのみ行う方針になったため
 * （fac1774 でお客様情報からの連携も無効化した）、この2項目は
 * お客様情報側では表示だけにする。
 *
 * クライアント（入力欄を出すか）とサーバ（@pocket への payload に載せるか）が
 * **同じこの定義**を参照する。片方だけ塞いでも、古いキャッシュの画面や
 * API の直叩きで書き込めてしまうため。
 * 商談進捗の meeting-schedule-locked-fields.ts と同じ考え方。
 *
 * ■ 塞ぐのは /customer-info の保存だけ
 * 工事カレンダーからの連携（sync-construction-to-customer-info.ts）は
 * 自前で payload を組み立てて updateRecord を呼ぶので、ここは通らない。
 * キャンセル処理は同じ PUT を通るが、あちらは施工予定日・施工会社を
 * **空にするのが仕事**なので、呼び出し側で除外している。
 *
 * ■ 初回施工予定日は対象外
 * 同じく工事カレンダー連携が書く列だが、今回の指示は2項目のみ。
 * 対象を広げる場合は CUSTOMER_INFO_CONSTRUCTION_LOCKED_FIELDS に
 * "firstConstructionDate" を足せば、画面もサーバも同時に追随する。
 *
 * 元に戻すときはこの配列から外すだけでよい。
 * 入力欄の組み立てや選択肢の取得は消さずに残してある。
 */

export type CustomerInfoConstructionLockedField =
  | "constructionDate"
  | "constructionContractor";

/** 現在 /customer-info から変更できない項目 */
export const CUSTOMER_INFO_CONSTRUCTION_LOCKED_FIELDS: readonly CustomerInfoConstructionLockedField[] =
  ["constructionDate", "constructionContractor"];

export const CUSTOMER_INFO_CONSTRUCTION_LOCKED_FIELD_LABELS: Record<
  CustomerInfoConstructionLockedField,
  string
> = {
  constructionDate: "施工予定日",
  constructionContractor: "施工業者",
};

/** 画面に添える補足文。どこで変更するのかまで書く */
export const CUSTOMER_INFO_CONSTRUCTION_LOCKED_HINT =
  "工事カレンダーから変更してください";

export function isCustomerInfoConstructionFieldLocked(
  key: string,
): key is CustomerInfoConstructionLockedField {
  return (
    CUSTOMER_INFO_CONSTRUCTION_LOCKED_FIELDS as readonly string[]
  ).includes(key);
}

/**
 * @pocket へ送る payload から、編集不可な項目の列を落とす。
 *
 * 400 で弾かないのは、これらが他の項目と同じ1回の保存に同居しており、
 * 弾くと関係ない項目の保存まで巻き込んで全滅させてしまうため。
 * お客様情報の decideApClStaffPut と同じ扱いにしている。
 *
 * 落とした項目を返すので、呼び出し側でログに出せる。
 */
export function stripCustomerInfoConstructionFieldsFromPayload(
  payload: Record<string, unknown>,
  fieldIdOf: (key: CustomerInfoConstructionLockedField) => string | null,
): CustomerInfoConstructionLockedField[] {
  const dropped: CustomerInfoConstructionLockedField[] = [];

  for (const field of CUSTOMER_INFO_CONSTRUCTION_LOCKED_FIELDS) {
    const fieldId = fieldIdOf(field);
    if (!fieldId) continue;
    if (!Object.prototype.hasOwnProperty.call(payload, fieldId)) continue;

    delete payload[fieldId];
    dropped.push(field);
  }

  return dropped;
}
