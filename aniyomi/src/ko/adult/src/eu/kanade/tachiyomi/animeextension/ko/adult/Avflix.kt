package eu.kanade.tachiyomi.animeextension.ko.adult

import android.app.Application
import android.content.SharedPreferences
import android.util.Base64
import android.widget.Toast
import androidx.preference.EditTextPreference
import androidx.preference.PreferenceScreen
import eu.kanade.tachiyomi.animesource.ConfigurableAnimeSource
import eu.kanade.tachiyomi.animesource.model.AnimeFilter
import eu.kanade.tachiyomi.animesource.model.AnimeFilterList
import eu.kanade.tachiyomi.animesource.model.AnimeUpdateStrategy
import eu.kanade.tachiyomi.animesource.model.AnimesPage
import eu.kanade.tachiyomi.animesource.model.SAnime
import eu.kanade.tachiyomi.animesource.model.SEpisode
import eu.kanade.tachiyomi.animesource.model.Video
import eu.kanade.tachiyomi.animesource.online.AnimeHttpSource
import eu.kanade.tachiyomi.network.GET
import okhttp3.Headers
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import rx.Observable
import java.net.URLDecoder
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/**
 * AVFLIX (2026-11-18 사이트 새 단장 — 망가요미판 my-ext avflix.js 0.1.0 과 같은 규칙).
 * 화면은 껍데기뿐이고 자료는 모두 /api/v1/… (응답 {data:{…}}):
 * 목록 /api/v1/av/category/{code}?sort=&subtitle=&mosaic=&pageNo=&pageSize=31, 전체·검색 /api/v1/av/search?keyword=…
 * → data.list[{idx,title,thumbnail,mosaic,subtitle,productNo,actors,regDate,releaseDate}], data.paging{pageNo,finalPageNo}
 * 작품 /api/v1/av/{idx} → data{…, story, productions, categories[{name}], contentUrl(영상)}.
 * /api 는 해외에서 403 (화면은 열림). 분류 중 한국일반(general)·방송/BJ(bj) 는 몰래카메라·유출 영상 위험으로 넣지 않음.
 */
class Avflix : AnimeHttpSource(), ConfigurableAnimeSource {

    override val name = "AVFLIX"
    override val lang = "ko"
    override val supportsLatest = true

    private fun prefs(): SharedPreferences? = runCatching {
        val app = Class.forName("android.app.ActivityThread")
            .getMethod("currentApplication")
            .invoke(null) as? Application
        app?.getSharedPreferences("source_$id", 0)
    }.getOrNull()

    override val baseUrl: String
        get() {
            val p = prefs()
            var v = p?.getString(PREF_DOMAIN, "")?.trim()?.trimEnd('/').orEmpty()
            if (v.isNotEmpty() && !v.startsWith("http")) v = "https://$v"
            if (DOMAIN_REGEX.matches(v)) return v
            val auto = p?.getString(PREF_AUTO_DOMAIN, "")?.trim().orEmpty()
            // 예전에 자동으로 저장된 주소(kr5·kr7)는 쓰지 않고 기본 주소 kr6 (사용자 2026-11-18 "주소 kr6")
            return if (DOMAIN_REGEX.matches(auto) && !OLD_AUTO.containsMatchIn(auto)) auto else DEFAULT_BASE_URL
        }

    override val client: OkHttpClient = network.client.newBuilder()
        .apply { interceptors().add(0, FriendlyNet) }
        .addInterceptor { chain -> domainIntercept(chain) }
        .build()

    override fun headersBuilder(): Headers.Builder = super.headersBuilder()
        .set("Referer", "$baseUrl/")

    private fun apiHeaders(): Headers = headersBuilder().set("Accept", "application/json").build()

    // ================= 주소 자동 찾기 =================
    // 지금 주소가 안 열리면(연결 실패·5xx) 앞 글자 번호 +1~+5, -1~-2 (kr6 → kr7 …). 403 은 해외·차단이라 찾지 않음
    private fun domainIntercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        val baseHost = baseUrl.toHttpUrlOrNull()?.host
        if (baseHost == null || req.url.host != baseHost || req.method != "GET") return chain.proceed(req)
        fun retryOn(found: String): Response {
            prefs()?.edit()?.putString(PREF_AUTO_DOMAIN, "https://$found")?.apply()
            return chain.proceed(req.newBuilder().url(req.url.newBuilder().host(found).build()).build())
        }
        val res = try {
            chain.proceed(req)
        } catch (e: java.io.IOException) {
            val found = discover(baseHost) ?: throw e
            return retryOn(found)
        }
        if (res.code >= 500) {
            val found = discover(baseHost) ?: return res
            res.close()
            return retryOn(found)
        }
        return res
    }

    private val plain by lazy {
        OkHttpClient.Builder().connectTimeout(4, TimeUnit.SECONDS).readTimeout(8, TimeUnit.SECONDS).callTimeout(10, TimeUnit.SECONDS).build()
    }

    /** 진짜 AVFLIX 화면인지 (새 화면의 renewal-bootstrap 안 사이트 코드 avflix) */
    private fun isSite(host: String): Boolean = runCatching {
        plain.newCall(GET("https://$host/", Headers.headersOf("Referer", "https://$host/"))).execute().use { res ->
            res.code < 400 && SITE_CODE.containsMatchIn(res.body.string())
        }
    }.getOrDefault(false)

    @Volatile private var lastDiscover = 0L

    private fun discover(currentHost: String): String? = synchronized(LOCK) {
        val now = System.currentTimeMillis()
        if (now - lastDiscover < 60_000) return null
        lastDiscover = now
        val m = HOST_PARTS.find(currentHost) ?: return null
        val n = m.groupValues[2].toInt()
        listOf(1, 2, 3, 4, 5, -1, -2).filter { n + it >= 1 }.map { "${m.groupValues[1]}${n + it}.${m.groupValues[3]}" }
            .firstOrNull { it != currentHost && isSite(it) }
    }

    // ================= 자료 =================
    /** /api 응답 → data (실패면 이유를 담아 오류) */
    private fun data(response: Response): JSONObject {
        val body = response.body.string()
        val j = runCatching { JSONObject(body) }.getOrNull()
        // 사이트 코드와 같게: error 가 숫자 0 이면 성공 ("error":0, "message":"OK" 로 옴), 숫자 0 아닌 값·글자면 실패
        val err = j?.opt("error")
        val failed = when (err) {
            null, JSONObject.NULL -> false
            is Number -> err.toInt() != 0
            else -> err.toString().isNotEmpty()
        }
        if (!response.isSuccessful || j == null || j.optString("status") == "FAILURE" || failed) {
            val msg = j?.optString("message")?.ifEmpty { null } ?: err?.toString()?.ifEmpty { null } ?: body.replace(Regex("\\s+"), " ").take(40)
            throw Exception("AVFLIX 자료를 못 받았어요 [${response.request.url.encodedPath.removePrefix("/api")} · HTTP ${response.code} · ${msg.take(50)}]")
        }
        return j.optJSONObject("data") ?: j
    }

    private fun ruleSizes() = intArrayOf(CATS.size, SORTS.size, SUBS.size, MOSAICS.size)

    private fun query(idx: IntArray, page: Int, keyword: String? = null): String {
        val p = mutableListOf("sort=${SORTS[idx[1]].second}", "subtitle=${SUBS[idx[2]].second}", "mosaic=${MOSAICS[idx[3]].second}", "pageNo=$page", "pageSize=31")
        if (keyword != null) p.add("keyword=${enc(keyword)}")
        return p.joinToString("&")
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

    private fun listRequest(idx: IntArray, page: Int): Request {
        val (_, code, kind) = CATS[idx[0]]
        return if (kind == "section") {
            GET("$baseUrl/api/v1/main-section/${enc(code)}/items?${query(idx, page)}", apiHeaders())
        } else {
            GET("$baseUrl/api/v1/av/category/${enc(code)}?${query(idx, page)}", apiHeaders())
        }
    }

    // ================= 목록 =================
    override fun popularAnimeRequest(page: Int): Request = listRequest(TabRule.read(prefs(), true, ruleSizes()) ?: DEFAULT_POPULAR, page)

    override fun popularAnimeParse(response: Response): AnimesPage = parseList(response)

    override fun latestUpdatesRequest(page: Int): Request = listRequest(TabRule.read(prefs(), false, ruleSizes()) ?: DEFAULT_LATEST, page)

    override fun latestUpdatesParse(response: Response): AnimesPage = parseList(response)

    // 사이트 주소를 붙여 넣으면 그 주소로 바꾸고, 작품·분류·검색 주소면 그 화면 (https:// 없어도)
    override fun fetchSearchAnime(page: Int, query: String, filters: AnimeFilterList): Observable<AnimesPage> {
        val site = PASTE_REGEX.find(query.trim()) ?: return super.fetchSearchAnime(page, query, filters)
        val host = site.groupValues[1].lowercase()
        val path = site.groupValues[2].substringBefore('?').substringBefore('#')
        return Observable.fromCallable {
            if ("https://$host" != baseUrl) {
                if (!isSite(host)) throw Exception("$host 는 AVFLIX 화면이 아니에요. 주소를 다시 확인해 주세요.")
                prefs()?.edit()?.putString(PREF_AUTO_DOMAIN, "https://$host")?.apply()
            }
            val zero = intArrayOf(0, 0, 0, 0)
            AV_PATH.find(path)?.let { m ->
                if (page > 1) return@fromCallable AnimesPage(emptyList(), false)
                val anime = SAnime.create().apply { url = "/av/${m.groupValues[1]}" }
                val d = client.newCall(animeDetailsRequest(anime)).execute().use { animeDetailsParse(it) }
                return@fromCallable AnimesPage(listOf(d.apply { url = anime.url }), false)
            }
            CAT_PATH.find(path)?.let { m ->
                val code = runCatching { URLDecoder.decode(m.groupValues[1], "UTF-8") }.getOrDefault(m.groupValues[1])
                if (BLOCKED_CATS.matches(code)) throw Exception("이 분류는 확장에서 열지 않아요.")
                return@fromCallable client.newCall(GET("$baseUrl/api/v1/av/category/${enc(code)}?${query(zero, page)}", apiHeaders())).execute().use { parseList(it) }
            }
            SEARCH_PATH.find(path)?.let { m ->
                val k = runCatching { URLDecoder.decode(m.groupValues[1], "UTF-8") }.getOrDefault(m.groupValues[1])
                val req = if (k == "전체") listRequest(zero, page) else GET("$baseUrl/api/v1/av/search?${query(zero, page, k)}", apiHeaders())
                return@fromCallable client.newCall(req).execute().use { parseList(it) }
            }
            client.newCall(popularAnimeRequest(page)).execute().use { popularAnimeParse(it) }
        }
    }

    override fun searchAnimeRequest(page: Int, query: String, filters: AnimeFilterList): Request {
        val q = query.trim()
        val idx = intArrayOf(
            filters.filterIsInstance<CatFilter>().firstOrNull()?.state ?: 0,
            filters.filterIsInstance<SortFilter>().firstOrNull()?.state ?: 0,
            filters.filterIsInstance<SubFilter>().firstOrNull()?.state ?: 0,
            filters.filterIsInstance<MosaicFilter>().firstOrNull()?.state ?: 0,
        )
        if (q.isNotEmpty()) return GET("$baseUrl/api/v1/av/search?${query(idx, page, q)}", apiHeaders())
        filters.filterIsInstance<TabRule.RuleFilter>().firstOrNull()?.let { TabRule.apply(prefs(), it.state, idx) }
        return listRequest(idx, page)
    }

    override fun searchAnimeParse(response: Response): AnimesPage = parseList(response)

    private fun parseList(response: Response): AnimesPage {
        val body = response.peekBody(Long.MAX_VALUE).string()
        val arr = runCatching { org.json.JSONObject(body).optJSONArray("data") }.getOrNull()
        val d = if (arr != null) JSONObject().put("list", arr) else data(response)
        val list = d.optJSONArray("list") ?: d.optJSONArray("items")
        val animes = (0 until (list?.length() ?: 0)).mapNotNull { i ->
            val o = list!!.optJSONObject(i) ?: return@mapNotNull null
            val idx = o.optLong("idx")
            if (idx == 0L) return@mapNotNull null
            val (title, tag) = avTitle(o.optString("title").trim().ifEmpty { o.optString("productNo") }, o)
            val date = o.optString("releaseDate").ifEmpty { o.optString("regDate") }.take(10)
            SAnime.create().apply {
                url = "/av/$idx" + if (YMD_PARTS.matches(date)) "#d=$date" else ""
                this.title = title + tag
                thumbnail_url = o.optString("thumbnail").ifEmpty { null }
            }
        }
        val pg = d.optJSONObject("paging")
        val next = animes.isNotEmpty() && pg != null && pg.optInt("pageNo") < pg.optInt("finalPageNo")
        return AnimesPage(animes, next)
    }

    // ================= 작품 정보 =================
    override fun getAnimeUrl(anime: SAnime): String = baseUrl + anime.url.substringBefore('#')

    private fun detailRequest(url: String): Request {
        val id = AV_PATH.find(url.substringBefore('#'))?.groupValues?.get(1) ?: throw Exception("작품 주소가 아니에요")
        val frag = url.substringAfter('#', "")
        return GET("$baseUrl/api/v1/av/$id" + if (frag.isNotEmpty()) "#$frag" else "", apiHeaders())
    }

    override fun animeDetailsRequest(anime: SAnime): Request = detailRequest(anime.url)

    private fun dateMs(response: Response, d: JSONObject): Pair<Long, String?> {
        val f = response.request.url.fragment?.removePrefix("d=").orEmpty()
        val src = if (YMD_PARTS.matches(f)) f else d.optString("releaseDate").ifEmpty { d.optString("regDate") }.take(10)
        val m = YMD_PARTS.find(src) ?: return 0L to null
        val ms = Calendar.getInstance(KST).apply {
            clear()
            set(m.groupValues[1].toInt(), m.groupValues[2].toInt() - 1, m.groupValues[3].toInt())
        }.timeInMillis
        return ms to m.groupValues[1]
    }

    private fun names(d: JSONObject, key: String): List<String> {
        val a = d.optJSONArray(key) ?: return emptyList()
        return (0 until a.length()).mapNotNull { i ->
            a.optJSONObject(i)?.optString("name")?.ifEmpty { null } ?: a.optString(i).ifEmpty { null }?.takeIf { !it.startsWith("{") }
        }
    }

    /**
     * 같은 작품이 노모판(제목 가운데 "REMOVE")·유모판으로 따로 있어 검색에 두 번 보임(IPZZ-936 /av/83530 · /av/83529)
     * → "REMOVE" 는 빼고 제목 뒤에 [노모]·[자막] (MissAV·Javtiful 판 이름과 같은 모양). 돌려줌: (제목, 뒤에 붙일 판 이름)
     */
    private fun avTitle(raw: String, o: JSONObject): Pair<String, String> {
        var t = raw
        var nomo = o.has("mosaic") && !o.isNull("mosaic") && !o.optBoolean("mosaic", true)
        if (REMOVE_WORD.containsMatchIn(t)) {
            nomo = true
            t = t.replaceFirst(REMOVE_WORD, " ").replace(Regex("\\s+"), " ").trim()
        }
        val tags = listOfNotNull(
            if (o.optBoolean("subtitle") && !t.contains("자막")) "자막" else null,
            if (nomo && !t.contains("노모")) "노모" else null,
        )
        return t to if (tags.isNotEmpty()) " [${tags.joinToString("·")}]" else ""
    }

    override fun animeDetailsParse(response: Response): SAnime {
        val d = data(response)
        val (ms, year) = dateMs(response, d)
        val (name, tag) = avTitle(d.optString("title").trim().ifEmpty { d.optString("productNo") }, d)
        val cast = names(d, "actors").joinToString(", ")
        val maker = names(d, "productions").joinToString(", ")
        val secs = d.optInt("duration")
        val length = when {
            secs >= 3600 -> "${secs / 3600}시간 ${(secs % 3600) / 60}분"
            secs > 0 -> "${(secs + 30) / 60}분"
            else -> ""
        }
        val info = listOfNotNull(
            length.ifEmpty { null }?.let { "길이 $it" },
            if (ms > 0) "출시일 ${ymd(ms)}" else null,
            cast.ifEmpty { null }?.let { "출연 $it" },
            maker.ifEmpty { null }?.let { "제작사 $it" },
        ).joinToString(" · ")
        return SAnime.create().apply {
            title = (if (year != null && name.isNotEmpty() && !TITLE_YEAR.containsMatchIn(name)) "$name ($year)" else name) + tag
            thumbnail_url = d.optString("thumbnail").ifEmpty { d.optString("heroImage") }.ifEmpty { null }
            author = maker.ifEmpty { null }
            artist = cast.ifEmpty { null }
            genre = names(d, "categories").joinToString(", ").ifEmpty { null }
            status = SAnime.COMPLETED
            update_strategy = AnimeUpdateStrategy.ONLY_FETCH_ONCE
            description = listOfNotNull(
                if (d.optBoolean("subtitle")) "💬 한글 자막 있음" else null,
                info,
                d.optString("story").trim(),
            ).filter { it.isNotEmpty() }.joinToString("\n\n")
        }
    }

    // ================= 회차 (영화처럼 하나: "본편") =================
    override fun episodeListRequest(anime: SAnime): Request = detailRequest(anime.url)

    override fun episodeListParse(response: Response): List<SEpisode> {
        val d = data(response)
        val (ms, _) = dateMs(response, d)
        val id = d.optLong("idx").takeIf { it > 0 }?.toString() ?: response.request.url.pathSegments.last()
        return listOf(
            SEpisode.create().apply {
                url = "/av/$id"
                name = if (ms > 0) "본편 (${ymd(ms)})" else "본편"
                episode_number = 1f
                date_upload = ms
                if (d.optBoolean("subtitle")) scanlator = "한글자막"
            },
        )
    }

    private fun ymd(ms: Long) = synchronized(YMD_FMT) { YMD_FMT.format(java.util.Date(ms)) }

    // ================= 재생 =================
    override fun videoListRequest(episode: SEpisode): Request = detailRequest(episode.url)

    override fun videoListParse(response: Response): List<Video> {
        val d = data(response)
        var v = d.optString("contentUrl").trim()
        if (v.isEmpty() || v == "null") throw Exception("재생할 수 있는 영상이 없어요 [작품 자료에 contentUrl 없음 · 로그인이 필요한 작품일 수 있어요]")
        if (!v.startsWith("http")) v = baseUrl + (if (v.startsWith("/")) "" else "/") + v
        val headers = Headers.Builder().set("Referer", "$baseUrl/").set("Origin", baseUrl).build()
        val out = mutableListOf<Video>()
        if (v.contains(".m3u8")) {
            out.addAll(HlsQuality.expand(client, v, LABEL, headers))
        } else {
            out.add(Video(v, HlsQuality.withRes(LABEL, v), v, headers))
            // CDN 이 막히면 사이트 중계 /videos/{base64url(주소)}.{확장자} (사이트 플레이어와 같은 방법)
            if (!v.startsWith(baseUrl)) {
                val ext = Regex("""\.([a-z0-9]{2,5})$""", RegexOption.IGNORE_CASE).find(v.substringBefore('?'))?.groupValues?.get(1)?.lowercase() ?: "mp4"
                val b64 = Base64.encodeToString(v.toByteArray(Charsets.UTF_8), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
                val p = "$baseUrl/videos/$b64.$ext"
                out.add(Video(p, "$LABEL (사이트 중계)", p, headers))
            }
        }
        return HlsQuality.sort(prefs(), out)
    }

    // ================= 필터 =================
    override fun getFilterList(): AnimeFilterList = ExtStatus.withNotes("avflix", baseFilters())

    private fun ruleText(i: IntArray) = listOfNotNull(
        CATS[i[0]].first,
        SORTS[i[1]].first,
        if (i[2] > 0) SUBS[i[2]].first else null,
        if (i[3] > 0) MOSAICS[i[3]].first else null,
    ).joinToString(" · ")

    private fun baseFilters(): AnimeFilterList = AnimeFilterList(
        listOf(
            AnimeFilter.Header("📡 주소: ${baseUrl.substringAfter("://")}"),
            AnimeFilter.Header("검색창에 사이트 주소를 붙여 넣으면 그 주소로 바꾸고, 작품·분류 주소면 그 화면을 열어요"),
            AnimeFilter.Separator(),
            AnimeFilter.Header("검색어가 있으면 분류는 무시 (정렬·자막·모자이크는 적용)"),
            CatFilter(),
            SortFilter(),
            SubFilter(),
            MosaicFilter(),
        ) + TabRule.filters(prefs(), ruleSizes(), ruleText(DEFAULT_POPULAR) to ruleText(DEFAULT_LATEST), ::ruleText),
    )

    class CatFilter : AnimeFilter.Select<String>("분류", CATS.map { it.first }.toTypedArray())
    class SortFilter : AnimeFilter.Select<String>("정렬", SORTS.map { it.first }.toTypedArray())
    class SubFilter : AnimeFilter.Select<String>("자막", SUBS.map { it.first }.toTypedArray())
    class MosaicFilter : AnimeFilter.Select<String>("모자이크", MOSAICS.map { it.first }.toTypedArray())

    // ================= 설정 =================
    override fun setupPreferenceScreen(screen: PreferenceScreen) {
        val ctx = screen.context
        EditTextPreference(ctx).apply {
            key = PREF_DOMAIN
            title = "사이트 주소 직접 지정 (선택)"
            summary = "비워 두면 $DEFAULT_BASE_URL (안 열리면 kr7·kr8… 를 자동으로 찾아요)\n현재 주소: $baseUrl"
            dialogMessage = "https:// 로 시작하는 주소 (또는 검색창에 붙여 넣기)"
            setDefaultValue("")
            setOnPreferenceChangeListener { _, newValue ->
                var input = (newValue as String).trim().trimEnd('/')
                if (input.isNotEmpty() && !input.startsWith("http")) input = "https://$input"
                if (input.isEmpty() || DOMAIN_REGEX.matches(input)) {
                    true
                } else {
                    Toast.makeText(ctx, "올바른 주소 형식이 아닙니다 (예: $DEFAULT_BASE_URL)", Toast.LENGTH_LONG).show()
                    false
                }
            }
        }.also(screen::addPreference)
        HlsQuality.addPreference(screen)
    }

    companion object {
        private const val PREF_DOMAIN = "pref_domain_key"
        private const val PREF_AUTO_DOMAIN = "pref_domain_key_auto"
        private const val DEFAULT_BASE_URL = "https://kr6.avflix.co"
        private val OLD_AUTO = Regex("""^https://kr[57]\.avflix\.""")
        private const val LABEL = "AVFLIX"
        private val LOCK = Any()

        private val DOMAIN_REGEX = Regex("""^https://(?:[a-z]+\d*\.)?avflix\.[a-z]{2,8}$""")
        private val HOST_PARTS = Regex("""^([a-z]+)(\d+)\.(avflix\.[a-z]{2,8})$""")
        private val PASTE_REGEX = Regex("""^(?:https?://)?((?:[a-z]+\d*\.)?avflix\.[a-z]{2,8})(/\S*)?$""", RegexOption.IGNORE_CASE)
        private val SITE_CODE = Regex("""\\?"code\\?":\\?"avflix\\?"""")
        private val AV_PATH = Regex("""/av/(\d+)""")
        private val CAT_PATH = Regex("""^/category/([^/?#]+)""")
        private val SEARCH_PATH = Regex("""^/search/([^/?#]+)""")
        private val BLOCKED_CATS = Regex("""^(?:general|bj)$""")
        private val YMD_PARTS = Regex("""^(\d{4})-(\d{2})-(\d{2})$""")
        private val TITLE_YEAR = Regex("""\(\d{4}\)$""")
        private val KST = TimeZone.getTimeZone("Asia/Seoul")
        private val YMD_FMT = SimpleDateFormat("yyyy.MM.dd", Locale.KOREA).apply { timeZone = KST }

        // 사이트에 "전체" 목록 주소는 없음(검색어 없는 검색은 400 "검색어를 입력해주세요") → 첫 화면 묶음(main-section)을 분류처럼
        // 분류는 휴대폰에서 받은 사이트 메뉴(bootstrap site.menu, 2026-11-18) 그대로 — 자막 작품은 "노모(자막)" 분류에 따로 모여 있음
        private val CATS = listOf(
            Triple("노모", "nomosaic", "category"),
            Triple("노모 (자막)", "nomosaic_sub", "category"),
            Triple("유모", "recent", "category"),
            Triple("클래식", "classic", "category"),
            Triple("2026 신작 (노모)", "nomosaic2026", "category"),
            Triple("2026 신작 (유모)", "mosaic2026", "category"),
            Triple("아시아/기타", "asia", "category"),
            Triple("SM", "sm", "category"),
            Triple("추천 TOP 20", "recommend", "section"),
            Triple("오늘의 TOP 20", "today", "section"),
        )
        private val SORTS = listOf("최신 등록순" to "reg_date", "인기순" to "view_count", "출시일순" to "release_date")
        private val SUBS = listOf("자막 전체" to "all", "자막 있음" to "subtitle", "자막 없음" to "nosubtitle")
        private val REMOVE_WORD = Regex("""\s*\bREMOVE\b\s*""")
        private val MOSAICS = listOf("모자이크 전체" to "all", "모자이크" to "mosaic", "노모자이크" to "nomosaic")

        private val DEFAULT_POPULAR = intArrayOf(0, 1, 0, 0)
        private val DEFAULT_LATEST = intArrayOf(0, 0, 0, 0)
    }
}
