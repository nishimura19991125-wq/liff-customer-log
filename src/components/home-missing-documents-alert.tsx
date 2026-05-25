"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  clearMissingDocumentsAlertSessionCollapse,
  isMissingDocumentsAlertCollapsed,
  readMissingDocumentsCache,
  setMissingDocumentsAlertCollapsed,
  writeMissingDocumentsCache,
  type MissingDocumentAlertItem,
} from "@/lib/missing-documents-cache";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";

type Props = {
  idToken: string | null;
  boundStaffName: string | null;
  disabled?: boolean;
};

type ApiCustomerRow = {
  recordId: string;
  customerName: string;
};

export function HomeMissingDocumentsAlert({
  idToken,
  boundStaffName,
  disabled = false,
}: Props) {
  const [items, setItems] = useState<MissingDocumentAlertItem[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setCollapsed(isMissingDocumentsAlertCollapsed());
    const cached = readMissingDocumentsCache();
    if (cached) setItems(cached.items);
    setHydrated(true);
    return () => {
      clearMissingDocumentsAlertSessionCollapse();
    };
  }, []);

  const load = useCallback(async () => {
    if (!idToken || disabled || !boundStaffName) {
      setItems([]);
      return;
    }

    try {
      const res = await fetch("/api/customers?filter=missing_docs", {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = (await res.json()) as {
        customers?: ApiCustomerRow[];
        needsStaffBind?: boolean;
        error?: string;
      };
      if (isLineSessionExpiredPayload(data)) return;
      if (!res.ok || data.needsStaffBind) {
        setItems([]);
        return;
      }

      const next = (data.customers ?? []).map((row) => ({
        recordId: row.recordId,
        customerName: row.customerName,
      }));
      setItems(next);
      writeMissingDocumentsCache(next);
    } catch {
      /* キャッシュ表示を維持 */
    }
  }, [idToken, boundStaffName, disabled]);

  useEffect(() => {
    if (!hydrated) return;
    void load();
  }, [hydrated, load]);

  const handleCollapse = () => {
    setMissingDocumentsAlertCollapsed();
    setCollapsed(true);
  };

  if (!hydrated || !boundStaffName || disabled || items.length === 0) {
    return null;
  }

  if (collapsed) {
    return (
      <section className="mb-4" aria-label="書類未回収の警告（折りたたみ中）">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left text-[14px] font-semibold text-red-900 shadow-sm transition-colors active:scale-[0.99] dark:border-red-900 dark:bg-red-950/30 dark:text-red-100"
        >
          🚨 書類未回収が {items.length} 件あります（タップで表示）
        </button>
      </section>
    );
  }

  return (
    <section
      className="relative mb-4 rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm dark:border-red-900 dark:bg-red-950/30"
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
