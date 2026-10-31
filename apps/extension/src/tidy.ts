// Clearing the way on real sites, before a lane looks at a page. These functions are injected into
// every frame of a lane's tab with chrome.scripting, so each must be self-contained: no imports, no
// outer variables. They act only in lane tabs, never in the person's own tabs.
//
// - Consent banners: choose the most privacy-preserving option ("Reject all", "Necessary only").
//   If no such button can be told apart, report the dialog's buttons so the lane model chooses.
// - Pop-ups, sign-up modals and chat widgets that cover the page: close them by their close
//   button, or Escape, and check the page underneath is reachable again.
// - Bot checks ("verify you are human"): never touched. Reported so the person can do them.

export interface TidyReport {
  tidied: string[];
  consent?: string[];
  captcha?: string;
}

export function tidyFrame(): TidyReport {
  const out: { tidied: string[]; consent?: string[]; captcha?: string } = { tidied: [] };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const textOf = (el: Element) =>
    (
      (el as HTMLElement).innerText ||
      el.getAttribute('aria-label') ||
      el.getAttribute('value') ||
      el.getAttribute('title') ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
  const shown = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const buttonsIn = (root: Element | Document) =>
    [
      ...root.querySelectorAll<HTMLElement>(
        'button, [role=button], a[role=button], input[type=button], input[type=submit], a[href="#"], a[href^="javascript"]',
      ),
    ].filter(shown);

  // ── Bot checks: report and leave alone ──
  const captchaFrame = [...document.querySelectorAll('iframe')].find(
    (f) =>
      /recaptcha|hcaptcha|challenges\.cloudflare\.com|turnstile|arkoselabs|funcaptcha|captcha-delivery|geo\.captcha/i.test(
        f.src,
      ) && shown(f),
  );
  const pageText = (document.body?.innerText ?? '').slice(0, 4000);
  const captchaText =
    /verify (that )?you('| a)re (a )?human|are you a robot|i'?m not a robot|unusual traffic from your computer|checking (if the site connection is secure|your browser)|press (&|and) hold|complete the security check|confirm you are human/i.exec(
      pageText,
    );
  if (captchaFrame || (captchaText && document.body && document.body.innerText.length < 3000)) {
    out.captcha = captchaText ? captchaText[0] : 'a human check';
    return out;
  }

  // ── Consent dialogs ──
  const CONSENT =
    /cookie|consent|gdpr|privacy (choices|preferences|settings)|we (and our partners )?(use|value your privacy)|your privacy|data protection|tracking technologies|personali[sz]ed (ads|advertising)/i;
  const REFUSE = [
    /^(reject|decline|refuse|deny) (all|everything)/i,
    /^(reject|decline|refuse|deny)( (all )?(cookies|optional|non-essential|additional)( cookies)?)?$/i,
    /^(only|use only|accept only|allow only) (strictly )?(necessary|essential|required)( cookies)?$/i,
    /^(strictly )?(necessary|essential|required) (cookies )?only$/i,
    /^continue without (accepting|agreeing|consent)/i,
    /^(i )?do not (accept|agree|consent)/i,
    /^no,? thanks?$/i,
    /^no,? thank you$/i,
    /^(reject|decline)/i,
    // "Manage or reject cookies": leads to the reject screen, handled on the next pass.
    /\b(reject|decline|refuse)\b/i,
  ];
  const ACCEPT = /^(accept|agree|allow|got it|ok(ay)?|i agree|i accept|yes)/i;
  const candidates = [
    ...document.querySelectorAll<HTMLElement>(
      '[role=dialog], [aria-modal=true], dialog[open], [id*=consent i], [class*=consent i], [id*=cookie i], [class*=cookie i], [id*=gdpr i], [class*=gdpr i], [id*=onetrust i], [id*=didomi i], [class*=qc-cmp i], [id*=sp_message i], [id*=truste i], [id*=usercentrics i], [class*=cmp i]',
    ),
  ].filter((el) => shown(el) && CONSENT.test(textOf(el).slice(0, 2000)));
  // A consent provider's own frame (Sourcepoint, OneTrust, TrustArc…) is the dialog itself.
  const cmpFrame = window !== window.top && /consent|sourcepoint|privacy-mgmt|cmp|cookielaw|onetrust|trustarc|usercentrics|didomi|quantcast|cookiebot|privacy-center/i.test(location.href);
  if (cmpFrame && document.body && shown(document.body)) candidates.push(document.body);
  // The innermost dialog that holds the buttons.
  const dialog = candidates.find(
    (el) => buttonsIn(el).length > 0 && !candidates.some((o) => o !== el && el.contains(o) && buttonsIn(o).length > 0),
  );
  if (dialog) {
    const buttons = buttonsIn(dialog);
    let choice: HTMLElement | undefined;
    for (const re of REFUSE) {
      choice = buttons.find((b) => re.test(textOf(b)));
      if (choice) break;
    }
    if (choice) {
      const label = textOf(choice).slice(0, 60);
      // Never press a button that also accepts ("Accept or reject"): those are ambiguous.
      if (ACCEPT.test(label)) {
        out.consent = buttons.map(textOf).filter(Boolean).slice(0, 12);
        return out;
      }
      choice.click();
      out.tidied.push(`Consent dialog: chose “${label}”`);
    } else {
      // Only "accept" and "settings" style buttons: the lane model decides (often "Manage options",
      // then reject), and Baton never says yes to tracking on its own.
      const labels = buttons.map(textOf).filter(Boolean).slice(0, 12);
      if (labels.length && buttons.some((b) => ACCEPT.test(textOf(b)))) out.consent = labels;
    }
    return out;
  }

  // ── Overlays that cover the page (sign-up modals, newsletter pop-ups, big chat widgets) ──
  const CLOSE =
    /^(close|dismiss|no,? thanks?|not now|maybe later|skip|×|✕|✖|x|close (dialog|modal|popup|window)|continue (to site|browsing|shopping)|stay on|remind me later)$/i;
  // Only things that are plainly dialogs count: a dialog role, or a modal / pop-up / overlay name,
  // with words in them. Full-screen app shells (Gmail, Docs, Maps) and empty layers are left alone.
  const DIALOG_NAME = /modal|popup|pop-up|overlay|newsletter|signup|sign-up|subscribe|lightbox|interstitial|promo|offer|welcome-mat|exit-intent/i;
  const covering = [...document.querySelectorAll<HTMLElement>('[role=dialog], [aria-modal=true], dialog[open], body div, body section, body aside')]
    .filter((el) => {
      const isDialog = el.matches('[role=dialog], [aria-modal=true], dialog[open]') || DIALOG_NAME.test(`${el.id} ${el.className.toString()}`);
      if (!isDialog || !shown(el)) return false;
      const s = getComputedStyle(el);
      if (s.pointerEvents === 'none' || (s.position !== 'fixed' && s.position !== 'absolute' && !el.matches('dialog'))) return false;
      if (textOf(el).length < 15 || el.querySelector('main, article, nav, [role=main]')) return false;
      const r = el.getBoundingClientRect();
      const area = (Math.min(r.right, vw) - Math.max(r.left, 0)) * (Math.min(r.bottom, vh) - Math.max(r.top, 0));
      // Covers much of the screen, or sits in the middle of it.
      const centre = document.elementFromPoint(vw / 2, vh / 2);
      return area > vw * vh * 0.2 || (!!centre && el.contains(centre));
    })
    // The outermost of nested matches.
    .filter((el, _i, all) => !all.some((o) => o !== el && o.contains(el)));
  for (const overlay of covering.slice(0, 2)) {
    const close = buttonsIn(overlay).find(
      (b) =>
        CLOSE.test(textOf(b)) ||
        /close|dismiss/i.test(b.getAttribute('aria-label') ?? '') ||
        /close/i.test(b.className.toString()),
    );
    const label = textOf(overlay).slice(0, 50);
    if (close) close.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    // Reachable again: the centre of the screen no longer belongs to the overlay.
    const centre = document.elementFromPoint(vw / 2, vh / 2);
    const gone = !overlay.isConnected || !shown(overlay) || !(centre && overlay.contains(centre));
    out.tidied.push(
      `Pop-up “${label}”: ${close ? 'closed' : 'pressed Escape'}${gone ? '' : ' (still covering the page)'}`,
    );
  }
  return out;
}

// Wait until the page settles: no new network requests and no layout shifts for `quietMs`,
// capped at `capMs`. Better than fixed delays on heavy, slow pages.
export function settleFrame(quietMs: number, capMs: number): Promise<number> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    // Activity before this call counts too: a page that went quiet a while ago is settled already.
    // Ad images and tracking beacons never stop on some pages; only what builds the page counts.
    const counts = (e: PerformanceEntry) => e.entryType !== 'resource' || !['img', 'beacon', 'other', 'ping'].includes((e as PerformanceResourceTiming).initiatorType);
    const before = [
      ...performance
        .getEntriesByType('resource')
        .filter(counts)
        .map((e) => (e as PerformanceResourceTiming).responseEnd),
      ...performance.getEntriesByType('layout-shift').map((e) => e.startTime),
    ];
    let last = before.length ? Math.max(...before) : t0 - quietMs;
    const kinds = ['resource', 'layout-shift'].filter((k) => PerformanceObserver.supportedEntryTypes.includes(k));
    const obs = new PerformanceObserver((list) => {
      if (list.getEntries().some(counts)) last = performance.now();
    });
    for (const type of kinds) obs.observe({ type, buffered: false });
    const tick = () => {
      const now = performance.now();
      if (now - last >= quietMs || now - t0 >= capMs) {
        obs.disconnect();
        resolve(Math.round(now - t0));
      } else setTimeout(tick, 100);
    };
    setTimeout(tick, 100);
  });
}

// Google Sheets and Docs: read through the file's own export, as the signed-in person.
export async function exportText(kind: 'sheet' | 'doc', range: string | null): Promise<string> {
  const m = location.pathname.match(/\/(spreadsheets|document)\/d\/([\w-]+)/);
  if (!m) throw new Error('this is not a Google Sheets or Docs file');
  const id = m[2];
  let url: string;
  if (kind === 'sheet') {
    const gid =
      new URLSearchParams(location.hash.slice(1)).get('gid') ?? new URLSearchParams(location.search).get('gid') ?? '0';
    url = `/spreadsheets/d/${id}/export?format=csv&gid=${gid}${range ? `&range=${encodeURIComponent(range)}` : ''}`;
  } else url = `/document/d/${id}/export?format=txt`;
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`the file could not be read (${r.status})`);
  return (await r.text()).slice(0, 20000);
}
