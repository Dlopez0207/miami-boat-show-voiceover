// Real macOS VoiceOver session, driven with Guidepup, against the published www.miamiboatshow.com
// (accessibility baseline, no remediation applied). One test per page template. Each test writes
// transcripts/<slug>/voiceover-transcript-<browser>.txt (header + "### " sections + numbered phrases).
//
// Safety: every request that is not GET/HEAD is aborted (form submissions, server actions, analytics beacons),
// and so is every reCAPTCHA verify/submit endpoint, before VoiceOver touches the page. Nothing is ever sent.
// The only text ever typed is the obviously fake value "test" (to trigger an email-format error on /attend/get-updates/).
import { voiceOverTest as test } from "@guidepup/playwright";
import { expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { release } from "node:os";
import { execSync } from "node:child_process";

const ORIGIN = process.env.VO_ORIGIN ?? "https://www.miamiboatshow.com";

type Extra = "menu" | "controls" | "graphics" | "links" | "form" | "accordion";
type PageDef = { slug: string; path: string; read: number; headings: number; landmarks: number; tabs: number; extras: Extra[] };
const PAGES: PageDef[] = [
  { slug: "home", path: "/", read: 200, headings: 30, landmarks: 15, tabs: 60, extras: ["menu", "controls", "graphics"] },
  { slug: "get-updates", path: "/attend/get-updates/", read: 110, headings: 20, landmarks: 12, tabs: 45, extras: ["form"] },
  { slug: "faq", path: "/attend/faq-page/", read: 200, headings: 40, landmarks: 12, tabs: 60, extras: ["accordion", "links"] },
  { slug: "download-maps", path: "/attend/download-maps/", read: 120, headings: 20, landmarks: 12, tabs: 50, extras: ["links"] },
  { slug: "show-overview", path: "/attend/show-overview/", read: 150, headings: 25, landmarks: 12, tabs: 55, extras: ["controls"] },
  { slug: "press", path: "/press/", read: 170, headings: 30, landmarks: 12, tabs: 60, extras: ["graphics"] },
  { slug: "press-article", path: "/press/dbmibs-announces-new-show-layout/", read: 170, headings: 25, landmarks: 12, tabs: 50, extras: ["graphics"] },
  { slug: "why-exhibit", path: "/exhibit/why-exhibit/", read: 170, headings: 30, landmarks: 12, tabs: 55, extras: ["graphics"] },
  { slug: "es-home", path: "/es/", read: 200, headings: 30, landmarks: 15, tabs: 60, extras: ["controls"] },
];
const wanted = (process.env.VO_PAGES ?? "all").split(",").map((s) => s.trim()).filter(Boolean);
const selected = wanted.includes("all") ? PAGES : PAGES.filter((p) => wanted.includes(p.slug));
const MODE = (process.env.VO_MODE || "full").toLowerCase(); // full | tab (Tab-order-only supplement)
const READ_SCALE = Number(process.env.VO_READ_SCALE || 1);
const STEP_SCALE = Number(process.env.VO_STEP_SCALE || 1); // scales headings/landmarks/Tab/extra sections
// Stop issuing VoiceOver commands after this many minutes so the transcript is always written before the
// Playwright test timeout (38 min) and the job timeout (45 min, including ~4 min of runner setup).
const BUDGET_MS = Number(process.env.VO_BUDGET_MIN || 30) * 60 * 1000;

type Section = { title: string; phrases: string[]; end: string };
const num = (i: number) => String(i).padStart(3, " ");
const sh = (cmd: string) => { try { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return "unknown"; } };

const RECAPTCHA_WRITE = /(recaptcha\/(api2|enterprise)\/(reload|userverify|clr|pat|verify|submit))|siteverify|recaptcha.*\/(verify|submit)/i;

// Blocks every non-GET/HEAD request and every reCAPTCHA verify/submit call. Returns the list of blocked requests.
// Every page gets a page-level blocker (fetch, XMLHttpRequest, sendBeacon, form.submit), injected before any site
// script runs. Pages with a form also get Playwright network interception (page.context().route) on top of it.
// Network interception is not used on the other pages: on the hosted runner the WebKit page stopped responding
// with it enabled on two pages, and those pages have nothing to submit.
async function blockWrites(page: Page, network: boolean) {
  const blocked: string[] = [];
  const short = (u: string) => { try { const x = new URL(u, "https://www.miamiboatshow.com"); return `${x.host}${x.pathname}`; } catch { return u.slice(0, 80); } };
  await page.exposeBinding("__voBlocked", (_src, what: string) => { blocked.push(`${what} (page-level)`); });
  await page.addInitScript((recaptchaSrc: string) => {
    const recaptcha = new RegExp(recaptchaSrc, "i");
    const w = window as any;
    const note = (m: string, u: string) => { try { let p = u; try { const x = new URL(u, location.href); p = x.host + x.pathname; } catch {} w.__voBlocked?.(`${m} ${p}`); } catch {} };
    const isWrite = (m?: string) => !/^(GET|HEAD)$/i.test(m || "GET");
    const origFetch = window.fetch;
    window.fetch = function (this: any, input: any, init?: any) {
      const m = (init && init.method) || (input instanceof Request ? input.method : "GET");
      const u = typeof input === "string" ? input : input?.url ?? String(input);
      if (isWrite(m) || recaptcha.test(u)) { note(String(m).toUpperCase(), u); return Promise.reject(new TypeError("blocked by the accessibility test harness")); }
      return origFetch.apply(this, arguments as any);
    } as any;
    const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (this: any, m: string, u: string | URL) { this.__voM = m; this.__voU = String(u); return open.apply(this, arguments as any); } as any;
    XMLHttpRequest.prototype.send = function (this: any) {
      if (isWrite(this.__voM) || recaptcha.test(this.__voU || "")) { note(String(this.__voM).toUpperCase(), this.__voU); try { this.abort(); } catch {} return; }
      return send.apply(this, arguments as any);
    };
    Navigator.prototype.sendBeacon = function (u: string | URL) { note("BEACON", String(u)); return false; };
    HTMLFormElement.prototype.submit = function (this: HTMLFormElement) { note("FORM-SUBMIT", this.action); };
  }, RECAPTCHA_WRITE.source);
  if (network) {
    await page.context().route("**/*", async (route) => {
      const req = route.request();
      const method = req.method().toUpperCase();
      if ((method !== "GET" && method !== "HEAD") || RECAPTCHA_WRITE.test(req.url())) {
        blocked.push(`${method} ${short(req.url())}`);
        await route.abort("blockedbyclient").catch(() => {});
        return;
      }
      await route.continue().catch(() => {});
    });
  }
  return blocked;
}

test.describe("VoiceOver — miamiboatshow.com (baseline, published site)", () => {
  for (const pg of selected) {
    test(`${pg.slug}: read-through, headings, landmarks, Tab order and page-specific checks`, async ({ page, voiceOver, browserName }, testInfo) => {
      const t0 = Date.now();
      const overBudget = () => Date.now() - t0 > BUDGET_MS;
      const network = pg.extras.includes("form") || process.env.VO_ROUTE === "all";
      const blocked = await blockWrites(page, network);
      // A WebKit page that stops responding would hang page.evaluate (and Guidepup's navigateToWebContent) until the
      // test timeout and lose the transcript. Give every evaluate 15 s; on timeout it resolves to undefined.
      const origEvaluate = page.evaluate.bind(page);
      let evalTimeouts = 0;
      (page as any).evaluate = (fn: any, arg?: any) => Promise.race([
        origEvaluate(fn, arg),
        new Promise((resolve) => setTimeout(() => { evalTimeouts++; resolve(undefined); }, 15_000)),
      ]);
      const url = `${ORIGIN}${pg.path}`;
      await page.goto(url, { waitUntil: "load", timeout: 90_000 });
      await page.locator("body").waitFor();
      await page.waitForTimeout(4000);

      // Record overlays (consent banners, chat widgets, reCAPTCHA badge) that VoiceOver may encounter. Nothing is dismissed.
      const pageInfo = (await page.evaluate(() => {
        const vis = (el: Element | null) => !!el && (el as HTMLElement).getClientRects().length > 0 && getComputedStyle(el as HTMLElement).visibility !== "hidden";
        const found: string[] = [];
        const checks: [string, string][] = [
          ["#onetrust-banner-sdk", "OneTrust cookie banner"], ["#CybotCookiebotDialog", "Cookiebot dialog"], [".osano-cm-dialog", "Osano dialog"],
          ["#truste-consent-track", "TrustArc banner"], ["#usercentrics-root", "Usercentrics"], [".grecaptcha-badge", "Google reCAPTCHA badge"],
          ["#transcend-consent-manager", "Transcend consent manager (closed shadow DOM)"], ["wistia-player", "Wistia video player"], ["iframe[src*='google.com/maps']", "Google Maps iframe"], ["[class*='swiper']", "Swiper carousel"],
        ];
        for (const [sel, label] of checks) { const el = document.querySelector(sel); if (el) found.push(`${label}${vis(el) ? "" : " (hidden)"}`); }
        const cookieDialog = [...document.querySelectorAll("[role=dialog],[aria-modal=true]")].find((d) => vis(d) && /cookie|consent|privacy/i.test(d.textContent ?? ""));
        if (cookieDialog) found.push("visible dialog mentioning cookies/consent/privacy");
        return { overlays: found.join("; ") || "none", lang: document.documentElement.lang || "(none)", title: document.title };
      })) ?? { overlays: "unknown (page did not answer page.evaluate within 15 s)", lang: "unknown", title: "unknown" };

      await voiceOver.navigateToWebContent();
      await voiceOver.clearSpokenPhraseLog();
      await voiceOver.clearItemTextLog();

      const sections: Section[] = [];
      const vo: any = voiceOver;
      const kc = vo.keyboardCommands ?? {};
      const say = async () => (await voiceOver.lastSpokenPhrase()).replace(/\s+/g, " ").trim();
      // VoiceOver occasionally dies on the hosted runner ("VoiceOver not running"): restart it and go back to the web content.
      let dead = "";
      const withTimeout = <T,>(p: Promise<T>, ms: number, what: string) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000} s`)), ms))]);
      const back = async () => {
        if (dead) return;
        try { await withTimeout(voiceOver.navigateToWebContent(), 120_000, "navigateToWebContent"); }
        catch (e) {
          sections.push({ title: "(VoiceOver restarted)", phrases: [], end: String(e).slice(0, 100) });
          try {
            try { await withTimeout(voiceOver.stop(), 30_000, "stop"); } catch {}
            await withTimeout(voiceOver.start(), 60_000, "start"); await page.bringToFront().catch(() => {});
            await withTimeout(voiceOver.navigateToWebContent(), 120_000, "navigateToWebContent");
          } catch (e2) { dead = String(e2).slice(0, 120); sections.push({ title: "(VoiceOver could not return to the page)", phrases: [], end: dead }); write(); }
        }
      };
      const steps = (n: number) => Math.max(1, Math.round(n * STEP_SCALE));

      // Stop when the same phrase repeats three times in a row (end of content), when the first phrase comes back
      // (wrap-around, navigation commands only) or when the time budget is used up.
      const run = async (title: string, max: number, step: () => Promise<unknown>, wrap: boolean) => {
        const phrases: string[] = []; let end = `limit of ${max} steps`; let repeat = 0;
        if (overBudget() || dead) { sections.push({ title, phrases, end: dead ? "skipped: VoiceOver could not return to the page" : "skipped: time budget used up" }); write(); return phrases; }
        for (let i = 1; i <= max; i++) {
          if (overBudget()) { end = "time budget used up"; break; }
          try { await step(); } catch (e) { end = `error: ${String(e).slice(0, 120)}`; break; }
          const p = await say();
          if (phrases.length && p === phrases[phrases.length - 1]) { if (++repeat >= 2) { end = "end of content (repeated phrase)"; break; } } else repeat = 0;
          if (wrap && phrases.length > 1 && p && p === phrases[0]) { end = "wrapped to the first item"; break; }
          phrases.push(p);
        }
        sections.push({ title, phrases, end });
        write();
        return phrases;
      };
      // Free-form section for scripted interactions: each entry is a VoiceOver phrase or a "[...]" annotation.
      const scripted = async (title: string, body: (log: (s: string) => void, sayNow: () => Promise<string>) => Promise<string>) => {
        const phrases: string[] = [];
        if (overBudget() || dead) { sections.push({ title, phrases, end: dead ? "skipped: VoiceOver could not return to the page" : "skipped: time budget used up" }); write(); return; }
        let end = "done";
        const log = (s: string) => phrases.push(s.replace(/\s+/g, " ").trim());
        try { end = await body(log, async () => { const p = await say(); log(p); return p; }); } catch (e) { end = `error: ${String(e).slice(0, 160)}`; }
        sections.push({ title, phrases, end });
        write();
      };
      // The Transcend "This website processes personal data" banner (shown to some US visitors) puts its buttons
      // first in the Tab order. When it shows up, the harness picks the privacy-preserving choice with VoiceOver:
      // VO-Space on "Opt out of the sale of your personal information", then "Okay" if the banner is still open.
      // If it still does not close, the banner is hidden through Transcend's own API (logged as a harness action).
      const BANNER = /Acknowledge and close dialog|Opt out of the sale|Switch language|cookie consent banner|Click to disable collection|What can we use data for|show simpler choices|Powered by Transcend/i;
      // "Opt out of the sale…" opens Transcend's purpose list (pre-checked checkboxes + Confirm). The privacy-preserving
      // path is: uncheck every checked purpose with VO-Space, then VO-Space on Confirm.
      const dismissBanner = async (log: (s: string) => void) => {
        const tab = async () => { await voiceOver.press("Tab"); const p = await say(); log(p); return p; };
        const act = async (label: string) => { log(`[VO-Space on "${label}"]`); await voiceOver.act({ capture: true }); log(await say()); await page.waitForTimeout(1200); };
        let p = await say();
        for (let i = 0; i < 25 && !/Opt out of the sale/i.test(p) && !overBudget(); i++) p = await tab();
        if (/Opt out of the sale/i.test(p)) {
          await act("Opt out of the sale of your personal information");
          p = await say();
          for (let i = 0; i < 14 && !overBudget(); i++) {
            if (/\bchecked checkbox/i.test(p) && !/unchecked/i.test(p)) { await act(p.slice(0, 70)); p = await say(); continue; }
            if (/^Confirm button/i.test(p)) { await act("Confirm"); break; }
            p = await tab();
          }
        }
        for (let i = 0; i < 3; i++) {
          p = await tab();
          if (/Acknowledge and close dialog/i.test(p)) { await act("Okay"); p = await tab(); }
          if (p && !BANNER.test(p)) return "banner closed with VoiceOver";
        }
        const hid = await page.evaluate(async () => { const t = (window as any).transcend; if (t?.hideConsentManager) { await t.hideConsentManager(); return true; } return false; }).catch(() => false);
        log(`[harness: ${hid ? "called transcend.hideConsentManager()" : "banner could not be closed"}]`);
        return hid ? "banner still in the Tab order after the VoiceOver steps; transcend.hideConsentManager() called by the harness" : "banner still open";
      };
      // Presses Tab (spoken output captured) until the focused element matches `selector`, or `max` presses.
      const tabTo = async (selector: string, max: number, log: (s: string) => void) => {
        let bannerTries = 0;
        for (let i = 1; i <= max; i++) {
          if (overBudget()) return false;
          await voiceOver.press("Tab");
          const p = await say();
          const hit = await page.evaluate((sel) => !!document.activeElement && document.activeElement.matches(sel), selector).catch(() => false);
          log(`${hit ? "[target] " : ""}${p}`);
          if (hit) return true;
          if (BANNER.test(p) && bannerTries++ < 1) log(`[${await dismissBanner(log)}]`);
        }
        return false;
      };
      const domNote = async (fn: () => unknown) => `[DOM check, not spoken] ${JSON.stringify(await page.evaluate(fn as any).catch((e) => String(e)))}`;

      const outDir = join(process.cwd(), "transcripts", pg.slug);
      mkdirSync(outDir, { recursive: true });
      const file = join(outDir, `voiceover-transcript-${browserName}${MODE === "tab" ? "-tab" : ""}.txt`);
      const macos = sh("sw_vers -productVersion");
      const voVersion = sh("defaults read /System/Library/CoreServices/VoiceOver.app/Contents/Info CFBundleShortVersionString");
      let spoken: string[] = [];
      function write() {
        const total = sections.reduce((a, s) => a + s.phrases.length, 0);
        const lines: string[] = [
          `Screen reader: VoiceOver ${voVersion} (macOS ${macos}, Darwin ${release()}, real session driven with Guidepup)`,
          `Page: ${url}`,
          `Rendered page: ${page.url()}  |  title: ${pageInfo.title}  |  html lang: ${pageInfo.lang}`,
          `Browser: ${browserName} (Playwright project "${testInfo.project.name}")`,
          `Runner: GitHub Actions ${process.env.RUNNER_OS_LABEL ?? "local"} (run ${process.env.GITHUB_RUN_ID ?? "-"}, attempt ${process.env.GITHUB_RUN_ATTEMPT ?? "-"})`,
          `Session date (UTC): ${new Date(t0).toISOString()}  |  elapsed: ${Math.round((Date.now() - t0) / 1000)} s`,
          `Mode: ${MODE === "tab" ? "Tab-order supplement; " : ""}real session, published site, no remediation applied; every non-GET request and reCAPTCHA verify/submit call aborted`,
          `Overlays present at load: ${pageInfo.overlays}`,
          `Network interception (page.route): ${network ? "on" : "off (page-level blocker only)"}  |  page.evaluate timeouts: ${evalTimeouts}`,
          `Blocked requests (never sent): ${blocked.length}${blocked.length ? " — " + [...new Set(blocked)].slice(0, 25).join(", ") : ""}`,
          `Phrases captured: ${total}`,
          ``,
          `Each numbered line is one phrase exactly as VoiceOver spoke it; lines starting with "[" are harness annotations.`,
          `────────────────────────────────────────────────────────`,
          ``,
        ];
        for (const s of sections) {
          lines.push(`### ${s.title} (${s.phrases.length} phrases, end: ${s.end})`);
          s.phrases.forEach((p, i) => lines.push(`${num(i + 1)}  ${p}`));
          lines.push("");
        }
        if (spoken.length) {
          lines.push(`### Full VoiceOver log (spokenPhraseLog, ${spoken.length} entries)`);
          spoken.forEach((p, i) => lines.push(`${num(i + 1)}  ${p.replace(/\s+/g, " ").trim()}`));
        }
        writeFileSync(file, lines.join("\n") + "\n", "utf8");
        return total;
      }

      try {
        if (MODE === "full") {
          await run("Read-through from the top (VO-Right Arrow)", Math.round(pg.read * READ_SCALE), () => voiceOver.next({ capture: true }), false);

          await back();
          await run("Heading navigation (VO-Cmd-H)", steps(pg.headings), () => voiceOver.nextHeading({ capture: true }), true);

          await back();
          await run("Landmark / web-spot navigation (VO-Cmd-N, Guidepup nextLandmark)", steps(pg.landmarks), () => vo.nextLandmark({ capture: true }), true);
        }

        // WebKit follows Safari's default: plain Tab reaches only buttons and form fields, Option-Tab also reaches links.
        const TABKEY = browserName === "webkit" ? "Option+Tab" : "Tab";
        const tabLabel = browserName === "webkit" ? "Option-Tab; in WebKit/Safari plain Tab skips links by default" : "Tab key";
        await back();
        const firstTabs = await run(`Tab order from the top (${tabLabel})`, steps(pg.tabs), () => voiceOver.press(TABKEY), true);
        if (firstTabs.slice(0, 8).some((p) => BANNER.test(p))) {
          await back();
          await scripted("Cookie banner: privacy-preserving choice with VoiceOver (Opt out, then Okay if still open)", async (log) => dismissBanner(log));
          await back();
          await run(`Tab order from the top (${tabLabel}) after the cookie-banner step`, steps(pg.tabs), () => voiceOver.press(TABKEY), true);
        }
        if (MODE === "full" && browserName === "webkit") {
          await back();
          await run("Tab order from the top (plain Tab key, Safari default: buttons and form fields only)", steps(30), () => voiceOver.press("Tab"), true);
        }

        const ex = (e: Extra) => MODE === "full" && pg.extras.includes(e);
        if (ex("menu")) {
          await back();
          await scripted("Main menu: reach ATTEND and open its submenu with VO-Space", async (log, sayNow) => {
            log(await domNote(() => [...document.querySelectorAll("nav li")].filter((li) => (li as HTMLElement).getClientRects().length).map((li) => {
              const t = li.firstElementChild as HTMLElement | null;
              return `${(li.textContent ?? "").trim().slice(0, 20)} -> <${t?.tagName.toLowerCase()}> tabindex=${t?.getAttribute("tabindex")} role=${t?.getAttribute("role")} aria-expanded=${t?.getAttribute("aria-expanded")}`;
            }).slice(0, 6)));
            let found = false;
            for (let i = 1; i <= steps(45) && !overBudget(); i++) {
              await voiceOver.next({ capture: true });
              const p = await sayNow();
              if (/\battend\b/i.test(p) && !/\blink\b/i.test(p)) { found = true; break; }
            }
            if (!found) return "ATTEND not reached with VO-Right Arrow";
            const before = page.url();
            log("[VO-Space on ATTEND]");
            await voiceOver.act({ capture: true });
            await sayNow();
            await page.waitForTimeout(1500);
            log(`[after 1.5 s] ${await say()}`);
            log(await domNote(() => {
              const a = [...document.querySelectorAll("a[href='/attend/show-overview/']")].find((x) => (x as HTMLElement).getClientRects().length && getComputedStyle(x).visibility !== "hidden");
              return { submenuLinkVisible: !!a, expandedAttrs: [...document.querySelectorAll("nav [aria-expanded]")].map((e) => e.getAttribute("aria-expanded")) };
            }));
            if (page.url() !== before) { log(`[page navigated to ${page.url()}; going back]`); await page.goBack(); return "activation navigated away"; }
            log("[VO-Right Arrow x 8 after activation]");
            for (let i = 0; i < steps(8); i++) { await voiceOver.next({ capture: true }); await sayNow(); }
            await voiceOver.press("Escape");
            return "done";
          });
        }

        if (ex("accordion")) {
          await back();
          await scripted("FAQ accordion: Tab to the first item, open and close it with VO-Space", async (log, sayNow) => {
            const sel = "main button[aria-expanded]";
            log(await domNote(() => ({ accordionButtons: document.querySelectorAll("main button[aria-expanded]").length, first: (document.querySelector("main button[aria-expanded]")?.textContent ?? "").trim().slice(0, 80) })));
            if (!(await tabTo(sel, steps(70), log))) return "first accordion button not reached with Tab";
            log("[VO-Space to expand]");
            await voiceOver.act({ capture: true });
            await sayNow();
            await page.waitForTimeout(1000);
            log(`[after 1 s] ${await say()}`);
            log(await domNote(() => (document.activeElement as HTMLElement | null)?.getAttribute("aria-expanded")));
            log("[VO-Right Arrow x 4 into the panel]");
            for (let i = 0; i < 4; i++) { await voiceOver.next({ capture: true }); await sayNow(); }
            log("[VO-Left Arrow x 4 back to the button, VO-Space to collapse]");
            for (let i = 0; i < 4; i++) { await voiceOver.previous({ capture: true }); await sayNow(); }
            await voiceOver.act({ capture: true });
            await sayNow();
            log(await domNote(() => [...document.querySelectorAll("main button[aria-expanded]")].slice(0, 3).map((b) => b.getAttribute("aria-expanded"))));
            return "done";
          });
        }

        if (ex("form")) {
          await back();
          await scripted("Form: Tab through the fields (labels, required state)", async (log) => {
            log(await domNote(() => [...document.querySelectorAll("main form input, main form select, main form textarea, main form button")].map((el) => {
              const i = el as HTMLInputElement; const lab = i.id ? document.querySelector(`label[for="${i.id}"]`)?.textContent?.trim() : "";
              return `${el.tagName.toLowerCase()}${i.type ? "[" + i.type + "]" : ""} label="${lab ?? ""}" aria-label="${i.getAttribute("aria-label") ?? ""}" required=${i.required} tabindex=${i.getAttribute("tabindex")}`;
            })));
            if (!(await tabTo("main form input", steps(45), log))) return "first form field not reached with Tab";
            log("[Tab through the remaining controls]");
            for (let i = 0; i < 7; i++) {
              await voiceOver.press("Tab"); const p = await say();
              const tag = await page.evaluate(() => { const a = document.activeElement as HTMLInputElement | null; return a ? `${a.tagName.toLowerCase()}${a.type ? "[" + a.type + "]" : ""}` : ""; });
              log(`${p}   [focus: ${tag}]`);
              if (tag === "button[submit]") break;
            }
            return "done";
          });
          await back();
          await scripted("Form: activate Submit with every field empty (submission blocked at the network layer)", async (log, sayNow) => {
            if (!(await tabTo("main form button[type=submit]", steps(60), log))) return "submit button not reached with Tab";
            const blockedBefore = blocked.length;
            log("[VO-Space on Submit]");
            await voiceOver.act({ capture: true });
            await sayNow();
            await page.waitForTimeout(2500);
            log(`[after 2.5 s] ${await say()}`);
            log(await domNote(() => ({
              focus: `${document.activeElement?.tagName.toLowerCase()}#${document.activeElement?.id}`,
              ariaInvalid: [...document.querySelectorAll("main form [aria-invalid=true]")].length,
              errorTexts: [...document.querySelectorAll("main form .Mui-error, main form [role=alert], main form .MuiFormHelperText-root")].map((e) => (e.textContent ?? "").trim()).filter(Boolean).slice(0, 8),
              describedBy: [...document.querySelectorAll("main form input")].map((e) => e.getAttribute("aria-describedby")).slice(0, 5),
              liveRegions: [...document.querySelectorAll("[aria-live],[role=alert],[role=status]")].map((e) => `${e.getAttribute("role") ?? ""}/${e.getAttribute("aria-live") ?? ""}: ${(e.textContent ?? "").trim().slice(0, 60)}`).slice(0, 6),
            })));
            log(`[requests blocked during submit: ${blocked.length - blockedBefore}]`);
            log("[VO-Left Arrow x 6 from the button]");
            for (let i = 0; i < 6; i++) { await voiceOver.previous({ capture: true }); await sayNow(); }
            return "done";
          });
          await page.reload({ waitUntil: "load" }); await page.waitForTimeout(3000);
          await back();
          await scripted("Form: type the fake value \"test\" in Email, Tab away, then Tab back through the fields", async (log, sayNow) => {
            if (!(await tabTo("main form input[name$='___email']", steps(45), log))) return "email field not reached with Tab";
            log("[typing \"test\"]");
            await voiceOver.type("test");
            await sayNow();
            log("[Tab x 2]");
            for (let i = 0; i < 2; i++) { await voiceOver.press("Tab"); await sayNow(); }
            log("[Shift-Tab x 2 back to Email]");
            for (let i = 0; i < 2; i++) { await voiceOver.press("Shift+Tab"); await sayNow(); }
            await page.waitForTimeout(800);
            log(`[after 0.8 s] ${await say()}`);
            log(await domNote(() => ({
              emailValue: (document.querySelector("main form input[name$='___email']") as HTMLInputElement | null)?.value,
              ariaInvalid: [...document.querySelectorAll("main form [aria-invalid=true]")].length,
              errorTexts: [...document.querySelectorAll("main form .Mui-error, main form [role=alert], main form .MuiFormHelperText-root")].map((e) => (e.textContent ?? "").trim()).filter(Boolean).slice(0, 8),
            })));
            return "done";
          });
        }
        if (ex("controls")) {
          await back();
          await run("Form controls / buttons (VO-Cmd-J, find next control; carousel and video controls)", steps(35), () => voiceOver.perform(kc.findNextControl, { capture: true }), true);
        }
        if (ex("graphics")) {
          await back();
          await run("Graphics (VO-Cmd-G, find next graphic)", steps(25), () => voiceOver.perform(kc.findNextGraphic, { capture: true }), true);
        }
        if (ex("links")) {
          await back();
          await run("Links (VO-Cmd-L, find next link)", steps(35), () => voiceOver.nextLink({ capture: true }), true);
        }

      } finally {
        spoken = await voiceOver.spokenPhraseLog().catch(() => [] as string[]);
        write();
      }
      const total = write();
      await testInfo.attach(`voiceover-${pg.slug}-${browserName}`, { path: file, contentType: "text/plain" });
      expect(total).toBeGreaterThan(10);
    });
  }
});
