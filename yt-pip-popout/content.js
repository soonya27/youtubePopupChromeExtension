(() => {
  if (window.__ytPop) return; // 중복 주입 방지

  const state = { pipWin: null, video: null, placeholder: null, origStyle: null, origParent: null };

  // ---------- 공통 유틸 ----------
  // 유튜브는 Trusted Types CSP가 걸려 있어서 innerHTML 대신 DOM API로만 요소를 만든다.
  function h(doc, tag, props = {}, children = []) {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'style') Object.assign(el.style, v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v);
    }
    children.forEach((c) => el.append(c));
    return el;
  }

  function toast(msg) {
    const el = h(document, 'div', {
      textContent: msg,
      style: {
        position: 'fixed', left: '50%', bottom: '80px', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,.85)', color: '#fff', padding: '10px 16px', borderRadius: '8px',
        font: '14px system-ui, sans-serif', zIndex: 2147483647,
      },
    });
    document.body.append(el);
    setTimeout(() => el.remove(), 2500);
  }

  function findVideo() {
    const yt = document.querySelector('#movie_player video.html5-main-video');
    if (yt) return yt;
    const vids = [...document.querySelectorAll('video')].filter((v) => v.readyState > 0);
    vids.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
    return vids.find((v) => !v.paused) || vids[0] || null;
  }

  // ---------- 토글 ----------
  async function toggle() {
    if (state.pipWin) { state.pipWin.close(); return; }
    if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return; }

    const video = findVideo();
    if (!video) { toast('재생 중인 영상을 찾지 못했어요'); return; }

    // 1순위: Document Picture-in-Picture (Chrome 116+) — 커스텀 컨트롤까지 넣을 수 있음
    if ('documentPictureInPicture' in window) {
      try { await openDocPip(video); return; }
      catch (e) { console.warn('[YT Pop] Document PiP 실패 → 기본 PiP로 전환', e); }
    }
    // 2순위: 기본 영상 PiP
    try {
      video.disablePictureInPicture = false;
      await video.requestPictureInPicture();
    } catch (e) {
      console.warn('[YT Pop] PiP 실패', e);
      toast('플레이어 오른쪽 아래의 팝아웃 버튼을 눌러주세요');
    }
  }

  // ---------- Document PiP ----------
  const PIP_CSS = `
    html, body { margin:0; height:100%; background:#000; overflow:hidden; font-family:system-ui,sans-serif; }
    #root { position:relative; width:100%; height:100%; }
    #root video { position:absolute !important; inset:0 !important; width:100% !important; height:100% !important;
                  left:0 !important; top:0 !important; object-fit:contain; transform:none !important; }
    #hit { position:absolute; inset:0; cursor:pointer; }
    #bar { position:absolute; left:0; right:0; bottom:0; display:flex; align-items:center; gap:6px;
           padding:28px 10px 8px; color:#fff; font-size:12px;
           background:linear-gradient(transparent, rgba(0,0,0,.8)); opacity:0; transition:opacity .2s; }
    #root.show #bar, #root.paused #bar { opacity:1; }
    #root:not(.show) { cursor:none; }
    button { background:none; border:0; color:#fff; font-size:15px; cursor:pointer; padding:4px 6px; border-radius:4px; }
    button:hover { background:rgba(255,255,255,.15); }
    #seek { flex:1; accent-color:#f00; cursor:pointer; min-width:40px; }
    #time { font-variant-numeric:tabular-nums; white-space:nowrap; }
  `;

  async function openDocPip(video) {
    const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
    const width = 480;
    const pipWin = await documentPictureInPicture.requestWindow({ width, height: Math.round(width / ratio) });

    // 원래 자리에 표시 남겨두기 (닫을 때 되돌리기용)
    state.pipWin = pipWin;
    state.video = video;
    state.origParent = video.parentNode;
    state.placeholder = document.createComment('yt-pop-placeholder');
    video.parentNode.insertBefore(state.placeholder, video);
    state.origStyle = video.getAttribute('style');
    const wasPlaying = !video.paused;

    const d = pipWin.document;
    d.title = document.title;
    const sheet = new pipWin.CSSStyleSheet();
    sheet.replaceSync(PIP_CSS);
    d.adoptedStyleSheets = [sheet];

    const root = h(d, 'div', { id: 'root' }, [
      h(d, 'div', { id: 'hit' }),
      h(d, 'div', { id: 'bar' }, [
        h(d, 'button', { id: 'play', title: '재생/일시정지 (Space)' }),
        h(d, 'button', { id: 'rew', title: '10초 뒤로 (←)', textContent: '⟲' }),
        h(d, 'button', { id: 'fwd', title: '10초 앞으로 (→)', textContent: '⟳' }),
        h(d, 'input', { id: 'seek', type: 'range', min: 0, max: 1000, step: 1, value: 0 }),
        h(d, 'span', { id: 'time' }),
        h(d, 'button', { id: 'mute', title: '음소거 (M)' }),
        h(d, 'button', { id: 'back', title: '탭으로 되돌리기', textContent: '⤓' }),
      ]),
    ]);
    d.body.append(root);

    video.removeAttribute('style'); // 유튜브가 넣는 width/height/left/top 인라인 스타일 제거
    root.prepend(video);            // <video> 자체를 PiP 창으로 이동 → 유튜브 플레이어는 계속 같은 엘리먼트를 제어
    if (wasPlaying && video.paused) video.play().catch(() => {});

    bindControls(d, root, video, pipWin);
    pipWin.addEventListener('pagehide', restore, { once: true });
  }

  function restore() {
    const { video, placeholder, origStyle, origParent } = state;
    if (video) {
      const wasPlaying = !video.paused;
      if (placeholder && placeholder.isConnected) {
        placeholder.parentNode.insertBefore(video, placeholder);
      } else {
        // 유튜브 SPA가 DOM을 갈아끼운 경우 대비
        const container = document.querySelector('#movie_player .html5-video-container') || origParent;
        container && container.prepend(video);
      }
      if (origStyle != null) video.setAttribute('style', origStyle); else video.removeAttribute('style');
      if (wasPlaying && video.paused) video.play().catch(() => {});
    }
    placeholder && placeholder.remove();
    Object.assign(state, { pipWin: null, video: null, placeholder: null, origStyle: null, origParent: null });
    window.dispatchEvent(new Event('resize')); // 유튜브 플레이어 레이아웃 재계산
  }

  function bindControls(d, root, video, pipWin) {
    const $ = (id) => d.getElementById(id);
    const play = $('play'), seek = $('seek'), time = $('time'), mute = $('mute');
    let seeking = false;

    const fmt = (t) => {
      if (!isFinite(t)) return 'LIVE';
      t = Math.floor(t);
      const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = String(t % 60).padStart(2, '0');
      return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
    };
    const update = () => {
      play.textContent = video.paused ? '▶' : '❚❚';
      mute.textContent = video.muted || video.volume === 0 ? '🔇' : '🔊';
      root.classList.toggle('paused', video.paused);
      if (!seeking && isFinite(video.duration) && video.duration > 0) {
        seek.value = (video.currentTime / video.duration) * 1000;
      }
      time.textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
      d.title = document.title;
    };

    const events = ['play', 'pause', 'timeupdate', 'durationchange', 'volumechange', 'loadedmetadata'];
    events.forEach((e) => video.addEventListener(e, update));
    pipWin.addEventListener('pagehide', () => events.forEach((e) => video.removeEventListener(e, update)), { once: true });

    const togglePlay = () => (video.paused ? video.play() : video.pause());
    const skip = (s) => { video.currentTime = Math.max(0, video.currentTime + s); };

    play.onclick = togglePlay;
    $('hit').onclick = togglePlay;
    $('rew').onclick = () => skip(-10);
    $('fwd').onclick = () => skip(10);
    mute.onclick = () => { video.muted = !video.muted; };
    $('back').onclick = () => pipWin.close();
    seek.oninput = () => { seeking = true; time.textContent = `${fmt((seek.value / 1000) * video.duration)} / ${fmt(video.duration)}`; };
    seek.onchange = () => { video.currentTime = (seek.value / 1000) * video.duration; seeking = false; };

    d.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowLeft') skip(-5);
      else if (e.key === 'ArrowRight') skip(5);
      else if (e.key === 'm') video.muted = !video.muted;
      else if (e.key === 'Escape') pipWin.close();
    });

    // 마우스 움직일 때만 컨트롤 표시
    let timer;
    const show = () => {
      root.classList.add('show');
      clearTimeout(timer);
      timer = setTimeout(() => root.classList.remove('show'), 2000);
    };
    d.addEventListener('mousemove', show);
    show();
    update();
  }

  // ---------- 유튜브 플레이어에 버튼 추가 ----------
  // 플레이어 안 버튼 클릭은 "진짜 사용자 클릭"이라 PiP 권한 문제가 가장 적다.
  function pipIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 36 36');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('fill', '#fff');
    path.setAttribute('d', 'M27 11H9c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V13c0-1.1-.9-2-2-2zm0 12H9V13h18v10zm-2-8h-7v6h7v-6z');
    svg.append(path);
    return svg;
  }

  function injectButton() {
    if (!location.hostname.endsWith('youtube.com')) return;
    const controls = document.querySelector('#movie_player .ytp-right-controls');
    if (!controls || controls.querySelector('.yt-pop-btn')) return;
    const btn = h(document, 'button', {
      className: 'ytp-button yt-pop-btn',
      title: '팝아웃 플레이어 (Alt+P)',
      'aria-label': '팝아웃 플레이어',
    }, [pipIcon()]);
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    controls.prepend(btn);
  }

  if (location.hostname.endsWith('youtube.com')) {
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; injectButton(); });
    }).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('yt-navigate-finish', injectButton);
    injectButton();
  }

  window.__ytPop = { toggle };
})();
