#!/usr/bin/env python3
"""Post-process the generated docx:
1. Remove empty <w:pgNumType/> from document.xml (WPS confusion).
2. Patch footer PAGE fields with explicit \\* arabic format switch (WPS ignores pgNumType fmt).
"""
import re
import sys
import zipfile

def main(path):
    with zipfile.ZipFile(path, "r") as zin:
        entries = {n: zin.read(n) for n in zin.namelist()}

    # 1. Remove empty pgNumType from document.xml
    doc = entries["word/document.xml"].decode("utf-8")
    before = doc.count("<w:pgNumType/>")
    doc = doc.replace("<w:pgNumType/>", "")
    print(f"document.xml: removed {before} empty pgNumType")

    # 1b. Tighten TOC placeholder paragraph spacing (direct formatting, added by
    # add_toc_placeholders.py) so the whole TOC + field-end fits on one page.
    tight = '<w:spacing w:before="60" w:after="30" w:line="276" w:lineRule="auto"/>'
    n_toc = doc.count('<w:spacing w:before="120" w:after="60"/>')
    doc = doc.replace('<w:spacing w:before="120" w:after="60"/>', tight)
    print(f"document.xml: tightened {n_toc} TOC placeholder paragraph(s)")
    entries["word/document.xml"] = doc.encode("utf-8")

    # 1c. Same tightening inside TOC 1/2/3 styles (used when Word regenerates the TOC)
    if "word/styles.xml" in entries:
        styles = entries["word/styles.xml"].decode("utf-8")
        s1 = styles.count('<w:spacing w:before="120" w:after="60"/>')
        styles = styles.replace('<w:spacing w:before="120" w:after="60"/>', tight)
        s2 = styles.count('<w:spacing w:before="60" w:after="40"/>')
        styles = styles.replace('<w:spacing w:before="60" w:after="40"/>', tight)
        s3 = styles.count('<w:spacing w:before="40" w:after="20"/>')
        styles = styles.replace('<w:spacing w:before="40" w:after="20"/>', tight)
        entries["word/styles.xml"] = styles.encode("utf-8")
        print(f"styles.xml: tightened TOC styles ({s1}, {s2}, {s3})")

    # 2. Patch footer PAGE fields
    patched = 0
    for name in list(entries.keys()):
        if re.match(r"word/footer\d*\.xml$", name):
            xml = entries[name].decode("utf-8")
            new_xml, n1 = re.subn(
                r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
                r"\1 PAGE \\* arabic \\* MERGEFORMAT \2",
                xml,
            )
            new_xml, n2 = re.subn(
                r'w:instr="\s*PAGE\s*"',
                'w:instr="PAGE \\\\* arabic \\\\* MERGEFORMAT"',
                new_xml,
            )
            if n1 + n2 > 0:
                entries[name] = new_xml.encode("utf-8")
                patched += n1 + n2
                print(f"{name}: patched {n1 + n2} PAGE field(s)")
    print(f"footer fields patched: {patched}")

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, data in entries.items():
            zout.writestr(name, data)
    print(f"rewritten: {path}")

if __name__ == "__main__":
    main(sys.argv[1])
