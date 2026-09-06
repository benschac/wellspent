import type { Metadata } from "next";
import localFont from "next/font/local";
import { MarketingPage } from "./marketing-page";
import "./marketing.css";

const editorial = localFont({
  src: [
    {
      path: "../../public/marketing/fonts/instrument-serif.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/marketing/fonts/instrument-serif-italic.woff2",
      weight: "400",
      style: "italic",
    },
  ],
  variable: "--font-editorial",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Good Hours — Give your best hours to what matters",
  description:
    "A focus tool for people who build and create. Set an intention, give it your attention, and see what you made of the day. Coming to Mac, iOS, Android and web.",
  openGraph: {
    title: "Good Hours — Give your best hours to what matters",
    description:
      "Focus now. Understand later. A little space for your best work.",
    type: "website",
  },
};

export default function Page() {
  const configuredUrl = process.env.GOOD_HOURS_WAITLIST_URL;
  let waitlistUrl: string | undefined;
  if (configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);
      if (parsed.protocol === "https:") waitlistUrl = parsed.href;
    } catch {
      // An unconfigured preview must never pretend to collect a signup.
    }
  }
  return (
    <MarketingPage className={editorial.variable} waitlistUrl={waitlistUrl} />
  );
}
