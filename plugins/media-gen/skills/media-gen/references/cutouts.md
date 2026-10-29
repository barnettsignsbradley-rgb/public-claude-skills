# Cutouts, variants and vibe boards

Lessons from a real build: one generated object had to float
on a web page, swap finishes without touching CSS, and be judged by eye.

## Cutting an object out of its render

Fal renders arrive on a backdrop, not transparent. A clean alpha without a
matting model, in Pillow and numpy (run with plain `python`, see below):

1. **Colour-key against the render's own backdrop.** Take the median colour of
   the four corners (or a strip the object never touches) as the key. Distance
   from that colour, scaled, is the first alpha. A single flat backdrop in the
   prompt ("on a plain mid-grey studio sweep, no shadow on the ground") makes
   this step reliable; ask for it.
2. **Close the mask.** `MaxFilter` then `MinFilter` (3 to 5 px) fills pinholes
   in highlights and trims halo. Hard edges on a machined object survive this;
   fur and glass do not, use a matting model for those.
3. **Unmix the edge.** Semi-transparent pixels still carry backdrop colour.
   Recover the object colour with `C = (P - B * (1 - a)) / a`, clamp to 0..255.
   Without this the fringe is grey on a dark page.
4. **Guard with a sibling.** When recolouring (below), key the new render but
   intersect its mask with the original's silhouette; a dark finish keyed on
   its own loses its shadow side.
5. **Crop to a fixed anchor, not to the bounding box.** Decide where the
   object's reference point sits in the output frame (the pencil tip at 8.2%
   from the left, 94% from the top of a 1000 x 1260 frame) and crop every
   variant to that same anchor. Then any finish drops into the page and the
   CSS that positions the tip never changes.
6. Save WEBP at q85 to q90 for the page; keep the uncut render beside it
   (`<name>-full.jpg`) so the crop can be redone.

## Finish and colour variants

Run `nano-banana-pro-edit` with the chosen render as `--input-image` and a
prompt that changes only the material ("the same pencil, matte black barrel,
one orange anodised band, everything else identical"). The silhouette and
pose come back the same, so the cutout recipe above runs unchanged and the
variant lands on the same anchor. Four or five finishes on one board is the
right number to pick from.

## Vibe boards

When the person cannot say what look they want, do not send them hunting web
references. Generate four distinct directions (one `--num-images 4` run, or
four prompts when the directions differ in material and era), then write a
local `board.html` next to the images: a grid, each image captioned with its
direction in five words, opened in the browser. They point at one. A second
board of variations on the pick is usually the last board needed.

## Traps

- `python -I` disables user site-packages, which is where `pip install
  --user Pillow` lands. Run the cutout pipeline with plain `python`.
- A CSS `mask-image` that points at the cutout is fetched with CORS. Over
  `file://` it fails silently and the masked element renders empty, so
  screenshot through a local http server (`python -m http.server`).
- The `cmd.exe /c start` route for opening a board from Git Bash can hang
  the shell; use PowerShell `Start-Process <path>` instead.
