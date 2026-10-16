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
const READ_SCALE = Number(process.env.VO_READ_SCALE || 1);
const STEP_SCALE = Number(process.env.VO_STEP_SCALE || 1); // scales headings/landmarks/Tab/extra sections
// Stop issuing VoiceOver commands after this many minutes so the transcript is always written before the
// Playwright test timeout (38 min) and the job timeout (45 min, including ~4 min of runner setup).
const BUDGET_MS = Number(process.env.VO_BUDGET_MIN || 30) * 60 * 1000;

type Section = { title: string; phrases: string[]; end: string };
const num = (i: number) => String(i).padStart(3, " ");
const sh = (cmd: string) => { try { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return "unknown"; } };

// Blocks every non-GET/HEAD request and every reCAPTCHA verify/submit call. Returns the list of blocked requests.
async function blockWrites(page: Page) {
  const blocked: string[] = [];
  const recaptchaWrite = /(recaptcha\/(api2|enterprise)\/(reload|userverify|clr|pat|verify|submit))|siteverify|recaptcha.*\/(verify|submit)/i;
  await page.context().route("**/*", async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    if ((method !== "GET" && method !== "HEAD") || recaptchaWrite.test(req.url())) {
      let where = req.url();
      try { const u = new URL(where); where = `${u.host}${u.pathname}`; } catch {}
      blocked.push(`${method} ${where}`);
      await route.abort("blockedbyclient").catch(() => {});
      return;
    }
    await route.continue().catch(() => {});
  });
  return blocked;
}

test.describe("VoiceOver — miamiboatshow.com (baseline, published site)", () => {
  for (const pg of selected) {
    test(`${pg.slug}: read-through, headings, landmarks, Tab order and page-specific checks`, async ({ page, voiceOver, browserName }, testInfo) => {
      const t0 = Date.now();
      const overBudget = () => Date.now() - t0 > BUDGET_MS;
      const blocked = await blockWrites(page);
      const url = `${ORIGIN}${pg.path}`;
      await page.goto(url, { waitUntil: "load", timeout: 90_000 });
      await page.locator("body").waitFor();
      await page.waitForTimeout(4000);

      // Record overlays (consent banners, chat widgets, reCAPTCHA badge) that VoiceOver may encounter. Nothing is dismissed.
      const pageInfo = await page.evaluate(() => {
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
      });

      await voiceOver.navigateToWebContent();
      await voiceOver.clearSpokenPhraseLog();
      await voiceOver.clearItemTextLog();

      const sections: Section[] = [];
      const vo: any = voiceOver;
      const kc = vo.keyboardCommands ?? {};
      const say = async () => (await voiceOver.lastSpokenPhrase()).replace(/\s+/g, " ").trim();
      // VoiceOver occasionally dies on the hosted runner ("VoiceOver not running"): restart it and go back to the web content.
      const back = async () => {
        try { await voiceOver.navigateToWebContent(); }
        catch (e) {
          sections.push({ title: "(VoiceOver restarted)", phrases: [], end: String(e).slice(0, 100) });
          try { await voiceOver.stop(); } catch {}
          await voiceOver.start(); await page.bringToFront().catch(() => {}); await voiceOver.navigateToWebContent();
        }
      };
      const steps = (n: number) => Math.max(1, Math.round(n * STEP_SCALE));

      // Stop when the same phrase repeats three times in a row (end of content), when the first phrase comes back
      // (wrap-around, navigation commands only) or when the time budget is used up.
      const run = async (title: string, max: number, step: () => Promise<unknown>, wrap: boolean) => {
        const phrases: string[] = []; let end = `limit of ${max} steps`; let repeat = 0;
        if (overBudget()) { sections.push({ title, phrases, end: "skipped: time budget used up" }); write(); return phrases; }
        for (let i = 1; i <= max; i++) {
          if (overBudget()) { end = "time budget used up"; break; }
          try { await step(); } catch (e) { end = `error: ${String(e).slice(0, 120)}`; break; }
          const p = await say();
          if (phrases.length && p === phrases[phrases.length - 1]) { if (++repeat >= 2) { end = "end of content (repeated phrase)"; break; } } else repeat = 0;
          if (wrap && phrases.length > 1 && p === phrases[0]) { end = "wrapped to the first item"; break; }
          phrases.push(p);
        }
        sections.push({ title, phrases, end });
        write();
        return phrases;
      };
      // Free-form section for scripted interactions: each entry is a VoiceOver phrase or a "[...]" annotation.
      const scripted = async (title: string, body: (log: (s: string) => void, sayNow: () => Promise<string>) => Promise<string>) => {
        const phrases: string[] = [];
        if (overBudget()) { sections.push({ title, phrases, end: "skipped: time budget used up" }); write(); return; }
        let end = "done";
        const log = (s: string) => phrases.push(s.replace(/\s+/g, " ").trim());
        try { end = await body(log, async () => { const p = await say(); log(p); return p; }); } catch (e) { end = `error: ${String(e).slice(0, 160)}`; }
        sections.push({ title, phrases, end });
        write();
      };
      // The Transcend "This website processes personal data" banner (shown to US visitors) keeps Tab focus inside
      // itself. To reach the page content, the harness picks the privacy-preserving choice with VoiceOver:
      // VO-Space on "Opt out of the sale of your personal information", then "Okay" if the banner is still open.
      // If it still does not close, the banner is hidden through Transcend's own API (logged as a harness action).
      const BANNER = /Acknowledge and close dialog|Opt out of the sale|Switch language|cookie consent banner/i;
      const bannerOpen = () => page.evaluate(() => {
        const host = document.querySelector("#transcend-consent-manager") as HTMLElement | null;
        return !!host && host.getClientRects().length > 0 && getComputedStyle(host).display !== "none" && getComputedStyle(host).visibility !== "hidden";
      }).catch(() => false);
      const dismissBanner = async (log: (s: string) => void) => {
        for (const [target, label] of [[/Opt out of the sale/i, "Opt out of the sale of your personal information"], [/Acknowledge and close dialog/i, "Okay"]] as const) {
          let reached = BANNER.test(await say()) && target.test(await say());
          for (let i = 0; i < 6 && !reached; i++) { await voiceOver.press("Tab"); const p = await say(); log(p); reached = target.test(p); if (!BANNER.test(p) && p) break; }
          if (!reached) continue;
          log(`[VO-Space on "${label}"]`);
          await voiceOver.act({ capture: true }); log(await say());
          await page.waitForTimeout(1500); log(`[after 1.5 s] ${await say()}`);
          await voiceOver.press("Tab"); const p = await say(); log(`[next Tab] ${p}`);
          if (!BANNER.test(p)) return "banner closed with VoiceOver";
        }
        const hid = await page.evaluate(async () => { const t = (window as any).transcend; if (t?.hideConsentManager) { await t.hideConsentManager(); return true; } return false; }).catch(() => false);
        log(`[harness: banner ${hid ? "hidden with transcend.hideConsentManager()" : "could not be closed"}]`);
        return hid ? "banner hidden by the harness (not by VoiceOver)" : "banner still open";
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
      const file = join(outDir, `voiceover-transcript-${browserName}.txt`);
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
          `Mode: real session, published site, no remediation applied; every non-GET request and reCAPTCHA verify/submit call aborted`,
          `Overlays present at load: ${pageInfo.overlays}`,
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
        await run("Read-through from the top (VO-Right Arrow)", Math.round(pg.read * READ_SCALE), () => voiceOver.next({ capture: true }), false);

        await back();
        await run("Heading navigation (VO-Cmd-H)", steps(pg.headings), () => voiceOver.nextHeading({ capture: true }), true);

        await back();
        await run("Landmark / web-spot navigation (VO-Cmd-N, Guidepup nextLandmark)", steps(pg.landmarks), () => vo.nextLandmark({ capture: true }), true);

        await back();
        const bannerAtStart = await bannerOpen();
        await run(`Tab order from the top (Tab key)${bannerAtStart ? " with the cookie banner open" : ""}`, bannerAtStart ? steps(16) : steps(pg.tabs), () => voiceOver.press("Tab"), false);

        if (await bannerOpen()) {
          await back();
          await scripted("Cookie banner: privacy-preserving choice with VoiceOver (Opt out, then Okay if still open)", async (log) => dismissBanner(log));
        }

        if (pg.extras.includes("menu")) {
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

        if (pg.extras.includes("accordion")) {
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

        if (pg.extras.includes("form")) {
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
        if (bannerAtStart) {
          await back();
          await run("Tab order from the top (Tab key) after the cookie banner was closed", steps(pg.tabs), () => voiceOver.press("Tab"), false);
        }

        if (pg.extras.includes("controls")) {
          await back();
          await run("Form controls / buttons (VO-Cmd-J, find next control; carousel and video controls)", steps(35), () => voiceOver.perform(kc.findNextControl, { capture: true }), true);
        }
        if (pg.extras.includes("graphics")) {
          await back();
          await run("Graphics (VO-Cmd-G, find next graphic)", steps(25), () => voiceOver.perform(kc.findNextGraphic, { capture: true }), true);
        }
        if (pg.extras.includes("links")) {
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
