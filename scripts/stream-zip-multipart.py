#!/usr/bin/env python3
"""
v97 live-test streamer — builds a VALID zip multipart body on the fly and
streams it to stdout. No temp source zip ever touches the disk.

Hand-rolls the zip structure (ZIP_STORED, no data descriptors, exact
offsets) because python's zipfile module writes WRONG central-directory
offsets on unseekable streams (self-heals on read, but yauzl is strict).

  --mb N          size of the big payload in MB (stored random bytes)
  --project-id X  projectId multipart field (sent AFTER the file, like the UI)
  --boundary B    multipart boundary
  --cap-test      stream raw random bytes (not a zip) — for the >1GB abort test

Prints the sha256 of the big payload to stderr as BIGSHA=<hex>.
"""
import sys, os, argparse, hashlib, struct, zlib

ap = argparse.ArgumentParser()
ap.add_argument('--mb', type=int, default=1024)
ap.add_argument('--project-id', default='p')
ap.add_argument('--boundary', default='castreamv97')
ap.add_argument('--cap-test', action='store_true')
a = ap.parse_args()

out = sys.stdout.buffer
B = a.boundary.encode()
pos = 0  # manual position tracker — stdout on a pipe can't tell()

def w(b):
    global pos
    pos += len(b)
    out.write(b)

def part(name, filename=None):
    w(b'--' + B + b'\r\n')
    if filename:
        w(f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode())
        w(b'Content-Type: application/zip\r\n')
    else:
        w(f'Content-Disposition: form-data; name="{name}"\r\n'.encode())
    w(b'\r\n')

def end_part():
    w(b'\r\n')

if a.cap_test:
    # raw garbage stream > 1GB — server must abort at the cap, never parse
    part('file', 'huge.zip')
    remaining = a.mb * 1024 * 1024
    chunk = os.urandom(1024 * 1024)
    while remaining > 0:
        n = min(len(chunk), remaining)
        w(chunk[:n])
        remaining -= n
    end_part()
    part('projectId'); w(a.project_id.encode()); end_part()
    w(b'--' + B + b'--\r\n')
    out.flush()
    sys.exit(0)

part('file', 'big.zip')
h = hashlib.sha256()
one_mb = os.urandom(1024 * 1024)
ZIP_BASE = pos  # zip offsets are relative to the ZIP's own start, not the multipart body

def stored_file(name, chunks_iter):
    """ZIP_STORED with data descriptor (bit 3) — streams without buffering;
    offsets relative to ZIP_BASE, exact — which is what yauzl needs."""
    name_b = name.encode('utf8')
    offset = pos - ZIP_BASE
    w(struct.pack('<IHHHHHIIIHH', 0x04034b50, 20, 0x0008, 0, 0, 0, 0, 0, 0, len(name_b), 0))
    w(name_b)
    crc = 0
    size = 0
    for buf in chunks_iter:
        crc = zlib.crc32(buf, crc)
        size += len(buf)
        if name == 'my-app/big/big.bin':
            h.update(buf)
        w(buf)
    w(struct.pack('<IIII', 0x08074b50, crc & 0xffffffff, size, size))
    return (name_b, crc & 0xffffffff, size, offset)

files = []
files.append(stored_file('my-app/big/big.bin', (one_mb for _ in range(a.mb))))
files.append(stored_file('my-app/readme.txt', iter([b'v97 streaming import test\n' * 10])))
png = bytes.fromhex('89504e470d0a1a0a0000000d494844520000000100000001080600000'
                    '01f15c4890000000d49444154789c626001000000ffff03000006000557bfabd4'
                    '0000000049454e44ae426082')
files.append(stored_file('my-app/assets/tiny.png', iter([png])))
files.append(stored_file('my-app/nested/lib/util.ts', iter([b'export const v97 = "streamed"\n'])))

cd_offset = pos - ZIP_BASE
cd_size = 0
for name_b, crc, size, off in files:
    w(struct.pack('<IHHHHHHIIIHHHHHII', 0x02014b50, 20, 20, 0, 0, 0, 0, crc, size, size, len(name_b), 0, 0, 0, 0, 0, off))
    w(name_b)
    cd_size += 46 + len(name_b)
eocd_at = pos
w(struct.pack('<IHHHHIIH', 0x06054b50, 0, 0, len(files), len(files), cd_size, cd_offset, 0))
out.flush()

end_part()
part('projectId'); w(a.project_id.encode()); end_part()
w(b'--' + B + b'--\r\n')
out.flush()
print(f'BIGSHA={h.hexdigest()}', file=sys.stderr)
