"""Build the self-hosted web fonts (woff2, subset to RU + KG + basic Latin).

Unbounded has no Kyrgyz letters, so we add them:
  Ө ө -> existing barred-O glyphs (U+019F / U+0275, identical design)
  Ү   -> Latin Y (same shape);  ү -> Y scaled to lowercase with the stem in the descender
  Ң ң -> Н / н plus a descender built from the Ц / ц tail, with gvar deltas for every master
Sources are the variable TTFs from github.com/google/fonts (OFL).

usage: python tools/build_fonts.py        (needs: pip install fonttools brotli)
"""
import os
import sys
import urllib.request

from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphComponent, GlyphCoordinates
from fontTools.ttLib.tables.TupleVariation import TupleVariation

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.font-cache')
OUT = os.path.join(HERE, '..', 'src', 'assets', 'fonts')
GF = 'https://github.com/google/fonts/raw/main/ofl/'
SOURCES = {
    'Unbounded[wght].ttf': 'unbounded/Unbounded%5Bwght%5D.ttf',
    'Onest[wght].ttf': 'onest/Onest%5Bwght%5D.ttf',
    'Oswald[wght].ttf': 'oswald/Oswald%5Bwght%5D.ttf',
}

# Russian + Kyrgyz + basic Latin + the punctuation/symbols the page uses
UNICODES = (
    list(range(0x20, 0x7F)) + [0xA0, 0xAB, 0xB0, 0xB7, 0xBB, 0xD7]
    + [0x401, 0x451] + list(range(0x410, 0x450))
    + [0x4A2, 0x4A3, 0x4AE, 0x4AF, 0x4E8, 0x4E9]
    + [0x2009, 0x200A, 0x2011, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x201E, 0x2022, 0x2026,
       0x2116, 0x2190, 0x2191, 0x2192, 0x2193, 0x2212, 0x2248]
)


def fetch(name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        print('download', name)
        urllib.request.urlretrieve(GF + SOURCES[name], path)
    return path


def outline(font, glyph, loc):
    gs = font.getGlyphSet(location={'wght': loc}, normalized=True)
    pen = DecomposingRecordingPen(gs)
    gs[glyph].draw(pen)
    contours, cur = [], []
    for op, args in pen.value:
        if op in ('moveTo', 'lineTo'):
            cur.extend(args)
        elif op in ('qCurveTo', 'curveTo'):
            raise ValueError(f'{glyph}: curves not expected')
        elif op in ('closePath', 'endPath'):
            contours.append(cur)
            cur = []
    return contours, gs[glyph].width


def rect(x0, y0, x1, y1):
    # clockwise, like the TrueType outer contours in Unbounded
    return [(x0, y0), (x0, y1), (x1, y1), (x1, y0)]


def add_glyph(font, name, unicode_vals, masters):
    """masters: {loc: (contours, advance)} for loc in -1, 0, 1 (same point structure)."""
    base_contours, base_adv = masters[0.0]
    glyph = Glyph()
    glyph.numberOfContours = len(base_contours)
    pts = [p for c in base_contours for p in c]
    glyph.coordinates = GlyphCoordinates([(round(x), round(y)) for x, y in pts])
    ends, n = [], 0
    for c in base_contours:
        n += len(c)
        ends.append(n - 1)
    glyph.endPtsOfContours = ends
    glyph.flags = bytearray([1] * len(pts))
    glyph.program = None
    from fontTools.ttLib.tables import ttProgram
    glyph.program = ttProgram.Program()
    glyph.program.fromBytecode(b'')
    glyph.recalcBounds(font['glyf'])
    font['glyf'][name] = glyph
    order = font.getGlyphOrder()
    if name not in order:
        font.setGlyphOrder(order + [name])
    font.getReverseGlyphMap(rebuild=True)
    font['hmtx'][name] = (round(base_adv), glyph.xMin)
    variations = []
    for loc, region in ((-1.0, (-1.0, -1.0, 0.0)), (1.0, (0.0, 1.0, 1.0))):
        contours, adv = masters[loc]
        mpts = [p for c in contours for p in c]
        deltas = [(round(mx - bx), round(my - by)) for (mx, my), (bx, by) in zip(mpts, pts)]
        deltas += [(0, 0), (round(adv - base_adv), 0), (0, 0), (0, 0)]  # phantom points
        variations.append(TupleVariation({'wght': region}, deltas))
    font['gvar'].variations[name] = variations
    for table in font['cmap'].tables:
        if table.isUnicode():
            for u in unicode_vals:
                table.cmap[u] = name


def map_unicode(font, mapping):
    for table in font['cmap'].tables:
        if table.isUnicode():
            for u, glyph in mapping.items():
                table.cmap[u] = glyph


def descender_glyph(font, base, tse):
    """Н/н + the foot and tail of Ц/ц, measured per master relative to the right stem."""
    masters = {}
    for loc in (-1.0, 0.0, 1.0):
        base_c, base_adv = outline(font, base, loc)
        tse_c, tse_adv = outline(font, tse, loc)
        # right stem of the base letter = the tall contour with the largest x
        stems = [c for c in base_c if min(y for _, y in c) == 0 and max(y for _, y in c) > 400]
        right = max(stems, key=lambda c: max(x for x, _ in c))
        stem_r = max(x for x, _ in right)
        # Ц/ц geometry: tail = the points below the baseline; foot top = the bar height
        pts = tse_c[0]
        tail_xs = sorted({x for x, y in pts if y < 0})
        bottom = min(y for _, y in pts)
        tse_stem_r = max(x for x, y in pts if y > 400)
        bar_top = min(y for x, y in pts if 0 < y < 400 and x > tse_stem_r)
        tail_l, tail_r = tail_xs[0] - tse_stem_r, tail_xs[-1] - tse_stem_r
        rsb = tse_adv - tail_xs[-1]
        foot = rect(stem_r - 2, 0, stem_r + tail_r, bar_top)
        tail = rect(stem_r + tail_l, bottom, stem_r + tail_r, bar_top)
        masters[loc] = (base_c + [foot, tail], stem_r + tail_r + rsb)
    return masters


def patch_unbounded(font):
    descender = {'uni04A2': ('uni041D', 'uni0426', 0x4A2), 'uni04A3': ('uni043D', 'uni0446', 0x4A3)}
    for name, (base, tse, u) in descender.items():
        add_glyph(font, name, [u], descender_glyph(font, base, tse))
    # ү: the capital Y squeezed to x-height, its stem running into the descender
    masters = {}
    for loc in (-1.0, 0.0, 1.0):
        contours, adv = outline(font, 'Y', loc)
        x_height = max(y for c in outline(font, 'uni043D', loc)[0] for _, y in c)
        sx, depth, cap = 0.84, 179, 750.0
        scaled = [[(x * sx, y * (x_height + depth) / cap - depth) for x, y in c] for c in contours]
        masters[loc] = (scaled, adv * sx)
    add_glyph(font, 'uni04AF', [0x4AF], masters)
    map_unicode(font, {0x4E8: 'uni019F', 0x4E9: 'uni0275', 0x4AE: 'Y'})
    # advance widths of the new glyphs live in gvar phantom points; HVAR would shadow them
    if 'HVAR' in font:
        del font['HVAR']


def subset(src, dst, patch=None):
    font = TTFont(src)
    if patch:
        patch(font)
        patched = os.path.join(CACHE, 'patched-' + os.path.basename(src))
        font.save(patched)
        font = TTFont(patched)
    opts = Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['kern', 'liga', 'locl', 'mark', 'mkmk', 'calt', 'case', 'tnum', 'lnum', 'pnum']
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6]
    opts.notdef_outline = True
    opts.hinting = False
    sub = Subsetter(opts)
    sub.populate(unicodes=UNICODES)
    sub.subset(font)
    font.flavor = 'woff2'
    font.save(dst)
    print(f'{os.path.basename(dst)}: {os.path.getsize(dst) / 1024:.1f} KB')


def main():
    os.makedirs(OUT, exist_ok=True)
    subset(fetch('Unbounded[wght].ttf'), os.path.join(OUT, 'unbounded-kg.woff2'), patch_unbounded)
    subset(fetch('Onest[wght].ttf'), os.path.join(OUT, 'onest.woff2'))
    subset(fetch('Oswald[wght].ttf'), os.path.join(OUT, 'oswald.woff2'))


if __name__ == '__main__':
    sys.exit(main())
