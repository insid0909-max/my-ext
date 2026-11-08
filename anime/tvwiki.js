const mangayomiSources = [
    {
      id: 1720450905,
      name: "티비위키(개인)",
      lang: "ko",
      baseUrl: "https://tvwiki57.net",
      version: "1.0.6",
      isNsfw: !1,
      itemType: 1,
      isManga: !1,
    },
  ],
  USER_AGENT =
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
  ADDRESS_PAGE = "https://tvwiki.store/",
  CATEGORIES = [
    ["drama", "드라마"],
    ["ent", "예능프로그램"],
    ["movie", "영화"],
    ["kor_movie", "한국영화"],
    ["world", "해외드라마"],
    ["ott_ent", "해외(예능/다큐)"],
    ["ani_movie", "[극장판] 애니메이션"],
    ["animation", "일반 애니메이션"],
    ["sisa", "시사/다큐"],
    ["short_drama", "숏폼 드라마"],
    ["old_drama", "추억의 드라마"],
    ["old_ent", "추억의 예능"],
  ],
  SORTS = [
    ["subidx", "최근 방영순"],
    ["wr_datetime", "최근 등록순"],
    ["wr_hit", "조회수 높은순"],
    ["wr_good", "좋아요 높은순"],
  ],
  text = (t, e) =>
    String((e ? t.selectFirst(e) : t)?.text || "")
      .replace(/\s+/g, " ")
      .trim(),
  attr = (t, e) => String(t?.attr(e) || "").trim();
class DefaultExtension extends MProvider {
  get supportsLatest() {
    return !0;
  }
  pref(t) {
    try {
      return String(new SharedPreferences().get(t) || "");
    } catch (t) {
      return "";
    }
  }
  get baseUrl() {
    const t = this.pref("base_url").trim().replace(/\/+$/, "");
    if (!t) return this._site || this.source.baseUrl;
    if (
      !/^https?:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/i.test(t)
    )
      throw new Error(
        "http:// 또는 https://로 시작하는 사이트 주소를 입력해 주세요.",
      );
    return "https://tvwiki56.net" === t ? this.source.baseUrl : t;
  }
  get client() {
    return (
      this._client ||
      (this._client = new Client({ timeout: 20, connectTimeout: 8 }))
    );
  }
  getHeaders(t) {
    const e = /^https?:\/\/[^/?#]+/i.exec(String(t || ""))?.[0] || this.baseUrl;
    return { "User-Agent": USER_AGENT, Referer: e + "/" };
  }
  getSourcePreferences() {
    return [
      {
        key: "base_url",
        editTextPreference: {
          title: "사이트 주소",
          summary:
            "비워 두면 안내 페이지(tvwiki.store)에서 현재 주소를 자동으로 읽습니다.",
          value: "",
          dialogTitle: "사이트 주소",
          dialogMessage: "예: https://tvwiki57.net/",
        },
      },
    ];
  }
  async site() {
    if (this.pref("base_url").trim()) return this.baseUrl;
    if (!this._site) {
      try {
        const t = await this.client.get(ADDRESS_PAGE, {
          "User-Agent": USER_AGENT,
        });
        this._site =
          /https?:\/\/(?:www\.)?tvwiki\d+\.net/i
            .exec(200 === t.statusCode ? t.body : "")?.[0]
            .replace(/^http:/, "https:") || "";
      } catch (t) {
        this._site = "";
      }
      this._site = this._site || this.source.baseUrl;
    }
    return this._site;
  }
  async html(t) {
    const e = (await this.site()) + t,
      r = await this.client.get(e, this.getHeaders());
    if (200 !== r.statusCode)
      throw new Error(`사이트 요청에 실패했습니다 (HTTP ${r.statusCode}).`);
    if (/<title>\s*Just a moment|id=["']cf-chl/i.test(r.body))
      throw new Error(
        "WebView에서 사이트 인증을 완료한 후 다시 시도해 주세요.",
      );
    return r.body;
  }
  async document(t) {
    return new Document(
      (await this.html(t)).replace(
        /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
        "",
      ),
    ).body;
  }
  path(t, e = !1) {
    const r = String(t)
        .trim()
        .replace(/^https?:\/\/[^/]+(?=\/)/i, "")
        .replace(/&amp;/g, "&")
        .split(/[?#]/)[0],
      s = /^\/([a-z_]+)\/(\d+)(?:\/(\d+))?\/?$/.exec(r);
    if (!s || (e && !s[3]))
      throw new Error(
        e ? "올바른 회차 주소가 아닙니다." : `잘못된 작품 주소입니다: ${t}`,
      );
    return {
      category: s[1],
      id: s[2],
      episode: s[3] || "",
      series: `/${s[1]}/${s[2]}`,
    };
  }
  cards(t) {
    const e = new Map();
    for (const r of t.select(".box")) {
      const t = r.selectFirst("a.img[href]");
      let s;
      try {
        s = this.path(attr(t, "href")).series;
      } catch (t) {
        continue;
      }
      const i = t.selectFirst("img"),
        a = text(r, "a.title2") || text(r, "a.title") || attr(i, "alt");
      if (!a || e.has(s)) continue;
      const n = attr(i, "src");
      e.set(s, {
        name: a,
        link: s,
        imageUrl:
          /^https?:\/\//i.test(n) && !/\/img\/no\d*\.png$/.test(n) ? n : "",
      });
    }
    return [...e.values()];
  }
  async listing(t, e) {
    if (!Number.isSafeInteger(e) || e < 1)
      throw new Error("올바른 목록 페이지가 아닙니다.");
    const r = await this.document(t),
      s = this.cards(r),
      i = Math.max(
        0,
        ...r
          .select("a.pg_page[href]")
          .map((t) => Number(/[?&]page=(\d+)/.exec(attr(t, "href"))?.[1] || 0)),
      );
    return { list: s, hasNextPage: s.length > 0 && i > e };
  }
  getPopular(t) {
    return this.listing(`/popular?page=${t}`, t);
  }
  getLatestUpdates(t) {
    return this.listing(`/drama?sst=subidx&page=${t}`, t);
  }
  search(t, e, r) {
    const s = (t) => {
        const e = (r || []).find((e) => e.type === t);
        return e?.values?.[e.state]?.value || "";
      },
      i = String(t || "").trim();
    return i
      ? this.listing(`/search?stx=${encodeURIComponent(i)}&page=${e}`, e)
      : this.listing(
          `/${s("category") || "drama"}?sst=${s("sort") || "subidx"}&page=${e}`,
          e,
        );
  }
  getFilterList() {
    const t = (t, e, r) => ({
      type_name: "SelectFilter",
      type: t,
      name: e,
      state: 0,
      values: r.map(([t, e]) => ({
        type_name: "SelectOption",
        name: e,
        value: t,
      })),
    });
    return [
      { type_name: "HeaderFilter", name: "검색어가 있으면 필터는 무시됩니다" },
      t("category", "분류", CATEGORIES),
      t("sort", "정렬", SORTS),
    ];
  }
  async getDetail(t) {
    const { series: e } = this.path(t),
      r = await this.document(e),
      s =
        text(r, ".bo_v_tit")
          .replace(/\s*(?:\d+화)?\s*다시보기\s*$/, "")
          .trim() || text(r, "a.title.ep-link").replace(/\s*\d+화\s*$/, "");
    if (!s)
      throw new Error(
        "작품 정보를 찾지 못했습니다. WebView에서 접속을 확인하세요.",
      );
    const i = [],
      a = new Set();
    for (const t of r.select("li[data-ep-idx]")) {
      const e = t.selectFirst("a.title.ep-link");
      let r;
      try {
        const t = this.path(attr(e, "href"), !0);
        r = `${t.series}/${t.episode}`;
      } catch (t) {
        continue;
      }
      !a.has(r) &&
        text(e) &&
        (a.add(r), i.push({ name: text(e), url: r, dateUpload: null }));
    }
    if (!i.length) throw new Error("회차 목록을 찾지 못했습니다.");
    const n =
      attr(r.selectFirst("#bo_v_poster img"), "src") ||
      r
        .select("img[src*='image.tmdb.org']")
        .map((t) => attr(t, "src"))
        .find((t) => !t.includes("/w185/")) ||
      "";
    return {
      name: s,
      link: e,
      imageUrl:
        /^https?:\/\//.test(n) && !/\/img\/no\d*\.png$/.test(n) ? n : "",
      description: text(r, "li[data-ep-idx] p"),
      author: "",
      genre: [],
      status: 5,
      chapters: i,
    };
  }
  m3u8(t) {
    const e = String(t || "")
        .replace(/&amp;/g, "&")
        .replace(/\\\//g, "/"),
      r =
        /data-m3u8=["'](https?:\/\/[^"']+)["']/i.exec(e)?.[1] ||
        /https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*/i.exec(e)?.[0] ||
        /<source[^>]*type=["']application\/(?:x-mpegurl|vnd\.apple\.mpegurl)["'][^>]*src=["']([^"']+)["']/i.exec(
          e,
        )?.[1] ||
        /["']?(?:file|src|source|url)["']?\s*[:=]\s*["'](https?:\/\/[^"']*(?:hls|m3u8|stream|video)[^"']*)["']/i.exec(
          e,
        )?.[1] ||
        "";
    return /^https?:\/\//i.test(r) ? r : "";
  }
  async castVideo(t, e, r) {
    if ("function" != typeof createHlsProxyUrl)
      throw new Error(
        "티비위키 재생에는 HLS 프록시를 지원하는 최신 Mangayomi가 필요합니다. 앱을 업데이트해 주세요.",
      );
    let s;
    try {
      s = JSON.parse(
        /window\.TVP_CONFIG\s*=\s*(\{[^\n]*?\})\s*;/.exec(t)?.[1] || "",
      );
    } catch (t) {
      throw new Error("플레이어 설정을 읽지 못했습니다.");
    }
    if (
      !s.id ||
      "e" !== s.pathType ||
      !/^every[1-9]\.poorcdn\.com$/.test(s.host || "") ||
      !/^[a-f0-9]{32}$/.test(s.contentId || "")
    )
      throw new Error("지원하지 않는 티비위키 재생 설정입니다.");
    const i = e.replace(/^(https?:\/\/[^/]+).*/, "$1"),
      a = {
        "User-Agent": USER_AGENT,
        Referer: i + "/",
        Origin: i,
        Accept: "*/*",
      },
      n = async (t, e, r = {}) => {
        const s = await this.client.post(
          t,
          { ...a, "Content-Type": "application/json", ...r },
          e,
        );
        if (200 !== s.statusCode)
          throw new Error(`재생권 요청에 실패했습니다 (HTTP ${s.statusCode}).`);
        try {
          return JSON.parse(s.body);
        } catch (t) {
          throw new Error("재생권 응답을 읽지 못했습니다.");
        }
      },
      o = await n(
        i + "/player/api/cast.php",
        { id: String(s.id) },
        { "X-Player-Cast": "1" },
      ),
      c = "https://" + s.host;
    if (
      1 !== o?.version ||
      String(o.server) !== String(s.server) ||
      o.contentId !== s.contentId ||
      o.origin !== c ||
      o.registerUrl !== c + "/v/cast-register" ||
      "string" != typeof o.grant ||
      !o.grant.startsWith("r1.") ||
      o.grant.length > 384
    )
      throw new Error("올바른 재생권이 아닙니다.");
    const l = await n(o.registerUrl, { cast_grant: o.grant });
    if (
      !0 !== l?.ok ||
      l.contentId !== s.contentId ||
      "string" != typeof l.token ||
      !/^p1\.[A-Za-z0-9_.-]+$/.test(l.token) ||
      l.token.length > 384
    )
      throw new Error("재생권 등록에 실패했습니다.");
    const p = `${c}/v/e/${s.contentId}/c.html?cast=${encodeURIComponent(l.token)}`,
      h = await createHlsProxyUrl(p, a);
    if ("string" != typeof h || !/^http:\/\/127\.0\.0\.1:\d+\//.test(h))
      throw new Error(
        "HLS 프록시를 시작하지 못했습니다. Mangayomi를 업데이트해 주세요.",
      );
    return [
      {
        url: h,
        originalUrl: p,
        quality: "자동 (HLS)",
        headers: a,
        subtitles: r,
      },
    ];
  }
  async getVideoList(t) {
    const { series: e, episode: r } = this.path(t, !0),
      s = await this.site(),
      i = `${s}${e}/${r}`,
      a = await this.document(`${e}/${r}`);
    let n;
    try {
      n = JSON.parse(
        attr(a.selectFirst("iframe#view_iframe"), "data-session1"),
      );
    } catch (t) {}
    if (!n || "object" != typeof n || !n.idx)
      throw new Error(
        "재생 정보를 찾지 못했습니다. WebView에서 회차 페이지를 확인하세요.",
      );
    const o = {
        ...this.getHeaders(),
        Referer: i,
        Origin: s,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      c = await this.client.post(`${s}/api/create_session.php`, o, n);
    if (200 !== c.statusCode)
      throw new Error(`재생 세션을 만들지 못했습니다 (HTTP ${c.statusCode}).`);
    let l;
    try {
      l = JSON.parse(c.body);
    } catch (t) {
      throw new Error("재생 세션 응답을 읽지 못했습니다.");
    }
    if (!l?.success || !/^https:\/\//.test(String(l.player_url || "")))
      throw new Error("재생 세션을 만들지 못했습니다.");
    const p = `${l.player_url}?t=${encodeURIComponent(l.t ?? "")}&sig=${encodeURIComponent(l.sig ?? "")}`,
      h = await this.client.get(p, {
        "User-Agent": USER_AGENT,
        Referer: s + "/",
        Origin: s,
      });
    if (200 !== h.statusCode)
      throw new Error(
        `플레이어 페이지 요청에 실패했습니다 (HTTP ${h.statusCode}).`,
      );
    const d =
      "string" == typeof n.vtt && /^https?:\/\//.test(n.vtt)
        ? [{ file: n.vtt, label: "자막" }]
        : [];
    if (/window\.TVP_CONFIG\s*=/.test(h.body))
      return this.castVideo(h.body, p, d);
    const g = this.m3u8(h.body);
    if (!g) throw new Error("영상 주소(m3u8)를 찾지 못했습니다.");
    const u = p.replace(/^(https?:\/\/[^/]+).*/, "$1");
    return [
      {
        url: g,
        originalUrl: g,
        quality: "자동 (HLS)",
        headers: {
          "User-Agent": USER_AGENT,
          Referer: p,
          Origin: u,
          Accept: "*/*",
        },
        subtitles: d,
      },
    ];
  }
}

