import "./globals.css";

export const metadata = {
  title: "AI Lead Scraper — AI Trity",
  description:
    "Paste website URLs, extract business leads with AI, and push them to your n8n outreach automation.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
