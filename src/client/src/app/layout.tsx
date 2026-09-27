import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono, Jost, Playfair_Display } from "next/font/google";
import "./globals.css";
import { AppearanceProvider, appearanceScript } from "@/components/providers/appearance";
import { SessionProvider } from "@/components/providers/session-provider";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AppMobileNav } from "@/components/layout/app-mobile-nav";
import { ShellProvider } from "@/components/providers/shell-context";

// Four families and nothing else, every one under the SIL Open Font Licence and self-hosted by next/font (downloaded at
// build time, no CDN at runtime): Jost (display headings), DM Sans (text), Playfair Display italic (accent phrases) and
// JetBrains Mono (labels and figures). The accent face is only fetched by pages that use it, so it is not preloaded.
const jost = Jost({ subsets: ["latin"], variable: "--font-jost", display: "swap" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });
const playfair = Playfair_Display({ subsets: ["latin"], style: ["italic"], weight: ["500"], variable: "--font-playfair", display: "swap", preload: false });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: "podium",
  icons: { icon: "/favicon.svg" },
  description:
    "A self-hostable hackathon submission and judging platform with weighted rubrics, cross-judge normalization and server-enforced role isolation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${dmSans.variable} ${jost.variable} ${playfair.variable} ${jetbrains.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceScript }} />
      </head>
      <body className="min-h-dvh bg-bg font-sans text-body text-text">
        <AppearanceProvider>
          <SessionProvider>
            <ShellProvider>
              <a
                href="#content"
                className="sr-only rounded-[10px] bg-action px-4 py-2.5 text-ui text-action-fg focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100]"
              >
                Skip to content
              </a>
              <SiteHeader />
              <div id="content" tabIndex={-1} className="outline-none">
                {children}
              </div>
              <SiteFooter />
              <div className="h-[calc(64px+env(safe-area-inset-bottom))] md:hidden print:hidden" aria-hidden="true" />
              <AppMobileNav />
            </ShellProvider>
          </SessionProvider>
        </AppearanceProvider>
      </body>
    </html>
  );
}
