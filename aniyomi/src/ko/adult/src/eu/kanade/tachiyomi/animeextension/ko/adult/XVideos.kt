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
import eu.kanade.tachiyomi.animesource.model.Track
import eu.kanade.tachiyomi.animesource.model.Video
import eu.kanade.tachiyomi.animesource.online.AnimeHttpSource
import eu.kanade.tachiyomi.network.GET
import okhttp3.Headers
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONArray
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * xVideos (www.xvideos.com, 망가요미판 xvideos.js 와 같은 규칙).
 * 목록: 최신 = 첫 화면 / → /new/{쪽-1} · 이번 달 인기 /best/{yyyy-mm}[/{쪽-1}] · 분류 /c/{이름-번호}[/{쪽-1}], 다음 쪽 a.next-page
 * 검색: /?k=검색어&sort=&datef=&durf=&quality=&p={쪽-1}
 * 작품: html5player.setVideoTitle·setVideoHLS(화질 묶음)·setVideoUrlHigh/Low(mp4)·setSubtitles(언어별 vtt), ld+json uploadDate·duration
 */
class XVideos : AnimeHttpSource(), ConfigurableAnimeSource {

    override val name = "xVideos"
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
            var v = prefs()?.getString(PREF_DOMAIN, "")?.trim()?.trimEnd('/').orEmpty()
            if (v.isNotEmpty() && !v.startsWith("http")) v = "https://$v"
            return if (DOMAIN_REGEX.matches(v)) v else DEFAULT_BASE_URL
        }

    override val client: OkHttpClient = network.client.newBuilder()
        .apply { interceptors().add(0, FriendlyNet) }
        .build()

    override fun headersBuilder(): Headers.Builder = super.headersBuilder()
        .set("Referer", "$baseUrl/")

    private fun h(): Headers = headersBuilder().build()

    // ================= 목록 =================
    private fun ruleSizes() = intArrayOf(KINDS.size)

    private fun listUrl(kind: Int, page: Int): String {
        val v = KINDS[kind].second
        val p = page - 1
        return when (v) {
            "/" -> if (p > 0) "$baseUrl/new/$p" else "$baseUrl/"
            "/best" -> {
                val ym = synchronized(YM_FMT) { YM_FMT.format(java.util.Date()) }
                if (p > 0) "$baseUrl/best/$ym/$p" else "$baseUrl/best/$ym"
            }
            else -> if (p > 0) "$baseUrl/c/$v/$p" else "$baseUrl/c/$v"
        }
    }

    override fun popularAnimeRequest(page: Int): Request =
        GET(listUrl((TabRule.read(prefs(), true, ruleSizes()) ?: DEFAULT_POPULAR)[0], page), h())

    override fun popularAnimeParse(response: Response): AnimesPage = parseList(response)

    override fun latestUpdatesRequest(page: Int): Request =
        GET(listUrl((TabRule.read(prefs(), false, ruleSizes()) ?: DEFAULT_LATEST)[0], page), h())

    override fun latestUpdatesParse(response: Response): AnimesPage = parseList(response)

    override fun searchAnimeRequest(page: Int, query: String, filters: AnimeFilterList): Request {
        val q = query.trim()
        // 영상 주소를 붙여 넣으면 그 영상
        PASTE_REGEX.find(q)?.let { return GET(baseUrl + it.groupValues[1].substringBefore('#'), h()) }
        val kind = filters.filterIsInstance<KindFilter>().firstOrNull()?.state ?: 0
        if (q.isNotEmpty()) {
            val sb = StringBuilder("$baseUrl/?k=").append(URLEncoder.encode(q, "UTF-8"))
            filters.filterIsInstance<SortFilter>().firstOrNull()?.state?.takeIf { it > 0 }?.let { sb.append("&sort=").append(SORTS[it].second) }
            filters.filterIsInstance<DateFilter>().firstOrNull()?.state?.takeIf { it > 0 }?.let { sb.append("&datef=").append(DATES[it].second) }
            filters.filterIsInstance<DurFilter>().firstOrNull()?.state?.takeIf { it > 0 }?.let { sb.append("&durf=").append(DURS[it].second) }
            filters.filterIsInstance<QualFilter>().firstOrNull()?.state?.takeIf { it > 0 }?.let { sb.append("&quality=").append(QUALS[it].second) }
            if (page > 1) sb.append("&p=").append(page - 1)
            return GET(sb.toString(), h())
        }
        filters.filterIsInstance<TabRule.RuleFilter>().firstOrNull()?.let { TabRule.apply(prefs(), it.state, intArrayOf(kind)) }
        return GET(listUrl(kind, page), h())
    }

    override fun searchAnimeParse(response: Response): AnimesPage {
        if (VIDEO_PATH.containsMatchIn(response.request.url.encodedPath)) {
            val d = animeDetailsParse(response)
            return AnimesPage(listOf(d.apply { url = response.request.url.encodedPath }), false)
        }
        return parseList(response)
    }

    private fun parseList(response: Response): AnimesPage {
        val doc = Jsoup.parse(response.body.string(), response.request.url.toString())
        val seen = HashSet<String>()
        val list = doc.select(".thumb-block").mapNotNull { b ->
            val a = b.selectFirst("a[href*=/video]") ?: return@mapNotNull null
            val href = a.attr("href").substringBefore('#')
            if (!VIDEO_PATH.containsMatchIn(href) || !seen.add(href)) return@mapNotNull null
            val img = b.selectFirst("img")
            val t = b.selectFirst(".title a[title]") ?: b.selectFirst("p.title a") ?: b.selectFirst(".title[title]")
            var title = t?.attr("title")?.ifEmpty { t.text() }.orEmpty()
            if (title.isEmpty()) title = img?.attr("alt").orEmpty()
            title = title.replace(DUR_TAIL, "").trim()
            val thumb = img?.attr("data-src")?.ifEmpty { null } ?: img?.attr("src").orEmpty()
            SAnime.create().apply {
                url = href
                this.title = title
                thumbnail_url = thumb.takeIf { it.startsWith("http") && !it.contains("blank") && !it.contains("lightbox") }
            }
        }
        val path = response.request.url.encodedPath
        val more = doc.select("a.next-page").isNotEmpty() || (path.startsWith("/best") && list.size >= 20)
        return AnimesPage(list, list.isNotEmpty() && more)
    }

    // ================= 작품 정보 =================
    override fun getAnimeUrl(anime: SAnime): String = baseUrl + anime.url

    override fun animeDetailsRequest(anime: SAnime): Request = GET(baseUrl + anime.url, h())

    /** setSubtitles('기본', [{"l":"ko","f":"…vtt"}, …]) → (언어, 주소) 목록 */
    private fun subsOf(html: String): List<Pair<String, String>> {
        val i = html.indexOf("setSubtitles(")
        if (i < 0) return emptyList()
        val a = html.indexOf('[', i)
        if (a < 0) return emptyList()
        var depth = 0
        var inStr = false
        var k = a
        while (k < html.length && k < a + 20_000) {
            val c = html[k]
            if (inStr) {
                if (c == '\\') {
                    k++
                } else if (c == '"') {
                    inStr = false
                }
            } else if (c == '"') {
                inStr = true
            } else if (c == '[') {
                depth++
            } else if (c == ']') {
                depth--
                if (depth == 0) {
                    return runCatching {
                        val arr = JSONArray(html.substring(a, k + 1))
                        (0 until arr.length()).mapNotNull { n ->
                            val o = arr.optJSONObject(n) ?: return@mapNotNull null
                            val l = o.optString("l")
                            val f = o.optString("f")
                            if (l.isEmpty() || !f.startsWith("http")) null else l to f
                        }
                    }.getOrDefault(emptyList())
                }
            }
            k++
        }
        return emptyList()
    }

    private fun pick(html: String, re: Regex) = re.find(html)?.groupValues?.get(1)?.let(::unesc).orEmpty()

    private fun uploadMs(html: String): Long =
        UPLOAD_DATE.find(html)?.groupValues?.get(1)?.let { s ->
            runCatching { synchronized(ISO_FMT) { ISO_FMT.parse(s.take(19))?.time } }.getOrNull()
        } ?: 0L

    override fun animeDetailsParse(response: Response): SAnime {
        val html = response.body.string()
        val doc: Document = Jsoup.parse(html, response.request.url.toString())
        val name = pick(html, TITLE_JS).ifEmpty { doc.selectFirst("meta[property=og:title]")?.attr("content").orEmpty() }.trim()
        val ms = uploadMs(html)
        val dur = DURATION.find(html)?.groupValues?.let { g ->
            val hh = g[1].toIntOrNull() ?: 0
            val mm = g[2].toIntOrNull() ?: 0
            val ss = g[3].toIntOrNull() ?: 0
            (if (hh > 0) "$hh:%02d".format(mm) else "$mm") + ":%02d".format(ss)
        }
        val views = VIEWS.find(html)?.groupValues?.get(1)?.toLongOrNull()
        val names = doc.select(".video-metadata .name, .uploader-tag .name, .video-tags-list a.label .name").map { it.text().trim() }.filter { it.isNotEmpty() }
        val tags = doc.select("a.is-keyword").map { it.text().trim() }.filter { it.isNotEmpty() }.distinct()
        val subs = subsOf(html)
        val subLine = when {
            subs.any { it.first == "ko" } -> "💬 한국어 자막 있음 (사이트 자동 번역일 수 있음)"
            subs.isNotEmpty() -> "💬 한국어 자막 없음 (다른 언어 ${subs.size}개)"
            else -> ""
        }
        val info = listOfNotNull(
            dur?.let { "길이 $it" },
            if (html.contains("setVideoHLS(") && html.contains("1080p")) "최대 1080p" else null,
            views?.let { "조회 ${count(it)}" },
            if (ms > 0) "올린 날 ${ymd(ms)}" else null,
        ).joinToString(" · ")
        val people = names.drop(1).distinct().joinToString(", ")
        return SAnime.create().apply {
            title = if (ms > 0 && name.isNotEmpty() && !TITLE_YEAR.containsMatchIn(name)) "$name (${ymd(ms).take(4)})" else name
            thumbnail_url = doc.selectFirst("meta[property=og:image]")?.attr("content")?.ifEmpty { null }
            author = names.firstOrNull()
            artist = people.ifEmpty { null }
            genre = tags.joinToString(", ").ifEmpty { null }
            status = SAnime.COMPLETED
            update_strategy = AnimeUpdateStrategy.ONLY_FETCH_ONCE
            description = listOf(subLine, info, if (people.isNotEmpty()) "출연: $people" else "").filter { it.isNotEmpty() }.joinToString("\n")
        }
    }

    // ================= 회차 (하나: "본편") =================
    override fun episodeListRequest(anime: SAnime): Request = GET(baseUrl + anime.url, h())

    override fun episodeListParse(response: Response): List<SEpisode> {
        val html = response.body.string()
        val ms = uploadMs(html)
        val ko = subsOf(html).any { it.first == "ko" }
        return listOf(
            SEpisode.create().apply {
                url = response.request.url.encodedPath
                name = if (ms > 0) "본편 (${ymd(ms)})" else "본편"
                episode_number = 1f
                date_upload = ms
                if (ko) scanlator = "한글자막"
            },
        )
    }

    // ================= 재생 =================
    override fun videoListRequest(episode: SEpisode): Request = GET(baseUrl + episode.url, h())

    override fun videoListParse(response: Response): List<Video> {
        val html = response.body.string()
        val headers = Headers.Builder().set("Referer", "$baseUrl/").build()
        val hls = pick(html, HLS_JS)
        val high = pick(html, HIGH_JS)
        val low = pick(html, LOW_JS)
        val subsAll = subsOf(html)
        val subs = subsAll.filter { it.first == "ko" }.map { Track(it.second, "한국어") } +
            subsAll.filter { it.first == "en" }.map { Track(it.second, "영어") }
        val out = mutableListOf<Video>()
        if (hls.isNotEmpty()) out.addAll(HlsQuality.expand(client, hls, LABEL, headers))
        if (high.isNotEmpty()) out.add(Video(high, "$LABEL mp4 고화질", high, headers))
        if (low.isNotEmpty() && low != high) out.add(Video(low, "$LABEL mp4 저화질", low, headers))
        if (out.isEmpty()) {
            throw Exception("영상 주소를 못 찾았어요 [재생 · 화면에 영상 주소 없음 · ${response.request.url.encodedPath.take(40)}]")
        }
        return HlsQuality.sort(prefs(), out).map { Video(it.url, it.quality, it.videoUrl, it.headers, subs) }
    }

    private fun unesc(s: String) = s.replace("&amp;", "&").replace("&#039;", "'").replace("&#39;", "'")
        .replace("&quot;", "\"").replace("\\/", "/")

    private fun ymd(ms: Long) = synchronized(YMD_FMT) { YMD_FMT.format(java.util.Date(ms)) }

    private fun count(n: Long): String = when {
        n >= 1_000_000 -> "%.1fM".format(Locale.US, n / 1e6)
        n >= 1_000 -> "%.1fK".format(Locale.US, n / 1e3)
        else -> n.toString()
    }

    // ================= 필터 =================
    override fun getFilterList(): AnimeFilterList = ExtStatus.withNotes("xvideos", baseFilters())

    private fun ruleText(i: IntArray) = KINDS[i[0]].first

    private fun baseFilters(): AnimeFilterList = AnimeFilterList(
        listOf(
            AnimeFilter.Header("검색어가 없으면 분류만 · 검색어가 있으면 검색 정렬·기간·길이·화질만 적용"),
            AnimeFilter.Header("검색창에 영상 주소를 붙여 넣으면 그 영상을 바로 열어요"),
            KindFilter(),
            SortFilter(),
            DateFilter(),
            DurFilter(),
            QualFilter(),
        ) + TabRule.filters(prefs(), ruleSizes(), ruleText(DEFAULT_POPULAR) to ruleText(DEFAULT_LATEST), ::ruleText),
    )

    class KindFilter : AnimeFilter.Select<String>("분류", KINDS.map { it.first }.toTypedArray())
    class SortFilter : AnimeFilter.Select<String>("검색 정렬", SORTS.map { it.first }.toTypedArray())
    class DateFilter : AnimeFilter.Select<String>("검색 기간", DATES.map { it.first }.toTypedArray())
    class DurFilter : AnimeFilter.Select<String>("검색 길이", DURS.map { it.first }.toTypedArray())
    class QualFilter : AnimeFilter.Select<String>("검색 화질", QUALS.map { it.first }.toTypedArray())

    // ================= 설정 =================
    override fun setupPreferenceScreen(screen: PreferenceScreen) {
        val ctx = screen.context
        EditTextPreference(ctx).apply {
            key = PREF_DOMAIN
            title = "사이트 주소 직접 지정 (선택)"
            summary = "비워 두면 $DEFAULT_BASE_URL"
            dialogMessage = "https:// 로 시작하는 주소"
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
        private const val DEFAULT_BASE_URL = "https://www.xvideos.com"
        private const val LABEL = "xVideos"

        private val DOMAIN_REGEX = Regex("""^https://(?:www\.)?xvideos\d*\.[a-z]{2,8}$""")
        private val PASTE_REGEX = Regex("""^(?:https?://)?(?:www\.)?xvideos\d*\.[a-z]{2,8}(/video[^\s]*)$""", RegexOption.IGNORE_CASE)
        private val VIDEO_PATH = Regex("""^/video[.\d]""")
        private val DUR_TAIL = Regex("""\s+\d+\s*(?:min|sec|h)\s*$""", RegexOption.IGNORE_CASE)
        private val TITLE_JS = Regex("""html5player\.setVideoTitle\('((?:[^'\\]|\\.)*)'""")
        private val HLS_JS = Regex("""html5player\.setVideoHLS\('([^']+)'""")
        private val HIGH_JS = Regex("""html5player\.setVideoUrlHigh\('([^']+)'""")
        private val LOW_JS = Regex("""html5player\.setVideoUrlLow\('([^']+)'""")
        private val UPLOAD_DATE = Regex(""""uploadDate"\s*:\s*"([^"]+)"""")
        private val DURATION = Regex(""""duration"\s*:\s*"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"""")
        private val VIEWS = Regex(""""userInteractionCount"\s*:\s*(\d+)""")
        private val TITLE_YEAR = Regex("""\(\d{4}\)$""")
        private val KST = TimeZone.getTimeZone("Asia/Seoul")
        private val YMD_FMT = SimpleDateFormat("yyyy.MM.dd", Locale.KOREA).apply { timeZone = KST }
        private val YM_FMT = SimpleDateFormat("yyyy-MM", Locale.US).apply { timeZone = KST }
        private val ISO_FMT = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }

        // 분류: 값이 "/" 로 시작하면 주소, 아니면 /c/ 분류 (사이트 기본 분류 38개, 2026-11-12)
        private val KINDS = listOf(
            "최신" to "/",
            "이번 달 인기" to "/best",
            "AI" to "AI-239",
            "ASMR" to "ASMR-229",
            "Amateur" to "Amateur-65",
            "Anal" to "Anal-12",
            "Arab" to "Arab-159",
            "Asian" to "Asian_Woman-32",
            "Ass" to "Ass-14",
            "BBW" to "bbw-51",
            "Bi" to "Bi_Sexual-62",
            "Big Ass" to "Big_Ass-24",
            "Big Cock" to "Big_Cock-34",
            "Big Tits" to "Big_Tits-23",
            "Black" to "Black_Woman-30",
            "Blonde" to "Blonde-20",
            "Blowjob" to "Blowjob-15",
            "Brunette" to "Brunette-25",
            "Cam Porn" to "Cam_Porn-58",
            "Creampie" to "Creampie-40",
            "Cuckold/Hotwife" to "Cuckold-237",
            "Cumshot" to "Cumshot-18",
            "Femdom" to "Femdom-235",
            "Fisting" to "Fisting-165",
            "Fucked Up Family" to "Fucked_Up_Family-81",
            "Gangbang" to "Gangbang-69",
            "Gapes" to "Gapes-167",
            "Indian" to "Indian-89",
            "Interracial" to "Interracial-27",
            "Latina" to "Latina-16",
            "Lesbian" to "Lesbian-26",
            "Lingerie" to "Lingerie-83",
            "Mature" to "Mature-38",
            "Milf" to "Milf-19",
            "Oiled" to "Oiled-22",
            "Redhead" to "Redhead-31",
            "Solo" to "Solo_and_Masturbation-33",
            "Squirting" to "Squirting-56",
            "Stockings" to "Stockings-28",
            "Teen" to "Teen-13",
        )
        private val SORTS = listOf("관련순" to "relevance", "최신" to "uploaddate", "평점" to "rating", "조회" to "views", "길이" to "length")
        private val DATES = listOf("전체 기간" to "all", "오늘" to "today", "이번 주" to "week", "이번 달" to "month")
        private val DURS = listOf(
            "전체 길이" to "allduration",
            "1~3분" to "1-3min",
            "3~10분" to "3-10min",
            "10분 이상" to "10min_more",
            "10~20분" to "10-20min",
            "20분 이상" to "20min_more",
        )
        private val QUALS = listOf("전체 화질" to "all", "HD" to "hd", "1080p 이상" to "1080")

        private val DEFAULT_POPULAR = intArrayOf(1)
        private val DEFAULT_LATEST = intArrayOf(0)
    }
}
