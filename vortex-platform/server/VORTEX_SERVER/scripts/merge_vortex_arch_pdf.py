#!/usr/bin/env python3
"""Merge cover + body into the final VORTEX SERVER architecture PDF."""
from pypdf import PdfReader, PdfWriter

A4_W, A4_H = 595.28, 841.89

def normalize(page):
    w, h = float(page.mediabox.width), float(page.mediabox.height)
    if abs(w - A4_W) > 0.05 or abs(h - A4_H) > 0.05:
        page.scale_to(A4_W, A4_H)
        page.mediabox.lower_left = (0, 0)
        page.mediabox.upper_right = (A4_W, A4_H)
    return page

writer = PdfWriter()
writer.add_page(normalize(PdfReader("/home/z/my-project/download/VORTEX_SERVER_Architecture_cover.pdf").pages[0]))
for p in PdfReader("/home/z/my-project/download/VORTEX_SERVER_Architecture_body.pdf").pages:
    writer.add_page(normalize(p))
writer.add_metadata({
    "/Title": "VORTEX SERVER - Central Cloud Infrastructure Technical Architecture",
    "/Author": "Z.ai",
    "/Creator": "Z.ai",
    "/Subject": "Technical architecture, database schema, API specification and infrastructure requirements",
})
out = "/home/z/my-project/download/VORTEX_SERVER_Architecture.pdf"
with open(out, "wb") as f:
    writer.write(f)
print("MERGED:", out, "pages:", 1 + len(PdfReader("/home/z/my-project/download/VORTEX_SERVER_Architecture_body.pdf").pages))
