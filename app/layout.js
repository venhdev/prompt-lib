import "./globals.css";

export const metadata = {
  title: "Prompt Library",
  description: "A private library for reusable AI prompts and version history.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
