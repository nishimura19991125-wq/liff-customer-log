import { INTERNAL_EVENTS_SECTIONS } from "@/lib/internal-events-sections";

export function generateStaticParams() {
  return INTERNAL_EVENTS_SECTIONS.map((section) => ({ slug: section.slug }));
}
