import "server-only";

/** 工事対応者（工事アプリ単一選択）。HANDLER を優先し REGISTRANT は後方互換 */
export function calendarConstructionHandlerFieldIdFromEnv(): string {
  return (
    process.env.CALENDAR_EMPTY_FILL_CONSTRUCTION_HANDLER_FIELD_ID?.trim() ||
    process.env.CALENDAR_EMPTY_FILL_CONSTRUCTION_REGISTRANT_FIELD_ID?.trim() ||
    ""
  );
}
