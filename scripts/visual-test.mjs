import { build } from "esbuild";
import { mkdirSync, writeFileSync, cpSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.QA_PLAYWRIGHT_MODULE || (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/playwright-core/index.mjs" : "playwright")
);

const dir = resolve(".visual-qa");
mkdirSync(dir, { recursive: true });
mkdirSync("docs/v104-validation", { recursive: true });
await build({
  stdin: {
    contents: `import './src/renderer/main.tsx'; import {useApp} from './src/renderer/store.ts'; window.qa=useApp;`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  format: "esm",
  outfile: dir + "/app.js",
  plugins: [
    {
      name: "qa-media",
      setup(b) {
        b.onLoad({ filter: /store\.ts$/ }, async ({ path }) => {
          const { readFileSync } = await import("node:fs");
          return {
            contents: readFileSync(path, "utf8").replace(
              "aivideo://local/",
              "http://127.0.0.1:4178/media/",
            ),
            loader: "ts",
          };
        });
      },
    },
  ],
});
cpSync(
  process.env.QA_FONT_DIR ||
    "/tmp/agent-visual-tools/node_modules/@fontsource/noto-sans-sc",
  dir + "/font",
  { recursive: true },
);
writeFileSync(
  dir + "/index.html",
  '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/font/400.css"><style>:root{font-family:"Noto Sans SC",sans-serif}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
);
const server = spawn(
  process.execPath,
  ["--experimental-strip-types", "scripts/visual-server.ts", dir],
  { stdio: ["ignore", "pipe", "pipe"] },
);
await new Promise((ok, no) => {
  server.stdout.on("data", (b) => {
    if (String(b).includes("QA_READY")) ok();
  });
  server.stderr.on("data", (b) => process.stderr.write(b));
  server.on("exit", (c) => no(Error("QA server exited " + c)));
});
let browser;
try {
  const results = [];
  for (const [width, height, scale] of [
    [1440, 960, 1],
    [1050, 720, 1],
    [1536, 864, 1.25],
    [1280, 720, 1.5],
    [960, 540, 2],
  ]) {
    browser = await chromium.launch({
      executablePath:
        process.env.QA_CHROMIUM_PATH || "/tmp/agent-headless/chromium",
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--single-process",
        "--disable-gpu",
      ],
      headless: true,
    });
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: scale,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript(() => {
      window.aiVideo = {
        invoke: async (action, payload) => {
          const r = await fetch("/invoke", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, payload }),
          });
          const v = await r.json();
          if (!v.ok) throw Error(v.error);
          return v.data;
        },
        onChange: () => () => {},
        onNavigate: () => () => {},
        filePath: () => "",
      };
    });
    await page.goto("http://127.0.0.1:4178");
    await page.waitForSelector(".selected-asset");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() =>
      document
        .querySelector("[data-estimated-cost]")
        ?.textContent.includes("13.80"),
    );
    const measure = () =>
      page.evaluate(() => {
        const rect = (s) => {
          const r = document.querySelector(s).getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
            b: r.bottom,
            r: r.right,
          };
        };
        return {
          footer: rect(".generation-footer"),
          scroll: rect(".generation-scroll"),
          sidebar: rect(".sidebar-bottom"),
          button: rect(".generate-button"),
          bodyWidth: document.body.scrollWidth,
          innerWidth,
          innerHeight,
          controls: [...document.querySelectorAll(".selected-asset")].map(
            (card) =>
              [...card.children].map((el) => {
                const r = el.getBoundingClientRect();
                return { x: r.x, y: r.y, r: r.right, b: r.bottom };
              }),
          ),
        };
      });
    const before = await measure();
    assert(before.scroll.b <= before.footer.y + 1);
    assert(before.footer.b <= height + 1);
    assert(before.sidebar.b <= height + 1);
    assert(before.button.r <= width + 1);
    assert(before.bodyWidth <= width);
    for (const card of before.controls)
      for (let i = 0; i < card.length; i++)
        for (let j = i + 1; j < card.length; j++) {
          const a = card[i],
            b = card[j];
          assert(
            !(
              Math.min(a.r, b.r) - Math.max(a.x, b.x) > 1 &&
              Math.min(a.b, b.b) - Math.max(a.y, b.y) > 1
            ),
            "card overlap",
          );
        }
    await page.screenshot({
      path: `docs/v104-validation/workbench-${width}x${height}-${scale}.png`,
    });
    await page
      .locator(".generation-scroll")
      .evaluate((e) => (e.scrollTop = e.scrollHeight));
    const after = await measure();
    assert.equal(after.footer.y, before.footer.y);
    assert.equal(after.sidebar.y, before.sidebar.y);
    await page.screenshot({
      path: `docs/v104-validation/workbench-bottom-${width}x${height}-${scale}.png`,
    });
    for (const name of ["任务", "资产库", "统计"]) {
      await page
        .locator(".sidebar nav button")
        .filter({ hasText: new RegExp("^" + name + "$") })
        .click();
      await page.waitForSelector(".list-page .pagination");
      const first = await page.locator(".pagination").boundingBox();
      await page
        .locator(".list-scroll")
        .evaluate((e) => (e.scrollTop = e.scrollHeight));
      const last = await page.locator(".pagination").boundingBox();
      assert.equal(first.y, last.y);
      assert(last.y + last.height <= height + 1);
      const scroll = await page.locator(".list-scroll").boundingBox();
      assert(scroll.y + scroll.height <= last.y + 1);
      await page.screenshot({
        path: `docs/v104-validation/${name}-${width}x${height}-${scale}.png`,
      });
    }
    assert.deepEqual(errors, []);
    results.push({ width, height, deviceScaleFactor: scale, passed: true });
    await browser.close();
  }
  writeFileSync(
    "docs/v104-validation/visual.json",
    JSON.stringify(
      {
        engine:
          "Linux headless Chromium; viewport and device scale emulation, not Windows DPI",
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS 5 viewport/scale combinations; generation footer, sidebar, material cards; 3 paginated pages each.",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
