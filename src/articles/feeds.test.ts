import { describe, expect, it } from "vitest";

import { parseFeedEntry } from "./feeds";
import { atomFixture, rssFixture } from "./fixtures/feeds";

describe("hardened feed parsing", () => {
  it("selects the first RSS item deterministically with stable evidence", () => {
    expect(parseFeedEntry(rssFixture)).toEqual({
      status: "parsed",
      kind: "rss",
      entryId: "fixture-entry-1",
      title: "First bounded entry",
      author: "Ada Example",
      publishedAt: new Date("2026-07-22T14:30:00Z"),
      text: "First paragraph.\n\nSecond paragraph.",
    });
  });

  it("selects the first namespaced Atom entry without following its links", () => {
    expect(parseFeedEntry(atomFixture)).toEqual({
      status: "parsed",
      kind: "atom",
      entryId: "tag:example.test,2026:entry-1",
      title: "First Atom entry",
      author: "Grace Example",
      publishedAt: new Date("2026-07-22T14:30:00Z"),
      text: "Atom body.",
    });
  });

  it.each([
    [
      "DTD",
      `<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss><channel><item><description>&xxe;</description></item></channel></rss>`,
      "prohibited_xml_declaration",
    ],
    [
      "XInclude",
      `<rss xmlns:xi="http://www.w3.org/2001/XInclude"><channel><item><description>Fixture</description><xi:include href="file:///etc/passwd"/></item></channel></rss>`,
      "prohibited_xinclude",
    ],
    [
      "generic XML",
      `<document><entry>Fixture</entry></document>`,
      "generic_xml_unsupported",
    ],
    [
      "sitemap",
      `<urlset><url><loc>https://example.test/</loc></url></urlset>`,
      "generic_xml_unsupported",
    ],
    ["malformed XML", `<rss><channel>`, "malformed_feed_xml"],
  ])("rejects %s", (_name, xml, reason) => {
    expect(parseFeedEntry(xml)).toEqual({ status: "unsupported", reason });
  });

  it("rejects entries without usable content", () => {
    expect(
      parseFeedEntry(
        `<rss><channel><item><guid>empty</guid><title>Only a title</title></item></channel></rss>`,
      ),
    ).toEqual({
      status: "unsupported",
      reason: "feed_entry_missing_content",
    });
  });
});
