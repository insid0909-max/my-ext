const mangayomiSources = [{
    "name": "xHamster",
    "lang": "ko",
    "baseUrl": "https://xhamster1.desi",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/insid0909-max/my-ext/main/icon.png",
    "typeSource": "single",
    "itemType": 1,
    "isNsfw": true,
    "hasCloudflare": false,
    "version": "0.0.2",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "anime/xhamster.js"
}];

// 개인용 xHamster 소스 (2026-10-28 xhamster1.desi 구조 확인)
// - 목록·검색·작품 정보는 화면 안의 window.initials JSON (videoThumbProps: title·pageURL·thumbURL·duration·created)
// - 목록 주소: [/gay|/shemale] + [/categories/{slug} + [/hd|/4k] | [/hd|/4k]] + [정렬 /newest·/best[/weekly|/monthly]·/most-viewed[…]] + [/쪽]
//   검색: /search/{q}?page=N[&sort=newest|views]
// - 영상: 화면 head 의 <link rel="preload" href="…_TPL_.av1.mp4.m3u8"> (화질 묶음 목록) + 같은 주소의 .h264 판,
//   모바일 화면이면 <video class="…no-script-video" src="…480p.h264.mp4">. 암호처럼 된 xplayerSettings.sources 는 풀지 않음
// - 설정은 반드시 try 안에서 읽음 (설치 때 getHeaders·getFilterList 가 불림)
const DEFAULT_BASE_URL = "https://xhamster1.desi";
const DOMAIN_RE = /^https:\/\/(?:[a-z]{2}\.)?xhamster\d*\.[a-z]{2,8}$/;
const SITE_RE = /^https?:\/\/(?:[a-z]{2}\.)?xhamster\d*\.[a-z]{2,8}/;
const LABEL = "xHamster";

const ORIENTS = [["일반", ""], ["게이", "/gay"], ["쉬메일", "/shemale"]];
const FORMATS = [["전체", ""], ["HD", "/hd"], ["4K", "/4k"]];
const SORTS = [
    ["추천 (기본)", ""], ["최신", "/newest"], ["인기 전체", "/best"], ["인기 이번 주", "/best/weekly"],
    ["인기 이번 달", "/best/monthly"], ["조회 전체", "/most-viewed"], ["조회 이번 주", "/most-viewed/weekly"],
    ["조회 이번 달", "/most-viewed/monthly"],
];
// 검색 정렬 (사이트 검색은 관련순·최신·조회수만)
const SEARCH_SORTS = { "/newest": "newest", "/most-viewed": "views", "/most-viewed/weekly": "views", "/most-viewed/monthly": "views" };
// 카테고리 (사이트 /categories 화면의 분류 묶음 그대로, 2026-10-28)
const CAT_GROUPS = [
    ["제작", [["3D", "3d"], ["Amateur", "amateur"], ["Behind the Scenes", "behind-the-scenes"], ["Caption", "caption"], ["Cartoon", "cartoon"], ["Close-up", "close-up"], ["Compilation", "compilation"], ["Erotica", "erotica"], ["Funny", "funny"], ["Gonzo", "gonzo"], ["Hentai", "hentai"], ["Homemade", "homemade"], ["Interactive", "interactive"], ["JAV", "jav"], ["PMV", "pmv"], ["POV", "pov"], ["Pornstar", "pornstar"], ["Retro", "retro"], ["Show", "show"], ["Softcore", "softcore"], ["Story", "story"], ["Uncensored", "uncensored"], ["Vintage", "vintage"], ["Webcam", "webcam"]]],
    ["행위", [["69", "69"], ["Anal", "anal"], ["Anal Masturbation", "anal-masturbation"], ["Ass Licking", "ass-licking"], ["Ass to Mouth", "ass-to-mouth"], ["Blowbang", "blowbang"], ["Blowjob", "blowjob"], ["Brutal Sex", "brutal-sex"], ["Bukkake", "bukkake"], ["Cowgirl", "cowgirl"], ["Creampie", "creampie"], ["Cum Swallowing", "cum-swallowing"], ["Cum in Mouth", "cum-in-mouth"], ["Cum on Feet", "cum-on-feet"], ["Cum on Tits", "cum-on-tits"], ["Cumshot", "cumshot"], ["Cumswap", "cumswap"], ["Cunnilingus", "cunnilingus"], ["Deep Throat", "deep-throat"], ["Dirty Talk", "dirty-talk"], ["Doggy Style", "doggy-style"], ["Double Penetration", "double-penetration"], ["Dry Humping", "dry-humping"], ["Eating Pussy", "eating-pussy"], ["Edging", "edging"], ["Extreme Insertion", "extreme-insertion"], ["Face Fuck", "face-fuck"], ["Facesitting", "facesitting"], ["Facial", "facial"], ["Female Masturbation", "female-masturbation"], ["Fingering", "fingering"], ["Fisting", "fisting"], ["Flashing", "flashing"], ["Footjob", "footjob"], ["Foreplay", "foreplay"], ["Gaping", "gaping"], ["Handjob", "handjob"], ["Happy Ending", "happy-ending"], ["Humping", "humping"], ["Kissing", "kissing"], ["Massage", "massage"], ["Missionary", "missionary"], ["Moaning", "moaning"], ["Orgasm", "orgasm"], ["Pegging", "pegging"], ["Prostate Massage", "prostate-massage"], ["Riding", "riding"], ["Rimjob", "rimjob"], ["Rough Anal", "rough-anal"], ["Rough Sex", "rough-sex"], ["Scissoring", "scissoring"], ["Screaming", "screaming"], ["Shaving", "shaving"], ["Squirting", "squirting"], ["Striptease", "striptease"], ["Titty Fucking", "titty-fucking"], ["Twerking", "twerking"], ["Yoga", "yoga"]]],
    ["페티시", [["Ahegao", "ahegao"], ["Armpit", "armpit"], ["BDSM", "bdsm"], ["Ballbusting", "ballbusting"], ["Balloon", "balloon"], ["Belly Fetish", "belly-fetish"], ["Body Hair Fetish", "body-hair-fetish"], ["Body Paint", "body-paint"], ["Bondage", "bondage"], ["CBT", "cbt"], ["CEI", "cei"], ["Chastity", "chastity"], ["Condom", "condom"], ["Dogging", "dogging"], ["Domination", "domination"], ["Estim", "estim"], ["Face Fetish", "face-fetish"], ["Farting", "farting"], ["Femdom", "femdom"], ["Fetish", "fetish"], ["Food", "food"], ["Foot Fetish", "foot-fetish"], ["Foot Worship", "foot-worship"], ["Futanari", "futanari"], ["Gokkun", "gokkun"], ["Gyno Fetish", "gyno-fetish"], ["Hand Fetish", "hand-fetish"], ["Hogtied", "hogtied"], ["Human Ashtray", "human-ashtray"], ["Human Furniture", "human-furniture"], ["Humiliation", "humiliation"], ["Kinky", "kinky"], ["Lactating", "lactating"], ["Lezdom", "lezdom"], ["Milk", "milk"], ["Mind Control", "mind-control"], ["Mouth Fetish", "mouth-fetish"], ["Oiled", "oiled"], ["Orgasm Control", "orgasm-control"], ["Pedal Pumping", "pedal-pumping"], ["Pet Play", "pet-play"], ["Pissing", "pissing"], ["Predicament Bondage", "predicament-bondage"], ["Punishment", "punishment"], ["Raceplay", "raceplay"], ["Shibari", "shibari"], ["Sissy", "sissy"], ["Small Penis Encouragement", "small-penis-encouragement"], ["Small Penis Humiliation", "small-penis-humiliation"], ["Smoking", "smoking"], ["Smothering", "smothering"], ["Spanking", "spanking"], ["Spitting", "spitting"], ["Submissive", "submissive"], ["Suspension Bondage", "suspension-bondage"], ["Tape Bondage", "tape-bondage"], ["Tickling", "tickling"], ["Tied Up", "tied-up"], ["Trampling", "trampling"], ["Wax Play", "wax-play"], ["Wedgie", "wedgie"], ["Weird", "weird"], ["Wet and Messy", "wet-messy"], ["Whipping", "whipping"], ["Wrestling", "wrestling"]]],
    ["성향", [["Bisexual", "bisexual"], ["Lesbian", "lesbian"]]],
    ["나이", [["18 Year Old", "18-year-old"], ["Babe", "babe"], ["Cougar", "cougar"], ["GILF", "gilf"], ["Granny", "granny"], ["MILF", "milf"], ["Mature", "mature"], ["Old & Young", "old-young"], ["Old man", "old-man"], ["Teen", "teen"]]],
    ["인종", [["AMWF", "amwf"], ["African", "african"], ["American", "american"], ["Arab", "arab"], ["Asian", "asian"], ["Black", "black"], ["Desi", "desi"], ["European", "european"], ["Interracial", "interracial"], ["Jewish", "jewish"], ["Latina", "latina"], ["Mzansi", "mzansi"]]],
    ["몸", [["Amputee", "amputee"], ["Ass", "ass"], ["BBC", "bbc"], ["BBW", "bbw"], ["BWC", "bwc"], ["Beauty", "beauty"], ["Big Ass", "big-ass"], ["Big Clit", "big-clit"], ["Big Cock", "big-cock"], ["Big Natural Tits", "big-natural-tits"], ["Big Nipples", "big-nipples"], ["Big Tits", "big-tits"], ["Cameltoe", "cameltoe"], ["Chubby", "chubby"], ["Clit", "clit"], ["Cute", "cute"], ["Exotic", "exotic"], ["FBB", "fbb"], ["Fake Tits", "fake-tits"], ["Flexible", "flexible"], ["Giant", "giant"], ["Giantess", "giantess"], ["Hairy", "hairy"], ["Hermaphrodite", "hermaphrodite"], ["Legs", "legs"], ["Midget", "midget"], ["Monster Cock", "monster-cock"], ["Muscular Woman", "muscular-woman"], ["Nipples", "nipples"], ["Nude", "nude"], ["PAWG", "pawg"], ["Perfect Body", "perfect-body"], ["Petite", "petite"], ["Piercing", "piercing"], ["Pregnant", "pregnant"], ["Puffy Nipples", "puffy-nipples"], ["Pussy", "pussy"], ["SSBBW", "ssbbw"], ["Saggy Tits", "saggy-tits"], ["Skinny", "skinny"], ["Small Tits", "small-tits"], ["Tan Girl", "tan-girl"], ["Tattoo", "tattoo"], ["Tight Pussy", "tight-pussy"], ["Tits", "tits"]]],
    ["머리", [["Blonde", "blonde"], ["Brunette", "brunette"], ["Colored Hair", "colored-hair"], ["Long Hair", "long-hair"], ["Redhead", "redhead"], ["Short Hair", "short-hair"]]],
    ["인원", [["Couple", "couple"], ["Foursome", "foursome"], ["Gangbang", "gangbang"], ["Group Sex", "group-sex"], ["Orgy", "orgy"], ["Solo", "solo"], ["Threesome", "threesome"]]],
    ["도구", [["Anal Beads", "anal-beads"], ["Ball Gagged", "ball-gagged"], ["Blindfolded", "blindfolded"], ["Butt Plug", "butt-plug"], ["Dildo", "dildo"], ["Double Dildo", "double-dildo"], ["Enema", "enema"], ["Fucking Machine", "fucking-machine"], ["Hitachi", "hitachi"], ["Pussy Pump", "pussy-pump"], ["Sex Toy", "sex-toy"], ["Strapon", "strapon"], ["Sybian", "sybian"], ["Vibrator", "vibrator"]]],
    ["옷", [["Bikini", "bikini"], ["Bodystocking", "bodystocking"], ["Bra", "bra"], ["Fishnet", "fishnet"], ["Glasses", "glasses"], ["Gloves", "gloves"], ["High Heels", "high-heels"], ["Jeans", "jeans"], ["Latex", "latex"], ["Leather", "leather"], ["Leggings", "leggings"], ["Lingerie", "lingerie"], ["Masked", "masked"], ["Nylon", "nylon"], ["Panties", "panties"], ["Pantyhose", "pantyhose"], ["School Uniform", "school-uniform"], ["Skirt", "skirt"], ["Socks", "socks"], ["Spandex", "spandex"], ["Stockings", "stockings"], ["Thong", "thong"], ["Uniform", "uniform"]]],
    ["상황", [["ASMR", "asmr"], ["Agent", "agent"], ["Alien", "alien"], ["Audition", "audition"], ["Babysitter", "babysitter"], ["Baddie", "baddie"], ["Birthday", "birthday"], ["Body Swap", "body-swap"], ["Boss", "boss"], ["Bunny", "bunny"], ["CFNM", "cfnm"], ["CMNF", "cmnf"], ["Casting", "casting"], ["Catfight", "catfight"], ["Celebrity", "celebrity"], ["Cheating", "cheating"], ["Cheerleader", "cheerleader"], ["Clown", "clown"], ["Coed", "coed"], ["Comic", "comic"], ["Cook", "cook"], ["Cosplay", "cosplay"], ["Cuckold", "cuckold"], ["Daddy", "daddy"], ["Dance", "dance"], ["Doctor", "doctor"], ["Doll", "doll"], ["E-girl", "e-girl"], ["Emo", "emo"], ["Escort", "escort"], ["Fantasy", "fantasy"], ["Fighting", "fighting"], ["First Time", "first-time"], ["Game", "game"], ["Gamer Girl", "gamer-girl"], ["Ghetto", "ghetto"], ["Girlfriend", "girlfriend"], ["Glory Hole", "glory-hole"], ["Gothic", "gothic"], ["Halloween", "halloween"], ["Hardcore", "hardcore"], ["Horror", "horror"], ["Housewife", "housewife"], ["Interview", "interview"], ["JOI", "joi"], ["Maid", "maid"], ["Medical", "medical"], ["Medieval", "medieval"], ["Military", "military"], ["Mistress", "mistress"], ["Mom", "mom"], ["Monster", "monster"], ["Morning", "morning"], ["Naughty", "naughty"], ["Neighbor", "neighbor"], ["Nerd", "nerd"], ["Nudist", "nudist"], ["Nun", "nun"], ["Nurse", "nurse"], ["Nympho", "nympho"], ["Parody", "parody"], ["Party", "party"], ["Passionate", "passionate"], ["Pick Up", "pick-up"], ["Plumber", "plumber"], ["Police", "police"], ["Princess", "princess"], ["Public Nudity", "public-nudity"], ["Public Sex", "public-sex"], ["Reverse Gangbang", "reverse-gangbang"], ["Role Play", "role-play"], ["Romantic", "romantic"], ["Secretary", "secretary"], ["Seduce", "seduce"], ["Sex Instruction", "sex-instruction"], ["Slave", "slave"], ["Sport", "sport"], ["Stranger", "stranger"], ["Stuck", "stuck"], ["Student", "student"], ["Superhero", "superhero"], ["Surprise", "surprise"], ["Swingers", "swingers"], ["Taboo", "taboo"], ["Teacher", "teacher"], ["Time Stop", "time-stop"], ["Truth or Dare", "truth-or-dare"], ["Twins", "twins"], ["Upskirt", "upskirt"], ["Valentine's Day", "valentines-day"], ["Vampire", "vampire"], ["Virgin", "virgin"], ["Voyeur", "voyeur"], ["Waitress", "waitress"], ["Wedding", "wedding"], ["Wife", "wife"], ["Wife Sharing", "wife-sharing"], ["Wife Swap", "wife-swap"], ["Xmas", "xmas"]]],
    ["장소", [["Bathroom", "bathroom"], ["Beach", "beach"], ["Bus", "bus"], ["Car", "car"], ["College", "college"], ["Farm", "farm"], ["Fitness", "fitness"], ["Gym", "gym"], ["Hospital", "hospital"], ["Hotel", "hotel"], ["Jungle", "jungle"], ["Kitchen", "kitchen"], ["Office", "office"], ["Outdoor", "outdoor"], ["Pool", "pool"], ["Prison", "prison"], ["Sauna", "sauna"], ["Shower", "shower"], ["Taxi", "taxi"], ["Toilet", "toilet"], ["Train", "train"], ["Underwater", "underwater"], ["Village", "village"]]],
];
const FILTER_DEFS = [["방향", ORIENTS], ["화질", FORMATS], ["정렬", SORTS]]
    .concat(CAT_GROUPS.map((g) => [`카테고리 · ${g[0]}`, [["전체", ""]].concat(g[1])]));
const RULE_SIZES = FILTER_DEFS.map((d) => d[1].length);
const DEFAULT_POPULAR = RULE_SIZES.map((_, i) => (i === 2 ? 3 : 0));
const DEFAULT_LATEST = RULE_SIZES.map((_, i) => (i === 2 ? 1 : 0));

function ruleText(i) {
    const parts = [];
    for (let k = 0; k < FILTER_DEFS.length; k++) {
        if (k === 2 || i[k] > 0) parts.push(FILTER_DEFS[k][1][i[k]][0]);
    }
    return parts.join(" · ");
}

function first(el, css) {
    const l = el ? el.select(css) : [];
    return l && l.length ? l[0] : null;
}

/** 화면 안의 window.initials JSON */
function initials(html) {
    const i = html.indexOf("window.initials=");
    if (i < 0) return null;
    const j = html.indexOf("</script>", i);
    let js = html.substring(i + 16, j < 0 ? undefined : j).trim();
    if (js.endsWith(";")) js = js.substring(0, js.length - 1);
    try {
        return JSON.parse(js);
    } catch (e) {
        return null;
    }
}

/** JSON 안의 영상 카드 목록 중 가장 큰 것 (목록 화면 videoListProps·검색 searchResult 등) */
function thumbList(o) {
    let best = [];
    const walk = (x, depth) => {
        if (!x || depth > 8 || typeof x !== "object") return;
        if (Array.isArray(x)) {
            if (x.length && x[0] && typeof x[0] === "object" && x[0].pageURL && x[0].duration !== undefined && x.length > best.length) best = x;
            for (const y of x.slice(0, 5)) walk(y, depth + 1);
            return;
        }
        for (const k in x) walk(x[k], depth + 1);
    };
    walk(o, 0);
    return best;
}

/** 마지막 쪽 번호 (paginationProps.lastPageNumber · pagination.maxPage) */
function lastPage(o) {
    let n = 0;
    const walk = (x, depth) => {
        if (!x || depth > 6 || typeof x !== "object") return;
        if (!Array.isArray(x)) {
            if (typeof x.lastPageNumber === "number") n = Math.max(n, x.lastPageNumber);
            if (typeof x.maxPage === "number" && x.pageLinkTemplate) n = Math.max(n, x.maxPage);
        }
        for (const k in x) walk(x[k], depth + 1);
    };
    walk(o, 0);
    return n;
}

function hms(sec) {
    sec = Number(sec) || 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(s).padStart(2, "0")}`;
}

function count(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return String(n);
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
        const v = this.pref("xh_domain").replace(/\/+$/, "");
        if (DOMAIN_RE.test(v)) return v;
        let auto = "";
        try {
            auto = String(new SharedPreferences().getString("xh_auto_domain", "") || "").trim();
        } catch (e) {
            auto = "";
        }
        return DOMAIN_RE.test(auto) ? auto : DEFAULT_BASE_URL;
    }

    saveAuto(origin) {
        try {
            new SharedPreferences().setString("xh_auto_domain", origin);
        } catch (e) {
            // 저장 실패 시 이번만
        }
    }

    getHeaders(url) {
        const origin = (/^https?:\/\/[^/]+/.exec(String(url || "")) || [DEFAULT_BASE_URL])[0];
        return { "Referer": `${origin}/` };
    }

    /** 진짜 xHamster 화면인지 (영상 카드 JSON 이 있음) */
    async isSite(origin) {
        try {
            const res = await this.client.get(`${origin}/newest`, { "Referer": `${origin}/` });
            const body = String(res.body || "");
            return res.statusCode < 400 && body.indexOf("window.initials=") >= 0 && /xhamster/i.test(body);
        } catch (e) {
            return false;
        }
    }

    /** 지금 주소가 안 열릴 때: 같은 이름의 번호 주소(+1~+5, -1~-2)와 번호 없는 주소를 확인 */
    async discover() {
        const cur = this.getBaseUrl();
        const m = /^https:\/\/((?:[a-z]{2}\.)?xhamster)(\d*)(\.[a-z]{2,8})$/.exec(cur);
        if (!m) return null;
        const n = Number(m[2] || 0);
        const cands = [];
        for (const d of [1, 2, 3, 4, 5, -1, -2]) if (n + d >= 1) cands.push(`https://${m[1]}${n + d}${m[3]}`);
        if (m[2]) cands.push(`https://${m[1]}${m[3]}`);
        for (const c of cands) {
            if (await this.isSite(c)) {
                this.saveAuto(c);
                return c;
            }
        }
        return null;
    }

    async get(url, retried) {
        await siteWait();
        let res = null;
        let err = "";
        try {
            res = await this.client.get(url, this.getHeaders(this.getBaseUrl()));
        } catch (e) {
            err = String((e && e.message) || e).substring(0, 80);
        }
        const body = res ? String(res.body || "") : "";
        const broken = !res || (res.statusCode >= 500) || (res.statusCode !== 404 && res.statusCode >= 400) || body.indexOf("window.initials=") < 0;
        if (broken && !retried && SITE_RE.test(url)) {
            // 주소가 바뀐 것 같으면 찾아보고 새 주소로 한 번 더
            const found = await this.discover();
            if (found) return this.get(url.replace(SITE_RE, found), true);
        }
        if (!res) throw new Error(`xHamster 접속 실패: ${err}. 주소가 바뀌었으면 새 사이트 주소를 검색창에 붙여 넣어 주세요.`);
        if (res.statusCode >= 400) {
            throw new Error(`xHamster 접속 실패 (HTTP ${res.statusCode}). 주소가 바뀌었으면 새 사이트 주소를 검색창에 붙여 넣어 주세요.`);
        }
        return body;
    }

    parseList(html, page) {
        const data = initials(html);
        if (!data) throw new Error("xHamster 목록을 읽지 못했어요 (화면 모양이 바뀐 것 같아요)");
        const list = thumbList(data).filter((v) => v && v.pageURL && /\/videos\//.test(v.pageURL)).map((v) => {
            const link = String(v.pageURL).replace(SITE_RE, this.getBaseUrl()) + (v.created ? `#c=${v.created}` : "");
            return { name: String(v.title || "").trim(), imageUrl: v.thumbURL || v.imageURL || "", link };
        });
        const last = lastPage(data);
        return { list, hasNextPage: list.length > 0 && (last ? page < last : list.length >= 20) };
    }

    /** 필터 번호들로 목록 주소 */
    listUrl(idx, page) {
        let cat = "";
        for (let k = 3; k < FILTER_DEFS.length; k++) {
            if (idx[k] > 0) {
                cat = FILTER_DEFS[k][1][idx[k]][1];
                break;
            }
        }
        const fmt = FORMATS[idx[1]][1];
        let path = ORIENTS[idx[0]][1] + (cat ? `/categories/${cat}${fmt}` : fmt) + SORTS[idx[2]][1];
        if (page > 1) path += `/${page}`;
        return this.getBaseUrl() + (path || "/");
    }

    async getPopular(page) {
        await notesRefresh(this.client);
        const idx = ruleRead("xh", true, RULE_SIZES) || DEFAULT_POPULAR;
        return this.parseList(await this.get(this.listUrl(idx, page)), page);
    }

    get supportsLatest() {
        return true;
    }

    async getLatestUpdates(page) {
        const idx = ruleRead("xh", false, RULE_SIZES) || DEFAULT_LATEST;
        return this.parseList(await this.get(this.listUrl(idx, page)), page);
    }

    async search(query, page, filters) {
        const q = String(query || "").trim();
        // 사이트 주소(https:// 없어도) 붙여 넣기: 진짜 사이트면 그 주소로 바꿈. 작품이면 그 작품, 목록이면 그 목록, 주소만이면 인기 목록
        const site = /^(?:https?:\/\/)?((?:[a-z]{2}\.)?xhamster\d*\.[a-z]{2,8})(\/[^\s]*)?$/i.exec(q);
        if (site) {
            const origin = `https://${site[1].toLowerCase()}`;
            if (origin !== this.getBaseUrl()) {
                if (!(await this.isSite(origin))) throw new Error(`${site[1]} 는 xHamster 화면이 아니에요. 주소를 다시 확인해 주세요.`);
                this.saveAuto(origin);
            }
            const path = site[2] || "/";
            if (/^\/videos\//.test(path)) {
                if (page > 1) return { list: [], hasNextPage: false };
                const url = this.getBaseUrl() + path.split("#")[0];
                const d = await this.getDetail(url);
                return { list: [{ name: d.name, imageUrl: d.imageUrl, link: url }], hasNextPage: false };
            }
            if (path === "/") return this.getPopular(page);
            const base = this.getBaseUrl() + path.replace(/\/\d+$/, "").replace(/\/+$/, "");
            const url = /\?/.test(base) ? base + `&page=${page}` : page > 1 ? `${base}/${page}` : base;
            return this.parseList(await this.get(url), page);
        }
        const idx = RULE_SIZES.map(() => 0);
        let rule = 0;
        for (const f of filters || []) {
            if (!f || f.type_name !== "SelectFilter") continue;
            const k = FILTER_DEFS.findIndex((d) => d[0] === f.name);
            if (k >= 0) idx[k] = Math.min(Math.max(Number(f.state) || 0, 0), RULE_SIZES[k] - 1);
            else if (f.name === RULE_NAME) rule = Number(f.state) || 0;
        }
        if (q) {
            let url = `${this.getBaseUrl()}/search/${encodeURIComponent(q)}?page=${page}`;
            const s = SEARCH_SORTS[SORTS[idx[2]][1]];
            if (s) url += `&sort=${s}`;
            return this.parseList(await this.get(url), page);
        }
        if (rule) ruleApply("xh", rule, idx);
        return this.parseList(await this.get(this.listUrl(idx, page)), page);
    }

    async getDetail(url) {
        const created = Number((/#c=(\d+)/.exec(url) || [])[1] || 0);
        const html = await this.get(url.split("#")[0]);
        const data = initials(html) || {};
        const ve = data.videoEntity || {};
        const vm = data.videoModel || {};
        const doc = new Document(html);
        const og = first(doc, 'meta[property="og:image"]');
        const name = String(ve.title || (first(doc, "h1") ? first(doc, "h1").text : "") || "").trim();
        const tags = ((data.videoTagsComponent || {}).tags || []).map((t) => String(t.name || "").trim()).filter((t) => t);
        const author = (vm.channelModel && vm.channelModel.channelName) || (vm.author && vm.author.name) || "";
        const ms = created ? created * 1000 : 0;
        const r = ve.rating || {};
        const info = [
            ve.duration ? `길이 ${hms(ve.duration)}` : "",
            ve.maxResolution ? `최대 ${ve.maxResolution}` : "",
            ve.views ? `조회 ${count(ve.views)}` : "",
            r.likes !== undefined ? `👍 ${count(r.likes)} · 👎 ${count(r.dislikes)}` : "",
            ms ? `올린 날 ${ymd(ms)}` : String(ve.dateAgo || ""),
        ].filter((x) => x).join(" · ");
        return {
            // 올린 해를 제목 끝에 (MissAV 와 같은 모양)
            name: ms && name && !/\(\d{4}\)$/.test(name) ? `${name} (${ymd(ms).substring(0, 4)})` : name,
            // og:image 는 흐린 작은 그림일 때가 있어 카드 그림(thumbBig) 먼저
            imageUrl: ve.thumbBig || (og && !/16x9/.test(og.attr("content")) ? og.attr("content") : ""),
            author,
            genre: tags,
            status: 1,
            description: `${info}\n\n${String(ve.description || "").trim()}`.trim(),
            link: url,
            episodes: [{ name: ms ? `1 재생 (${ymd(ms)})` : "1 재생", url: url.split("#")[0], dateUpload: String(ms || Date.now()) }],
        };
    }

    // ================= 재생 =================
    async getVideoList(url) {
        url = url.split("#")[0];
        const html = await this.get(url);
        const origin = (/^https?:\/\/[^/]+/.exec(url) || [this.getBaseUrl()])[0];
        const headers = { "Referer": `${origin}/`, "Origin": origin };
        const unesc = (s) => String(s || "").replace(/&amp;/g, "&").replace(/\\\//g, "/");
        // 화면에 그대로 적힌 주소만 사용 (head 의 preload 화질 묶음 목록, 모바일 화면의 기본 mp4)
        const pre = (/<link[^>]+rel="preload"[^>]+href="(https:[^"]+\.m3u8[^"]*)"/.exec(html) || [])[1];
        const mp4 = (/<video[^>]+src="(https:[^"]+\.mp4[^"]*)"/.exec(html) || [])[1];
        const out = [];
        if (pre) {
            const av1 = unesc(pre);
            // 같은 주소의 H.264 판 (AV1 을 못 트는 휴대폰용). 열리는 것만
            const h264 = av1.replace(/\.av1\.mp4\.m3u8/, ".h264.mp4.m3u8");
            if (h264 !== av1 && await mediaWorks(this.client, h264, headers)) {
                // H.264: 자동 + 화질별 (144p 는 뺌)
                out.push(...(await hlsExpand(this.client, h264, `${LABEL} H.264`, headers)).filter((v) => !/ 144p$/.test(v.quality)));
            }
            // AV1: 더 작은 용량, 휴대폰에 따라 못 틀 수 있어 "자동" 하나만 (H.264 가 없으면 화질별도)
            const a = await hlsExpand(this.client, av1, /\.av1\./.test(av1) ? `${LABEL} AV1` : LABEL, headers);
            out.push(...(out.length ? a.slice(0, 1) : a.filter((v) => !/ 144p$/.test(v.quality))));
        }
        if (mp4) out.push({ url: unesc(mp4), originalUrl: unesc(mp4), quality: withRes(`${LABEL} 기본`, mp4), headers });
        if (!out.length) {
            const wv = await this.viaWebview(url);
            if (wv) out.push(...await hlsExpand(this.client, wv, `${LABEL} (웹뷰)`, headers));
        }
        if (!out.length) throw new Error("영상 주소를 못 찾았어요 [화면에 영상 주소 없음 · 웹뷰에서도 못 찾음]");
        return hlsHint(qualitySort("xh_quality", out));
    }

    /** 화면에 주소가 없을 때: 웹뷰로 열어 플레이어가 불러온 m3u8 */
    async viaWebview(url) {
        if (typeof evaluateJavascriptViaWebview !== "function") return null;
        const script = "(function(){var n=0;var t=setInterval(function(){n++;var r=performance.getEntriesByType('resource');" +
            "for(var i=0;i<r.length;i++){if(/\\.m3u8(\\?|$)/.test(r[i].name)){clearInterval(t);" +
            "window.flutter_inappwebview.callHandler('setResponse',r[i].name);return;}}" +
            "if(n===8||n===20){var v=document.querySelector('video');if(v){v.muted=true;try{v.play();}catch(e){}}}" +
            "if(n>=50){clearInterval(t);window.flutter_inappwebview.callHandler('setResponse','');}},300);})();";
        try {
            const timeout = new Promise((r) => setTimeout(() => r(null), 20000));
            const res = await Promise.race([evaluateJavascriptViaWebview(url, { "Referer": `${this.getBaseUrl()}/` }, [script]), timeout]);
            return res && /^https?:\/\//.test(String(res)) ? String(res) : null;
        } catch (e) {
            return null;
        }
    }

    // ================= 필터 · 설정 =================
    getFilterList() {
        return [
            { type_name: "HeaderFilter", name: `📡 주소: ${this.getBaseUrl().replace(/^https?:\/\//, "")}` },
            ...notesFilters("xhamster"),
            { type_name: "HeaderFilter", name: "검색창에 사이트 주소를 붙여 넣으면 그 주소로 바꾸고, 영상·목록 주소면 그 화면을 열어요" },
            { type_name: "SeparatorFilter" },
            { type_name: "HeaderFilter", name: "검색어가 있으면 정렬(최신·조회)만 적용 · 카테고리는 위에서부터 처음 고른 하나만" },
        ].concat(FILTER_DEFS.map(([name, values]) => ({
            type_name: "SelectFilter", name, state: 0,
            values: values.map((v, j) => ({ type_name: "SelectOption", name: v[0], value: String(j) })),
        })), ruleFilters("xh", RULE_SIZES, [ruleText(DEFAULT_POPULAR), ruleText(DEFAULT_LATEST)], ruleText));
    }

    getSourcePreferences() {
        return [{
            key: "xh_domain",
            editTextPreference: {
                title: "사이트 주소 직접 지정 (선택)",
                summary: "비워 두면 https://xhamster1.desi (안 열리면 번호 주소를 자동으로 찾아요)",
                value: "",
                dialogTitle: "사이트 주소",
                dialogMessage: "https:// 로 시작하는 주소 (또는 검색창에 붙여 넣기)",
            },
        }, qualityPreference("xh_quality")];
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
