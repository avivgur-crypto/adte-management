import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import ConditionalShell from "@/app/components/ConditionalShell";
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

export const metadata: Metadata = {
  title: "Adte Management",
  description: "Adte management dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${plusJakarta.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <ConditionalShell>{children}</ConditionalShell>
      </body>
    </html>
  );
}
