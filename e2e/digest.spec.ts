import { expect, test } from "@playwright/test";

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

test("reads the latest digest and preserves source provenance", async ({
  page,
}) => {
  await page.goto("/?fixture=complete");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Today on Hacker News.",
  );
  await expect(page.getByRole("article")).toContainText(
    "The result is compelling",
  );
  await expect(
    page.getByRole("link", { name: "Read original" }),
  ).toHaveAttribute("href", "https://example.com/article");
  await expect(page.getByRole("link", { name: "#44000123" })).toHaveAttribute(
    "href",
    /#44000123$/,
  );
  await expectNoHorizontalOverflow(page);
});

test("supports keyboard navigation to the reading content", async ({
  page,
}) => {
  await page.goto("/?fixture=complete");
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("explains partial and failed analysis without hiding sources", async ({
  page,
}) => {
  await page.goto("/?fixture=partial");
  await expect(page.getByText("2 of 2 stories")).toBeVisible();
  const failedStory = page.locator(".story-state[role='alert']");
  await expect(failedStory).toContainText("Analysis failed for this story");
  await expect(failedStory).toContainText("ANALYSIS_TERMINAL");
  await expect(
    page.getByRole("link", { name: "View HN discussion" }),
  ).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
});

test("renders empty and unavailable states", async ({ page }) => {
  await page.goto("/?fixture=empty");
  await expect(
    page.getByRole("heading", { name: "The first digest is being prepared." }),
  ).toBeVisible();
  await page.goto("/?fixture=unavailable");
  await expect(
    page.getByRole("heading", {
      name: "The latest digest could not be loaded.",
    }),
  ).toBeVisible();
});

test("shows a useful loading state while a digest is streamed", async ({
  page,
}) => {
  await page.goto("/?fixture=loading", { waitUntil: "commit" });
  await expect(
    page.getByRole("heading", { name: "Opening the latest digest." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Today on Hacker News." }),
  ).toBeVisible();
});
