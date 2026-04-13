import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { getSessionUser } from "@/app/actions/auth";
import ConditionalShell from "@/app/components/ConditionalShell";
import ServiceWorkerRegister from "@/app/components/ServiceWorkerRegister";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-adte-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#000000",
};

export const metadata: Metadata = {
  title: "Adtex - Adte's Management App",
  description: "Adtex — Adte's management app",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png", sizes: "48x48" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Adtex",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialUser = await getSessionUser();

  return (
    <html
      lang="en"
      className="dark"
      style={{ backgroundColor: "#000000", colorScheme: "dark" }}
    >
      <body
        className={`${plusJakarta.variable} ${geistMono.variable} font-sans antialiased`}
        style={{
          backgroundColor: "#000000",
          color: "#ffffff",
          minHeight: "100%",
        }}
      >
        <ConditionalShell initialUser={initialUser}>{children}</ConditionalShell>
        <ServiceWorkerRegister />
        <Analytics />
      </body>
    </html>
  );
}
