"use client";

import type { WorkEndReportFormValues } from "@/lib/work-end-report-types";
import {
  WORK_END_REPORT_APO_ACTIVITY_OPTIONS,
  isWorkEndApoActivityImplemented,
} from "@/lib/work-end-report-types";

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] text-slate-900 shadow-sm disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

const readOnlyClass =
  "w-full rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-[14px] text-slate-700 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-200";

type Props = {
  form: WorkEndReportFormValues;
  onChange: (form: WorkEndReportFormValues) => void;
  staffName: string;
  reportDate: string;
  disabled?: boolean;
  /** 報告者・報告日を省略（退勤打刻フロー用） */
  compact?: boolean;
};

export function WorkEndReportFormFields({
  form,
  onChange,
  staffName,
  reportDate,
  disabled = false,
  compact = false,
}: Props) {
  const apoActivityRequired = isWorkEndApoActivityImplemented(form.apoActivity);
  const detailFieldsDisabled = disabled || !apoActivityRequired;

  return (
    <div className="flex flex-col gap-4">
      {!compact ? (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
              報告者
            </span>
            <input
              type="text"
              className={readOnlyClass}
              value={staffName}
              readOnly
              aria-readonly
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
              報告日
            </span>
            <input
              type="text"
              className={readOnlyClass}
              value={reportDate}
              readOnly
              aria-readonly
            />
          </label>
        </>
      ) : null}

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
          アポ活動実施
          <span className="ml-0.5 text-red-500">*</span>
        </span>
        <select
          className={inputClass}
          value={form.apoActivity}
          onChange={(e) => {
            const next = e.target.value;
            onChange({
              ...form,
              apoActivity: next,
              ...(isWorkEndApoActivityImplemented(next)
                ? {}
                : {
                    pinponCount: "",
                    meetingCount: "",
                    apoCount: "",
                    workArea: "",
                  }),
            });
          }}
          disabled={disabled}
        >
          <option value="">選択してください</option>
          {WORK_END_REPORT_APO_ACTIVITY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
          ピンポン数
          {apoActivityRequired ? (
            <span className="ml-0.5 text-red-500">*</span>
          ) : null}
        </span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          className={inputClass}
          value={form.pinponCount}
          onChange={(e) =>
            onChange({ ...form, pinponCount: e.target.value })
          }
          disabled={detailFieldsDisabled}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
          面談数
          {apoActivityRequired ? (
            <span className="ml-0.5 text-red-500">*</span>
          ) : null}
        </span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          className={inputClass}
          value={form.meetingCount}
          onChange={(e) =>
            onChange({ ...form, meetingCount: e.target.value })
          }
          disabled={detailFieldsDisabled}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
          アポ獲得数
          {apoActivityRequired ? (
            <span className="ml-0.5 text-red-500">*</span>
          ) : null}
        </span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          className={inputClass}
          value={form.apoCount}
          onChange={(e) => onChange({ ...form, apoCount: e.target.value })}
          disabled={detailFieldsDisabled}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
          稼働エリア
          {apoActivityRequired ? (
            <span className="ml-0.5 text-red-500">*</span>
          ) : null}
        </span>
        <input
          type="text"
          className={inputClass}
          value={form.workArea}
          onChange={(e) => onChange({ ...form, workArea: e.target.value })}
          placeholder={
            apoActivityRequired ? "例: 奈良・大阪北部" : "実施時のみ入力"
          }
          disabled={detailFieldsDisabled}
        />
      </label>
    </div>
  );
}
