/** おみくじ詳細行（👔カラー / 🔑アイテム / 🏃アクション）のパース */

export type FortuneDetailParts = {
  color: string | null;
  item: string | null;
  action: string | null;
};

function readPartValue(part: string): { key: string; value: string } {
  const match = part.match(/^(.+?)[：:](.+)$/);
  if (match) {
    return {
      key: match[1]!.trim(),
      value: match[2]!.trim(),
    };
  }
  return { key: "", value: part.trim() };
}

function assignFortunePart(
  result: FortuneDetailParts,
  key: string,
  value: string,
  rawPart: string,
): void {
  const label = `${key}${rawPart}`;
  if (label.includes("カラー") || rawPart.startsWith("👔")) {
    if (!result.color) {
      result.color =
        key && value
          ? value
          : rawPart.replace(/^👔(?:カラー)?[：:]?/u, "").trim();
    }
    return;
  }
  if (label.includes("アイテム") || rawPart.startsWith("🔑")) {
    if (!result.item) {
      result.item =
        key && value
          ? value
          : rawPart.replace(/^🔑(?:アイテム)?[：:]?/u, "").trim();
    }
    return;
  }
  if (label.includes("アクション") || rawPart.startsWith("🏃")) {
    if (!result.action) {
      result.action =
        key && value
          ? value
          : rawPart.replace(/^🏃(?:アクション)?[：:]?/u, "").trim();
    }
  }
}

export function parseFortuneDetailParts(detailLine: string): FortuneDetailParts {
  const result: FortuneDetailParts = {
    color: null,
    item: null,
    action: null,
  };

  for (const part of detailLine.split("／")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const { key, value } = readPartValue(trimmed);
    if (!value && !key) continue;
    assignFortunePart(result, key, value, trimmed);
  }

  return result;
}

export function fortuneDetailRows(
  parts: FortuneDetailParts,
): Array<{ icon: string; label: string; value: string; emphasize?: boolean }> {
  const rows: Array<{
    icon: string;
    label: string;
    value: string;
    emphasize?: boolean;
  }> = [];
  if (parts.color) {
    rows.push({ icon: "👔", label: "ラッキーカラー", value: parts.color });
  }
  if (parts.item) {
    rows.push({
      icon: "🔑",
      label: "ラッキーアイテム",
      value: parts.item,
      emphasize: true,
    });
  }
  if (parts.action) {
    rows.push({ icon: "🏃", label: "ラッキーアクション", value: parts.action });
  }
  return rows;
}
