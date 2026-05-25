import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { resolveCustomerInfoFormFieldId } from "@/lib/customer-info-form/resolve-fields";
import { readCustomerInfoFieldValue } from "@/lib/customer-info-record";
import { trimMapAddressValue } from "@/lib/map-navigation";

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

function pocketFieldUniqueIdByCaption(
  fields: AtPocketFieldRow[],
  caption: string,
): string | null {
  const target = nfkc(caption).toLowerCase();
  for (const f of fields) {
    const cap = f.caption ? nfkc(String(f.caption)).toLowerCase() : "";
    if (cap && cap === target) {
      const id = f.uniqueId?.trim();
      return id || null;
    }
  }
  return null;
}

export type MapAddressFieldIds = {
  pinpointFieldId: string | null;
  /** 見出し「住所」 */
  normalAddressFieldId: string | null;
  prefectureFieldId: string | null;
  cityFieldId: string | null;
  streetFieldId: string | null;
};

export type MapAddressValues = {
  pinpointAddress: string;
  normalAddress: string;
};

function fieldIdOrNull(id: string | null | undefined): string | null {
  const t = id?.trim();
  return t || null;
}

/** お客様情報アプリ向け：ピンポイント住所・住所列の解決 */
export function resolveCustomerInfoMapAddressFieldIds(
  appFields: AtPocketFieldRow[],
): MapAddressFieldIds {
  return {
    pinpointFieldId: fieldIdOrNull(
      resolveCustomerInfoFormFieldId(
        "pinpointAddress",
        "ピンポイント住所",
        appFields,
      ) ?? pocketFieldUniqueIdByCaption(appFields, "ピンポイント住所"),
    ),
    normalAddressFieldId: fieldIdOrNull(
      pocketFieldUniqueIdByCaption(appFields, "住所"),
    ),
    prefectureFieldId: fieldIdOrNull(
      resolveCustomerInfoFormFieldId("prefecture", "都道府県", appFields),
    ),
    cityFieldId: fieldIdOrNull(
      resolveCustomerInfoFormFieldId("city", "市区郡", appFields),
    ),
    streetFieldId: fieldIdOrNull(
      resolveCustomerInfoFormFieldId("address", "町村+番地", appFields) ??
        pocketFieldUniqueIdByCaption(appFields, "町村+番地"),
    ),
  };
}

/** 工事登録アプリ向け：同一見出しの列を解決 */
export function resolveConstructionMapAddressFieldIds(
  appFields: AtPocketFieldRow[],
): MapAddressFieldIds {
  return {
    pinpointFieldId: fieldIdOrNull(
      pocketFieldUniqueIdByCaption(appFields, "ピンポイント住所"),
    ),
    normalAddressFieldId: fieldIdOrNull(
      pocketFieldUniqueIdByCaption(appFields, "住所"),
    ),
    prefectureFieldId: fieldIdOrNull(
      pocketFieldUniqueIdByCaption(appFields, "都道府県"),
    ),
    cityFieldId: fieldIdOrNull(
      pocketFieldUniqueIdByCaption(appFields, "市区郡"),
    ),
    streetFieldId: fieldIdOrNull(
      pocketFieldUniqueIdByCaption(appFields, "町村+番地"),
    ),
  };
}

export function readMapAddressesFromRecord(
  recObj: Record<string, unknown>,
  ids: MapAddressFieldIds,
): MapAddressValues {
  const pinpointAddress = ids.pinpointFieldId
    ? trimMapAddressValue(
        readCustomerInfoFieldValue(recObj, ids.pinpointFieldId),
      )
    : "";

  let normalAddress = "";
  if (ids.normalAddressFieldId) {
    normalAddress = trimMapAddressValue(
      readCustomerInfoFieldValue(recObj, ids.normalAddressFieldId),
    );
  }
  if (!normalAddress) {
    const parts = [
      ids.prefectureFieldId
        ? trimMapAddressValue(
            readCustomerInfoFieldValue(recObj, ids.prefectureFieldId),
          )
        : "",
      ids.cityFieldId
        ? trimMapAddressValue(
            readCustomerInfoFieldValue(recObj, ids.cityFieldId),
          )
        : "",
      ids.streetFieldId
        ? trimMapAddressValue(
            readCustomerInfoFieldValue(recObj, ids.streetFieldId),
          )
        : "",
    ].filter(Boolean);
    normalAddress = parts.join("");
  }

  return { pinpointAddress, normalAddress };
}
