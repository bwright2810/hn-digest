import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "./styles.css";
import { ThemeToggle } from "./theme-toggle";

export const metadata: Metadata = {
  title: {
    default: "HN Digest",
    template: "%s — HN Digest",
  },
  description: "Source-grounded Hacker News article and discussion digests.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('hn-digest-theme')==='light')document.documentElement.dataset.theme='light'}catch{}",
          }}
        />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <div className="site-shell">
          <header className="site-header">
            <Link className="wordmark" href="/" aria-label="HN Digest home">
              <span className="wordmark__mark" aria-hidden="true">
                Y
              </span>
              <span>HN Digest</span>
            </Link>
            <div className="site-actions">
              {/* Next may prefetch any same-origin anchor. A GET form keeps the
                  Basic challenge behind an intentional operator action. */}
              <form action="/admin" method="get">
                <button className="admin-navigation" type="submit">
                  Admin
                </button>
              </form>
              <ThemeToggle />
            </div>
          </header>
          {children}
          <footer className="site-footer">
            <p>A focused view of what Hacker News is reading and saying.</p>
            <a href="https://news.ycombinator.com/">Visit Hacker News</a>
          </footer>
        </div>
      </body>
    </html>
  );
}
