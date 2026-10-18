#!/usr/bin/env python3
"""
clavis_decrypt.py: open Clavis Encrypt (.enc) files without Clavis Encrypt.

Your files never depend on the app. This small, readable script decrypts any
password-encrypted .enc file made by any version of Clavis Encrypt, using only
your password (and your key file, if you set one). The file format it follows is
published at https://clavisenc.com/format.html

    pip install cryptography argon2-cffi
    python clavis_decrypt.py FILE.enc [FILE2.enc ...] [-o OUTPUT_FOLDER] [--keyfile KEYFILE] [--verify]

The password is asked for (not shown while typing), or read from the
CLAVIS_PASSWORD environment variable. Each file is restored under its original
name in the output folder (default: next to the .enc). Nothing is ever deleted.
--verify checks that the password opens each file and nothing was altered,
without writing anything.

Not covered: files made with "Encrypt for someone" (they open only with the
recipient's private Clavis ID, which this script deliberately doesn't handle).

MIT License. Copyright (c) 2026 Clavis Encryption.
Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions: The above copyright notice and this
permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
"""
import argparse
import getpass
import hashlib
import hmac
import os
import struct
import sys
import zlib

try:
    from argon2.low_level import Type, hash_secret_raw
    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
except ImportError:
    sys.exit("Needs two libraries first:  pip install cryptography argon2-cffi")

MAGIC = b"FENC"
FORMAT_STREAM = 0x03        # current format (since 3.0): chunked AES-256-GCM
FORMAT_ARGON2 = 0x02        # one AES-256-GCM tag over the whole file, Argon2id key
FORMAT_PBKDF2 = 0x01        # same, PBKDF2-HMAC-SHA256 key with the iteration count in the header
FORMAT_SHARED = 0x04        # "Encrypt for someone" (public-key), not handled here
LEGACY_PBKDF2_ITERATIONS = 65536   # the oldest files have no version byte
KEYFILE_INFO = b"fileencryptionapp-keyfile-v1"
TAG = 16
STREAM_HEADER = 38          # MAGIC 4 + format 1 + salt 16 + memory 4 + iterations 1 + parallelism 1 + chunk size 4 + nonce prefix 7


class BadPassword(Exception):
    pass


# ------------------------------------------------------------------ keys

def argon2id_key(password, salt, memory_kib, iterations, parallelism, keyfile_hash):
    key = hash_secret_raw(password, salt, time_cost=iterations, memory_cost=memory_kib,
                          parallelism=parallelism, hash_len=32, type=Type.ID, version=19)
    if keyfile_hash:                                   # key file: HKDF-SHA256(argon2 || sha256(keyfile), salt)
        key = HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=KEYFILE_INFO).derive(key + keyfile_hash)
    return key


def pbkdf2_key(password, salt, iterations, keyfile_hash):
    if keyfile_hash:                                   # old key-file scheme: password + NUL + hex(sha256(keyfile))
        password = password + b"\0" + keyfile_hash.hex().encode()
    return hashlib.pbkdf2_hmac("sha256", password, salt, iterations, 32)


# ------------------------------------------------------------------ formats

def stream_decrypt(f, header, password, keyfile_hash, sink):
    """Format 3: the plaintext stream is [name length u16][name][gzip(content)], cut into chunks."""
    salt = header[5:21]
    memory, iterations, parallelism, chunk = struct.unpack(">IBBI", header[21:31])
    prefix = header[31:38]
    if not 4096 <= chunk <= 16 * 1024 * 1024:
        raise ValueError("not a Clavis stream file (bad chunk size)")
    aes = AESGCM(argon2id_key(password, salt, memory, iterations, parallelism, keyfile_hash))
    gz = zlib.decompressobj(wbits=31)                  # gzip framing
    meta, name, counter = b"", None, 0
    sealed = f.read(chunk + TAG)
    while True:
        nxt = f.read(chunk + TAG)
        last = not nxt                                 # the final chunk is sealed with last=1
        nonce = prefix + struct.pack(">IB", counter, 1 if last else 0)
        try:
            plain = aes.decrypt(nonce, sealed, header)  # the header is the associated data
        except InvalidTag:
            if counter == 0:
                raise BadPassword()
            raise ValueError(f"damaged or altered (chunk {counter})")
        if name is None:                               # file name comes first
            meta += plain
            if len(meta) >= 2:
                n = struct.unpack(">H", meta[:2])[0]
                if len(meta) >= 2 + n:
                    name = meta[2:2 + n].decode("utf-8")
                    sink.start(name)
                    sink.write(gz.decompress(meta[2 + n:]))
        else:
            sink.write(gz.decompress(plain))
        counter += 1
        if last:
            break
        sealed = nxt
    if name is None or not gz.eof or gz.unused_data:
        raise ValueError("incomplete or damaged content")
    return name


def whole_decrypt(data, password, keyfile_hash, sink):
    """Formats 2, 1 and the oldest: one GCM tag; plaintext is [sha256(content)][name length u16][name][gzip(content)]."""
    v = data[4]
    if v == FORMAT_ARGON2:
        salt = data[5:21]
        memory, iterations, parallelism = struct.unpack(">IBB", data[21:27])
        iv, body = data[27:39], data[39:]
        key = argon2id_key(password, salt, memory, iterations, parallelism, keyfile_hash)
    elif v == FORMAT_PBKDF2:
        iterations = struct.unpack(">I", data[5:9])[0]
        salt, iv, body = data[9:25], data[25:37], data[37:]
        key = pbkdf2_key(password, salt, iterations, keyfile_hash)
    else:                                              # oldest files: no version byte
        salt, iv, body = data[4:20], data[20:32], data[32:]
        key = pbkdf2_key(password, salt, LEGACY_PBKDF2_ITERATIONS, keyfile_hash)
    try:
        payload = AESGCM(key).decrypt(iv, body, None)
    except InvalidTag:
        raise BadPassword()
    digest, n = payload[:32], struct.unpack(">H", payload[32:34])[0]
    name = payload[34:34 + n].decode("utf-8")
    content = zlib.decompress(payload[34 + n:], wbits=31)
    if not hmac.compare_digest(digest, hashlib.sha256(content).digest()):
        raise ValueError("integrity check failed (SHA-256 mismatch)")
    sink.start(name)
    sink.write(content)
    return name


# ------------------------------------------------------------------ output

def safe_name(name):
    base = os.path.basename(name.replace("\\", "/")).strip().strip(".")
    base = "".join(c for c in base if c not in '<>:"/\\|?*' and ord(c) >= 32)
    return base or "decrypted-file"


class Sink:
    """Writes to <name>.partial and renames only after every check passed; --verify writes nothing."""

    def __init__(self, folder, verify):
        self.folder, self.verify, self.fh, self.tmp, self.name = folder, verify, None, None, None

    def start(self, name):
        self.name = safe_name(name)
        if not self.verify:
            self.tmp = os.path.join(self.folder, self.name + ".partial")
            self.fh = open(self.tmp, "wb")

    def write(self, b):
        if self.fh and b:
            self.fh.write(b)

    def commit(self):
        if not self.fh:
            return None
        self.fh.close()
        stem, ext = os.path.splitext(self.name)
        out, i = os.path.join(self.folder, self.name), 1
        while os.path.exists(out):                     # never overwrite anything
            out = os.path.join(self.folder, f"{stem} ({i}){ext}")
            i += 1
        os.replace(self.tmp, out)
        return out

    def discard(self):
        if self.fh:
            self.fh.close()
            os.remove(self.tmp)


def decrypt_file(path, password, keyfile_hash, folder, verify):
    sink = Sink(folder or os.path.dirname(os.path.abspath(path)), verify)
    try:
        with open(path, "rb") as f:
            head = f.read(STREAM_HEADER)
            if len(head) < 5 or head[:4] != MAGIC:
                raise ValueError("not a Clavis Encrypt file")
            if head[4] == FORMAT_SHARED:
                raise ValueError("made with 'Encrypt for someone': open it in Clavis Encrypt with the recipient's Clavis ID")
            if head[4] == FORMAT_STREAM and len(head) == STREAM_HEADER:
                try:
                    stream_decrypt(f, head, password, keyfile_hash, sink)
                    return sink.commit()
                except BadPassword:                    # first chunk didn't open: wrong password, or an oldest-format file
                    sink.discard()
                    sink = Sink(sink.folder, verify)
                    if os.path.getsize(path) > 256 * 1024 * 1024:
                        raise                          # an old-format file can't be this large
                    f.seek(0)                          # an oldest-format file whose salt starts with 0x03
                    try:
                        whole_decrypt(f.read(), password, keyfile_hash, sink)
                        return sink.commit()
                    except Exception:
                        sink.discard()
                        raise BadPassword()
            f.seek(0)
            whole_decrypt(f.read(), password, keyfile_hash, sink)
            return sink.commit()
    except Exception:
        sink.discard()
        raise


def main():
    ap = argparse.ArgumentParser(description="Decrypt Clavis Encrypt .enc files without the app.")
    ap.add_argument("files", nargs="+", help=".enc files")
    ap.add_argument("-o", "--out", help="output folder (default: next to each .enc)")
    ap.add_argument("--keyfile", help="the key file, if your vault uses one")
    ap.add_argument("--verify", action="store_true", help="check only; write nothing")
    a = ap.parse_args()
    if a.out:
        os.makedirs(a.out, exist_ok=True)
    pw = os.environ.get("CLAVIS_PASSWORD")
    if pw is None:
        pw = getpass.getpass("Clavis password: ")
    password = pw.encode("utf-8")
    keyfile_hash = hashlib.sha256(open(a.keyfile, "rb").read()).digest() if a.keyfile else None

    failed = 0
    for p in a.files:
        try:
            out = decrypt_file(p, password, keyfile_hash, a.out, a.verify)
            print(f"ok       {p}" + ("" if a.verify else f"  ->  {out}"))
        except BadPassword:
            failed += 1
            print(f"FAILED   {p}: wrong password or key file (or the file is damaged)")
        except Exception as e:
            failed += 1
            print(f"FAILED   {p}: {e}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
