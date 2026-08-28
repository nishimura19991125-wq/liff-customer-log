import type {
  CalendarApiPayload,
  CalendarRecordMonthPatch,
} from "@/lib/calendar-api-types";

/** 保存直後にクライアントの byDay を差し替え（同一 recordId の旧行を除去してからマージ） */
export function applyCalendarRecordPatch(
  data: CalendarApiPayload,
  patch: CalendarRecordMonthPatch,
): CalendarApiPayload {
  const byDay: CalendarApiPayload["byDay"] = { ...data.byDay };
  const rid = patch.recordId;

  for (const [dayKey, list] of Object.entries(byDay)) {
    const next = list.filter((item) => item.recordId !== rid);
    if (next.length === 0) {
      delete byDay[dayKey];
    } else if (next.length !== list.length) {
      byDay[dayKey] = next;
    }
  }

  for (const [dayKey, items] of Object.entries(patch.byDay)) {
    const existing = byDay[dayKey] ?? [];
    const without = existing.filter((item) => item.recordId !== rid);
    byDay[dayKey] = [...without, ...items];
  }

  return { ...data, byDay };
}

/** 工事対応者名だけをローカル更新（再取得が 429 のときのフォールバック） */
export function applyConstructionHandlerNameLocal(
  data: CalendarApiPayload,
  recordId: string,
  constructionHandlerName: string,
): CalendarApiPayload {
  const rid = recordId.trim();
  const name = constructionHandlerName.trim();
  if (!rid || !name) return data;

  let changed = false;
  const byDay: CalendarApiPayload["byDay"] = {};
  for (const [dayKey, list] of Object.entries(data.byDay)) {
    let dayChanged = false;
    const next = list.map((item) => {
      if (item.recordId !== rid) return item;
      if (item.constructionHandlerName === name) return item;
      dayChanged = true;
      return { ...item, constructionHandlerName: name };
    });
    byDay[dayKey] = dayChanged ? next : list;
    if (dayChanged) changed = true;
  }
  return changed ? { ...data, byDay } : data;
}

/**
 * 工事日の移動を、保存直後にクライアント側で反映する。
 *
 * ■ サーバに patch を作らせない
 * 移動は**2つのレコード**が変わる（移動先が案件に、移動元が空き枠に）。
 * applyCalendarRecordPatch は1レコード単位なので表現できず、サーバで
 * 2つ作ると GET が2回（実測で約2秒）増える。しかも直後の再取得で
 * 上書きされる。クライアントは必要な材料をすべて持っているので、
 * **@pocket を1回も呼ばずに**組み替えられる。
 *
 * ■ 正確さは再取得に任せる
 * ここで作る行は「だいたい正しい表示」でよい。施工会社が変わる移動では
 * 移動先の line2 が古いままになるが、数秒後の再取得で正になる。
 * 目的は「押した直後に何も変わらない」のを避けること。
 *
 * ■ 触るのは sourceDayKey にある1行だけ
 * 新築案件は仕込日・パネル工事日などにも行が出る。移動で変わるのは
 * 施工予定日だけなので、**利用者が押した日の行**以外は動かさない。
 */
export function applyCalendarCaseMove(
  data: CalendarApiPayload,
  move: {
    /** 移動元の工事レコードID（移動後は空き枠になる） */
    caseRecordId: string;
    sourceDayKey: string;
    targetDayKey: string;
    /**
     * 移動後に案件を持つレコードID。
     * 空き枠を使ったならその枠の ID、新規作成なら作られた ID。
     * 分からなければ null（表示だけ先に出し、再取得で正になる）
     */
    movedRecordId: string | null;
    /** 使った空き枠の ID。新規作成なら null */
    slotRecordId: string | null;
  },
): CalendarApiPayload {
  const caseId = move.caseRecordId.trim();
  const from = move.sourceDayKey.trim();
  const to = move.targetDayKey.trim();
  if (!caseId || !from || !to || from === to) return data;

  const sourceList = data.byDay[from] ?? [];
  const caseItem = sourceList.find((item) => item.recordId === caseId);
  // 押した日に見当たらない（別の月を見ている等）。触らない
  if (!caseItem) return data;

  const byDay: CalendarApiPayload["byDay"] = { ...data.byDay };

  // 移動元から案件の行を外し、空き枠として置き直す
  const slotId = move.slotRecordId?.trim() || "";
  const targetList = byDay[to] ?? [];
  const usedSlot = slotId
    ? targetList.find((item) => item.recordId === slotId)
    : undefined;

  byDay[from] = [
    ...sourceList.filter((item) => item.recordId !== caseId),
    {
      ...caseItem,
      // レコードは残る。中身だけ空き枠に戻る
      recordId: caseId,
      category: "empty",
      line1: "（空枠）",
      line2: "",
      memo: "",
      housingShort: "",
      segmentShort: "",
      constructionHandlerName: undefined,
      tNumber: undefined,
      showKankoCheck: false,
      reportKankoComplete: false,
      postponedBadge: false,
    },
  ];

  // 移動先は、使った枠の行を外して案件の行を入れる
  byDay[to] = [
    ...targetList.filter(
      (item) => item.recordId !== slotId && item.recordId !== caseId,
    ),
    {
      ...caseItem,
      recordId: move.movedRecordId?.trim() || null,
      // 違う施工会社の枠へ移すと色分けも変わる
      contractorKey: usedSlot?.contractorKey ?? caseItem.contractorKey,
    },
  ];

  return { ...data, byDay };
}
