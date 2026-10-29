# Character consistency

To keep the same character, face, wardrobe or visual style across generations, pass earlier output images as references with `--input-image` on the image command.

**Use the edit model with references.** The default `nano-banana-pro` is text-to-image only, so the script refuses references on it rather than silently dropping them. Pass `--model nano-banana-pro-edit` (`fal-ai/nano-banana-pro/edit`).

## Workflow

1. Generate the first image normally. That's the **anchor**, the character's establishing shot. Keep its path.
2. For each later shot of the same character, pass the anchor (and optionally one other strong frame) and switch models:

   ```bash
   GEN image --prompt "<new scene, same character>" --title "<series-title>" \
     --model nano-banana-pro-edit \
     --input-image "<path to anchor image-01.png>" \
     [--input-image "<another prior frame>"] \
     --folder "<the series folder>"
   ```

3. Phrase the prompt as *"the same man from the reference image, now [new action / setting]"*. Don't redescribe the face; let the reference carry it. Describe the new scene, lighting, pose and mood.
4. The script copies each reference into the output folder as `source-<filename>` for provenance.

## When to use

- Multi-shot Reels or Shorts with the same person in different scenes.
- A consistent look across a campaign (same palette, wardrobe).
- Small variations on one anchor.

## When not to

- One-off images with no continuity (it just slows the run).
- When you want a different person or style; references will fight the prompt.

## Limits

- Only the **image** command takes references. Image-to-video models animate a single input image.
- More than ~3 references muddies results. Pass the strongest 1-2.
- References upload to Fal each run; the script enforces Fal's 10 MB limit and says so if an anchor is over it (2K anchors stay well under).
