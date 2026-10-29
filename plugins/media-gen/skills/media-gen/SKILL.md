---
name: media-gen
description: Generate AI images and videos, and upscale existing ones, through Fal.ai (pay per use, files saved locally). Use when the user explicitly asks to generate, render or create an AI image, photo or video ("generate an image of...", "make a video of...", "turn this image into a video", "media-gen ..."), when another skill such as taste-build needs generated hero images or video, or to upscale a clip or picture ("upscale this", "make this HD"). Not for finding stock photos, editing code-drawn graphics, or screenshots.
---

# Media Gen

Image, image-to-video and upscale pipeline on Fal.ai. Every result lands in a dated local folder with a `prompt.md` record. Models and prices live in `models.json` next to this file.

**Running the script.** It's `scripts/generate.py` under this skill's base directory (shown when the skill loads). Call it by full path with `python` on Windows, `python3` elsewhere. Below, `GEN` stands for that command, e.g. `python "<base-dir>/scripts/generate.py"`.

## Operating principles

1. **Refine the prompt before sending it.** The user's casual description is the brief, not the prompt. Expand it into a strong prompt for the chosen model.
2. **Use the registry defaults** unless the user names a model: image `nano-banana-pro`, image with references `nano-banana-pro-edit`, video `seedance-2-pro`, upscale Topaz. Read `models.json` only when the user names another model, or you're updating the registry. The script prints the registry's age on every run; if it's over 30 days old, offer a refresh once, then drop it.
3. **Be conversational, not form-driven.** One question at a time, accept defaults.
4. **Don't auto-animate.** After an image, ask "want to turn this into a video?". Never assume.
5. **Money: quote, then wait for yes.** Images cost ~$0.15 each ($0.30 at 4K) and run without asking, one at a time unless the user or a calling skill asks for several. Video and video upscales are billed per second and **the script refuses to run them** until you pass `--approve-usd` with an amount at least its estimate. Get the estimate with `GEN quote video ...` (or `quote upscale ...`), tell the user the number, and only after an explicit yes re-run with `--approve-usd <that number>`. Never invent approval, never pass a higher number "to be safe". Default video duration is **5s**.
6. **On script error, relay the stderr message.** It names the exact fix (key setup, install command, 404 remediation). Exit code 3 means "needs approval", not a failure.

## Workflow

### Step 1: Read intent

Pull out subject and action, style cues (photo, illustration, cinematic), and derive a 3-5 word kebab-case **working title** (`dog-swimming-tennis-ball`). Don't ask for the title.

### Step 2: Refine the prompt

Expand into 2-4 sentences: lighting, composition, lens/camera language, environment, mood. Nano Banana Pro wants natural-language description, not weighted token syntax (`(masterpiece:1.4)`).

Show the refined prompt and ask **"Run this, or want to adjust?"** Their edits win. (When another skill is driving, e.g. taste-build's hero stage, skip the confirmation for images; it already has the brief.)

### Step 3: Generate the image

```bash
GEN image --prompt "<refined prompt>" --title "<working-title>" \
  [--model <key>] [--aspect-ratio 16:9] [--resolution 2K] [--num-images 1-4] \
  [--input-image "<ref-path>" ...] [--folder "<existing folder>"]
```

It prints one JSON line with `image_path`, `image_paths` and `folder`. Show the user the local path (and open or display the image if you can).

For the same character, face or style across shots, read `references/character-consistency.md`. References need `--model nano-banana-pro-edit`; the default model refuses them.

For an object that has to float on a web page (cut out of its backdrop, swap finishes without touching CSS, picked from a board), read `references/cutouts.md`. When the user cannot name the look they want, make a vibe board as that file describes instead of sending them to hunt references.

### Step 4: Offer animation

Ask **"Want to turn this into a video?"** If yes, collect one at a time:

- **Motion prompt**: what *happens*, not what it looks like ("The dog paddles forward, water splashing, slow dolly in.").
- **Duration**: 5s. Go to 10s only if they ask after seeing a 5s draft.
- Mention the cheaper draft options if cost matters: 720p, `seedance-2-fast`, or `kling-v3-pro` (~$0.84 for 5s).

Then quote, confirm, run:

```bash
GEN quote video --image "<image_path>" --prompt "<motion>" --title "<working-title>" [--model <key>] [--resolution 720p] [--duration 5] [--no-audio]
# -> {"estimate_usd": 3.41, ...}   tell the user, wait for yes
GEN video --image "<image_path>" --prompt "<motion>" --title "<working-title>" \
  --folder "<folder from step 3>" --duration 5 [--model <key>] [--resolution 720p] [--no-audio] \
  [--end-image "<last-frame.png>"] --approve-usd 3.41
```

`--end-image` pins the clip's last frame (Seedance 2.0 and Kling take it). Use it whenever a clip has to land on a known picture: a transformation between two stills, or chaining clips so clip 2 starts exactly where clip 1 ends. Make the end still with `nano-banana-pro-edit` from the start still so the framing is identical, and open the motion prompt with "Static locked-off tripod shot, camera never moves."

## Upscaling (Topaz)

To upscale, enhance or sharpen an existing video or image, read `references/upscale.md` first. It covers the command, how aspect ratio is kept, and the cost tiers (60fps doubles the price).

## Output

One dated folder per subject under the `config.json` output root (default `~/Documents/Media Gen/`):

```
2026-10-14-dog-swimming-tennis-ball/
├── prompt.md        # every run appended: prompts, model, args, cost estimate
├── image-01.png     # image-02.png, ...
├── source-*.png     # copies of any reference images
└── video-01.mp4     # only if the video step ran
```

## Registry updates

If the user asks to refresh `models.json`: check fal.ai/models for image and video models, and for each candidate read its schema at `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<fal_id>` (field names differ: Kling takes `start_image_url`, Seedance `image_url`; durations are strings). Propose new entries and default changes as a diff with prices, get approval, write it, set `last_updated` and each `price_last_verified` to today.

## Rules of thumb

- **Don't drift from the user's intent.** Refining isn't rewriting. If they say "a dog", don't decide it's a golden retriever.
- **One generation per request** unless asked. No preemptive variants.
- **Describe the feel in plain words, not a technology.** "Mesmerizing" and "like that 3D cube" usually mean slow continuous motion and light moving over one simple object. Say what the clip or still would show before quoting a video, and offer the code-only route (CSS motion on a cutout) when it gets most of the way for nothing.
- **Uploads leave the machine.** Prompts, references and anything upscaled go to Fal's storage, and Seedance runs on ByteDance. Don't send client, family or confidential photos without the user saying it's fine.
