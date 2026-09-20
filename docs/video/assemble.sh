#!/usr/bin/env bash
# Assemble the demo video: title card + screen recording (+ voiceover if present) → Sayso-demo.mp4
#   docs/video/assemble.sh            # uses raw.webm and, if present, voiceover.mp3
set -euo pipefail
cd "$(dirname "$0")"
BANNER="../assets/banner.png"
# 1) title card (3s) and outro card (3s) at 1600x1000 — cards are PNGs (this ffmpeg has no drawtext)
python3 - <<'PY'
from PIL import Image, ImageDraw, ImageFont
W, H = 1600, 1000
img = Image.new("RGB", (W, H), (9, 9, 11)); d = ImageDraw.Draw(img)
def font(size):
    for f in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial Bold.ttf"):
        try: return ImageFont.truetype(f, size)
        except Exception: pass
    return ImageFont.load_default()
for text, size, color, dy in (("github.com/vnmoorthy/sayso", 64, (200, 255, 61), -60), ("Sayso — your terminal, on your say-so.", 34, (161, 161, 170), 40), ("SambaNova · Hume · Pipecat · Gradium  |  AGI House Voice AI Hackathon 2026", 24, (113, 113, 122), 110)):
    f = font(size); w = d.textlength(text, font=f); d.text(((W - w) / 2, H / 2 + dy - size / 2), text, font=f, fill=color)
img.save("outro.png")
PY
ffmpeg -y -loglevel error -loop 1 -i "$BANNER" -t 3 -vf "scale=1600:800,pad=1600:1000:0:100:color=0x09090B,format=yuv420p" -r 30 -c:v libx264 -pix_fmt yuv420p title.mp4
ffmpeg -y -loglevel error -loop 1 -i outro.png -t 3 -vf "format=yuv420p" -r 30 -c:v libx264 -pix_fmt yuv420p outro.mp4

# 2) screen recording → mp4 (same size/fps)
ffmpeg -y -loglevel error -i raw.webm -vf "scale=1600:1000,format=yuv420p" -r 30 -c:v libx264 -pix_fmt yuv420p -crf 20 body.mp4

# 3) concat
printf "file 'title.mp4'\nfile 'body.mp4'\nfile 'outro.mp4'\n" > list.txt
ffmpeg -y -loglevel error -f concat -safe 0 -i list.txt -c copy silent.mp4

# 4) voiceover (optional): pad/trim audio to the video length
if [[ -f voiceover.mp3 ]]; then
  ffmpeg -y -loglevel error -i silent.mp4 -i voiceover.mp3 -filter_complex "[1:a]adelay=3000|3000,apad[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 160k -shortest Sayso-demo.mp4
  echo "✓ Sayso-demo.mp4 (with voiceover)"
else
  ffmpeg -y -loglevel error -i silent.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -c:v copy -c:a aac -shortest Sayso-demo.mp4
  echo "✓ Sayso-demo.mp4 (silent — add docs/video/voiceover.mp3 and re-run for narration)"
fi
rm -f title.mp4 outro.mp4 outro.png body.mp4 silent.mp4 list.txt
ls -la Sayso-demo.mp4
