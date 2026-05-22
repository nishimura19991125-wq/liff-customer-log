import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import {
  pocketFieldUniqueIdByCaption,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";

export const APPT_REGISTRATION_NUMBER_CAPTION = "APPT登録番号";
export const CLPT_REGISTRATION_NUMBER_CAPTION = "CLPT登録番号";

function fieldIdFromEnvOrCaption(
  configuredId: string | undefined,
  caption: string,
  appFields: AtPocketFieldRow[],
): string | null {
  const fromEnv = configuredId?.trim();
  if (fromEnv) {
    return resolveConfiguredFieldToSchemaUniqueId(fromEnv, appFields);
  }
  return pocketFieldUniqueIdByCaption(appFields, caption);
}

/** 工事アプリ側：登録番号列の uniqueId */
export function resolveConstructionRegistrationNumberFieldIds(
  constructionFields: AtPocketFieldRow[],
): {
  apptRegistrationNumber: string | null;
  clptRegistrationNumber: string | null;
} {
  return {
    apptRegistrationNumber: fieldIdFromEnvOrCaption(
      process.env.CALENDAR_APPT_REGISTRATION_NUMBER_FIELD_ID?.trim(),
      APPT_REGISTRATION_NUMBER_CAPTION,
      constructionFields,
    ),
    clptRegistrationNumber: fieldIdFromEnvOrCaption(
      process.env.CALENDAR_CLPT_REGISTRATION_NUMBER_FIELD_ID?.trim(),
      CLPT_REGISTRATION_NUMBER_CAPTION,
      constructionFields,
    ),
  };
}

/** お客様情報アプリ側：登録番号列の uniqueId */
export function resolveCustomerInfoRegistrationNumberFieldIds(
  customerFields: AtPocketFieldRow[],
): {
  apptRegistrationNumber: string | null;
  clptRegistrationNumber: string | null;
} {
  return {
    apptRegistrationNumber: fieldIdFromEnvOrCaption(
      process.env.CUSTOMER_INFO_APPT_REGISTRATION_NUMBER_FIELD_ID?.trim(),
      APPT_REGISTRATION_NUMBER_CAPTION,
      customerFields,
    ),
    clptRegistrationNumber: fieldIdFromEnvOrCaption(
      process.env.CUSTOMER_INFO_CLPT_REGISTRATION_NUMBER_FIELD_ID?.trim(),
      CLPT_REGISTRATION_NUMBER_CAPTION,
      customerFields,
    ),
  };
}
