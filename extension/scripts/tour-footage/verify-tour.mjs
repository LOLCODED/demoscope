// Verify the built extension's tour modal shows a real, loaded GIF per step.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS = fileURLToPath(new URL(".", import.meta.url));
const EXT = path.join(HARNESS, "..", "..", "dist", "chrome");
await mkdir(path.join(HARNESS, "frames"), { recursive: true });

const ctx = await chromium.launchPersistentContext(
  path.join(HARNESS, "profile"), // has recordings from the filming runs
  {
    headless: true,
    channel: "chromium",
    viewport: { width: 1280, height: 800 },
    colorScheme: "light",
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  }
);
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const extId = new URL(sw.url()).host;

const page = await ctx.newPage();
await page.goto(`chrome-extension://${extId}/render.html`);
await page.evaluate(() => {
  localStorage.removeItem("demoscope:tour-seen:video");
  localStorage.removeItem("demoscope:tour-seen:document");
  localStorage.setItem("demoscope-theme", "light");
});
await page.reload();

const results = [];
for (const [mode, button, steps] of [
  ["video", 'button:has-text("Video editor")', 6],
  ["document", 'button:has-text("Step document")', 4],
]) {
  await page.waitForSelector(".ds-mode-chooser", { timeout: 30_000 });
  await page.click(button);
  await page.waitForSelector(".ds-tour", { timeout: 30_000 });
  for (let i = 0; i < steps; i++) {
    const media = page.locator(".ds-tour-media video, .ds-tour-media img");
    await media.waitFor({ state: "visible", timeout: 10_000 });
    const info = await media
      .evaluate(
        (el) =>
          new Promise((resolve, reject) => {
            const isVideo = el.tagName === "VIDEO";
            const size = () =>
              isVideo
                ? { w: el.videoWidth, h: el.videoHeight }
                : { w: el.naturalWidth, h: el.naturalHeight };
            const report = () =>
              resolve({
                src: el.getAttribute("src"),
                tag: el.tagName.toLowerCase(),
                loaded: size().w > 0,
                ...size(),
              });
            const ready = isVideo ? el.readyState >= 2 : el.complete;
            if (ready) return report();
            el.addEventListener(isVideo ? "loadeddata" : "load", report, {
              once: true,
            });
            el.addEventListener("error", report, { once: true });
            setTimeout(() => reject(new Error("media load timeout")), 8000);
          })
      )
      .catch((err) => ({ src: "?", loaded: false, error: String(err) }));
    results.push({ mode, step: i + 1, ...info });
    if (mode === "video" && i === 1)
      await page.screenshot({
        path: path.join(HARNESS, "frames", "tour-modal.png"),
      });
    if (i < steps - 1) await page.click('.ds-tour button:has-text("Next")');
  }
  await page.click('.ds-tour button:has-text("Get started")');
  await page.waitForSelector(".ds-tour", { state: "detached" });
  await page.click('button:has-text("Change mode")');
}
console.table(results);
const bad = results.filter((r) => !r.loaded);
console.log(
  bad.length ? `FAIL: ${bad.length} steps missing GIFs` : "ALL TOUR GIFS LOAD"
);
await ctx.close();
process.exit(bad.length ? 1 : 0);
