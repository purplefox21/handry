#!/bin/bash
# kullanım: tas_serit.sh T1 [T2 ...] -> her tasarım için 4 poz render + şerit
D="$(cd "$(dirname "$0")" && pwd)"
SP="$D/../gecici"   # ara render'lar (git'e/zip'e girmez)
mkdir -p "$SP/tas"
for T in "$@"; do
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python $D/tasarim_render.py -- "{\"tasarim\":\"$T\",\"cikti\":\"$SP/tas\",\"pozlar\":[\"yuru\",\"otur_bak\",\"uyu\",\"sikil\"]}" 2>&1 | grep -E "Error|Traceback|File \"" | head -10 &
done
wait
/usr/bin/python3 - "$@" <<PY
import sys
from PIL import Image
SP="$SP"
for T in sys.argv[1:]:
    sh=Image.new("RGB",(480*4,380),(243,236,226))
    for i,p in enumerate(["yuru","otur_bak","uyu","sikil"]):
        im=Image.open(f"{SP}/tas/{T}_{p}.png").resize((480,380),Image.LANCZOS)
        bg=Image.new("RGBA",im.size,(243,236,226,255)); bg.alpha_composite(im); sh.paste(bg.convert("RGB"),(i*480,0))
    sh.save(f"{SP}/{T}_serit.png")
PY
