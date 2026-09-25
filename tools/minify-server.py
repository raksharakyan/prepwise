# Local helper for building the deployed copy of Prepwise. Serves the project
# root, and saves the minified app.js that tools/minify.html posts back into
# dist/. dist/ is gitignored: GitHub keeps the readable source only.
#
#   python3 tools/minify-server.py 8779
#   then open http://localhost:8779/tools/minify.html
import hashlib, http.server, os, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_POST(self):
        if self.path != "/save-app-js":
            self.send_error(404)
            return
        os.makedirs(DIST, exist_ok=True)
        data = self.rfile.read(int(self.headers["Content-Length"]))
        with open(os.path.join(DIST, "app.js"), "wb") as f:
            f.write(data)
        # The other deploy files ship as they are, except that index.html
        # gets a stamp of this build in place of ?v=dev, so browsers fetch the
        # new files instead of cached ones, and app.js can tell a round saved
        # by an older deploy from one saved by this deploy.
        shutil.copy(os.path.join(ROOT, "styles.css"), DIST)
        h = hashlib.md5(data)
        with open(os.path.join(ROOT, "styles.css"), "rb") as f:
            h.update(f.read())
        with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
            page = f.read().replace("?v=dev", "?v=" + h.hexdigest()[:10])
        with open(os.path.join(DIST, "index.html"), "w", encoding="utf-8") as f:
            f.write(page)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"saved")


http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
