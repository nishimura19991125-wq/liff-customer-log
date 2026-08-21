/**
 * タスクY: 勤怠の定時リスト（Google Chat 本文の組み立て）。
 *
 * ここは純粋関数だけを置く。@pocket にも Google Chat にも触らないので、
 * 文面の検証はこのファイルのテストだけで完結する。
 *
 * ── 長期運用のための決め事 ────────────────────────────────
 * 設定を足さずに済む形にしてある。部署が増えても、人数が増えても、
 * 部署が未設定の人が現れても、環境変数の追加は要らない。
 */

/** 部署が名簿に無い人をまとめる見出し。**この人たちも必ず出す** */
export const ATTENDANCE_LIST_NO_DEPARTMENT_LABEL = "部署なし";

const SEPARATOR = "----------------";

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** 丸数字は ⑳ まで。それ以降は通常の数字へ自動で切り替える */
const CIRCLED_ONE = 0x2460;
const CIRCLED_MAX = 20;

export type AttendanceListPerson = {
  staffName: string;
  /** 名簿の部署。未設定なら「部署なし」へ回す */
  department?: string;
};

export type AttendanceListSection = {
  department: string;
  names: string[];
};

/**
 * 一覧の番号。1〜20 は ①〜⑳、21 以降は「21.」形式。
 *
 * ⑳ を超えた分だけ表記が変わるので、境目では ⑲ ⑳ 21. と並ぶ。
 * 人数で表記を選ぶ設定を持たせるより、この方が運用の手が要らない。
 */
export function formatAttendanceListNumber(index1Based: number): string {
  const n = Math.floor(index1Based);
  if (n >= 1 && n <= CIRCLED_MAX) {
    return String.fromCodePoint(CIRCLED_ONE + n - 1);
  }
  return `${n}.`;
}

/** "2026-08-21" → "8/21（金）" */
export function formatAttendanceListDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd.trim();
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // 曜日はタイムゾーンに引きずられないよう UTC で組み立てて求める
  const weekday = WEEKDAY_JA[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}/${day}（${weekday}）`;
}

/**
 * 部署ごとに束ねる。
 *
 * 並び順は名簿の登録順（`departmentOrder`）。50音順や固定リストにすると、
 * 部署が増減するたびに人が設定を直すことになるため採らない。
 * 名簿から順番を引けなかった部署は、出勤者に現れた順で後ろに続ける。
 * 「部署なし」は必ず最後。
 */
export function buildAttendanceListSections(
  people: AttendanceListPerson[],
  departmentOrder: string[] = [],
): AttendanceListSection[] {
  const byDepartment = new Map<string, string[]>();
  for (const person of people) {
    const name = person.staffName.trim();
    if (!name) continue;
    const dept =
      person.department?.trim() || ATTENDANCE_LIST_NO_DEPARTMENT_LABEL;
    const list = byDepartment.get(dept);
    if (list) list.push(name);
    else byDepartment.set(dept, [name]);
  }

  const ordered: string[] = [];
  const taken = new Set<string>();
  for (const dept of departmentOrder) {
    const key = dept.trim();
    if (!key || taken.has(key) || !byDepartment.has(key)) continue;
    taken.add(key);
    ordered.push(key);
  }
  // 名簿に載っていない部署は、出勤者に現れた順（Map の挿入順）で続ける
  for (const dept of byDepartment.keys()) {
    if (taken.has(dept) || dept === ATTENDANCE_LIST_NO_DEPARTMENT_LABEL) {
      continue;
    }
    taken.add(dept);
    ordered.push(dept);
  }
  if (byDepartment.has(ATTENDANCE_LIST_NO_DEPARTMENT_LABEL)) {
    ordered.push(ATTENDANCE_LIST_NO_DEPARTMENT_LABEL);
  }

  return ordered.map((department) => ({
    department,
    names: byDepartment.get(department) ?? [],
  }));
}

function renderSections(sections: AttendanceListSection[]): string[] {
  const lines: string[] = [];
  for (const section of sections) {
    lines.push(SEPARATOR);
    lines.push(`【${section.department}】`);
    section.names.forEach((name, i) => {
      lines.push(`${formatAttendanceListNumber(i + 1)}${name}`);
    });
  }
  return lines;
}

export type AttendanceListMessageInput = {
  /** JST の yyyy-mm-dd */
  workDate: string;
  people: AttendanceListPerson[];
  /** 名簿の登録順に並んだ部署名 */
  departmentOrder?: string[];
};

/**
 * 9:32 の出勤者リスト。
 *
 * **出勤者が0人なら null（送らない）。** 土日祝は0人が常態で、毎日
 * 「誰も出勤していません」が流れると通知そのものが読まれなくなる。
 */
export function buildAttendanceClockInListMessage(
  input: AttendanceListMessageInput,
): string | null {
  const sections = buildAttendanceListSections(
    input.people,
    input.departmentOrder ?? [],
  );
  if (sections.length === 0) return null;

  return [
    "▼本日の出勤者▼",
    formatAttendanceListDate(input.workDate),
    ...renderSections(sections),
  ].join("\n");
}

export type MissingClockOutMessageInput = AttendanceListMessageInput & {
  /**
   * その日に出勤打刻をした人数。
   *
   * 0 のときは「全員退勤済み」も送らない。誰も出勤していない日に
   * 「全員が退勤打刻済みです」と流れても意味がないため。
   */
  attendeeCount: number;
};

/**
 * 19:55 の未退勤リスト。
 *
 * 出勤打刻がある人だけが対象（`people` に渡す時点で絞る）。
 * 未退勤が0人なら「全員が退勤打刻済みです」を送る。打刻漏れが無いことが
 * 分かるほうが有用なため。
 */
export function buildMissingClockOutListMessage(
  input: MissingClockOutMessageInput,
): string | null {
  if (input.attendeeCount <= 0) return null;

  const header = [
    "▼退勤打刻の確認▼",
    formatAttendanceListDate(input.workDate),
  ];

  const sections = buildAttendanceListSections(
    input.people,
    input.departmentOrder ?? [],
  );
  if (sections.length === 0) {
    return [...header, SEPARATOR, "全員が退勤打刻済みです"].join("\n");
  }

  // 区切り線が2本続かないよう、案内文は日付のすぐ下に置く
  return [
    ...header,
    "以下の方は退勤打刻がされていません。",
    ...renderSections(sections),
  ].join("\n");
}
