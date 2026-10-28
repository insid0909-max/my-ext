# 작업 규칙 (Claude용)

- 사용자 개인용 망가요미 확장 저장소. 기존 저장소(aniyomi-extensions)의 목록·업데이트 내역·CLAUDE.md 에 이 저장소 내용을 넣지 않음.
- 사용자는 한국어로 대화하며 개발자가 아님. 답변은 한국어로, 쉽게.
- 봇 차단·광고 확인·캡차·암호화·복사 방지를 우회하지 않음 (Cloudflare 는 사용자가 웹뷰로 직접 통과).
- git config user.name "insid0909-max", user.email "266083559+insid0909-max@users.noreply.github.com". 지메일 넣지 않음.
- main 에 바로 올림(앱이 main raw 를 읽음). 파일 version 과 index.json version 같이 올리기, `node --check` 통과.
- SupJav(anime/supjav.js, id 1720450901): 0.0.1 은 사이트 구조를 못 보고(해외·서버에서 Cloudflare 확인에 막힘) 짐작으로 만듦. 재생은 웹뷰로 서버 버튼을 눌러 iframe 주소를 모으고, iframe 을 웹뷰로 열어 m3u8/mp4 를 받음, 안 되면 앱 내장 추출기.
- 설치 시 앱이 getHeaders 를 부름 → 여기서 SharedPreferences 를 읽으면 설치가 조용히 멈춤(망가요미 #1064, 최신 앱에서만 고쳐짐). getHeaders 에서 설정 읽지 말 것 (0.0.3).
