/**
 * /api/staff がクライアントへ返す形の型。
 *
 * 名簿の内部表現（StaffRosterEntry: メールアドレスを含む）とは**別の型**として定義する。
 * この応答はブラウザの sessionStorage に 30 分保存されるため
 * （staff-api-session-cache.ts）、メールアドレス等を混入させてはならない。
 */

/** クライアントへ返してよいスタッフ1件 */
export type StaffApiSummary = {
  id: string;
  name: string;
  /** 社員ID（@pocket の取込キー）。bind の payload 組み立てにクライアントが使う */
  importKey?: string;
};

/** クライアントへ出してはならないプロパティ名 */
type StaffSecretKey = "email" | "mail" | "emailAddress" | "staffEmail";

/**
 * `T` に機密プロパティが含まれていれば `never` に潰すことで、
 * 応答型へメールアドレス等を足した瞬間にコンパイルエラーにする。
 *
 * 使い方:
 *   const staff: AssertNoStaffSecrets<StaffApiSummary>[] = rows.map(toStaffApiSummary);
 *
 * StaffApiSummary に email を足すと `never[]` への代入となり型エラーになる。
 */
export type AssertNoStaffSecrets<T> = Extract<keyof T, StaffSecretKey> extends never
  ? T
  : never;
