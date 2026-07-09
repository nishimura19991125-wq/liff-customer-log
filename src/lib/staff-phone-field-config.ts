/** スタッフ名簿の「連絡先」列（@pocket uniqueId） */
export const DEFAULT_STAFF_PHONE_FIELD_ID = "field-4";

export function staffPhoneFieldIdConfigured(): string {
  return (
    process.env.STAFF_PHONE_FIELD_ID?.trim() || DEFAULT_STAFF_PHONE_FIELD_ID
  );
}
