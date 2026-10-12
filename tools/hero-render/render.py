"""Re-render the hero stills (16:9 + 9:16) and their car-only masks into tools/src/.

Uses the 3D promo project at ~/Desktop/transfer-3d (its assets and stills.html) with the
stills.js next to this file, which adds a `mask: true` option (car silhouette, white on black).
Then run `python tools/build_assets.py hero` to cut the car layers for the site.

usage: python tools/hero-render/render.py     (needs: pip install playwright; uses the installed Chrome)
"""
import base64, functools, http.server, json, os, threading

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
PROMO = os.path.expanduser('~/Desktop/transfer-3d')
OUT = os.path.join(os.path.dirname(HERE), 'src')


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path.split('?')[0] == '/tools/stills/stills.js':
            return os.path.join(HERE, 'stills.js')
        return super().translate_path(path)

    def log_message(self, *a):
        pass


def main():
    jobs = json.load(open(os.path.join(HERE, 'jobs.json')))
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=PROMO))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=metal', '--ignore-gpu-blocklist'])
        pages = {}
        for j in jobs:
            key = (j['w'], j['h'])
            if key not in pages:
                pg = b.new_page(viewport={'width': j['w'], 'height': j['h']})
                pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/tools/stills/stills.html?render=1&w={j["w"]}&h={j["h"]}')
                pg.wait_for_function('window.__api !== undefined', timeout=90000)
                pg.evaluate('window.__api.ready')
                pages[key] = pg
            url = pages[key].evaluate('cfg => window.__api.still(cfg)', j['cfg'])
            open(os.path.join(OUT, j['out']), 'wb').write(base64.b64decode(url.split(',', 1)[1]))
            print('rendered', j['out'])
        b.close()


if __name__ == '__main__':
    main()
