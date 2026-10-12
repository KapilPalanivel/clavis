/*
 * Opens Clavis Encrypt .enc files in the browser, entirely on this device.
 * Same rules as tools/clavis_decrypt.py and the format described on format.html:
 * nothing is uploaded (the page's Content-Security-Policy forbids network requests).
 * Needs: WebCrypto (AES-GCM, HKDF, PBKDF2, SHA-256), DecompressionStream('gzip'),
 * and hash-wasm's Argon2id (assets/js/vendor/argon2.umd.min.js, MIT).
 */
"use strict";
(function () {
  const MAGIC = [0x46, 0x45, 0x4e, 0x43];                 // "FENC"
  const STREAM = 0x03, ARGON2 = 0x02, PBKDF2 = 0x01, SHARED = 0x04;
  const HEADER = 38, TAG = 16;
  const enc = new TextEncoder(), dec = new TextDecoder("utf-8", { fatal: false });
  const subtle = crypto.subtle;

  class BadPassword extends Error {}
  class Damaged extends Error {}

  const cat = (...parts) => { const n = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
  const hex = b => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");

  async function aesKey(raw) { return subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]); }

  async function argonKey(pw, salt, mem, iters, par, kfHash) {
    let key = await hashwasm.argon2id({ password: pw, salt, parallelism: par, iterations: iters, memorySize: mem, hashLength: 32, outputType: "binary" });
    if (kfHash) {                                          // key file: HKDF-SHA256(argon2 || sha256(keyfile), salt, info)
      const k = await subtle.importKey("raw", cat(key, kfHash), "HKDF", false, ["deriveBits"]);
      key = new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode("fileencryptionapp-keyfile-v1") }, k, 256));
    }
    return aesKey(key);
  }

  async function pbkdf2Key(pw, salt, iters, kfHash) {
    if (kfHash) pw = cat(pw, new Uint8Array([0]), enc.encode(hex(kfHash)));
    const k = await subtle.importKey("raw", pw, "PBKDF2", false, ["deriveBits"]);
    return aesKey(new Uint8Array(await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iters }, k, 256)));
  }

  async function gunzip(chunks) {                          // chunks: async iterable of Uint8Array -> Blob
    const ds = new DecompressionStream("gzip");
    const out = new Response(ds.readable).blob();
    const w = ds.writable.getWriter();
    const broken = () => new Damaged("the compressed content is damaged or incomplete");
    const it = chunks[Symbol.asyncIterator]();
    while (true) {
      let step;
      try { step = await it.next(); }                      // decryption errors keep their own meaning
      catch (e) { out.catch(() => {}); w.abort().catch(() => {}); throw e; }
      if (step.done) break;
      if (!step.value.length) continue;
      try { await w.write(step.value); } catch (e) { out.catch(() => {}); throw broken(); }
    }
    try { await w.close(); } catch (e) { out.catch(() => {}); throw broken(); }
    try { return await out; } catch (e) { throw new Damaged("the compressed content is damaged or incomplete"); }
  }

  async function openStream(file, header, pw, kfHash, progress) {
    const dv = new DataView(header.buffer, header.byteOffset);
    const salt = header.slice(5, 21), mem = dv.getUint32(21), iters = header[25], par = header[26], chunk = dv.getUint32(27), prefix = header.slice(31, 38);
    if (chunk < 4096 || chunk > 16 * 1024 * 1024) throw new BadPassword();
    progress(0, "Unlocking (this takes a few seconds)…");
    const key = await argonKey(pw, salt, mem, iters, par, kfHash);
    let name = null;
    async function* plain() {
      let off = HEADER, n = 0, meta = new Uint8Array(0);
      while (true) {
        const end = Math.min(off + chunk + TAG, file.size), last = end >= file.size;
        const sealed = new Uint8Array(await file.slice(off, end).arrayBuffer());
        const nonce = cat(prefix, new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, last ? 1 : 0]));
        let p;
        try { p = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: header, tagLength: 128 }, key, sealed)); }
        catch (e) { if (n === 0) throw new BadPassword(); throw new Damaged("it was damaged or altered (part " + n + ")"); }
        if (name === null) {                               // the original name comes first
          meta = cat(meta, p);
          if (meta.length >= 2) {
            const len = (meta[0] << 8) | meta[1];
            if (meta.length >= 2 + len) { name = dec.decode(meta.slice(2, 2 + len)); yield meta.slice(2 + len); }
          }
        } else yield p;
        n++; off = end;
        progress(off / file.size, "Decrypting…");
        if (last) break;
      }
      if (name === null) throw new Damaged("it is incomplete");
    }
    const blob = await gunzip(plain());
    return { name, blob };
  }

  async function openWhole(file, pw, kfHash, progress) {
    const data = new Uint8Array(await file.arrayBuffer());
    const v = data[4], dv = new DataView(data.buffer);
    let key, iv, body;
    progress(0, "Unlocking…");
    if (v === ARGON2) {
      key = await argonKey(pw, data.slice(5, 21), dv.getUint32(21), data[25], data[26], kfHash);
      iv = data.slice(27, 39); body = data.subarray(39);
    } else if (v === PBKDF2) {
      key = await pbkdf2Key(pw, data.slice(9, 25), dv.getUint32(5), kfHash);
      iv = data.slice(25, 37); body = data.subarray(37);
    } else {                                               // oldest files: no version byte
      key = await pbkdf2Key(pw, data.slice(4, 20), 65536, kfHash);
      iv = data.slice(20, 32); body = data.subarray(32);
    }
    let payload;
    try { payload = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, body)); }
    catch (e) { throw new BadPassword(); }
    const digest = payload.slice(0, 32), len = (payload[32] << 8) | payload[33];
    const name = dec.decode(payload.slice(34, 34 + len));
    const blob = await gunzip((async function* () { yield payload.subarray(34 + len); })());
    const sum = new Uint8Array(await subtle.digest("SHA-256", await blob.arrayBuffer()));
    if (hex(sum) !== hex(digest)) throw new Damaged("its integrity check failed");
    return { name, blob };
  }

  /** Decrypt one .enc File. Returns {name, blob}; throws BadPassword or Damaged (or Error with a message). */
  async function openFile(file, password, keyFile, progress) {
    progress = progress || function () {};
    const pw = enc.encode(password);
    const kfHash = keyFile ? new Uint8Array(await subtle.digest("SHA-256", await keyFile.arrayBuffer())) : null;
    const header = new Uint8Array(await file.slice(0, HEADER).arrayBuffer());
    if (header.length < 5 || MAGIC.some((b, i) => header[i] !== b)) throw new Error("This isn't a Clavis Encrypt file.");
    if (header[4] === SHARED) throw new Error("This file was made with “Encrypt for someone”. It opens only in Clavis Encrypt, with the recipient's Clavis ID.");
    if (header[4] === STREAM && header.length === HEADER) {
      try { return await openStream(file, header, pw, kfHash, progress); }
      catch (e) {
        if (!(e instanceof BadPassword) || file.size > 256 * 1024 * 1024) throw e;
        try { return await openWhole(file, pw, kfHash, progress); }   // an oldest-format file whose salt starts with 0x03
        catch (e2) { throw new BadPassword(); }
      }
    }
    return openWhole(file, pw, kfHash, progress);
  }

  window.ClavisOpen = { openFile, BadPassword, Damaged };
})();
