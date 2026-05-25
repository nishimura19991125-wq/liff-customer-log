/** テロップ用：日付（YYYY-MM-DD）＋ユーザー名のハッシュで日替わり固定のビジネス占い */

/** 12パターン以上：その日・その人で1つに固定 */
const DAILY_FORTUNE_LINES = [
  "大吉！強気なクロージングが成約のカギ 🔑",
  "ラッキー営業アクション：社用車のガラスを拭くと運気爆上げ 🧽",
  "吉！今日は聞き役に徹すると信頼度アップ 📈",
  "中吉！商談前に冷たいお茶を飲むと交渉スムーズ 🍵",
  "小吉！名刺の出し方を丁寧にすると印象アップ ✨",
  "大吉！午後の追客電話がラッキー 🎯",
  "吉！お客様の話をメモすると契約に近づく 📝",
  "中吉！朝イチの挨拶が商談の空気を変える ☀️",
  "末吉…でもランチは豪華に。午後が巻き返し 🍱",
  "大吉！『次の打合せ日』を先に決めると勝ち 🗓️",
  "吉！数字よりストーリーで伝えると刺さる 📊",
  "中吉！チームに一声かけるとアポが舞い込む 📞",
  "小吉！お気に入りのボールペンを持参すると集中力UP ✒️",
  "吉！笑顔多めでテンポよく進めると成約率UP 😄",
] as const;

function jstDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(d);
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 今日の日付＋担当者名から、1日固定の占い1行を返す */
export function buildDailyBusinessFortuneLine(staffName: string): string {
  const name = staffName.normalize("NFKC").trim() || "営業の星";
  const dateKey = jstDateKey();
  const seed = hashSeed(`${dateKey}|${name}`);
  const line = DAILY_FORTUNE_LINES[seed % DAILY_FORTUNE_LINES.length]!;
  const [, m, d] = dateKey.split("-");
  const dateLabel = m && d ? `${Number(m)}/${Number(d)}` : dateKey;
  const who = name !== "営業の星" ? `${name}さん` : "あなた";
  return `🔮 今日のビジネス占い（${dateLabel}・${who}）：${line}`;
}
