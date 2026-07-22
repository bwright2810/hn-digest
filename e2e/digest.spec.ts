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
  const response = await page.goto("/?fixture=complete");

  expect(response?.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");

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

test("does not prefetch the Basic-authenticated admin page", async ({
  page,
}) => {
  const adminRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/admin"))
      adminRequests.push(request.url());
  });

  await page.goto("/?fixture=complete");
  await page.waitForTimeout(750);
  expect(adminRequests).toEqual([]);
  await expect(page.getByRole("button", { name: "Admin" })).toBeVisible();
});

test("defaults to dark mode, persists the theme choice, and uses desktop width", async ({
  page,
}, testInfo) => {
  await page.goto("/?fixture=complete");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  if (testInfo.project.name === "desktop") {
    const width = await page
      .locator(".takeaway__body:visible")
      .evaluate((element) => element.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(700);
  }
  await expectNoHorizontalOverflow(page);
});

test("protects operator diagnostics with HTTP Basic authentication", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const anonymous = await browser.newContext();
  const anonymousResponse = await anonymous.request.get("/admin");
  expect(anonymousResponse.status()).toBe(401);
  await anonymous.close();

  const operator = await browser.newContext({
    httpCredentials: {
      username: "admin",
      password: "playwright-admin-password",
    },
  });
  const page = await operator.newPage();
  const automaticRefresh = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/admin" &&
      Boolean(request.headers()["next-router-state-tree"]),
  );
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Digest operations." }),
  ).toBeVisible();
  await expect(page.getByText("invalid_citation").first()).toBeVisible();
  await expect(
    page.getByText(/referenced comment evidence/).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run digest now" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Status updates automatically",
  );
  await automaticRefresh;
  await expect(
    page
      .locator("tr")
      .filter({ hasText: "fixture-active-run" })
      .locator(".activity-spinner"),
  ).toBeVisible();
  await page.route("/api/admin/runs", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await route.abort();
  });
  await page.getByRole("button", { name: "Run digest now" }).click();
  await expect(page.getByRole("button", { name: "Queuing…" })).toBeDisabled();
  await expectNoHorizontalOverflow(page);
  await operator.close();
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
