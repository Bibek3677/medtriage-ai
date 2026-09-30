/* Minimal static file server for the MedTriage AI prototype — no dependencies.
   Usage: node serve.js [port]        (or: npm start) */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const TYPES = {
  ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8",
  ".js":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8",
  ".svg":"image/svg+xml", ".png":"image/png", ".ico":"image/x-icon", ".md":"text/markdown; charset=utf-8"
};

const server = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch { res.writeHead(400).end("Bad request"); return; }
  if (rel === "/" || rel.endsWith("/")) rel += "index.html";

  // Resolve inside ROOT only, so a crafted path can't read outside the project.
  const file = path.resolve(ROOT, "." + rel);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)){ res.writeHead(403).end("Forbidden"); return; }

  fs.readFile(file, (err, data) => {
    if (err){
      res.writeHead(err.code === "ENOENT" ? 404 : 500, {"content-type":"text/plain; charset=utf-8"});
      res.end(err.code === "ENOENT" ? "404 — not found" : "500 — " + err.code);
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-cache"
    });
    res.end(data);
  });
});

server.on("error", e => {
  if (e.code === "EADDRINUSE"){
    console.error(`Port ${PORT} is already in use. Try:  node serve.js ${PORT + 1}`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, () => console.log(`MedTriage AI running at http://localhost:${PORT}/  (Ctrl+C to stop)`));
