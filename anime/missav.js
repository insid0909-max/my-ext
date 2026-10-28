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
    "version": "0.0.3",
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

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    pref(key) {
        try {
            return String(new SharedPreferences().get(key) || "").trim();
        } catch (e) {
            return "";
        }
    }

    getBaseUrl() {
        const v = this.pref("missav_domain").replace(/\/+$/, "");
        return DOMAIN_RE.test(v) ? v : DEFAULT_BASE_URL;
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
        try {
            res = await this.client.get(url, this.getHeaders(this.getBaseUrl()));
        } catch (e) {
            throw new Error(`MissAV 접속 실패: ${String((e && e.message) || e).substring(0, 80)}`);
        }
        const body = String(res.body || "");
        if (res.statusCode === 403 || res.statusCode === 503 || /Just a moment|cf-chl|challenge-platform/i.test(body.substring(0, 3000))) {
            throw new Error("Cloudflare 확인이 필요해요. 오른쪽 위 지구본(웹뷰)으로 사이트를 한 번 열어 확인을 통과한 뒤 다시 시도해 주세요.");
        }
        if (res.statusCode >= 400) throw new Error(`MissAV 접속 실패 (HTTP ${res.statusCode})`);
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

    async getPopular(page) {
        return this.parseList(await this.get(pageUrl(this.listUrl(), page)), page);
    }

    get supportsLatest() {
        return true;
    }

    async getLatestUpdates(page) {
        // 같은 목록을 공개일 순으로
        return this.parseList(await this.get(pageUrl(setParam(this.listUrl(), "sort", "published_at"), page)), page);
    }

    async search(query, page, filters) {
        const q = String(query || "").trim();
        const base = this.getBaseUrl();
        // 사이트 주소를 붙여 넣으면: 작품이면 그 작품, 목록이면 그 목록
        if (/^(?:https?:\/\/)?(?:www\.)?missav[a-z0-9]*\.[a-z]{2,6}\//i.test(q)) {
            const url = (/^https?:\/\//.test(q) ? q : "https://" + q).replace(SITE_RE, base);
            if (POST_RE.test(url)) {
                if (page > 1) return { list: [], hasNextPage: false };
                const d = await this.getDetail(url);
                return { list: [{ name: d.name, imageUrl: d.imageUrl, link: url }], hasNextPage: false };
            }
            return this.parseList(await this.get(pageUrl(url, page)), page);
        }
        let sort = "";
        let cat = "";
        for (const f of filters || []) {
            if (f && f.name === "정렬") sort = (SORTS[Number(f.state) || 0] || SORTS[0])[1];
            if (f && f.name === "분류") cat = (CATS[Number(f.state) || 0] || CATS[0])[1];
        }
        let url = q ? `${base}/ko/search/${encodeURIComponent(q)}` : cat ? base + cat : this.listUrl();
        if (sort) url = setParam(url, "sort", sort);
        return this.parseList(await this.get(pageUrl(url, page)), page);
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
        const description = meta("og:description") || meta("description");
        return {
            name, imageUrl, description, genre, status: 1, link: url,
            episodes: [{ name: "1 재생", url, dateUpload: String(Date.now()) }],
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
        const out = list.map((u) => {
            const res = (/(\d{3,4})p/.exec(u) || /\/(\d{3,4})x(\d{3,4})\//.exec(u) || [])[1];
            const label = /playlist\.m3u8/.test(u) ? "자동" : res ? `${res}p` : "영상";
            return { url: u, originalUrl: u, quality: `MissAV ${label}`, headers };
        });
        if (!out.length) {
            const host = (u) => String(u || "").replace(/^https?:\/\//, "").split(/[/?#]/)[0];
            throw new Error(`영상 주소를 못 찾았어요 [video ${info.videos}개 · iframe ${(info.frames || []).map(host).join(",").substring(0, 80) || "없음"} · ${info.text || ""}]`);
        }
        return out;
    }

    getFilterList() {
        return [
            { type_name: "HeaderFilter", name: `📡 주소: ${this.getBaseUrl().replace(/^https?:\/\//, "")}` },
            { type_name: "HeaderFilter", name: "인기 = 설정의 목록 주소, 최신 = 같은 목록 공개일 순" },
            { type_name: "HeaderFilter", name: "검색창에 사이트 목록·작품 주소를 붙여 넣으면 그 화면을 바로 열어요" },
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
        ];
    }

    getSourcePreferences() {
        return [{
            key: "missav_list",
            editTextPreference: {
                title: "인기·최신 목록 주소",
                summary: "비워 두면 기본 목록(dm270/ko)을 사용합니다.",
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
                dialogMessage: "https:// 로 시작하는 주소 (주소가 바뀌면 여기에)",
            },
        }];
    }
}
