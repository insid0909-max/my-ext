;(function(P){
  const capture = function(){
    const started=Date.now();let done=false,blob=false;
    const allowed=u=>/^https:\/\/(?:[a-z0-9-]+\.)?pongping\.top\//i.test(u)&&(/\.m3u8(?:[?#]|$)|\/stream\/m3u8\/|\.mp4(?:[?#]|$)/i.test(u));
    function finish(data){if(done)return;done=true;window.flutter_inappwebview.callHandler('setResponse',JSON.stringify(data));}
    function tick(){
      if(done)return;
      const candidates=[],videos=Array.from(document.querySelectorAll('video'));
      let ready=0;
      for(const v of videos){ready=Math.max(ready,Number(v.readyState)||0);for(const u of [v.currentSrc,v.src]){if(String(u).startsWith('blob:'))blob=true;if(u)candidates.push(u);}if(!v.__handoffAttempt){v.__handoffAttempt=true;v.muted=true;try{const p=v.play();if(p&&p.catch)p.catch(()=>{});}catch(_){}}}
      for(const s of document.querySelectorAll('video source[src]'))candidates.push(s.src);
      try{for(const e of performance.getEntriesByType('resource'))candidates.push(e.name);}catch(_){}
      const urls=Array.from(new Set(candidates.filter(u=>allowed(String(u)))));
      const age=Date.now()-started;
      if(urls.length&&(ready>=2||age>=6000)){finish({url:urls[0],page:location.href,ua:navigator.userAgent,readyState:ready,blob:blob});return;}
      if(age>=12000){finish({error:blob?'BLOB_ONLY':'NO_STREAM',readyState:ready,blob:blob});return;}
      setTimeout(tick,300);
    }
    tick();
  };
  const origin=u=>/^https?:\/\/[^/?#]+/i.exec(String(u||''))?.[0]||'';
  P.getVideoList=async function(episodeUrl){
    if(typeof evaluateJavascriptViaWebview!=='function')throw Error('웹뷰 실행 API가 없습니다.');
    const p=this.path(episodeUrl,true),doc=await this.document(p.series+'/'+p.episode),frame=doc.selectFirst('iframe#view_iframe'),player=String(frame?.attr('src')||'').replace(/&amp;/g,'&').trim();
    if(!/^https:\/\/player(?:-v\d+)?\.pongping\.top\/player\//i.test(player))throw Error('지원하는 플레이어 주소를 찾지 못했습니다.');
    let raw;try{raw=await evaluateJavascriptViaWebview(player,{Referer:origin(this.baseUrl)+'/'},['('+capture.toString()+')();'],18);}catch(_){throw Error('웹뷰 실행 요청에 실패했습니다.');}
    let result;try{result=JSON.parse(String(raw||''));}catch(_){throw Error('웹뷰가 영상 정보를 반환하지 않았습니다.');}
    if(result.error)throw Error(result.error==='BLOB_ONLY'?'웹뷰 내부 blob 영상만 확인됐습니다. 일반 영상 주소를 인계하지 못했습니다.':'웹뷰에서 지원하는 영상 주소를 확인하지 못했습니다.');
    if(!/^https:\/\/(?:[a-z0-9-]+\.)?pongping\.top\//i.test(result.url||'')||!origin(result.page)||origin(result.page)!==origin(player)||!result.ua)throw Error('웹뷰 반환 주소를 검증하지 못했습니다.');
    const headers={'User-Agent':String(result.ua),Referer:origin(result.page)+'/',Origin:origin(result.page),Accept:'*/*'},tag=Number(result.readyState)>=2?'웹뷰 데이터 로드 확인':'주소만 확인',out=[{url:result.url,originalUrl:result.url,quality:'A: 웹뷰 주소 직접 인계 ('+tag+')',headers:headers}];
    if(typeof createHlsProxyUrl==='function'&&!/\.mp4(?:[?#]|$)/i.test(result.url)){try{const local=await createHlsProxyUrl(result.url,headers);if(/^http:\/\/127\.0\.0\.1:\d+\//.test(String(local)))out.push({url:local,originalUrl:result.url,quality:'B: 웹뷰 주소 + 순정 프록시',headers:{}});}catch(_){}}
    return out;
  };
})(DefaultExtension.prototype);
