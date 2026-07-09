"use client";

import { type ReactNode } from "react";

import { LiffMenuCard } from "@/components/liff-chrome";
import { InternalEventsLiffFrame } from "@/components/internal-events-liff-frame";
import { INTERNAL_EVENTS_SECTIONS } from "@/lib/internal-events-sections";

function MorningAssemblyGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 7v5l3 2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CompanyAssemblyGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3L2 8l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ContactsGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CultureGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 21s7-4.5 7-11a7 7 0 10-14 0c0 6.5 7 11 7 11z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

const SECTION_ICONS: Record<string, ReactNode> = {
  "morning-assembly": <MorningAssemblyGlyph />,
  "company-morning-assembly": <CompanyAssemblyGlyph />,
  contacts: <ContactsGlyph />,
  "trarchi-culture": <CultureGlyph />,
};

export default function InternalEventsPage() {
  return (
    <InternalEventsLiffFrame
      title="社内イベント"
      subtitle="社内イベント・社内情報を確認します"
      backHref="/"
      backLabel="ホームへ"
    >
      <div className="mt-6 flex flex-col gap-2">
        {INTERNAL_EVENTS_SECTIONS.map((section) => (
          <LiffMenuCard
            key={section.slug}
            href={`/internal-events/${section.slug}`}
            title={section.title}
            description={section.description}
            icon={SECTION_ICONS[section.slug]}
            iconTone="blue"
          />
        ))}
      </div>
    </InternalEventsLiffFrame>
  );
}
