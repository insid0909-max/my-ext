const mangayomiSources = [{
    "name": "MissAV",
    "lang": "ko",
    "baseUrl": "https://missav123.com",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/insid0909-max/my-ext/main/icon.png",
    "typeSource": "single",
    "itemType": 1,
    "isNsfw": true,
    "hasCloudflare": true,
    "version": "0.0.4",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "anime/missav.js"
}];

// 개인용 MissAV 소스 (첫 버전: 사이트 구조를 직접 확인하지 못한 채 짐작해 만듦)
// - 사이트가 Cloudflare 확인을 쓰므로 앱 웹뷰에서 한 번 직접 통과해야 함 (확장은 확인을 건너뛰지 않음)
// - 사이트 요청엔 User-Agent 를 넣지 않음 → 앱이 웹뷰와 같은 UA 를 넣어 줘서 웹뷰에서 받은 통과 쿠키가 맞음
// - 재생: 작품 화면을 웹뷰로 그대로 열고, 화면 안 플레이어가 불러온 m3u8 주소를 받음 (사이트 코드는 풀지 않음)
// - 설정은 반드시 try 안에서 읽음 (설치 때 getHeaders·getFilterList 가 불리며, 설정 읽기 오류면 설치가 조용히 멈춤)
const DEFAULT_BASE_URL = "https://missav123.com";
const DEFAULT_LIST = "https://missav123.com/dm270/ko";
const DOMAIN_RE = /^https:\/\/(?:www\.)?missav[a-z0-9]*\.[a-z]{2,6}$/;
const SITE_RE = /^https?:\/\/(?:www\.)?missav[a-z0-9]*\.[a-z]{2,6}/;
// 작품 주소: /ko/abc-123, /dm270/ko/abc-123, /ko/fc2-ppv-1234567 (목록·분류 주소는 제외)
const POST_RE = /^https?:\/\/[^/]+\/(?:dm\d+\/)?ko\/[a-z0-9][a-z0-9_-]*\d[a-z0-9_-]*\/?$/i;

// 분류 (사이트 메뉴 그대로, 2026-10-28 메뉴 기준). 0번은 설정의 목록 주소
const CATS = [
    ["설정의 목록", ""],
    ["최근 업데이트", "/dm539/ko/new"], ["새로운 출시", "/dm635/ko/release"], ["무수정 누출", "/dm817/ko/uncensored-leak"],
    ["오늘 가장 많이 본", "/dm301/ko/today-hot"], ["주별로 가장 많이 본", "/dm170/ko/weekly-hot"],
    ["월별 가장 많이 본", "/dm273/ko/monthly-hot"], ["영어 자막", "/dm23/ko/english-subtitle"], ["VR", "/ko/genres/VR"],
    ["아마추어 · SIRO", "/dm36/ko/siro"], ["아마추어 · LUXU", "/dm34/ko/luxu"], ["아마추어 · GANA", "/dm34/ko/gana"],
    ["아마추어 · PRESTIGE PREMIUM", "/dm1004/ko/maan"], ["아마추어 · S-CUTE", "/dm38/ko/scute"], ["아마추어 · ARA", "/dm34/ko/ara"],
    ["일본노모 · FC2", "/dm597/ko/fc2"], ["일본노모 · HEYZO", "/dm2208642/ko/heyzo"], ["일본노모 · Tokyo Hot", "/dm42/ko/tokyohot"],
    ["일본노모 · 1pondo", "/dm4551174/ko/1pondo"], ["일본노모 · Caribbeancom", "/dm6840521/ko/caribbeancom"],
    ["일본노모 · Caribbeancompr", "/dm91887/ko/caribbeancompr"], ["일본노모 · 10musume", "/dm6238682/ko/10musume"],
    ["일본노모 · pacopacomama", "/dm3600557/ko/pacopacomama"], ["일본노모 · Gachinco", "/dm150/ko/gachinco"],
    ["일본노모 · XXX-AV", "/dm42/ko/xxxav"], ["일본노모 · 유부녀 베기", "/dm37/ko/marriedslash"],
    ["일본노모 · 야한 4610", "/dm33/ko/naughty4610"], ["일본노모 · 야한 0930", "/dm37/ko/naughty0930"],
    ["아시아 · Madou", "/dm63/ko/madou"], ["아시아 · TWAV", "/dm31/ko/twav"], ["아시아 · Furuke", "/dm15/ko/furuke"],
    ["아시아 · 코리안 라이브", "/ko/klive"], ["아시아 · 중국어 라이브", "/ko/clive"],
];

// 정렬 (사이트 주소의 sort= 값). 0번은 목록 그대로
const SORTS = [
    ["목록 그대로", ""], ["최근 업데이트", "published_at"], ["발매일", "released_at"], ["저장 많은 순", "saved"],
    ["오늘 조회", "today_views"], ["주간 조회", "weekly_views"], ["월간 조회", "monthly_views"], ["전체 조회", "views"],
];

function first(el, css) {
    const l = el ? el.select(css) : [];
    return l && l.length ? l[0] : null;
}

function imgOf(el) {
    if (!el) return "";
    for (const a of ["data-src", "data-original", "data-lazy-src", "src"]) {
        const v = String(el.attr(a) || "").trim();
        if (v && !v.startsWith("data:")) return v;
    }
    return "";
}

function abs(base, href) {
    href = String(href || "").trim();
    if (!href) return "";
    if (href.startsWith("//")) return "https:" + href;
    if (/^https?:\/\//.test(href)) return href;
    return base + (href.startsWith("/") ? "" : "/") + href;
}

/** 목록 주소에 쪽 번호 넣기 (?page=N) */
function pageUrl(listUrl, page) {
    const u = String(listUrl).replace(/([?&])page=\d+&?/, "$1").replace(/[?&]$/, "");
    if (page <= 1) return u;
    return u + (u.indexOf("?") >= 0 ? "&" : "?") + "page=" + page;
}

function setParam(url, key, value) {
    const re = new RegExp(`([?&])${key}=[^&]*`);
    if (re.test(url)) return url.replace(re, `$1${key}=${value}`);
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + `${key}=${value}`;
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

const RULE_SIZES = [CATS.length, SORTS.length];
const DEFAULT_POPULAR = [0, 0];
const DEFAULT_LATEST = [0, 1];

function ruleText(i) {
    return [CATS[i[0]][0], i[1] > 0 ? SORTS[i[1]][0] : null].filter((x) => x).join(" · ");
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

    // 주소: 설정에 직접 넣은 주소 → 검색창에 붙여 넣어 바꾼 주소 → 기본 주소
    getBaseUrl() {
        const v = this.pref("missav_domain").replace(/\/+$/, "");
        if (DOMAIN_RE.test(v)) return v;
        let auto = "";
        try {
            auto = String(new SharedPreferences().getString("missav_auto_domain", "") || "").trim();
        } catch (e) {
            auto = "";
        }
        return DOMAIN_RE.test(auto) ? auto : DEFAULT_BASE_URL;
    }

    /** 검색창에 붙여 넣은 새 사이트 주소를 확인해서 적용 (MissAV 화면이거나 Cloudflare 확인 화면이면 인정) */
    async adoptDomain(origin) {
        if (!DOMAIN_RE.test(origin) || origin === this.getBaseUrl()) return;
        let ok = false;
        try {
            const res = await this.client.get(`${origin}/ko`, { "Referer": `${origin}/` });
            const body = String(res.body || "");
            ok = /MISS<\/span>|MissAV/i.test(body) || /Just a moment|challenge-platform/i.test(body.substring(0, 3000));
        } catch (e) {
            ok = false;
        }
        if (!ok) throw new Error(`${origin.replace(/^https:\/\//, "")} 는 MissAV 화면이 아니에요. 주소를 다시 확인해 주세요.`);
        try {
            new SharedPreferences().setString("missav_auto_domain", origin);
        } catch (e) {
            // 저장 실패 시 이번만 그 주소로
        }
    }

    listUrl() {
        let v = this.pref("missav_list");
        if (!/^https?:\/\//.test(v)) v = DEFAULT_LIST;
        return v.replace(SITE_RE, this.getBaseUrl());
    }

    getHeaders(url) {
        const origin = (/^https?:\/\/[^/]+/.exec(String(url || "")) || [DEFAULT_BASE_URL])[0];
        return { "Referer": `${origin}/` };
    }

    async get(url) {
        let res;
        await siteWait();
        try {
            res = await this.client.get(url, this.getHeaders(this.getBaseUrl()));
        } catch (e) {
            throw new Error(`MissAV 접속 실패: ${String((e && e.message) || e).substring(0, 80)}`);
        }
        const body = String(res.body || "");
        if (res.statusCode === 403 || res.statusCode === 503 || /Just a moment|cf-chl|challenge-platform/i.test(body.substring(0, 3000))) {
            throw new Error("Cloudflare 확인이 필요해요. 오른쪽 위 지구본(웹뷰)으로 사이트를 한 번 열어 확인을 통과한 뒤 다시 시도해 주세요.");
        }
        if (res.statusCode >= 400) {
            throw new Error(`MissAV 접속 실패 (HTTP ${res.statusCode}). 주소가 바뀌었으면 새 사이트 주소(예: missav.live)를 검색창에 붙여 넣어 주세요.`);
        }
        return body;
    }

    parseList(html, page) {
        const base = this.getBaseUrl();
        const doc = new Document(html);
        const byLink = {};
        const list = [];
        for (const a of doc.select("a[href]")) {
            const link = abs(base, a.attr("href")).split("#")[0].split("?")[0].replace(/\/+$/, "");
            if (!POST_RE.test(link)) continue;
            const img = first(a, "img");
            const text = String(a.text || "").trim();
            let item = byLink[link];
            if (!item) {
                item = { name: "", imageUrl: "", link };
                byLink[link] = item;
                list.push(item);
            }
            // 카드 하나에 그림 링크와 제목 링크가 따로 있음 → 합침
            if (img && !item.imageUrl) item.imageUrl = abs(base, imgOf(img));
            // 제목은 가장 긴 글자 (그림 alt 는 품번만일 때가 많음)
            const cand = String(a.attr("title") || "").trim() || (text.length > 3 ? text : "") || (img ? String(img.attr("alt") || "").trim() : "");
            if (cand.length > item.name.length) item.name = cand;
        }
        const out = list.filter((x) => x.imageUrl).map((x) => ({
            name: x.name || x.link.split("/").pop().toUpperCase(),
            imageUrl: x.imageUrl,
            link: x.link,
        }));
        const next = html.indexOf(`page=${page + 1}`) >= 0 || doc.select("a[rel=next]").length > 0;
        return { list: out, hasNextPage: out.length > 0 && next };
    }

    /** 분류·정렬 번호로 목록 주소 */
    listByRule(idx, page) {
        let url = idx[0] > 0 ? this.getBaseUrl() + CATS[idx[0]][1] : this.listUrl();
        if (idx[1] > 0) url = setParam(url, "sort", SORTS[idx[1]][1]);
        return pageUrl(url, page);
    }

    async getPopular(page) {
        await notesRefresh(this.client);
        return this.parseList(await this.get(this.listByRule(ruleRead("missav", true, RULE_SIZES) || DEFAULT_POPULAR, page)), page);
    }

    get supportsLatest() {
        return true;
    }

    async getLatestUpdates(page) {
        return this.parseList(await this.get(this.listByRule(ruleRead("missav", false, RULE_SIZES) || DEFAULT_LATEST, page)), page);
    }

    async search(query, page, filters) {
        const q = String(query || "").trim();
        const base = this.getBaseUrl();
        // 사이트 주소를 붙여 넣으면: 작품이면 그 작품, 목록이면 그 목록
        // 사이트 주소만(https:// 없어도) 붙여 넣으면 그 주소로 바꾸고 인기 목록, 작품·목록 주소면 그 화면
        const site = /^(?:https?:\/\/)?((?:www\.)?missav[a-z0-9]*\.[a-z]{2,6})(\/.*)?$/i.exec(q);
        if (site) {
            await this.adoptDomain(`https://${site[1].toLowerCase()}`);
            if (!site[2] || /^\/(?:dm\d+\/)?(?:[a-z]{2}\/?)?$/.test(site[2])) return this.getPopular(page);
        }
        if (/^(?:https?:\/\/)?(?:www\.)?missav[a-z0-9]*\.[a-z]{2,6}\//i.test(q)) {
            const url = (/^https?:\/\//.test(q) ? q : "https://" + q).replace(SITE_RE, this.getBaseUrl());
            if (POST_RE.test(url)) {
                if (page > 1) return { list: [], hasNextPage: false };
                const d = await this.getDetail(url);
                return { list: [{ name: d.name, imageUrl: d.imageUrl, link: url }], hasNextPage: false };
            }
            return this.parseList(await this.get(pageUrl(url, page)), page);
        }
        const idx = [0, 0];
        let rule = 0;
        for (const f of filters || []) {
            if (!f) continue;
            if (f.name === "분류") idx[0] = Math.min(Math.max(Number(f.state) || 0, 0), CATS.length - 1);
            if (f.name === "정렬") idx[1] = Math.min(Math.max(Number(f.state) || 0, 0), SORTS.length - 1);
            if (f.name === RULE_NAME) rule = Number(f.state) || 0;
        }
        if (q) {
            let url = `${base}/ko/search/${encodeURIComponent(q)}`;
            if (idx[1] > 0) url = setParam(url, "sort", SORTS[idx[1]][1]);
            return this.parseList(await this.get(pageUrl(url, page)), page);
        }
        if (rule) ruleApply("missav", rule, idx);
        return this.parseList(await this.get(this.listByRule(idx, page)), page);
    }

    async getDetail(url) {
        const html = await this.get(url);
        const doc = new Document(html);
        const meta = (p) => {
            const m = first(doc, `meta[property="${p}"]`) || first(doc, `meta[name="${p}"]`);
            return m ? String(m.attr("content") || "").trim() : "";
        };
        const h1 = first(doc, "h1");
        const name = (h1 ? String(h1.text || "").trim() : "") || meta("og:title");
        const imageUrl = meta("og:image");
        const genre = [];
        for (const a of doc.select("a[href*='/genres/'], a[href*='/actresses/'], a[href*='/makers/']")) {
            const t = String(a.text || "").trim();
            if (t && t.length < 40 && genre.indexOf(t) < 0) genre.push(t);
        }
        // 출시일: time[datetime] 또는 "출시일/발매일/Release date" 옆의 yyyy-MM-dd
        let date = "";
        const t = first(doc, "time[datetime]");
        if (t) date = (/(\d{4}-\d{2}-\d{2})/.exec(String(t.attr("datetime") || "")) || [])[1] || "";
        if (!date) date = (/(?:출시일|발매일|Release date)[^0-9]{0,80}(\d{4}-\d{2}-\d{2})/i.exec(html) || [])[1] || "";
        const m = /(\d{4})-(\d{2})-(\d{2})/.exec(date);
        const ms = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - 9 * 3600000 : 0;
        const desc = meta("og:description") || meta("description");
        return {
            name: ms && name && !/\(\d{4}\)$/.test(name) ? `${name} (${m[1]})` : name,
            imageUrl, genre, status: 1, link: url,
            description: (ms ? `출시일: ${ymd(ms)}\n\n` : "") + desc,
            episodes: [{ name: ms ? `1 재생 (${ymd(ms)})` : "1 재생", url, dateUpload: String(ms || Date.now()) }],
        };
    }

    // ================= 재생 =================
    async getVideoList(url) {
        if (typeof evaluateJavascriptViaWebview !== "function") throw new Error("이 망가요미 버전은 웹뷰 재생을 지원하지 않아요.");
        // 작품 화면을 그대로 열고, 화면 안 플레이어가 불러온 m3u8 을 모음 (재생이 안 시작되면 음소거 재생·재생 버튼 누르기)
        const script = "(function(){var n=0;function found(){var r=performance.getEntriesByType('resource'),o=[];" +
            "for(var i=0;i<r.length;i++){if(/\\.m3u8(\\?|$)/.test(r[i].name)&&o.indexOf(r[i].name)<0)o.push(r[i].name);}" +
            "var v=document.querySelector('video');var s=v&&(v.currentSrc||v.src||v.getAttribute('src'));" +
            "if(s&&/^https?:/.test(s)&&o.indexOf(s)<0)o.push(s);return o;}" +
            "function send(o){var fr=[],f=document.querySelectorAll('iframe');for(var i=0;i<f.length;i++)if(f[i].src)fr.push(f[i].src);" +
            "window.flutter_inappwebview.callHandler('setResponse',JSON.stringify({list:o,href:location.href,frames:fr," +
            "videos:document.querySelectorAll('video').length,text:(document.title||'').substring(0,60)}));}" +
            "var t=setInterval(function(){n++;var o=found();if((o.length&&n>=4)||n>=50){clearInterval(t);send(o);return;}" +
            "if(n===6||n===16||n===30){var v=document.querySelector('video');if(v){v.muted=true;try{v.play();}catch(e){}}" +
            "var b=document.querySelector('.plyr__control--overlaid,[data-plyr=play],.vjs-big-play-button,.jw-icon-display,button[aria-label*=Play]');if(b)b.click();}},300);})();";
        let info = null;
        try {
            const timeout = new Promise((r) => setTimeout(() => r(null), 25000));
            const res = await Promise.race([evaluateJavascriptViaWebview(url, { "Referer": `${this.getBaseUrl()}/` }, [script]), timeout]);
            info = res ? JSON.parse(String(res)) : null;
        } catch (e) {
            info = null;
        }
        if (!info) throw new Error("영상 주소를 못 찾았어요 [웹뷰 응답 없음 · 지구본으로 확인을 통과했는지 봐 주세요]");
        const origin = (/^https?:\/\/[^/]+/.exec(info.href || "") || [this.getBaseUrl()])[0];
        const headers = { "Referer": origin + "/", "Origin": origin };
        const list = (info.list || []).filter((u) => /^https?:\/\//.test(u));
        // 주 목록(playlist.m3u8) 먼저, 화질별 목록은 이름에 화질
        list.sort((a, b) => (/playlist\.m3u8/.test(b) ? 1 : 0) - (/playlist\.m3u8/.test(a) ? 1 : 0));
        // 주 목록은 화질별로 나눔(자동 (최대 Np) + 1080p·720p…), 그 밖의 주소는 이름에 화질
        let out = [];
        const main = list.filter((u) => /playlist\.m3u8/.test(u))[0];
        if (main) out = await hlsExpand(this.client, main, "MissAV", headers);
        for (const u of list) {
            if (u === main || out.some((v) => v.url === u)) continue;
            out.push({ url: u, originalUrl: u, quality: withRes("MissAV", u), headers });
        }
        if (!out.length) {
            const host = (u) => String(u || "").replace(/^https?:\/\//, "").split(/[/?#]/)[0];
            throw new Error(`영상 주소를 못 찾았어요 [video ${info.videos}개 · iframe ${(info.frames || []).map(host).join(",").substring(0, 80) || "없음"} · ${info.text || ""}]`);
        }
        return hlsHint(qualitySort("missav_quality", out));
    }

    getFilterList() {
        return [
            { type_name: "HeaderFilter", name: `📡 주소: ${this.getBaseUrl().replace(/^https?:\/\//, "")}` },
            ...notesFilters("missav"),
            { type_name: "HeaderFilter", name: "검색창에 사이트 주소를 붙여 넣으면 그 주소로 바꾸고, 작품·목록 주소면 그 화면을 열어요" },
            { type_name: "SeparatorFilter" },
            { type_name: "HeaderFilter", name: "분류: 검색어가 없을 때 적용 · 정렬: 검색 결과·분류 모두 적용" },
            {
                type_name: "SelectFilter", name: "분류", state: 0,
                values: CATS.map((x, i) => ({ type_name: "SelectOption", name: x[0], value: String(i) })),
            },
            {
                type_name: "SelectFilter", name: "정렬", state: 0,
                values: SORTS.map((x, i) => ({ type_name: "SelectOption", name: x[0], value: String(i) })),
            },
        ].concat(ruleFilters("missav", RULE_SIZES, [ruleText(DEFAULT_POPULAR), ruleText(DEFAULT_LATEST)], ruleText));
    }

    getSourcePreferences() {
        return [{
            key: "missav_list",
            editTextPreference: {
                title: "기본 목록 주소 (분류 \"설정의 목록\")",
                summary: "비워 두면 첫 화면(dm270/ko). 인기·최신 탭은 필터의 탭 규칙으로 바꿀 수 있어요.",
                value: "",
                dialogTitle: "목록 주소",
                dialogMessage: "사이트의 목록 화면 주소 (예: https://missav123.com/dm270/ko)",
            },
        }, {
            key: "missav_domain",
            editTextPreference: {
                title: "사이트 주소 직접 지정 (선택)",
                summary: "비워 두면 https://missav123.com 을 사용합니다.",
                value: "",
                dialogTitle: "사이트 주소",
                dialogMessage: "https:// 로 시작하는 주소 (주소가 바뀌면 여기에, 또는 검색창에 붙여 넣기)",
            },
        }, qualityPreference("missav_quality")];
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
