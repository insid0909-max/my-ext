;(function(P){
  const capture = function capture(){
  const start=Date.now();let done=false,target=null,identity='',last=null,total=0,samples=0,playingSeen=false,playError='';
  const allowed=u=>/^https:\/\/(?:[a-z0-9-]+\.)?pongping\.top\//i.test(u)&&/\.m3u8(?:[?#]|$)|\/stream\/m3u8\/|\.mp4(?:[?#]|$)/i.test(u);
  function finish(data){if(done)return;done=true;window.flutter_inappwebview.callHandler('setResponse',JSON.stringify(data));}
  function fail(code,message){finish({error:code,message:message});}
  function tick(){
    if(done)return;const videos=Array.from(document.querySelectorAll('video'));
    if(videos.length>1){fail('MULTIPLE_VIDEO','영상 요소가 여러 개여서 본편을 자동 확정하지 않았습니다.');return;}
    if(target&&videos[0]!==target){fail('VIDEO_CHANGED','검사 중 영상 요소가 바뀌었습니다.');return;}
    if(!target&&videos.length===1){target=videos[0];target.addEventListener('playing',()=>{playingSeen=true;});target.muted=true;try{const p=target.play();if(p&&p.catch)p.catch(e=>{playError=String(e.name||'PLAY_REJECTED');});}catch(e){playError=String(e.name||'PLAY_REJECTED');}}
    if(target){
      if(target.error){fail('MEDIA_ERROR','웹뷰 영상 오류 코드 '+Number(target.error.code));return;}
      const src=String(target.currentSrc||target.src||'');
      if(src!==identity){identity=src;last=null;total=0;samples=0;}
      const time=Number(target.currentTime)||0;
      if(!target.paused&&!target.seeking&&!target.ended&&last!==null){const delta=time-last;if(delta>0&&delta<1.5){total+=Math.min(delta,0.6);samples++;}else{total=0;samples=0;}}else{total=0;samples=0;}last=time;
      if(samples>=3&&total>=1){
        if(!allowed(src)){fail('SOURCE_UNBOUND',src.startsWith('blob:')?'웹뷰 시간 진행은 확인했지만 blob 영상과 원본 HLS 주소의 대응은 확인하지 못했습니다.':'웹뷰 시간 진행은 확인했지만 지원하는 직접 영상 주소가 아닙니다.');return;}
        finish({url:src,page:location.href,ua:navigator.userAgent,playbackVerified:true,playingSeen:playingSeen,readyState:Number(target.readyState)||0,advancedSeconds:Number(total.toFixed(2))});return;
      }
    }
    if(Date.now()-start>=16000){fail('PLAYBACK_NOT_CONFIRMED','웹뷰 재생 진행을 확인하지 못했습니다. 영상요소 '+videos.length+'개'+(playError?' / 재생 요청 거부: '+playError:''));return;}
    setTimeout(tick,300);
  }tick();
};
  const origin=u=>/^https?:\/\/[^/?#]+/i.exec(String(u||''))?.[0]||'';
  P.getVideoList=async function(episodeUrl){
    if(typeof evaluateJavascriptViaWebview!=='function')throw Error('웹뷰 실행 API가 없습니다.');
    const p=this.path(episodeUrl,true),doc=await this.document(p.series+'/'+p.episode),frame=doc.selectFirst('iframe#view_iframe'),player=String(frame?.attr('src')||'').replace(/&amp;/g,'&').trim();
    if(!/^https:\/\/player(?:-v\d+)?\.pongping\.top\/player\//i.test(player))throw Error('지원하는 플레이어 주소를 찾지 못했습니다.');
    let raw;try{raw=await evaluateJavascriptViaWebview(player,{Referer:origin(this.baseUrl)+'/'},['('+capture.toString()+')();'],24);}catch(_){throw Error('웹뷰 실행 요청에 실패했습니다.');}
    let result;try{result=JSON.parse(String(raw||''));}catch(_){throw Error('웹뷰가 영상 정보를 반환하지 않았습니다.');}
    if(result.error)throw Error('[웹뷰 인계 0.0.2] '+String(result.message||result.error));
    if(result.playbackVerified!==true)throw Error('웹뷰 재생 진행이 검증되지 않았습니다.');
    if(!/^https:\/\/(?:[a-z0-9-]+\.)?pongping\.top\//i.test(result.url||'')||!origin(result.page)||origin(result.page)!==origin(player)||!result.ua)throw Error('웹뷰 반환 주소를 검증하지 못했습니다.');
    const headers={'User-Agent':String(result.ua),Referer:origin(result.page)+'/',Origin:origin(result.page),Accept:'*/*'},tag='동일 영상 시간 진행 확인',out=[{url:result.url,originalUrl:result.url,quality:'A: 웹뷰 주소 직접 인계 ('+tag+')',headers:headers}];
    if(typeof createHlsProxyUrl==='function'&&!/\.mp4(?:[?#]|$)/i.test(result.url)){try{const local=await createHlsProxyUrl(result.url,headers);if(/^http:\/\/127\.0\.0\.1:\d+\//.test(String(local)))out.push({url:local,originalUrl:result.url,quality:'B: 웹뷰 주소 + 순정 프록시',headers:{}});}catch(_){}}
    return out;
  };
})(DefaultExtension.prototype);
