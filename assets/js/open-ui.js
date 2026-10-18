"use strict";
(function () {
  const $ = id => document.getElementById(id);
  const form = $("openForm"), files = $("encFiles"), drop = $("drop"), list = $("results"), btn = $("openBtn");
  const urls = [];
  const size = n => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : n < 1073741824 ? (n / 1048576).toFixed(1) + " MB" : (n / 1073741824).toFixed(2) + " GB";
  const VIEW = /\.(pdf|png|jpe?g|gif|webp|txt|md|csv)$/i;
  const TYPES = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", txt: "text/plain;charset=utf-8", md: "text/plain;charset=utf-8", csv: "text/plain;charset=utf-8" };

  if (!window.crypto || !crypto.subtle || !window.DecompressionStream || !window.WebAssembly) {
    $("unsupported").hidden = false;
    btn.disabled = true;
  }

  function showChosen() {
    const n = files.files.length;
    $("chosen").textContent = n ? (n === 1 ? files.files[0].name : n + " files") + " · " + size([...files.files].reduce((s, f) => s + f.size, 0)) : "No file chosen";
  }
  files.addEventListener("change", showChosen);
  ["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("hot"); }));
  ["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("hot"); }));
  drop.addEventListener("drop", e => { if (e.dataTransfer.files.length) { files.files = e.dataTransfer.files; showChosen(); } });

  function row(file) {
    const li = document.createElement("li");
    li.className = "res";
    li.innerHTML = '<div class="res-top"><b class="res-name"></b><span class="res-state">Waiting…</span></div><div class="bar"><i></i></div><div class="res-act"></div>';
    li.querySelector(".res-name").textContent = file.name;
    list.appendChild(li);
    return {
      state: (t, cls) => { const s = li.querySelector(".res-state"); s.textContent = t; s.className = "res-state " + (cls || ""); },
      bar: f => { li.querySelector(".bar i").style.width = Math.round(f * 100) + "%"; },
      done: (name, blob) => {
        li.querySelector(".res-name").textContent = name;
        const ext = (name.split(".").pop() || "").toLowerCase();
        const typed = TYPES[ext] ? new Blob([blob], { type: TYPES[ext] }) : blob;
        const url = URL.createObjectURL(typed); urls.push(url);
        const act = li.querySelector(".res-act");
        const a = document.createElement("a"); a.className = "btn btn-primary small"; a.href = url; a.download = name; a.textContent = "Save " + name;
        act.appendChild(a);
        if (VIEW.test(name)) { const v = document.createElement("a"); v.className = "btn btn-ghost small"; v.href = url; v.target = "_blank"; v.rel = "noopener"; v.textContent = "View"; act.appendChild(v); }
        li.classList.add("ok");
      },
    };
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const pw = $("pw").value, kf = $("keyFile").files[0] || null;
    if (!files.files.length) { $("chosen").textContent = "Choose a .enc file first"; return; }
    btn.disabled = true;
    for (const f of [...files.files]) {
      const r = row(f);
      try {
        const { name, blob } = await ClavisOpen.openFile(f, pw, kf, (frac, msg) => { r.bar(frac); r.state(msg); });
        r.bar(1); r.state("Opened · " + size(blob.size), "good"); r.done(name, blob);
      } catch (err) {
        r.bar(0);
        if (err instanceof ClavisOpen.BadPassword) r.state("Wrong password or key file", "bad");
        else if (err instanceof ClavisOpen.Damaged) r.state("Couldn't open: " + err.message, "bad");
        else if (err && /memory|allocation/i.test(err.message || "")) r.state("Not enough memory on this device for that file. Try a computer.", "bad");
        else r.state(err && err.message ? err.message : "Couldn't open this file", "bad");
      }
    }
    $("pw").value = "";
    btn.disabled = false;
  });

  $("clearBtn").addEventListener("click", () => {
    urls.splice(0).forEach(u => URL.revokeObjectURL(u));
    list.innerHTML = ""; form.reset(); showChosen();
  });
  window.addEventListener("pagehide", () => urls.forEach(u => URL.revokeObjectURL(u)));
})();
