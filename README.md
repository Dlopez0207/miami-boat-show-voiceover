# VoiceOver (macOS) baseline transcripts — miamiboatshow.com

Real macOS VoiceOver sessions (not an emulator) on GitHub Actions `macos-15` runners, driven with Guidepup +
Playwright, against the published site (https://www.miamiboatshow.com) as an accessibility baseline. Each run saves
the literal transcript of what VoiceOver spoke per page plus a browser video.

Per page: linear read-through (VO-Right Arrow), heading navigation (VO-Cmd-H), landmark/web-spot navigation
(VO-Cmd-N), Tab order (WebKit: Option-Tab, because Safari's plain Tab skips links by default; plain Tab is recorded too),
and page-specific checks:

- home: main menu (ATTEND submenu opened with VO-Space), controls (VO-Cmd-J: carousel/video), graphics (VO-Cmd-G); also run in Chromium
- get-updates: Tab through the sign-up form, activate Submit with empty fields, type the fake value `test` in Email
- faq: open and close the first accordion item with VO-Space, links (VO-Cmd-L)
- download-maps: links (VO-Cmd-L) to the PDF maps
- show-overview, es-home: controls (VO-Cmd-J); press, press-article, why-exhibit: graphics (VO-Cmd-G)

Cookie banner: the Transcend "This website processes personal data" banner shown to some US visitors comes
first in the Tab order. The spec records that, then picks the privacy-preserving choice with VoiceOver ("Opt out of the sale
of your personal information", then "Okay" if still open) and records the Tab order again.

Safety: before any site script runs, every page gets a page-level blocker that drops every non-GET/HEAD fetch,
XMLHttpRequest, sendBeacon and form.submit call and every reCAPTCHA verify/submit call. On the page with the form
(get-updates) Playwright `page.context().route()` also aborts every non-GET/HEAD request and every reCAPTCHA
verify/submit request at the network layer, so the form is never sent. Blocked requests are listed in each transcript
header. The only text typed is the fake value `test`.

Run: Actions → "VoiceOver transcripts (miamiboatshow.com baseline)" → Run workflow. Inputs: `only`
(e.g. `faq` or `webkit:faq,chromium:home`), `read_scale`, `step_scale`, `mode` (`full`, or `tab` for a Tab-order-only supplement written to
`voiceover-transcript-<browser>-tab.txt`).
Collect: `bash collect.sh <run-id>` → `results/<slug>/voiceover-transcript-<browser>.txt` and the video.
