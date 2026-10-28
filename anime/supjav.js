const mangayomiSources = [{
    "name": "SupJav",
    "lang": "ko",
    "baseUrl": "https://supjav.com",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/insid0909-max/my-ext/main/icon.png",
    "typeSource": "single",
    "itemType": 1,
    "isNsfw": true,
    "hasCloudflare": true,
    "version": "0.0.4",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "anime/supjav.js"
}];

// 개인용 SupJav 소스 (첫 버전: 사이트 구조를 직접 확인하지 못한 채 일반적인 워드프레스 모양을 짐작해 만듦)
// - 사이트가 Cloudflare 확인을 쓰므로 앱 웹뷰에서 한 번 직접 통과해야 함 (확장은 확인을 건너뛰지 않음)
// - 사이트 요청엔 User-Agent 를 넣지 않음 → 앱이 웹뷰와 같은 UA 를 넣어 줘서 웹뷰에서 받은 통과 쿠키가 맞음
// - 재생: 웹뷰로 작품 화면을 열어 서버 버튼을 눌러 보고 생긴 재생 화면(iframe) 주소를 모음 →
//   각 재생 화면을 웹뷰로 열어 플레이어가 불러온 영상 주소(m3u8·mp4)를 받음, 안 되면 앱에 들어 있는 추출기
const DEFAULT_BASE_URL = "https://supjav.com";
const DEFAULT_LIST = "https://supjav.com/category/maker/switch?sort=views";
const DOMAIN_RE = /^https:\/\/(?:www\.)?supjav\.[a-z]{2,6}$/;
const POST_RE = /^https?:\/\/(?:www\.)?supjav\.[a-z]{2,6}\/(?:[a-z]{2}\/)?\d+\.html/;
const MAX_SERVERS = 4;

function first(el, css) {
    const l = el ? el.select(css) : [];
    return l && l.length ? l[0] : null;
}

function imgOf(el) {
    if (!el) return "";
    for (const a of ["data-original", "data-src", "data-lazy-src", "src"]) {
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

/** 목록 주소에 쪽 번호 넣기: /category/x?sort=views → /category/x/page/2?sort=views */
function pageUrl(listUrl, page) {
    const [path, query] = String(listUrl).split("?");
    const clean = path.replace(/\/page\/\d+\/?$/, "").replace(/\/+$/, "");
    const p = page > 1 ? `${clean}/page/${page}` : (clean || listUrl);
    return query ? `${p}?${query}` : p;
}

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    // 설정 읽기는 전부 try 안에서 (설치 중엔 설정이 없어 읽기가 오류를 냄 → 설치가 조용히 멈춤, 망가요미 #1064)
    pref(key) {
        try {
            return String(new SharedPreferences().get(key) || "").trim();
        } catch (e) {
            return "";
        }
    }

    getBaseUrl() {
        const v = this.pref("supjav_domain").replace(/\/+$/, "");
        return DOMAIN_RE.test(v) ? v : DEFAULT_BASE_URL;
    }

    listUrl() {
        let v = this.pref("supjav_list");
        if (!/^https?:\/\//.test(v)) v = DEFAULT_LIST;
        return v.replace(/^https?:\/\/(?:www\.)?supjav\.[a-z]{2,6}/, this.getBaseUrl());
    }

    // 설치할 때 앱이 getHeaders 를 부르는데, 이때 설정을 읽으면 설치가 조용히 멈춤(망가요미 #1064) → 설정 읽지 않음
    getHeaders(url) {
        const origin = (/^https?:\/\/[^/]+/.exec(String(url || "")) || [DEFAULT_BASE_URL])[0];
        return { "Referer": `${origin}/` };
    }

    async get(url) {
        let res;
        try {
            res = await this.client.get(url, this.getHeaders(this.getBaseUrl()));
        } catch (e) {
            throw new Error(`SupJav 접속 실패: ${String((e && e.message) || e).substring(0, 80)}`);
        }
        const body = String(res.body || "");
        if (res.statusCode === 403 || res.statusCode === 503 || /Just a moment|cf-chl|challenge-platform/i.test(body.substring(0, 3000))) {
            throw new Error("Cloudflare 확인이 필요해요. 오른쪽 위 지구본(웹뷰)으로 사이트를 한 번 열어 확인을 통과한 뒤 다시 시도해 주세요.");
        }
        if (res.statusCode >= 400) throw new Error(`SupJav 접속 실패 (HTTP ${res.statusCode})`);
        return body;
    }

    parseList(html, page) {
        const base = this.getBaseUrl();
        const doc = new Document(html);
        const seen = {};
        const list = [];
        for (const a of doc.select("a[href]")) {
            const link = abs(base, a.attr("href")).split("#")[0];
            if (!POST_RE.test(link) || seen[link]) continue;
            const img = first(a, "img");
            if (!img) continue;
            let name = String(a.attr("title") || "").trim() || String(img.attr("alt") || "").trim() || String(a.text || "").trim();
            if (!name) continue;
            seen[link] = true;
            list.push({ name, imageUrl: abs(base, imgOf(img)), link });
        }
        // 다음 쪽: rel=next, .next, 또는 /page/{page+1} 링크
        const next = html.indexOf(`/page/${page + 1}`) >= 0 || doc.select("a.next, a[rel=next], .pagination .next").length > 0;
        return { list, hasNextPage: list.length > 0 && next };
    }

    async getPopular(page) {
        return this.parseList(await this.get(pageUrl(this.listUrl(), page)), page);
    }

    get supportsLatest() {
        return true;
    }

    async getLatestUpdates(page) {
        // 같은 목록을 사이트 기본 순서(최신)로
        const url = this.listUrl().replace(/([?&])sort=[^&]*&?/, "$1").replace(/[?&]$/, "");
        return this.parseList(await this.get(pageUrl(url, page)), page);
    }

    async search(query, page, filters) {
        const q = String(query || "").trim();
        const base = this.getBaseUrl();
        // 사이트 주소를 붙여 넣으면: 작품이면 그 작품, 목록이면 그 목록
        if (/^(?:https?:\/\/)?(?:www\.)?supjav\.[a-z]{2,6}\//i.test(q)) {
            const url = (/^https?:\/\//.test(q) ? q : "https://" + q).replace(/^https?:\/\/(?:www\.)?supjav\.[a-z]{2,6}/, base);
            if (POST_RE.test(url)) {
                if (page > 1) return { list: [], hasNextPage: false };
                const d = await this.getDetail(url);
                return { list: [{ name: d.name, imageUrl: d.imageUrl, link: url }], hasNextPage: false };
            }
            return this.parseList(await this.get(pageUrl(url, page)), page);
        }
        if (!q) return this.getPopular(page);
        const path = page > 1 ? `${base}/page/${page}` : base + "/";
        return this.parseList(await this.get(`${path}?s=${encodeURIComponent(q)}`), page);
    }

    async getDetail(url) {
        const html = await this.get(url);
        const doc = new Document(html);
        const meta = (p) => {
            const m = first(doc, `meta[property="${p}"]`);
            return m ? String(m.attr("content") || "").trim() : "";
        };
        const h1 = first(doc, "h1");
        const name = (h1 ? String(h1.text || "").trim() : "") || meta("og:title");
        const imageUrl = meta("og:image");
        const genre = [];
        for (const a of doc.select("a[rel=tag], a[href*='/tag/'], a[href*='/category/']")) {
            const t = String(a.text || "").trim();
            if (t && t.length < 40 && genre.indexOf(t) < 0) genre.push(t);
        }
        const description = meta("og:description");
        return {
            name, imageUrl, description, genre, status: 1, link: url,
            episodes: [{ name: "1 재생", url, dateUpload: String(Date.now()) }],
        };
    }

    // ================= 재생 =================
    async getVideoList(url) {
        if (typeof evaluateJavascriptViaWebview !== "function") throw new Error("이 망가요미 버전은 웹뷰 재생을 지원하지 않아요.");
        const servers = await this.serverFrames(url);
        if (!servers.length) throw new Error("재생 서버를 못 찾았어요. 웹뷰로 작품 화면이 열리는지(확인 통과) 봐 주세요.");
        const out = [];
        const why = [];
        for (const s of servers.slice(0, MAX_SERVERS)) {
            const got = await this.playFrame(s, url);
            if (got.videos.length) out.push(...got.videos);
            else why.push(`${s.name}: ${got.why}`);
        }
        if (!out.length) throw new Error(`영상 주소를 못 찾았어요 [${why.join(" / ").substring(0, 200)}]`);
        return out;
    }

    /** 작품 화면에서 서버 버튼을 하나씩 눌러 생기는 재생 화면(iframe) 주소를 모음 */
    async serverFrames(url) {
        const script = "(function(){var out=[],seen={};" +
            "function frame(){var f=document.querySelectorAll('iframe');for(var i=0;i<f.length;i++){var s=f[i].src||f[i].getAttribute('data-src')||'';" +
            "if(/^https?:/.test(s)&&!/google|facebook|twitter|disqus|recaptcha/.test(s))return s;}return '';}" +
            "var b=document.querySelectorAll('.btn-server, .btns a, [data-link]');var i=0;" +
            "var f0=frame();if(f0){seen[f0]=1;out.push({name:'기본',src:f0});}" +
            "function step(){if(i>=b.length||i>=8){window.flutter_inappwebview.callHandler('setResponse',JSON.stringify(out));return;}" +
            "var btn=b[i++];var nm=(btn.textContent||'').trim().substring(0,20)||('서버'+i);try{btn.click();}catch(e){}" +
            "var n=0;var t=setInterval(function(){n++;var s=frame();if((s&&!seen[s])||n>10){clearInterval(t);" +
            "if(s&&!seen[s]){seen[s]=1;out.push({name:nm,src:s});}step();}},200);}" +
            "setTimeout(step,500);})();";
        try {
            const timeout = new Promise((r) => setTimeout(() => r(null), 25000));
            const res = await Promise.race([evaluateJavascriptViaWebview(url, { "Referer": `${this.getBaseUrl()}/` }, [script]), timeout]);
            const list = JSON.parse(String(res || "[]"));
            return Array.isArray(list) ? list.filter((s) => s && /^https?:\/\//.test(s.src)) : [];
        } catch (e) {
            return [];
        }
    }

    /** 재생 화면을 웹뷰로 열어 최종 주소와 플레이어가 불러온 영상 주소를 받음 */
    async playFrame(server, pageUrl) {
        const script = "(function(){var n=0;function find(){var r=performance.getEntriesByType('resource');" +
            "for(var i=0;i<r.length;i++){if(/\\.m3u8(\\?|$)/.test(r[i].name))return r[i].name;}" +
            "var v=document.querySelector('video');var s=v&&(v.currentSrc||v.src);if(s&&/^https?:/.test(s))return s;" +
            "for(var j=0;j<r.length;j++){if(/\\.mp4(\\?|$)/.test(r[j].name))return r[j].name;}return '';}" +
            "var t=setInterval(function(){n++;var u=find();if(u||n>=40){clearInterval(t);" +
            "window.flutter_inappwebview.callHandler('setResponse',JSON.stringify({href:location.href,media:u}));return;}" +
            "if(n===8||n===20){var v=document.querySelector('video');if(v){v.muted=true;try{v.play();}catch(e){}}" +
            "var b=document.querySelector('.jw-icon-display,.vjs-big-play-button,.plyr__control--overlaid,.play-button,#play');if(b)b.click();}},300);})();";
        let info = null;
        try {
            const timeout = new Promise((r) => setTimeout(() => r(null), 16000));
            const res = await Promise.race([evaluateJavascriptViaWebview(server.src, { "Referer": pageUrl }, [script]), timeout]);
            info = res ? JSON.parse(String(res)) : null;
        } catch (e) {
            info = null;
        }
        const href = info && /^https?:\/\//.test(info.href || "") ? info.href : server.src;
        const origin = (/^https?:\/\/[^/]+/.exec(href) || [""])[0];
        const host = origin.replace(/^https?:\/\//, "");
        const label = `${server.name} · ${host}`;
        const videos = [];
        if (info && /^https?:\/\//.test(info.media || "")) {
            const headers = { "Referer": origin + "/", "Origin": origin };
            videos.push({ url: info.media, originalUrl: info.media, quality: label, headers });
        }
        if (!videos.length) {
            const ext = await this.builtIn(href, server.name);
            videos.push(...ext);
        }
        return { videos, why: info ? `${host} 영상 없음` : "웹뷰 응답 없음" };
    }

    /** 앱에 들어 있는 재생 서버 추출기 (있는 것만) */
    async builtIn(url, name) {
        const pre = `${name} `;
        const tries = [
            [/dood|ds2play|d0o0d|do0od|d000d/i, "doodExtractor", () => doodExtractor(url)],
            [/streamtape|stape|tapeadv/i, "streamTapeExtractor", () => streamTapeExtractor(url, pre)],
            [/voe/i, "voeExtractor", () => voeExtractor(url, pre)],
            [/wish|swhoi|swdyu|strwish/i, "streamWishExtractor", () => streamWishExtractor(url, pre)],
            [/filemoon|moon/i, "filemoonExtractor", () => filemoonExtractor(url, pre, "")],
            [/mp4upload/i, "mp4UploadExtractor", () => mp4UploadExtractor(url, {}, pre, "")],
        ];
        for (const [re, , call] of tries) {
            if (!re.test(url)) continue;
            try {
                const r = await call();
                if (r && r.length) return r;
            } catch (e) {
                // 앱에 이 추출기가 없거나 실패 → 다음 방법
            }
        }
        return [];
    }

    getFilterList() {
        return [
            { type_name: "HeaderFilter", name: `📡 주소: ${this.getBaseUrl().replace(/^https?:\/\//, "")}` },
            { type_name: "HeaderFilter", name: "인기 = 설정의 목록 주소(조회순), 최신 = 같은 목록 기본 순서" },
            { type_name: "HeaderFilter", name: "검색창에 사이트 목록·작품 주소를 붙여 넣으면 그 화면을 바로 열어요" },
        ];
    }

    getSourcePreferences() {
        return [{
            key: "supjav_list",
            editTextPreference: {
                title: "인기·최신 목록 주소",
                summary: "비워 두면 기본 목록(maker/switch, 조회순)을 사용합니다.",
                value: "",
                dialogTitle: "목록 주소",
                dialogMessage: "사이트의 분류 화면 주소 (예: https://supjav.com/category/maker/switch?sort=views)",
            },
        }, {
            key: "supjav_domain",
            editTextPreference: {
                title: "사이트 주소 직접 지정 (선택)",
                summary: "비워 두면 https://supjav.com 을 사용합니다.",
                value: "",
                dialogTitle: "사이트 주소",
                dialogMessage: "https:// 로 시작하는 주소",
            },
        }];
    }
}
