#!/usr/bin/env python3
# Crafts a zip whose entry names contain literal ../ (python zipfile stores
# names verbatim, unlike AdmZip which sanitizes on addFile) — used by
# e2e-v92-zip-binary.mjs to prove the route's own traversal guard works.
import zipfile, sys

with zipfile.ZipFile(sys.argv[1], 'w') as z:
    z.writestr('../evil2.txt', 'escape attempt')
    z.writestr('my-app/../evil3.txt', 'escape attempt 2')
    z.writestr('ok.txt', 'fine')
print('crafted', sys.argv[1])
