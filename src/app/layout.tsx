import type { Metadata } from "next";
import { DM_Sans, Playfair_Display, Yellowtail } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});
const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});
const yellowtail = Yellowtail({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-yellowtail",
  display: "swap",
});

export const metadata: Metadata = {
  title: "EBA Hub | ENI Brand Architect",
  description: "The official EBA employee workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${dmSans.variable} ${playfair.variable} ${yellowtail.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
