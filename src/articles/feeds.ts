import { createHash } from "node:crypto";

import { convert } from "html-to-text";
import { JSDOM } from "jsdom";

const ATOM_NAMESPACE = "http://www.w3.org/2005/Atom";
const XINCLUDE_NAMESPACE = "http://www.w3.org/2001/XInclude";
const prohibitedDeclaration = /<!(?:DOCTYPE|ENTITY)\b/iu;

export type FeedEntryParseResult =
  | {
      readonly status: "parsed";
      readonly kind: "rss" | "atom";
      readonly entryId: string;
      readonly title: string | null;
      readonly author: string | null;
      readonly publishedAt: Date | null;
      readonly text: string;
    }
  | { readonly status: "unsupported"; readonly reason: string };

export function parseFeedEntry(
  content: string | Uint8Array,
): FeedEntryParseResult {
  let xml: string;
  try {
    xml =
      typeof content === "string"
        ? content
        : new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return unsupported("invalid_utf8_feed");
  }
  if (prohibitedDeclaration.test(xml)) {
    return unsupported("prohibited_xml_declaration");
  }

  let document: Document;
  try {
    document = new JSDOM(xml, { contentType: "application/xml" }).window
      .document;
  } catch {
    return unsupported("malformed_feed_xml");
  }
  if (
    document.getElementsByTagNameNS(XINCLUDE_NAMESPACE, "include").length > 0
  ) {
    return unsupported("prohibited_xinclude");
  }

  const root = document.documentElement;
  if (root.localName === "rss") return parseRss(root);
  if (root.localName === "feed" && root.namespaceURI === ATOM_NAMESPACE) {
    return parseAtom(root);
  }
  return unsupported("generic_xml_unsupported");
}

function parseRss(root: Element): FeedEntryParseResult {
  const channel = directChild(root, "channel");
  const entry = channel ? directChild(channel, "item") : null;
  if (!entry) return unsupported("rss_entry_missing");
  const title = elementText(directChild(entry, "title"));
  const body = richElementText(
    directChild(entry, "encoded") ?? directChild(entry, "description"),
  );
  if (!body) return unsupported("feed_entry_missing_content");
  const guid = elementText(directChild(entry, "guid"));
  const link = elementText(directChild(entry, "link"));
  return {
    status: "parsed",
    kind: "rss",
    entryId: boundedEntryId(guid ?? link ?? "rss:entry-1"),
    title,
    author: elementText(
      directChild(entry, "creator") ?? directChild(entry, "author"),
    ),
    publishedAt: parsedDate(elementText(directChild(entry, "pubDate"))),
    text: body,
  };
}

function parseAtom(root: Element): FeedEntryParseResult {
  const entry = directChild(root, "entry", ATOM_NAMESPACE);
  if (!entry) return unsupported("atom_entry_missing");
  const title = richElementText(directChild(entry, "title", ATOM_NAMESPACE));
  const body = richElementText(
    directChild(entry, "content", ATOM_NAMESPACE) ??
      directChild(entry, "summary", ATOM_NAMESPACE),
  );
  if (!body) return unsupported("feed_entry_missing_content");
  const id = elementText(directChild(entry, "id", ATOM_NAMESPACE));
  const link = directChildren(entry, "link", ATOM_NAMESPACE).find(
    (candidate) =>
      !candidate.getAttribute("rel") ||
      candidate.getAttribute("rel") === "alternate",
  );
  const authorElement = directChild(entry, "author", ATOM_NAMESPACE);
  return {
    status: "parsed",
    kind: "atom",
    entryId: boundedEntryId(id ?? link?.getAttribute("href") ?? "atom:entry-1"),
    title,
    author: authorElement
      ? elementText(directChild(authorElement, "name", ATOM_NAMESPACE))
      : null,
    publishedAt: parsedDate(
      elementText(
        directChild(entry, "published", ATOM_NAMESPACE) ??
          directChild(entry, "updated", ATOM_NAMESPACE),
      ),
    ),
    text: body,
  };
}

function directChild(
  parent: Element,
  localName: string,
  namespace?: string,
): Element | null {
  return directChildren(parent, localName, namespace)[0] ?? null;
}

function directChildren(
  parent: Element,
  localName: string,
  namespace?: string,
): Element[] {
  return [...parent.children].filter(
    (child) =>
      child.localName === localName &&
      (namespace === undefined || child.namespaceURI === namespace),
  );
}

function elementText(element: Element | null): string | null {
  return normalizeText(element?.textContent ?? "");
}

function richElementText(element: Element | null): string | null {
  if (!element) return null;
  const value = element.textContent ?? "";
  if (!/<[a-z][\s\S]*>/iu.test(value)) return normalizeText(value);
  return normalizeText(
    convert(value, {
      baseElements: { selectors: ["body"] },
      selectors: [
        { selector: "a", options: { ignoreHref: true } },
        { selector: "img", format: "skip" },
      ],
      wordwrap: false,
    }),
  );
}

function normalizeText(value: string): string | null {
  const normalized = value
    .replace(/\u00a0/gu, " ")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
  return normalized || null;
}

function parsedDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function boundedEntryId(value: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, "").trim();
  if (normalized.length > 0 && normalized.length <= 200) return normalized;
  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

function unsupported(reason: string): FeedEntryParseResult {
  return { status: "unsupported", reason };
}
