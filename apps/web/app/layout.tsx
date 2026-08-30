import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { QueryProvider } from "./query-provider";

export const metadata: Metadata = {
  description: "Bun, Turborepo, Next.js, Expo, NestJS, and oRPC starter",
  title: "Timer Monorepo",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
