export const WORK_END_REPORT_APO_ACTIVITY_OPTIONS = [
  "実施",
  "未実施",
] as const;

export const WORK_END_REPORT_APO_ACTIVITY_IMPLEMENTED = "実施";

export function isWorkEndApoActivityImplemented(apoActivity: string): boolean {
  return apoActivity.trim() === WORK_END_REPORT_APO_ACTIVITY_IMPLEMENTED;
}

export type WorkEndReportFormValues = {
  pinponCount: string;
  meetingCount: string;
  apoCount: string;
  apoActivity: string;
  workArea: string;
};

export type WorkEndReportRecordSnapshot = {
  pinponCount?: string;
  meetingCount?: string;
  apoCount?: string;
  apoActivity?: string;
  workArea?: string;
};

export type WorkEndReportStatus = {
  configured: boolean;
  configError?: string;
  needsStaffBind?: boolean;
  staffName?: string;
  /** 本日（JST） */
  reportDate?: string;
  /** 本日分の報告が既にあるとき */
  reportedAt?: string | null;
  recordId?: string | null;
  canReport: boolean;
  reported?: boolean;
  department?: string | null;
  existingReport?: WorkEndReportRecordSnapshot | null;
};
