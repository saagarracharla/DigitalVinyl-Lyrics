"""Serve the UI against a fake Spotify backend (mock.js) for run-tests.mjs.

Renders the real template and static files, minus the Spotify SDK, so tests
never touch a Spotify account. Usage: python tests/ui/serve.py [port]
"""
import http.server
import mimetypes
import sys
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
SDK_TAG = '<script src="https://sdk.scdn.co/spotify-player.js"></script>'
APP_TAG = '<script src="/static/js/app.js"></script>'


def render_index():
    env = Environment(loader=FileSystemLoader(ROOT / 'app' / 'templates'))
    html = env.get_template('index.html').render(url_for=lambda endpoint, filename: f'/static/{filename}')
    if SDK_TAG not in html or APP_TAG not in html:
        raise RuntimeError('index.html script tags changed; update serve.py')
    return html.replace(SDK_TAG, '').replace(APP_TAG, f'<script src="/mock.js"></script>\n    {APP_TAG}')


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?')[0]
        if path in ('/', '/index.html'):
            self.send(render_index().encode(), 'text/html')
        elif path == '/mock.js':
            self.send_file(HERE / 'mock.js')
        elif path.startswith('/static/'):
            self.send_file(ROOT / 'app' / path.lstrip('/'))
        else:
            self.send_error(404)

    def send_file(self, file):
        static_root = (ROOT / 'app' / 'static').resolve()
        file = file.resolve()
        if not file.is_file() or not (file == HERE / 'mock.js' or static_root in file.parents):
            self.send_error(404)
            return
        self.send(file.read_bytes(), mimetypes.guess_type(file.name)[0] or 'application/octet-stream')

    def send(self, body, content_type):
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5099
    print(f'UI test server on http://127.0.0.1:{port}')
    http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
