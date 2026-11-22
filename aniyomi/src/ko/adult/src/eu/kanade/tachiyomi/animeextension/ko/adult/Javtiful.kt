package eu.kanade.tachiyomi.animeextension.ko.adult

import android.app.Application
import android.content.SharedPreferences
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
import eu.kanade.tachiyomi.network.POST
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.Headers
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import org.jsoup.Jsoup
import rx.Observable
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ConcurrentHashMap

/**
 * Javtiful (javtiful.com, 2026-11-17, 망가요미판 my-ext javtiful.js 0.0.2 와 같은 규칙, 해외에서 열려 구조 확인).
 * 목록 /ko/{videos|censored|uncensored|reducing-mosaic}?sort=&page=N, 카테고리 /ko/category/{이름}?sort=(popular|added_*)&video_type=,
 * 채널 /ko/channel/{slug}(정렬 없음), 검색 /ko/search?q=(정렬 없음). 카드 article.video-card, 다음 쪽 = page=N+1 링크.
 * 작품 /ko/video/{번호}/{slug}. 재생: 작품 화면 "playback":{endpoint,ticket} → POST ticket= → sources[].src(서명된 mp4 로 넘겨 줌, 1시간).
 * 쇼츠: /ko/shorts 화면 "feed":{"items":[…],"cursor"} 8개 → 다음은 /ko/shorts/feed?cursor=&exclude=&hashtag=
 * (첫 화면이 준 쿠키 shorts_guest_feeds·shorts_visitor 필요 — 앱 쿠키 저장소가 들고 다님).
 */
class Javtiful : AnimeHttpSource(), ConfigurableAnimeSource {

    override val name = "Javtiful"
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
            return if (DOMAIN_REGEX.matches(auto)) auto else DEFAULT_BASE_URL
        }

    override val client: OkHttpClient = network.client.newBuilder()
        .apply { interceptors().add(0, FriendlyNet) }
        .build()

    override fun headersBuilder(): Headers.Builder = super.headersBuilder()
        .set("Referer", "$baseUrl/")

    private fun h(): Headers = headersBuilder().build()

    // ================= 목록 =================
    private fun ruleSizes() = intArrayOf(TYPES.size, CATS.size, CHANNELS.size, SORTS.size)

    private fun isShorts(idx: IntArray) = idx[0] == SHORTS && idx[1] == 0 && idx[2] == 0

    private fun listUrl(idx: IntArray, page: Int): String {
        val base = "$baseUrl/ko"
        val q = mutableListOf<String>()
        fun add(k: String, v: String) {
            if (v.isNotEmpty()) q.add("$k=${URLEncoder.encode(v, "UTF-8")}")
        }
        val path = when {
            idx[2] > 0 -> "channel/${CHANNELS[idx[2]].second}"
            idx[1] > 0 -> {
                add("sort", SORTS[idx[3]].third)
                add("video_type", TYPES[idx[0]].third)
                "category/${URLEncoder.encode(CATS[idx[1]].second, "UTF-8")}"
            }
            else -> {
                add("sort", SORTS[idx[3]].second)
                if (idx[0] == SHORTS) "videos" else TYPES[idx[0]].second
            }
        }
        if (page > 1) add("page", page.toString())
        return "$base/$path" + if (q.isEmpty()) "" else "?" + q.joinToString("&")
    }

    // 쇼츠 다음 묶음 표: 쪽 번호 → cursor
    private val shortCursors = ConcurrentHashMap<Int, String>()

    private fun shortsRequest(page: Int): Request {
        val cursor = if (page > 1) shortCursors[page] ?: prefs()?.getString("short_cur_$page", null) else null
        if (cursor.isNullOrEmpty()) return GET("$baseUrl/ko/shorts#p=1", h())
        val hh = headersBuilder().set("Referer", "$baseUrl/ko/shorts").set("Accept", "application/json")
            .set("X-Requested-With", "XMLHttpRequest").build()
        return GET("$baseUrl/ko/shorts/feed?cursor=${URLEncoder.encode(cursor, "UTF-8")}&exclude=&hashtag=#p=$page", hh)
    }

    private fun listRequest(idx: IntArray, page: Int): Request =
        if (isShorts(idx)) shortsRequest(page) else GET(listUrl(idx, page), h())

    override fun popularAnimeRequest(page: Int): Request = listRequest(TabRule.read(prefs(), true, ruleSizes()) ?: DEFAULT_POPULAR, page)

    override fun popularAnimeParse(response: Response): AnimesPage = parseAny(response)

    override fun latestUpdatesRequest(page: Int): Request = listRequest(TabRule.read(prefs(), false, ruleSizes()) ?: DEFAULT_LATEST, page)

    override fun latestUpdatesParse(response: Response): AnimesPage = parseAny(response)

    // 사이트 주소를 붙여 넣으면 그 주소로 바꾸고, 작품·쇼츠·목록 주소면 그 화면 (https:// 없어도)
    override fun fetchSearchAnime(page: Int, query: String, filters: AnimeFilterList): Observable<AnimesPage> {
        val site = PASTE_REGEX.find(query.trim()) ?: return super.fetchSearchAnime(page, query, filters)
        val host = site.groupValues[1].lowercase()
        val path = site.groupValues[2].substringBefore('#').ifEmpty { "/" }
        return Observable.fromCallable {
            if ("https://$host" != baseUrl) {
                val ok = runCatching {
                    client.newCall(GET("https://$host/ko/main", h())).execute().use { it.code < 400 && it.body.string().contains("video-card") }
                }.getOrDefault(false)
                if (!ok) throw Exception("$host 는 Javtiful 화면이 아니에요. 주소를 다시 확인해 주세요.")
                prefs()?.edit()?.putString(PREF_AUTO_DOMAIN, "https://$host")?.apply()
            }
            val pth = path.replace(LANG_PREFIX, "/")
            when {
                VIDEO_PATH.containsMatchIn(pth) || SHORT_PATH.containsMatchIn(pth) -> {
                    if (page > 1) return@fromCallable AnimesPage(emptyList(), false)
                    val anime = SAnime.create().apply { url = "/ko" + pth.substringBefore('?') }
                    val d = client.newCall(animeDetailsRequest(anime)).execute().use { animeDetailsParse(it) }
                    AnimesPage(listOf(d.apply { url = anime.url }), false)
                }
                SHORTS_LIST.matches(pth.substringBefore('?')) -> client.newCall(shortsRequest(page)).execute().use { parseAny(it) }
                LIST_PATH.containsMatchIn(pth) -> {
                    val clean = pth.replace(PAGE_PARAM, "$1").trimEnd('?', '&')
                    val u = "$baseUrl/ko$clean" + if (page > 1) (if (clean.contains('?')) "&" else "?") + "page=$page" else ""
                    client.newCall(GET(u, h())).execute().use { parseAny(it) }
                }
                else -> client.newCall(popularAnimeRequest(page)).execute().use { popularAnimeParse(it) }
            }
        }
    }

    override fun searchAnimeRequest(page: Int, query: String, filters: AnimeFilterList): Request {
        val q = query.trim()
        val idx = intArrayOf(
            filters.filterIsInstance<TypeFilter>().firstOrNull()?.state ?: 0,
            filters.filterIsInstance<CatFilter>().firstOrNull()?.state ?: 0,
            filters.filterIsInstance<ChannelFilter>().firstOrNull()?.state ?: 0,
            filters.filterIsInstance<SortFilter>().firstOrNull()?.state ?: 0,
        )
        if (q.isNotEmpty()) {
            return GET("$baseUrl/ko/search?q=${URLEncoder.encode(q, "UTF-8")}" + if (page > 1) "&page=$page" else "", h())
        }
        filters.filterIsInstance<TabRule.RuleFilter>().firstOrNull()?.let { TabRule.apply(prefs(), it.state, idx) }
        return listRequest(idx, page)
    }

    override fun searchAnimeParse(response: Response): AnimesPage = parseAny(response)

    private fun parseAny(response: Response): AnimesPage {
        val path = response.request.url.encodedPath
        if (path.startsWith("/ko/shorts")) return parseShorts(response)
        return parseList(response)
    }

    private fun parseList(response: Response): AnimesPage {
        val html = response.body.string()
        val doc = Jsoup.parse(html, response.request.url.toString())
        val seen = HashSet<String>()
        val animes = doc.select("article.video-card").mapNotNull { card ->
            val a = card.selectFirst("a.video-card__thumbnail") ?: return@mapNotNull null
            val href = a.attr("href")
            val id = VIDEO_ID.find(href)?.groupValues?.get(1) ?: return@mapNotNull null
            if (!seen.add(id)) return@mapNotNull null
            val t = card.selectFirst("a.video-card__title")
            var title = ShortTitle.of((t?.attr("title")?.ifEmpty { null } ?: t?.text().orEmpty()).trim())
            if (title.isEmpty()) return@mapNotNull null
            val tag = card.selectFirst(".video-card__type")?.text().orEmpty()
            if (tag.contains("uncensored", true) && !Regex("uncensored|무수정", RegexOption.IGNORE_CASE).containsMatchIn(title)) title += " [무수정]"
            // 같은 작품의 모자이크 감소판(…-reducing-mosaic)이 일반판과 그림·제목이 같아 두 번 보임 → 판 이름
            if (tag.contains("reducing", true) || REDUCING.containsMatchIn(href)) title += " [모자이크 감소]"
            val img = card.selectFirst("img")
            val src = (img?.attr("abs:data-front-lazy-src")?.ifEmpty { null } ?: img?.attr("abs:src")).orEmpty()
            SAnime.create().apply {
                url = href.replace(Regex("^https?://[^/]+"), "")
                this.title = title
                thumbnail_url = src.takeIf { it.isNotEmpty() && !it.contains("placeholder") }
            }
        }
        val page = response.request.url.queryParameter("page")?.toIntOrNull() ?: 1
        val next = animes.isNotEmpty() && Regex("""[?&]page=${page + 1}(?:[&"]|$)""").containsMatchIn(html.replace("&amp;", "&"))
        return AnimesPage(animes, next)
    }

    /** 글자 s 의 at 위치([ 또는 {)부터 짝이 맞는 곳까지 (따옴표 안은 건너뜀) */
    private fun jsonSlice(s: String, at: Int): String? {
        var depth = 0
        var str = false
        var i = at
        while (i < s.length) {
            val c = s[i]
            if (str) {
                if (c == '\\') i++ else if (c == '"') str = false
            } else if (c == '"') {
                str = true
            } else if (c == '[' || c == '{') {
                depth++
            } else if (c == ']' || c == '}') {
                depth--
                if (depth == 0) return s.substring(at, i + 1)
            }
            i++
        }
        return null
    }

    private fun feedOf(html: String): JSONObject? {
        val at = html.indexOf("\"feed\":{\"items\":")
        if (at < 0) return null
        return jsonSlice(html, at + 7)?.let { runCatching { JSONObject(it) }.getOrNull() }
    }

    private fun parseShorts(response: Response): AnimesPage {
        val page = response.request.url.fragment?.removePrefix("p=")?.toIntOrNull() ?: 1
        val body = response.body.string()
        val data: JSONObject = if (response.request.url.encodedPath.endsWith("/feed")) {
            val o = runCatching { JSONObject(body) }.getOrNull() ?: JSONObject()
            // 표가 오래됐으면(409 feed expired) 여기서 끝 — 쇼츠를 다시 열면 처음부터
            if (!o.optBoolean("success")) return AnimesPage(emptyList(), false)
            o
        } else {
            feedOf(body) ?: throw Exception("쇼츠 목록을 못 읽었어요 [화면에 feed 자료 없음 · HTTP ${response.code}]")
        }
        val items = data.optJSONArray("items") ?: JSONArray()
        val list = (0 until items.length()).mapNotNull { i ->
            val o = items.optJSONObject(i) ?: return@mapNotNull null
            val uid = o.optString("uid")
            if (uid.isEmpty() || o.optString("media").isEmpty()) return@mapNotNull null
            SAnime.create().apply {
                url = "/ko/shorts/$uid"
                title = o.optString("caption").trim().ifEmpty { uid } + " [쇼츠]"
                thumbnail_url = o.optString("poster").ifEmpty { null }
            }
        }
        val next = data.optString("cursor")
        if (next.isNotEmpty()) {
            shortCursors[page + 1] = next
            prefs()?.edit()?.putString("short_cur_${page + 1}", next)?.apply()
        }
        return AnimesPage(list, next.isNotEmpty() && list.isNotEmpty())
    }

    // ================= 작품 정보 =================
    override fun getAnimeUrl(anime: SAnime): String = baseUrl + anime.url

    override fun animeDetailsRequest(anime: SAnime): Request = GET(baseUrl + anime.url, h())

    private fun shortItem(html: String, uid: String): JSONObject? {
        val items = feedOf(html)?.optJSONArray("items") ?: return null
        return (0 until items.length()).mapNotNull { items.optJSONObject(it) }.firstOrNull { it.optString("uid") == uid }
    }

    override fun animeDetailsParse(response: Response): SAnime {
        val html = response.body.string()
        SHORT_PATH.find(response.request.url.encodedPath)?.let { m ->
            val o = shortItem(html, m.groupValues[1]) ?: throw Exception("쇼츠 정보를 못 찾았어요 [지워졌거나 화면 모양이 바뀜]")
            val actor = o.optJSONObject("actress")?.optString("name").orEmpty()
            return SAnime.create().apply {
                title = o.optString("caption").trim()
                thumbnail_url = o.optString("poster").ifEmpty { null }
                artist = actor.ifEmpty { null }
                status = SAnime.COMPLETED
                update_strategy = AnimeUpdateStrategy.ONLY_FETCH_ONCE
                description = listOfNotNull(
                    "쇼츠 (짧은 영상)",
                    actor.ifEmpty { null }?.let { "출연 $it" },
                    if (o.optString("fullVideoUrl").isNotEmpty()) "본편은 회차 \"본편\"" else null,
                ).joinToString(" · ")
            }
        }
        val doc = Jsoup.parse(html, response.request.url.toString())
        fun meta(p: String) = (doc.selectFirst("meta[property=$p]") ?: doc.selectFirst("meta[name=$p]"))?.attr("content")?.trim().orEmpty()
        val name = (doc.selectFirst(".watch-title h1") ?: doc.selectFirst("h1"))?.text()?.trim().orEmpty().ifEmpty { meta("og:title") }
        val cast = doc.select("a.watch-actor-card span").map { it.text().trim() }.filter { it.isNotEmpty() }
        val chips = doc.select("a.watch-link-chip").map { it.text().trim() }.filter { it.isNotEmpty() }.distinct()
        val channel = (doc.selectFirst(".watch-meta a[href*=/channel/]") ?: doc.selectFirst("a[href*=/ko/channel/]:not(.filter-menu__option)"))?.text()?.trim().orEmpty()
        val ms = uploadMs(doc, html)
        val dur = DURATION.find(html)
        val length = dur?.let { listOfNotNull(it.groupValues[1].ifEmpty { null }?.let { h -> "${h}시간" }, it.groupValues[2].ifEmpty { null }?.let { m -> "${m.toInt()}분" }).joinToString(" ") }.orEmpty()
        val info = listOfNotNull(
            length.ifEmpty { null }?.let { "길이 $it" },
            if (ms > 0) "올린 날 ${ymd(ms)}" else null,
            cast.joinToString(", ").ifEmpty { null }?.let { "출연 $it" },
            channel.ifEmpty { null }?.let { "채널 $it" },
        ).joinToString(" · ")
        return SAnime.create().apply {
            title = ShortTitle.of(name) + if (REDUCING.containsMatchIn(response.request.url.encodedPath)) " [모자이크 감소]" else ""
            thumbnail_url = meta("og:image").ifEmpty { null }
            author = channel.ifEmpty { null }
            artist = cast.joinToString(", ").ifEmpty { null }
            genre = chips.joinToString(", ").ifEmpty { null }
            status = SAnime.COMPLETED
            update_strategy = AnimeUpdateStrategy.ONLY_FETCH_ONCE
            description = listOfNotNull(ShortTitle.full(name), info.ifEmpty { null }).joinToString("\n\n")
        }
    }

    private fun uploadMs(doc: org.jsoup.nodes.Document, html: String): Long {
        val dt = (doc.selectFirst(".watch-meta time[datetime]") ?: doc.selectFirst("time[datetime]"))?.attr("datetime")
            ?: UPLOAD_DATE.find(html)?.groupValues?.get(1) ?: return 0L
        return runCatching { synchronized(ISO_FMT) { ISO_FMT.parse(dt.replace(Regex("""([+-]\d{2}):(\d{2})$"""), "$1$2"))?.time } }.getOrNull() ?: 0L
    }

    // ================= 회차 (영상 하나: "본편", 쇼츠는 "쇼츠"·"본편") =================
    override fun episodeListRequest(anime: SAnime): Request = GET(baseUrl + anime.url, h())

    override fun episodeListParse(response: Response): List<SEpisode> {
        val html = response.body.string()
        SHORT_PATH.find(response.request.url.encodedPath)?.let { m ->
            val o = shortItem(html, m.groupValues[1]) ?: throw Exception("쇼츠 정보를 못 찾았어요")
            val full = o.optString("fullVideoUrl").replace(Regex("^https?://[^/]+"), "")
            return listOfNotNull(
                if (full.isNotEmpty()) {
                    SEpisode.create().apply {
                        url = full
                        name = "본편"
                        episode_number = 2f
                    }
                } else {
                    null
                },
                SEpisode.create().apply {
                    url = o.optString("media")
                    name = "쇼츠"
                    episode_number = 1f
                },
            )
        }
        val doc = Jsoup.parse(html, response.request.url.toString())
        val ms = uploadMs(doc, html)
        return listOf(
            SEpisode.create().apply {
                url = response.request.url.encodedPath
                name = if (ms > 0) "본편 (${ymd(ms)})" else "본편"
                episode_number = 1f
                date_upload = ms
            },
        )
    }

    private fun ymd(ms: Long) = synchronized(YMD_FMT) { YMD_FMT.format(java.util.Date(ms)) }

    // ================= 재생 =================
    // 작품 화면의 재생표(ticket) → 재생 정보 요청 → 서명된 mp4 주소 (1시간). 쇼츠는 m3u8 그대로
    override suspend fun getVideoList(episode: SEpisode): List<Video> = withContext(Dispatchers.IO) {
        val vh = Headers.Builder().set("Referer", "$baseUrl/").build()
        if (episode.url.startsWith("http") && episode.url.contains(".m3u8")) {
            return@withContext HlsQuality.sort(prefs(), HlsQuality.expand(client, episode.url, "$LABEL 쇼츠", vh))
        }
        val pageUrl = baseUrl + episode.url
        val html = client.newCall(GET(pageUrl, h())).execute().use { res ->
            if (!res.isSuccessful) throw Exception("작품 화면을 열지 못했어요 (HTTP ${res.code})")
            res.body.string()
        }
        val pb = PLAYBACK.find(html) ?: throw Exception("영상 정보를 못 찾았어요 [작품 화면에 재생표 없음 · 프리미엄·로그인 전용일 수 있어요]")
        val endpoint = pb.groupValues[1].replace("\\/", "/")
        val api = if (endpoint.startsWith("http")) endpoint else baseUrl + endpoint
        val ph = headersBuilder().set("Referer", pageUrl).set("Origin", baseUrl).set("Accept", "application/json")
            .set("X-Requested-With", "XMLHttpRequest").build()
        fun send(ticket: String): Pair<Int, JSONObject> =
            client.newCall(POST(api, ph, FormBody.Builder().add("ticket", ticket).build())).execute().use { res ->
                res.code to (runCatching { JSONObject(res.body.string()) }.getOrNull() ?: JSONObject())
            }
        var (code, data) = send(pb.groupValues[2])
        // 표가 만료됐으면 사이트가 새 표를 줌 (사이트 플레이어와 같게 한 번 더)
        if (code == 409 && data.optString("renewTicket").isNotEmpty()) {
            val again = send(data.optString("renewTicket"))
            code = again.first
            data = again.second
        }
        val srcs = data.optJSONArray("sources")
        if (!data.optBoolean("success") || srcs == null || srcs.length() == 0) {
            throw Exception("재생 정보를 못 받았어요 [재생 정보 HTTP $code · ${data.optString("message").take(60)}]")
        }
        val out = mutableListOf<Video>()
        val list = (0 until srcs.length()).mapNotNull { srcs.optJSONObject(it) }.sortedByDescending { it.optInt("size") }
        for (s in list) {
            for ((raw, alt) in listOf(s.optString("src") to false, s.optString("fallbackSrc") to true)) {
                if (raw.isEmpty() || raw == "null") continue
                val u = if (raw.startsWith("http")) raw else baseUrl + raw
                if (out.any { it.url == u }) continue
                val q = s.optString("label").ifEmpty { if (s.optInt("size") > 0) "${s.optInt("size")}p" else "" }
                if (u.contains(".m3u8")) {
                    out.addAll(HlsQuality.expand(client, u, LABEL, vh))
                } else {
                    out.add(Video(u, "$LABEL${if (q.isNotEmpty()) " $q" else ""}${if (alt) " (대체)" else ""}", u, vh))
                }
            }
        }
        HlsQuality.sort(prefs(), out)
    }

    override fun videoListParse(response: Response): List<Video> = throw UnsupportedOperationException()

    // ================= 필터 =================
    override fun getFilterList(): AnimeFilterList = ExtStatus.withNotes("javtiful", baseFilters())

    private fun ruleText(i: IntArray): String = when {
        i[0] == SHORTS && i[1] == 0 && i[2] == 0 -> "쇼츠"
        i[2] > 0 -> "채널 ${CHANNELS[i[2]].first} · 최신"
        else -> listOfNotNull(TYPES[i[0]].first, if (i[1] > 0) CATS[i[1]].first else null, SORTS[i[3]].first).joinToString(" · ")
    }

    private fun baseFilters(): AnimeFilterList = AnimeFilterList(
        listOf(
            AnimeFilter.Header("📡 주소: ${baseUrl.substringAfter("://")}"),
            AnimeFilter.Header("검색창에 사이트 주소를 붙여 넣으면 그 주소로 바꾸고, 작품·쇼츠·목록 주소면 그 화면을 열어요"),
            AnimeFilter.Separator(),
            AnimeFilter.Header("검색어가 있으면 필터 무시 · 채널을 고르면 채널 최신순만 · 카테고리는 인기/추가 기간 정렬만 · 쇼츠는 사이트가 골라 주는 차례(정렬 없음)"),
            TypeFilter(),
            CatFilter(),
            ChannelFilter(),
            SortFilter(),
        ) + TabRule.filters(prefs(), ruleSizes(), ruleText(DEFAULT_POPULAR) to ruleText(DEFAULT_LATEST), ::ruleText),
    )

    class TypeFilter : AnimeFilter.Select<String>("종류", TYPES.map { it.first }.toTypedArray())
    class CatFilter : AnimeFilter.Select<String>("카테고리", CATS.map { it.first }.toTypedArray())
    class ChannelFilter : AnimeFilter.Select<String>("채널", CHANNELS.map { it.first }.toTypedArray())
    class SortFilter : AnimeFilter.Select<String>("정렬", SORTS.map { it.first }.toTypedArray())

    // ================= 설정 =================
    override fun setupPreferenceScreen(screen: PreferenceScreen) {
        val ctx = screen.context
        EditTextPreference(ctx).apply {
            key = PREF_DOMAIN
            title = "사이트 주소 직접 지정 (선택)"
            summary = "비워 두면 $DEFAULT_BASE_URL\n현재 주소: $baseUrl"
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
        private const val DEFAULT_BASE_URL = "https://javtiful.com"
        private const val LABEL = "Javtiful"

        private val DOMAIN_REGEX = Regex("""^https://(?:www\.)?javtiful\.[a-z]{2,8}$""")
        private val PASTE_REGEX = Regex("""^(?:https?://)?((?:www\.)?javtiful\.[a-z]{2,8})(/\S*)?$""", RegexOption.IGNORE_CASE)
        private val LANG_PREFIX = Regex("""^/[a-z]{2}/""")
        private val VIDEO_PATH = Regex("""^/video/\d+/[^/?]+""")
        private val SHORT_PATH = Regex("""/shorts/([a-f0-9]{32})""")
        private val SHORTS_LIST = Regex("""^/shorts/?$""")
        private val REDUCING = Regex("""-reducing-mosaic/?$""", RegexOption.IGNORE_CASE)
        private val LIST_PATH = Regex("""^/(?:videos|censored|uncensored|reducing-mosaic|category/[^/?]+|channel/[^/?]+|actress/[^/?]+|search)(?:\?|$)""")
        private val PAGE_PARAM = Regex("""([?&])page=\d+&?""")
        private val VIDEO_ID = Regex("""/video/(\d+)""")
        private val PLAYBACK = Regex(""""playback":\{"endpoint":"([^"]+)","ticket":"([^"]+)"""")
        private val DURATION = Regex(""""duration":"PT(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?"""")
        private val UPLOAD_DATE = Regex(""""uploadDate":"([^"]+)"""")
        private val KST = TimeZone.getTimeZone("Asia/Seoul")
        private val YMD_FMT = SimpleDateFormat("yyyy.MM.dd", Locale.KOREA).apply { timeZone = KST }
        private val ISO_FMT = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ", Locale.US)

        private const val SHORTS = 4

        // 종류: [이름, 전체 화면 주소, 카테고리 화면 video_type 값]
        private val TYPES = listOf(
            Triple("전체", "videos", ""),
            Triple("유수정", "censored", "censored"),
            Triple("무수정", "uncensored", "uncensored"),
            Triple("모자이크 감소", "reducing-mosaic", "reducing_mosaic"),
            Triple("쇼츠", "shorts", ""),
        )

        // 카테고리 (/ko/categories, 2026-11-17)
        private val CATS = listOf("전체" to "") + listOf(
            "가정부", "간호사", "드라마", "미소녀", "밀프", "불륜", "성숙한", "아마추어", "언니", "여교사", "여대생",
            "여성-상사", "여수사관", "오피스-레이디", "유부녀", "최면", "코스플레이어", "큰-가슴",
        ).map { it.replace('-', ' ') to it } + listOf("중국 AV" to "chinese-av")

        // 채널 (/ko/channels 1~3쪽, 사이트 순서 = 동영상 많은 순, 2026-11-17)
        private val CHANNELS = listOf("전체" to "") + listOf(
            "FC2PPV" to "fc2ppv", "S1 NO.1 STYLE" to "s1-no1-style", "Madonna" to "madonna", "MOODYZ" to "moodyz", "SOD Create" to "sod-create",
            "IDEA POCKET" to "idea-pocket", "Hunter" to "hunter", "Attackers" to "attackers", "PRESTIGE" to "prestige", "Venus" to "venus",
            "Caribbean" to "caribbean", "Planet Plus" to "planet-plus", "FALENO" to "faleno", "K.M.Produce" to "kmproduce", "Oppai" to "oppai",
            "Honnaka" to "honnaka", "Glory Quest" to "glory-quest", "Das !" to "das", "Fitch" to "fitch", "WANZ FACTORY" to "wanz-factory",
            "Natural High" to "natural-high", "Crystal Eizou" to "crystal-eizou", "Premium" to "premium", "1Pondo" to "1pondo", "S-Cute" to "s-cute",
            "HEYZO" to "heyzo", "SWITCH" to "switch", "E-body" to "e-body", "Alice Japan" to "alice-japan", "MAX-A" to "max-a",
            "First Star" to "first-star", "Kawaii" to "kawaii", "Serebu No Tomo" to "serebu-no-tomo", "H.m.p" to "hmp", "Tameike Goro" to "tameike-goro",
            "IE NERGY" to "ie-nergy", "Deeps" to "deeps", "DOC" to "doc", "Takara Eizou" to "takara-eizou", "Muku" to "muku",
            "MAXING" to "maxing", "DAHLIA" to "dahlia", "JET Eizou" to "jet-eizou", "10Musume" to "10musume", "Momotarou Eizou Shuppan" to "momotarou-eizou-shuppan",
            "Aurora Project Annex" to "aurora-project-annex", "Sadistic Village" to "sadistic-village", "MERCURY" to "mercury", "ROYAL" to "royal",
            "Oyaji No Kosatsu" to "oyaji-no-kosatsu", "Hibino" to "hibino", "Nagae Style" to "nagae-style", "LUNATICS" to "lunatics",
            "Center Village" to "center-village", "Abc / Mousou Zoku" to "abc-mousou-zoku", "Yama To Sora" to "yama-to-sora", "Bi" to "bi",
            "Maza" to "maza", "Rocket" to "rocket", "Pakopakodan To Yukaina Nakamatachi" to "pakopakodan-to-yukaina-nakamatachi", "Tma" to "tma",
            "Non" to "non", "Nampa JAPAN" to "nampa-japan", "Sekimenjoshi" to "sekimenjoshi", "FALENOTUBE" to "falenotube", "Avs" to "avs",
            "Hentai Shinshi Kurabu" to "hentai-shinshi-kurabu", "M's Video Group" to "ms-video-group", "Ke- . Toraibu" to "ke-toraibu",
            "S Kyuu Shirouto" to "s-kyuu-shirouto", "Barutan" to "barutan", "Pacopacomama" to "pacopacomama",
        )

        // 정렬: [이름, 전체·종류 화면 값, 카테고리 화면 값(인기 하나·추가 기간만)]
        private val SORTS = listOf(
            Triple("최신", "", ""), Triple("오늘 인기", "popular_today", "popular"), Triple("이번 주 인기", "popular_week", "popular"),
            Triple("이번 달 인기", "popular_month", "popular"), Triple("오늘 추가", "added_today", "added_today"),
            Triple("이번 주 추가", "added_week", "added_week"), Triple("이번 달 추가", "added_month", "added_month"),
            Triple("조회수 많은 순", "most_viewed", "popular"), Triple("좋아요 많은 순", "most_liked", "popular"),
        )

        private val DEFAULT_POPULAR = intArrayOf(0, 0, 0, 2)
        private val DEFAULT_LATEST = intArrayOf(0, 0, 0, 0)
    }
}
