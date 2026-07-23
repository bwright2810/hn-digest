import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { Client } from "pg";

import {
  createSubscriberActionToken,
  digestSubscriberValue,
} from "../src/subscribers/crypto";

const lookupKey = Buffer.alloc(32, 1);

test("completes signup, confirmation, preference, and unsubscribe lifecycle", async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.DATABASE_URL,
    "requires the migrated Playwright database",
  );
  const email = `newsletter-${testInfo.project.name}-${randomUUID()}@example.com`;
  const emailDigest = digestSubscriberValue(email, lookupKey, "email");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await page.goto("/newsletter");
    await expect(
      page.getByRole("heading", { name: "HN Digest in your inbox." }),
    ).toBeVisible();
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Morning").check();
    await page.getByRole("button", { name: "Send confirmation" }).click();
    await expect(page).toHaveURL(/state=check-email/u);
    await expect(page.getByRole("status")).toContainText(
      "If that address can receive a confirmation",
    );

    const subscriberResult = await client.query<{ id: string }>(
      "select id from subscribers where email_lookup_digest = $1",
      [emailDigest],
    );
    const subscriberId = subscriberResult.rows[0]?.id;
    expect(subscriberId).toBeTruthy();

    const confirmation = createSubscriberActionToken(lookupKey);
    await client.query(
      `update subscriber_action_tokens set token_digest = $1
       where subscriber_id = $2 and purpose = 'confirmation' and consumed_at is null`,
      [confirmation.digest, subscriberId],
    );
    await page.goto(
      `/newsletter/confirm?token=${encodeURIComponent(confirmation.token)}`,
    );
    await expect(
      page.getByRole("heading", { name: "Subscription confirmed." }),
    ).toBeVisible();

    const preference = createSubscriberActionToken(lookupKey);
    await insertPreferenceToken(client, subscriberId!, preference.digest);
    await page.goto(
      `/newsletter/preferences?token=${encodeURIComponent(preference.token)}`,
    );
    await expect(page.getByLabel("Morning")).toBeChecked();
    await expect(page.getByLabel("Evening")).not.toBeChecked();
    await page.getByLabel("Evening").check();
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByRole("status")).toContainText(
      "preferences have been saved",
    );

    const unsubscribe = createSubscriberActionToken(lookupKey);
    await insertPreferenceToken(client, subscriberId!, unsubscribe.digest);
    await page.goto(
      `/newsletter/preferences?token=${encodeURIComponent(unsubscribe.token)}`,
    );
    await page.getByRole("button", { name: "Unsubscribe from all" }).click();
    await expect(page.getByRole("status")).toContainText(
      "preferences have been saved",
    );

    const finalState = await client.query<{
      status: string;
      morning_enabled: boolean;
      evening_enabled: boolean;
    }>(
      "select status, morning_enabled, evening_enabled from subscribers where id = $1",
      [subscriberId],
    );
    expect(finalState.rows[0]).toEqual({
      status: "unsubscribed",
      morning_enabled: false,
      evening_enabled: false,
    });
    await expectNoHorizontalOverflow(page);
  } finally {
    await client.query(
      "delete from subscribers where email_lookup_digest = $1",
      [emailDigest],
    );
    await client.end();
  }
});

async function insertPreferenceToken(
  client: Client,
  subscriberId: string,
  tokenDigest: string,
) {
  await client.query(
    `insert into subscriber_action_tokens
      (subscriber_id, purpose, token_digest, token_key_version, expires_at)
     values ($1, 'preferences', $2, 1, now() + interval '1 day')`,
    [subscriberId, tokenDigest],
  );
}

async function expectNoHorizontalOverflow(
  page: import("@playwright/test").Page,
) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}
