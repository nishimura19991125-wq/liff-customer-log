import { LiffCard } from "@/components/liff-chrome";
import type { MeetingScheduleItem } from "@/lib/meeting-schedule-types";

type Props = {
  item: MeetingScheduleItem;
  staffName: string;
};

export function MeetingScheduleItemCard({ item, staffName }: Props) {
  return (
    <LiffCard>
      <div className="flex items-start gap-3 px-4 py-4">
        <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-sky-50 py-2 dark:bg-sky-950/40">
          <span className="text-[11px] font-medium text-sky-700 dark:text-sky-300">
            開始
          </span>
          <span className="text-[18px] font-black tabular-nums leading-none text-sky-900 dark:text-sky-100">
            {item.meetingTime}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-bold leading-snug text-slate-900 dark:text-white">
            {item.customerName}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.city ? (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {item.city}
              </span>
            ) : null}
            {item.apoTypeLabel ? (
              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[12px] font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                {item.apoTypeLabel}
              </span>
            ) : null}
            {item.estimateStatus ? (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[12px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {item.estimateStatus}
              </span>
            ) : null}
          </div>
          {item.meetingPlace ? (
            <p className="mt-2 text-[13px] text-slate-600 dark:text-slate-400">
              商談場所: {item.meetingPlace}
            </p>
          ) : null}
          {item.apPerson && item.apPerson !== staffName ? (
            <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-500">
              AP: {item.apPerson}
            </p>
          ) : null}
        </div>
      </div>
    </LiffCard>
  );
}
