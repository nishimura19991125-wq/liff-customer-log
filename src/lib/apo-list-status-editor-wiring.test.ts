import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { resolveMeetingScheduleCardEditability } from "@/lib/meeting-schedule-locked-fields";

const read = (p: string) => readFileSync(p, "utf8");
const editor = read("src/components/apo-list-status-editor.tsx");
const rows = read("src/components/apo-list-rows.tsx");
const page = read("src/app/apo-list/page.tsx");
const meetingPage = read("src/app/meeting-schedule/page.tsx");
const client = read("src/lib/meeting-schedule-status-client.ts");

/**
 * 段階Cの配線を固定する。判定そのもののテストではなく、
 * 「アポ情報一覧と商談予定が別々の実装に分かれていないこと」を守る。
 */
describe("アポ情報一覧の商談ステータス編集：フックに渡す値", () => {
  /**
   * ここが false だと機能が丸ごと消える。実装時に実際に踏みかけた。
   * canEditStatusDetails = statusEditable && savable なので、
   * statusEditable: false では入力欄も保存ボタンも出ない
   */
  it("statusEditable が false だと付随項目も保存ボタンも出ない", () => {
    const e = resolveMeetingScheduleCardEditability({
      statusEditable: false,
      scheduleEditable: false,
      savable: true,
      hasStatusOptions: false,
    });
    expect(e.canEditStatusDetails).toBe(false);
    expect(e.showSaveBar).toBe(false);
  });

  it("statusEditable が true なら、見積ステータスは塞がれたまま付随項目だけ編集できる", () => {
    const e = resolveMeetingScheduleCardEditability({
      statusEditable: true,
      scheduleEditable: false,
      savable: true,
      hasStatusOptions: false,
    });
    expect(e.canEditStatusDetails).toBe(true);
    expect(e.showSaveBar).toBe(true);
    // 見積ステータスと日時は MEETING_SCHEDULE_LOCKED_FIELDS で塞がっている
    expect(e.canEditStatus).toBe(false);
    expect(e.canEditSchedule).toBe(false);
  });

  it("編集画面は statusEditable をそのまま渡す（false を直書きしない）", () => {
    expect(editor).toContain("statusEditable,");
    expect(editor).not.toContain("statusEditable: false");
  });

  it("商談・資料送付予定日時と見積ステータスの選択欄は出さない", () => {
    expect(editor).toContain("scheduleEditable: false");
    expect(editor).toContain("hasStatusOptions: false");
  });
});

describe("アポ情報一覧の商談ステータス編集：実装を持たない", () => {
  it("判定も入力状態も自前で持たない（フックと共有部品に任せる）", () => {
    expect(editor).not.toContain("useState");
    expect(editor).not.toContain("planMeetingScheduleCardSave(");
    expect(editor).not.toContain("isMeetingScheduleSetCreatedStatus(");
    expect(editor).not.toContain("showSetCreatedForm =");
  });

  it("入力欄を自前で書かない（MeetingScheduleNegotiationFields を使う）", () => {
    expect(editor).toContain("<MeetingScheduleNegotiationFields");
    expect(editor).toContain("<MeetingScheduleSaveBar");
    expect(editor).not.toContain("<select");
    expect(editor).not.toContain("<input");
  });

  it("商談予定カードと同じフックを使う", () => {
    expect(editor).toContain("useMeetingScheduleStatusForm(");
    expect(
      read("src/components/meeting-schedule-item-card.tsx"),
    ).toContain("useMeetingScheduleStatusForm(");
  });

  it("行の値の読み替えは apoListRowToCardValues に集める", () => {
    expect(editor).toContain("apoListRowToCardValues(row)");
    expect(editor).not.toContain("row.firstMeetingDateYmd");
    expect(editor).not.toContain("row.responseDateYmd");
  });
});

describe("アポ情報一覧の商談ステータス編集：保存", () => {
  it("送り先は商談予定と同じ status の口だけ", () => {
    expect(rows).toContain("meetingScheduleStatusPath(recordId)");
    // コメント中の「.../schedule」は数えない。呼び出しだけを見る
    expect(rows).not.toContain("records/${encodeURIComponent(recordId)}/schedule");
    expect(rows).not.toContain("meetingScheduleSchedulePath");
  });

  it("日時の patch が来たら黙って捨てず、保存できなかったと伝える", () => {
    expect(rows).toContain("result.scheduleOk = false");
    expect(rows).toContain(
      "商談・資料送付予定日時はこの画面から変更できません",
    );
  });

  it("PATCH の送り方は共有の client を使い、画面ごとに書かない", () => {
    expect(rows).toContain(
      'from "@/lib/meeting-schedule-status-client"',
    );
    expect(meetingPage).toContain(
      'from "@/lib/meeting-schedule-status-client"',
    );
    expect(rows).not.toContain("method: \"PATCH\"");
    expect(meetingPage).not.toContain("method: \"PATCH\"");
    expect(client).toContain("method: \"PATCH\"");
  });

  it("保存後は SWR の mutate で一覧を取り直す", () => {
    expect(page).toContain("onSaved={mutate}");
    expect(rows).toContain("await onSaved?.()");
  });

  it("編集フォームは詳細（ApoDetailGroups）より上に置く", () => {
    const editorAt = rows.indexOf("<ApoListStatusEditor");
    const detailAt = rows.indexOf("<ApoDetailGroups");
    expect(editorAt).toBeGreaterThan(-1);
    expect(detailAt).toBeGreaterThan(editorAt);
  });
});
