"use client";

import { useEffect, useId, useRef, useState } from "react";

export function CommentPreview({
  author,
  text,
  score,
  href,
}: {
  readonly author: string;
  readonly text: string | null;
  readonly score: number | null;
  readonly href: string;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const previewId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const closeOutside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [open]);

  return (
    <span className="comment-preview" ref={container}>
      <a
        className="comment-preview__author"
        href={href}
        onFocus={() => setOpen(true)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {author}
      </a>
      <button
        className="comment-preview__toggle"
        type="button"
        aria-expanded={open}
        aria-controls={previewId}
        aria-label={`Preview comment by ${author}`}
        onClick={() => setOpen((current) => !current)}
      >
        i
      </button>
      {open ? (
        <span
          className="comment-preview__body"
          id={previewId}
          role="region"
          aria-label={`Comment by ${author}`}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <span className="comment-preview__text">
            {text ?? "Comment unavailable."}
          </span>
          <span className="comment-preview__score">
            {score === null ? "Score unavailable" : `Score: ${score}`}
          </span>
          <a href={href}>Open comment on Hacker News</a>
        </span>
      ) : null}
    </span>
  );
}
