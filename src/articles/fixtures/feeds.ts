export const rssFixture = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Fixture feed</title>
    <item>
      <guid>fixture-entry-1</guid>
      <title>First bounded entry</title>
      <dc:creator>Ada Example</dc:creator>
      <pubDate>Wed, 22 Jul 2026 14:30:00 GMT</pubDate>
      <content:encoded><![CDATA[<p>First paragraph.</p><p>Second paragraph.</p>]]></content:encoded>
    </item>
    <item><guid>fixture-entry-2</guid><description>Not selected.</description></item>
  </channel>
</rss>`;

export const atomFixture = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Fixture feed</title>
  <entry>
    <id>tag:example.test,2026:entry-1</id>
    <title>First Atom entry</title>
    <author><name>Grace Example</name></author>
    <updated>2026-07-22T14:30:00Z</updated>
    <content type="html">&lt;p&gt;Atom body.&lt;/p&gt;</content>
  </entry>
</feed>`;
