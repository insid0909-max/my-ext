const mangayomiSources = [{
    "name": "AVFLIX",
    "lang": "ko",
    "baseUrl": "https://kr7.avflix.co",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/insid0909-max/my-ext/main/icon.png",
    "typeSource": "single",
    "itemType": 1,
    "isNsfw": true,
    "hasCloudflare": false,
    "version": "0.1.0",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "anime/avflix.js"
}];

// 개인용 AVFLIX 소스
// 2026-11-18 사이트 새 단장(renewal): 화면은 껍데기뿐이고 자료는 모두 /api/v1/… (응답 {data:{…}})
// - 목록 /api/v1/av/category/{code}?sort=&subtitle=&mosaic=&pageNo=&pageSize=31 · 전체/검색 /api/v1/av/search?keyword=…
//   → data.list[{idx,title,thumbnail,mosaic,subtitle,productNo,actors,regDate,releaseDate}], data.paging{pageNo,finalPageNo,totalSize}
// - 작품 /api/v1/av/{idx} → data{…, story, productions, categories[{name}], contentUrl(영상)}
// - 정렬 reg_date(최신 등록)·view_count(인기)·release_date(출시일), 자막 all·subtitle·nosubtitle, 모자이크 all·mosaic·nomosaic
// - 영상이 CDN(cdnUrl) 에서 안 열리면 사이트 중계 /videos/{base64url(주소)}.mp4 (사이트 코드 proxyMediaUrl 과 같음)
// - /api 는 해외에서 403 (화면은 열림) → 국내 휴대폰에서만 확인 가능
// - 분류 중 한국일반(general)·방송/BJ(bj) 는 몰래카메라·유출 영상이 섞일 위험이 커서 넣지 않음(붙여 넣기도 막음)
// - 설정은 반드시 try 안에서 읽음 (설치 때 getHeaders·getFilterList 가 불림)
const DEFAULT_BASE_URL = "https://kr7.avflix.co";
const DOMAIN_RE = /^https:\/\/(?:[a-z]+\d*\.)?avflix\.[a-z]{2,8}$/;
const SITE_RE = /^https?:\/\/(?:[a-z]+\d*\.)?avflix\.[a-z]{2,8}/;
const LABEL = "AVFLIX";
const BLOCKED_CATS = /^(?:general|bj)$/;

// 분류 (/renewal/categories.json 2026-11-18 중 일본 AV 만)
const CATS = [["전체", ""], ["신작 (노모)", "nomosaic"], ["유모 2024", "recent"]];
const SORTS = [["최신 등록순", "reg_date"], ["인기순", "view_count"], ["출시일순", "release_date"]];
const SUBS = [["자막 전체", "all"], ["자막 있음", "subtitle"], ["자막 없음", "nosubtitle"]];
const MOSAICS = [["모자이크 전체", "all"], ["모자이크", "mosaic"], ["노모자이크", "nomosaic"]];
const FILTER_DEFS = [["분류", CATS], ["정렬", SORTS], ["자막", SUBS], ["모자이크", MOSAICS]];
const RULE_SIZES = FILTER_DEFS.map((d) => d[1].length);
const DEFAULT_POPULAR = [0, 1, 0, 0];
const DEFAULT_LATEST = [0, 0, 0, 0];

function ruleText(i) {
    return [CATS[i[0]][0], SORTS[i[1]][0], i[2] ? SUBS[i[2]][0] : "", i[3] ? MOSAICS[i[3]][0] : ""].filter((x) => x).join(" · ");
}

// base64url (사이트 중계 주소용, 망가요미 JS 에 btoa 가 없을 수 있어 직접)
function b64url(text) {
    const bytes = unescape(encodeURIComponent(text));
    const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes.charCodeAt(i);
        const b = i + 1 < bytes.length ? bytes.charCodeAt(i + 1) : NaN;
        const c = i + 2 < bytes.length ? bytes.charCodeAt(i + 2) : NaN;
        const n = (a << 16) | ((b || 0) << 8) | (c || 0);
        out += abc[(n >> 18) & 63] + abc[(n >> 12) & 63] + (isNaN(b) ? "" : abc[(n >> 6) & 63]) + (isNaN(c) ? "" : abc[n & 63]);
    }
    return out;
}

function first(el, css) {
    const l = el ? el.select(css) : [];
    return l && l.length ? l[0] : null;
}

let lastSiteRequest = 0;
async function siteWait() {
    const wait = lastSiteRequest + 300 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSiteRequest = Date.now();
}

function ymd(ms) {
    const d = new Date(ms + 9 * 3600000).toISOString();
    return `${d.substring(0, 4)}.${d.substring(5, 7)}.${d.substring(8, 10)}`;
}


// 이 헤더로 영상 주소가 실제로 열리는지 (m3u8 이면 내용까지 확인)
async function mediaWorks(client, url, headers) {
    // mp4 같은 영상 파일은 확인하려면 파일 전체를 받아야 해서(망가요미는 본문을 끝까지 받음) 확인하지 않음
    if (!url.includes(".m3u8")) return true;
    try {
        const res = await client.get(url, headers);
        if (Number(res.statusCode) >= 400) return false;
        return !url.includes(".m3u8") || String(res.body || "").trim().startsWith("#EXTM3U");
    } catch (e) {
        return false;
    }
}

const QUALITY_CHOICES = ["자동", "1080p", "720p", "480p", "360p"];

// HLS 마스터 목록에 화질이 여러 개면 각각 따로 고를 수 있게 나눔. 하나뿐이거나 읽지 못하면 그대로
// 주소에 "1080p" 같은 화질이 적혀 있으면 이름 뒤에 붙임 (mp4·단일 화질 영상도 지금 화질을 알 수 있게)
function withRes(label, url) {
    let path = String(url || "").split("?")[0];
    try {
        path = decodeURIComponent(path);
    } catch (e) {
        // 그대로 사용
    }
    const m = /(?:^|[^0-9])(2160|1440|1080|720|576|480|360|240)[pP](?![0-9a-zA-Z])/.exec(path);
    return m && !label.includes(`${m[1]}p`) ? `${label} ${m[1]}p` : label;
}

async function hlsExpand(client, url, label, headers) {
    const one = [{ url, originalUrl: url, quality: withRes(label, url), headers }];
    if (!url.includes(".m3u8")) return one;
    let body = "";
    try {
        const res = await client.get(url, headers);
        if (Number(res.statusCode) >= 400) return one;
        body = String(res.body || "").replace(/\r/g, "");
    } catch (e) {
        return one;
    }
    const seen = {};
    const variants = [];
    const re = /#EXT-X-STREAM-INF:([^\n]*)\n\s*([^\s#][^\n]*)/g;
    let m;
    while ((m = re.exec(body))) {
        const h = /RESOLUTION=\d+x(\d+)/.exec(m[1]);
        if (!h || seen[h[1]]) continue;
        seen[h[1]] = true;
        let u = m[2].trim();
        if (!/^https?:\/\//.test(u)) {
            u = u.startsWith("/") ? (/^(https?:\/\/[^/]+)/.exec(url) || [null, ""])[1] + u : url.replace(/[^/]*(?:\?.*)?$/, "") + u;
        }
        variants.push({ h: Number(h[1]), u });
    }
    if (variants.length === 1) return [{ url, originalUrl: url, quality: `${label} ${variants[0].h}p`, headers }];
    if (variants.length < 2) return one;
    variants.sort((a, b) => b.h - a.h);
    return [{ url, originalUrl: url, quality: `${label} 자동 (최대 ${variants[0].h}p)`, headers }]
        .concat(variants.map((v) => ({ url: v.u, originalUrl: v.u, quality: `${label} ${v.h}p`, headers })));
}

// 설정의 선호 화질을 맨 앞으로
function qualitySort(prefKey, list) {
    let want = "자동";
    try {
        const v = new SharedPreferences().get(prefKey);
        want = QUALITY_CHOICES[Number(v)] || (QUALITY_CHOICES.includes(v) ? v : "자동");
    } catch (e) {
        want = "자동";
    }
    const hit = (x) => x.quality.endsWith(` ${want}`) || x.quality.includes(` ${want} `);
    return list.filter(hit).concat(list.filter((x) => !hit(x)));
}

function qualityPreference(key) {
    return {
        key,
        listPreference: {
            title: "선호 화질",
            summary: "영상이 여러 화질을 제공할 때 이 화질을 먼저 재생합니다.",
            valueIndex: 0,
            entries: QUALITY_CHOICES,
            entryValues: QUALITY_CHOICES,
        },
    };
}

// ---------- 인기/최신 탭 규칙 (필터 조건을 탭에 저장) ----------
const RULE_CHOICES = [
    "저장하지 않음 (필터 결과만 보기)",
    "현재 조건을 인기 탭에 저장",
    "현재 조건을 최신 탭에 저장",
    "인기 탭을 기본값으로 복원",
    "최신 탭을 기본값으로 복원",
    "두 탭 모두 기본값으로 복원",
];
const RULE_NAME = "인기/최신 탭 규칙";

// 저장 값은 필터 선택 번호를 쉼표로 이은 문자열. 없거나 맞지 않으면 null (= 기본값)
function ruleRead(prefix, popular, sizes) {
    let raw = "";
    try {
        raw = new SharedPreferences().getString(`${prefix}_${popular ? "pop" : "latest"}_rule`, "") || "";
    } catch (e) {
        return null;
    }
    if (!raw) return null;
    const idx = raw.split(",").map((x) => parseInt(x, 10));
    if (idx.length !== sizes.length || idx.some((v, i) => !(v >= 0 && v < sizes[i]))) return null;
    return idx;
}

function ruleApply(prefix, rule, idx) {
    try {
        const p = new SharedPreferences();
        const pop = `${prefix}_pop_rule`;
        const latest = `${prefix}_latest_rule`;
        const v = idx.join(",");
        if (rule === 1) p.setString(pop, v);
        else if (rule === 2) p.setString(latest, v);
        else if (rule === 3) p.setString(pop, "");
        else if (rule === 4) p.setString(latest, "");
        else if (rule === 5) {
            p.setString(pop, "");
            p.setString(latest, "");
        }
    } catch (e) {
        // 저장 실패는 무시 (필터 결과는 그대로 보여 줌)
    }
}

function ruleFilters(prefix, sizes, defaults, text) {
    const pop = ruleRead(prefix, true, sizes);
    const latest = ruleRead(prefix, false, sizes);
    return [
        { type_name: "SeparatorFilter" },
        { type_name: "HeaderFilter", name: `현재 인기: ${pop ? text(pop) : defaults[0] + " (기본)"}` },
        { type_name: "HeaderFilter", name: `현재 최신: ${latest ? text(latest) : defaults[1] + " (기본)"}` },
        {
            type_name: "SelectFilter", name: RULE_NAME, param: "rule", state: 0,
            values: RULE_CHOICES.map((c, i) => ({ type_name: "SelectOption", name: c, value: String(i) })),
        },
    ];
}

// ---------- 앱 기본 User-Agent 사용 ----------
// 망가요미는 내장 웹뷰에서 Cloudflare 확인을 통과하면 쿠키와 그 웹뷰의 User-Agent 를 함께 저장하고,
// 요청에 User-Agent 가 없을 때만 그 값을 넣는다. 확장이 고정 User-Agent 를 보내면 통과 쿠키가 거부되므로
// 사이트(문서·API) 요청에서는 확장의 User-Agent 를 빼고 앱 값을 쓰게 한다. 영상·이미지 주소 요청은 그대로 둔다.
// 망가요미 변형 앱(Mangayomi Glitch 등)은 User-Agent 를 넣어 주지 않아, 빼고 보내면 사이트가 연결을 끊거나 403 을 줌
// → 그런 응답이면 User-Agent 를 넣어 다시 보내고, 그 뒤로는 처음부터 넣음 (원래 망가요미는 첫 요청이 성공해 그대로)
let APP_NO_UA = false;
let APP_ALT = null;
function appClient(raw) {
    const media = /\.(?:m3u8|mp4|ts|m4s|jpe?g|png|webp|gif|avif)(?:[?#]|$)/i;
    const fallbackUa = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
    const strip = (url, headers) => {
        if (!headers || media.test(String(url || ""))) return headers || {};
        const out = {};
        for (const k in headers) if (k.toLowerCase() !== "user-agent") out[k] = headers[k];
        return out;
    };
    const withUa = (headers) => {
        const out = Object.assign({}, headers || {});
        if (!Object.keys(out).some((k) => k.toLowerCase() === "user-agent")) out["User-Agent"] = fallbackUa;
        return out;
    };
    // 망가요미 기본 통신이 끊기면 연결을 재사용하지 않는 별도 통신으로 한 번 더 (애니24에서 효과 확인, DC 확장과 같은 방법)
    const alt = () => {
        if (!APP_ALT) {
            try {
                APP_ALT = new Client({ persistentConnection: false, noProxy: true, timeout: 25, connectTimeout: 10 });
            } catch (e) {
                APP_ALT = null;
            }
        }
        return APP_ALT;
    };
    const send = async (call, url, headers) => {
        if (APP_NO_UA || media.test(String(url || ""))) {
            try {
                return await call(raw, url, APP_NO_UA ? withUa(headers) : headers || {});
            } catch (e) {
                const c = alt();
                if (!c) throw e;
                return call(c, url, withUa(headers));
            }
        }
        let res;
        try {
            res = await call(raw, url, strip(url, headers));
        } catch (e) {
            res = null;
            try {
                const again = await call(raw, url, withUa(headers));
                APP_NO_UA = true;
                return again;
            } catch (e2) {
                const c = alt();
                if (!c) throw e;
                try {
                    return await call(c, url, withUa(headers));
                } catch (e3) {
                    throw e;
                }
            }
        }
        if (res && res.statusCode === 403) {
            try {
                const again = await call(raw, url, withUa(headers));
                if (again && again.statusCode && again.statusCode < 400) {
                    APP_NO_UA = true;
                    return again;
                }
            } catch (e) {}
        }
        return res;
    };
    return {
        get: (url, headers) => send((c, u, h) => c.get(u, h), url, headers),
        post: (url, headers, body) => send((c, u, h) => c.post(u, h, body), url, headers),
    };
}



// 망가요미 재생기는 재생용 주소(originalUrl) 모양으로 HLS 를 알아봄 → 확장자가 .m3u8 이 아닌 HLS 주소(.txt·jmp2 등)는
// 끝에 "#download.m3u8" 를 붙여 알려 줌. # 뒤는 서버로 보내지지 않아 실제 요청은 그대로 (애니24에서 효과 확인)

function hlsHint(list) {
    for (const v of list || []) {
        if (!v || !v.url) continue;
        const plain = String(v.url).replace(/#.*$/, "");
        const path = plain.split("?")[0];
        // 확장자 없는 주소 중 HLS 로 보이는 것만 (mp4 등 다른 영상에 붙이면 재생이 안 됨)
        const hlsLike = /\.txt$|\/hls\/|\/m3\/|master|playlist|jmp2\.uk\/stvp-/i.test(path);
        if (/^https?:\/\//.test(plain) && hlsLike && !/\.(?:m3u8?|mp4|mkv|webm|mov|m4v|ts|flv|avi|mp3|aac)$/i.test(path)) v.originalUrl = plain + "#download.m3u8";
    }
    return list;
}

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = appClient(new Client());
    }

    pref(key) {
        try {
            return String(new SharedPreferences().get(key) || "").trim();
        } catch (e) {
            return "";
        }
    }

    // 주소: 설정에 직접 넣은 주소 → 검색창 붙여 넣기·자동 찾기로 바꾼 주소 → 기본 주소
    getBaseUrl() {
        const v = this.pref("avflix_domain").replace(/\/+$/, "");
        if (DOMAIN_RE.test(v)) return v;
        let auto = "";
        try {
            auto = String(new SharedPreferences().getString("avflix_auto_domain", "") || "").trim();
        } catch (e) {
            auto = "";
        }
        return DOMAIN_RE.test(auto) ? auto : DEFAULT_BASE_URL;
    }

    saveAuto(origin) {
        try {
            new SharedPreferences().setString("avflix_auto_domain", origin);
        } catch (e) {
            // 저장 실패 시 이번만
        }
    }

    // 그림·영상 모두 사이트 Referer 가 있어야 열림
    getHeaders(url) {
        return { "Referer": `${this.getBaseUrl()}/` };
    }

    /** 진짜 AVFLIX 화면인지 (새 화면의 renewal-bootstrap 안 사이트 코드 avflix) */
    async isSite(origin) {
        try {
            const res = await this.client.get(`${origin}/`, { "Referer": `${origin}/` });
            const body = String(res.body || "");
            return res.statusCode < 400 && /\\?"code\\?":\\?"avflix\\?"/.test(body);
        } catch (e) {
            return false;
        }
    }

    /** 지금 주소가 안 열릴 때: 앞 글자 번호 +1~+5, -1~-2 (kr7 → kr8 …) */
    async discover() {
        const m = /^https:\/\/([a-z]+)(\d+)\.(avflix\.[a-z]{2,8})$/.exec(this.getBaseUrl());
        if (!m) return null;
        const n = Number(m[2]);
        for (const d of [1, 2, 3, 4, 5, -1, -2]) {
            if (n + d < 1) continue;
            const c = `https://${m[1]}${n + d}.${m[3]}`;
            if (await this.isSite(c)) {
                this.saveAuto(c);
                return c;
            }
        }
        return null;
    }

    /** 사이트 자료 (/api/v1/…) → data */
    async api(path, retried) {
        await siteWait();
        const base = this.getBaseUrl();
        let res = null;
        let err = "";
        try {
            res = await this.client.get(`${base}/api${path}`, { "Referer": `${base}/`, "Accept": "application/json" });
        } catch (e) {
            err = String((e && e.message) || e).substring(0, 80);
        }
        // 연결 실패·5xx 면 주소가 바뀐 것일 수 있음 (403 은 해외·차단이라 주소 찾기 안 함)
        if ((!res || res.statusCode >= 500) && !retried) {
            const found = await this.discover();
            if (found) return this.api(path, true);
        }
        if (!res) throw new Error(`AVFLIX 접속 실패: ${err}. 주소가 바뀌었으면 새 사이트 주소를 검색창에 붙여 넣어 주세요.`);
        let j = null;
        try {
            j = JSON.parse(String(res.body || ""));
        } catch (e) {
            j = null;
        }
        if (res.statusCode >= 400 || !j || j.status === "FAILURE" || j.error) {
            const msg = String((j && (j.message || j.error)) || String(res.body || "").replace(/\s+/g, " ").substring(0, 40));
            throw new Error(`AVFLIX 자료를 못 받았어요 [${path.split("?")[0]} · HTTP ${res.statusCode} · ${msg.substring(0, 50)}]`);
        }
        return j.data !== undefined ? j.data : j;
    }

    card(o) {
        const tags = [o.subtitle ? "자막" : "", o.mosaic === false ? "노모" : ""].filter((x) => x);
        // 출시일·등록일을 주소 끝 # 뒤에 실어 작품 정보로 넘김 (서버로는 안 감)
        const date = String(o.releaseDate || o.regDate || "").substring(0, 10);
        const title = String(o.title || o.productNo || "").trim();
        return {
            name: title + (tags.length && !/REMOVE|자막/.test(title) ? ` [${tags.join("·")}]` : ""),
            imageUrl: o.thumbnail || "",
            link: `${this.getBaseUrl()}/av/${o.idx}` + (date ? `#d=${date}` : ""),
        };
    }

    page(data) {
        const list = ((data && data.list) || []).filter((o) => o && o.idx).map((o) => this.card(o));
        const pg = (data && data.paging) || {};
        return { list, hasNextPage: list.length > 0 && Number(pg.pageNo || 0) < Number(pg.finalPageNo || 0) };
    }

    query(idx, page, keyword) {
        const p = [`sort=${SORTS[idx[1]][1]}`, `subtitle=${SUBS[idx[2]][1]}`, `mosaic=${MOSAICS[idx[3]][1]}`, `pageNo=${page}`, "pageSize=31"];
        if (keyword !== undefined) p.push(`keyword=${encodeURIComponent(keyword)}`);
        return p.join("&");
    }

    async listing(idx, page) {
        const code = CATS[idx[0]][1];
        if (code) return this.page(await this.api(`/v1/av/category/${encodeURIComponent(code)}?${this.query(idx, page)}`));
        return this.page(await this.api(`/v1/av/search?${this.query(idx, page, "")}`));
    }

    async getPopular(page) {
        await notesRefresh(this.client);
        return this.listing(ruleRead("avflix", true, RULE_SIZES) || DEFAULT_POPULAR, page);
    }

    get supportsLatest() {
        return true;
    }

    async getLatestUpdates(page) {
        return this.listing(ruleRead("avflix", false, RULE_SIZES) || DEFAULT_LATEST, page);
    }

    async search(query, page, filters) {
        const q = String(query || "").trim();
        // 사이트 주소(https:// 없어도) 붙여 넣기: 진짜 사이트면 그 주소로 바꿈. 작품이면 그 작품, 분류·검색이면 그 목록, 주소만이면 인기 목록
        const site = /^(?:https?:\/\/)?((?:[a-z]+\d*\.)?avflix\.[a-z]{2,8})(\/[^\s]*)?$/i.exec(q);
        if (site) {
            const origin = `https://${site[1].toLowerCase()}`;
            if (origin !== this.getBaseUrl()) {
                if (!(await this.isSite(origin))) throw new Error(`${site[1]} 는 AVFLIX 화면이 아니에요. 주소를 다시 확인해 주세요.`);
                this.saveAuto(origin);
            }
            const path = (site[2] || "/").split("?")[0].split("#")[0];
            const av = /^\/av\/(\d+)/.exec(path);
            if (av) {
                if (page > 1) return { list: [], hasNextPage: false };
                const url = `${this.getBaseUrl()}/av/${av[1]}`;
                const d = await this.getDetail(url);
                return { list: [{ name: d.name, imageUrl: d.imageUrl, link: url }], hasNextPage: false };
            }
            const cat = /^\/category\/([^/?#]+)/.exec(path);
            if (cat) {
                let code = cat[1];
                try {
                    code = decodeURIComponent(code);
                } catch (e) {
                    // 그대로
                }
                if (BLOCKED_CATS.test(code)) throw new Error("이 분류는 확장에서 열지 않아요.");
                return this.page(await this.api(`/v1/av/category/${encodeURIComponent(code)}?${this.query([0, 0, 0, 0], page)}`));
            }
            const kw = /^\/search\/([^/?#]+)/.exec(path);
            if (kw) {
                let k = kw[1];
                try {
                    k = decodeURIComponent(k);
                } catch (e) {
                    // 그대로
                }
                return this.page(await this.api(`/v1/av/search?${this.query([0, 0, 0, 0], page, k === "전체" ? "" : k)}`));
            }
            return this.getPopular(page);
        }
        const idx = [0, 0, 0, 0];
        let rule = 0;
        for (const f of filters || []) {
            if (!f || f.type_name !== "SelectFilter") continue;
            const k = FILTER_DEFS.findIndex((d) => d[0] === f.name);
            if (k >= 0) idx[k] = Math.min(Math.max(Number(f.state) || 0, 0), RULE_SIZES[k] - 1);
            else if (f.name === RULE_NAME) rule = Number(f.state) || 0;
        }
        if (q) return this.page(await this.api(`/v1/av/search?${this.query(idx, page, q)}`));
        if (rule) ruleApply("avflix", rule, idx);
        return this.listing(idx, page);
    }

    async detail(url) {
        const id = (/\/av\/(\d+)/.exec(url) || [])[1];
        if (!id) throw new Error("작품 주소가 아니에요");
        return this.api(`/v1/av/${id}`);
    }

    async getDetail(url) {
        const clean = url.split("#")[0];
        const d = await this.detail(clean);
        const date = (/#d=(\d{4}-\d{2}-\d{2})/.exec(url) || [])[1] || String(d.releaseDate || d.regDate || "").substring(0, 10);
        const m = /(\d{4})-(\d{2})-(\d{2})/.exec(date);
        const ms = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - 9 * 3600000 : 0;
        const cast = (d.actors || []).join(", ");
        const maker = (d.productions || []).join(", ");
        const cats = (d.categories || []).map((c) => (c && c.name) || "").filter((x) => x);
        const secs = Number(d.duration) || 0;
        const length = secs > 0 ? (secs >= 3600 ? `${Math.floor(secs / 3600)}시간 ${Math.floor((secs % 3600) / 60)}분` : `${Math.round(secs / 60)}분`) : "";
        const name = String(d.title || d.productNo || "").trim();
        const info = [
            length ? `길이 ${length}` : "",
            ms ? `출시일 ${ymd(ms)}` : "",
            cast ? `출연 ${cast}` : "",
            maker ? `제작사 ${maker}` : "",
        ].filter((x) => x).join(" · ");
        return {
            name: ms && name && !/\(\d{4}\)$/.test(name) ? `${name} (${m[1]})` : name,
            imageUrl: d.thumbnail || d.heroImage || "",
            author: maker,
            artist: cast,
            genre: cats,
            status: 1,
            description: `${d.subtitle ? "💬 한글 자막 있음\n" : ""}${info}\n\n${String(d.story || "").trim()}`.trim(),
            link: url,
            episodes: [{ name: ms ? `1 재생 (${ymd(ms)})` : "1 재생", url: clean, dateUpload: String(ms || Date.now()), scanlator: d.subtitle ? "한글자막" : "" }],
        };
    }

    // ================= 재생 =================
    async getVideoList(url) {
        url = url.split("#")[0];
        const d = await this.detail(url);
        const base = this.getBaseUrl();
        let v = String(d.contentUrl || "").trim();
        if (!v) throw new Error("재생할 수 있는 영상이 없어요 [작품 자료에 contentUrl 없음 · 로그인이 필요한 작품일 수 있어요]");
        if (!/^https?:\/\//.test(v)) v = base + (v.startsWith("/") ? "" : "/") + v;
        const headers = { "Referer": `${base}/`, "Origin": base };
        const out = [];
        if (/\.m3u8/.test(v)) out.push(...await hlsExpand(this.client, v, LABEL, headers));
        else out.push({ url: v, originalUrl: v, quality: withRes(LABEL, v), headers });
        // CDN 이 막히면 사이트 중계 주소 (사이트 플레이어도 같은 방법으로 다시 시도)
        if (!v.startsWith(base) && !/\.m3u8/.test(v)) {
            const ext = (/\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(v.split("?")[0]) || [null, "mp4"])[1].toLowerCase();
            const p = `${base}/videos/${b64url(v)}.${ext}`;
            out.push({ url: p, originalUrl: p, quality: `${LABEL} (사이트 중계)`, headers });
        }
        return hlsHint(qualitySort("avflix_quality", out));
    }

    // ================= 필터 · 설정 =================
    getFilterList() {
        return [
            { type_name: "HeaderFilter", name: `📡 주소: ${this.getBaseUrl().replace(/^https?:\/\//, "")}` },
            ...notesFilters("avflix"),
            { type_name: "HeaderFilter", name: "검색창에 사이트 주소를 붙여 넣으면 그 주소로 바꾸고, 작품·분류 주소면 그 화면을 열어요" },
            { type_name: "SeparatorFilter" },
            { type_name: "HeaderFilter", name: "검색어가 있으면 분류는 무시 (정렬·자막·모자이크는 적용)" },
        ].concat(FILTER_DEFS.map(([name, values]) => ({
            type_name: "SelectFilter", name, state: 0,
            values: values.map((v, j) => ({ type_name: "SelectOption", name: v[0], value: String(j) })),
        })), ruleFilters("avflix", RULE_SIZES, [ruleText(DEFAULT_POPULAR), ruleText(DEFAULT_LATEST)], ruleText),
        [0, 1, 2].map(() => ({ type_name: "HeaderFilter", name: "　" })));
    }

    getSourcePreferences() {
        return [{
            key: "avflix_domain",
            editTextPreference: {
                title: "사이트 주소 직접 지정 (선택)",
                summary: "비워 두면 https://kr7.avflix.co (안 열리면 kr8·kr9… 를 자동으로 찾아요)",
                value: "",
                dialogTitle: "사이트 주소",
                dialogMessage: "https:// 로 시작하는 주소 (또는 검색창에 붙여 넣기)",
            },
        }, qualityPreference("avflix_quality")];
    }
}

// ---------- 업데이트 내역 (필터 맨 위 📝 줄) ----------
// 저장소의 changelog.json 을 1시간에 한 번 받아 두었다가 그 소스의 최근 3개를 보여 줌 (필터 화면을 열 때 기다리지 않음)
const NOTES_URL = "https://raw.githubusercontent.com/insid0909-max/my-ext/main/changelog.json";

async function notesRefresh(client) {
    let p;
    try {
        p = new SharedPreferences();
    } catch (e) {
        return;
    }
    const last = Number(p.getString("notes_at", "0")) || 0;
    if (Date.now() - last < 60 * 60000) return;
    p.setString("notes_at", String(Date.now()));
    try {
        const r = await client.get(NOTES_URL, {});
        const body = String(r.body || "");
        if (r.statusCode === 200 && body.trim().startsWith("{")) p.setString("notes_json", body);
    } catch (e) {
        // 다음 기회에 다시 받음
    }
}

function notesFilters(key) {
    let list = [];
    try {
        list = (JSON.parse(new SharedPreferences().getString("notes_json", "") || "{}").items || {})[key] || [];
    } catch (e) {
        list = [];
    }
    return list.filter((n) => n && n.t).slice(0, 3)
        .map((n) => ({ type_name: "HeaderFilter", name: `📝 ${String(n.d || "").substring(5).replace("-", ".")} ${n.t}`, _status: true }));
}
