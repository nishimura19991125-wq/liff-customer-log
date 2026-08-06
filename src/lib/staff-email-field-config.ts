import "server-only";

/**
 * スタッフ名簿のメールアドレス列。
 *
 * 用途は監査ログの「実行者」列のみ。**クライアントへ返してはならない。**
 * /api/staff の応答はブラウザの sessionStorage に 30 分保存される
 * （staff-api-session-cache.ts）ため、混入すると端末に個人情報が残る。
 * 応答型への混入は staff-api-types.ts の AssertNoStaffSecrets で型レベルに防いでいる。
 */
export function staffEmailFieldId(): string | undefined {
  return process.env.STAFF_EMAIL_FIELD_ID?.trim() || undefined;
}

/** 名簿キャッシュキー用（未設定なら空文字） */
export function staffEmailFieldIdConfigured(): string {
  return staffEmailFieldId() ?? "";
}
