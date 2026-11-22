package eu.kanade.tachiyomi.animeextension.ko.adult

/**
 * 사이트가 줄거리 첫 문장을 통째로 제목으로 써서 작품 화면 제목이 8줄씩 차지함(AVFLIX SNOS-162 등)
 * → 품번 + 앞부분 25글자 + "…" (전체 문장은 설명 맨 위). MissAV·Javtiful·AVFLIX 같게, 망가요미 shortTitle 과 같음
 */
internal object ShortTitle {
    private const val MAX = 25
    private val CODE = Regex("""^([A-Za-z0-9]+-\d+[A-Za-z]?)\s+(.+)$""")

    fun of(raw: String): String {
        val t = raw.trim()
        val m = CODE.find(t)
        val code = m?.groupValues?.get(1)
        val rest = m?.groupValues?.get(2) ?: t
        if (rest.length <= MAX) return t
        val cut = rest.take(MAX).trimEnd(' ', ',', '.', '·', '-') + "…"
        return if (code != null) "$code $cut" else cut
    }

    /** 줄였으면 원래 문장, 아니면 null (설명 맨 위에 넣을 것) */
    fun full(raw: String): String? = raw.trim().takeIf { of(it) != it }
}
