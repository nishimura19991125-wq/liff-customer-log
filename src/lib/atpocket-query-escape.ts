import "server-only";

/**
 * @pocket 一覧 API の `query` に埋め込む値のエスケープ。
 *
 * ⚠ エスケープ対象は **バックスラッシュと二重引用符の2文字のみ** である。
 *    @pocket のクエリ言語仕様（and / or / 括弧 / ワイルドカード / 改行の扱い）は
 *    **未確認**であり、これで注入を防ぎ切れるかは検証されていない。
 *    規則を強化する前に @pocket 側のドキュメントで仕様を確認すること。
 *
 * 実装内容は atpocket-record-id.ts / attendance-server.ts にあった
 * 同一実装を1本化したもので、挙動は変更していない。
 */
export function escapePocketQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
