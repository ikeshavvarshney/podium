import { EventShell } from "@/components/layout/event-shell";

/** The event-scoped shell for every screen under /events/<slug>. */
export default async function EventLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <EventShell slug={slug}>{children}</EventShell>;
}
