/* Clavis — site behaviour. No dependencies. */
(() => {
  "use strict";
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const range = (p, a, b) => clamp((p - a) / (b - a));                 // 0→1 across [a,b]
  const ease  = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const back  = t => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

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

  /* ── Card light follows the pointer ───────────────────────────────── */
  $$(".card").forEach(c => c.addEventListener("pointermove", e => {
    const r = c.getBoundingClientRect();
    c.style.setProperty("--mx", (e.clientX - r.left) + "px");
    c.style.setProperty("--my", (e.clientY - r.top) + "px");
  }));

  /* ── Lock story (home hero) ───────────────────────────────────────── */
  const story = $("#story");
  if (story) {
    const scene   = $("#scene");
    const lines   = $$("#doc-lines text");
    const plain   = lines.map(t => t.textContent);
    const CH      = "0123456789ABCDEFabcdef+/=#$%&*@";
    const thresh  = plain.map(s => [...s].map((_, i) => ((i * 7919 + s.length * 104729) % 997) / 997));
    const ribbonF = $("#ribbon-front"), ribbonB = $("#ribbon-back");
    const lenF = ribbonF.getTotalLength(), lenB = ribbonB.getTotalLength();
    [ribbonF, ribbonB].forEach((r, i) => { const L = i ? lenB : lenF; r.style.strokeDasharray = L; });
    const key     = $("#key"), keyBow = $("#key-bow"), slot = $("#keyhole-slot");
    const shackle = $("#shackle"), ring = $("#click-ring"), glow = $("#lock-glow");
    const bits    = $("#bits"), docG = $("#doc");
    const steps   = $$(".steps li"), stepsEl = $(".steps"), now = $(".now"), hint = $(".scroll-hint");
    const captions = steps.map(li => li.querySelector("span").textContent);

    // Drifting ciphertext glyphs behind the scene.
    if (bits) for (let i = 0; i < 26; i++) {
      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("x", (20 + (i * 211) % 520).toString());
      t.setAttribute("y", (40 + (i * 137) % 540).toString());
      t.textContent = CH[(i * 13) % CH.length] + CH[(i * 29) % CH.length];
      t.style.animationDelay = (-(i * 0.73) % 9) + "s";
      bits.appendChild(t);
    }

    const forced = new URLSearchParams(location.search).get("story");   // ?story=0.7 → fixed frame (screenshots)
    let target = 0, cur = forced !== null ? +forced : 0, raf = 0, lastStep = -1;

    const progress = () => {
      const r = story.getBoundingClientRect();
      return clamp(-r.top / (r.height - innerHeight));
    };

    const render = p => {
      // 1. Text → ciphertext (0.06–0.42)
      const s = range(p, .06, .42), seed = Math.floor(p * 360);
      lines.forEach((t, li) => {
        const src = plain[li]; let out = "";
        for (let i = 0; i < src.length; i++) {
          if (s <= thresh[li][i]) { out += src[i]; continue; }
          const h = (Math.imul(i + 1, 2654435761) ^ Math.imul(li + 7, 40503) ^ Math.imul(seed + 3, 97)) >>> 0;
          out += CH[h % CH.length];
        }
        t.textContent = out;
        t.style.fill = s > .5 ? "#2F6BFF" : "#33415F";
      });
      // 2. Ribbon wraps (0.18–0.52)
      const w = ease(range(p, .18, .52));
      ribbonB.style.strokeDashoffset = lenB * (1 - clamp(w * 2));
      ribbonF.style.strokeDashoffset = lenF * (1 - clamp(w * 2 - 1));
      // 3. Key slides into the keyhole (0.40–0.62)
      const k = ease(range(p, .40, .62));
      const kIn = range(p, .36, .44);
      key.style.opacity = kIn;
      key.setAttribute("transform", `translate(${(1 - k) * 150} 0)`);
      // 4. Key turns (0.62–0.74): the bow flattens as it rotates about the shaft; the slot turns
      const turn = ease(range(p, .62, .74));
      keyBow.setAttribute("transform", `scale(1 ${1 - turn * .78})`);
      slot.setAttribute("transform", `rotate(${turn * 90})`);
      // 5. Shackle drops and clicks (0.72–0.84)
      const d = range(p, .72, .84);
      shackle.setAttribute("transform", `translate(0 ${-46 * (1 - (d < 1 ? back(d) : 1))})`);
      const c = range(p, .84, .96);
      ring.setAttribute("r", (14 + c * 70).toFixed(1));
      ring.style.opacity = c > 0 && c < 1 ? (1 - c) : 0;
      glow.style.opacity = .25 + .75 * range(p, .8, 1);
      if (bits) bits.style.opacity = .15 + .6 * range(p, .1, .5);
      if (docG) docG.style.opacity = 1 - .12 * range(p, .5, .9);
      // Captions
      const step = p < .24 ? 0 : p < .56 ? 1 : p < .8 ? 2 : 3;
      if (step !== lastStep) {
        steps.forEach((li, i) => li.classList.toggle("on", i <= step));
        if (now) now.textContent = captions[step] || "";
        lastStep = step;
      }
      if (stepsEl) stepsEl.style.setProperty("--p", p.toFixed(4));
      if (hint) hint.style.opacity = p > .04 ? 0 : 1;
    };

    const tick = () => {
      cur += (target - cur) * .12;
      if (Math.abs(target - cur) < .0005) cur = target;
      render(cur);
      raf = cur !== target ? requestAnimationFrame(tick) : 0;
    };
    const onScroll = () => {
      if (forced !== null) return;
      target = progress();
      if (reduced) { cur = target = 1; render(1); return; }
      if (!raf) raf = requestAnimationFrame(tick);
    };
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    render(reduced ? 1 : cur); onScroll();

    // Gentle 3D tilt toward the pointer.
    const wrap = $(".scene-wrap");
    if (wrap && !reduced) {
      wrap.addEventListener("pointermove", e => {
        const r = wrap.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
        scene.style.transform = `rotateY(${x * 10}deg) rotateX(${-y * 8}deg)`;
      });
      wrap.addEventListener("pointerleave", () => { scene.style.transform = ""; });
    }
  }

  /* ── Product windows parallax ─────────────────────────────────────── */
  const wins = $(".windows");
  if (wins && !reduced) {
    const front = $(".window.front", wins), backW = $(".window.back", wins);
    const par = () => {
      const r = wins.getBoundingClientRect();
      const t = clamp((innerHeight - r.top) / (innerHeight + r.height)) - .5;   // -0.5…0.5
      front.style.transform = `translateY(${t * -50}px)`;
      backW.style.transform = `translateY(${t * 40}px)`;
    };
    addEventListener("scroll", par, { passive: true }); par();
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
