"use client";

import Link from "next/link";

import { LiffCard } from "@/components/liff-chrome";
import { MapNavigationButton } from "@/components/map-navigation-button";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import type { ConstructionHandlerHomePayload } from "@/lib/calendar-api-types";
import { LIFF_SWR_DEFAULT_OPTIONS } from "@/lib/liff-swr";
import { buildMapNavigation } from "@/lib/map-navigation";

type Props = {
  idToken: string | null;
  boundStaffName: string | null;
  disabled?: boolean;
};

export function HomeConstructionHandlerCases({
  idToken,
  boundStaffName,
  disabled = false,
}: Props) {
  const swrPath =
    idToken && boundStaffName && !disabled
      ? "/api/calendar/my-construction-cases"
      : null;

  const { data, isLoading } = useLiffSwr<ConstructionHandlerHomePayload>(
    swrPath,
    idToken,
    LIFF_SWR_DEFAULT_OPTIONS,
  );

  if (!boundStaffName || disabled) return null;

  if (isLoading && !data) {
    return (
      <section aria-label="工事対応案件（読み込み中）">
        <LiffCard>
          <div className="px-4 py-4">
            <p className="text-[14px] text-slate-500 dark:text-slate-400">
              工事対応案件を読み込み中…
            </p>
          </div>
        </LiffCard>
      </section>
    );
  }

  if (!data || data.needsStaffBind || data.disabled || !data.configured) {
    return null;
  }

  if (data.error && data.items.length === 0) {
    return null;
  }

  const items = data.items ?? [];
  if (items.length === 0) return null;

  return (
    <section aria-label="工事対応案件（本日以降）">
      <LiffCard>
        <div className="px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-bold tracking-tight text-slate-800 dark:text-white">
                工事対応（本日以降）
              </p>
              <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
                {items.length}件 · ピンポイントナビで現場へ
              </p>
            </div>
            <Link
              href="/calendar"
              className="shrink-0 text-[12px] font-semibold text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300"
            >
              カレンダー
            </Link>
          </div>

          <ul className="mt-3 flex flex-col gap-3">
            {items.map((item) => {
              const canNavigate = Boolean(
                buildMapNavigation({
                  pinpointAddress: item.pinpointAddress,
                  normalAddress: item.normalAddress,
                }),
              );
              const meta = [
                item.nextDateLabel,
                item.segmentLabel,
                item.housingShort,
                item.contractorName
                  ? `施工: ${item.contractorName}`
                  : "",
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <li
                  key={item.recordId}
                  className="rounded-xl border border-slate-200/90 bg-slate-50/80 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/40"
                >
                  <div className="min-w-0">
                    <p className="text-[14px] font-bold leading-snug text-slate-900 dark:text-white">
                      {item.customerName}
                      {item.customerName.endsWith("様") ? "" : "様"}
                    </p>
                    <p className="mt-1 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
                      {meta}
                      {item.upcomingDayCount > 1
                        ? `（ほか${item.upcomingDayCount - 1}日）`
                        : ""}
                    </p>
                  </div>
                  {canNavigate ? (
                    <div className="mt-2.5">
                      <MapNavigationButton
                        pinpointAddress={item.pinpointAddress}
                        normalAddress={item.normalAddress}
                      />
                    </div>
                  ) : (
                    <p className="mt-2 text-[12px] font-medium text-amber-800 dark:text-amber-200">
                      住所・ピンポイント未登録のためナビできません
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </LiffCard>
    </section>
  );
}
