// HLS 열쇠 중계 (공개 서버라 비밀값은 없음: 크기·형식 검사와 요청 횟수 제한만 한다): 확장이 보낸 재생 목록 + 정상 열쇠를 잠시 보관했다가
// 재생 목록(열쇠 줄만 이쪽 주소로 바꿈)과 16바이트 열쇠를 돌려준다. 영상 조각은 건드리지 않는다.
const http = require("http");
const crypto = require("crypto");
const MAX_BODY = 400 * 1024, MAX_ITEMS = 300, TTL = 6 * 3600 * 1000;
const store = new Map(); // id -> {playlist, key(Buffer), at}
const hits = new Map(); // ip -> [times]
function prune() { const now = Date.now(); for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 60000) hits.delete(k); while (hits.size > 5000) hits.delete(hits.keys().next().value); for (const [k, v] of store) if (now - v.at > TTL) store.delete(k); while (store.size > MAX_ITEMS) store.delete(store.keys().next().value); }
function limited(ip) { const now = Date.now(), a = (hits.get(ip) || []).filter((t) => now - t < 60000); a.push(now); hits.set(ip, a); return a.length > 60; }
function abs(base, u) {
  try { return new URL(u, base).toString(); } catch (e) { return u; }
}
function build(playlist, base) {
  return playlist.split(/\r?\n/).map((ln) => {
    const t = ln.trim();
    if (!t) return "";
    if (t.startsWith("#")) return t.replace(/URI="([^"]+)"/g, (m, u) => (/^#EXT-X-KEY/.test(t) ? m : `URI="${abs(base, u)}"`));
    return abs(base, t);
  }).join("\n") + "\n";
}
const server = http.createServer((req, res) => {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",").map((z) => z.trim()).filter(Boolean), ip = xf.length ? xf[xf.length - 1] : req.socket.remoteAddress || "";
  let path = req.url.split("?")[0].replace(/^\/port\/\d+/, "");
  const send = (code, body, type) => { res.writeHead(code, { "Content-Type": type || "text/plain; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" }); res.end(body); };
  if (limited(ip)) return send(429, "too many requests");
  if (req.method === "OPTIONS") return send(204, "");
  prune();
  if (req.method === "POST" && path === "/api/p") {
        let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(); } else chunks.push(c); });
    req.on("end", () => {
      try {
        const j = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const key = String(j.key || "");
        if (!/^[0-9a-fA-F]{32}$/.test(key)) return send(400, "bad key");
        const pl = String(j.playlist || "");
        if (!/^#EXTM3U/.test(pl.trim()) || !/^https:\/\//.test(String(j.base || ""))) return send(400, "bad playlist");
        const id = crypto.randomBytes(9).toString("base64url");
        store.set(id, { playlist: build(pl, j.base).replace(/(#EXT-X-KEY:[^\n]*?)URI="[^"]*"/, `$1URI="../k/${id}"`), key: Buffer.from(key, "hex"), at: Date.now() });
        send(200, JSON.stringify({ id, path: `/api/p/${id}.m3u8` }), "application/json");
      } catch (e) { send(400, "bad request"); }
    });
    return;
  }
  let m = /^\/api\/p\/([\w-]+)\.m3u8$/.exec(path);
  if (req.method === "GET" && m) { const it = store.get(m[1]); return it ? send(200, it.playlist, "application/vnd.apple.mpegurl") : send(404, "not found"); }
  m = /^\/api\/k\/([\w-]+)$/.exec(path);
  if (req.method === "GET" && m) { const it = store.get(m[1]); return it ? send(200, it.key, "application/octet-stream") : send(404, "not found"); }
  if (path === "/api/health") return send(200, "ok");
  send(404, "not found");
});
server.listen(process.env.PORT || 5000, "0.0.0.0");
