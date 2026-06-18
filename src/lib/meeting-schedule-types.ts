export type MeetingScheduleItem = {
  customerName: string;
  city: string;
  meetingTime: string;
  apoTypeLabel: string;
  estimateStatus: string;
  meetingPlace: string;
  apPerson: string;
  clPerson: string;
  sortMinutes: number;
};

export type MeetingSchedulePayload = {
  configured: boolean;
  date: string;
  dateLabel: string;
  staffName: string;
  items: MeetingScheduleItem[];
  error?: string;
};
