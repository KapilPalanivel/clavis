/* Clavis — site behaviour. No dependencies. */
(() => {
  "use strict";
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const range = (p, a, b) => clamp((p - a) / (b - a));                 // 0→1 across [a,b]
  const ease  = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  /* ── Nav ──────────────────────────────────────────────────────────── */
  const nav = $(".nav");
  const onScrollNav = () => nav && nav.classList.toggle("scrolled", scrollY > 12);
  addEventListener("scroll", onScrollNav, { passive: true }); onScrollNav();
  const menu = $(".menu-btn");
  if (menu) menu.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    menu.setAttribute("aria-expanded", String(open));
  });

  /* ── Help centre search: filters the article cards as you type ────── */
  const helpSearch = $("[data-help-search]");
  if (helpSearch) helpSearch.addEventListener("input", () => {
    const words = helpSearch.value.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    $$(".help-cat").forEach(sec => {
      let any = false;
      $$(".help-card", sec).forEach(card => {
        const hit = words.every(w => card.textContent.toLowerCase().includes(w));
        card.hidden = !hit; any = any || hit; if (hit) shown++;
      });
      sec.hidden = !any;
    });
    const empty = $(".help-empty");
    if (empty) empty.hidden = shown > 0;
  });

  /* ── Reveal on scroll ─────────────────────────────────────────────── */
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }), { rootMargin: "0px 0px -8% 0px", threshold: .12 });
  $$("[data-reveal]").forEach(el => io.observe(el));

  /* ── Home story: the real Clavis window, scroll-synced ────────────────
     Three zones are measured on every resize — copy on top, the window in the
     middle, the file tray underneath — and placed so they never overlap. Scroll
     progress p (0→1 across #story) then drives everything:
       .02–.17  window rises from under the hero and docks
       .19–.37  files fly from the tray into Source, the path types in
       .41–.64  Execute, the key turns, Encrypting 1…3 of 3
       .62–.72  files come back out as .enc
       .73–.87  feature callouts take the tray
       .86–1    closing line                                                */
  const story = $("#story");
  if (story) {
    const stage = $("#stage"), hero = $("#hero"), copy = $("#copy"), device = $("#device"), win = $("#win");
    const tray = $("#tray"), chips = $$(".chip", tray), callouts = $$(".feat-pill", tray), chaps = $$(".chap", copy);
    const field = $("#field"), pathEl = $("#path"), exec = $("#exec"), seal = $("#seal"), key = $("#key"), bow = $("#bow");
    const ring = $("#ring"), hole = $("#hole"), sbar = $("#sbar"), pbar = $("#pbar"), stxt = $("#stxt"), ssub = $("#ssub");
    const rail = $$("#rail div");
    const W = 880, H = 560, NAV = 76, PATH = "C:\\Users\\you\\Documents\\Tax Returns 2025";
    const lerp = (a, b, t) => a + (b - a) * t;
    const out = t => 1 - Math.pow(1 - t, 3);
    const icons = chips.map(c => $(".fi", c).innerHTML);
    const lockIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/></svg>';
    let L = null, cur = 0, target = 0, raf = 0;

    const offsetIn = (el, anc) => { let x = 0, y = 0; while (el && el !== anc) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; } return [x, y]; };

    const layout = () => {
      const vw = stage.clientWidth, vh = stage.clientHeight;
      if (!vw || !vh) return;
      const g = clamp(vh * .035, 14, 36), pad = clamp(vh * .04, 14, 44);
      const heroTop = NAV + pad;
      hero.style.top = heroTop + "px";
      const copyH = copy.offsetHeight, trayH = tray.offsetHeight, heroH = hero.offsetHeight;
      const room = vh - heroTop - pad;
      const s = Math.max(.2, Math.min(1, (room - copyH - trayH - 2 * g) / H, (vw - (vw < 640 ? 16 : 40)) / W));
      const free = Math.max(0, room - (copyH + g + s * H + g + trayH));
      const copyTop = heroTop + free / 2;                 // centre the copy · window · tray stack
      copy.style.top = copyTop + "px";
      const dockTop = copyTop + copyH + g;
      tray.style.top = (dockTop + s * H + g) + "px";
      const startTop = Math.max(dockTop, heroTop + heroH + g * 1.6);
      const [fx, fy] = offsetIn(field, device);
      const fieldC = [vw / 2 - s * W / 2 + s * (fx + field.offsetWidth * .35), dockTop + s * (fy + field.offsetHeight / 2)];
      const chipC = chips.map(c => { const [x, y] = offsetIn(c, stage); return [x + c.offsetWidth / 2, y + c.offsetHeight / 2]; });
      L = { s, dockTop, startTop, fieldC, chipC };
    };

    const render = p => {
      if (!L) layout();
      if (!L) return;
      const { s, dockTop, startTop, fieldC, chipC } = L;
      const h = range(p, .015, .085);
      hero.style.opacity = 1 - h;
      hero.style.transform = `translateY(${(-48 * h).toFixed(1)}px)`;
      hero.style.visibility = h >= 1 ? "hidden" : "visible";
      chaps.forEach(c => {
        const a = +c.dataset.a, b = +c.dataset.b;
        const o = range(p, a, a + .035) * (1 - range(p, b - .035, b));
        c.style.opacity = o;
        c.style.transform = `translateY(${((1 - o) * 18).toFixed(1)}px)`;
        c.style.visibility = o > 0 ? "visible" : "hidden";
      });
      // the window rises from under the hero, flattens and docks
      const d = ease(range(p, .05, .17)), k = ease(range(p, .86, .95));
      const scl = s * lerp(.92, 1, d);
      const ty = lerp(startTop, dockTop, d) + scl * H / 2 - H / 2;
      device.style.transform = `translate(-50%, ${ty.toFixed(1)}px) perspective(2200px) rotateX(${(14 * (1 - d)).toFixed(2)}deg) scale(${scl.toFixed(4)})`;
      win.style.boxShadow = `0 70px 120px -50px rgba(0,0,0,.95), 0 0 0 1px rgba(255,255,255,.07), 0 0 ${(90 * k).toFixed(0)}px -10px rgba(217,168,79,.4)`;
      // files: wait in the tray, fly into Source, come back out as .enc
      const trayIn = range(p, .13, .17);
      chips.forEach((c, i) => {
        const a = .19 + i * .03, t = ease(range(p, a, a + .09));
        const b = .62 + i * .022, u = ease(range(p, b, b + .08));
        const enc = p >= b, nm = $("b", c), sm = $("small", c);
        const want = enc ? nm.dataset.out : nm.dataset.in;
        if (nm.textContent !== want) {
          nm.textContent = want; sm.textContent = enc ? sm.dataset.out : sm.dataset.in;
          c.classList.toggle("enc", enc); $(".fi", c).innerHTML = enc ? lockIcon : icons[i];
        }
        const f = enc ? 1 - u : t;                         // 0 = resting in the tray, 1 = inside Source
        const dx = (fieldC[0] - chipC[i][0]) * f, dy = (fieldC[1] - chipC[i][1]) * f - Math.sin(Math.PI * f) * 60;
        c.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${lerp(1, .22, f).toFixed(3)})`;
        c.style.opacity = ((enc ? 1 : trayIn) * (1 - range(f, .55, .9)) * (1 - range(p, .71, .74))).toFixed(3);
      });
      // Source types the folder path
      const typing = range(p, .27, .37), n = Math.round(PATH.length * typing);
      const html = n ? PATH.slice(0, n) + (typing < 1 ? '<span class="caret"></span>' : "") : '<span class="ph">Choose a file or folder…</span>';
      if (pathEl.innerHTML !== html) pathEl.innerHTML = html;
      field.classList.toggle("hot", p > .19 && p < .4);
      // Execute, the seal, the key
      const press = range(p, .41, .43) * (1 - range(p, .44, .46));
      exec.style.transform = `scale(${(1 - .03 * press).toFixed(3)})`;
      const so = range(p, .43, .46) * (1 - range(p, .59, .62));
      seal.style.opacity = so; seal.style.visibility = so > 0 ? "visible" : "hidden";
      const kin = out(range(p, .45, .53)), turn = ease(range(p, .53, .57));
      key.setAttribute("opacity", range(p, .45, .47).toFixed(3));
      key.setAttribute("transform", `translate(${((1 - kin) * 190).toFixed(1)} 0)`);        // slides into the keyway
      bow.setAttribute("transform", `translate(224 80) scale(1 ${(1 - .82 * turn).toFixed(3)}) translate(-224 -80)`);  // turns on its axis
      hole.setAttribute("transform", `rotate(${(90 * turn).toFixed(1)})`);
      const c = range(p, .565, .62);
      ring.setAttribute("opacity", (c > 0 && c < 1 ? 1 - c : 0).toFixed(3));
      ring.setAttribute("transform", `translate(110 80) scale(${(1 + .7 * c).toFixed(3)}) translate(-110 -80)`);
      // status bar, worded like the app's own
      const prog = range(p, .55, .64);
      pbar.style.transform = `scaleX(${prog.toFixed(3)})`;
      pbar.style.opacity = prog > 0 && prog < 1 ? 1 : 0;
      let st, sub = "", ok = false;
      if (p < .36) st = "Ready";
      else if (p < .55) st = "Tax Returns 2025 · 3 files";
      else if (p < .64) st = `Encrypting ${Math.min(3, 1 + Math.floor(prog * 3))} of 3…`;
      else { st = "Encrypted 3 files in Tax Returns 2025"; sub = p < .86 ? "· originals deleted" : "· locks when you step away"; ok = true; }
      if (stxt.textContent !== st) stxt.textContent = st;
      if (ssub.textContent !== sub) ssub.textContent = sub;
      sbar.classList.toggle("ok", ok);
      callouts.forEach((el, i) => {
        const o = range(p, .73 + i * .02, .76 + i * .02) * (1 - range(p, .845, .87));
        el.style.opacity = o.toFixed(3);
        el.style.transform = `translateY(${((1 - o) * 14).toFixed(1)}px)`;
      });
      const step = p < .41 ? 0 : p < .67 ? 1 : p < .86 ? 2 : 3;
      rail.forEach((r, i) => r.classList.toggle("on", i === step));
    };

    const forced = new URLSearchParams(location.search).get("story");   // ?story=0.7 → fixed frame (screenshots)
    const progress = () => { const r = story.getBoundingClientRect(); return clamp(-r.top / (r.height - innerHeight)); };
    const tick = () => {
      cur += (target - cur) * .16;
      if (Math.abs(target - cur) < .0004) cur = target;
      render(cur);
      raf = cur !== target ? requestAnimationFrame(tick) : 0;
    };
    const onScroll = () => {
      target = forced !== null ? +forced : progress();
      if (reduced || forced !== null) { cur = target; render(cur); }
      else if (!raf) raf = requestAnimationFrame(tick);
    };
    const relayout = () => { layout(); render(cur); };
    addEventListener("scroll", onScroll, { passive: true });
    let rz = 0;
    addEventListener("resize", () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(relayout); });
    if (document.fonts) { document.fonts.addEventListener("loadingdone", relayout); document.fonts.ready.then(relayout); }
    addEventListener("load", relayout);
    onScroll();
  }

  /* ── Download page: the visitor's system first, marked "For this computer" ── */
  const tiles = $$(".os-tile[data-os]");
  if (tiles.length) {
    const ua = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || "";
    const phone = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
    const os = phone ? "" : /win/i.test(ua) ? "windows" : /linux|x11/i.test(ua) ? "linux" : "";
    const mine = tiles.find(t => t.dataset.os === os);
    if (phone) { const n = $("#mobile-note"); if (n) n.hidden = false; }
    if (mine) { mine.classList.add("is-you"); mine.parentNode.classList.add("detected"); mine.parentNode.prepend(mine); }
  }

  /* ── Blog: filter cards by type ───────────────────────────────────── */
  const filters = $$("[data-blog-filter]");
  filters.forEach(b => b.addEventListener("click", () => {
    const f = b.dataset.blogFilter;
    filters.forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    $$(".post-card[data-tag]").forEach(c => { c.hidden = f !== "all" && c.dataset.tag !== f; });
  }));

  /* ── Articles: a thin reading-progress bar under the top edge ─────── */
  if ($("article .post, .post article, article.post, .wrap.post")) {
    const bar = document.createElement("div");
    bar.className = "readbar"; bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);
    const upd = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? clamp(scrollY / max) : 0})`;
    };
    addEventListener("scroll", upd, { passive: true }); upd();
  }

  /* ── Copy buttons: data-copy="#id" copies that element's text ─────── */
  $$("[data-copy]").forEach(b => b.addEventListener("click", () => {
    const el = $(b.dataset.copy); if (!el) return;
    const label = b.textContent;
    const done = t => { b.textContent = t; setTimeout(() => { b.textContent = label; }, 1600); };
    const pick = () => { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); done("Press Ctrl+C"); };
    if (navigator.clipboard) navigator.clipboard.writeText(el.textContent).then(() => done("Copied"), pick); else pick();
  }));

  /* ── Release info (version, size, notes) ──────────────────────────── */
  const need = $$("[data-release]").length || $("#notes");
  if (need) fetch("data/release.json", { cache: "no-cache" })
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(rel => {
      $$("[data-release]").forEach(el => {
        const k = el.dataset.release;
        if (k === "date" && rel.date) {
          el.textContent = new Date(rel.date + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
        } else if (rel[k]) el.textContent = rel[k];
      });
      const notes = $("#notes");
      if (notes && rel.notes) notes.innerHTML = md(rel.notes);
    })
    .catch(() => {});

  // Minimal Markdown for release notes: headings, bullets, bold, inline code.
  function md(src) {
    src = src.replace(/^# .*\n?/m, "").split(/^## Install/m)[0].trim();
    const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");
    let html = "", list = false;
    for (const raw of src.split(/\r?\n/)) {
      const line = raw.trim();
      if (/^[-*] /.test(line)) { if (!list) { html += "<ul>"; list = true; } html += "<li>" + inline(line.slice(2)) + "</li>"; continue; }
      if (list) { html += "</ul>"; list = false; }
      if (!line) continue;
      const h = line.match(/^#{2,3} (.*)/);
      html += h ? "<h3>" + inline(h[1].replace(/^[^\w]+/, "")) + "</h3>" : "<p>" + inline(line) + "</p>";
    }
    return html + (list ? "</ul>" : "");
  }

  $$("[data-year]").forEach(el => el.textContent = new Date().getFullYear());

  // ?solo=<section id>: show only that section, revealed (used to render page previews).
  const solo = new URLSearchParams(location.search).get("solo");
  if (solo && document.getElementById(solo)) {
    $$("main > *").forEach(el => { if (el.id !== solo) el.style.display = "none"; });
    $$("[data-reveal]").forEach(el => el.classList.add("in"));
    document.getElementById(solo).style.paddingTop = "120px";
  }
})();

/* ── Privacy-friendly analytics (GoatCounter) ─────────────────────────────
   No cookies, no personal data, no cross-site tracking — so no cookie banner
   is needed. Set ENDPOINT to your GoatCounter URL (from goatcounter.com signup);
   this is the ONLY place to change it. Leave "" to disable. */
(() => {
  "use strict";
  const ENDPOINT = "https://clavis.goatcounter.com/count";
  const host = location.hostname;
  if (!ENDPOINT || host === "localhost" || host === "127.0.0.1" || host === "") return;
  const s = document.createElement("script");
  s.async = true;
  s.src = "//gc.zgo.at/count.js";
  s.setAttribute("data-goatcounter", ENDPOINT);
  document.head.appendChild(s);
})();
