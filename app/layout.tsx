import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Unbounded } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { SfxToggle } from "@/components/sfx-toggle";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const unbounded = Unbounded({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
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

// Discord uses the first `theme-color` meta for the embed's left bar;
// Safari/iOS uses it for the address bar tint.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f43f5e" },
    { media: "(prefers-color-scheme: dark)", color: "#6366f1" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} ${unbounded.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider>
          <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
            <SfxToggle />
            <ThemeToggle />
          </div>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
