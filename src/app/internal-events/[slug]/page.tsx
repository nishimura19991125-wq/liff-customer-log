"use client";

import { use } from "react";
import { notFound } from "next/navigation";

import { InternalEventsSectionContent } from "@/components/internal-events-section-content";
import { LiffCard } from "@/components/liff-chrome";
import { InternalEventsLiffFrame } from "@/components/internal-events-liff-frame";
import { internalEventsSectionBySlug } from "@/lib/internal-events-sections";

export default function InternalEventsSectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const section = internalEventsSectionBySlug(slug);
  if (!section) notFound();

  return (
    <InternalEventsLiffFrame title={section.title} subtitle={section.description}>
      <div className="mt-6">
        <LiffCard>
          <div className="px-4 py-5 sm:px-5 sm:py-6">
            <InternalEventsSectionContent content={section.content} />
          </div>
        </LiffCard>
      </div>
    </InternalEventsLiffFrame>
  );
}
