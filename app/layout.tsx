import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Unbounded } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { SfxToggle } from "@/components/sfx-toggle";
import { UserMenu } from "@/components/user-menu";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/profile";
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
    // Hex mirrors --game-canvas-yellow (light) / --game-canvas-dark (dark).
    // theme-color is consumed by Discord embeds + Safari — must be literal hex.
    { media: "(prefers-color-scheme: light)", color: "#ffe15e" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0920" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Touching cookies here makes the whole layout dynamic (per-request),
  // which is necessary for UserMenu to render the right state on the first
  // paint after a magic-link / OAuth redirect. Otherwise Next would serve
  // a static copy that still shows "Sign in".
  const supabase = await createSupabaseServerClient();
  const profile = await getCurrentProfile(supabase);
  const initialAuth = profile
    ? {
        isAnon: false as const,
        profile: {
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
          handle: profile.handle,
        },
      }
    : { isAnon: true as const, profile: null };

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
            <UserMenu
              initialIsAnon={initialAuth.isAnon}
              initialProfile={initialAuth.profile}
            />
          </div>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
