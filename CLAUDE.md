# 작업 규칙 (Claude용)

- 사용자 개인용 망가요미 확장 저장소. 기존 저장소(aniyomi-extensions)의 목록·업데이트 내역·CLAUDE.md 에 이 저장소 내용을 넣지 않음.
- 사용자는 한국어로 대화하며 개발자가 아님. 답변은 한국어로, 쉽게.
- 봇 차단·광고 확인·캡차·암호화·복사 방지를 우회하지 않음 (Cloudflare 는 사용자가 웹뷰로 직접 통과).
- git config user.name "insid0909-max", user.email "266083559+insid0909-max@users.noreply.github.com". 지메일 넣지 않음.
- main 에 바로 올림(앱이 main raw 를 읽음). 파일 version 과 index.json version 같이 올리기, `node --check` 통과.
- SupJav(anime/supjav.js, id 1720450901): 0.0.1 은 사이트 구조를 못 보고(해외·서버에서 Cloudflare 확인에 막힘) 짐작으로 만듦. 재생은 웹뷰로 서버 버튼을 눌러 iframe 주소를 모으고, iframe 을 웹뷰로 열어 m3u8/mp4 를 받음, 안 되면 앱 내장 추출기.
- 설치 시 앱이 getHeaders 를 부름 → 여기서 SharedPreferences 를 읽으면 설치가 조용히 멈춤(망가요미 #1064, 최신 앱에서만 고쳐짐). getHeaders·getFilterList 등 설치 때 불리는 곳에서 설정은 반드시 try 안에서 읽을 것 (0.0.4).
- SupJav 삭제(사용자 요청, 2026-10-28). 이유: 재생 서버 화면(lk1.supremejav.com/supjav.php?l=…)이 단독으로 열리면 404 로 지우는 장치가 있고, 안쪽 주소(?c=거꾸로 문자열)를 직접 만드는 건 보호 장치 우회라 하지 않음. 망가요미 웹뷰는 바깥 화면만 봐서 안쪽 플레이어(fc2stream 등)의 m3u8 을 못 봄. 다시 만들자고 하면 이 이유를 먼저 알릴 것. id 1720450901 다시 쓰지 말 것.
- MissAV(anime/missav.js, id 1720450902, 2026-10-28): Cloudflare 때문에 구조를 못 보고 짐작으로 만듦. 재생은 작품 화면을 웹뷰로 그대로 열어 performance 기록의 m3u8 을 받음(사이트 코드 풀기·안쪽 주소 직접 만들기 안 함). 목록 기본 주소 https://missav123.com/dm270/ko. 0.0.1 휴대폰에서 목록·재생 잘 됨 확인(2026-10-28).
- MissAV 0.0.3: 분류 필터(사이트 메뉴 그대로 33개, 2026-10-28 사용자가 준 첫 화면 HTML 기준, 목록 주소는 /dmNN/ko/이름), 카드는 그림 있는 링크만(메뉴 링크 fc2·1pondo 제외), 품번에 밑줄·하이픈 없는 것(pondo-102726_001, md0303)도 인식. dm270/ko 는 첫 화면(추천·새로운 출시·최근 업데이트 섹션)이라 다음 쪽이 없을 수 있음. 장르는 장르 화면 HTML 이 없어 미적용.
