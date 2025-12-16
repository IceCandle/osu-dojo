import './globals.css';

export const metadata = {
  title: 'osu!dojo',
  description: 'osu! dan course challenges',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
