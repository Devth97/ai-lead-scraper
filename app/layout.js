import "./globals.css";

export const metadata = {
  title: "GrowPlus Lead Engine — AI Lead Scraper",
  description:
    "AI-qualified leads for growplus.site: scrape prospect websites, score them for GrowPlus fit, and push hot leads to n8n outreach automation.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
