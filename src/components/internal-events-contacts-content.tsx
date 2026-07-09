"use client";

import { parsePhoneDigits } from "@/lib/customer-info-form/phone-number";
import { useLiffIdToken } from "@/lib/liff-id-token-context";
import { useLiffSwr } from "@/hooks/use-liff-swr";

type ContactsApiResponse = {
  configured?: boolean;
  error?: string;
  groups: Array<{
    department: string;
    contacts: Array<{ staffName: string; phone: string }>;
  }>;
};

function ContactsDepartmentGroup({
  department,
  contacts,
}: {
  department: string;
  contacts: Array<{ staffName: string; phone: string }>;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-sm dark:border-emerald-900/45 dark:bg-slate-900/45">
      <div className="border-b border-emerald-100/80 bg-emerald-50 px-4 py-2.5 dark:border-emerald-900/40 dark:bg-emerald-950/35">
        <p className="text-[14px] font-extrabold leading-snug text-emerald-900 dark:text-emerald-200">
          {department}
        </p>
        <div className="mt-1 flex justify-between gap-3 text-[11px] font-bold tracking-wide text-emerald-800/70 dark:text-emerald-300/80">
          <span>スタッフ名</span>
          <span>連絡先</span>
        </div>
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {contacts.map((contact) => {
          const tel = parsePhoneDigits(contact.phone);
          return (
            <li
              key={`${department}-${contact.staffName}-${contact.phone}`}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="min-w-0 text-[14px] font-semibold leading-snug text-slate-900 dark:text-slate-100">
                {contact.staffName}
              </span>
              {contact.phone ? (
                <a
                  href={tel ? `tel:${tel}` : undefined}
                  className="shrink-0 text-[14px] font-medium text-emerald-700 underline decoration-emerald-300 underline-offset-2 dark:text-emerald-300"
                >
                  {contact.phone}
                </a>
              ) : (
                <span className="shrink-0 text-[13px] text-slate-400">—</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function InternalEventsContactsContent() {
  const idToken = useLiffIdToken();
  const { data, error, isLoading } = useLiffSwr<ContactsApiResponse>(
    "/api/internal-events/contacts",
    idToken,
  );

  if (isLoading || !idToken) {
    return (
      <p className="py-6 text-center text-[14px] text-slate-500">読み込み中…</p>
    );
  }

  if (error) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-3 text-[14px] text-red-800 ring-1 ring-red-100 dark:bg-red-950/30 dark:text-red-200 dark:ring-red-900/40">
        {error.message || "連絡先一覧の取得に失敗しました"}
      </p>
    );
  }

  if (!data?.configured) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-3 text-[14px] text-amber-950 ring-1 ring-amber-100 dark:bg-amber-950/25 dark:text-amber-100 dark:ring-amber-900/40">
        {data?.error ||
          "スタッフ名簿との連携設定を確認してください（STAFF_APP_ID・氏名・部署・連絡先の列）。"}
      </p>
    );
  }

  if (!data.groups.length) {
    return (
      <p className="py-6 text-center text-[14px] text-slate-500">
        表示できる連絡先がありません。
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {data.groups.map((group) => (
        <ContactsDepartmentGroup
          key={group.department}
          department={group.department}
          contacts={group.contacts}
        />
      ))}
    </div>
  );
}
