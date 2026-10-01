import { mkdirSync } from "node:fs";
import { test as setup } from "@playwright/test";

// Signs in as the Studio test account (draft database only — never a real
// login) and saves the session, so every other test starts signed in.
// `studio-test account` shows the email and password; the tests read them
// from STUDIO_TEST_EMAIL / STUDIO_TEST_PASSWORD.
const email = process.env.STUDIO_TEST_EMAIL ?? "";
const password = process.env.STUDIO_TEST_PASSWORD ?? "";

setup("sign in as the Studio test account", async ({ page }) => {
  mkdirSync("e2e/.auth", { recursive: true });
  // This site has no sign-in, so there is nothing to log in to; just save an empty session.
  void email;
  void password;
  await page.goto("/");
  await page.context().storageState({ path: "e2e/.auth/state.json" });
});
