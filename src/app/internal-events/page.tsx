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

function WeeklyWednesdayGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="3"
        y="4"
        width="18"
        height="18"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M3 10h18M8 2v4M16 2v4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M8 14h2v2H8v-2zm4 0h2v2h-2v-2z"
        fill="currentColor"
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

function LineSendListGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"
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
  "weekly-wednesday-schedule": <WeeklyWednesdayGlyph />,
  contacts: <ContactsGlyph />,
  "line-send-list": <LineSendListGlyph />,
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
