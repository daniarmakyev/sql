"""Build the site's generated assets.

  map      -> src/assets/map/relief.png + src/data/geo.json   (ETOPO1 relief of Kyrgyzstan, border, lake, routes)
  hero     -> src/assets/hero/*  (3D renders of the car on the Issyk-Kul road + car-only layers for text-behind-car)
  photos   -> src/assets/photos/*  (real photos of the car, lightly graded)
  video    -> public/media/*  (the 24 s promo, web encode + poster)

usage: python tools/build_assets.py [map|hero|photos|video ...]
needs: pip install numpy pillow scipy scikit-image imageio-ffmpeg
"""
import json
import math
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(HERE, 'src')
DESKTOP = os.path.expanduser('~/Desktop')
ASSETS = os.path.join(ROOT, 'src', 'assets')

# ---------------------------------------------------------------- geography
REL = json.load(open(os.path.join(SRC, 'relief.json')))
K = (REL['x1'] - REL['x0']) / (REL['lon1'] - REL['lon0'])   # projected units per degree of longitude (cos 41.3°)


def proj(lat, lon):
    """Same equirectangular projection as kg.json: 1 unit = 1° of latitude."""
    return (lon - REL['lon0']) * K + REL['x0'], lat - REL['lat0'] + REL['y0']


BISHKEK = (42.8746, 74.5698)
ISSYK = [BISHKEK, (42.888, 74.85), (42.842, 75.30), (42.775, 75.66), (42.66, 75.83), (42.55, 76.0), (42.48, 76.17),
         (42.515, 76.42), (42.6, 76.66), (42.655, 76.9), (42.6496, 77.082)]
TOKTOGUL = [BISHKEK, (42.85, 74.2), (42.815, 73.848), (42.636, 73.904), (42.45, 73.84), (42.333, 73.816), (42.19, 73.82),
            (42.13, 73.55), (42.04, 73.23), (41.94, 73.08), (41.8743, 72.9406)]
JALAL = TOKTOGUL + [(41.76, 72.8), (41.6268, 72.6744), (41.49, 72.43), (41.346, 72.217), (41.2, 72.24), (41.07, 72.5),
                    (41.037, 72.745), (40.9333, 73.0)]
ROUTES = [
    # id, name, note, km, hours, waypoints (lat, lon), label side
    ('manas', 'Аэропорт «Манас»', 'встреча с рейса', 30, '40 мин',
     [BISHKEK, (42.93, 74.53), (43.0, 74.495), (43.0613, 74.4776)], 'n'),
    ('ala-archa', 'Ала-Арча', 'национальный парк', 40, '1 ч',
     [BISHKEK, (42.8, 74.585), (42.71, 74.555), (42.645, 74.505), (42.5638, 74.4826)], 'sw'),
    ('chon-kurchak', 'Чон-Курчак', 'горы и лыжная база', 40, '1 ч',
     [BISHKEK, (42.8, 74.615), (42.7, 74.655), (42.63, 74.64)], 'se'),
    ('issyk-kul', 'Иссык-Куль', 'Чолпон-Ата, северный берег', 270, '4 ч', ISSYK, 'n'),
    ('karakol', 'Каракол', 'восток Иссык-Куля', 410, '6 ч',
     ISSYK + [(42.672, 77.21), (42.718, 77.47), (42.74, 77.67), (42.765, 77.95), (42.77, 78.2), (42.745, 78.37), (42.62, 78.42), (42.4907, 78.3936)], 'e'),
    ('toktogul', 'Токтогул', 'через перевал Төө-Ашуу', 275, '5 ч', TOKTOGUL, 'w'),
    ('jalal-abad', 'Джалал-Абад', 'юг страны', 570, '9 ч', JALAL, 'e'),
    ('osh', 'Ош', 'южная столица', 670, '11 ч', JALAL + [(40.82, 73.02), (40.705, 72.866), (40.5283, 72.7985)], 's'),
]


def catmull_rom(pts, steps=5):
    """Smooth polyline through the points (centripetal-ish, uniform parameter is fine at this scale)."""
    p = [pts[0]] + list(pts) + [pts[-1]]
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = map(np.array, (p[i - 1], p[i], p[i + 1], p[i + 2]))
        for k in range(steps):
            t = k / steps
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(np.array(p[-2]))
    return out


def build_map():
    kg = json.load(open(os.path.join(SRC, 'kg.json')))
    country, lake = np.array(kg['country']), np.array(kg['lake'])
    pad = 0.12
    xmin, ymin = country.min(0) - pad
    xmax, ymax = country.max(0) + pad
    VW = 1000.0
    s = VW / (xmax - xmin)
    VH = round((ymax - ymin) * s, 1)

    def svg(x, y):
        return (x - xmin) * s, (ymax - y) * s

    def path(points, close=True):
        d = 'M' + ' '.join(f'{x:.1f} {y:.1f}' for x, y in (svg(*p) for p in points))
        return d + ('Z' if close else '')

    # lake polygon test so routes along the north shore stay on land
    from matplotlib.path import Path as MPath
    lake_path = MPath(lake)
    routes = []
    for rid, name, note, km, hours, wps, side in ROUTES:
        pts = [proj(*w) for w in wps]
        smooth = catmull_rom(pts)
        wet = [p for p in smooth if lake_path.contains_point(p)]
        if wet:
            print(f'warning: route {rid} has {len(wet)} points inside the lake')
        d = 'M' + ' '.join(f'{x:.1f} {y:.1f}' for x, y in (svg(*p) for p in smooth))
        length = sum(math.dist(svg(*a), svg(*b)) for a, b in zip(smooth, smooth[1:]))
        ex, ey = svg(*pts[-1])
        routes.append({'id': rid, 'name': name, 'note': note, 'km': km, 'time': hours, 'd': d,
                       'len': round(length, 1), 'end': [round(ex, 1), round(ey, 1)], 'side': side})
    bx, by = svg(*proj(*BISHKEK))
    geo = {'viewBox': [0, 0, VW, VH], 'border': path(country), 'lake': path(lake), 'bishkek': [round(bx, 1), round(by, 1)], 'routes': routes}
    os.makedirs(os.path.join(ROOT, 'src', 'data'), exist_ok=True)
    json.dump(geo, open(os.path.join(ROOT, 'src', 'data', 'geo.json'), 'w'), ensure_ascii=False, indent=1)

    # ---- relief raster, same frame as the SVG viewBox
    R = 1.8
    W, H = int(VW * R), int(round(VH * R))
    rel = np.array(Image.open(os.path.join(SRC, 'relief.png')).convert('RGB')).astype(np.float64)
    elev_src = rel[..., 0] * 256 + rel[..., 1] - 500
    px, py = np.meshgrid(np.arange(W) + 0.5, np.arange(H) + 0.5)
    X = xmin + px / R / s
    Y = ymax - py / R / s
    lon = (X - REL['x0']) / K + REL['lon0']
    lat = Y - REL['y0'] + REL['lat0']
    col = (lon - REL['lon0']) / (REL['lon1'] - REL['lon0']) * (REL['w'] - 1)
    row = (REL['lat1'] - lat) / (REL['lat1'] - REL['lat0']) * (REL['h'] - 1)
    E = ndimage.map_coordinates(elev_src, [row, col], order=3, mode='nearest')
    E = ndimage.gaussian_filter(E, 0.8)

    # hillshade (sun from the north-west), exaggerated relief
    dx_m = 111320.0 / (R * s)
    gy, gx = np.gradient(E * 2.6, dx_m)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = math.radians(315), math.radians(38)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    shade = np.clip(shade, 0, 1)

    # night-blue elevation ramp
    stops = [(0, (12, 20, 42)), (900, (18, 30, 60)), (1800, (30, 48, 88)), (2800, (48, 72, 120)),
             (3700, (88, 116, 170)), (4500, (160, 182, 220)), (5600, (226, 234, 248))]
    ev = np.array([e for e, _ in stops], float)
    rgb = np.stack([np.interp(E, ev, [c[i] for _, c in stops]) for i in range(3)], -1) / 255.0
    lit = rgb * (0.38 + 0.95 * shade[..., None]) + 0.015
    # thin contour lines every 1000 m (anti-aliased by distance to the level set)
    for lvl in (1000, 2000, 3000, 4000, 5000):
        g = np.hypot(*np.gradient(E)) + 1e-6
        dist = np.abs(E - lvl) / g
        line = np.clip(1.0 - dist / 0.9, 0, 1) * 0.16
        lit = lit * (1 - line[..., None]) + np.array([0.62, 0.72, 0.92]) * line[..., None]
    lit = np.clip(lit, 0, 1)

    # country mask (supersampled) and a dim halo of the neighbours
    SS = 3
    mimg = Image.new('L', (W * SS, H * SS), 0)
    pts = [(x * R * SS, y * R * SS) for x, y in (svg(*p) for p in country)]
    ImageDraw.Draw(mimg).polygon(pts, fill=255)
    M = np.array(mimg.resize((W, H), Image.LANCZOS)).astype(np.float64) / 255.0
    outside = ndimage.distance_transform_edt(M < 0.5)
    halo = 0.42 * np.exp(-outside / (38 * R / 1.8))
    alpha = np.maximum(M, halo)
    color = lit * (M[..., None] + (1 - M[..., None]) * 0.42)
    out = np.dstack([np.clip(color * 255, 0, 255), alpha * 255]).astype(np.uint8)
    os.makedirs(os.path.join(ASSETS, 'map'), exist_ok=True)
    Image.fromarray(out, 'RGBA').save(os.path.join(ASSETS, 'map', 'relief.png'), optimize=True)
    print('map:', W, H, 'viewBox', VW, VH)


# ---------------------------------------------------------------- hero renders
def build_hero():
    os.makedirs(os.path.join(ASSETS, 'hero'), exist_ok=True)
    meta = {}
    for key, name in (('desktop', 'hero_d'), ('mobile', 'hero_m')):
        base = Image.open(os.path.join(SRC, f'{name}.png')).convert('RGB')
        mask = Image.open(os.path.join(SRC, f'{name}_mask.png')).convert('L')
        W, H = base.size
        base.save(os.path.join(ASSETS, 'hero', f'road-{key}.jpg'), quality=93, subsampling=0)
        a = np.array(mask)
        ys, xs = np.where(a > 4)
        x0, y0, x1, y1 = max(xs.min() - 6, 0), max(ys.min() - 6, 0), min(xs.max() + 7, W), min(ys.max() + 7, H)
        car = base.crop((x0, y0, x1, y1)).convert('RGBA')
        car.putalpha(mask.crop((x0, y0, x1, y1)))
        car.save(os.path.join(ASSETS, 'hero', f'car-{key}.png'), optimize=True)
        meta[key] = {'w': W, 'h': H, 'car': [round(x0 / W * 100, 3), round(y0 / H * 100, 3), round((x1 - x0) / W * 100, 3), round((y1 - y0) / H * 100, 3)]}
    json.dump(meta, open(os.path.join(ROOT, 'src', 'data', 'hero.json'), 'w'), indent=1)
    print('hero:', meta)


# ---------------------------------------------------------------- real photos
PHOTOS = [
    ('front', 'photo_18_2026-10-11_17-53-58.jpg'),
    ('side', 'photo_19_2026-10-11_17-53-58.jpg'),
    ('seats', 'photo_2026-10-12_18-27-47.jpg'),
    ('cabin', 'photo_2026-10-12_18-27-44.jpg'),
]


def grade(im):
    a = np.asarray(im).astype(np.float64) / 255.0
    a = np.clip((a - 0.5) * 1.07 + 0.5 + 0.01, 0, 1)            # a touch of contrast
    a = a * np.array([1.025, 1.0, 0.975])                          # warmer
    lum = a @ np.array([0.2126, 0.7152, 0.0722])
    a = lum[..., None] + (a - lum[..., None]) * 1.06               # a little more colour
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))


def build_photos():
    os.makedirs(os.path.join(ASSETS, 'photos'), exist_ok=True)
    for key, fname in PHOTOS:
        im = Image.open(os.path.join(DESKTOP, fname)).convert('RGB')
        # trim the "Galaxy A13" watermark corner (bottom-left) where present
        w, h = im.size
        if fname.startswith('photo_1') and h > w:
            im = im.crop((0, 0, w, int(h * 0.94)))
        elif h < w:
            im = im.crop((0, 0, w, int(h * 0.895)))
        grade(im).save(os.path.join(ASSETS, 'photos', f'{key}.jpg'), quality=90)
    print('photos:', [k for k, _ in PHOTOS])


# ---------------------------------------------------------------- promo video
def build_video():
    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    src = os.path.join(DESKTOP, 'Трансфер_реклама_v6.mp4')
    out = os.path.join(ROOT, 'public', 'media')
    os.makedirs(out, exist_ok=True)
    subprocess.run([ff, '-y', '-loglevel', 'error', '-i', src, '-vf', 'scale=720:1280:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow',
                    '-crf', '25', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709',
                    '-colorspace', 'bt709', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', os.path.join(out, 'nurbek-transfer.mp4')], check=True)
    poster = os.path.join(ASSETS, 'video-poster.jpg')
    subprocess.run([ff, '-y', '-loglevel', 'error', '-ss', '1.2', '-i', src, '-frames:v', '1', '-vf', 'scale=720:1280:flags=lanczos', '-q:v', '2', poster], check=True)
    print('video:', os.path.getsize(os.path.join(out, 'nurbek-transfer.mp4')) // 1024, 'KB')


if __name__ == '__main__':
    steps = sys.argv[1:] or ['map', 'hero', 'photos', 'video']
    for step in steps:
        {'map': build_map, 'hero': build_hero, 'photos': build_photos, 'video': build_video}[step]()
