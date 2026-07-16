"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useLiffSwr } from "@/hooks/use-liff-swr";
import {
  clearMissingDocumentsAlertSessionCollapse,
  isMissingDocumentsAlertCollapsed,
  setMissingDocumentsAlertCollapsed,
} from "@/lib/missing-documents-cache";

type Props = {
  idToken: string | null;
  boundStaffName: string | null;
  disabled?: boolean;
};

type CustomersApiBody = {
  customers?: Array<{
    recordId: string;
    customerName: string;
    isDocumentMissing?: boolean;
  }>;
  needsStaffBind?: boolean;
};

export function HomeMissingDocumentsAlert({
  idToken,
  boundStaffName,
  disabled = false,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const swrPath =
    idToken && boundStaffName && !disabled
      ? "/api/customers?filter=missing_docs"
      : null;

  const { data } = useLiffSwr<CustomersApiBody>(swrPath, idToken, {
    dedupingInterval: 10 * 60 * 1000,
    focusThrottleInterval: 10 * 60 * 1000,
    revalidateOnFocus: false,
  });

  const items = useMemo(
    () =>
      (data?.customers ?? []).map((r) => ({
        recordId: r.recordId,
        customerName: r.customerName,
      })),
    [data?.customers],
  );

  useEffect(() => {
    setCollapsed(isMissingDocumentsAlertCollapsed());
    setHydrated(true);
    return () => {
      clearMissingDocumentsAlertSessionCollapse();
    };
  }, []);

  const handleCollapse = () => {
    setMissingDocumentsAlertCollapsed();
    setCollapsed(true);
  };

  if (!hydrated || !boundStaffName || disabled || items.length === 0) {
    return null;
  }

  if (collapsed) {
    return (
      <section aria-label="書類未回収の警告（折りたたみ中）">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left text-[14px] font-semibold text-red-900 shadow-sm transition-colors active:scale-[0.99] dark:border-red-900 dark:bg-red-950/30 dark:text-red-100 dark:shadow-[0_0_15px_rgba(239,68,68,0.1)]"
        >
          🚨 書類未回収が {items.length} 件あります（タップで表示）
        </button>
      </section>
    );
  }

  return (
    <section
      className="relative rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm dark:border-red-900 dark:bg-red-950/30 dark:shadow-[0_0_15px_rgba(239,68,68,0.1)]"
      aria-label="書類未回収の警告"
    >
      <button
        type="button"
        onClick={handleCollapse}
        className="absolute right-3 top-3 rounded-lg px-2 py-1 text-[12px] font-semibold text-red-800 underline underline-offset-2 dark:text-red-200"
        aria-label="警告を折りたたむ"
      >
        閉じる
      </button>
      <p className="pr-16 text-[15px] font-bold text-red-900 dark:text-red-100">
        🚨 書類未回収が {items.length} 件あります
      </p>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[14px] text-red-900 dark:text-red-100">
        {items.map((row) => (
          <li key={row.recordId}>
            <Link
              href={`/customer-list/${encodeURIComponent(row.recordId)}`}
              className="font-semibold underline underline-offset-2 hover:text-red-700 dark:hover:text-red-200"
            >
              {row.customerName}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
