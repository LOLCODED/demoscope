/**
 * Films the demoscope tour GIFs using the demoscope extension itself.
 *
 * Phase A: generate a placeholder sample clip (a canvas-drawn app wireframe
 *          with NO cursor in it — an inner cursor inside the editor's preview
 *          reads as a confusing second pointer in tour footage).
 * Phase B: serve the shared editor on localhost seeded with that sample,
 *          film each tour interaction with the extension, export via the
 *          editor's own WebM export.
 *
 * Usage: node record.mjs [scenario ...]   (no args = all scenarios)
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS = fileURLToPath(new URL(".", import.meta.url));
const SITE = path.join(HARNESS, "site");
const CLIPS = path.join(HARNESS, "clips");
const EXT = path.join(HARNESS, "..", "..", "dist", "chrome");
const USER_DIR = path.join(HARNESS, "profile");
const PORT = 4173;
const BASE = `http://localhost:${PORT}`;

const only = process.argv.slice(2);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------------------------------------------------------------- static site
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webm": "video/webm",
};
function serve() {
  const server = http.createServer(async (req, res) => {
    try {
      const file = path.join(SITE, decodeURIComponent(req.url.split("?")[0]));
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((r) => server.listen(PORT, () => r(server)));
}

// ------------------------------------------------------------------- browser
const args = (id) => [
  `--disable-extensions-except=${EXT}`,
  `--load-extension=${EXT}`,
  ...(id ? [`--allowlisted-extension-id=${id}`] : []),
];

/** Boot once to read the (path-derived, stable) extension id. */
async function discoverExtId() {
  const ctx = await chromium.launchPersistentContext(USER_DIR, {
    headless: true,
    channel: "chromium",
    args: args(),
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  const extId = new URL(sw.url()).host;
  await ctx.close();
  return extId;
}

// Relaunched per scenario: tab capture picks its full 800×500 resolution only
// for the first recording of a browser session, later ones drop to 800×446.
async function launch(extId) {
  const ctx = await chromium.launchPersistentContext(USER_DIR, {
    headless: true,
    channel: "chromium",
    viewport: { width: 1280, height: 800 },
    screen: { width: 1440, height: 900 },
    colorScheme: "light",
    acceptDownloads: true,
    args: args(extId),
  });
  // Keep filming clean: light theme, tours marked seen, no native prompt
  // freeze (Save version), no async clipboard failure.
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("demoscope-theme", "light");
      localStorage.setItem("demoscope:tour-seen:video", "1");
      localStorage.setItem("demoscope:tour-seen:document", "1");
    } catch {
      /* opaque origins (about:blank) have no storage — nothing to stage */
    }
    let v = 1;
    window.prompt = (_m, def) => def ?? `Polished intro v${v++}`;
    window.confirm = () => true;
    if (navigator.clipboard)
      navigator.clipboard.writeText = () => Promise.resolve();
    // Record the real pointer path on the filming page. The recorder only
    // keeps cursor keyframes at events, which is too sparse for the
    // follow-cursor zoom to track drags — this trace fills the gaps.
    if (location.hostname === "localhost") {
      const trace = (window.__pointerTrace = []);
      let lastMove = 0;
      addEventListener(
        "pointermove",
        (e) => {
          const now = Date.now();
          if (now - lastMove < 60) return;
          lastMove = now;
          trace.push({ t: now, x: e.clientX, y: e.clientY, k: "m" });
        },
        true
      );
      const mark = (k) => (e) =>
        trace.push({ t: Date.now(), x: e.clientX, y: e.clientY, k });
      addEventListener("pointerdown", mark("d"), true);
      addEventListener("pointerup", mark("u"), true);
    }
  });
  return ctx;
}

// --------------------------------------------------------- extension driving
async function popupPage(ctx, extId) {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/popup.html`);
  return page;
}

async function tabIdFor(popup, urlPrefix) {
  return popup.evaluate(async (prefix) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url?.startsWith(prefix));
    if (!tab) throw new Error(`no tab matching ${prefix}`);
    return tab.id;
  }, urlPrefix);
}

async function startRec(popup, tabId, title) {
  const mode = await popup.evaluate(
    async ({ tabId, title }) => {
      const resp = await chrome.runtime.sendMessage({
        type: "start-recording",
        tabId,
        title,
      });
      await chrome.tabs.sendMessage(tabId, { type: "start-recording" });
      return resp?.mode;
    },
    { tabId, title }
  );
  if (mode !== "video") throw new Error(`expected video capture, got: ${mode}`);
}

async function stopRec(ctx, popup, tabId, title) {
  const renderPromise = ctx.waitForEvent("page", {
    predicate: (p) => p.url().includes("render.html"),
    timeout: 30_000,
  });
  await popup.evaluate(
    async ({ tabId, title }) => {
      await chrome.tabs
        .sendMessage(tabId, { type: "stop-recording", title })
        .catch(() => {});
      await chrome.runtime.sendMessage({ type: "stop-recording" });
    },
    { tabId, title }
  );
  const renderPage = await renderPromise;
  await renderPage.waitForLoadState();
  return renderPage;
}

/**
 * Replace the filming session's auto-derived cinematics with a hand-built
 * model: no per-click zooms or captions, the traced pointer path as the
 * cursor track, and one follow-cursor zoom panning across most of the clip.
 * Saved as the recording's working edit so the editor's own export uses it.
 */
async function writeFollowModel(renderPage, trace, zoomCfg = {}) {
  const { id, manifest } = await renderPage.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open("demoscope", 1);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const get = (key) =>
      new Promise((res, rej) => {
        const r = db.transaction("kv").objectStore("kv").get(key);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const id = await get("active-recording");
    const rec = await get(`recording:${id}`);
    db.close();
    return { id, manifest: rec.manifest };
  });

  const durationMs = manifest.video.durationMs;
  const cursors = traceCursors(trace, manifest, durationMs);

  const level = zoomCfg.level ?? 1.7;
  const coverage = zoomCfg.coverage ?? 1;
  const transitionMs = 450;
  const startMs = 300;
  const available = Math.max(
    500,
    durationMs - startMs - 2 * transitionMs - 250
  );
  const holdMs = Math.max(500, Math.round(available * coverage));

  const model = {
    durationMs,
    viewport: manifest.meta.viewport,
    fps: manifest.fps,
    cursorGlideMs: 120,
    cursorHighlight: true,
    zooms: [
      {
        id: "tour-follow",
        startMs,
        transitionMs,
        holdMs,
        centerX: manifest.meta.viewport.width / 2,
        centerY: manifest.meta.viewport.height / 2,
        level,
        padding: 60,
        followCursor: true,
      },
    ],
    subtitles: [],
    cursors,
    cuts: [],
    clips: [
      {
        id: "clip-0",
        timelineStartMs: 0,
        sourceStartMs: 0,
        sourceEndMs: durationMs,
        holdMs: 0,
      },
    ],
  };

  await renderPage.evaluate(
    async ({ id, model }) => {
      const db = await new Promise((res, rej) => {
        const req = indexedDB.open("demoscope", 1);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      await new Promise((res, rej) => {
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(
          { working: model, versions: [] },
          `edits:${id}:video`
        );
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    },
    { id, model }
  );
  await renderPage.reload();
  await renderPage.waitForLoadState();
}

/**
 * Map the epoch-stamped pointer trace onto the video clock. The recorder's
 * click frames carry videoTimeMs, and each corresponds in order to a traced
 * pointerup — the median pairwise offset aligns the two clocks.
 */
function traceCursors(trace, manifest, durationMs) {
  const clicks = manifest.frames.filter(
    (f) => f.action === "click" && f.videoTimeMs !== undefined
  );
  const ups = trace.filter((e) => e.k === "u");
  const n = Math.min(clicks.length, ups.length);
  if (n === 0) {
    log("  no click pairs to align trace; falling back to event cursors");
    return manifest.frames
      .filter((f) => f.cursorX !== undefined && f.cursorY !== undefined)
      .map((f) => ({
        tMs: f.videoTimeMs ?? 0,
        x: f.cursorX,
        y: f.cursorY,
        isClick: !!f.isClick,
      }));
  }
  if (clicks.length !== ups.length)
    log(`  trace/click count mismatch (${ups.length} vs ${clicks.length})`);
  const offsets = [];
  for (let i = 0; i < n; i++) offsets.push(clicks[i].videoTimeMs - ups[i].t);
  offsets.sort((a, b) => a - b);
  const offset = offsets[Math.floor(offsets.length / 2)];
  return trace.map((e) => ({
    tMs: Math.min(Math.max(e.t + offset, 0), durationMs),
    x: e.x,
    y: e.y,
    isClick: e.k === "d",
  }));
}

async function exportClip(renderPage, outFile) {
  await renderPage.click('button:has-text("Video editor")');
  await renderPage.waitForSelector('[aria-label="Export format"]', {
    timeout: 30_000,
  });
  await renderPage.selectOption('[aria-label="Export format"]', "webm");
  await renderPage.click('.ds-export button:has-text("Generate")');
  const link = renderPage.locator(".ds-export a[download]");
  await link.waitFor({ state: "visible", timeout: 300_000 });
  // Guard against the degraded low-res capture via the result preview.
  await renderPage.waitForFunction(() => {
    const video = document.querySelector(".ds-result video");
    return video && video.videoWidth > 0;
  });
  const dims = await renderPage.evaluate(() => {
    const video = document.querySelector(".ds-result video");
    return { w: video.videoWidth, h: video.videoHeight };
  });
  if (dims.h < 480)
    throw new Error(`degraded capture resolution ${dims.w}x${dims.h}`);
  const href = await link.getAttribute("href");
  const dataUrl = await renderPage.evaluate(async (url) => {
    const blob = await (await fetch(url)).blob();
    return new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(blob);
    });
  }, href);
  const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
  await writeFile(outFile, bytes);
  return bytes.length;
}

// ------------------------------------------------------------ film-page prep
async function openFilmPage(ctx) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/film.html`);
  await page.waitForFunction(() => window.__filmReady === true, null, {
    timeout: 30_000,
  });
  await page.waitForSelector(".ds-mode-chooser", { timeout: 15_000 });
  return page;
}

/** Reset per-scenario editor state (autosaved edits, versions) on localhost. */
async function resetEdits(page) {
  await page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open("demoscope", 1);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction("kv", "readwrite");
      const store = tx.objectStore("kv");
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        if (String(cursor.key).startsWith("edits:")) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Smooth, human-ish cursor glide so recorded motion looks natural. */
async function glide(page, x, y, ms = 450) {
  await page.mouse.move(x, y, { steps: Math.max(8, Math.round(ms / 16)) });
  await sleep(120);
}

async function centerOf(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

async function glideAndClick(page, locator, ms = 450) {
  const { x, y } = await centerOf(locator);
  await glide(page, x, y, ms);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
  await sleep(250);
}

async function enterVideoEditor(page) {
  await page.click('button:has-text("Video editor")');
  await page.waitForSelector(".ds-timeline");
  await sleep(1300); // let the stage canvas size itself and layout settle
}

async function enterDocumentEditor(page) {
  await page.click('button:has-text("Step document")');
  await page.waitForSelector(".ds-document-step img");
  await sleep(700);
}

async function backToBrowse(page) {
  await page.reload();
  await page.waitForFunction(() => window.__filmReady === true);
  await page.waitForSelector(".ds-mode-chooser");
}

// ------------------------------------------------------------------ scenarios
//
// Each scenario: `stage` prepares the page silently, `act` performs the
// choreography while the extension records.

const SCENARIOS = {
  "video-welcome": {
    zoom: { level: 1.35 },
    stage: async (page) => {
      await backToBrowse(page);
      await page.mouse.move(400, 200);
    },
    act: async (page) => {
      await sleep(400);
      await glideAndClick(
        page,
        page.locator('button:has-text("Video editor")'),
        700
      );
      await page.waitForSelector(".ds-timeline");
      await sleep(900);
      await page.keyboard.press("Space"); // play
      await sleep(2400);
      await page.keyboard.press("Space"); // pause
      await sleep(600);
    },
  },

  "video-zoom": {
    zoom: { level: 1.7 },
    stage: async (page) => {
      await backToBrowse(page);
      await enterVideoEditor(page);
    },
    act: async (page) => {
      await sleep(400);
      // Scrub the playhead by clicking an empty spot on the Zooms lane…
      const lane = page.locator(".ds-lane-zoom");
      const { box } = await centerOf(lane);
      await glide(page, box.x + box.width * 0.62, box.y + box.height / 2, 500);
      await page.mouse.down();
      await page.mouse.up();
      await sleep(400);
      // …then press Z to add a zoom there.
      await page.keyboard.press("z");
      await sleep(700);
      // Drag the ◎ reticle across the preview to aim the zoom.
      const reticle = page.locator(".ds-focus-reticle");
      await reticle.waitFor({ state: "visible" });
      const r = await centerOf(reticle);
      await glide(page, r.x, r.y, 400);
      await page.mouse.down();
      const canvas = await centerOf(page.locator(".ds-canvas-holder canvas"));
      await page.mouse.move(
        canvas.box.x + canvas.box.width * 0.62,
        canvas.box.y + canvas.box.height * 0.72,
        { steps: 30 }
      );
      await sleep(150);
      await page.mouse.up();
      await sleep(500);
      // Nudge the strength slider up a touch (stay in a tasteful range).
      const slider = page.locator('.ds-popover input[type="range"]');
      if (await slider.isVisible()) {
        const s = await centerOf(slider);
        await glide(page, s.x, s.y, 350);
        await page.mouse.down();
        await page.mouse.move(s.box.x + s.box.width * 0.38, s.y, { steps: 12 });
        await page.mouse.up();
      }
      await sleep(700);
    },
  },

  "video-subtitle": {
    zoom: { level: 1.7 },
    stage: async (page) => {
      await backToBrowse(page);
      await enterVideoEditor(page);
    },
    act: async (page) => {
      await sleep(400);
      const lane = page.locator(".ds-lane-sub");
      const { box } = await centerOf(lane);
      await glide(page, box.x + box.width * 0.35, box.y + box.height / 2, 500);
      await page.mouse.down();
      await page.mouse.up();
      await sleep(400);
      await page.keyboard.press("t");
      await sleep(700);
      const input = page.locator('.ds-popover input[type="text"]');
      await input.waitFor({ state: "visible" });
      await glideAndClick(page, input, 400);
      await input.press("Meta+a");
      await page.keyboard.type("Invite your teammates", { delay: 55 });
      await sleep(500);
      // Stretch the new subtitle by dragging its own resize handle.
      const handle = page.locator(
        ".ds-lane-sub .ds-seg.ds-selected .ds-resize"
      );
      if (await handle.isVisible()) {
        const h = await centerOf(handle);
        await glide(page, h.x, h.y, 400);
        await page.mouse.down();
        await page.mouse.move(h.x + 90, h.y, { steps: 25 });
        await page.mouse.up();
      }
      await sleep(700);
    },
  },

  "video-snapping": {
    zoom: { level: 1.8 },
    stage: async (page) => {
      await backToBrowse(page);
      await enterVideoEditor(page);
    },
    act: async (page) => {
      await sleep(400);
      const seg = page.locator(".ds-lane-zoom .ds-seg").first();
      const dragOnce = async () => {
        const before = await seg.getAttribute("style");
        const { x, y } = await centerOf(seg);
        await glide(page, x, y, 500);
        await page.mouse.down();
        // Drift right; the segment snaps to neighbouring anchors on the way.
        await page.mouse.move(x + 140, y, { steps: 45 });
        await sleep(350);
        await page.mouse.move(x + 55, y, { steps: 30 });
        await sleep(350);
        // Hold Alt to glide freely between anchors.
        await page.keyboard.down("Alt");
        await page.mouse.move(x + 100, y, { steps: 35 });
        await page.keyboard.up("Alt");
        await sleep(200);
        await page.mouse.up();
        return (await seg.getAttribute("style")) !== before;
      };
      if (!(await dragOnce())) {
        log("  snap drag missed, retrying");
        await sleep(400);
        if (!(await dragOnce())) throw new Error("segment drag never moved");
      }
      await sleep(700);
    },
  },

  "video-versions": {
    zoom: { level: 1.7 },
    stage: async (page) => {
      await backToBrowse(page);
      await enterVideoEditor(page);
      await page
        .locator(".ds-versions")
        .scrollIntoViewIfNeeded()
        .catch(() => {});
      await sleep(400);
    },
    act: async (page) => {
      await sleep(500);
      const save = page.locator('.ds-versions button:has-text("Save version")');
      await glideAndClick(page, save, 600);
      await sleep(900);
      const preview = page
        .locator('.ds-version button:has-text("Preview")')
        .first();
      await glideAndClick(page, preview, 500);
      await sleep(1100);
      const exit = page.locator('button:has-text("Exit preview")');
      if (await exit.isVisible()) await glideAndClick(page, exit, 450);
      await sleep(600);
    },
  },

  "video-shortcuts": {
    zoom: { level: 1.6 },
    stage: async (page) => {
      await backToBrowse(page);
      await enterVideoEditor(page);
    },
    act: async (page) => {
      await sleep(400);
      const btn = page.locator('[aria-label="Keyboard shortcuts"]');
      await glideAndClick(page, btn, 600);
      const pop = page.locator(".ds-shortcuts-pop");
      await pop.waitFor({ state: "visible" });
      const { box } = await centerOf(pop);
      await glide(
        page,
        box.x + box.width * 0.5,
        box.y + box.height * 0.25,
        500
      );
      await glide(
        page,
        box.x + box.width * 0.5,
        box.y + box.height * 0.75,
        900
      );
      await sleep(600);
      await page.keyboard.press("Escape");
      await sleep(500);
    },
  },

  "document-welcome": {
    zoom: { level: 1.4 },
    stage: async (page) => {
      await backToBrowse(page);
      await page.mouse.move(400, 200);
    },
    act: async (page) => {
      await sleep(400);
      await glideAndClick(
        page,
        page.locator('button:has-text("Step document")'),
        700
      );
      await page.waitForSelector(".ds-document-step img");
      await sleep(900);
      await page.evaluate(() => {
        document
          .querySelectorAll(".ds-document-step")[1]
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      await sleep(1400);
      await sleep(500);
    },
  },

  "document-edit": {
    zoom: { level: 1.7 },
    stage: async (page) => {
      await backToBrowse(page);
      await enterDocumentEditor(page);
    },
    act: async (page) => {
      await sleep(400);
      const title = page.locator(".ds-step-title").nth(1);
      await glideAndClick(page, title, 500);
      await title.press("Meta+a");
      await page.keyboard.type("Open the invite panel", { delay: 50 });
      await sleep(500);
      const down = page
        .locator(".ds-document-step")
        .nth(1)
        .locator('button:has-text("↓")');
      await glideAndClick(page, down, 500);
      await sleep(600);
      const remove = page
        .locator(".ds-document-step")
        .last()
        .locator('button:has-text("Remove")');
      await remove.scrollIntoViewIfNeeded();
      await glideAndClick(page, remove, 500);
      await sleep(800);
    },
  },

  "document-versions": {
    zoom: { level: 1.7 },
    stage: async (page) => {
      await backToBrowse(page);
      await enterDocumentEditor(page);
      await page
        .locator(".ds-versions")
        .scrollIntoViewIfNeeded()
        .catch(() => {});
      await sleep(400);
    },
    act: async (page) => {
      await sleep(500);
      const save = page.locator('.ds-versions button:has-text("Save version")');
      await glideAndClick(page, save, 600);
      await sleep(900);
      const preview = page
        .locator('.ds-version button:has-text("Preview")')
        .first();
      await glideAndClick(page, preview, 500);
      await sleep(1100);
      const exit = page.locator('button:has-text("Exit preview")');
      if (await exit.isVisible()) await glideAndClick(page, exit, 450);
      await sleep(600);
    },
  },

  "document-export": {
    zoom: { level: 1.7 },
    stage: async (page) => {
      await backToBrowse(page);
      await enterDocumentEditor(page);
      await page
        .locator(".ds-document-actions")
        .scrollIntoViewIfNeeded()
        .catch(() => {});
      await sleep(400);
    },
    act: async (page) => {
      await sleep(500);
      page.on("download", (d) => d.cancel().catch(() => {}));
      const copy = page.locator('button:has-text("Copy Markdown")');
      await glideAndClick(page, copy, 600);
      await sleep(800);
      const bundle = page.locator(
        'button:has-text("Download Markdown + images")'
      );
      await glideAndClick(page, bundle, 500);
      await sleep(900);
      const print = page.locator('button:has-text("Print / Save PDF")');
      const p = await centerOf(print);
      await glide(page, p.x, p.y, 500); // hover only — no dialog in the clip
      await sleep(900);
    },
  },
};

// -------------------------------------------------------------------- phases

/**
 * Build the sample recording the editor is seeded with: a placeholder clip
 * drawn on a canvas (app wireframe + watermark) plus a synthetic manifest
 * whose events carry annotations/zooms but NO cursor positions — so the
 * editor's preview never shows an inner cursor competing with the filming
 * session's own pointer.
 */
async function makeSample(ctx) {
  log("phase A: generating placeholder sample clip");
  const page = await ctx.newPage();
  await page.goto(`${BASE}/demo.html`);
  const videoDataUrl = await page.evaluate(async () => {
    const W = 1280,
      H = 800,
      FPS = 30,
      SECONDS = 12;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext("2d");
    const box = (x, y, w, h, r, fill) => {
      g.fillStyle = fill;
      g.beginPath();
      g.roundRect(x, y, w, h, r);
      g.fill();
    };

    const draw = (t) => {
      const bg = g.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, "#f6f7fc");
      bg.addColorStop(1, "#eceef8");
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      box(0, 0, W, 64, 0, "#ffffff");
      g.fillStyle = "#8b5cf6";
      g.beginPath();
      g.arc(36, 32, 12, 0, Math.PI * 2);
      g.fill();
      box(64, 24, 120, 16, 8, "#e4e7f2");
      box(W - 260, 24, 90, 16, 8, "#e4e7f2");
      box(W - 150, 24, 110, 16, 8, "#e4e7f2");
      box(24, 92, 220, H - 130, 14, "#ffffff");
      for (let i = 0; i < 5; i++)
        box(
          44,
          130 + i * 46,
          180 - (i % 2) * 40,
          14,
          7,
          i === 0 ? "#ddd6fa" : "#e9ebf4"
        );
      for (let i = 0; i < 3; i++) {
        const x = 276 + i * 320;
        box(x, 92, 296, 130, 14, "#ffffff");
        box(x + 24, 118, 90, 26, 8, "#ddd6fa");
        box(x + 24, 162, 160, 12, 6, "#e9ebf4");
      }
      box(276, 250, 936, H - 300, 14, "#ffffff");
      for (let i = 0; i < 4; i++)
        box(308, 296 + i * 60, 620 - i * 90, 16, 8, "#eef0f7");
      const progress = (t % 4000) / 4000;
      box(308, 540, 620, 10, 5, "#eef0f7");
      box(308, 540, 620 * (0.15 + 0.85 * progress), 10, 5, "#c7b8f7");
      box(960, 296, 220, 150, 12, "#f2f0fb");
      g.fillStyle = "rgba(100, 108, 130, 0.55)";
      g.font = "600 26px system-ui, -apple-system, sans-serif";
      g.textAlign = "center";
      g.fillText("Sample recording", 744, H - 84);
    };

    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const chunks = [];
    const rec = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp9",
      videoBitsPerSecond: 2_500_000,
    });
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.start();
    const frameMs = 1000 / FPS;
    const start = performance.now();
    for (let i = 0; i < FPS * SECONDS; i++) {
      const due = start + i * frameMs;
      const now = performance.now();
      if (now < due) await new Promise((r) => setTimeout(r, due - now));
      draw(i * frameMs);
      track.requestFrame();
    }
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.stop();
    track.stop();
    await stopped;
    const blob = new Blob(chunks, { type: "video/webm" });
    return await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(blob);
    });
  });

  const manifest = {
    meta: {
      title: "Invite flow walkthrough",
      baseUrl: BASE,
      viewport: { width: 1280, height: 800 },
      defaultWait: 500,
    },
    fps: 30,
    frames: [
      {
        path: "",
        index: 0,
        timestamp: 0,
        videoTimeMs: 300,
        action: "navigate",
      },
      {
        path: "",
        index: 1,
        timestamp: 2600,
        videoTimeMs: 2600,
        action: "click",
        annotation: 'Click "Invite teammate"',
        zoom: { level: 1.8, padding: 60, centerX: 424, centerY: 157 },
      },
      {
        path: "",
        index: 2,
        timestamp: 5800,
        videoTimeMs: 5800,
        action: "type",
        annotation: 'Type "jordan@acme.dev"',
        zoom: { level: 1.8, padding: 60, centerX: 618, centerY: 545 },
      },
      {
        path: "",
        index: 3,
        timestamp: 9000,
        videoTimeMs: 9000,
        action: "click",
        annotation: 'Click "Send invite"',
        zoom: { level: 1.8, padding: 60, centerX: 1070, centerY: 371 },
      },
    ],
    video: { mime: "video/webm", durationMs: 12000 },
  };
  await mkdir(path.join(SITE, "sample"), { recursive: true });
  await writeFile(
    path.join(SITE, "sample", "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
  await writeFile(
    path.join(SITE, "sample", "video.webm"),
    Buffer.from(videoDataUrl.split(",")[1], "base64")
  );
  log("phase A done: placeholder sample written");
  await page.close();
}

async function filmScenario(ctx, popup, filmPage, name) {
  const scenario = SCENARIOS[name];
  log(`filming ${name}…`);
  await resetEdits(filmPage);
  await scenario.stage(filmPage);
  const tabId = await tabIdFor(popup, `${BASE}/film.html`);
  await filmPage.bringToFront();
  await startRec(popup, tabId, `tour ${name}`);
  await filmPage.evaluate(() => {
    window.__pointerTrace.length = 0;
  });
  await sleep(700);
  await scenario.act(filmPage);
  await sleep(400);
  const trace = await filmPage.evaluate(() => window.__pointerTrace.slice());
  const renderPage = await stopRec(ctx, popup, tabId, `tour ${name}`);
  await writeFollowModel(renderPage, trace, scenario.zoom);
  const out = path.join(CLIPS, `${name}.webm`);
  const size = await exportClip(renderPage, out);
  log(`${name}.webm written (${Math.round(size / 1024)}kB)`);
  await renderPage.close();
}

// ----------------------------------------------------------------------- run
const server = await serve();
await mkdir(CLIPS, { recursive: true });
const extId = await discoverExtId();
log(`extension ${extId} loaded`);
try {
  const needSample = await readFile(
    path.join(SITE, "sample", "manifest.json")
  ).then(
    () => false,
    () => true
  );
  if (needSample) {
    const ctx = await launch(extId);
    try {
      await makeSample(ctx);
    } finally {
      await ctx.close();
    }
  }

  const names = only.length ? only : Object.keys(SCENARIOS);
  for (const name of names) {
    if (!SCENARIOS[name]) throw new Error(`unknown scenario ${name}`);
    // Fresh browser per clip so every recording is a first capture (full res).
    const ctx = await launch(extId);
    try {
      const popup = await popupPage(ctx, extId);
      const filmPage = await openFilmPage(ctx);
      await filmScenario(ctx, popup, filmPage, name);
    } finally {
      await ctx.close();
    }
  }
} finally {
  server.close();
}
log("done");
