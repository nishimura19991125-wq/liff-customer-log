"use client";

import { use } from "react";
import { notFound } from "next/navigation";

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
          <div className="px-5 py-6">
            {section.body.map((paragraph, index) => (
              <p
                key={`${section.slug}-${index}`}
                className={`text-[14px] leading-relaxed text-slate-700 dark:text-slate-200 ${
                  index > 0 ? "mt-4" : ""
                } whitespace-pre-wrap`}
              >
                {paragraph}
              </p>
            ))}
          </div>
        </LiffCard>
      </div>
    </InternalEventsLiffFrame>
  );
}
