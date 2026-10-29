#!/usr/bin/env python3
"""media-gen: image, image-to-video and upscale through Fal.ai.

Usage:
  generate.py image   --prompt P --title T [--model K] [--aspect-ratio R] [--resolution R]
                      [--num-images N] [--input-image PATH ...] [--folder DIR] [--extra k=v ...]
  generate.py video   --image PATH --prompt P --title T [--folder DIR] [--duration S]
                      [--model K] [--resolution R] [--no-audio] [--approve-usd X] [--extra k=v ...]
  generate.py upscale --input PATH [--target-height H] [--factor F] [--fps N]
                      [--type video|image] [--model K] [--folder DIR] [--approve-usd X]
  generate.py quote   video|upscale ...same flags...   (prints the cost, spends nothing)

Paid steps that cost real money (video, video upscale, very large image upscale)
refuse to run unless --approve-usd is at least the quoted estimate. They exit 3 and
print the quote instead, so a spend always needs a number the user agreed to.

stdout: one JSON line on success. stderr: progress, warnings and errors with the fix.
"""

import argparse
import datetime as dt
import json
import mimetypes
import os
import re
import shutil
import ssl
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
FAL_CLIENT_PIN = "fal-client==1.0.3"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
EXIT_NEEDS_APPROVAL = 3


def die(msg, code=1):
    print(f"media-gen error: {msg}", file=sys.stderr)
    sys.exit(code)


def warn(msg):
    print(f"media-gen: {msg}", file=sys.stderr)


def load_json(name):
    path = SKILL_DIR / name
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        die(f"{path} is missing. Reinstall the media-gen skill.")
    except json.JSONDecodeError as e:
        die(f"{path} is not valid JSON ({e}). Fix the file or reinstall.")


def registry_age_check(registry):
    stamp = registry.get("last_updated")
    try:
        age = (dt.date.today() - dt.date.fromisoformat(stamp)).days
    except (TypeError, ValueError):
        warn("models.json has no valid last_updated date.")
        return
    warn(f"model registry last updated {stamp} ({age} days ago)")
    if age > 30:
        warn("registry is over 30 days old; offer the user a refresh (see SKILL.md, Registry updates).")


def output_root(config):
    raw = config.get("output_dir", "~/Documents/Media Gen")
    return Path(os.path.expandvars(os.path.expanduser(raw)))


def slugify(text):
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:60] or "untitled"


def resolve_folder(config, title, folder):
    if folder:
        path = Path(folder).expanduser()
    else:
        path = output_root(config) / f"{dt.date.today().isoformat()}-{slugify(title)}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def next_name(folder, stem, ext):
    n = 1
    while True:
        candidate = folder / f"{stem}-{n:02d}{ext}"
        if not candidate.exists():
            return candidate
        n += 1


def load_fal():
    key = os.environ.get("FAL_KEY", "").strip()
    if not key:
        key_file = Path.home() / ".fal_key"
        if key_file.exists():
            key = key_file.read_text(encoding="utf-8").strip()
    if not key:
        die(
            "FAL_KEY not set. Put your Fal API key on one line in "
            f"{Path.home() / '.fal_key'}, or set the FAL_KEY environment variable "
            "(Windows: setx FAL_KEY \"your-key\", then open a new terminal). "
            "Get a key at https://fal.ai/dashboard/keys."
        )
    os.environ["FAL_KEY"] = key
    try:
        import fal_client  # noqa: PLC0415
    except ImportError:
        die(
            "the fal-client package isn't installed. Install it once with: "
            f'{Path(sys.executable).name} -m pip install "{FAL_CLIENT_PIN}"'
        )
    return fal_client


def pick_model(registry, section, key):
    block = registry[section]
    key = key or block["default"]
    if key not in block["models"]:
        die(f"unknown model '{key}' for {section}. Known: {', '.join(block['models'])}")
    return key, block["models"][key]


def parse_extra(pairs):
    out = {}
    for pair in pairs or []:
        if "=" not in pair:
            die(f"--extra expects key=value, got '{pair}'")
        k, v = pair.split("=", 1)
        try:
            out[k] = json.loads(v)
        except json.JSONDecodeError:
            out[k] = v
    return out


def dig(result, path):
    node = result
    for part in re.findall(r"[^.\[\]]+", path):
        try:
            node = node[int(part)] if part.isdigit() else node[part]
        except (KeyError, IndexError, TypeError):
            raw = json.dumps(result)[:1500]
            die(
                f"couldn't resolve output_path '{path}' in Fal's response. Fal may have changed "
                f"the schema; update output_path in models.json. Raw result: {raw}"
            )
    return node


def upload(fal_client, path):
    path = Path(path).expanduser()
    if not path.is_file():
        die(f"input file not found: {path}")
    size = path.stat().st_size
    if size > MAX_UPLOAD_BYTES:
        die(f"{path.name} is {size / 1e6:.1f} MB; Fal's upload limit is 10 MB. Downscale it first.")
    warn(f"uploading {path.name} to Fal storage")
    return fal_client.upload_file(str(path))


def run_fal(fal_client, fal_id, arguments):
    warn(f"running {fal_id}")
    started = time.time()

    def on_update(update):
        name = type(update).__name__
        if name == "Queued":
            warn(f"queued (position {getattr(update, 'position', '?')})")

    try:
        result = fal_client.subscribe(fal_id, arguments=arguments, with_logs=False, on_queue_update=on_update)
    except Exception as e:  # fal-client raises several error types; report them all the same way
        text = str(e)
        if "404" in text or "not found" in text.lower():
            die(
                f"Fal returned 404 for '{fal_id}'. The slug probably moved; find the current one at "
                f"https://fal.ai/models and update models.json. Detail: {text}"
            )
        if "401" in text or "403" in text or "unauthorized" in text.lower():
            die(f"Fal rejected the key (check ~/.fal_key or FAL_KEY, and the account's balance). Detail: {text}")
        die(f"Fal request failed: {text}")
    warn(f"done in {time.time() - started:.0f}s")
    return result


def tls_context():
    # Windows Pythons often can't find a CA bundle on their own; fal-client ships certifi.
    try:
        import certifi  # noqa: PLC0415
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def download(url, dest_stem, folder, fallback_ext):
    context = tls_context()
    last = None
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(url, timeout=180, context=context) as resp:
                ctype = resp.headers.get("Content-Type", "").split(";")[0]
                ext = Path(url.split("?")[0]).suffix or mimetypes.guess_extension(ctype) or fallback_ext
                dest = next_name(folder, dest_stem, ext)
                with open(dest, "wb") as fh:
                    shutil.copyfileobj(resp, fh)
                return dest
        except Exception as e:  # network errors: retry, then give up with the URL
            last = e
            warn(f"download attempt {attempt} failed ({e}); retrying")
            time.sleep(3 * attempt)
    die(f"couldn't download the result after 3 tries ({last}). It's still on Fal for a while: {url}")


def log_prompt(folder, heading, fields):
    path = folder / "prompt.md"
    lines = [f"## {heading} — {dt.datetime.now().strftime('%Y-%m-%d %H:%M')}", ""]
    for k, v in fields.items():
        if isinstance(v, (dict, list)):
            v = "`" + json.dumps(v) + "`"
        lines.append(f"- **{k}:** {v}")
    with open(path, "a", encoding="utf-8") as fh:
        if path.stat().st_size == 0:
            fh.write(f"# {folder.name}\n\n")
        fh.write("\n".join(lines) + "\n\n")


def emit(payload):
    print(json.dumps(payload))


def require_approval(estimate, approved, detail):
    quote = {"needs_approval": True, "estimate_usd": round(estimate, 2), "detail": detail}
    if approved is None or approved + 1e-9 < round(estimate, 2):
        print(json.dumps(quote))
        warn(
            f"this costs about ${estimate:.2f} ({detail}). Not run. Quote it to the user and, "
            f"once they say yes, re-run with --approve-usd {estimate:.2f}"
        )
        sys.exit(EXIT_NEEDS_APPROVAL)


# ---------- ffmpeg helpers ----------

def probe(path):
    if not shutil.which("ffprobe"):
        return None
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate:format=duration",
        "-of", "json", str(path),
    ]
    try:
        data = json.loads(subprocess.run(cmd, capture_output=True, text=True, check=True).stdout)
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        return None
    stream = (data.get("streams") or [{}])[0]
    num, _, den = (stream.get("r_frame_rate") or "0/1").partition("/")
    fps = float(num) / float(den or 1) if float(den or 1) else 0.0
    duration = float((data.get("format") or {}).get("duration") or 0)
    return {"width": stream.get("width"), "height": stream.get("height"), "fps": fps, "duration": duration}


# ---------- commands ----------

def cmd_image(args, config, registry):
    key, model = pick_model(registry, "image", args.model)
    if args.input_image and not model.get("accepts_references"):
        die(
            f"'{key}' ignores reference images. Re-run with --model nano-banana-pro-edit "
            "(see references/character-consistency.md)."
        )
    arguments = dict(model.get("default_args", {}))
    arguments["prompt"] = args.prompt
    if args.aspect_ratio:
        size_map = model.get("aspect_to_image_size")
        if size_map is not None:
            if args.aspect_ratio not in size_map:
                die(f"'{key}' supports aspect ratios {', '.join(size_map)} only.")
            arguments["image_size"] = size_map[args.aspect_ratio]
        else:
            arguments["aspect_ratio"] = args.aspect_ratio
    if args.resolution:
        arguments["resolution"] = args.resolution
    if args.num_images:
        if not 1 <= args.num_images <= 4:
            die("--num-images must be 1-4.")
        arguments["num_images"] = args.num_images
    arguments.update(parse_extra(args.extra))

    fal = load_fal()
    folder = resolve_folder(config, args.title, args.folder)
    refs = []
    if args.input_image:
        urls = []
        for ref in args.input_image:
            urls.append(upload(fal, ref))
            dest = folder / f"source-{Path(ref).name}"
            if Path(ref).resolve() != dest.resolve():
                shutil.copy2(ref, dest)
            refs.append(str(dest))
        arguments[model.get("reference_arg", "image_urls")] = urls

    count = int(arguments.get("num_images", 1))
    per = model.get("price_per_image_usd", 0) * (2 if str(arguments.get("resolution", "")).upper() == "4K" else 1)
    warn(f"estimated cost ${per * count:.2f} ({count} x ${per:.2f})")

    result = run_fal(fal, model["fal_id"], arguments)
    items = dig(result, model["output_path"])
    items = items if isinstance(items, list) else [items]
    paths = [str(download(item["url"] if isinstance(item, dict) else item, "image", folder, ".png")) for item in items]

    log_prompt(folder, "image", {
        "model": f"{key} ({model['fal_id']})", "prompt": args.prompt,
        "arguments": {k: v for k, v in arguments.items() if k not in ("prompt", "image_urls")},
        "references": refs or "none", "outputs": [Path(p).name for p in paths],
        "estimated_cost_usd": round(per * count, 2),
    })
    emit({"image_path": paths[0], "image_paths": paths, "folder": str(folder), "model": key})


def video_quote(args, registry):
    key, model = pick_model(registry, "video_image_to_video", args.model)
    duration = str(args.duration or model.get("default_args", {}).get("duration", "5"))
    if not duration.isdigit():
        die("--duration must be a whole number of seconds.")
    resolution = args.resolution or model.get("default_args", {}).get("resolution")
    allowed = model.get("resolutions", [])
    if args.resolution and not allowed:
        die(f"'{key}' has no resolution setting; drop --resolution.")
    if resolution and allowed and resolution not in allowed:
        die(f"'{key}' supports {', '.join(allowed)}.")
    price = model.get("price_per_second_usd")
    if args.no_audio and "price_per_second_usd_audio_off" in model:
        price = model["price_per_second_usd_audio_off"]
    if isinstance(price, dict):
        price = price.get(resolution)
    if price is None:
        die(
            f"no price on file for {key} at {resolution}. Check https://fal.ai/models/{model['fal_id']}, "
            "tell the user the rate, then add it to models.json before running."
        )
    seconds = int(duration)
    return key, model, duration, resolution, price * seconds, f"{key}, {seconds}s at {resolution or 'default'}, ${price}/s"


def cmd_video(args, config, registry, quote_only=False):
    key, model, duration, resolution, estimate, detail = video_quote(args, registry)
    if quote_only:
        emit({"estimate_usd": round(estimate, 2), "detail": detail})
        return
    require_approval(estimate, args.approve_usd, detail)

    arguments = dict(model.get("default_args", {}))
    arguments.update({"prompt": args.prompt, "duration": duration})
    if resolution and model.get("resolutions"):
        arguments["resolution"] = resolution
    if args.no_audio:
        arguments["generate_audio"] = False
    arguments.update(parse_extra(args.extra))

    fal = load_fal()
    folder = resolve_folder(config, args.title, args.folder)
    arguments[model.get("image_arg", "image_url")] = upload(fal, args.image)
    if args.end_image:
        # pins the last frame: Seedance 2.0, Kling v3 and Kling O3 all take end_image_url
        arguments[model.get("end_image_arg", "end_image_url")] = upload(fal, args.end_image)
    result = run_fal(fal, model["fal_id"], arguments)
    path = download(dig(result, model["output_path"]), "video", folder, ".mp4")

    log_prompt(folder, "video", {
        "model": f"{key} ({model['fal_id']})", "source_image": args.image,
        "end_image": args.end_image, "motion_prompt": args.prompt,
        "arguments": {k: v for k, v in arguments.items() if k != "prompt" and not k.endswith("image_url")},
        "approved_usd": args.approve_usd, "estimated_cost_usd": round(estimate, 2), "output": path.name,
    })
    emit({"video_path": str(path), "folder": str(folder), "model": key, "estimated_cost_usd": round(estimate, 2)})


def upscale_plan(args, registry):
    src = Path(args.input).expanduser()
    if not src.is_file():
        die(f"input file not found: {src}")
    kind = args.type or ("image" if (mimetypes.guess_type(src.name)[0] or "").startswith("image/") else "video")
    key, model = pick_model(registry, f"upscale_{kind}", args.model)
    info = probe(src)
    if args.factor:
        factor = args.factor
    else:
        if not info or not info.get("height"):
            die("can't read the source size (ffprobe missing or unreadable file). Pass --factor explicitly.")
        factor = args.target_height / info["height"]
    if factor <= 1:
        height = f"{info['height']}px" if info and info.get("height") else "already large"
        die(f"upscale factor works out to {factor:.2f} (source is {height}); it must be above 1.")
    factor = round(min(factor, 4.0), 3)

    if kind == "image":
        estimate = None
        if info and info.get("width"):
            mp = info["width"] * info["height"] * factor * factor / 1e6
            tiers = model["price_tiers_per_image_usd"]
            estimate = tiers["up_to_24mp"] if mp <= 24 else tiers["up_to_48mp"] if mp <= 48 else tiers["up_to_96mp"] if mp <= 96 else None
            detail = f"{key}, x{factor} to ~{mp:.0f}MP"
        else:
            detail = f"{key}, x{factor}"
        return src, kind, key, model, factor, info, estimate, detail

    if not info or not info.get("duration"):
        die("can't read the video's length (is ffprobe installed?). Install ffmpeg: winget install ffmpeg")
    out_h = info["height"] * factor
    tiers = model["price_tiers_per_second_usd"]
    rate = tiers["up_to_720p"] if out_h <= 720 else tiers["720p_to_1080p"] if out_h <= 1080 else tiers["above_1080p"]
    out_fps = args.fps or info["fps"]
    if out_fps > 31:
        rate *= 2
    estimate = rate * info["duration"]
    detail = f"{key}, {info['duration']:.1f}s, {info['height']}p -> {out_h:.0f}p at {out_fps:.0f}fps, ${rate}/s"
    return src, kind, key, model, factor, info, estimate, detail


def cmd_upscale(args, config, registry, quote_only=False):
    src, kind, key, model, factor, info, estimate, detail = upscale_plan(args, registry)
    if quote_only:
        emit({"estimate_usd": None if estimate is None else round(estimate, 2), "detail": detail})
        return
    if kind == "video" or estimate is None:
        require_approval(estimate if estimate is not None else 1.5, args.approve_usd, detail)

    fal = load_fal()
    folder = resolve_folder(config, args.title or f"upscale-{src.stem}", args.folder)
    upload_src = src
    if kind == "video" and args.fps and info and info["fps"] > args.fps + 0.5:
        if not shutil.which("ffmpeg"):
            die("--fps needs ffmpeg. Install it (winget install ffmpeg) or drop --fps.")
        upload_src = folder / f"source-{args.fps}fps-{src.stem}.mp4"
        warn(f"re-encoding to {args.fps}fps")
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-r", str(args.fps),
             "-c:v", "libx264", "-crf", "16", "-c:a", "copy", str(upload_src)],
            check=True,
        )

    arguments = dict(model.get("default_args", {}))
    arguments["upscale_factor"] = factor
    arguments["video_url" if kind == "video" else "image_url"] = upload(fal, upload_src)
    result = run_fal(fal, model["fal_id"], arguments)
    path = download(dig(result, model["output_path"]), "upscaled", folder, ".mp4" if kind == "video" else ".png")

    log_prompt(folder, f"upscale ({kind})", {
        "model": f"{key} ({model['fal_id']})", "source": str(src),
        "source_size": f"{info['width']}x{info['height']}" if info else "unknown",
        "factor": factor, "arguments": {k: v for k, v in arguments.items() if not k.endswith("_url")},
        "estimated_cost_usd": None if estimate is None else round(estimate, 2), "output": path.name,
    })
    emit({"upscaled_path": str(path), "folder": str(folder), "model": key, "factor": factor})


def build_parser():
    p = argparse.ArgumentParser(prog="generate.py", description="Fal.ai image, video and upscale.")
    sub = p.add_subparsers(dest="command", required=True)

    def add_video_flags(sp):
        sp.add_argument("--image", required=True)
        sp.add_argument("--end-image", help="local image the clip must end on")
        sp.add_argument("--prompt", required=True)
        sp.add_argument("--title", required=True)
        sp.add_argument("--folder")
        sp.add_argument("--duration")
        sp.add_argument("--model")
        sp.add_argument("--resolution")
        sp.add_argument("--no-audio", action="store_true")
        sp.add_argument("--approve-usd", type=float)
        sp.add_argument("--extra", action="append")

    def add_upscale_flags(sp):
        sp.add_argument("--input", required=True)
        sp.add_argument("--target-height", type=int, default=1080)
        sp.add_argument("--factor", type=float)
        sp.add_argument("--fps", type=int)
        sp.add_argument("--type", choices=["video", "image"])
        sp.add_argument("--model")
        sp.add_argument("--title")
        sp.add_argument("--folder")
        sp.add_argument("--approve-usd", type=float)

    img = sub.add_parser("image")
    img.add_argument("--prompt", required=True)
    img.add_argument("--title", required=True)
    img.add_argument("--model")
    img.add_argument("--aspect-ratio")
    img.add_argument("--resolution")
    img.add_argument("--num-images", type=int)
    img.add_argument("--input-image", action="append")
    img.add_argument("--folder")
    img.add_argument("--extra", action="append")

    add_video_flags(sub.add_parser("video"))
    add_upscale_flags(sub.add_parser("upscale"))

    quote = sub.add_parser("quote")
    qsub = quote.add_subparsers(dest="what", required=True)
    add_video_flags(qsub.add_parser("video"))
    add_upscale_flags(qsub.add_parser("upscale"))
    return p


def main():
    args = build_parser().parse_args()
    config = load_json("config.json")
    registry = load_json("models.json")
    registry_age_check(registry)
    if args.command == "image":
        cmd_image(args, config, registry)
    elif args.command == "video":
        cmd_video(args, config, registry)
    elif args.command == "upscale":
        cmd_upscale(args, config, registry)
    elif args.command == "quote":
        (cmd_video if args.what == "video" else cmd_upscale)(args, config, registry, quote_only=True)


if __name__ == "__main__":
    main()
