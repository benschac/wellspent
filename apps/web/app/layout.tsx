import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { BackendProfileBanner } from "./backend-profile-banner";
import { QueryProvider } from "./query-provider";

export const metadata: Metadata = {
  description: "Bun, Turborepo, Next.js, Expo, NestJS, and oRPC starter",
  title: "Timer Monorepo",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <BackendProfileBanner />
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
