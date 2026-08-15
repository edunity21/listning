/* ============================================================
   cloud.js — 온라인 제출 붙이기
   ------------------------------------------------------------
   app.js 를 고치지 않습니다. 뒤에 얹혀서 다음을 더합니다.

     · @ai.jne.kr 구글 계정으로만 들어오기
     · 학번·이름을 계정에 묶어 사칭 막기
     · 선생님이 연 시간에만 제출
     · 선생님 화면에서 제출 열기/닫기 + 실시간 명단
     · 전체화면

   index.html 맨 아래 app.js 다음 줄에 넣으세요.
   ============================================================ */
(function () {
'use strict';

/* ▼▼▼ 설치할 때 이 세 줄만 고칩니다 ▼▼▼ */
var API       = 'https://script.google.com/macros/s/AKfycbzuagmq2b_JfTu3h6te6IreCM0JMKJdXCKKXHAI0qGdft0nF00P_Ftr6Y9FuJ8vqbCtig/exec';
var CLIENT_ID = '205893269353-a88gdh9ijp27v5c7ca0o5ig3absiv89s.apps.googleusercontent.com';
var DOMAIN    = 'ai.jne.kr';
/* ▲▲▲ ------------------------------- ▲▲▲ */

var S = {                     // 지금 상태
  token: null, pass: null, email: '', teacher: false,
  sid: '', name: '', fixed: false,
  open: false, why: '확인 중', round: '', count: 0,
  ready: false, passing: false
};

var $  = function (s, r) { return (r || document).querySelector(s); };
var el = function (t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };

function say(msg) {                        // app.js 의 토스트를 빌려 쓴다
  var t = $('#toast');
  if (!t) { alert(msg); return; }
  t.textContent = msg; t.classList.add('on');
  clearTimeout(say._t); say._t = setTimeout(function () { t.classList.remove('on'); }, 2600);
}


/* ===================== 서버와 이야기하기 =====================
   Content-Type 을 text/plain 으로 보내는 것이 중요합니다.
   Apps Script 는 사전요청(OPTIONS)을 못 받기 때문입니다.      */

function call(action, body) {
  var payload = Object.assign({ action: action, idToken: S.token, pass: S.pass }, body || {});
  return fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'follow'
  })
  .then(function (r) { return r.json(); })
  .then(function (o) {
    if (o && o.need === 'login') { S.token = null; S.pass = null; promptLogin(); }
    if (o && o.need === 'pw')    { S.pass = null; }
    return o;
  })
  .catch(function () {
    return { ok: false, error: '서버에 닿지 못했습니다. 인터넷 연결을 확인해 주세요.' };
  });
}


/* ===================== 구글 로그인 ===================== */

var gisReady = false, gisWaiting = [];

function loadGIS() {
  if (document.getElementById('gis-lib')) return;
  var s = document.createElement('script');
  s.id = 'gis-lib';
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true; s.defer = true;
  s.onload = function () {
    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: onCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
      ux_mode: 'popup',
      hd: DOMAIN                       // 계정 고르는 창에 학교 계정만 뜨게 하는 힌트
    });
    gisReady = true;
    gisWaiting.forEach(function (f) { f(); });
    gisWaiting = [];
  };
  s.onerror = function () { gateMsg('구글 로그인을 불러오지 못했습니다. 학교 와이파이 차단 여부를 확인해 주세요.'); };
  document.head.appendChild(s);
}

function drawButton(box) {
  var go = function () {
    box.innerHTML = '';
    google.accounts.id.renderButton(box, {
      theme: 'outline', size: 'large', shape: 'rectangular',
      text: 'signin_with', locale: 'ko', width: 280
    });
  };
  gisReady ? go() : gisWaiting.push(go);
}

function promptLogin() {
  if (gisReady) google.accounts.id.prompt();
}

function onCredential(res) {
  S.token = res.credential;
  gateMsg('확인하는 중…');
  call('status').then(function (o) {
    if (!o.ok) { gateMsg(o.error || '들어올 수 없는 계정입니다.'); S.token = null; return; }
    S.email = o.email; S.teacher = o.teacher;
    S.sid = o.sid || ''; S.name = o.name || ''; S.fixed = o.fixed;
    S.open = o.open; S.why = o.why; S.round = o.round; S.count = o.count;
    S.ready = true;
    afterLogin(o);
  });
}


/* ===================== 로그인 화면 갈아끼우기 ===================== */

var wanted = null;            // 'student' | 'teacher'

function buildGate() {
  var card = $('.gate-card'); if (!card) return;

  var box = el('div', 'cloud-gate');
  box.style.display = 'none';
  box.innerHTML =
    '<h2 id="cgTitle">학습자용 접속</h2>' +
    '<p class="cg-lead">학교에서 받은 <b>@' + DOMAIN + '</b> 계정으로 들어옵니다.<br>' +
    '다른 계정은 들어올 수 없습니다.</p>' +
    '<div class="cg-gbtn" id="cgBtn"></div>' +
    '<div class="cg-me" id="cgMe" style="display:none"></div>' +
    '<div class="cg-swap" id="cgSwap" style="display:none">' +
      '<button type="button" id="cgOther">내 계정이 아닙니다 · 다른 계정으로</button></div>' +
    '<div class="cg-fields" id="cgFields" style="display:none">' +
      '<div class="fld" id="cgSidBox"><label for="cgSid">학번</label>' +
        '<input id="cgSid" type="text" inputmode="numeric" maxlength="5" placeholder="3105" autocomplete="off"></div>' +
      '<div class="fld" id="cgNameBox"><label for="cgName">이름</label>' +
        '<input id="cgName" type="text" maxlength="10" placeholder="홍길동" autocomplete="off"></div>' +
      '<div class="fld"><label for="cgPw">수업 비밀번호</label>' +
        '<input id="cgPw" type="password" maxlength="20" placeholder="선생님이 알려 준 비밀번호" autocomplete="off"></div>' +
    '</div>' +
    '<p class="cg-msg" id="cgMsg"></p>' +
    '<div class="btn-row" style="justify-content:center">' +
      '<button class="btn" type="button" id="cgGo" style="display:none">들어가기</button>' +
      '<button class="btn ghost" type="button" id="cgBack">뒤로</button>' +
    '</div>';
  card.appendChild(box);

  $('#cgBack').addEventListener('click', function () {
    box.style.display = 'none';
    $('#gatePick').style.display = '';
    wanted = null;
  });

  $('#cgGo').addEventListener('click', enter);

  // 학번을 다 치면 바로 들어갈 수 있게
  ['cgSid', 'cgName', 'cgPw'].forEach(function (id) {
    $('#' + id).addEventListener('keydown', function (e) { if (e.key === 'Enter') enter(); });
  });

  // 앞사람 계정이 남아 있을 때 갈아타기
  $('#cgOther').addEventListener('click', function () {
    try { google.accounts.id.disableAutoSelect(); } catch (e) {}
    S.token = null; S.pass = null; S.ready = false;
    location.reload();
  });
}

function gateMsg(m) { var e = $('#cgMsg'); if (e) e.textContent = m || ''; }

function openGate(role) {
  wanted = role;
  $('#gatePick').style.display = 'none';
  var f = $('#gateForm'); if (f) f.style.display = 'none';
  var box = $('.cloud-gate'); box.style.display = '';
  $('#cgTitle').textContent = role === 'teacher' ? '수업자용 접속' : '학습자용 접속';
  $('#cgFields').style.display = 'none';
  $('#cgGo').style.display = 'none';
  gateMsg('');

  if (S.ready) { afterLogin({ ok: true }); return; }
  $('#cgMe').style.display = 'none';
  $('#cgBtn').style.display = '';
  drawButton($('#cgBtn'));
}

function afterLogin(o) {
  $('#cgBtn').style.display = 'none';
  var me = $('#cgMe');
  me.style.display = '';
  me.innerHTML = '<span class="cg-dot"></span>' + S.email + (S.teacher ? ' · 수업자' : '');
  $('#cgSwap').style.display = '';          // 앞사람 계정일 수 있으니 항상 보여 준다

  if (wanted === 'teacher' && !S.teacher) {
    gateMsg('이 계정은 수업자로 등록되어 있지 않습니다.\n선생님 계정으로 다시 로그인해 주세요.');
    $('#cgFields').style.display = 'none';
    $('#cgGo').style.display = 'none';
    return;
  }

  $('#cgFields').style.display = '';
  $('#cgGo').style.display = '';
  $('#cgPw').value = '';

  if (wanted === 'teacher') {
    $('#cgSidBox').style.display = 'none';
    $('#cgNameBox').style.display = 'none';
    gateMsg('수업자 비밀번호를 입력해 주세요.');
    setTimeout(function () { $('#cgPw').focus(); }, 60);
    return;
  }

  // 학생
  $('#cgSidBox').style.display = '';
  $('#cgNameBox').style.display = '';
  $('#cgSid').value = S.sid;
  $('#cgName').value = S.name;
  if (S.fixed) {
    $('#cgSid').readOnly = true; $('#cgName').readOnly = true;
    $('#cgSid').classList.add('locked'); $('#cgName').classList.add('locked');
    gateMsg('명렬표에 등록된 학번·이름입니다.');
  } else if (S.sid) {
    gateMsg('전에 제출한 학번입니다. 바꾸려면 선생님께 말씀해 주세요.');
  } else {
    gateMsg('학번과 이름을 적고 비밀번호를 입력해 주세요.');
  }
  setTimeout(function () { $((S.fixed || S.sid) ? '#cgPw' : '#cgSid').focus(); }, 60);
}

/* 비밀번호를 서버에 확인받은 뒤에야 들어간다.
   화면을 뜯어고쳐 이 단계를 건너뛰어도, 통행증이 없으면
   제출도 교사 기능도 서버가 거절한다.                     */
function enter() {
  var sid  = S.fixed ? S.sid  : ($('#cgSid')  ? $('#cgSid').value.trim()  : '');
  var name = S.fixed ? S.name : ($('#cgName') ? $('#cgName').value.trim() : '');
  var pw   = $('#cgPw') ? $('#cgPw').value.trim() : '';

  if (wanted === 'student') {
    if (!/^\d{4,5}$/.test(sid)) { gateMsg('학번을 4~5자리 숫자로 적어 주세요.'); return; }
    if (name.length < 2)        { gateMsg('이름을 적어 주세요.'); return; }
  }
  if (!pw) { gateMsg('수업 비밀번호를 입력해 주세요.'); return; }

  var btn = $('#cgGo');
  btn.disabled = true; btn.textContent = '확인 중…';
  gateMsg('');

  call('gate', { role: wanted, pw: pw }).then(function (o) {
    btn.disabled = false; btn.textContent = '들어가기';
    if (!o.ok) {
      gateMsg(o.error || '들어갈 수 없습니다.');
      if ($('#cgPw')) { $('#cgPw').value = ''; $('#cgPw').focus(); }
      return;
    }
    S.pass = o.pass;
    if (wanted === 'student') { S.sid = sid; S.name = name; }
    openApp(sid, name);
  });
}

/* app.js 의 원래 로그인 절차를 그대로 태운다 */
function openApp(sid, name) {
  var pw = (typeof CONFIG === 'object' && CONFIG)
    ? (wanted === 'teacher' ? CONFIG.adminPw : CONFIG.studentPw) : '';

  var f = $('#gateForm');
  if (f) f.style.display = '';
  if ($('#gSid'))  $('#gSid').value  = sid;
  if ($('#gName')) $('#gName').value = name;
  if ($('#gPw'))   $('#gPw').value   = pw;

  // 원래 화면이 수업자용/학습자용을 구분하도록 먼저 눌러 준 뒤 들어간다
  S.passing = true;
  var pick = $(wanted === 'teacher' ? '#pickTeacher' : '#pickStudent');
  if (pick) pick.click();
  if ($('#gSid'))  $('#gSid').value  = sid;
  if ($('#gName')) $('#gName').value = name;
  if ($('#gPw'))   $('#gPw').value   = pw;
  $('#gateGo').click();
  S.passing = false;

  $('.cloud-gate').style.display = 'none';
  setTimeout(mountAll, 60);
}

/* 원래 버튼을 가로챈다 — 문서에서 잡으면 app.js 보다 먼저 걸린다 */
document.addEventListener('click', function (e) {
  if (S.passing) return;
  var t = e.target.closest ? e.target.closest('#pickStudent,#pickTeacher') : null;
  if (!t) return;
  e.stopPropagation(); e.preventDefault();
  openGate(t.id === 'pickTeacher' ? 'teacher' : 'student');
}, true);


/* ===================== 전체화면 ===================== */

function fullscreenSupported() {
  var d = document.documentElement;
  return !!(d.requestFullscreen || d.webkitRequestFullscreen);
}

function toggleFull() {
  var d = document.documentElement;
  var on = document.fullscreenElement || document.webkitFullscreenElement;
  if (on) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else if (d.requestFullscreen) {
    d.requestFullscreen().catch(function () { say('이 브라우저에서는 전체화면이 막혀 있습니다.'); });
  } else if (d.webkitRequestFullscreen) {
    d.webkitRequestFullscreen();
  } else {
    say('아이폰 사파리는 전체화면을 지원하지 않습니다. 크롬을 쓰거나 화면을 아래로 밀어 주세요.');
  }
}

function mountFullscreen() {
  if ($('#fsBtn')) return;
  var bar = $('#who .wrap'); if (!bar) return;
  var b = el('button', 'btn ghost small fsbtn', '<span aria-hidden="true">⛶</span> 전체화면');
  b.type = 'button'; b.id = 'fsBtn'; b.title = '전체화면 (F11 과 같음)';
  b.addEventListener('click', toggleFull);
  bar.insertBefore(b, $('#logout'));

  document.addEventListener('fullscreenchange', paint);
  document.addEventListener('webkitfullscreenchange', paint);
  function paint() {
    var on = document.fullscreenElement || document.webkitFullscreenElement;
    b.innerHTML = on ? '<span aria-hidden="true">⛶</span> 전체화면 끄기'
                     : '<span aria-hidden="true">⛶</span> 전체화면';
    b.classList.toggle('on', !!on);
  }
}


/* ===================== 학생 : 제출 칸 ===================== */

function mountSubmit() {
  if ($('#clSubmitCard')) return;
  var host = $('#sheet .card'); if (!host) return;
  var firstAct = $('#sheet .act');

  var box = el('div', 'act cl-act');
  box.id = 'clSubmitCard';
  box.innerHTML =
    '<p class="act-t">선생님께 온라인 제출</p>' +
    '<div class="cl-state" id="clState"><span class="cl-lamp"></span><b id="clWhy">제출 상태 확인 중…</b></div>' +
    '<div class="btn-row">' +
      '<button class="btn" type="button" id="clSend" disabled>지금 제출하기</button>' +
      '<button class="btn ghost small" type="button" id="clRefresh">상태 새로고침</button>' +
    '</div>' +
    '<p class="cap" id="clMine"></p>' +
    '<p class="cap cl-auto" id="clAuto">[저장하기] 를 누르면 선생님 서버에도 자동으로 보관됩니다.</p>';
  host.insertBefore(box, firstAct || null);

  $('#clSend').addEventListener('click', send);
  $('#clRefresh').addEventListener('click', function () { refresh(true); });
  hookAutosave();
}


/* ===================== 자동 저장 =====================
   [저장하기] 를 누를 때마다 서버에도 조용히 올려 둔다.
   학생이 제출을 잊어도, 브라우저 기록이 지워져도,
   다른 컴퓨터로 옮겨 앉아도 선생님이 꺼낼 수 있다.

   app.js 를 고치지 않는다. 단추에 귀만 하나 더 붙인다.   */

var autoTimer = null, autoLast = '', autoBusy = false;

function hookAutosave() {
  var b = $('#sheetSave');
  if (!b || b.dataset.clAuto) return;
  b.dataset.clAuto = '1';

  // app.js 가 먼저 localStorage 에 쓴 뒤 우리가 읽어야 하므로
  // 기본 단계(버블)에서 듣고, 약간 늦춰 모아 보낸다.
  b.addEventListener('click', function () { queueAutosave(1200); });

  // 탭을 덮거나 닫을 때 마지막으로 한 번 더
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') queueAutosave(0);
  });
}

function queueAutosave(wait) {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(pushAutosave, wait);
}

/* app.js 의 저장소를 그대로 읽는다.
   [제출 파일 만들기] 를 누르는 방식이 아니라서 토스트가 뜨지 않는다. */
function readLocal() {
  try {
    var box = JSON.parse(localStorage.getItem('jindalrae.v3') || '{}');
    var stu = (box.roster || {})[S.sid];
    if (!stu || !stu.tracks) return null;
    var n = Object.keys(stu.tracks).length;
    if (!n) return null;
    return {
      n: n,
      raw: JSON.stringify({
        app: 'jindalrae', ver: 3, exported: stu.updated || '',
        sid: stu.sid, name: stu.name, tracks: stu.tracks
      }, null, 1)
    };
  } catch (e) { return null; }
}

function autoMsg(t) { var e = $('#clAuto'); if (e) e.textContent = t; }

function pushAutosave() {
  if (autoBusy || !S.token || !S.pass || !S.sid) return;

  var p = readLocal();
  if (!p) return;
  if (p.raw === autoLast) return;              // 바뀐 게 없으면 보내지 않는다

  autoBusy = true;
  autoMsg('보관 중…');

  call('autosave', { sid: S.sid, name: S.name, count: p.n, payload: p.raw })
    .then(function (o) {
      autoBusy = false;
      if (o && o.ok) {
        autoLast = p.raw;
        autoMsg('선생님 서버에 보관됨 · ' + String(o.at).slice(11) + ' · ' + p.n + '곡');
        return;
      }
      if (o && o.retry) { queueAutosave(4000); return; }   // 잠깐 밀렸을 뿐
      autoMsg('보관하지 못했습니다. 다음 저장 때 다시 시도합니다.');
    })
    .catch(function () {
      autoBusy = false;
      autoMsg('인터넷이 끊겨 보관하지 못했습니다. 다음 저장 때 다시 시도합니다.');
    });
}

function paintSubmit() {
  var lamp = $('#clState'), why = $('#clWhy'), btn = $('#clSend'), mine = $('#clMine');
  if (!lamp) return;
  lamp.classList.toggle('on', S.open);
  btn.disabled = !S.open;
  why.textContent = S.open
    ? ('제출 열림' + (S.round ? ' · ' + S.round : ''))
    : (S.why || '지금은 제출할 수 없습니다.');
  mine.textContent = S.count
    ? ('이미 ' + S.count + '번 냈습니다. 다시 내면 마지막 것으로 채점됩니다.')
    : '아직 제출하지 않았습니다.';
}

function refresh(loud) {
  if (!S.token) return;
  call('status').then(function (o) {
    if (!o.ok) { if (loud) say(o.error); return; }
    S.open = o.open; S.why = o.why; S.round = o.round; S.count = o.count;
    paintSubmit();
    if (loud) say(o.open ? '제출이 열려 있습니다.' : '아직 닫혀 있습니다.');
  });
}

function send() {
  var btn = $('#clSend');
  btn.disabled = true; btn.textContent = '보내는 중…';
  grabPayload().then(function (p) {
    if (!p.raw || p.raw.length < 4) throw new Error('빈 활동지');
    return call('submit', { sid: S.sid, name: S.name, count: p.count, payload: p.raw });
  }).then(function (o) {
    btn.textContent = '지금 제출하기';
    if (!o.ok) {
      say(o.error || '제출하지 못했습니다.');
      if (o.need === 'pw') say('[나가기]를 누르고 다시 들어와 주세요.');
      if (o.closed) refresh();
      btn.disabled = !S.open; return;
    }
    S.count = o.nth;
    say('제출했습니다 · ' + o.at);
    paintSubmit();
    btn.disabled = false;
  }).catch(function () {
    btn.textContent = '지금 제출하기'; btn.disabled = false;
    say('활동지를 먼저 저장한 뒤 제출해 주세요.');
  });
}

/* app.js 가 [제출 파일 만들기] 로 만드는 그 JSON 을 그대로 가로챈다.
   app.js 내부를 몰라도 되고, 고칠 필요도 없다.                    */
function grabPayload() {
  return new Promise(function (resolve) {
    var origCreate = URL.createObjectURL;
    var origClick  = HTMLAnchorElement.prototype.click;
    var caught = null, restored = false;

    URL.createObjectURL = function (b) {
      if (!caught && b instanceof Blob) caught = b;
      return origCreate.call(URL, b);
    };
    HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute('download')) {
        var h = this.getAttribute('href') || '';
        if (!caught && h.indexOf('data:') === 0) {
          try { caught = new Blob([decodeURIComponent(h.slice(h.indexOf(',') + 1))]); } catch (e) {}
        }
        return;                                   // 파일 내려받기는 건너뛴다
      }
      return origClick.apply(this, arguments);
    };

    function restore() {
      if (restored) return; restored = true;
      URL.createObjectURL = origCreate;
      HTMLAnchorElement.prototype.click = origClick;
    }

    var b = $('#sheetSubmit');
    if (b) { try { b.click(); } catch (e) {} }

    setTimeout(function () {
      restore();
      if (caught && caught.text) {
        caught.text().then(function (raw) { resolve({ raw: raw, count: countTracks(raw) }); })
                     .catch(function () { resolve(fallback()); });
      } else {
        resolve(fallback());
      }
    }, 500);
  });
}

function fallback() {                     // 가로채기가 안 되면 브라우저 저장분을 통째로
  var store = {};
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    store[k] = localStorage.getItem(k);
  }
  var raw = JSON.stringify({ _fallback: true, sid: S.sid, name: S.name, email: S.email, store: store });
  return { raw: raw, count: countTracks(raw) };
}

function countTracks(raw) {
  try {
    var m = raw.match(/"slug"\s*:/g);
    if (m) return m.length;
    m = raw.match(/\b(0[1-9]|1[0-9]|20)-[a-z]+\b/g);        // 01-primitive 같은 이름
    return m ? new Set(m).size : 0;
  } catch (e) { return 0; }
}


/* ===================== 교사 : 통제 패널 ===================== */

function mountTeacher() {
  if (!S.teacher || $('#clAdmin')) return;
  var host = $('#records'); if (!host) return;
  var after = $('#records .sec-head');

  var box = el('section', 'card cl-admin');
  box.id = 'clAdmin';
  box.innerHTML =
    '<h3>제출 통제</h3>' +
    '<p class="cap">여기서 연 시간에만 학생이 제출할 수 있습니다. 학생 화면을 조작해도 서버가 막습니다.</p>' +

    '<div class="cl-switch">' +
      '<button class="cl-toggle" type="button" id="clOn" aria-pressed="false">' +
        '<span class="cl-knob"></span><span class="cl-txt">제출 닫힘</span></button>' +
      '<span class="cl-now" id="clNow"></span>' +
    '</div>' +

    '<div class="cl-grid">' +
      '<label>시작 시각<input type="datetime-local" id="clFrom"></label>' +
      '<label>종료 시각<input type="datetime-local" id="clTo"></label>' +
      '<label>회차 이름<input type="text" id="clRound" maxlength="20" placeholder="1차"></label>' +
    '</div>' +
    '<div class="cl-checks">' +
      '<label><input type="checkbox" id="clAgain"> 다시 제출 허용</label>' +
      '<label><input type="checkbox" id="clRoll"> 명렬표에 있는 계정만 제출</label>' +
    '</div>' +
    '<div class="btn-row">' +
      '<button class="btn" type="button" id="clSave">시간 설정 저장</button>' +
      '<button class="btn ghost small" type="button" id="clClear">시간 제한 없애기</button>' +
    '</div>' +

    '<div class="cl-sum" id="clSum"></div>' +
    '<div class="btn-row">' +
      '<button class="btn" type="button" id="clPull">제출물 받아오기</button>' +
      '<button class="btn ghost" type="button" id="clCsv">명단 CSV</button>' +
      '<button class="btn ghost small" type="button" id="clSheet">구글 시트 열기</button>' +
      '<button class="btn ghost small" type="button" id="clReload">새로고침</button>' +
    '</div>' +
    '<p class="cap">[제출물 받아오기] 를 누르면 학생별 <b>제출_학번_이름.json</b> 이 한꺼번에 내려옵니다. ' +
      '그대로 위의 <b>[제출 파일 불러오기]</b> 에 넣으면 지금 쓰시던 엑셀 기능이 그대로 돌아갑니다.</p>' +

    '<div class="cl-list" id="clList"></div>';

  host.insertBefore(box, after ? after.nextSibling : host.firstChild);

  $('#clOn').addEventListener('click', function () {
    var on = this.getAttribute('aria-pressed') === 'true';
    push({ on: !on });
  });
  $('#clSave').addEventListener('click', function () {
    push({ from: fromLocal($('#clFrom').value), to: fromLocal($('#clTo').value),
           round: $('#clRound').value.trim(),
           again: $('#clAgain').checked, rollOnly: $('#clRoll').checked });
  });
  $('#clClear').addEventListener('click', function () {
    $('#clFrom').value = ''; $('#clTo').value = '';
    push({ from: '', to: '' });
  });
  $('#clReload').addEventListener('click', pull);
  $('#clPull').addEventListener('click', download);
  $('#clCsv').addEventListener('click', csv);
  $('#clSheet').addEventListener('click', function () {
    if (adminData && adminData.sheetUrl) window.open(adminData.sheetUrl, '_blank');
  });

  pull();
  setInterval(function () { if (isVisible($('#records'))) pull(); }, 25000);
}

var adminData = null;

function push(patch) {
  call('teacher_window', patch).then(function (o) {
    if (!o.ok) { say(o.error); return; }
    adminData = o; paintAdmin();
    say('바꿨습니다.');
  });
}

function pull() {
  call('teacher_status').then(function (o) {
    if (!o.ok) { say(o.error); return; }
    adminData = o; paintAdmin();
  });
}

function paintAdmin() {
  var o = adminData; if (!o) return;
  var t = $('#clOn');
  t.setAttribute('aria-pressed', o.on ? 'true' : 'false');
  t.classList.toggle('on', o.on);
  $('.cl-txt', t).textContent = o.on ? '제출 열림' : '제출 닫힘';
  $('#clNow').textContent = o.open ? ('지금 받는 중 · ' + o.now) : (o.why || '');

  if (document.activeElement !== $('#clFrom')) $('#clFrom').value = toLocal(o.from);
  if (document.activeElement !== $('#clTo'))   $('#clTo').value   = toLocal(o.to);
  if (document.activeElement !== $('#clRound'))$('#clRound').value = o.round || '';
  $('#clAgain').checked = !!o.again;
  $('#clRoll').checked  = !!o.rollOnly;

  $('#clSum').innerHTML =
    '<div><b>' + o.people + '</b><span>제출한 학생</span></div>' +
    '<div><b>' + o.total  + '</b><span>총 제출 건수</span></div>' +
    '<div><b>' + (o.round || '–') + '</b><span>회차</span></div>';

  var rows = o.rows || [];
  if (!rows.length) { $('#clList').innerHTML = '<p class="cap">아직 들어온 제출이 없습니다.</p>'; return; }

  var h = '<table class="cl-table"><thead><tr>' +
          '<th>제출시각</th><th>학번</th><th>이름</th><th>곡</th><th>차수</th><th>계정</th><th></th>' +
          '</tr></thead><tbody>';
  rows.forEach(function (r) {
    h += '<tr><td class="mono">' + esc(r.at.slice(5, 16)) + '</td>' +
         '<td class="mono">' + esc(r.sid) + '</td>' +
         '<td>' + esc(r.name) + '</td>' +
         '<td class="mono">' + (r.count || 0) + '</td>' +
         '<td class="mono">' + (r.nth || 1) + '</td>' +
         '<td class="cl-mail">' + esc(r.email) + '</td>' +
         '<td><button class="cl-x" type="button" data-row="' + r.row + '" title="이 제출 지우기">×</button></td></tr>';
  });
  $('#clList').innerHTML = h + '</tbody></table>';

  Array.prototype.forEach.call($('#clList').querySelectorAll('.cl-x'), function (b) {
    b.addEventListener('click', function () {
      if (!confirm('이 제출을 지울까요? 되돌릴 수 없습니다.')) return;
      call('teacher_delete', { row: +b.dataset.row }).then(function (o) {
        if (o.ok) { say('지웠습니다.'); pull(); } else say(o.error);
      });
    });
  });
}

function download() {
  say('받아오는 중…');
  call('teacher_export').then(function (o) {
    if (!o.ok) { say(o.error); return; }
    var f = o.files || [];
    if (!f.length) { say('받을 제출이 없습니다.'); return; }
    f.forEach(function (x, i) {
      setTimeout(function () {
        var nm = '제출_' + (x.sid || '학번') + '_' + (x.name || '이름') + '.json';
        saveText(nm, x.raw);
      }, i * 260);
    });
    say(f.length + '명분을 내려받습니다. 여러 파일 허용을 눌러 주세요.');
  });
}

function csv() {
  if (!adminData) return;
  var rows = [['제출시각', '학번', '이름', '계정', '회차', '작성곡수', '차수']];
  (adminData.rows || []).forEach(function (r) {
    rows.push([r.at, r.sid, r.name, r.email, r.round, r.count, r.nth]);
  });
  var body = rows.map(function (r) {
    return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\r\n');
  saveText('제출명단_' + stamp() + '.csv', '\ufeff' + body, 'text/csv;charset=utf-8');
}

function saveText(name, text, mime) {
  var b = new Blob([text], { type: mime || 'application/json;charset=utf-8' });
  var u = URL.createObjectURL(b);
  var a = document.createElement('a');
  a.href = u; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 800);
}


/* ===================== 잔손질 ===================== */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function stamp() {
  var d = new Date(), p = function (n) { return ('0' + n).slice(-2); };
  return String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate());
}
function toLocal(s) {                       // '2026-08-20 09:00' → input 값
  if (!s) return '';
  var m = String(s).match(/(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/);
  if (!m) return '';
  var p = function (n) { return ('0' + n).slice(-2); };
  return m[1] + '-' + p(m[2]) + '-' + p(m[3]) + 'T' + p(m[4]) + ':' + m[5];
}
function fromLocal(v) { return v ? v.replace('T', ' ') : ''; }
function isVisible(e) { return e && e.offsetParent !== null; }

function mountLogout() {
  var b = $('#logout');
  if (!b || b._cl) return;
  b._cl = 1;
  b.addEventListener('click', function () {
    S.pass = null; S.token = null; S.ready = false; S.teacher = false;
    try { google.accounts.id.disableAutoSelect(); } catch (e) {}
    // app.js 가 제 정리를 마친 뒤 페이지를 새로 연다.
    // 메모리에 아무것도 남지 않으므로 다음 사람은 반드시 처음부터 거친다.
    setTimeout(function () { location.reload(); }, 150);
  }, true);
}

function mountAll() {
  mountFullscreen();
  mountLogout();
  if (S.teacher) mountTeacher();
  else { mountSubmit(); paintSubmit(); refresh(); }
}


/* ===================== 시작 ===================== */

document.addEventListener('DOMContentLoaded', function () {
  if (API.indexOf('http') !== 0) {
    console.warn('[cloud.js] API 주소를 아직 넣지 않았습니다. 온라인 제출이 꺼진 채로 동작합니다.');
    return;
  }
  buildGate();
  loadGIS();
  // 학생 화면에서 20초마다 제출창 상태를 다시 본다
  setInterval(function () { if (S.ready && !S.teacher && isVisible($('#sheet'))) refresh(); }, 20000);
});

var VERSION = 'cloud.js v4 · 자동 저장판';
console.log('[' + VERSION + ']');
window.CLOUD = { version: VERSION, state: S, refresh: refresh, full: toggleFull };

})();
