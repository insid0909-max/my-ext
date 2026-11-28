const mangayomiSources = [{
    "name": "아보보",
    "lang": "ko",
    "baseUrl": "https://03.avovo.net",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/insid0909-max/my-ext/main/icon.png",
    "typeSource": "single",
    "itemType": 1,
    "isNsfw": true,
    "hasCloudflare": false,
    "version": "0.1.2",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "anime/avovo.js"
}];

// 아보보 (03.avovo.net, 2026-11-28 구조 확인 · 해외에서도 열림, 로그인 없이 작품·재생 모두 열림)
// - 게시판: /v/{jav|javremove|javleak|javfc2|javmgs|javu}/?sort=(date|views|likes|comments)&page=N&q=검색어 (20개씩, 마지막 쪽까지 page=N)
//   카드 a[href=/v/게시판/번호/] · img src · div.font-medium(품번) — 게시판 카드 제목은 품번만
// - 전체 검색: /search/posts/?q=검색어&group=v&page=N (모든 게시판, 20개씩, 제목에 품번+배우)
// - 작품: /v/게시판/번호/ — h1(품번 배우) · time(올린 시각) · 품번·제작사·출시일·재생시간·배우·장르 칸
//   영상은 x-data 의 urls: ["https://play.cdnvplay.com/v.php?v=JAV1/…/품번.mp4&cover=…"] (\u003D \u0026 \u002D 로 적혀 있음)
// - 재생: 플레이어 화면 <video data-src="https://vcdn.cdnvplay.com/bcdn_token=…&expires=…&token_path=%2F/JAV1/…mp4">
//   웹뷰·암호 없음. 영상 요청에 Referer=https://play.cdnvplay.com/ 가 있어야 열림(없으면 403). 토큰은 시간 제한이라 재생 직전에 받음.
//   자막: 플레이어 화면 CAP_SID → caption.php (아래 "자막" 부분 참고)
// 0.0.2 (2026-11-28): 한국어 자막 — 플레이어 caption.php 의 조각별 AES-GCM 자막을 풀어 WEBVTT 로 붙임(설정에서 끌 수 있음)
// 0.0.1 (2026-11-28): 첫 시험판 — 게시판 6개 · 정렬 4개 · 전체 검색 · 인기/최신 탭 규칙 · 새 주소 자동 따라가기 · 선호 화질 · 📡/📝 줄

const DEFAULT_SITE = "https://03.avovo.net";
const KEY = "avovo";
const HOST_RE = /^(?:(\d{1,3})\.)?avovo(\d{0,3})\.[a-z]{2,6}$/i;
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const PLAYER_ORIGIN = "https://play.cdnvplay.com";
const DOMAINS_URL = "https://raw.githubusercontent.com/insid0909-max/my-ext/main/domains.json";
const NOTES_URL = "https://raw.githubusercontent.com/insid0909-max/my-ext/main/changelog.json";
const INDEX_URL = "https://raw.githubusercontent.com/insid0909-max/my-ext/main/index.json";
// 분류: 0 = 전체(검색은 모든 게시판, 목록은 모자이크제거)
const CATS = [["전체", ""], ["일본 유모야동", "jav"], ["일본 아마추어야동", "javmgs"], ["일본 노모야동", "javu"], ["일본 FC2야동", "javfc2"], ["모자이크제거야동", "javremove"], ["일본 유출야동", "javleak"]];
const ORDERS = [["최신순", "date"], ["조회순", "views"], ["추천순", "likes"], ["댓글순", "comments"]];
const RULE_SIZES = [CATS.length, ORDERS.length];
const DEFAULT_POPULAR = [0, 1];
const DEFAULT_LATEST = [0, 0];
const RULE_CHOICES = [
    "저장하지 않음 (필터 결과만 보기)",
    "현재 조건을 인기 탭에 저장",
    "현재 조건을 최신 탭에 저장",
    "인기 탭을 기본값으로 복원",
    "최신 탭을 기본값으로 복원",
    "두 탭 모두 기본값으로 복원",
];
const RULE_NAME = "인기/최신 탭 규칙";
const F_CAT = "분류";
const F_ORDER = "정렬";
const QUALITY_CHOICES = ["자동", "1080p", "720p", "480p", "360p"];
const SUB_BUDGET_MS = 15000; // 자막 받기·풀기에 쓸 최대 시간 (넘으면 받은 만큼만)
const SUB_PARALLEL = 12;

let SITE = DEFAULT_SITE;

// ---------- 저장값 ----------
function prefs() { try { return new SharedPreferences(); } catch (e) { return null; } }
function gget(k, d) {
    const dd = d === undefined ? "" : d;
    try { const p = prefs(); const v = p ? p.getString(k, dd) : null; return v === null || v === undefined ? dd : String(v); } catch (e) { return dd; }
}
function gset(k, v) { try { const p = prefs(); if (p) p.setString(k, String(v)); } catch (e) { /* 저장 실패는 무시 */ } }
function hostOf(u) { return String(u || "").replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/^www\./, "").toLowerCase(); }
function hostNum(h) {
    const m = HOST_RE.exec(hostOf(h));
    if (!m) return -1;
    return m[1] ? Number(m[1]) : m[2] ? Number(m[2]) : 0;
}
function note(msg) {
    const d = new Date(Date.now() + 9 * 3600000), p = (n) => String(n).padStart(2, "0");
    gset("avovo_listed_note", `${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} ${msg}`);
}
// 지금 쓸 주소: 직접 넣은 주소 > 자동으로 찾은 주소 > 기본 주소
function syncSite() {
    try {
        const d = hostOf(gget("avovo_domain")), a = hostOf(gget("avovo_auto_domain"));
        SITE = HOST_RE.test(d) ? "https://" + d : HOST_RE.test(a) ? "https://" + a : DEFAULT_SITE;
    } catch (e) { SITE = DEFAULT_SITE; }
    return SITE;
}

// ---------- 글자 다루기 ----------
function ent(s) {
    return String(s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ")
        .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)));
}
function strip(s) { return ent(String(s || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(); }
function unesc(s) {
    return String(s || "").replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\//g, "/");
}
function between(html, a, b) { const i = html.indexOf(a); if (i < 0) return ""; const j = html.indexOf(b, i + a.length); return j < 0 ? "" : html.substring(i + a.length, j); }

// ---------- 주소 따라가기 ----------
async function isSite(client, origin) {
    try {
        const r = await client.get(origin + "/v/javremove/", { "User-Agent": UA, "Referer": origin + "/" });
        const b = String(r.body || "");
        return Number(r.statusCode) === 200 && /href="\/v\/[a-z0-9]+\/\d+\/"/i.test(b);
    } catch (e) { return false; }
}
function adopt(origin) {
    gset("avovo_auto_domain", origin);
    if (hostOf(gget("avovo_domain"))) gset("avovo_domain", origin);
    SITE = origin;
}
async function followWork(client) {
    const cur = hostOf(SITE);
    // ① 1시간에 한 번: 지금 주소가 다른 주소로 넘겨 주면(301·302) 진짜 사이트일 때 그 주소로
    if (Date.now() - (Number(gget("avovo_moved_at", "0")) || 0) >= 3600000) {
        gset("avovo_moved_at", Date.now());
        try {
            const c = new Client({ useDartHttpClient: true, followRedirects: false, timeout: 4, connectTimeout: 3 });
            const r = await c.get(SITE + "/", { "User-Agent": UA });
            const code = Number(r.statusCode);
            const hit = Object.entries(r.headers || {}).find(([k]) => k.toLowerCase() === "location");
            const to = hostOf(hit ? hit[1] : "");
            if (code >= 300 && code < 400 && to && to !== cur && HOST_RE.test(to)) {
                if (await isSite(client, "https://" + to)) { adopt("https://" + to); return note(`넘김 → ${to} 로 바꿈`); }
                note(`넘김 → ${to} (확인 안 돼 그대로)`);
            }
        } catch (e) { /* 아래 목록 확인으로 */ }
    }
    // ② 6시간에 한 번: 저장소 주소 목록(domains.json)에 더 새 주소가 있고 진짜 사이트면 그 주소로
    if (Date.now() - (Number(gget("avovo_listed_at", "0")) || 0) < 6 * 3600000) return;
    gset("avovo_listed_at", Date.now());
    let listed = "";
    try {
        const r = await client.get(DOMAINS_URL, {});
        listed = hostOf(((JSON.parse(String(r.body || "{}")).domains || {})[KEY] || {}).baseUrl);
    } catch (e) { /* 아래에서 처리 */ }
    if (!listed) return note("목록 못 받음");
    if (!HOST_RE.test(listed) || listed === cur || hostNum(listed) < hostNum(cur)) return note(`같음 (${cur})`);
    if (await isSite(client, "https://" + listed)) { adopt("https://" + listed); return note(`새 주소 ${listed} 로 바꿈`); }
    note(`${listed} 가 아직 안 열려 그대로`);
}
async function notesWork(client) {
    try { const r = await client.get(NOTES_URL, {}), b = String(r.body || ""); if (Number(r.statusCode) === 200 && b.trim().startsWith("{")) gset("notes_json", b); } catch (e) { /* 다음 기회 */ }
    try {
        const r = await client.get(INDEX_URL, {}), a = JSON.parse(String(r.body || "[]"));
        const hit = (Array.isArray(a) ? a : []).find((x) => x && String(x.sourceCodeUrl || "").endsWith("/avovo.js"));
        if (hit && hit.version) gset("ver_latest", String(hit.version));
    } catch (e) { /* 다음 기회 */ }
}
// 목록 첫 쪽을 열 때만, 7초 안에 (느리면 그냥 넘어감)
async function followAll(ext) {
    try {
        const jobs = [];
        if (gget("avovo_auto", "true") !== "false") jobs.push(followWork(ext.client));
        if (Date.now() - (Number(gget("notes_at", "0")) || 0) >= 3600000) { gset("notes_at", Date.now()); jobs.push(notesWork(ext.client)); }
        if (jobs.length) await Promise.race([Promise.all(jobs.map((j) => j.catch(() => 0))), new Promise((r) => setTimeout(r, 7000))]);
    } catch (e) { /* 다음 기회 */ }
}

// ---------- 인기/최신 탭 규칙 ----------
function ruleRead(popular) {
    const raw = gget(`${KEY}_${popular ? "pop" : "latest"}_rule2`, "");
    if (!raw) return null;
    const idx = raw.split(",").map((x) => parseInt(x, 10));
    if (idx.length !== RULE_SIZES.length || idx.some((v, i) => !(v >= 0 && v < RULE_SIZES[i]))) return null;
    return idx;
}
function ruleApply(rule, idx) {
    const pop = `${KEY}_pop_rule2`, latest = `${KEY}_latest_rule2`, v = idx.join(",");
    if (rule === 1) gset(pop, v);
    else if (rule === 2) gset(latest, v);
    else if (rule === 3) gset(pop, "");
    else if (rule === 4) gset(latest, "");
    else if (rule === 5) { gset(pop, ""); gset(latest, ""); }
}
function ruleText(i) { return [CATS[i[0]][0], ORDERS[i[1]][0]].join(" · "); }
function ruleFilters() {
    const pop = ruleRead(true), latest = ruleRead(false);
    return [
        { type_name: "SeparatorFilter" },
        { type_name: "HeaderFilter", name: `현재 인기: ${pop ? ruleText(pop) : ruleText(DEFAULT_POPULAR) + " (기본)"}` },
        { type_name: "HeaderFilter", name: `현재 최신: ${latest ? ruleText(latest) : ruleText(DEFAULT_LATEST) + " (기본)"}` },
        { type_name: "SelectFilter", name: RULE_NAME, param: "rule", state: 0, values: RULE_CHOICES.map((c, i) => ({ type_name: "SelectOption", name: c, value: String(i) })) },
    ];
}

// ---------- 선호 화질 ----------
function qualityWant() {
    let v = gget("avovo_quality", "자동");
    if (/^\d+$/.test(v)) v = QUALITY_CHOICES[Number(v)] || "자동";
    return QUALITY_CHOICES.includes(v) ? v : "자동";
}
function withRes(label, url) {
    let path = String(url || "").split("?")[0];
    try { path = decodeURIComponent(path); } catch (e) { /* 그대로 */ }
    const m = /(?:^|[^0-9])(2160|1440|1080|720|576|480|360|240)[pP](?![0-9a-zA-Z])/.exec(path);
    return m && !label.includes(`${m[1]}p`) ? `${label} ${m[1]}p` : label;
}
function qualitySort(list) {
    const want = qualityWant();
    if (want === "자동") return list;
    const hit = (x) => String(x.quality).endsWith(` ${want}`) || String(x.quality).includes(` ${want} `);
    return list.filter(hit).concat(list.filter((x) => !hit(x)));
}

// ---------- 필터 맨 위 📡·📝 줄 ----------
function verCmp(a, b) {
    const x = String(a || "").split(".").map((n) => parseInt(n, 10) || 0), y = String(b || "").split(".").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    return 0;
}
function statusLines() {
    const hd = (name) => ({ type_name: "HeaderFilter", name, _status: true });
    const n = gget("avovo_listed_note");
    const lines = [hd(`📡 주소: ${hostOf(SITE)} · 자동 찾기 ${gget("avovo_auto", "true") === "false" ? "꺼짐" : "켜짐"}${n ? " · 🔎 " + n : ""}`)];
    const mine = mangayomiSources[0].version, latest = gget("ver_latest");
    let last = null;
    try { last = ((JSON.parse(gget("notes_json", "{}")).items || {}).avovo || []).filter((x) => x && x.t)[0]; } catch (e) { last = null; }
    const tail = last ? ` · ${String(last.d || "").substring(5).replace("-", ".")} ${String(last.t).replace(/^망가요미:\s*/, "")}` : "";
    lines.push(hd(latest && verCmp(latest, mine) > 0 ? `📝 ⚠️ OLD ${mine} → 새 버전 ${latest} 있음, 확장 화면에서 업데이트` : `📝 ${latest ? "🆕 NEW " : ""}${mine}${tail}`));
    lines.push(hd("분류·정렬은 검색어 없이 필터 적용 · 검색창에 새 주소를 붙여 넣으면 그 주소로 바꿈"));
    return lines;
}


// ---------- 자막 (플레이어 caption.php 의 암호 자막을 풀어 WEBVTT 로) ----------
// 흐름: 플레이어 화면 CAP_SID → caption.php?a=boot&sid= → {seg:60, segs:[{i, iv, ct}]} (60초 조각마다 AES-GCM)
//       → caption.php?a=key&sid=&i= → {k} (조각 열쇠, 재생 위치와 상관없이 받아짐, 403·429 면 retry 초 뒤 다시)
//       → 풀면 [[시작초, 끝초, "글"], …]. 웹뷰·WebCrypto 없이 쓰려고 AES 를 직접 구현(GCM 은 CTR 이라 암호화 방향만 필요, 인증 태그는 확인 안 함)
const SBOX = (function () {
    const s = new Array(256), inv = new Array(256);
    let p = 1, q = 1;
    do {
        p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0);
        q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff; if (q & 0x80) q ^= 0x09;
        const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
        s[p] = (x ^ 0x63) & 0xff;
    } while (p !== 1);
    s[0] = 0x63;
    return s;
})();
function aesExpand(key) {
    const nk = key.length / 4, nr = nk + 6, w = new Array(4 * (nr + 1));
    for (let i = 0; i < nk; i++) w[i] = (key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3];
    let rc = 1;
    for (let i = nk; i < w.length; i++) {
        let t = w[i - 1];
        if (i % nk === 0) {
            t = (t << 8) | (t >>> 24);
            t = (SBOX[t >>> 24] << 24) | (SBOX[(t >> 16) & 255] << 16) | (SBOX[(t >> 8) & 255] << 8) | SBOX[t & 255];
            t ^= rc << 24; rc = (rc << 1) ^ (rc & 0x80 ? 0x11b : 0);
        } else if (nk > 6 && i % nk === 4) {
            t = (SBOX[t >>> 24] << 24) | (SBOX[(t >> 16) & 255] << 16) | (SBOX[(t >> 8) & 255] << 8) | SBOX[t & 255];
        }
        w[i] = (w[i - nk] ^ t) | 0;
    }
    return { w, nr };
}
function xt(a) { return ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 255; }
function aesBlock(ks, input) {
    const s = new Array(16), { w, nr } = ks;
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) s[4 * c + r] = input[4 * c + r] ^ ((w[c] >>> (24 - 8 * r)) & 255);
    for (let round = 1; round <= nr; round++) {
        const t = new Array(16);
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) t[4 * c + r] = SBOX[s[4 * ((c + r) % 4) + r]];
        if (round < nr) {
            for (let c = 0; c < 4; c++) {
                const a0 = t[4 * c], a1 = t[4 * c + 1], a2 = t[4 * c + 2], a3 = t[4 * c + 3];
                const x = a0 ^ a1 ^ a2 ^ a3;
                s[4 * c] = a0 ^ x ^ xt(a0 ^ a1);
                s[4 * c + 1] = a1 ^ x ^ xt(a1 ^ a2);
                s[4 * c + 2] = a2 ^ x ^ xt(a2 ^ a3);
                s[4 * c + 3] = a3 ^ x ^ xt(a3 ^ a0);
            }
        } else for (let i = 0; i < 16; i++) s[i] = t[i];
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) s[4 * c + r] ^= (w[4 * round + c] >>> (24 - 8 * r)) & 255;
    }
    return s;
}
// AES-GCM 풀기 (iv 12바이트, 끝 16바이트는 태그): 카운터는 2 부터
function gcmDecrypt(key, iv, data) {
    const ks = aesExpand(key), n = data.length - 16, out = new Array(n);
    const ctr = new Array(16);
    for (let i = 0; i < 12; i++) ctr[i] = iv[i];
    for (let b = 0, c = 2; b * 16 < n; b++, c++) {
        ctr[12] = (c >>> 24) & 255; ctr[13] = (c >>> 16) & 255; ctr[14] = (c >>> 8) & 255; ctr[15] = c & 255;
        const ksb = aesBlock(ks, ctr);
        for (let i = 0; i < 16 && b * 16 + i < n; i++) out[b * 16 + i] = data[b * 16 + i] ^ ksb[i];
    }
    return out;
}
function b64uBytes(v) {
    const T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const s = String(v || "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const out = [];
    let acc = 0, bits = 0;
    for (let i = 0; i < s.length; i++) {
        const x = T.indexOf(s.charAt(i));
        if (x < 0) continue;
        acc = (acc << 6) | x; bits += 6;
        if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); acc &= (1 << bits) - 1; }
    }
    return out;
}
function utf8Text(b) {
    let s = "";
    for (let i = 0; i < b.length;) {
        const c = b[i++];
        if (c < 0x80) s += String.fromCharCode(c);
        else if (c < 0xe0) s += String.fromCharCode(((c & 31) << 6) | (b[i++] & 63));
        else if (c < 0xf0) { const c2 = b[i++], c3 = b[i++]; s += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63)); }
        else { const c2 = b[i++], c3 = b[i++], c4 = b[i++]; let cp = ((c & 7) << 18) | ((c2 & 63) << 12) | ((c3 & 63) << 6) | (c4 & 63); cp -= 0x10000; s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023)); }
    }
    return s;
}
function vttTime(t) {
    const ms = Math.max(0, Math.round(Number(t) * 1000)), p = (n, l) => String(n).padStart(l || 2, "0");
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
}
// 반환: { subs: [{file,label}], info: "자막 N줄" 같은 짧은 설명 }
async function fetchSubs(client, playerBody, playerUrl) {
    const m = /CAP_SID\s*=\s*"([^"]+)"/.exec(playerBody);
    if (!m) return { subs: [], info: "자막 없음" };
    if (/HAS_CAPTION\s*=\s*false/.test(playerBody)) return { subs: [], info: "자막 없음" };
    const origin = (/^https?:\/\/[^/]+/.exec(playerUrl) || [PLAYER_ORIGIN])[0];
    const h = { "User-Agent": UA, "Referer": playerUrl, "Accept": "application/json,*/*" };
    const sid = encodeURIComponent(m[1]);
    const t0 = Date.now(), left = () => SUB_BUDGET_MS - (Date.now() - t0);
    let boot;
    try {
        const r = await client.get(`${origin}/caption.php?a=boot&sid=${sid}`, h);
        if (Number(r.statusCode) !== 200) return { subs: [], info: `자막 목록 HTTP ${r.statusCode}` };
        boot = JSON.parse(String(r.body || "{}"));
    } catch (e) { return { subs: [], info: "자막 목록 못 받음" }; }
    const segs = (boot.segs || []).filter((x) => x && x.ct && x.iv);
    if (!segs.length) return { subs: [], info: "자막 없음" };
    const cues = [];
    let done = 0, next = 0, fail = 0;
    const work = async () => {
        while (next < segs.length && left() > 0) {
            const sg = segs[next++];
            let ok = false;
            for (let tryNo = 0; tryNo < 2 && !ok && left() > 0; tryNo++) {
                try {
                    const r = await client.get(`${origin}/caption.php?a=key&sid=${sid}&i=${sg.i}`, h);
                    const code = Number(r.statusCode);
                    if (code === 403 || code === 429) {
                        let wait = 3;
                        try { wait = Math.min(Math.max(Number(JSON.parse(String(r.body || "{}")).retry) || 3, 1), 4); } catch (e) { /* 기본 */ }
                        await new Promise((res) => setTimeout(res, wait * 1000));
                        continue;
                    }
                    if (code !== 200) continue;
                    const k = JSON.parse(String(r.body || "{}")).k;
                    const plain = gcmDecrypt(b64uBytes(k), b64uBytes(sg.iv), b64uBytes(sg.ct));
                    const arr = JSON.parse(utf8Text(plain));
                    for (const c of arr) if (Array.isArray(c) && c.length >= 3 && String(c[2]).trim()) cues.push({ s: Number(c[0]), e: Number(c[1]), t: String(c[2]) });
                    ok = true;
                } catch (e) { /* 다음 시도 */ }
            }
            if (ok) done++; else fail++;
        }
    };
    const n = Math.min(SUB_PARALLEL, segs.length);
    await Promise.all(Array.from({ length: n }, () => work()));
    if (!cues.length) return { subs: [], info: `자막 풀기 실패 (${done}/${segs.length})` };
    cues.sort((a, b) => a.s - b.s);
    let vtt = "WEBVTT\n\n";
    cues.forEach((c, i) => { vtt += `${i + 1}\n${vttTime(c.s)} --> ${vttTime(Math.max(c.e, c.s + 0.5))}\n${c.t.replace(/\r/g, "").replace(/\n{2,}/g, "\n")}\n\n`; });
    return { subs: [{ file: vtt, label: "한국어" }], info: `자막 ${cues.length}줄${done < segs.length ? ` (${done}/${segs.length}조각)` : ""}` };
}

// ---------- 본체 ----------
class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client({ timeout: 25 });
        syncSite();
    }

    getHeaders(referer) {
        return { "User-Agent": UA, "Referer": referer || SITE + "/", "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "ko-KR,ko;q=0.9" };
    }

    abs(u) {
        u = String(u || "").trim();
        if (!u) return "";
        if (/^https?:/i.test(u)) return u;
        if (u.startsWith("//")) return "https:" + u;
        return SITE + (u.startsWith("/") ? "" : "/") + u;
    }

    async page(path, referer) {
        let res = null, err = "";
        try { res = await this.client.get(this.abs(path), this.getHeaders(referer)); } catch (e) { err = String((e && e.message) || e).substring(0, 80); }
        if (!res) throw new Error(`아보보 접속 실패 [${err}] · 설정에서 새 주소를 넣어 주세요 (현재 ${hostOf(SITE)})`);
        if (Number(res.statusCode) >= 400) throw new Error(`아보보 접속 실패 [HTTP ${res.statusCode} · ${hostOf(SITE)}] · 설정에서 새 주소를 넣어 주세요`);
        return String(res.body || "");
    }

    // 목록: 게시판 카드(품번만) · 전체 검색 줄(품번+배우) 둘 다 읽음
    parseList(html, page) {
        const list = [], seen = {};
        const re = /<a\s+href="(\/v\/[a-z0-9]+\/\d+\/)(?:\?[^"]*)?"[^>]*>([\s\S]*?)<\/a>/gi;
        let m;
        while ((m = re.exec(html))) {
            const link = m[1];
            if (seen[link]) continue;
            seen[link] = true;
            const body = m[2];
            const t = /<div[^>]*class="font-(?:medium|semibold)[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(body);
            const name = t ? strip(t[1]) : "";
            if (!name) continue;
            let img = "";
            const im = /<img[^>]+src="(https?:\/\/[^"]+)"/i.exec(body);
            if (im) img = ent(im[1]);
            list.push({ name, imageUrl: img, link });
        }
        const hasNextPage = new RegExp(`[?&;]page=${Number(page) + 1}(?!\\d)`).test(html);
        return { list, hasNextPage };
    }

    // 게시판 목록(또는 검색어 있으면 게시판 안 검색 / 전체 검색)
    async listing(cat, order, query, page) {
        const slug = CATS[cat] ? CATS[cat][1] : "";
        const sort = ORDERS[order] ? ORDERS[order][1] : "date";
        const q = String(query || "").trim();
        const p = Number(page) > 1 ? `&page=${Number(page)}` : "";
        let path;
        if (q && !slug) path = `/search/posts/?q=${encodeURIComponent(q)}&group=v${p}`;
        else path = `/v/${slug || "javremove"}/?sort=${sort}${q ? "&q=" + encodeURIComponent(q) : ""}${p}`;
        return this.parseList(await this.page(path), Number(page) || 1);
    }

    async getPopular(page) { const r = ruleRead(true) || DEFAULT_POPULAR; return this.listing(r[0], r[1], "", page); }
    async getLatestUpdates(page) { const r = ruleRead(false) || DEFAULT_LATEST; return this.listing(r[0], r[1], "", page); }

    async search(query, page, filters) {
        const fl = filters || [], get = (n) => fl.find((x) => x && x.name === n);
        const c = get(F_CAT), o = get(F_ORDER);
        const cat = c ? Number(c.state) || 0 : 0, order = o ? Number(o.state) || 0 : 0;
        const q = String(query || "").trim();
        if (!q) {
            const rf = get(RULE_NAME), rule = rf ? Number(rf.state) || 0 : 0;
            if (rule) ruleApply(rule, [cat, order]);
        }
        return this.listing(cat, order, q, page);
    }

    async getDetail(url) {
        const link = String(url || "").replace(/^https?:\/\/[^/]+/, "");
        const html = await this.page(link);
        const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
        const name = h1 ? strip(h1[1]) : strip(between(html, "<title>", "</title>")).replace(/\s*:\s*아보보\s*$/, "");
        const urls = this.playerUrls(html);
        // 표지: 플레이어 주소의 cover= (큰 그림) → og:image
        let img = "";
        for (const u of urls) { const c = /[?&]cover=([^&\s]+)/.exec(u); if (c) { img = decodeURIComponent(c[1]); break; } }
        if (!img) { const og = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i.exec(html); if (og) img = ent(og[1]); }
        // 정보 칸
        const aside = between(html, "<aside", "</aside>");
        const rows = [];
        const rowRe = /<div[^>]*>\s*<span[^>]*>([^<]{1,10})<\/span>([\s\S]*?)<\/div>/g;
        let r;
        while ((r = rowRe.exec(aside))) { const k = strip(r[1]), v = strip(r[2]); if (k && v) rows.push([k, v]); }
        const genre = [];
        const gRe = /<a[^>]+href="\/content\/genre\/[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
        let g;
        while ((g = gRe.exec(aside))) { const t = strip(g[1]); if (t && genre.indexOf(t) < 0) genre.push(t); }
        const prose = /<div[^>]*class="prose[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
        const desc = [];
        if (prose && strip(prose[1])) desc.push(strip(prose[1]));
        for (const [k, v] of rows) if (k !== "장르") desc.push(`${k}: ${v}`);
        // 0.1.2: 자막 표시 — 첫 플레이어 화면(1번 요청, 5초 안)에서 HAS_CAPTION 확인
        let capLine = "";
        if (urls.length && gget("avovo_sub", "true") !== "false") {
            try {
                const rr = await Promise.race([
                    this.client.get(urls[0], { "User-Agent": UA, "Referer": SITE + "/", "Accept": "text/html,*/*" }),
                    new Promise((ok) => setTimeout(() => ok(null), 5000)),
                ]);
                const pb = rr && Number(rr.statusCode) === 200 ? String(rr.body || "") : "";
                if (pb) capLine = /CAP_SID\s*=\s*"[^"]+"/.test(pb) && !/HAS_CAPTION\s*=\s*false/.test(pb) ? "자막: 한국어 자막 있음" : "자막: 없음";
            } catch (e) { capLine = ""; }
        }
        if (capLine) desc.unshift(capLine);
        // 올린 시각
        const t = /<time[^>]*>\s*(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/.exec(html);
        const when = t ? Date.UTC(+t[1], +t[2] - 1, +t[3], +t[4] - 9, +t[5]) : Date.now();
        const episodes = urls.map((u, i) => ({
            name: urls.length > 1 ? `${i + 1}. 영상 ${i + 1}` : "1. 본편",
            url: JSON.stringify({ p: u, from: link }),
            dateUpload: String(when),
        }));
        return { name, link, imageUrl: img, description: desc.join("\n"), genre, status: 1, episodes };
    }

    // 작품 화면 안 플레이어 주소들 (x-data 의 urls 배열, \u003D 같은 글자 풀기)
    playerUrls(html) {
        const out = [];
        const re = /https?:(?:\\\/|\/){2}play\.[a-z0-9.-]+\/v\.php[^"'<>\s]*?(?=["'<>\s]|\\"|$)/gi;
        const seg = String(html).replace(/&quot;/g, '"');
        let m;
        while ((m = re.exec(seg))) {
            const u = ent(unesc(m[0])).replace(/\\+$/, "");
            if (out.indexOf(u) < 0) out.push(u);
        }
        if (!out.length) {
            const f = /<iframe[^>]+src="([^"]+)"/i.exec(html);
            if (f && !/^about:/.test(f[1])) out.push(ent(f[1]));
        }
        return out;
    }

    async getVideoList(url) {
        let player = "", from = "";
        try { const o = JSON.parse(String(url)); player = o.p || ""; from = o.from || ""; } catch (e) { player = ""; }
        if (!player) {
            const html = await this.page(String(url).replace(/^https?:\/\/[^/]+/, ""));
            player = this.playerUrls(html)[0] || "";
            from = String(url);
        }
        if (!player) throw new Error("플레이어 주소를 못 찾았어요");
        const origin = (/^https?:\/\/[^/]+/.exec(player) || [PLAYER_ORIGIN])[0];
        let body = "", why = "";
        try {
            const res = await this.client.get(player, { "User-Agent": UA, "Referer": SITE + "/", "Accept": "text/html,*/*" });
            if (Number(res.statusCode) >= 400) why = `플레이어 HTTP ${res.statusCode}`;
            else body = String(res.body || "");
        } catch (e) { why = "플레이어 접속 실패"; }
        const found = [];
        const add = (u) => { u = ent(unesc(u)); if (/^https?:\/\//.test(u) && !/_(?:preview|sprite|poster)\./i.test(u) && found.indexOf(u) < 0) found.push(u); };
        let m;
        const r1 = /data-src="([^"]+\.(?:mp4|m3u8)[^"]*)"/gi;
        while ((m = r1.exec(body))) add(m[1]);
        const r2 = /<source[^>]+src="([^"]+)"/gi;
        while ((m = r2.exec(body))) add(m[1]);
        if (!found.length) {
            const r3 = /https?:(?:\\\/|\/){2}[^"'\s<>\\]+?\.(?:mp4|m3u8)(?:\?[^"'\s<>\\]*)?/gi;
            while ((m = r3.exec(body))) add(m[0]);
        }
        if (!found.length) throw new Error(`영상 주소를 못 찾았어요 [${why || "플레이어 화면에 영상 주소 없음"} · 화면 ${body.length}자]`);
        const headers = { "User-Agent": UA, "Referer": origin + "/", "Accept": "*/*" };
        let sub = { subs: [], info: "" };
        if (gget("avovo_sub", "true") !== "false") {
            try { sub = await fetchSubs(this.client, body, player); } catch (e) { sub = { subs: [], info: "자막 오류" }; }
        }
        const list = found.map((u, i) => ({
            url: u, originalUrl: u,
            quality: withRes(`아보보 ${/\.m3u8/i.test(u) ? "HLS" : "MP4"}${i ? " #" + (i + 1) : ""}`, u) + (sub.info ? ` · ${sub.info}` : ""),
            headers, subtitles: sub.subs,
        }));
        return qualitySort(list);
    }

    getFilterList() {
        const sel = (name, list) => ({ type_name: "SelectFilter", name, state: 0, values: list.map(([nm, value]) => ({ type_name: "SelectOption", name: nm, value })) });
        const list = [
            sel(F_CAT, CATS),
            sel(F_ORDER, ORDERS),
            { type_name: "HeaderFilter", name: "분류 \"전체\"는 검색어가 있을 때 모든 게시판에서 찾음 (목록은 모자이크제거)" },
        ];
        list.push(...ruleFilters());
        list.push(...[1, 2, 3].map(() => ({ type_name: "HeaderFilter", name: "\u3000", _status: true })));
        return statusLines().concat(list);
    }

    getSourcePreferences() {
        return [
            { key: "avovo_domain", editTextPreference: { title: "아보보 주소", summary: "비워 두면 기본·자동 주소를 씁니다. 직접 넣은 주소가 우선이고, 더 새 주소가 확인되면 자동으로 바뀝니다. (예: https://03.avovo.net)", value: "", dialogTitle: "아보보 주소", dialogMessage: "https://03.avovo.net 형식" } },
            { key: "avovo_auto", listPreference: { title: "새 주소 자동 따라가기", summary: "저장소 주소 목록·넘겨 주는 주소를 확인해 새 주소로 바꿉니다.", valueIndex: 0, entries: ["켬", "끔"], entryValues: ["true", "false"] } },
            { key: "avovo_sub", listPreference: { title: "자막 가져오기", summary: "플레이어의 한국어 자막을 받아 풀어서 붙입니다. 재생 시작이 몇 초 늦어질 수 있어요. 끄면 자막 없이 바로 재생.", valueIndex: 0, entries: ["켬", "끔"], entryValues: ["true", "false"] } },
            { key: "avovo_quality", listPreference: { title: "선호 화질", summary: "영상이 여러 화질로 올 때 이 화질을 먼저 재생합니다. 지금은 화질이 하나뿐이라 달라지지 않습니다.", valueIndex: 0, entries: QUALITY_CHOICES, entryValues: QUALITY_CHOICES } },
        ];
    }
}

// 검색창에 새 주소를 붙여 넣으면 그 주소로 바꿈 (작품 주소면 그 작품)
(function () {
    const se = DefaultExtension.prototype.search;
    const gp = DefaultExtension.prototype.getPopular, gl = DefaultExtension.prototype.getLatestUpdates;
    DefaultExtension.prototype.getPopular = async function (page) { syncSite(); if (Number(page) === 1) await followAll(this); return gp.call(this, page); };
    DefaultExtension.prototype.getLatestUpdates = async function (page) { syncSite(); if (Number(page) === 1) await followAll(this); return gl.call(this, page); };
    DefaultExtension.prototype.search = async function (query, page, filters) {
        syncSite();
        const q = String(query || "").trim();
        const m = /^(?:https?:\/\/)?((?:\d{1,3}\.)?avovo\d{0,3}\.[a-z]{2,6})(\/[^#]*)?$/i.exec(q);
        if (m) {
            const origin = "https://" + m[1].toLowerCase();
            if (origin !== SITE) {
                if (!(await isSite(this.client, origin))) throw new Error("새 주소에서 작품 목록을 확인하지 못했습니다.");
                gset("avovo_domain", origin);
                adopt(origin);
            }
            if (m[2] && /^\/v\/[a-z0-9]+\/\d+\//i.test(m[2])) {
                const d = await this.getDetail(m[2]);
                return { list: [{ name: d.name, imageUrl: d.imageUrl, link: m[2] }], hasNextPage: false };
            }
            return Number(page) > 1 ? { list: [], hasNextPage: false } : this.getPopular(1);
        }
        return se.call(this, query, page, filters);
    };
    const gd = DefaultExtension.prototype.getDetail, gv = DefaultExtension.prototype.getVideoList;
    DefaultExtension.prototype.getDetail = function () { syncSite(); return gd.apply(this, arguments); };
    DefaultExtension.prototype.getVideoList = function () { syncSite(); return gv.apply(this, arguments); };
    const gf = DefaultExtension.prototype.getFilterList;
    DefaultExtension.prototype.getFilterList = function () { syncSite(); return gf.apply(this, arguments); };
})();
