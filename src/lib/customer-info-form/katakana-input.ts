/** カタカナ入力（全角カナ・長音・中黒）。半角カナは NFKC、ひらがなは確定時にカタカナへ。 */
export function filterKatakanaInput(raw: string): string {
  const normalized = raw.normalize("NFKC");
  const katakana = hiraganaToKatakana(normalized);
  return [...katakana].filter(isAllowedKatakanaChar).join("");
}

function hiraganaToKatakana(str: string): string {
  return [...str]
    .map((ch) => {
      const cp = ch.codePointAt(0);
      if (cp != null && cp >= 0x3041 && cp <= 0x3096) {
        return String.fromCodePoint(cp + 0x60);
      }
      return ch;
    })
    .join("");
}

function isAllowedKatakanaChar(ch: string): boolean {
  const cp = ch.codePointAt(0);
  if (cp == null) return false;
  if (cp >= 0x30a1 && cp <= 0x30fa) return true;
  if (cp === 0x30fc) return true;
  if (cp === 0x30fb) return true;
  return false;
}

export function isKatakanaOnlyInput(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  return filterKatakanaInput(raw) === raw.normalize("NFKC");
}
