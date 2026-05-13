/**
 * ROOT LAYOUT — Next.js App Router
 * ================================
 * This file wraps every page. In Next.js's App Router, `layout.tsx` is
 * a special file that defines the shell. The `children` prop is whatever
 * page is being rendered (in our case: app/page.tsx).
 *
 * Anything in <html> or <body> here applies app-wide:
 * - Fonts (loaded once, cached)
 * - PWA metadata
 * - Theme colors for the phone's status bar
 *
 * Next.js learn note: `export const metadata` is how you set <title>,
 * <meta>, and <link> tags. No need to write raw <head> tags. Next.js
 * injects them automatically based on this object.
 */
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ATLAS",
  description: "Your personal AI coding agent — talks to your GitHub repos",
  applicationName: "ATLAS",
  appleWebApp: {
    capable: true,
    title: "ATLAS",
    statusBarStyle: "black-translucent",
  },
  manifest: "/manifest.webmanifest",
};

// `viewport` is split out from `metadata` in newer Next.js versions.
// It controls how the page renders on phone screens.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover", // for iPhone notch / Dynamic Island
  themeColor: "#04070d",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-bg text-text font-mono">
        {children}
      </body>
    </html>
  );
}
