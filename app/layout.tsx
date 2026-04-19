import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Promptionary",
  description:
    "Pictionary, in reverse. An AI paints from a secret prompt — you guess the prompt.",
  metadataBase: new URL("https://promptionary.io"),
  openGraph: {
    title: "Promptionary",
    description:
      "Pictionary, in reverse. Guess the prompt behind the AI's painting.",
    url: "https://promptionary.io",
    siteName: "Promptionary",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Promptionary",
    description:
      "Pictionary, in reverse. Guess the prompt behind the AI's painting.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
