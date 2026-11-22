const mangayomiSources = [{
    "name": "Javtiful",
    "lang": "ko",
    "baseUrl": "https://javtiful.com",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/insid0909-max/my-ext/main/icon.png",
    "typeSource": "single",
    "itemType": 1,
    "isNsfw": true,
    "hasCloudflare": false,
    "version": "0.0.3",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "anime/javtiful.js"
}];

// 개인용 Javtiful 소스 (2026-11-17 javtiful.com 구조 확인, 해외에서도 열림·보안 확인 없음)
// - 목록 /ko/{videos|censored|uncensored|reducing-mosaic}?sort=&page=N (정렬 9가지),
//   /ko/category/{이름}?sort=(popular|added_*)&video_type=(censored|uncensored|reducing_mosaic)&page=N, /ko/channel/{slug}?page=N(정렬 없음)
//   검색 /ko/search?q=&page=N (정렬 없음). 카드 article.video-card(광고 칸은 video-card--partner), 다음 쪽 = page=N+1 링크
// - 작품 /ko/video/{번호}/{slug}: h1 제목, time[datetime] 올린 날, JSON-LD duration, 배우 a.watch-actor-card, 분류·태그 a.watch-link-chip
// - 재생: 작품 화면 설정의 "playback":{"endpoint","ticket"} → POST endpoint (ticket=…, X-Requested-With) →
//   {"sources":[{src:/ko/media/video/{번호}/720p?expires&signature, label}]} → 그 주소가 서명된 mp4 로 넘겨 줌(1시간)
//   표는 작품 주소(slug 까지 정확한 주소)에서 받은 것만 통함 → 재생 때마다 작품 화면을 새로 받음
// - 설정은 반드시 try 안에서 읽음 (설치 때 getHeaders·getFilterList 가 불림)
const DEFAULT_BASE_URL = "https://javtiful.com";
const DOMAIN_RE = /^https:\/\/(?:www\.)?javtiful\.[a-z]{2,8}$/;
const SITE_RE = /^https?:\/\/(?:www\.)?javtiful\.[a-z]{2,8}/;
const LABEL = "Javtiful";

// 종류 (사이트 메뉴 그대로)
const TYPES = [["전체", "videos", ""], ["유수정", "censored", "censored"], ["무수정", "uncensored", "uncensored"], ["모자이크 감소", "reducing-mosaic", "reducing_mosaic"], ["쇼츠", "shorts", ""]];
const SHORTS = 4;
// 카테고리 (/ko/categories, 2026-11-17)
const CATS = [["전체", ""]].concat([
    "가정부", "간호사", "드라마", "미소녀", "밀프", "불륜", "성숙한", "아마추어", "언니", "여교사", "여대생",
    "여성-상사", "여수사관", "오피스-레이디", "유부녀", "최면", "코스플레이어", "큰-가슴",
].map((x) => [x.replace(/-/g, " "), x]), [["중국 AV", "chinese-av"]]);
// 채널 (/ko/channels 1~3쪽, 사이트 순서 = 동영상 많은 순, 2026-11-17)
const CHANNELS = [["전체", ""]].concat([
    ["FC2PPV", "fc2ppv"], ["S1 NO.1 STYLE", "s1-no1-style"], ["Madonna", "madonna"], ["MOODYZ", "moodyz"], ["SOD Create", "sod-create"],
    ["IDEA POCKET", "idea-pocket"], ["Hunter", "hunter"], ["Attackers", "attackers"], ["PRESTIGE", "prestige"], ["Venus", "venus"],
    ["Caribbean", "caribbean"], ["Planet Plus", "planet-plus"], ["FALENO", "faleno"], ["K.M.Produce", "kmproduce"], ["Oppai", "oppai"],
    ["Honnaka", "honnaka"], ["Glory Quest", "glory-quest"], ["Das !", "das"], ["Fitch", "fitch"], ["WANZ FACTORY", "wanz-factory"],
    ["Natural High", "natural-high"], ["Crystal Eizou", "crystal-eizou"], ["Premium", "premium"], ["1Pondo", "1pondo"], ["S-Cute", "s-cute"],
    ["HEYZO", "heyzo"], ["SWITCH", "switch"], ["E-body", "e-body"], ["Alice Japan", "alice-japan"], ["MAX-A", "max-a"],
    ["First Star", "first-star"], ["Kawaii", "kawaii"], ["Serebu No Tomo", "serebu-no-tomo"], ["H.m.p", "hmp"], ["Tameike Goro", "tameike-goro"],
    ["IE NERGY", "ie-nergy"], ["Deeps", "deeps"], ["DOC", "doc"], ["Takara Eizou", "takara-eizou"], ["Muku", "muku"],
    ["MAXING", "maxing"], ["DAHLIA", "dahlia"], ["JET Eizou", "jet-eizou"], ["10Musume", "10musume"], ["Momotarou Eizou Shuppan", "momotarou-eizou-shuppan"],
    ["Aurora Project Annex", "aurora-project-annex"], ["Sadistic Village", "sadistic-village"], ["MERCURY", "mercury"], ["ROYAL", "royal"],
    ["Oyaji No Kosatsu", "oyaji-no-kosatsu"], ["Hibino", "hibino"], ["Nagae Style", "nagae-style"], ["LUNATICS", "lunatics"],
    ["Center Village", "center-village"], ["Abc / Mousou Zoku", "abc-mousou-zoku"], ["Yama To Sora", "yama-to-sora"], ["Bi", "bi"],
    ["Maza", "maza"], ["Rocket", "rocket"], ["Pakopakodan To Yukaina Nakamatachi", "pakopakodan-to-yukaina-nakamatachi"], ["Tma", "tma"],
    ["Non", "non"], ["Nampa JAPAN", "nampa-japan"], ["Sekimenjoshi", "sekimenjoshi"], ["FALENOTUBE", "falenotube"], ["Avs", "avs"],
    ["Hentai Shinshi Kurabu", "hentai-shinshi-kurabu"], ["M's Video Group", "ms-video-group"], ["Ke- . Toraibu", "ke-toraibu"],
    ["S Kyuu Shirouto", "s-kyuu-shirouto"], ["Barutan", "barutan"], ["Pacopacomama", "pacopacomama"],
]);
// 정렬: [이름, 전체·종류 화면 값, 카테고리 화면 값(카테고리는 인기 하나·추가 기간만)]
const SORTS = [
    ["최신", "", ""], ["오늘 인기", "popular_today", "popular"], ["이번 주 인기", "popular_week", "popular"], ["이번 달 인기", "popular_month", "popular"],
    ["오늘 추가", "added_today", "added_today"], ["이번 주 추가", "added_week", "added_week"], ["이번 달 추가", "added_month", "added_month"],
    ["조회수 많은 순", "most_viewed", "popular"], ["좋아요 많은 순", "most_liked", "popular"],
];
const FILTER_DEFS = [["종류", TYPES], ["카테고리", CATS], ["채널", CHANNELS], ["정렬", SORTS]];
const RULE_SIZES = FILTER_DEFS.map((d) => d[1].length);
const DEFAULT_POPULAR = [0, 0, 0, 2];
const DEFAULT_LATEST = [0, 0, 0, 0];

function ruleText(i) {
    if (i[0] === SHORTS) return "쇼츠";
    if (i[2]) return `채널 ${CHANNELS[i[2]][0]} · 최신`;
    const parts = [TYPES[i[0]][0]];
    if (i[1]) parts.push(CATS[i[1]][0]);
    parts.push(SORTS[i[3]][0]);
    return parts.join(" · ");
}

// 글자 s 의 at 위치([ 또는 {)부터 짝이 맞는 곳까지 잘라 JSON 으로 (따옴표 안은 건너뜀)
function jsonAt(s, at) {
    let depth = 0;
    let str = false;
    for (let i = at; i < s.length; i++) {
        const c = s[i];
        if (str) {
            if (c === "\\") i++;
            else if (c === '"') str = false;
        } else if (c === '"') str = true;
        else if (c === "[" || c === "{") depth++;
        else if (c === "]" || c === "}") {
            depth--;
            if (depth === 0) {
                try {
                    return JSON.parse(s.substring(at, i + 1));
                } catch (e) {
                    return null;
                }
            }
        }
    }
    return null;
}

// 쇼츠 다음 묶음 표(cursor): 쪽 번호 → 표 (앱이 확장을 새로 띄울 수 있어 설정에도 둠)
const SHORT_CURSORS = {};

function decode(s) {
    return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
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

    // 주소: 설정에 직접 넣은 주소 → 검색창 붙여 넣기로 바꾼 주소 → 기본 주소
    getBaseUrl() {
        const v = this.pref("javtiful_domain").replace(/\/+$/, "");
        if (DOMAIN_RE.test(v)) return v;
        let auto = "";
        try {
            auto = String(new SharedPreferences().getString("javtiful_auto_domain", "") || "").trim();
        } catch (e) {
            auto = "";
        }
        return DOMAIN_RE.test(auto) ? auto : DEFAULT_BASE_URL;
    }

    getHeaders(url) {
        return { "Referer": `${this.getBaseUrl()}/` };
    }

    async isSite(origin) {
        try {
            const res = await this.client.get(`${origin}/ko/main`, {});
            return res.statusCode < 400 && /video-card|Javtiful/.test(String(res.body || ""));
        } catch (e) {
            return false;
        }
    }

    async get(url) {
        await siteWait();
        let res;
        try {
            res = await this.client.get(url, { "Referer": `${this.getBaseUrl()}/` });
        } catch (e) {
            throw new Error(`Javtiful 접속 실패: ${String((e && e.message) || e).substring(0, 80)}. 주소가 바뀌었으면 새 사이트 주소를 검색창에 붙여 넣어 주세요.`);
        }
        if (res.statusCode >= 400) {
            throw new Error(`Javtiful 접속 실패 (HTTP ${res.statusCode} · ${url.replace(/^https?:\/\/[^/]+/, "").split("?")[0].substring(0, 40)}). 주소가 바뀌었으면 새 사이트 주소를 검색창에 붙여 넣어 주세요.`);
        }
        return String(res.body || "");
    }

    parseList(html, page) {
        const base = this.getBaseUrl();
        const doc = new Document(html);
        const list = [];
        const seen = {};
        for (const card of doc.select("article.video-card")) {
            const a = first(card, "a.video-card__thumbnail");
            if (!a) continue;
            const href = String(a.attr("href") || "");
            const id = (/\/video\/(\d+)/.exec(href) || [])[1];
            if (!id || seen[id]) continue;
            seen[id] = true;
            const t = first(card, "a.video-card__title");
            let name = decode(t ? (t.attr("title") || t.text) : "").trim();
            if (!name) continue;
            const type = first(card, ".video-card__type");
            const tag = type ? String(type.text).trim() : "";
            if (tag && /uncensored/i.test(tag) && !/uncensored|무수정/i.test(name)) name += " [무수정]";
            // 같은 작품의 모자이크 감소판(…-reducing-mosaic)이 일반판과 그림·제목이 같아 두 번 보임 → 판 이름
            if (/reducing/i.test(tag) || /-reducing-mosaic\/?$/i.test(href)) name += " [모자이크 감소]";
            const img = first(card, "img");
            let src = img ? String(img.attr("data-front-lazy-src") || img.attr("src") || "") : "";
            if (/placeholder/.test(src)) src = "";
            if (src && !/^https?:/.test(src)) src = base + (src.startsWith("/") ? "" : "/") + src;
            list.push({ name, imageUrl: src, link: (/^https?:/.test(href) ? href.replace(SITE_RE, base) : base + href) });
        }
        const hasNextPage = list.length > 0 && new RegExp(`[?&]page=${page + 1}(?:[&"]|$)`).test(html.replace(/&amp;/g, "&"));
        return { list, hasNextPage };
    }

    // ---------- 쇼츠: 첫 화면 /ko/shorts 의 "feed":{"items":[…],"cursor"} → 다음은 /ko/shorts/feed?cursor=&exclude=&hashtag= (JSON)
    shortCards(items) {
        const base = this.getBaseUrl();
        return (items || []).filter((o) => o && o.uid && o.media).map((o) => ({
            name: `${String(o.caption || o.uid).trim()} [쇼츠]`,
            imageUrl: o.poster || "",
            link: `${base}/ko/shorts/${o.uid}`,
        }));
    }

    // 다음 묶음은 첫 화면이 준 쿠키 shorts_guest_feeds·shorts_visitor 가 있어야 통함 (없으면 409 "feed expired")
    // 돌려주는 값은 "이름=값; 이름=값" (새로 받은 것이 예전 것을 덮음)
    feedCookie(res, old) {
        const h = (res && res.headers) || {};
        const raw = Object.keys(h).filter((k) => k.toLowerCase() === "set-cookie").map((k) => String(h[k])).join(",");
        const jar = {};
        for (const part of String(old || "").split(/;\s*/)) {
            const i = part.indexOf("=");
            if (i > 0) jar[part.substring(0, i)] = part.substring(i + 1);
        }
        const re = /(shorts_[a-z_]+)=([^;,\s]+)/g;
        let m;
        while ((m = re.exec(raw))) jar[m[1]] = m[2];
        return Object.keys(jar).map((k) => `${k}=${jar[k]}`).join("; ");
    }

    async shortsList(page) {
        let saved = page > 1 ? SHORT_CURSORS[page] || "" : "";
        if (page > 1 && !saved) {
            try {
                saved = String(new SharedPreferences().getString(`javtiful_short_cur_${page}`, "") || "");
            } catch (e) {
                saved = "";
            }
        }
        const [cursor, cookie] = saved ? saved.split("\n") : ["", ""];
        let items = [];
        let next = "";
        let nextCookie = cookie || "";
        if (cursor) {
            await siteWait();
            const res = await this.client.get(`${this.getBaseUrl()}/ko/shorts/feed?cursor=${encodeURIComponent(cursor)}&exclude=&hashtag=`, Object.assign({
                "Referer": `${this.getBaseUrl()}/ko/shorts`, "Accept": "application/json", "X-Requested-With": "XMLHttpRequest",
            }, cookie ? { "Cookie": cookie } : {}));
            nextCookie = this.feedCookie(res, cookie);
            let data = {};
            try {
                data = JSON.parse(String(res.body || "{}"));
            } catch (e) {
                data = {};
            }
            if (!data.success) {
                // 표가 오래됐으면(409) 처음 묶음부터 다시
                if (res.statusCode === 409) return { list: [], hasNextPage: false };
                throw new Error(`쇼츠 목록을 못 받았어요 [HTTP ${res.statusCode} · ${String(data.message || "").substring(0, 50)}]`);
            }
            items = data.items || [];
            next = data.cursor || "";
        } else {
            await siteWait();
            const res = await this.client.get(`${this.getBaseUrl()}/ko/shorts`, { "Referer": `${this.getBaseUrl()}/` });
            if (res.statusCode >= 400) throw new Error(`쇼츠 목록을 못 받았어요 [HTTP ${res.statusCode}]`);
            const html = String(res.body || "");
            nextCookie = this.feedCookie(res, "");
            const at = html.indexOf('"feed":{"items":');
            const feed = at >= 0 ? jsonAt(html, at + 7) : null;
            if (!feed) throw new Error("쇼츠 목록을 못 읽었어요 [화면에 feed 자료 없음]");
            items = feed.items || [];
            next = feed.cursor || "";
        }
        if (next) {
            const v = `${next}\n${nextCookie}`;
            SHORT_CURSORS[page + 1] = v;
            try {
                new SharedPreferences().setString(`javtiful_short_cur_${page + 1}`, v);
            } catch (e) {
                // 메모리에만
            }
        }
        const list = this.shortCards(items);
        return { list, hasNextPage: !!next && list.length > 0 };
    }

    async listing(idx, page) {
        if (idx[0] === SHORTS && !idx[1] && !idx[2]) return this.shortsList(page);
        return this.parseList(await this.get(this.listUrl(idx, page)), page);
    }

    listUrl(idx, page) {
        const base = `${this.getBaseUrl()}/ko`;
        const q = (o) => {
            const s = Object.keys(o).filter((k) => o[k]).map((k) => `${k}=${encodeURIComponent(o[k])}`).join("&");
            return s ? `?${s}` : "";
        };
        const pg = page > 1 ? String(page) : "";
        if (idx[2]) return `${base}/channel/${CHANNELS[idx[2]][1]}${q({ page: pg })}`;
        if (idx[1]) return `${base}/category/${encodeURIComponent(CATS[idx[1]][1])}${q({ sort: SORTS[idx[3]][2], video_type: TYPES[idx[0]][2], page: pg })}`;
        return `${base}/${idx[0] === SHORTS ? "videos" : TYPES[idx[0]][1]}${q({ sort: SORTS[idx[3]][1], page: pg })}`;
    }

    async getPopular(page) {
        await notesRefresh(this.client);
        const idx = ruleRead("javtiful", true, RULE_SIZES) || DEFAULT_POPULAR;
        return this.listing(idx, page);
    }

    get supportsLatest() {
        return true;
    }

    async getLatestUpdates(page) {
        const idx = ruleRead("javtiful", false, RULE_SIZES) || DEFAULT_LATEST;
        return this.listing(idx, page);
    }

    async search(query, page, filters) {
        const q = String(query || "").trim();
        // 사이트 주소(https:// 없어도) 붙여 넣기: 진짜 사이트면 그 주소로 바꿈. 작품이면 그 작품, 목록 화면이면 그 목록
        const site = /^(?:https?:\/\/)?((?:www\.)?javtiful\.[a-z]{2,8})(\/[^\s]*)?$/i.exec(q);
        if (site) {
            const origin = `https://${site[1].toLowerCase()}`;
            if (origin !== this.getBaseUrl()) {
                if (!(await this.isSite(origin))) throw new Error(`${site[1]} 는 Javtiful 화면이 아니에요. 주소를 다시 확인해 주세요.`);
                try {
                    new SharedPreferences().setString("javtiful_auto_domain", origin);
                } catch (e) {
                    // 이번만
                }
            }
            const path = (site[2] || "/").split("#")[0];
            const v = /^\/(?:[a-z]{2}\/)?video\/(\d+\/[^/?]+)/.exec(path);
            if (v) {
                if (page > 1) return { list: [], hasNextPage: false };
                const url = `${this.getBaseUrl()}/ko/video/${v[1]}`;
                const d = await this.getDetail(url);
                return { list: [{ name: d.name, imageUrl: d.imageUrl, link: url }], hasNextPage: false };
            }
            const sh = /^\/(?:[a-z]{2}\/)?shorts\/([a-f0-9]{32})/.exec(path);
            if (sh) {
                if (page > 1) return { list: [], hasNextPage: false };
                const url = `${this.getBaseUrl()}/ko/shorts/${sh[1]}`;
                const d = await this.getDetail(url);
                return { list: [{ name: d.name, imageUrl: d.imageUrl, link: url }], hasNextPage: false };
            }
            if (/^\/(?:[a-z]{2}\/)?shorts\/?(?:\?|$)/.test(path)) return this.shortsList(page);
            const l = /^\/(?:[a-z]{2}\/)?((?:videos|censored|uncensored|reducing-mosaic|category\/[^/?]+|channel\/[^/?]+|actress\/[^/?]+|search)(?:\?[^#]*)?)$/.exec(path);
            if (l) {
                const u = `${this.getBaseUrl()}/ko/${l[1].replace(/([?&])page=\d+&?/, "$1").replace(/[?&]$/, "")}`;
                return this.parseList(await this.get(u + (page > 1 ? `${u.includes("?") ? "&" : "?"}page=${page}` : "")), page);
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
        if (q) {
            const url = `${this.getBaseUrl()}/ko/search?q=${encodeURIComponent(q)}${page > 1 ? `&page=${page}` : ""}`;
            return this.parseList(await this.get(url), page);
        }
        if (rule) ruleApply("javtiful", rule, idx);
        return this.listing(idx, page);
    }

    async shortDetail(clean, uid) {
        const html = await this.get(clean);
        const at = html.indexOf('"feed":{"items":');
        const feed = at >= 0 ? jsonAt(html, at + 7) : null;
        const o = ((feed && feed.items) || []).find((x) => x && x.uid === uid);
        if (!o) throw new Error("쇼츠 정보를 못 찾았어요 [지워졌거나 화면 모양이 바뀜]");
        const base = this.getBaseUrl();
        const actor = (o.actress && o.actress.name) || "";
        const full = o.fullVideoUrl ? (/^https?:/.test(o.fullVideoUrl) ? o.fullVideoUrl : base + o.fullVideoUrl) : "";
        const episodes = [{ name: "1 쇼츠", url: o.media, dateUpload: String(Date.now()), scanlator: "" }];
        if (full) episodes.push({ name: "2 본편", url: full, dateUpload: String(Date.now()), scanlator: "" });
        return {
            name: String(o.caption || uid).trim(),
            imageUrl: o.poster || "",
            author: "",
            artist: actor,
            genre: (o.hashtags || []).map((x) => String(x.name || x)).filter((x) => x),
            status: 1,
            description: ["쇼츠 (짧은 영상)", actor ? `출연 ${actor}` : "", full ? "본편은 회차 \"2 본편\"" : ""].filter((x) => x).join(" · "),
            link: clean,
            episodes: episodes.reverse(),
        };
    }

    async getDetail(url) {
        const clean = url.split("#")[0];
        const sh = /\/shorts\/([a-f0-9]{32})/.exec(clean);
        if (sh) return this.shortDetail(clean, sh[1]);
        const html = await this.get(clean);
        const doc = new Document(html);
        const meta = (p) => {
            const m = first(doc, `meta[property="${p}"]`) || first(doc, `meta[name="${p}"]`);
            return m ? decode(m.attr("content") || "").trim() : "";
        };
        const h1 = first(doc, ".watch-title h1") || first(doc, "h1");
        const name = ((h1 ? String(h1.text).trim() : "") || meta("og:title")) + (/-reducing-mosaic\/?(?:[?#]|$)/i.test(url) ? " [모자이크 감소]" : "");
        const texts = (css) => doc.select(css).map((e) => String(e.text).trim()).filter((x) => x);
        const cast = texts("a.watch-actor-card span");
        const cats = texts("a.watch-link-chip.is-category");
        const tags = doc.select("a.watch-link-chip").filter((e) => !/is-category/.test(String(e.attr("class") || ""))).map((e) => String(e.text).trim()).filter((x) => x);
        const ch = first(doc, '.watch-meta a[href*="/channel/"]') || first(doc, 'a[href*="/ko/channel/"]:not(.filter-menu__option)');
        const channel = ch ? String(ch.text).trim() : "";
        // 올린 날: time[datetime] (사이트 시각 +07:00)
        const t = first(doc, ".watch-meta time[datetime]") || first(doc, "time[datetime]");
        const dt = t ? String(t.attr("datetime") || "") : ((/"uploadDate":"([^"]+)"/.exec(html) || [])[1] || "");
        const ms = Date.parse(dt) || 0;
        const dur = /"duration":"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/.exec(html);
        const length = dur ? [dur[1] ? `${dur[1]}시간` : "", dur[2] ? `${Number(dur[2])}분` : ""].filter((x) => x).join(" ") : "";
        const info = [
            length ? `길이 ${length}` : "",
            ms ? `올린 날 ${ymd(ms)}` : "",
            cast.length ? `출연 ${cast.join(", ")}` : "",
            channel ? `채널 ${channel}` : "",
        ].filter((x) => x).join(" · ");
        return {
            name,
            imageUrl: meta("og:image"),
            author: channel,
            artist: cast.join(", "),
            genre: cats.concat(tags).filter((x, i, a) => a.indexOf(x) === i),
            status: 1,
            description: info,
            link: clean,
            episodes: [{ name: ms ? `1 재생 (${ymd(ms)})` : "1 재생", url: clean, dateUpload: String(ms || Date.now()), scanlator: "" }],
        };
    }

    // ================= 재생 =================
    // 작품 화면의 재생표(ticket) → 재생 정보 요청 → 서명된 mp4 주소 (1시간)
    async getVideoList(url) {
        url = url.split("#")[0];
        if (/\.m3u8(?:\?|$)/.test(url)) {
            const h = { "Referer": `${this.getBaseUrl()}/` };
            return hlsHint(qualitySort("javtiful_quality", await hlsExpand(this.client, url, `${LABEL} 쇼츠`, h)));
        }
        const html = await this.get(url);
        const pb = /"playback":\{"endpoint":"([^"]+)","ticket":"([^"]+)"/.exec(html);
        if (!pb) {
            const why = /premium|login/i.test((/"playback":\{[^}]{0,120}/.exec(html) || [""])[0]) ? "프리미엄·로그인 전용일 수 있어요" : "작품 화면에 재생표 없음";
            throw new Error(`영상 정보를 못 찾았어요 [${why}]`);
        }
        const base = this.getBaseUrl();
        const endpoint = pb[1].replace(/\\\//g, "/");
        const api = /^https?:/.test(endpoint) ? endpoint : base + endpoint;
        const send = (ticket) => this.client.post(api, {
            "Referer": url, "Origin": base, "Accept": "application/json", "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        }, `ticket=${encodeURIComponent(ticket)}`);
        let res = await send(pb[2]);
        let data = {};
        try {
            data = JSON.parse(String(res.body || "{}"));
        } catch (e) {
            data = {};
        }
        // 표가 만료됐으면 사이트가 새 표를 줌 (사이트 플레이어와 같게 한 번 더)
        if (res.statusCode === 409 && data.renewTicket) {
            res = await send(String(data.renewTicket));
            try {
                data = JSON.parse(String(res.body || "{}"));
            } catch (e) {
                data = {};
            }
        }
        if (!data.success || !Array.isArray(data.sources) || !data.sources.length) {
            throw new Error(`재생 정보를 못 받았어요 [재생 정보 HTTP ${res.statusCode} · ${String(data.message || res.body || "").replace(/\s+/g, " ").substring(0, 60)}]`);
        }
        const headers = { "Referer": `${base}/` };
        const out = [];
        const srcs = data.sources.slice().sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0));
        for (const s of srcs) {
            for (const raw of [s.src, s.fallbackSrc]) {
                if (!raw) continue;
                const u = /^https?:/.test(raw) ? raw : base + raw;
                if (out.some((x) => x.url === u)) continue;
                const q = s.label || (s.size ? `${s.size}p` : "");
                const name = `${LABEL}${q ? ` ${q}` : ""}${raw === s.fallbackSrc ? " (대체)" : ""}`;
                if (/\.m3u8/.test(u)) out.push(...await hlsExpand(this.client, u, LABEL, headers));
                else out.push({ url: u, originalUrl: u, quality: name, headers });
            }
        }
        return hlsHint(qualitySort("javtiful_quality", out));
    }

    // ================= 필터 · 설정 =================
    getFilterList() {
        return [
            { type_name: "HeaderFilter", name: `📡 주소: ${this.getBaseUrl().replace(/^https?:\/\//, "")}` },
            ...notesFilters("javtiful"),
            { type_name: "HeaderFilter", name: "검색창에 사이트 주소를 붙여 넣으면 그 주소로 바꾸고, 작품·목록 주소면 그 화면을 열어요" },
            { type_name: "SeparatorFilter" },
            { type_name: "HeaderFilter", name: "검색어가 있으면 필터 무시 · 채널을 고르면 채널 최신순만 · 카테고리는 인기/추가 기간 정렬만 · 쇼츠는 사이트가 골라 주는 차례(정렬 없음)" },
        ].concat(FILTER_DEFS.map(([name, values]) => ({
            type_name: "SelectFilter", name, state: 0,
            values: values.map((v, j) => ({ type_name: "SelectOption", name: v[0], value: String(j) })),
        })), ruleFilters("javtiful", RULE_SIZES, [ruleText(DEFAULT_POPULAR), ruleText(DEFAULT_LATEST)], ruleText),
        [0, 1, 2].map(() => ({ type_name: "HeaderFilter", name: "　" })));
    }

    getSourcePreferences() {
        return [{
            key: "javtiful_domain",
            editTextPreference: {
                title: "사이트 주소 직접 지정 (선택)",
                summary: "비워 두면 https://javtiful.com",
                value: "",
                dialogTitle: "사이트 주소",
                dialogMessage: "https:// 로 시작하는 주소 (또는 검색창에 붙여 넣기)",
            },
        }, qualityPreference("javtiful_quality")];
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
