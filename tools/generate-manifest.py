"""
Scan public/images, detect faces (MediaPipe Face Detection, fallback OpenCV Haar).
Picks the face whose center is nearest the image center.
Writes JPEG thumbnails to public/thumbnails/ and public/manifest.json with focal_point + thumb per image.

Install: py -m pip install -r tools/requirements.txt  (or python -m pip … for your interpreter)
Run: py tools/generate-manifest.py  (avoid #! python3 shebang on Windows — it can pick the Store stub without OpenCV)
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parent.parent
IMAGES_DIR = ROOT / "public" / "images"
THUMB_DIR = ROOT / "public" / "thumbnails"
AMBIENT_DIR = ROOT / "public" / "ambient"
OUT = ROOT / "public" / "manifest.json"

EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".bmp"}
THUMB_MAX_WIDTH = 320
THUMB_JPEG_QUALITY = 82
AMBIENT_MAX_WIDTH = 960
AMBIENT_BLUR_SIGMA = 16
AMBIENT_JPEG_QUALITY = 72

def clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def derive_title(filename: str) -> str:
    stem = Path(filename).stem
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", stem)
    clean = " ".join(spaced.replace("_", " ").replace("-", " ").split()).strip()
    if not clean:
        return "Photo"
    return clean[0].upper() + clean[1:]


def write_thumb_jpg(src_path: Path) -> str | None:
    """Resize to max width, save as JPEG; return manifest path thumbnails/<stem>.jpg."""
    img = cv2.imread(str(src_path))
    if img is None:
        return None
    h, w = img.shape[:2]
    if w < 2 or h < 2:
        return None
    if w > THUMB_MAX_WIDTH:
        scale = THUMB_MAX_WIDTH / float(w)
        nh = max(1, int(round(h * scale)))
        img = cv2.resize(img, (THUMB_MAX_WIDTH, nh), interpolation=cv2.INTER_AREA)
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    out_name = f"{src_path.stem}.jpg"
    out_path = THUMB_DIR / out_name
    cv2.imwrite(
        str(out_path),
        img,
        [int(cv2.IMWRITE_JPEG_QUALITY), THUMB_JPEG_QUALITY],
    )
    return f"thumbnails/{out_name}"


def write_ambient_jpg(src_path: Path) -> str | None:
    """
    Pre-render a lightweight ambient background.
    We downscale first, then blur, then save JPEG for fast decode on mobile.
    """
    img = cv2.imread(str(src_path))
    if img is None:
        return None
    h, w = img.shape[:2]
    if w < 2 or h < 2:
        return None
    if w > AMBIENT_MAX_WIDTH:
        scale = AMBIENT_MAX_WIDTH / float(w)
        nh = max(1, int(round(h * scale)))
        img = cv2.resize(img, (AMBIENT_MAX_WIDTH, nh), interpolation=cv2.INTER_AREA)
    # Strong blur for soft ambient mood without expensive runtime CSS blur.
    img = cv2.GaussianBlur(img, (0, 0), sigmaX=AMBIENT_BLUR_SIGMA, sigmaY=AMBIENT_BLUR_SIGMA)
    AMBIENT_DIR.mkdir(parents=True, exist_ok=True)
    out_name = f"{src_path.stem}.jpg"
    out_path = AMBIENT_DIR / out_name
    cv2.imwrite(
        str(out_path),
        img,
        [int(cv2.IMWRITE_JPEG_QUALITY), AMBIENT_JPEG_QUALITY],
    )
    return f"ambient/{out_name}"


def focal_mediapipe(
    rgb,
    w: int,
    h: int,
    face_detection,
) -> tuple[float, float] | None:
    """Return normalized (x, y) of primary face center, or None if no detection."""
    if face_detection is None:
        return None
    res = face_detection.process(rgb)
    if not res.detections:
        return None
    best: tuple[float, float] | None = None
    best_d = float("inf")
    for det in res.detections:
        b = det.location_data.relative_bounding_box
        nx = clamp01(b.xmin + b.width / 2.0)
        ny = clamp01(b.ymin + b.height / 2.0)
        d = (nx - 0.5) ** 2 + (ny - 0.5) ** 2
        if d < best_d:
            best_d = d
            best = (nx, ny)
    assert best is not None
    return best


def focal_opencv_haar(gray, w: int, h: int) -> tuple[float, float] | None:
    cascade_path = str(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml")
    cascade = cv2.CascadeClassifier(cascade_path)
    if cascade.empty():
        return None
    faces = cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=4,
        minSize=(max(24, w // 40), max(24, h // 40)),
    )
    if len(faces) == 0:
        return None
    cx_img = w * 0.5
    cy_img = h * 0.5
    best: tuple[float, float] | None = None
    best_d = float("inf")
    for (x, y, fw, fh) in faces:
        fcx = x + fw / 2.0
        fcy = y + fh / 2.0
        d = (fcx - cx_img) ** 2 + (fcy - cy_img) ** 2
        if d < best_d:
            best_d = d
            best = (fcx / w, fcy / h)
    assert best is not None
    return clamp01(best[0]), clamp01(best[1])


def focal_for_image(path: Path, face_detection) -> tuple[float, float, str]:
    """Primary face (MediaPipe → OpenCV); else center with focal_source \"fallback\"."""
    img = cv2.imread(str(path))
    if img is None:
        return 0.5, 0.5, "fallback"
    h, w = img.shape[:2]
    if w < 2 or h < 2:
        return 0.5, 0.5, "fallback"

    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    mp_pt = focal_mediapipe(rgb, w, h, face_detection)
    if mp_pt is not None:
        return (*mp_pt, "face")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    cv_pt = focal_opencv_haar(gray, w, h)
    if cv_pt is not None:
        return (*cv_pt, "face")

    return 0.5, 0.5, "fallback"


def create_mediapipe_face_detector():
    """
    Classic Face Detection API. Windows wheels often expose FaceDetection under
    mediapipe.python.solutions (mp.solutions is missing). Linux/mac often have mp.solutions.
    MediaPipe 0.10.31+ removed solutions entirely — use mediapipe<0.10.31 or OpenCV fallback.
    """
    try:
        from mediapipe.python.solutions.face_detection import FaceDetection

        return FaceDetection(model_selection=1, min_detection_confidence=0.45)
    except ImportError:
        pass
    try:
        import mediapipe as mp

        if hasattr(mp, "solutions") and hasattr(mp.solutions, "face_detection"):
            return mp.solutions.face_detection.FaceDetection(
                model_selection=1,
                min_detection_confidence=0.45,
            )
    except Exception:
        pass
    return None


def main() -> int:
    if not IMAGES_DIR.is_dir():
        print(f"Missing images dir: {IMAGES_DIR}", file=sys.stderr)
        return 1

    face_detection = None
    try:
        face_detection = create_mediapipe_face_detector()
        if face_detection is not None:
            print("Using MediaPipe Face Detection (OpenCV Haar as fallback).", flush=True)
        else:
            print("MediaPipe Face Detection API not available; using OpenCV Haar only.", flush=True)
    except Exception as e:
        print(f"MediaPipe unavailable ({e}); using OpenCV Haar only.", flush=True)

    files = sorted(
        f.name
        for f in IMAGES_DIR.iterdir()
        if f.is_file() and f.suffix.lower() in EXT and not f.name.startswith(".")
    )

    images: list[dict] = []
    try:
        for i, name in enumerate(files):
            rel = f"images/{name}"
            path = IMAGES_DIR / name
            fx, fy, focal_src = focal_for_image(path, face_detection)
            entry: dict = {
                "src": rel,
                "title": derive_title(name),
                "focal_point": {"x": fx, "y": fy},
                "focal_source": focal_src,
            }
            thumb_rel = write_thumb_jpg(path)
            if thumb_rel:
                entry["thumb"] = thumb_rel
            ambient_rel = write_ambient_jpg(path)
            if ambient_rel:
                entry["ambient"] = ambient_rel
            images.append(entry)
            if (i + 1) % 50 == 0 or i == len(files) - 1:
                print(f"Processed {i + 1}/{len(files)} …", flush=True)
    finally:
        if face_detection is not None:
            try:
                face_detection.close()
            except Exception:
                pass

    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "images": images,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {len(images)} entries + thumbnails ({THUMB_DIR}) + ambient ({AMBIENT_DIR}) -> {OUT}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
