# Upscaling video and images (Topaz)

The `upscale` command makes an existing video or image sharper and higher-resolution through Topaz on Fal.

```bash
GEN quote upscale --input "<source>" [--target-height 1080] [--factor 2] [--fps 30] [--type video|image]
# -> {"estimate_usd": 0.62, "detail": "..."}   video: tell the user, wait for yes
GEN upscale --input "<source>" [--target-height 1080] [--factor 2] [--fps 30] \
  [--type video|image] [--model <key>] [--title <slug>] [--approve-usd 0.62]
```

**Needs ffmpeg/ffprobe** to read dimensions, length and frame rate, and for the `--fps` re-encode. Without it, image upscales need `--factor` and video upscales won't run. (`winget install ffmpeg` on Windows, `brew install ffmpeg` on Mac.)

**How it avoids stretching.** The script reads the source size and sends Topaz a *single* `upscale_factor` for both axes, capped at 4x. It never sets width and height separately, so the aspect ratio can't change.

- `--target-height` (default 1080): the factor is worked out from the source height.
- `--factor`: an explicit multiplier; wins over target-height.
- Type comes from the file extension; force it with `--type`.

## Cost rules

Topaz video bills per second of output:

- up to 720p: ~$0.01/s
- 720p to 1080p: ~$0.02/s
- above 1080p: ~$0.08/s
- **Doubles if the output is 60fps.**

Every video upscale needs `--approve-usd` (the script exits 3 with the quote otherwise). For a 60fps source, either accept the doubled rate or add `--fps 30`: the script re-encodes locally to 30fps before uploading, halving the cost. State the math (`$/s x seconds = $total`) and wait for an explicit yes.

**Image upscales** cost $0.08 up to 24MP output, $0.16 to 48MP, $0.32 to 96MP, and run without asking up to that. Above 96MP the script asks for approval.

## Set expectations

Upscaling sharpens and cleans; it doesn't invent detail that was never captured. A very soft or low-bitrate source comes out cleaner but won't become crisp HD. Best on footage that's decent but low-resolution.

Output saves as `upscaled-NN.mp4` / `upscaled-NN.png` in a dated folder, with `prompt.md` recording the source size and factor.
