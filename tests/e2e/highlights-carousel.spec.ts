import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs, submitGuess } from "./helpers";

test("game_over: round highlights carousel shows one card per round", async ({
  browser,
}) => {
  test.setTimeout(240_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const code = await createRoomAs(host, `Host${Date.now()}`, {
    maxRounds: 2,
    revealSeconds: 5,
  });

  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  await joinRoomAs(joiner, code, `Joiner${Date.now()}`);

  await expect(host.getByRole("button", { name: /Start game \(2/ })).toBeVisible({
    timeout: 15_000,
  });
  await host.getByRole("button", { name: /Start game/ }).click();

  // Round 1
  for (const page of [host, joiner]) {
    await expect(
      page.getByRole("textbox", { name: /What's the prompt/ }),
    ).toBeVisible({ timeout: 90_000 });
  }
  await submitGuess(host, "a cat wearing a top hat in the rain");
  await submitGuess(joiner, "majestic stag in a pixel art forest");

  for (const page of [host, joiner]) {
    await expect(page.getByText("The prompt was")).toBeVisible({
      timeout: 30_000,
    });
  }

  // Round 2
  for (const page of [host, joiner]) {
    await expect(
      page.getByRole("textbox", { name: /What's the prompt/ }),
    ).toBeVisible({ timeout: 90_000 });
  }
  await submitGuess(host, "astronaut riding a horse on mars");
  await submitGuess(joiner, "a dog painting with oil pastels");

  // Wait for game_over leaderboard on both clients.
  for (const page of [host, joiner]) {
    await expect(page.getByText("Final leaderboard")).toBeVisible({
      timeout: 60_000,
    });
  }

  // Carousel is visible and has exactly 2 cards (matching max_rounds).
  const carousel = host.locator("[data-highlights-carousel]");
  await expect(carousel).toBeVisible({ timeout: 15_000 });
  const cards = carousel.locator("[data-highlight-card]");
  await expect(cards).toHaveCount(2);

  // Round badges.
  await expect(carousel.getByText(/Round 1/)).toBeVisible();
  await expect(carousel.getByText(/Round 2/)).toBeVisible();

  // Each card carries a prompt block.
  const promptBlocks = carousel.locator("[data-highlight-prompt]");
  await expect(promptBlocks).toHaveCount(2);

  // Images — both cards should have an <img>.
  await expect(carousel.locator("img")).toHaveCount(2);

  // Each card links to the /r/<round_id> shareable view.
  const firstHref = await cards.first().getAttribute("href");
  expect(firstHref).toMatch(/^\/r\/[0-9a-f-]+$/);

  // Leaderboard still renders below the carousel.
  await expect(host.getByText("Final leaderboard")).toBeVisible();

  // Desktop arrow nav buttons are present and accessible.
  const prevBtn = carousel.getByRole("button", { name: "Previous round" });
  const nextBtn = carousel.getByRole("button", { name: "Next round" });
  await expect(prevBtn).toBeVisible();
  await expect(nextBtn).toBeVisible();

  // Clicking arrow buttons doesn't error.
  await nextBtn.click();
  await prevBtn.click();

  // Carousel scroll area is keyboard-focusable.
  const scrollArea = carousel.locator("[data-carousel-scroll]");
  await scrollArea.focus();
  await expect(scrollArea).toBeFocused();

  // Arrow key presses are handled without errors.
  await host.keyboard.press("ArrowRight");
  await host.keyboard.press("ArrowLeft");

  // Mouse drag: simulate pointer drag on the scroll container.
  const box = await scrollArea.boundingBox();
  if (box) {
    await host.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await host.mouse.down();
    await host.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2, { steps: 10 });
    await host.mouse.up();
    // After drag, clicking a card link should not navigate (wasDragging guard).
    // Verify page URL is still the game page (not a /r/ highlight page).
    expect(host.url()).toMatch(/\/play\//);
  }

  await hostCtx.close();
  await joinerCtx.close();
});
