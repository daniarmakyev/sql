"""Render public/og.jpg (1200x630) and the PNG icons with headless Chrome.
usage: python tools/render_og.py      (needs: pip install playwright pillow; uses the installed Chrome)"""
import io
import os

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'public')

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1200, 'height': 630})
    pg.goto('file://' + os.path.join(ROOT, 'tools', 'og', 'og.html'))
    pg.evaluate('document.fonts.ready')
    pg.wait_for_timeout(300)
    Image.open(io.BytesIO(pg.screenshot())).convert('RGB').save(os.path.join(PUB, 'og.jpg'), quality=86, optimize=True, progressive=True)
    svg = open(os.path.join(PUB, 'favicon.svg')).read()
    for name, size in (('favicon-32.png', 32), ('apple-touch-icon.png', 180), ('icon-192.png', 192), ('icon-512.png', 512)):
        ip = b.new_page(viewport={'width': size, 'height': size})
        ip.set_content(f'<html><body style="margin:0;background:transparent">{svg.replace("<svg ", f"<svg width={size} height={size} ", 1)}</body></html>')
        ip.screenshot(path=os.path.join(PUB, name), omit_background=True)
        ip.close()
    b.close()
print('og + icons written to public/')
