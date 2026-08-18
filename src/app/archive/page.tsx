import Link from "next/link";

import { getConfig } from "../../config/server";
import {
  PostgresDigestReader,
  type DigestArchiveEntry,
} from "../../digests/reader";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeZone: "America/New_York",
});

export default async function ArchivePage() {
  const config = getConfig();
  let entries: readonly DigestArchiveEntry[] = [];
  let unavailable = false;
  try {
    entries = await new PostgresDigestReader().archive({
      ...config.schedule,
      limit: 60,
    });
  } catch {
    unavailable = true;
  }

  return (
    <main id="main-content" className="page archive-page" tabIndex={-1}>
      <section className="page-intro" aria-labelledby="archive-title">
        <p className="eyebrow">The back catalogue</p>
        <h1 id="archive-title">Digest archive</h1>
        <p className="page-intro__summary">
          Browse published morning and evening editions by local date.
        </p>
      </section>

      {unavailable ? (
        <ArchiveState
          title="The archive is temporarily unavailable."
          detail="Try again in a moment."
        />
      ) : entries.length === 0 ? (
        <ArchiveState
          title="There are no published editions yet."
          detail="Completed morning and evening editions will appear here."
        />
      ) : (
        <ol className="archive-list" aria-label="Published digest editions">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Link
                className="archive-entry"
                href={`/archive/${entry.date}/${entry.edition}`}
              >
                <span>
                  <span className="archive-entry__date">
                    {formatArchiveDate(entry.date)}
                  </span>
                  <span className="archive-entry__edition">
                    {entry.edition} edition
                  </span>
                </span>
                <span className={`status status--${entry.status}`}>
                  {entry.status}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function ArchiveState({
  title,
  detail,
}: {
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <section className="notice archive-notice" aria-labelledby="archive-state">
      <h2 id="archive-state">{title}</h2>
      <p>{detail}</p>
    </section>
  );
}

function formatArchiveDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return dateFormatter.format(new Date(Date.UTC(year!, month! - 1, day!)));
}
