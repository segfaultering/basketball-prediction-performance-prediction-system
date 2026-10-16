import type { Page } from "@playwright/test";

export async function navigate(page: Page, name: string) {
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Navigation", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}
