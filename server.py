"""FM Supa Scout 27: python server.py  ->  http://127.0.0.1:8027

GET  /api/players[?rescan=1]  full scan (cached until rescan); recalibrates automatically after a game patch
GET  /api/status              cheap poll: is FM running, current game date, has the DLL changed
POST /api/recalibrate         force layout re-discovery
"""
import functools
import glob
import gzip
import http.server
import json
import os
import sys
import threading
import time
import traceback
import webbrowser

import calibrate
import fm27
from mem import Proc

DIR = os.path.dirname(os.path.abspath(__file__))
HISTORY = os.path.join(DIR, 'history')
PORT = 8027
lock = threading.Lock()
state = {'cache': None, 'log': []}


def log(msg):
    print(msg)
    state['log'] = (state['log'] + [f'{time.strftime("%H:%M:%S")} {msg}'])[-50:]


def key(p):
    return f"{p['name']}|{p['dob']}"


def with_history(res):
    """Attach previous-snapshot values (from an earlier game date) and save this snapshot."""
    os.makedirs(HISTORY, exist_ok=True)
    date = res['date']
    older = sorted(f for f in glob.glob(os.path.join(HISTORY, '*.json')) if os.path.basename(f)[:-5] < date)
    prev, prev_date = {}, None
    if older:
        prev_date = os.path.basename(older[-1])[:-5]
        with open(older[-1]) as f:
            prev = json.load(f)
    for p in res['players']:
        old = prev.get(key(p))
        if old:
            p['prev'] = old  # [ca, pa, value, attr total]
    res['prevDate'] = prev_date
    snap = {key(p): [p['ca'], p['pa'], p['value'], sum(p['a'])] for p in res['players']}
    with open(os.path.join(HISTORY, f'{date}.json'), 'w') as f:
        json.dump(snap, f, separators=(',', ':'))
    return res


def do_scan():
    t = time.time()
    res = fm27.scan(log=log)
    res = with_history(res)
    res['secs'] = round(time.time() - t, 1)
    res['at'] = time.strftime('%H:%M:%S')
    res['log'] = state['log']
    state['sample'] = res.pop('sample')
    log(f"scanned {len(res['players'])} players in {res['secs']}s (game date {res['date']})")
    return json.dumps(res, separators=(',', ':')).encode()


def status():
    """Cheap poll. saveChanged: most sampled player objects are gone (another save was loaded)."""
    try:
        p = Proc()
        base, path = p.module(fm27.DLL_NAME)
        L = fm27.load_layout()
        out = {'running': True, 'dllChanged': fm27.build_id(path) != L.get('build'), 'date': None, 'saveChanged': False}
        if state.get('sample') and not out['dllChanged']:
            out['date'], alive = fm27.quick_date(p, state['sample'], L, base)
            out['saveChanged'] = alive < 0.5
        return out
    except Exception as e:
        return {'running': False, 'error': str(e)}


class Handler(http.server.SimpleHTTPRequestHandler):
    def send_json(self, body, code=200):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        gz = 'gzip' in self.headers.get('Accept-Encoding', '') and len(body) > 2048
        if gz:
            body = gzip.compress(body, 5)
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        if gz:
            self.send_header('Content-Encoding', 'gzip')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def fail(self, e):
        traceback.print_exc()
        log(f'error: {e}')
        self.send_json({'error': f'{type(e).__name__}: {e}', 'loading': isinstance(e, fm27.GameLoading), 'log': state['log']}, 503)

    def do_GET(self):
        if self.path.startswith('/api/status'):
            return self.send_json(status())
        if self.path.startswith('/api/players'):
            try:
                with lock:
                    if state['cache'] is None or 'rescan' in self.path:
                        state['cache'] = do_scan()
                return self.send_json(state['cache'])
            except Exception as e:
                return self.fail(e)
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/recalibrate'):
            try:
                with lock:
                    p = Proc()
                    old = fm27.load_layout()
                    new = calibrate.run(p, old, log=log)
                    new['build'] = fm27.build_id(p.module(fm27.DLL_NAME)[1])
                    changes = calibrate.diff(old, new)
                    fm27.save_layout(new)
                    log('recalibrated: ' + ('; '.join(changes) or 'layout unchanged'))
                    state['cache'] = None
                return self.send_json({'changes': changes, 'log': state['log']})
            except Exception as e:
                return self.fail(e)
        self.send_error(404)

    def end_headers(self):
        if not self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Handler, directory=DIR))
    print(f'FM Supa Scout 27 on http://127.0.0.1:{PORT}  (Ctrl+C to stop)')
    if '--no-browser' not in sys.argv:
        webbrowser.open(f'http://127.0.0.1:{PORT}')
    srv.serve_forever()
