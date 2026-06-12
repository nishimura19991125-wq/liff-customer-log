/** おみくじ詳細行（👔カラー / 🔑アイテム / 🏃アクション）のパース */

export type FortuneDetailParts = {
  color: string | null;
  item: string | null;
  action: string | null;
};

function readPartValue(part: string): { key: string; value: string } {
  const colonIdx = part.indexOf("：");
  if (colonIdx >= 0) {
    return {
      key: part.slice(0, colonIdx).trim(),
      value: part.slice(colonIdx + 1).trim(),
    };
  }
  return { key: "", value: part.trim() };
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
    if (!value) continue;

    if (key.includes("カラー")) {
      result.color = value;
    } else if (key.includes("アイテム")) {
      result.item = value;
    } else if (key.includes("アクション")) {
      result.action = value;
    }
  }

  return result;
}
