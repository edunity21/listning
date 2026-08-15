/* ============================================================
   진달래꽃 × 서양음악사 — 제출 백엔드 (Google Apps Script)
   ------------------------------------------------------------
   하는 일
     · 학생이 누구인지 구글 서버에 물어 확인한다 (사칭 차단)
     · @ai.jne.kr 계정이 아니면 거부한다
     · 제출이 열려 있는 시간에만 받는다
     · 받은 내용을 구글 시트에 한 줄씩 쌓는다
     · 교사에게만 목록·통제 권한을 준다

   설치는 같은 폴더의 [설치안내.md] 를 보세요.
   ============================================================ */

/* ▼▼▼ 여기 두 줄만 고치면 됩니다 ▼▼▼ */
var CLIENT_ID = '여기에-구글-클라이언트-ID-붙여넣기.apps.googleusercontent.com';
var TEACHERS  = ['선생님계정@jne.go.kr'];   // 교사 계정. 쉼표로 여러 명 가능
/* ▲▲▲ ------------------------------ ▲▲▲ */

var DOMAIN = 'ai.jne.kr';     // 학생 계정 도메인
var TZ     = 'Asia/Seoul';

var SH_SET  = '설정';
var SH_SUB  = '제출';
var SH_ROLL = '명렬표';
var SH_LOG  = '로그';


/* ===================== 진입점 ===================== */

function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents || '{}');
    out = route_(req);
  } catch (err) {
    out = { ok: false, error: '요청을 읽지 못했습니다: ' + err };
  }
  return json_(out);
}

function doGet() {
  return json_({ ok: true, alive: true, now: nowStr_() });
}

function json_(o) {
  return ContentService
    .createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ===================== 라우팅 ===================== */

function route_(req) {
  var act = String(req.action || '');

  // 토큰 없이 되는 것: 없음. 모든 요청은 신원 확인부터.
  var me = verify_(req.idToken);
  if (!me.ok) return me;

  if (act === 'status')          return status_(me);
  if (act === 'check')           return check_(me);
  if (act === 'submit')          return submit_(me, req);
  if (act === 'teacher_status')  return teacherStatus_(me);
  if (act === 'teacher_window')  return teacherWindow_(me, req);
  if (act === 'teacher_export')  return teacherExport_(me);
  if (act === 'teacher_unbind')  return teacherUnbind_(me, req);
  if (act === 'teacher_delete')  return teacherDelete_(me, req);

  return { ok: false, error: '알 수 없는 요청입니다.' };
}


/* ===================== 신원 확인 =====================
   핵심. 학생이 보낸 idToken 을 구글에 직접 물어본다.
   브라우저에서 조작한 값은 여기서 전부 걸린다.        */

function verify_(idToken) {
  if (!idToken) return { ok: false, error: '로그인이 필요합니다.', need: 'login' };

  var cache = CacheService.getScriptCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));
  var hit = cache.get(key);
  var t;

  if (hit) {
    t = JSON.parse(hit);
  } else {
    var res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      return { ok: false, error: '로그인 정보가 만료되었습니다. 다시 로그인해 주세요.', need: 'login' };
    }
    t = JSON.parse(res.getContentText());
    cache.put(key, JSON.stringify(t), 300);
  }

  if (t.aud !== CLIENT_ID) {
    return { ok: false, error: '이 페이지에서 발급된 로그인이 아닙니다.', need: 'login' };
  }
  if (Number(t.exp) * 1000 < Date.now()) {
    return { ok: false, error: '로그인 시간이 지났습니다. 다시 로그인해 주세요.', need: 'login' };
  }
  if (String(t.email_verified) !== 'true') {
    return { ok: false, error: '확인되지 않은 계정입니다.' };
  }

  var email = String(t.email || '').toLowerCase();
  var teacher = TEACHERS.map(function (x) { return String(x).toLowerCase(); }).indexOf(email) >= 0;

  if (!teacher && email.slice(-(DOMAIN.length + 1)) !== '@' + DOMAIN) {
    return { ok: false, error: '학교에서 받은 @' + DOMAIN + ' 계정으로만 들어올 수 있습니다.\n지금 계정: ' + email, need: 'wrongdomain' };
  }

  return { ok: true, email: email, name: t.name || '', teacher: teacher };
}


/* ===================== 설정 시트 ===================== */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

var HEAD = {};
HEAD[SH_SET]  = ['항목', '값', '설명'];
HEAD[SH_SUB]  = ['제출시각', '이메일', '학번', '이름', '회차', '작성곡수', '차수', '원문JSON'];
HEAD[SH_ROLL] = ['이메일', '학번', '이름', '반'];
HEAD[SH_LOG]  = ['시각', '이메일', '동작', '결과', '메모'];

function sheet_(name, header) {
  var s = ss_().getSheetByName(name);
  if (!s) {
    s = ss_().insertSheet(name);
    var h = header || HEAD[name];
    if (h) s.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
    s.setFrozenRows(1);
  }
  return s;
}

function setup() {                       // ← 최초 1회 직접 실행
  var s = sheet_(SH_SET, ['항목', '값', '설명']);
  if (s.getLastRow() < 2) {
    s.getRange(2, 1, 6, 3).setValues([
      ['제출허용',  'FALSE', 'TRUE 로 바꾸면 학생이 제출할 수 있습니다. 교사 화면의 스위치와 연결됩니다.'],
      ['시작시각',  '',      '비워 두면 제한 없음. 예) 2026-08-20 09:00'],
      ['종료시각',  '',      '비워 두면 제한 없음. 예) 2026-08-20 09:45'],
      ['회차',      '1차',   '엑셀에 함께 기록됩니다.'],
      ['재제출허용', 'TRUE',  'FALSE 면 한 번 낸 학생은 다시 못 냅니다.'],
      ['명렬표검사', 'FALSE', 'TRUE 면 명렬표에 등록된 계정만 제출할 수 있습니다.']
    ]);
  }
  sheet_(SH_SUB,  ['제출시각', '이메일', '학번', '이름', '회차', '작성곡수', '차수', '원문JSON']);
  sheet_(SH_ROLL, ['이메일', '학번', '이름', '반']);
  sheet_(SH_LOG,  ['시각', '이메일', '동작', '결과', '메모']);
  var msg = '준비가 끝났습니다.\n\n[설정] 시트에서 제출 시간을 정하고,\n[명렬표] 시트에 학생 계정을 붙여넣으면 됩니다.';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

function cfg_() {
  var s = sheet_(SH_SET, ['항목', '값', '설명']);
  var v = s.getDataRange().getValues();
  var o = {};
  for (var i = 1; i < v.length; i++) o[String(v[i][0]).trim()] = v[i][1];
  return o;
}

function cfgSet_(key, val) {
  var s = sheet_(SH_SET, ['항목', '값', '설명']);
  var v = s.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][0]).trim() === key) { s.getRange(i + 1, 2).setValue(val); return; }
  }
  s.appendRow([key, val, '']);
}


/* ===================== 제출창 판정 ===================== */

function windowState_() {
  var c = cfg_();
  var on = String(c['제출허용']).toUpperCase() === 'TRUE';
  if (!on) return { open: false, why: '지금은 제출 시간이 아닙니다. 선생님이 열어 주면 제출 단추가 살아납니다.' };

  var now = new Date();
  var from = parseTime_(c['시작시각']);
  var to   = parseTime_(c['종료시각']);

  if (from && now < from) {
    return { open: false, why: '제출 시작 ' + fmt_(from) + ' 부터입니다.' };
  }
  if (to && now > to) {
    return { open: false, why: '제출은 ' + fmt_(to) + ' 에 마감되었습니다.' };
  }
  return { open: true, why: '', from: from ? fmt_(from) : '', to: to ? fmt_(to) : '' };
}

function parseTime_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return v;
  var s = String(v).trim().replace(/\./g, '-').replace(/\//g, '-');
  var m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})[ T]+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0);
}

function fmt_(d) { return Utilities.formatDate(d, TZ, 'M월 d일 HH:mm'); }
function nowStr_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }


/* ===================== 학생 : 상태 ===================== */

function status_(me) {
  var w = windowState_();
  var roll = rollLookup_(me.email);
  var mine = findSubmissions_(me.email);
  var c = cfg_();

  return {
    ok: true,
    teacher: me.teacher,
    email: me.email,
    open: w.open,
    why: w.why,
    from: w.from || '',
    to: w.to || '',
    round: c['회차'] || '',
    fixed: !!roll,                        // 명렬표에 있으면 학번·이름을 못 고침
    sid: roll ? roll.sid : (mine.length ? mine[mine.length - 1].sid : ''),
    name: roll ? roll.name : (mine.length ? mine[mine.length - 1].name : (me.name || '')),
    count: mine.length,
    last: mine.length ? mine[mine.length - 1].at : '',
    now: nowStr_()
  };
}

/* 설치 점검 페이지가 쓰는 자가진단 */
function check_(me) {
  var need = [SH_SET, SH_SUB, SH_ROLL, SH_LOG];
  var missing = [];
  for (var i = 0; i < need.length; i++) {
    if (!ss_().getSheetByName(need[i])) missing.push(need[i]);
  }
  var roll = ss_().getSheetByName(SH_ROLL);
  var w = windowState_();
  return {
    ok: true,
    email: me.email,
    teacher: me.teacher,
    domain: DOMAIN,
    ready: missing.length === 0,
    missing: missing,
    rollCount: roll ? Math.max(0, roll.getLastRow() - 1) : 0,
    inRoll: !!rollLookup_(me.email),
    open: w.open,
    why: w.why,
    teachers: TEACHERS.length,
    now: nowStr_()
  };
}

function rollLookup_(email) {
  var s = ss_().getSheetByName(SH_ROLL);
  if (!s || s.getLastRow() < 2) return null;
  var v = s.getRange(2, 1, s.getLastRow() - 1, 3).getValues();
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][0]).trim().toLowerCase() === email) {
      return { sid: String(v[i][1]).trim(), name: String(v[i][2]).trim() };
    }
  }
  return null;
}

function findSubmissions_(email) {
  var s = sheet_(SH_SUB);
  if (s.getLastRow() < 2) return [];
  var v = s.getRange(2, 1, s.getLastRow() - 1, 6).getValues();
  var out = [];
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][1]).trim().toLowerCase() === email) {
      out.push({ at: v[i][0], sid: String(v[i][2]), name: String(v[i][3]), n: v[i][5] });
    }
  }
  return out;
}


/* ===================== 학생 : 제출 ===================== */

function submit_(me, req) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { ok: false, error: '잠시 뒤 다시 눌러 주세요.' }; }

  try {
    var c = cfg_();
    var w = windowState_();
    if (!w.open) { log_(me.email, '제출', '거부', w.why); return { ok: false, error: w.why, closed: true }; }

    var roll = rollLookup_(me.email);
    if (!roll && String(c['명렬표검사']).toUpperCase() === 'TRUE') {
      log_(me.email, '제출', '거부', '명렬표에 없음');
      return { ok: false, error: '명렬표에 등록되지 않은 계정입니다. 선생님께 말씀해 주세요.' };
    }

    // 학번·이름 확정 — 명렬표가 있으면 학생 입력을 무시한다
    var sid  = roll ? roll.sid  : String(req.sid  || '').trim();
    var name = roll ? roll.name : String(req.name || '').trim();
    if (!/^\d{4,5}$/.test(sid)) return { ok: false, error: '학번을 4~5자리 숫자로 적어 주세요.' };
    if (name.length < 2)        return { ok: false, error: '이름을 적어 주세요.' };

    // 사칭 차단 — 같은 학번을 다른 계정이 쓰고 있으면 거부
    var owner = sidOwner_(sid);
    if (owner && owner !== me.email) {
      log_(me.email, '제출', '거부', sid + ' 는 ' + owner + ' 의 학번');
      return { ok: false, error: sid + ' 학번은 이미 다른 계정이 쓰고 있습니다. 자기 학번이 맞는지 확인해 주세요.' };
    }

    var mine = findSubmissions_(me.email);
    if (mine.length && String(c['재제출허용']).toUpperCase() !== 'TRUE') {
      return { ok: false, error: '이미 제출했습니다. 다시 내려면 선생님께 말씀해 주세요.' };
    }

    var raw = String(req.payload || '');
    if (raw.length < 2)      return { ok: false, error: '보낼 내용이 없습니다. 활동지를 먼저 저장해 주세요.' };
    if (raw.length > 400000) return { ok: false, error: '내용이 너무 깁니다. 선생님께 말씀해 주세요.' };

    sheet_(SH_SUB).appendRow([
      nowStr_(), me.email, sid, name,
      c['회차'] || '', Number(req.count || 0), mine.length + 1, raw
    ]);

    log_(me.email, '제출', '성공', sid + ' ' + name + ' · ' + (req.count || 0) + '곡');
    return { ok: true, at: nowStr_(), nth: mine.length + 1, sid: sid, name: name };

  } finally {
    lock.releaseLock();
  }
}

function sidOwner_(sid) {
  var s = sheet_(SH_SUB);
  if (s.getLastRow() < 2) return null;
  var v = s.getRange(2, 2, s.getLastRow() - 1, 2).getValues();   // 이메일, 학번
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][1]).trim() === String(sid).trim()) return String(v[i][0]).trim().toLowerCase();
  }
  return null;
}

function log_(email, act, result, memo) {
  try { sheet_(SH_LOG).appendRow([nowStr_(), email, act, result, memo || '']); } catch (e) {}
}


/* ===================== 교사 ===================== */

function needTeacher_(me) {
  return me.teacher ? null : { ok: false, error: '수업자 권한이 없는 계정입니다.' };
}

function teacherStatus_(me) {
  var no = needTeacher_(me); if (no) return no;

  var c = cfg_(), w = windowState_();
  var s = sheet_(SH_SUB);
  var rows = [];
  if (s.getLastRow() >= 2) {
    var v = s.getRange(2, 1, s.getLastRow() - 1, 7).getValues();
    for (var i = 0; i < v.length; i++) {
      rows.push({
        row: i + 2, at: String(v[i][0]), email: String(v[i][1]), sid: String(v[i][2]),
        name: String(v[i][3]), round: String(v[i][4]), count: v[i][5], nth: v[i][6]
      });
    }
  }
  rows.sort(function (a, b) { return a.at < b.at ? 1 : -1; });

  var people = {};
  rows.forEach(function (r) { people[r.email] = 1; });

  return {
    ok: true, teacher: true, now: nowStr_(),
    open: w.open, why: w.why,
    on:   String(c['제출허용']).toUpperCase() === 'TRUE',
    from: c['시작시각'] ? String(c['시작시각']) : '',
    to:   c['종료시각'] ? String(c['종료시각']) : '',
    round: c['회차'] || '',
    again: String(c['재제출허용']).toUpperCase() === 'TRUE',
    rollOnly: String(c['명렬표검사']).toUpperCase() === 'TRUE',
    total: rows.length,
    people: Object.keys(people).length,
    rows: rows.slice(0, 400),
    sheetUrl: ss_().getUrl()
  };
}

function teacherWindow_(me, req) {
  var no = needTeacher_(me); if (no) return no;
  if (typeof req.on      !== 'undefined') cfgSet_('제출허용',  req.on ? 'TRUE' : 'FALSE');
  if (typeof req.from    !== 'undefined') cfgSet_('시작시각',  String(req.from || ''));
  if (typeof req.to      !== 'undefined') cfgSet_('종료시각',  String(req.to || ''));
  if (typeof req.round   !== 'undefined') cfgSet_('회차',      String(req.round || ''));
  if (typeof req.again   !== 'undefined') cfgSet_('재제출허용', req.again ? 'TRUE' : 'FALSE');
  if (typeof req.rollOnly!== 'undefined') cfgSet_('명렬표검사', req.rollOnly ? 'TRUE' : 'FALSE');
  log_(me.email, '제출창', '변경', JSON.stringify(req).slice(0, 200));
  return teacherStatus_(me);
}

/* 모든 제출을 하나로 합쳐 돌려준다.
   → 교사가 내려받아 기존 [제출 파일 불러오기] 에 그대로 넣으면
     지금 쓰던 엑셀 기능이 전부 그대로 돌아간다.             */
function teacherExport_(me) {
  var no = needTeacher_(me); if (no) return no;

  var s = sheet_(SH_SUB);
  if (s.getLastRow() < 2) return { ok: true, files: [] };

  var v = s.getRange(2, 1, s.getLastRow() - 1, 8).getValues();
  var latest = {};                                  // 학생마다 마지막 제출만
  for (var i = 0; i < v.length; i++) {
    latest[String(v[i][1]).toLowerCase()] = {
      at: String(v[i][0]), sid: String(v[i][2]), name: String(v[i][3]),
      email: String(v[i][1]), raw: String(v[i][7])
    };
  }
  var files = [];
  for (var k in latest) files.push(latest[k]);
  return { ok: true, files: files, at: nowStr_() };
}

function teacherUnbind_(me, req) {
  var no = needTeacher_(me); if (no) return no;
  var sid = String(req.sid || '').trim();
  var s = sheet_(SH_SUB);
  if (s.getLastRow() < 2) return { ok: true, removed: 0 };
  var v = s.getRange(2, 1, s.getLastRow() - 1, 3).getValues();
  var kill = [];
  for (var i = 0; i < v.length; i++) if (String(v[i][2]).trim() === sid) kill.push(i + 2);
  kill.reverse().forEach(function (r) { s.deleteRow(r); });
  log_(me.email, '학번해제', '완료', sid + ' · ' + kill.length + '행');
  return { ok: true, removed: kill.length };
}

function teacherDelete_(me, req) {
  var no = needTeacher_(me); if (no) return no;
  var row = Number(req.row || 0);
  if (row < 2) return { ok: false, error: '지울 수 없는 줄입니다.' };
  sheet_(SH_SUB).deleteRow(row);
  log_(me.email, '제출삭제', '완료', '행 ' + row);
  return { ok: true };
}


/* ===================== 시트 메뉴 ===================== */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('진달래꽃 제출')
    .addItem('처음 준비하기', 'setup')
    .addItem('지금 제출 열기', 'openNow')
    .addItem('지금 제출 닫기', 'closeNow')
    .addToUi();
}
function openNow()  { cfgSet_('제출허용', 'TRUE');  SpreadsheetApp.getActive().toast('제출을 열었습니다.'); }
function closeNow() { cfgSet_('제출허용', 'FALSE'); SpreadsheetApp.getActive().toast('제출을 닫았습니다.'); }
