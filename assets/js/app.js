/* ============================================================
   진달래꽃 × 서양음악사 — 앱 로직
   학습자용 / 수업자용 화면 분리, 로그인, 음량 조절, 기록 관리
   ============================================================ */

(function () {
  "use strict";

  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const byId = (id) => document.getElementById(id);

  const AUDIO_DIR = "audio/";
  const eraOf = (id) => ERAS.find((e) => e.id === id) || ERAS[0];
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const STUDENT_TABS = ["explore", "quiz", "order", "sheet"];
  const TEACHER_TABS = ["stage", "records", "lesson", "explore"];

  /* ---------- 저장소 ---------- */
  const Store = (function () {
    const KEY = "jindalrae.v3";
    let mem = {}, live = false;
    try {
      window.localStorage.setItem("__t", "1");
      window.localStorage.removeItem("__t");
      live = true;
      mem = JSON.parse(window.localStorage.getItem(KEY) || "{}");
    } catch (e) { live = false; mem = {}; }
    return {
      get(k, d) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : d; },
      set(k, v) {
        mem[k] = v;
        if (!live) return true;
        try { window.localStorage.setItem(KEY, JSON.stringify(mem)); return true; } catch (e) { return false; }
      },
      persistent: live
    };
  })();

  const shuffle = (a0) => {
    const a = a0.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  };
  const mmss = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60), x = Math.floor(s % 60);
    return m + ":" + (x < 10 ? "0" : "") + x;
  };
  const p2 = (n) => (n < 10 ? "0" : "") + n;
  const stamp = () => { const d = new Date(); return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + " " + p2(d.getHours()) + ":" + p2(d.getMinutes()); };
  const fstamp = () => { const d = new Date(); return String(d.getFullYear()).slice(2) + p2(d.getMonth() + 1) + p2(d.getDate()); };

  function saveBlob(name, text, mime) {
    const blob = new Blob([text], { type: (mime || "text/plain") + ";charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  function toast(msg, kind) {
    const t = byId("toast");
    t.textContent = msg;
    t.className = "toast on" + (kind ? " " + kind : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = "toast"; }, 3200);
  }

  function copyText(text, cb) {
    const fallback = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta); cb(ok);
      } catch (e) { cb(false); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(text).then(() => cb(true), fallback);
    else fallback();
  }

  const csvCell = (v) => { const s = String(v == null ? "" : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const toCsv = (rows) => "\ufeff" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");

  /* ============================================================
     명단
     ============================================================ */
  const Roster = {
    all() { return Store.get("roster", {}); },
    save(r) { if (!Store.set("roster", r)) toast("저장 공간이 가득 찼습니다. 백업 후 정리해 주세요.", "bad"); },
    of(sid) { return this.all()[sid] || null; },
    ensure(sid, name) {
      const r = this.all();
      if (!r[sid]) r[sid] = { sid, name, updated: stamp(), tracks: {} };
      else if (name) r[sid].name = name;
      this.save(r);
      return r[sid];
    },
    putTrack(sid, slug, rec) {
      const r = this.all(); if (!r[sid]) return;
      r[sid].tracks[slug] = rec; r[sid].updated = stamp(); this.save(r);
    },
    remove(sid) { const r = this.all(); delete r[sid]; this.save(r); },
    list() { const r = this.all(); return Object.keys(r).sort().map((k) => r[k]); }
  };

  /* ============================================================
     로그인 — 학습자용 / 수업자용
     ============================================================ */
  const Auth = {
    me: null,
    mode: "student",

    start() {
      byId("gateSchool").textContent = CONFIG.schoolName + " " + CONFIG.subject;
      byId("pickStudent").addEventListener("click", () => this.setMode("student"));
      byId("pickTeacher").addEventListener("click", () => this.setMode("teacher"));
      byId("gateGo").addEventListener("click", () => this.submit());
      byId("gateBack").addEventListener("click", () => this.setMode(null));
      $$("#gate input").forEach((el) => el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); this.submit(); }
      }));
      byId("logout").addEventListener("click", () => this.logout());

      const s = Store.get("session", null);
      if (s && s.role) { this.enter(s, true); return; }
      this.setMode(null);
      this.show();
    },

    setMode(m) {
      this.mode = m;
      byId("gatePick").style.display = m ? "none" : "";
      byId("gateForm").style.display = m ? "" : "none";
      byId("gateErr").textContent = "";
      if (!m) return;
      const stu = m === "student";
      byId("gateFormTitle").textContent = stu ? "학습자용 접속" : "수업자용 접속";
      byId("gateHint").textContent = stu
        ? "학번은 학년·반·번호를 붙여 씁니다. 3학년 1반 5번이면 3105."
        : "담당 선생님용입니다. 수업 진행 화면과 학생 기록 관리를 쓸 수 있습니다.";
      byId("fSid").style.display = stu ? "" : "none";
      byId("fName").style.display = stu ? "" : "none";
      byId("gateGo").textContent = stu ? "들어가기" : "수업자용으로 들어가기";
      setTimeout(() => { const f = stu ? byId("gSid") : byId("gPw"); if (f) f.focus(); }, 70);
    },

    submit() {
      const err = byId("gateErr");
      const pw = byId("gPw").value.trim();

      if (this.mode === "teacher") {
        if (pw !== CONFIG.adminPw) { err.textContent = "수업자용 비밀번호가 맞지 않습니다."; return; }
        this.enter({ role: "teacher", name: "담당 교사", sid: "", at: stamp() });
        return;
      }
      const sid = byId("gSid").value.trim(), name = byId("gName").value.trim();
      if (!/^\d{4,5}$/.test(sid)) { err.textContent = "학번은 숫자 4자리 또는 5자리로 입력하세요. 예) 3105"; return; }
      if (name.length < 2) { err.textContent = "이름을 두 글자 이상 입력하세요."; return; }
      if (pw !== CONFIG.studentPw) { err.textContent = "비밀번호가 맞지 않습니다."; return; }
      Roster.ensure(sid, name);
      this.enter({ role: "student", sid, name, at: stamp() });
    },

    label(sid) {
      if (!/^\d{4,5}$/.test(sid)) return sid;
      const g = sid.slice(0, 1);
      const c = sid.length === 4 ? sid.slice(1, 2) : sid.slice(1, 3);
      return g + "학년 " + (+c) + "반 " + (+sid.slice(-2)) + "번";
    },

    enter(s, silent) {
      this.me = s;
      Store.set("session", s);
      byId("gate").classList.remove("on");
      document.body.classList.remove("locked");
      const teacher = s.role === "teacher";

      document.body.classList.toggle("mode-teacher", teacher);
      document.body.classList.toggle("mode-student", !teacher);

      byId("whoName").textContent = s.name;
      byId("whoSid").textContent = teacher ? "수업자용 화면" : this.label(s.sid);
      byId("whoRole").textContent = teacher ? "수업자" : "학습자";
      byId("who").classList.add("on");
      byId("who").classList.toggle("teacher", teacher);
      byId("modeBadge").textContent = teacher ? "수업자용" : "학습자용";

      const allow = teacher ? TEACHER_TABS : STUDENT_TABS;
      $$(".tab").forEach((b) => { b.style.display = allow.indexOf(b.dataset.tab) > -1 ? "" : "none"; });

      if (teacher) { Records.render(); Stage.show(Stage.i); goTab("stage"); }
      else { Sheet.render(); goTab("explore"); }

      if (!silent) toast(teacher ? "수업자용 화면으로 들어왔습니다." : s.name + "님, 반갑습니다.");
    },

    logout() {
      Store.set("session", null);
      this.me = null;
      audio.pause();
      byId("who").classList.remove("on");
      byId("gPw").value = "";
      document.body.classList.remove("mode-teacher", "mode-student");
      this.setMode(null);
      this.show();
    },

    show() {
      byId("gate").classList.add("on");
      document.body.classList.add("locked");
    }
  };

  /* ============================================================
     플레이어 (음량 조절 포함)
     ============================================================ */
  const audio = new Audio();
  audio.preload = "none";

  const P = { idx: -1, loop: false, vol: 0.85, muted: false, els: {} };

  const SVG = {
    play:  '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><rect x="6.5" y="4.5" width="4" height="15" rx="1"/><rect x="13.5" y="4.5" width="4" height="15" rx="1"/></svg>',
    spk:   '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 8.5a4.5 4.5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    mute:  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>'
  };

  function bindPlayer() {
    P.els = {
      title: byId("plTitle"), sub: byId("plSub"), play: byId("plPlay"),
      prev: byId("plPrev"), next: byId("plNext"), back: byId("plBack"),
      loop: byId("plLoop"), seek: byId("plSeek"), cur: byId("plCur"),
      dur: byId("plDur"), rate: byId("plRate"), err: byId("plErr"),
      vol: byId("plVol"), volTxt: byId("plVolTxt"), mute: byId("plMute"),
      volDn: byId("plVolDn"), volUp: byId("plVolUp")
    };

    P.vol = Store.get("vol", 0.85);
    P.muted = false;
    applyVol();

    P.els.play.addEventListener("click", () => {
      if (P.idx < 0) { load(0, true); return; }
      audio.paused ? audio.play().catch(showErr) : audio.pause();
    });
    P.els.prev.addEventListener("click", () => step(-1));
    P.els.next.addEventListener("click", () => step(1));
    P.els.back.addEventListener("click", () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
    P.els.loop.addEventListener("click", () => {
      P.loop = !P.loop; audio.loop = P.loop;
      P.els.loop.classList.toggle("on", P.loop);
      P.els.loop.setAttribute("aria-pressed", String(P.loop));
      toast(P.loop ? "한 곡 반복을 켰습니다." : "한 곡 반복을 껐습니다.");
    });
    P.els.rate.addEventListener("change", () => { audio.playbackRate = parseFloat(P.els.rate.value); });
    P.els.seek.addEventListener("input", () => {
      if (isFinite(audio.duration)) audio.currentTime = (P.els.seek.value / 1000) * audio.duration;
    });

    /* --- 음량 --- */
    P.els.vol.addEventListener("input", () => { P.vol = +P.els.vol.value / 100; P.muted = false; applyVol(); });
    P.els.volDn.addEventListener("click", () => bumpVol(-0.1));
    P.els.volUp.addEventListener("click", () => bumpVol(+0.1));
    P.els.mute.addEventListener("click", () => { P.muted = !P.muted; applyVol(); });

    audio.addEventListener("play",  () => { setPlayIcon(true);  markStaff(); });
    audio.addEventListener("pause", () => { setPlayIcon(false); markStaff(); });
    audio.addEventListener("ended", () => { setPlayIcon(false); markStaff(); });
    audio.addEventListener("loadedmetadata", () => { P.els.dur.textContent = mmss(audio.duration); });
    audio.addEventListener("timeupdate", () => {
      P.els.cur.textContent = mmss(audio.currentTime);
      if (isFinite(audio.duration) && audio.duration > 0)
        P.els.seek.value = Math.round((audio.currentTime / audio.duration) * 1000);
    });
    audio.addEventListener("error", () => showErr("음원을 불러오지 못했습니다. audio 폴더를 확인하세요."));

    document.addEventListener("keydown", (e) => {
      if (byId("gate").classList.contains("on")) return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button") return;
      if (e.code === "Space") { e.preventDefault(); P.els.play.click(); }
      else if (e.code === "ArrowUp")   { e.preventDefault(); bumpVol(+0.05); }
      else if (e.code === "ArrowDown") { e.preventDefault(); bumpVol(-0.05); }
      else if (e.code === "ArrowRight") { e.preventDefault(); step(1); }
      else if (e.code === "ArrowLeft")  { e.preventDefault(); step(-1); }
    });
  }

  function bumpVol(d) {
    P.muted = false;
    P.vol = Math.max(0, Math.min(1, Math.round((P.vol + d) * 100) / 100));
    applyVol();
  }

  function applyVol() {
    audio.volume = P.muted ? 0 : P.vol;
    const pct = Math.round(P.vol * 100);
    P.els.vol.value = pct;
    P.els.volTxt.textContent = P.muted ? "음소거" : pct + "%";
    P.els.mute.innerHTML = P.muted || P.vol === 0 ? SVG.mute : SVG.spk;
    P.els.mute.classList.toggle("on", P.muted);
    P.els.mute.setAttribute("aria-label", P.muted ? "음소거 해제" : "음소거");
    P.els.volDn.disabled = P.vol <= 0;
    P.els.volUp.disabled = P.vol >= 1;
    Store.set("vol", P.vol);
  }

  let cursor = 0;   /* 지금 화면에 보고 있는 곡 */

  function step(d) {
    const i = (cursor + d + TRACKS.length) % TRACKS.length;
    Quiz.hiding = false;
    if (document.body.classList.contains("mode-teacher")) Stage.show(i);
    else showDetail(i);
    load(i, true);
  }

  function setPlayIcon(on) {
    P.els.play.innerHTML = on ? SVG.pause : SVG.play;
    P.els.play.setAttribute("aria-label", on ? "일시정지" : "재생");
    const sp = byId("stPlay");
    if (sp) sp.innerHTML = (on ? SVG.pause : SVG.play) + "<span>" + (on ? "멈춤" : "재생") + "</span>";
  }

  function showErr(msg) {
    if (typeof msg !== "string") msg = "재생할 수 없습니다. 화면을 한 번 눌러 주세요.";
    P.els.err.textContent = msg;
    P.els.err.classList.add("on");
    setTimeout(() => P.els.err.classList.remove("on"), 5000);
  }

  function load(i, autoplay) {
    const t = TRACKS[i]; if (!t) return;
    P.idx = i;
    audio.src = AUDIO_DIR + t.slug + ".mp3";
    audio.playbackRate = parseFloat(P.els.rate.value);
    audio.loop = P.loop;
    audio.volume = P.muted ? 0 : P.vol;
    const hide = Quiz.hiding || Stage.blind;
    P.els.title.textContent = hide ? "???" : t.title;
    P.els.sub.textContent = hide ? "블라인드 감상 중" : t.sub + " · " + t.years;
    P.els.cur.textContent = "0:00"; P.els.dur.textContent = "0:00"; P.els.seek.value = 0;
    if (autoplay) audio.play().catch(showErr);
    markStaff();
    if (byId("stJump")) Stage.mark();
  }

  function playTrack(i) {
    if (P.idx === i && !audio.paused) { audio.pause(); return; }
    if (P.idx === i && audio.paused && audio.currentTime > 0) { audio.play().catch(showErr); return; }
    load(i, true);
  }

  /* ============================================================
     오선 타임라인
     ============================================================ */
  function buildStaff() {
    const staff = byId("staff"), eraRow = byId("eraRow");
    let html = '<span class="bracket" aria-hidden="true"></span>';
    for (let k = 0; k < 5; k++) html += '<span class="line" style="bottom:' + (16 + k * 16) + '%"></span>';
    TRACKS.forEach((t, i) => {
      const x = ((i + 0.5) / TRACKS.length) * 100, y = 16 + (t.layers - 1) * 16;
      html += '<button class="note' + (t.layers >= 4 ? " down" : "") + '" type="button" data-i="' + i + '"' +
        ' style="left:' + x.toFixed(3) + '%;bottom:' + y + '%" title="' + esc(t.n + ". " + t.title) + '">' +
        '<span class="head"></span><span class="stem"></span><span class="num">' + t.n + '</span>' +
        '<span class="sr-only">' + esc(t.n + "번 " + t.title) + '</span></button>';
    });
    staff.innerHTML = html;
    staff.addEventListener("click", (e) => {
      const b = e.target.closest(".note"); if (!b) return;
      const i = +b.dataset.i;
      Quiz.hiding = false;
      showDetail(i); playTrack(i);
    });

    let er = "";
    ERAS.forEach((era) => {
      const n = TRACKS.filter((t) => t.era === era.id).length; if (!n) return;
      er += '<div class="era-cell" style="flex-grow:' + n + ';flex-shrink:0;flex-basis:0">' +
        '<b style="color:' + era.color + '">' + era.name + "</b><span>" + era.years + "</span></div>";
    });
    eraRow.innerHTML = er;
  }

  function markStaff() {
    $$("#staff .note").forEach((b) => {
      const on = !Quiz.hiding && +b.dataset.i === P.idx;
      b.setAttribute("aria-current", on ? "true" : "false");
      b.classList.toggle("playing", on && !audio.paused);
    });
  }

  /* ============================================================
     상세 카드
     ============================================================ */
  function showDetail(i) {
    cursor = i;
    const t = TRACKS[i], era = eraOf(t.era), box = byId("detail");
    box.style.setProperty("--era-color", era.color);
    const isStu = Auth.me && Auth.me.role === "student";

    box.innerHTML =
      '<div class="detail-top"><div class="chip-row">' +
        '<span class="chip">' + p2(t.n) + ' / 20</span>' +
        '<span class="chip era">' + esc(era.name) + '</span>' +
        '<span class="chip">' + esc(t.years) + '</span>' +
        '<span class="chip">성부·음향 층 ' + t.layers + '/5</span></div>' +
        "<h3>" + esc(t.title) + '</h3><p class="sub">' + esc(t.sub) + '</p>' +
        '<p class="one">' + esc(t.one) + '</p>' +
        '<div class="btn-row" style="margin-top:22px">' +
        '<button class="btn" type="button" data-play>이 곡 듣기</button>' +
        (isStu ? '<button class="btn ghost" type="button" data-sheet>활동지에 기록하기</button>' : "") +
      "</div></div>" +
      '<div class="detail-body"><div class="dcol">' +
        '<div class="blk"><h4>시대 배경</h4><p>' + esc(t.bg) + "</p></div>" +
        '<div class="blk"><h4>음악적 특징</h4><ul>' + t.traits.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul></div>" +
        '<div class="blk"><h4>이렇게 들어 보세요</h4><ol>' + t.listen.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ol></div>" +
      '</div><div class="dcol">' +
        '<div class="blk"><h4>핵심 용어</h4><div class="wordchips">' + t.words.map((w) => '<span class="wordchip">' + esc(w) + "</span>").join("") + "</div></div>" +
        '<div class="blk"><h4>대표 작곡가 · 작품</h4><p>' + esc(t.who) + "</p></div>" +
        '<div class="blk"><h4>가사를 다루는 방식</h4><div class="lyric-note">' + esc(t.lyric) + "</div></div>" +
        '<div class="blk"><h4>노랫말</h4><div class="mini-poem">' + POEM.map((s) => "<div>" + s.join("<br>") + "</div>").join("") + "</div></div>" +
      "</div></div>";

    box.querySelector("[data-play]").addEventListener("click", () => { Quiz.hiding = false; playTrack(i); });
    const sb = box.querySelector("[data-sheet]");
    if (sb) sb.addEventListener("click", () => { byId("sheetPick").value = String(i); Sheet.render(); goTab("sheet"); });
    markStaff();
  }

  /* ============================================================
     수업 진행 화면 (수업자용)
     ============================================================ */
  const Stage = {
    i: 0, blind: false, lyric: false,

    start() {
      byId("stPrev").addEventListener("click", () => step(-1));
      byId("stNext").addEventListener("click", () => step(1));
      byId("stPlay").addEventListener("click", () => {
        if (P.idx !== this.i) { load(this.i, true); return; }
        audio.paused ? audio.play().catch(showErr) : audio.pause();
      });
      byId("stBlind").addEventListener("click", () => {
        this.blind = !this.blind;
        byId("stBlind").classList.toggle("on", this.blind);
        byId("stBlind").setAttribute("aria-pressed", String(this.blind));
        this.show(this.i);
        if (P.idx >= 0) {
          P.els.title.textContent = this.blind ? "???" : TRACKS[P.idx].title;
          P.els.sub.textContent = this.blind ? "블라인드 감상 중" : TRACKS[P.idx].sub + " · " + TRACKS[P.idx].years;
        }
        toast(this.blind ? "제목을 가렸습니다. 학생이 맞혀 보게 하세요." : "제목을 다시 보입니다.");
      });
      byId("stLyric").addEventListener("click", () => {
        this.lyric = !this.lyric;
        byId("stLyric").classList.toggle("on", this.lyric);
        byId("stLyricBox").style.display = this.lyric ? "" : "none";
      });
      byId("stLyricBox").innerHTML = POEM.map((s) => "<div>" + s.join("<br>") + "</div>").join("");

      byId("stJump").innerHTML = TRACKS.map((t, i) =>
        '<button class="jump" type="button" data-i="' + i + '" title="' + esc(t.title) + '">' + t.n + "</button>").join("");
      byId("stJump").querySelectorAll(".jump").forEach((b) =>
        b.addEventListener("click", () => { this.show(+b.dataset.i); load(+b.dataset.i, true); }));

      this.show(0);
    },

    show(i) {
      this.i = i;
      cursor = i;
      const t = TRACKS[i], era = eraOf(t.era);
      byId("stage").style.setProperty("--era-color", era.color);
      byId("stNum").textContent = p2(t.n);
      byId("stTitle").textContent = this.blind ? "???" : t.title;
      byId("stSub").textContent = this.blind ? "무엇일까요?" : t.sub;
      byId("stEra").textContent = this.blind ? "시대를 맞혀 보세요" : era.name + " · " + t.years;
      byId("stEra").style.color = this.blind ? "var(--ink-3)" : era.color;
      byId("stPoints").innerHTML = this.blind
        ? t.listen.map((x) => "<li>" + esc(x) + "</li>").join("")
        : t.traits.slice(0, 4).map((x) => "<li>" + esc(x) + "</li>").join("");
      byId("stPointsTitle").textContent = this.blind ? "이렇게 들어 보세요" : "음악적 특징";
      byId("stOne").textContent = this.blind ? "" : t.one;
      this.mark();
    },

    mark() {
      const jw = byId("stJump"); if (!jw) return;
      jw.querySelectorAll(".jump").forEach((b) => {
        b.classList.toggle("on", +b.dataset.i === this.i);
        b.classList.toggle("live", +b.dataset.i === P.idx && !audio.paused);
      });
    }
  };

  /* ============================================================
     듣고 맞히기
     ============================================================ */
  const Quiz = {
    hiding: false, ans: -1, done: 0, right: 0,
    start() {
      const st = Store.get("quiz", { done: 0, right: 0 });
      this.done = st.done; this.right = st.right;
      byId("qStart").addEventListener("click", () => this.next());
      byId("qReset").addEventListener("click", () => {
        this.done = 0; this.right = 0; Store.set("quiz", { done: 0, right: 0 }); this.paint();
        byId("qStage").innerHTML = '<p class="quiz-q">[문제 시작]을 누르면 무작위로 한 곡이 재생됩니다.</p>';
      });
      this.paint();
    },
    paint() {
      byId("qDone").textContent = this.done;
      byId("qRight").textContent = this.right;
      byId("qRate").textContent = this.done ? Math.round((this.right / this.done) * 100) + "%" : "–";
    },
    next() {
      this.ans = Math.floor(Math.random() * TRACKS.length);
      const opts = shuffle([this.ans].concat(shuffle(TRACKS.map((t, i) => i).filter((i) => i !== this.ans)).slice(0, 3)));
      this.hiding = true; load(this.ans, true);
      byId("qStage").innerHTML = '<p class="mystery">?</p><p class="quiz-q">지금 나오는 음악은 어느 시대·장르일까요?</p>' +
        '<div class="opts">' + opts.map((i) =>
          '<button class="opt" type="button" data-o="' + i + '">' + esc(TRACKS[i].title) +
          '<span class="sm">' + esc(eraOf(TRACKS[i].era).name + " · " + TRACKS[i].years) + "</span></button>").join("") + "</div>";
      byId("qStage").querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => this.answer(+b.dataset.o, b)));
      byId("qStart").textContent = "다른 문제";
    },
    answer(pick, btn) {
      const ok = pick === this.ans;
      this.done++; if (ok) this.right++;
      Store.set("quiz", { done: this.done, right: this.right });
      this.paint();
      byId("qStage").querySelectorAll(".opt").forEach((b) => {
        b.disabled = true;
        if (+b.dataset.o === this.ans) b.classList.add("right");
      });
      if (!ok) btn.classList.add("wrong");
      const t = TRACKS[this.ans];
      this.hiding = false;
      P.els.title.textContent = t.title;
      P.els.sub.textContent = t.sub + " · " + t.years;
      markStaff();
      const v = document.createElement("div");
      v.className = "verdict " + (ok ? "ok" : "no");
      v.innerHTML = "<b>" + (ok ? "정답입니다" : "정답은 " + esc(t.title) + "입니다") + "</b>" +
        '<span class="cl">' + esc(t.clue) + '</span><br><span class="cl" style="display:block;margin-top:7px">' + esc(t.one) + "</span>";
      byId("qStage").appendChild(v);
      const more = document.createElement("div");
      more.className = "btn-row"; more.style.justifyContent = "center";
      more.innerHTML = '<button class="btn" type="button" id="qMore">다음 문제</button>' +
        '<button class="btn ghost" type="button" id="qGo">이 곡 자세히 보기</button>';
      byId("qStage").appendChild(more);
      byId("qMore").addEventListener("click", () => this.next());
      byId("qGo").addEventListener("click", () => { showDetail(this.ans); goTab("explore"); });
    }
  };

  /* ============================================================
     순서 세우기
     ============================================================ */
  const Order = {
    picks: [], slots: [], pool: [],
    start() {
      byId("oNew").addEventListener("click", () => this.deal());
      byId("oCheck").addEventListener("click", () => this.check());
      this.deal();
    },
    deal() {
      this.picks = shuffle(TRACKS.map((t, i) => i)).slice(0, 6).sort((a, b) => a - b);
      this.slots = new Array(6).fill(null);
      this.pool = shuffle(this.picks);
      byId("oCheck").disabled = true;
      byId("oResult").innerHTML = "";
      this.render();
    },
    render() {
      byId("oPool").innerHTML = this.pool.map((i) =>
        '<button class="pool-item" type="button" data-i="' + i + '"' +
        (this.slots.indexOf(i) > -1 ? " disabled" : "") + ">" + esc(TRACKS[i].title) + "</button>").join("");
      byId("oPool").querySelectorAll(".pool-item").forEach((b) => b.addEventListener("click", () => {
        const e = this.slots.indexOf(null); if (e < 0) return;
        this.slots[e] = +b.dataset.i; this.render();
      }));
      byId("oSlots").innerHTML = this.slots.map((v, k) => {
        const t = v === null ? null : TRACKS[v];
        return '<div class="slot' + (t ? " filled" : "") + '"><span class="idx">' + (k + 1) + "</span>" +
          '<span class="nm' + (t ? "" : " empty") + '">' + (t ? esc(t.title) : "빈 자리") + "</span>" +
          (t ? '<span class="yr">' + esc(t.years) + '</span><button class="x" type="button" data-k="' + k + '" aria-label="빼기">&times;</button>' : "") + "</div>";
      }).join("");
      byId("oSlots").querySelectorAll(".x").forEach((b) =>
        b.addEventListener("click", () => { this.slots[+b.dataset.k] = null; this.render(); }));
      byId("oCheck").disabled = this.slots.indexOf(null) > -1;
    },
    check() {
      let hit = 0;
      const rows = byId("oSlots").querySelectorAll(".slot");
      this.slots.forEach((v, k) => {
        const ok = v === this.picks[k]; if (ok) hit++;
        rows[k].classList.add(ok ? "ok" : "ng");
        if (!ok) { const yr = rows[k].querySelector(".yr"); if (yr) yr.textContent = "정답: " + TRACKS[this.picks[k]].title; }
      });
      byId("oResult").innerHTML = '<div class="verdict ' + (hit === 6 ? "ok" : "no") + '"><b>' + hit +
        " / 6 자리를 맞혔습니다</b><span class='cl'>" + (hit === 6
          ? "시대의 흐름을 정확히 짚었습니다. [다시 뽑기]로 다른 조합에 도전해 보세요."
          : "틀린 자리에 정답을 표시했습니다. [시대 탐구] 탭의 오선을 보면 왼쪽부터 시대 순입니다.") + "</span></div>";
      byId("oCheck").disabled = true;
    }
  };

  /* ============================================================
     기록 → 텍스트
     ============================================================ */
  function trackText(t, r) {
    let s = "[" + p2(t.n) + "] " + t.title + " (" + eraOf(t.era).name + " · " + t.years + ")\n";
    SHEET_AXES.forEach((a) => { s += "  " + a.label + ": " + (r[a.key] || "-") + "\n"; });
    s += "  한 문장: " + (r.free1 || "-") + "\n  근거: " + (r.free2 || "-") + "\n";
    return s;
  }

  function reportText(sid, only) {
    const stu = Roster.of(sid); if (!stu) return null;
    const keys = only ? (stu.tracks[only] ? [only] : []) : TRACKS.map((t) => t.slug).filter((s) => stu.tracks[s]);
    if (!keys.length) return null;
    let out = "진달래꽃 × 서양음악사 — 감상 활동지\n" + CONFIG.schoolName + " " + CONFIG.subject + "\n" +
      "학번 " + stu.sid + " (" + Auth.label(stu.sid) + ")   이름 " + stu.name + "\n작성 " + stamp() + "\n" + "=".repeat(44) + "\n\n";
    keys.forEach((sl) => { out += trackText(TRACKS.find((x) => x.slug === sl), stu.tracks[sl]) + "\n"; });
    return out + "=".repeat(44) + "\n총 " + keys.length + "곡 작성\n";
  }

  function mailTo(subject, body) {
    let to = CONFIG.teacherEmail || Store.get("teacherEmail", "");
    if (!to) {
      to = window.prompt("선생님 이메일 주소를 입력하세요.\n(한 번 입력하면 이 기기에 저장됩니다)", "");
      if (!to) return;
      to = to.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { toast("이메일 주소 형식이 올바르지 않습니다.", "bad"); return; }
      Store.set("teacherEmail", to);
    }
    const url = "mailto:" + encodeURIComponent(to) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    if (url.length > 1900) {
      copyText(body, (ok) => {
        if (ok) {
          toast("내용이 길어 본문을 복사했습니다. 메일 창에 붙여넣기 하세요.");
          window.location.href = "mailto:" + encodeURIComponent(to) + "?subject=" + encodeURIComponent(subject);
        } else toast("내용이 너무 깁니다. [전체 내려받기]로 파일을 만들어 첨부해 주세요.", "bad");
      });
      return;
    }
    window.location.href = url;
  }

  /* ============================================================
     감상 활동지 (학습자용)
     ============================================================ */
  const Sheet = {
    start() {
      byId("sheetPick").innerHTML = TRACKS.map((t, i) =>
        '<option value="' + i + '">' + p2(t.n) + ". " + esc(t.title) + " (" + esc(eraOf(t.era).name) + ")</option>").join("");
      byId("sheetPick").addEventListener("change", () => this.render());
      byId("sheetPlay").addEventListener("click", () => {
        Quiz.hiding = false;
        cursor = +byId("sheetPick").value;
        playTrack(cursor);
      });
      byId("sheetSave").addEventListener("click", () => this.save());
      byId("sheetOneDl").addEventListener("click", () => this.one("dl"));
      byId("sheetOneMail").addEventListener("click", () => this.one("mail"));
      byId("sheetOneXls").addEventListener("click", () => this.one("xls"));
      byId("sheetAllDl").addEventListener("click", () => this.all("txt"));
      byId("sheetAllXls").addEventListener("click", () => this.all("xls"));
      byId("sheetAllMail").addEventListener("click", () => this.all("mail"));
      byId("sheetSubmit").addEventListener("click", () => this.submit());
      byId("sheetPrint").addEventListener("click", () => this.print());
      byId("sheetWipe").addEventListener("click", () => this.wipe());
      if (!Store.persistent) {
        byId("sheetWarn").textContent = "이 브라우저에서는 자동 저장이 막혀 있습니다. 작성 후 반드시 [전체 내려받기]나 [제출 파일 만들기]로 저장하세요.";
        byId("sheetWarn").style.display = "block";
      }
      this.render();
    },

    cur() { return TRACKS[+byId("sheetPick").value]; },
    rec(slug) {
      const s = Auth.me && Auth.me.sid ? Roster.of(Auth.me.sid) : null;
      return s && s.tracks[slug] ? s.tracks[slug] : {};
    },

    render() {
      if (!Auth.me || Auth.me.role !== "student") return;
      const t = this.cur(), saved = this.rec(t.slug);
      byId("sheetBody").innerHTML =
        '<div class="blk" style="margin-bottom:26px"><h4>' + esc(t.title) + " · 무엇을 들을까요</h4><ol>" +
        t.listen.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ol></div>" +
        SHEET_AXES.map((ax) =>
          '<div class="axis"><label>' + ax.label + '</label><div class="axis-opts">' +
          ax.opts.map((o, k) => {
            const id = "ax_" + ax.key + "_" + k;
            return '<input type="radio" name="' + ax.key + '" id="' + id + '" value="' + esc(o) + '"' +
              (saved[ax.key] === o ? " checked" : "") + '><label for="' + id + '">' + esc(o) + "</label>";
          }).join("") + "</div></div>").join("") +
        '<div class="axis"><label>이 곡을 한 문장으로</label><textarea class="free" id="sFree1" maxlength="300" placeholder="예) 반주가 없어서 목소리 하나가 더 크게 들렸다.">' +
        esc(saved.free1 || "") + "</textarea></div>" +
        '<div class="axis"><label>그렇게 느낀 근거 (음악 요소로)</label><textarea class="free" id="sFree2" maxlength="300" placeholder="예) 화음이 없고 박자를 셀 수 없어서 시간이 멈춘 느낌이었다.">' +
        esc(saved.free2 || "") + "</textarea></div>";
      byId("sheetSaved").textContent = saved.at ? "저장됨 · " + saved.at : "아직 저장하지 않았습니다";
      byId("sheetSaved").className = "saved-note" + (saved.at ? " ok" : "");
      this.dots();
    },

    save() {
      if (!Auth.me || !Auth.me.sid) return;
      const t = this.cur(), d = { at: stamp() };
      SHEET_AXES.forEach((a) => {
        const c = $('#sheetBody input[name="' + a.key + '"]:checked');
        if (c) d[a.key] = c.value;
      });
      d.free1 = byId("sFree1").value.trim();
      d.free2 = byId("sFree2").value.trim();
      if (!SHEET_AXES.some((a) => d[a.key]) && !d.free1 && !d.free2) { toast("아직 고르거나 적은 내용이 없습니다.", "bad"); return; }
      Roster.putTrack(Auth.me.sid, t.slug, d);
      byId("sheetSaved").textContent = "저장됨 · " + d.at;
      byId("sheetSaved").className = "saved-note ok";
      this.dots();
      toast(t.title + " 기록을 저장했습니다.");
    },

    dots() {
      const s = Auth.me && Auth.me.sid ? Roster.of(Auth.me.sid) : null;
      byId("sheetDots").innerHTML = TRACKS.map((t) =>
        '<button class="done-dot' + (s && s.tracks[t.slug] ? " done" : "") + '" type="button" data-n="' +
        (t.n - 1) + '" title="' + esc(t.title) + '">' + t.n + "</button>").join("");
      byId("sheetDots").querySelectorAll(".done-dot").forEach((b) =>
        b.addEventListener("click", () => { byId("sheetPick").value = b.dataset.n; this.render(); }));
      byId("sheetCount").textContent = (s ? Object.keys(s.tracks).length : 0) + " / 20곡 작성";
    },

    one(kind) {
      const t = this.cur(), txt = reportText(Auth.me.sid, t.slug);
      if (!txt) { toast("이 곡은 아직 저장하지 않았습니다. 먼저 [저장하기]를 누르세요.", "bad"); return; }
      if (kind === "dl") { saveBlob("활동지_" + Auth.me.sid + "_" + p2(t.n) + t.title + ".txt", txt); toast(t.title + " 기록을 내려받았습니다."); }
      else if (kind === "mail") mailTo("[감상활동지] " + Auth.me.sid + " " + Auth.me.name + " — " + t.title, txt);
      else {
        const r = this.rec(t.slug);
        const rows = [["항목", "내용"], ["학번", Auth.me.sid], ["이름", Auth.me.name],
          ["곡", t.title], ["시대", eraOf(t.era).name], ["연대", t.years]]
          .concat(SHEET_AXES.map((a) => [a.label, r[a.key] || ""]))
          .concat([["한 문장", r.free1 || ""], ["근거", r.free2 || ""], ["작성시각", r.at || ""]]);
        MiniXLSX.download("활동지_" + Auth.me.sid + "_" + p2(t.n) + t.title + ".xlsx",
          [{ name: t.title, rows, widths: [14, 50] }]);
        toast(t.title + " 기록을 엑셀로 내려받았습니다.");
      }
    },

    all(kind) {
      const stu = Roster.of(Auth.me.sid);
      const n = stu ? Object.keys(stu.tracks).length : 0;
      if (!n) { toast("저장된 기록이 없습니다. 먼저 [저장하기]를 누르세요.", "bad"); return; }
      if (kind === "txt") { saveBlob("활동지_" + Auth.me.sid + "_" + Auth.me.name + "_전체.txt", reportText(Auth.me.sid)); toast(n + "곡 기록을 내려받았습니다."); return; }
      if (kind === "mail") { mailTo("[감상활동지] " + Auth.me.sid + " " + Auth.me.name + " — 전체 " + n + "곡", reportText(Auth.me.sid)); return; }
      const head = ["학번", "이름", "번호", "곡", "시대", "연대"].concat(SHEET_AXES.map((a) => a.label)).concat(["한 문장", "근거", "작성시각"]);
      const rows = [head];
      TRACKS.forEach((t) => {
        const r = stu.tracks[t.slug]; if (!r) return;
        rows.push([stu.sid, stu.name, t.n, t.title, eraOf(t.era).name, t.years]
          .concat(SHEET_AXES.map((a) => r[a.key] || "")).concat([r.free1 || "", r.free2 || "", r.at || ""]));
      });
      MiniXLSX.download("활동지_" + Auth.me.sid + "_" + Auth.me.name + ".xlsx",
        [{ name: "내 활동지", rows, widths: [8, 10, 6, 18, 10, 12, 12, 12, 14, 14, 10, 42, 42, 16] }]);
      toast("엑셀로 내려받았습니다.");
    },

    submit() {
      const stu = Roster.of(Auth.me.sid);
      if (!stu || !Object.keys(stu.tracks).length) { toast("저장된 기록이 없습니다.", "bad"); return; }
      saveBlob("제출_" + stu.sid + "_" + stu.name + "_" + fstamp() + ".json",
        JSON.stringify({ app: "jindalrae", ver: 3, exported: stamp(), sid: stu.sid, name: stu.name, tracks: stu.tracks }, null, 1),
        "application/json");
      toast("제출 파일을 만들었습니다. 선생님께 전달하세요.");
    },

    print() {
      const stu = Roster.of(Auth.me.sid);
      if (!stu || !Object.keys(stu.tracks).length) { toast("저장된 기록이 없습니다.", "bad"); return; }
      let h = '<div class="pr-head"><h1>진달래꽃 × 서양음악사 — 감상 활동지</h1><p>' +
        esc(CONFIG.schoolName + " " + CONFIG.subject) + " · 학번 " + esc(stu.sid) + " (" + esc(Auth.label(stu.sid)) +
        ") · 이름 " + esc(stu.name) + " · 출력 " + stamp() + "</p></div>";
      TRACKS.forEach((t) => {
        const r = stu.tracks[t.slug]; if (!r) return;
        h += '<div class="pr-item"><h2>' + p2(t.n) + ". " + esc(t.title) + " <small>" +
          esc(eraOf(t.era).name + " · " + t.years) + "</small></h2><table>" +
          SHEET_AXES.map((a) => "<tr><th>" + a.label + "</th><td>" + esc(r[a.key] || "-") + "</td></tr>").join("") +
          "<tr><th>한 문장</th><td>" + esc(r.free1 || "-") + "</td></tr><tr><th>근거</th><td>" + esc(r.free2 || "-") + "</td></tr></table></div>";
      });
      byId("printArea").innerHTML = h;
      window.print();
    },

    wipe() {
      if (!window.confirm("이 기기에 저장된 내 기록을 모두 지웁니다.\n되돌릴 수 없습니다. 계속할까요?")) return;
      Roster.remove(Auth.me.sid);
      Roster.ensure(Auth.me.sid, Auth.me.name);
      this.render();
      toast("내 기록을 지웠습니다.");
    }
  };

  /* ============================================================
     학생 기록 (수업자용)
     ============================================================ */
  const Records = {
    view: "student",

    start() {
      byId("adView").addEventListener("change", () => { this.view = byId("adView").value; this.paint(); });
      byId("adTrack").innerHTML = TRACKS.map((t) =>
        '<option value="' + t.slug + '">' + p2(t.n) + ". " + esc(t.title) + "</option>").join("");
      byId("adTrack").addEventListener("change", () => this.paint());
      byId("adImport").addEventListener("change", (e) => this.importFiles(e.target.files));
      byId("adXlsAll").addEventListener("click", () => this.xlsAll());
      byId("adXlsTrack").addEventListener("click", () => this.xlsPerTrack());
      byId("adXlsOne").addEventListener("click", () => this.xlsOne());
      byId("adCsv").addEventListener("click", () => this.csv());
      byId("adBackup").addEventListener("click", () => this.backup());
      byId("adWipe").addEventListener("click", () => this.wipe());
      byId("adMailSet").addEventListener("click", () => this.setMail());
      byId("adMail").textContent = CONFIG.teacherEmail || Store.get("teacherEmail", "") || "설정 안 됨";
    },

    render() { this.paint(); },

    paint() {
      const list = Roster.list();
      const done = list.reduce((a, s) => a + Object.keys(s.tracks).length, 0);
      byId("adN").textContent = list.length;
      byId("adDone").textContent = done;
      byId("adAvg").textContent = list.length ? (done / list.length).toFixed(1) : "0";
      byId("adTrackWrap").style.display = this.view === "track" ? "" : "none";

      if (!list.length) {
        byId("adBody").innerHTML = '<p class="empty">아직 모인 기록이 없습니다.<br>' +
          "학생이 <b>같은 기기</b>에서 작성했다면 자동으로 나타납니다. 학생이 <b>자기 기기</b>에서 작성했다면 " +
          "[제출 파일 불러오기]로 학생이 보낸 <b>제출_학번_이름.json</b> 파일들을 한꺼번에 선택하세요.</p>";
        return;
      }
      if (this.view === "student") this.paintStudents(list);
      else if (this.view === "track") this.paintTrack(list);
      else this.paintStat(list);
    },

    paintStudents(list) {
      let h = '<div class="tw"><table class="grid"><thead><tr><th>학번</th><th>학년·반·번</th><th>이름</th><th>작성</th><th>진행</th><th>최종 수정</th><th></th></tr></thead><tbody>';
      list.forEach((s) => {
        const n = Object.keys(s.tracks).length;
        h += '<tr><td class="mono">' + esc(s.sid) + "</td><td>" + esc(Auth.label(s.sid)) + "</td><td><b>" + esc(s.name) + "</b></td>" +
          '<td class="mono">' + n + ' / 20</td><td><span class="bar"><i style="width:' + (n / 20 * 100) + '%"></i></span></td>' +
          '<td class="mono sm">' + esc(s.updated || "-") + '</td><td class="ta-r">' +
          '<button class="btn ghost small" type="button" data-see="' + esc(s.sid) + '">보기</button> ' +
          '<button class="btn ghost small danger" type="button" data-del="' + esc(s.sid) + '">삭제</button></td></tr>';
      });
      h += '</tbody></table></div><div id="adDetail"></div>';
      byId("adBody").innerHTML = h;
      byId("adBody").querySelectorAll("[data-see]").forEach((b) => b.addEventListener("click", () => this.detail(b.dataset.see)));
      byId("adBody").querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
        if (!window.confirm(b.dataset.del + " 학생의 기록을 지웁니다. 계속할까요?")) return;
        Roster.remove(b.dataset.del); this.paint(); toast("삭제했습니다.");
      }));
    },

    detail(sid) {
      const s = Roster.of(sid); if (!s) return;
      let h = '<div class="card" style="margin-top:18px"><h3>' + esc(s.name) + " · " + esc(s.sid) +
        ' <small style="font-weight:400;color:var(--ink-3)">' + esc(Auth.label(s.sid)) + "</small></h3>";
      const ks = TRACKS.filter((t) => s.tracks[t.slug]);
      if (!ks.length) h += '<p class="empty">작성한 기록이 없습니다.</p>';
      ks.forEach((t) => {
        const r = s.tracks[t.slug];
        h += '<div class="ans"><b>' + p2(t.n) + ". " + esc(t.title) + '</b><div class="tags">' +
          SHEET_AXES.map((a) => '<span class="tag">' + a.label + " · " + esc(r[a.key] || "-") + "</span>").join("") +
          '</div><p><span class="lb">한 문장</span> ' + esc(r.free1 || "-") + '</p><p><span class="lb">근거</span> ' + esc(r.free2 || "-") + "</p></div>";
      });
      h += '<div class="btn-row" style="margin-top:16px"><button class="btn ghost small" type="button" id="adOneXls">이 학생만 엑셀</button>' +
        '<button class="btn ghost small" type="button" id="adOneTxt">이 학생만 txt</button></div></div>';
      byId("adDetail").innerHTML = h;

      byId("adOneXls").addEventListener("click", () => {
        const rows = [["학번", "이름", "번호", "곡", "시대"].concat(SHEET_AXES.map((a) => a.label)).concat(["한 문장", "근거", "작성시각"])];
        TRACKS.forEach((t) => {
          const r = s.tracks[t.slug]; if (!r) return;
          rows.push([s.sid, s.name, t.n, t.title, eraOf(t.era).name]
            .concat(SHEET_AXES.map((a) => r[a.key] || "")).concat([r.free1 || "", r.free2 || "", r.at || ""]));
        });
        MiniXLSX.download("활동지_" + s.sid + "_" + s.name + ".xlsx",
          [{ name: s.name, rows, widths: [8, 10, 6, 18, 10, 12, 12, 14, 14, 10, 42, 42, 16] }]);
      });
      byId("adOneTxt").addEventListener("click", () => {
        let o = "감상 활동지 — " + s.sid + " " + s.name + "\n" + "=".repeat(40) + "\n\n";
        TRACKS.forEach((t) => { if (s.tracks[t.slug]) o += trackText(t, s.tracks[t.slug]) + "\n"; });
        saveBlob("활동지_" + s.sid + "_" + s.name + ".txt", o);
      });
    },

    paintTrack(list) {
      const slug = byId("adTrack").value, t = TRACKS.find((x) => x.slug === slug);
      const rows = list.filter((s) => s.tracks[slug]);
      let h = '<p class="cap"><b>' + esc(t.title) + "</b> · " + esc(eraOf(t.era).name) +
        " — 작성 " + rows.length + "명 / 전체 " + list.length + "명</p>";
      if (!rows.length) { byId("adBody").innerHTML = h + '<p class="empty">이 곡을 작성한 학생이 없습니다.</p>'; return; }
      h += '<div class="tw"><table class="grid"><thead><tr><th>학번</th><th>이름</th>' +
        SHEET_AXES.map((a) => "<th>" + a.label + "</th>").join("") + "<th>한 문장</th><th>근거</th></tr></thead><tbody>";
      rows.forEach((s) => {
        const r = s.tracks[slug];
        h += '<tr><td class="mono">' + esc(s.sid) + "</td><td><b>" + esc(s.name) + "</b></td>" +
          SHEET_AXES.map((a) => "<td>" + esc(r[a.key] || "-") + "</td>").join("") +
          '<td class="wide">' + esc(r.free1 || "-") + '</td><td class="wide">' + esc(r.free2 || "-") + "</td></tr>";
      });
      byId("adBody").innerHTML = h + "</tbody></table></div>";
    },

    paintStat(list) {
      let h = '<p class="cap">학생들이 각 항목에서 무엇을 골랐는지 분포입니다. 예상과 다른 곡이 있다면 그 곡을 다시 함께 들어 보세요.</p>';
      TRACKS.forEach((t) => {
        const rows = list.filter((s) => s.tracks[t.slug]); if (!rows.length) return;
        h += '<div class="statblk"><h4>' + p2(t.n) + ". " + esc(t.title) + " <small>" + rows.length + "명</small></h4>";
        SHEET_AXES.forEach((ax) => {
          const c = {};
          rows.forEach((s) => { const v = s.tracks[t.slug][ax.key]; if (v) c[v] = (c[v] || 0) + 1; });
          const ks = Object.keys(c).sort((a, b) => c[b] - c[a]); if (!ks.length) return;
          h += '<div class="statrow"><span class="k">' + ax.label + '</span><span class="v">' +
            ks.map((k) => '<span class="tag">' + esc(k) + " <b>" + c[k] + "</b></span>").join("") + "</span></div>";
        });
        h += "</div>";
      });
      byId("adBody").innerHTML = h;
    },

    importFiles(files) {
      if (!files || !files.length) return;
      let ok = 0, bad = 0, pend = files.length;
      const roster = Roster.all(), self = this;
      Array.prototype.forEach.call(files, (f) => {
        const rd = new FileReader();
        rd.onload = () => {
          try {
            const d = JSON.parse(rd.result);
            if (d.app !== "jindalrae" || !d.sid || !d.tracks) throw 0;
            const cur = roster[d.sid] || { sid: d.sid, name: d.name || "", tracks: {}, updated: "" };
            cur.name = d.name || cur.name;
            Object.keys(d.tracks).forEach((k) => { cur.tracks[k] = d.tracks[k]; });
            cur.updated = d.exported || stamp();
            roster[d.sid] = cur; ok++;
          } catch (e) { bad++; }
          if (--pend === 0) fin();
        };
        rd.onerror = () => { bad++; if (--pend === 0) fin(); };
        rd.readAsText(f);
      });
      function fin() {
        Roster.save(roster);
        byId("adImport").value = "";
        self.paint();
        toast(ok + "명 불러왔습니다." + (bad ? " (" + bad + "개는 형식이 맞지 않아 건너뜀)" : ""), bad && !ok ? "bad" : "");
      }
    },

    xlsAll() {
      const list = Roster.list();
      if (!list.length) { toast("모인 기록이 없습니다.", "bad"); return; }
      const all = [["학번", "학년반번", "이름", "번호", "곡", "시대", "연대"].concat(SHEET_AXES.map((a) => a.label)).concat(["한 문장", "근거", "작성시각"])];
      list.forEach((s) => TRACKS.forEach((t) => {
        const r = s.tracks[t.slug]; if (!r) return;
        all.push([s.sid, Auth.label(s.sid), s.name, t.n, t.title, eraOf(t.era).name, t.years]
          .concat(SHEET_AXES.map((a) => r[a.key] || "")).concat([r.free1 || "", r.free2 || "", r.at || ""]));
      }));
      const sum = [["학번", "학년반번", "이름", "작성 곡 수", "진행률", "최종 수정"]];
      list.forEach((s) => {
        const n = Object.keys(s.tracks).length;
        sum.push([s.sid, Auth.label(s.sid), s.name, n, Math.round(n / 20 * 100) + "%", s.updated || ""]);
      });
      const stat = [["번호", "곡", "항목", "응답", "인원"]];
      TRACKS.forEach((t) => SHEET_AXES.forEach((ax) => {
        const c = {};
        list.forEach((s) => { const r = s.tracks[t.slug]; if (r && r[ax.key]) c[r[ax.key]] = (c[r[ax.key]] || 0) + 1; });
        Object.keys(c).sort((a, b) => c[b] - c[a]).forEach((k) => stat.push([t.n, t.title, ax.label, k, c[k]]));
      }));
      MiniXLSX.download("감상활동지_총괄_" + fstamp() + ".xlsx", [
        { name: "총괄", rows: all, widths: [8, 14, 10, 6, 18, 10, 12, 12, 12, 14, 14, 10, 42, 42, 16] },
        { name: "학생별 요약", rows: sum, widths: [8, 14, 10, 10, 10, 16] },
        { name: "응답 통계", rows: stat, widths: [6, 18, 10, 14, 8] }
      ]);
      toast("총괄 엑셀을 내려받았습니다. (시트 3장)");
    },

    xlsPerTrack() {
      const list = Roster.list();
      if (!list.length) { toast("모인 기록이 없습니다.", "bad"); return; }
      const sheets = [], sum = [["번호", "곡", "시대", "작성 인원"]];
      TRACKS.forEach((t) => {
        const rows = list.filter((s) => s.tracks[t.slug]);
        sum.push([t.n, t.title, eraOf(t.era).name, rows.length]);
        if (!rows.length) return;
        const body = [["학번", "이름"].concat(SHEET_AXES.map((a) => a.label)).concat(["한 문장", "근거", "작성시각"])];
        rows.forEach((s) => {
          const r = s.tracks[t.slug];
          body.push([s.sid, s.name].concat(SHEET_AXES.map((a) => r[a.key] || "")).concat([r.free1 || "", r.free2 || "", r.at || ""]));
        });
        sheets.push({ name: p2(t.n) + " " + t.title, rows: body, widths: [8, 10, 12, 12, 14, 14, 10, 42, 42, 16] });
      });
      if (!sheets.length) { toast("작성된 곡이 없습니다.", "bad"); return; }
      sheets.unshift({ name: "곡별 요약", rows: sum, widths: [6, 20, 12, 10] });
      MiniXLSX.download("감상활동지_곡별_" + fstamp() + ".xlsx", sheets);
      toast("곡별 엑셀을 내려받았습니다. (시트 " + sheets.length + "장)");
    },

    xlsOne() {
      const slug = byId("adTrack").value, t = TRACKS.find((x) => x.slug === slug);
      const rows = Roster.list().filter((s) => s.tracks[slug]);
      if (!rows.length) { toast("이 곡을 작성한 학생이 없습니다.", "bad"); return; }
      const body = [["학번", "학년반번", "이름"].concat(SHEET_AXES.map((a) => a.label)).concat(["한 문장", "근거", "작성시각"])];
      rows.forEach((s) => {
        const r = s.tracks[slug];
        body.push([s.sid, Auth.label(s.sid), s.name].concat(SHEET_AXES.map((a) => r[a.key] || "")).concat([r.free1 || "", r.free2 || "", r.at || ""]));
      });
      MiniXLSX.download("감상활동지_" + p2(t.n) + t.title + ".xlsx",
        [{ name: t.title, rows: body, widths: [8, 14, 10, 12, 12, 14, 14, 10, 42, 42, 16] }]);
      toast(t.title + " 결과를 내려받았습니다.");
    },

    csv() {
      const list = Roster.list();
      if (!list.length) { toast("모인 기록이 없습니다.", "bad"); return; }
      const rows = [["학번", "학년반번", "이름", "번호", "곡", "시대"].concat(SHEET_AXES.map((a) => a.label)).concat(["한 문장", "근거", "작성시각"])];
      list.forEach((s) => TRACKS.forEach((t) => {
        const r = s.tracks[t.slug]; if (!r) return;
        rows.push([s.sid, Auth.label(s.sid), s.name, t.n, t.title, eraOf(t.era).name]
          .concat(SHEET_AXES.map((a) => r[a.key] || "")).concat([r.free1 || "", r.free2 || "", r.at || ""]));
      }));
      saveBlob("감상활동지_총괄_" + fstamp() + ".csv", toCsv(rows), "text/csv");
      toast("CSV로 내려받았습니다.");
    },

    backup() {
      saveBlob("백업_전체_" + fstamp() + ".json",
        JSON.stringify({ app: "jindalrae", ver: 3, kind: "backup", exported: stamp(), roster: Roster.all() }), "application/json");
      toast("백업 파일을 만들었습니다.");
    },

    setMail() {
      const cur = CONFIG.teacherEmail || Store.get("teacherEmail", "");
      const v = window.prompt("학생이 [메일 보내기]를 눌렀을 때 받을 주소를 입력하세요.", cur || "");
      if (v === null) return;
      const t = v.trim();
      if (t && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) { toast("이메일 형식이 올바르지 않습니다.", "bad"); return; }
      Store.set("teacherEmail", t);
      byId("adMail").textContent = t || "설정 안 됨";
      toast(t ? "이 기기에 저장했습니다." : "주소를 지웠습니다.");
    },

    wipe() {
      if (!window.confirm("이 기기에 모인 학생 기록을 전부 지웁니다.\n먼저 [백업]을 받아 두는 것을 권합니다.\n계속할까요?")) return;
      if (!window.confirm("정말 지울까요? 되돌릴 수 없습니다.")) return;
      Store.set("roster", {});
      this.paint();
      toast("전체 기록을 지웠습니다.");
    }
  };

  /* ============================================================
     수업 운영 · 탭
     ============================================================ */
  function buildLesson() {
    byId("lsGoal").innerHTML = LESSON.goal.map((g) => "<li>" + esc(g) + "</li>").join("");
    byId("lsFlow").innerHTML = LESSON.flow.map((f) =>
      '<div class="flow-item"><span class="tm">' + esc(f.t) + '</span><div><b>' + esc(f.name) + "</b><p>" + esc(f.body) + "</p></div></div>").join("");
    byId("lsTips").innerHTML = LESSON.tips.map((t) => "<li>" + esc(t) + "</li>").join("");
    byId("lsAsk").innerHTML = LESSON.ask.map((a) => "<li>" + esc(a) + "</li>").join("");
  }

  function goTab(name) {
    $$(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    $$(".panel").forEach((p) => p.classList.toggle("on", p.id === name));
    const bar = $(".tabbar");
    if (bar && window.scrollY > bar.offsetTop) window.scrollTo({ top: bar.offsetTop - 4 });
  }

  function bindTabs() { $$(".tab").forEach((b) => b.addEventListener("click", () => goTab(b.dataset.tab))); }

  /* ============================================================
     시작
     ============================================================ */
  function init() {
    byId("poem").innerHTML = POEM.map((s) => '<div class="stanza">' + s.join("<br>") + "</div>").join("");
    bindPlayer();
    bindTabs();
    buildStaff();
    showDetail(0);
    Quiz.start();
    Order.start();
    Sheet.start();
    Stage.start();
    Records.start();
    buildLesson();
    byId("heroPlay").addEventListener("click", () => {
      const i = Math.floor(Math.random() * TRACKS.length);
      Quiz.hiding = false;
      showDetail(i); playTrack(i); goTab("explore");
    });
    setPlayIcon(false);
    Auth.start();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
