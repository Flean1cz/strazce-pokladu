/* ═══════════════════════════════════════════════════════
   HRA 2 — ROSTOUCÍ HROMADA (kouzlo úročení)
   3 kola: tutorial závod / hádanka kupce / velká volba
═══════════════════════════════════════════════════════ */
window.renderMinigame_2 = function(idx) {
  // Cleanup případného předchozího běhu
  if (typeof window._minigame_cleanup === 'function') {
    try { window._minigame_cleanup(); } catch(e){}
  }

  var wrap = document.getElementById('minigame-canvas-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  // ════════ STATE SÉRIE ════════
  var TOTAL_LEVELS = 3;
  var currentLevel = 1;
  var levelScores = [0, 0, 0];
  var seriesScore = 0;
  var active = true;
  var animFrame = null;
  var animTimer = null;

  // ════════ BOARD DOM ════════
  var board = document.createElement('div');
  board.className = 'mg2-board';
  wrap.appendChild(board);

  // ════════ HELPER: ZAOKROUHLENÍ ════════
  function mg2_round(n) {
    return Math.round(n);
  }

  // ════════ HELPER: COMPOUND INTEREST ════════
  function mg2_compound(principal, monthlyRate, months) {
    return principal * Math.pow(1 + monthlyRate / 100, months);
  }

  // ════════ HELPER: AMFORA SVG ════════
  function mg2_buildAmphora(uniqueId, fillPercent) {
    fillPercent = Math.max(0, Math.min(100, fillPercent || 0));
    // Náplň: y od 78 (skoro dno) po 42 (skoro plná)
    var fillTopY = 78 - (fillPercent / 100) * 36;

    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 130');
    svg.setAttribute('class', 'mg2-amphora-svg');

    svg.innerHTML =
      '<defs>' +
        '<clipPath id="mg2clip-' + uniqueId + '">' +
          '<ellipse cx="50" cy="80" rx="38" ry="42"/>' +
        '</clipPath>' +
        '<linearGradient id="mg2gold-' + uniqueId + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#FFE066"/>' +
          '<stop offset="100%" stop-color="#C88A14"/>' +
        '</linearGradient>' +
      '</defs>' +
      // Ucha
      '<path d="M 12 50 Q -3 80 12 110" fill="none" stroke="#5C2800" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M 88 50 Q 103 80 88 110" fill="none" stroke="#5C2800" stroke-width="5" stroke-linecap="round"/>' +
      // Tělo
      '<ellipse cx="50" cy="80" rx="38" ry="42" fill="#A85C10" stroke="#3A1200" stroke-width="0.8"/>' +
      // Hrdlo
      '<rect x="38" y="20" width="24" height="14" fill="#A85C10" stroke="#3A1200" stroke-width="0.8"/>' +
      '<ellipse cx="50" cy="20" rx="14" ry="4" fill="#6B3A0E" stroke="#3A1200" stroke-width="0.8"/>' +
      '<ellipse cx="50" cy="17" rx="14" ry="4" fill="#A85C10" stroke="#3A1200" stroke-width="0.8"/>' +
      // Klínopisné dekorace
      '<g fill="#3A1200" opacity="0.55">' +
        '<path d="M 30 60 L 32 60 L 31 62 Z"/>' +
        '<path d="M 36 60 L 38 60 L 37 62 Z"/>' +
        '<path d="M 42 60 L 44 60 L 43 62 Z"/>' +
        '<path d="M 48 60 L 50 60 L 49 62 Z"/>' +
        '<path d="M 54 60 L 56 60 L 55 62 Z"/>' +
        '<path d="M 60 60 L 62 60 L 61 62 Z"/>' +
        '<path d="M 66 60 L 68 60 L 67 62 Z"/>' +
        '<path d="M 33 67 L 35 67 L 34 69 Z"/>' +
        '<path d="M 39 67 L 41 67 L 40 69 Z"/>' +
        '<path d="M 45 67 L 47 67 L 46 69 Z"/>' +
        '<path d="M 51 67 L 53 67 L 52 69 Z"/>' +
        '<path d="M 57 67 L 59 67 L 58 69 Z"/>' +
        '<path d="M 63 67 L 65 67 L 64 69 Z"/>' +
      '</g>' +
      // Náplň (clip-pathed)
      '<g clip-path="url(#mg2clip-' + uniqueId + ')">' +
        '<rect class="mg2-fill-rect" x="12" y="' + fillTopY + '" width="76" height="100" fill="url(#mg2gold-' + uniqueId + ')"/>' +
      '</g>';

    return svg;
  }

  function mg2_setFill(amphoraSvg, fillPercent) {
    if (!amphoraSvg) return;
    fillPercent = Math.max(0, Math.min(100, fillPercent));
    var fillTopY = 78 - (fillPercent / 100) * 36;
    var rect = amphoraSvg.querySelector('.mg2-fill-rect');
    if (rect) rect.setAttribute('y', fillTopY);
  }

  // ════════ HELPER: PADAJÍCÍ MINCE ════════
  function mg2_dropCoin(stageEl, targetXPercent) {
    if (!active || !stageEl) return;
    var coin = document.createElement('div');
    coin.className = 'mg2-falling-coin';
    coin.style.left = (targetXPercent + (Math.random() * 8 - 4)) + '%';
    coin.style.top = '20px';
    stageEl.appendChild(coin);
    setTimeout(function(){
      if (coin.parentNode) coin.parentNode.removeChild(coin);
    }, 700);
  }

  // ════════ HELPER: BUMP ČÍSLA ════════
  function mg2_bumpCount(el) {
    if (!el) return;
    el.classList.add('is-bumped');
    setTimeout(function(){ if(el) el.classList.remove('is-bumped'); }, 250);
  }

  // ════════ HELPER: PROGRESS DOTS ════════
  function mg2_progressHTML(level) {
    var html = '<div class="mg2-progress">';
    for (var i = 1; i <= TOTAL_LEVELS; i++) {
      var cls = 'mg2-progress-dot';
      if (i < level) cls += ' is-done';
      else if (i === level) cls += ' is-active';
      html += '<div class="' + cls + '"></div>';
    }
    html += '</div>';
    return html;
  }

  // ════════ INTRO ════════
  function showIntro() {
    if (!active) return;
    board.innerHTML =
      '<div class="mg0-card">' +
        '<div class="mg0-card-icon">📈</div>' +
        '<div class="mg0-card-title">Rostoucí hromada</div>' +
        '<div class="mg0-card-text">' +
          'Slyšel jsi pověst o kupci, jehož <strong>hromada zlata rostla i ve spánku</strong>?<br><br>' +
          'Ukážu ti <strong>kouzlo úročení</strong> — sílu, která dělá z malého velké, když jí dáš čas.<br><br>' +
          '<em>Hra má 3 kola. V každém poznáš jiné tajemství.</em>' +
        '</div>' +
        '<button class="mg0-btn mg0-btn-primary" id="mg2-start">▶ Začít kolo 1</button>' +
      '</div>';

    var btn = document.getElementById('mg2-start');
    if (btn) btn.addEventListener('click', function(){
      currentLevel = 1;
      startLevel1();
    }, { once: true });
  }

  // ════════ KOLO 1 — ZÁVOD AMFOR (TUTORIÁL) ════════
  function startLevel1() {
    if (!active) return;

    var TOTAL_MONTHS = 12;
    var RATE = 1; // 1 % měsíčně
    var month = 0;
    var leftCount = 100;   // bez úroku
    var rightCount = 100;  // s úrokem
    var locked = false;    // mid-animation lock

    board.innerHTML =
      mg2_progressHTML(1) +
      '<div class="mg2-month-counter" id="mg2-month">MĚSÍC 0 / ' + TOTAL_MONTHS + '</div>' +
      '<div class="mg2-stage" id="mg2-stage">' +
        '<span class="mg2-celestial" id="mg2-celestial">☀</span>' +
        '<div class="mg2-amphora-wrap" id="mg2-wrap-L">' +
          '<div class="mg2-amphora-label">🛏️ Pod polštářem</div>' +
          '<div id="mg2-amph-L"></div>' +
          '<div class="mg2-amphora-count" id="mg2-count-L">100</div>' +
          '<div class="mg2-amphora-delta is-zero">beze změny</div>' +
        '</div>' +
        '<div class="mg2-vs">VS</div>' +
        '<div class="mg2-amphora-wrap" id="mg2-wrap-R">' +
          '<div class="mg2-amphora-label is-temple">🏛️ Chrám růstu</div>' +
          '<div id="mg2-amph-R"></div>' +
          '<div class="mg2-amphora-count" id="mg2-count-R">100</div>' +
          '<div class="mg2-amphora-delta" id="mg2-delta-R">1 % měsíčně</div>' +
        '</div>' +
      '</div>' +
      '<div class="mg2-narrator">Klepni na tlačítko a <strong>pošli další měsíc</strong>. Sleduj, co se stane.</div>' +
      '<div class="mg2-controls">' +
        '<button class="mg2-btn-month" id="mg2-next">▶ POŠLI DALŠÍ MĚSÍC</button>' +
        '<button class="mg2-btn-fast" id="mg2-fast">⏩ Rychle dopředu</button>' +
      '</div>';

    var amphL = mg2_buildAmphora('L1', 50);
    var amphR = mg2_buildAmphora('R1', 50);
    document.getElementById('mg2-amph-L').appendChild(amphL);
    document.getElementById('mg2-amph-R').appendChild(amphR);

    var stageEl = document.getElementById('mg2-stage');
    var monthEl = document.getElementById('mg2-month');
    var countL = document.getElementById('mg2-count-L');
    var countR = document.getElementById('mg2-count-R');
    var deltaR = document.getElementById('mg2-delta-R');
    var celest = document.getElementById('mg2-celestial');
    var btnNext = document.getElementById('mg2-next');
    var btnFast = document.getElementById('mg2-fast');

    function updateCelestial(m) {
      // Den/noc cyklus podle měsíce
      var phase = m % 4;
      celest.textContent = phase < 2 ? '☀' : '☾';
    }

    function tickMonth(animate) {
      if (!active || month >= TOTAL_MONTHS) return;
      month++;
      rightCount = 100 * Math.pow(1 + RATE / 100, month);
      var newFill = 50 + (rightCount - 100) * 0.5; // 100→50%, +12 mincí → +6%

      monthEl.textContent = 'MĚSÍC ' + month + ' / ' + TOTAL_MONTHS;
      countR.textContent = mg2_round(rightCount);
      deltaR.textContent = '+' + mg2_round(rightCount - 100) + ' mincí · 1 % měsíčně';
      mg2_setFill(amphR, newFill);
      updateCelestial(month);

      if (animate) {
        mg2_dropCoin(stageEl, 72);
        mg2_bumpCount(countR);
      }

      if (month >= TOTAL_MONTHS) {
        finishLevel1();
      }
    }

    function finishLevel1() {
      if (!active) return;
      btnNext.disabled = true;
      btnFast.disabled = true;
      levelScores[0] = 30;
      seriesScore = 30;

      setTimeout(function(){
        if (!active) return;
        var diff = mg2_round(rightCount - 100);
        var narr = document.querySelector('.mg2-narrator');
        if (narr) {
          narr.innerHTML = 'Vidíš? Levá amfora <strong>dřímá</strong>. Pravá <strong>roste</strong>, i když se na ni nedíváš. Za rok přibylo <strong>' + diff + ' mincí</strong> — z ničeho.';
        }
        var ctrls = document.querySelector('.mg2-controls');
        if (ctrls) {
          ctrls.innerHTML = '<button class="mg2-btn-month" id="mg2-toL2">▶ Kolo 2 — Hádanka kupce</button>' +
            '<div style="font-size:11px;color:var(--lgold);letter-spacing:1px;">+30 / 30 ✨</div>';
          var b = document.getElementById('mg2-toL2');
          if (b) b.addEventListener('click', function(){
            currentLevel = 2;
            startLevel2();
          }, { once: true });
        }
      }, 800);
    }

    btnNext.addEventListener('click', function(){
      if (locked || !active) return;
      locked = true;
      tickMonth(true);
      setTimeout(function(){ locked = false; }, 350);
    });

    btnFast.addEventListener('click', function(){
      if (!active || month >= TOTAL_MONTHS) return;
      btnFast.disabled = true;
      btnNext.disabled = true;
      animTimer = setInterval(function(){
        if (!active || month >= TOTAL_MONTHS) {
          clearInterval(animTimer);
          animTimer = null;
          return;
        }
        tickMonth(true);
      }, 220);
    });
  }

  // ════════ KOLO 2 — HÁDANKA KUPCE ════════
  function startLevel2() {
    if (!active) return;

    var PRINCIPAL = 100;
    var RATE = 1;
    var YEARS = 5;
    var MONTHS = YEARS * 12;
    var CORRECT = mg2_compound(PRINCIPAL, RATE, MONTHS); // 181.67

    board.innerHTML =
      mg2_progressHTML(2) +
      '<div class="mg2-narrator">' +
        '„Kupec uložil v Chrámu <strong>100 mincí</strong>. Chrám platí <strong>1 % měsíčně</strong>. Kolik bude mít po <strong>5 letech</strong>?"' +
      '</div>' +
      '<div class="mg2-question">Vyber svůj odhad. Pak uvidíš pravdu.</div>' +
      '<div class="mg2-choices" id="mg2-choices">' +
        '<button class="mg2-choice" data-pick="160">' +
          '<span class="mg2-choice-icon">🟦</span>' +
          '<span class="mg2-choice-text">' +
            '<span class="mg2-choice-num">160 mincí</span>' +
            '<span class="mg2-choice-hint">přírůstek 60 % za 5 let</span>' +
          '</span>' +
        '</button>' +
        '<button class="mg2-choice" data-pick="182">' +
          '<span class="mg2-choice-icon">🟩</span>' +
          '<span class="mg2-choice-text">' +
            '<span class="mg2-choice-num">182 mincí</span>' +
            '<span class="mg2-choice-hint">úrok rostoucí z úroku</span>' +
          '</span>' +
        '</button>' +
        '<button class="mg2-choice" data-pick="300">' +
          '<span class="mg2-choice-icon">🟨</span>' +
          '<span class="mg2-choice-text">' +
            '<span class="mg2-choice-num">300 mincí</span>' +
            '<span class="mg2-choice-hint">trojnásobek za 5 let</span>' +
          '</span>' +
        '</button>' +
      '</div>';

    var choices = board.querySelectorAll('.mg2-choice');
    choices.forEach(function(btn){
      btn.addEventListener('click', function(){
        if (!active) return;
        var pick = parseInt(btn.dataset.pick, 10);
        choices.forEach(function(b){ b.classList.add('is-disabled'); b.disabled = true; });
        // Označení správné/špatné
        var pickedClass = (pick === 182) ? 'is-correct' : (pick === 160 ? 'is-near' : 'is-far');
        btn.classList.add(pickedClass);
        // Skóre
        var pts = (pick === 182) ? 30 : (pick === 160 ? 15 : 15);
        levelScores[1] = pts;
        seriesScore = levelScores[0] + levelScores[1];

        setTimeout(function(){ runLevel2Simulation(pick, pts); }, 600);
      }, { once: true });
    });
  }

  function runLevel2Simulation(pick, pts) {
    if (!active) return;
    var PRINCIPAL = 100;
    var RATE = 1;
    var MONTHS = 60;
    var DURATION_MS = 5500;
    var FRAMES = 50;
    var FRAME_MS = DURATION_MS / FRAMES;

    board.innerHTML =
      mg2_progressHTML(2) +
      '<div class="mg2-month-counter" id="mg2-month">MĚSÍC 0 / 60 — 5 let</div>' +
      '<div class="mg2-stage">' +
        '<span class="mg2-celestial">☾</span>' +
        '<div class="mg2-amphora-wrap" style="max-width:240px;">' +
          '<div class="mg2-amphora-label is-temple">🏛️ Chrám růstu</div>' +
          '<div id="mg2-amph-sim"></div>' +
          '<div class="mg2-amphora-count" id="mg2-count-sim">100</div>' +
          '<div class="mg2-amphora-delta" id="mg2-delta-sim">1 % měsíčně</div>' +
        '</div>' +
      '</div>' +
      '<div class="mg2-narrator">Sleduj, jak hromada roste měsíc po měsíci...</div>';

    var amph = mg2_buildAmphora('SIM', 50);
    document.getElementById('mg2-amph-sim').appendChild(amph);
    var stageEl = document.querySelector('.mg2-stage');
    var monthEl = document.getElementById('mg2-month');
    var countEl = document.getElementById('mg2-count-sim');
    var deltaEl = document.getElementById('mg2-delta-sim');

    var frame = 0;
    animTimer = setInterval(function(){
      if (!active) { clearInterval(animTimer); return; }
      frame++;
      var month = Math.floor((frame / FRAMES) * MONTHS);
      var current = mg2_compound(PRINCIPAL, RATE, month);
      monthEl.textContent = 'MĚSÍC ' + month + ' / 60 — ' + (month/12).toFixed(1) + ' roku';
      countEl.textContent = mg2_round(current);
      deltaEl.textContent = '+' + mg2_round(current - 100) + ' mincí';
      var fillPct = 50 + (current - 100) * 0.5;
      mg2_setFill(amph, Math.min(100, fillPct));
      if (frame % 4 === 0) mg2_dropCoin(stageEl, 50);
      if (frame >= FRAMES) {
        clearInterval(animTimer);
        animTimer = null;
        showLevel2Result(pick, pts, mg2_round(current));
      }
    }, FRAME_MS);
  }

  function showLevel2Result(pick, pts, finalCount) {
    if (!active) return;
    var feedback;
    if (pick === 182) {
      feedback = '<strong>Hodný odhad!</strong> Většina lidí by přestřelila nebo podstřelila — ty jsi byl přesně.';
    } else if (pick === 160) {
      feedback = 'Tak to počítá <strong>většina dospělých</strong> — sčítají úrok lineárně. Ale úrok rostl i z úroku — proto je výsledek vyšší než 160.';
    } else {
      feedback = 'Růst má <strong>hranice</strong> — kupec by si přál víc, ale příroda úročení je trpělivá, ne raketová.';
    }

    var narr = document.querySelector('.mg2-narrator');
    if (narr) narr.innerHTML = 'Pravda: <strong>' + finalCount + ' mincí</strong>. ' + feedback;

    setTimeout(function(){
      if (!active) return;
      var stage = document.querySelector('.mg2-stage');
      if (stage) {
        var btnWrap = document.createElement('div');
        btnWrap.className = 'mg2-controls';
        btnWrap.style.marginTop = '8px';
        btnWrap.innerHTML =
          '<button class="mg2-btn-month" id="mg2-toL3">▶ Kolo 3 — Velká volba</button>' +
          '<div style="font-size:11px;color:var(--lgold);letter-spacing:1px;">+' + pts + ' / 30 ✨ &nbsp; · &nbsp; celkem ' + (levelScores[0]+levelScores[1]) + ' / 60</div>';
        board.appendChild(btnWrap);
        var b = document.getElementById('mg2-toL3');
        if (b) b.addEventListener('click', function(){
          currentLevel = 3;
          startLevel3();
        }, { once: true });
      }
    }, 1400);
  }

  // ════════ KOLO 3 — VELKÁ VOLBA ════════
  function startLevel3() {
    if (!active) return;

    board.innerHTML =
      mg2_progressHTML(3) +
      '<div class="mg2-narrator">' +
        '„Stojíš před dvěma cestami, poutníku. <strong>Která hromada bude větší</strong>?"' +
      '</div>' +
      '<div class="mg2-question">Vyber moudře. Uvidíš oba osudy.</div>' +
      '<div class="mg2-paths" id="mg2-paths">' +
        '<button class="mg2-path" data-pick="A">' +
          '<div class="mg2-path-icon">🔥</div>' +
          '<div class="mg2-path-name">Cesta A</div>' +
          '<div class="mg2-path-detail">100 mincí<br><strong>5 % měsíčně</strong><br>1 rok</div>' +
        '</button>' +
        '<button class="mg2-path" data-pick="B">' +
          '<div class="mg2-path-icon">🐢</div>' +
          '<div class="mg2-path-name">Cesta B</div>' +
          '<div class="mg2-path-detail">100 mincí<br><strong>1 % měsíčně</strong><br>5 let</div>' +
        '</button>' +
      '</div>';

    var paths = board.querySelectorAll('.mg2-path');
    paths.forEach(function(btn){
      btn.addEventListener('click', function(){
        if (!active) return;
        var pick = btn.dataset.pick;
        paths.forEach(function(b){ b.classList.add('is-disabled'); b.disabled = true; });
        var pts = (pick === 'B') ? 30 : 15;
        levelScores[2] = pts;
        seriesScore = levelScores[0] + levelScores[1] + levelScores[2];
        setTimeout(function(){ runLevel3Simulation(pick, pts); }, 500);
      }, { once: true });
    });
  }

  function runLevel3Simulation(pick, pts) {
    if (!active) return;
    var DURATION_MS = 6500;
    var FRAMES = 60;
    var FRAME_MS = DURATION_MS / FRAMES;
    var A_FINAL = mg2_compound(100, 5, 12);   // ≈ 179.59
    var B_FINAL = mg2_compound(100, 1, 60);   // ≈ 181.67

    board.innerHTML =
      mg2_progressHTML(3) +
      '<div class="mg2-month-counter" id="mg2-month">PRŮBĚH ZÁVODU</div>' +
      '<div class="mg2-stage mg2-stage-dual">' +
        '<span class="mg2-celestial">☾</span>' +
        '<div class="mg2-amphora-wrap" id="mg2-wrap-A">' +
          '<div class="mg2-amphora-label">🔥 Cesta A · 1 rok</div>' +
          '<div id="mg2-amph-A"></div>' +
          '<div class="mg2-amphora-count" id="mg2-count-A">100</div>' +
          '<div class="mg2-amphora-delta">5 % měsíčně</div>' +
        '</div>' +
        '<div class="mg2-vs">VS</div>' +
        '<div class="mg2-amphora-wrap" id="mg2-wrap-B">' +
          '<div class="mg2-amphora-label is-temple">🐢 Cesta B · 5 let</div>' +
          '<div id="mg2-amph-B"></div>' +
          '<div class="mg2-amphora-count" id="mg2-count-B">100</div>' +
          '<div class="mg2-amphora-delta">1 % měsíčně</div>' +
        '</div>' +
      '</div>' +
      '<div class="mg2-narrator">Sleduj — obě cesty běží zároveň...</div>';

    var amphA = mg2_buildAmphora('A3', 50);
    var amphB = mg2_buildAmphora('B3', 50);
    document.getElementById('mg2-amph-A').appendChild(amphA);
    document.getElementById('mg2-amph-B').appendChild(amphB);
    var stageEl = document.querySelector('.mg2-stage');
    var countA = document.getElementById('mg2-count-A');
    var countB = document.getElementById('mg2-count-B');

    var frame = 0;
    animTimer = setInterval(function(){
      if (!active) { clearInterval(animTimer); return; }
      frame++;
      var t = frame / FRAMES;
      var monthA = t * 12;
      var monthB = t * 60;
      var curA = mg2_compound(100, 5, monthA);
      var curB = mg2_compound(100, 1, monthB);
      countA.textContent = mg2_round(curA);
      countB.textContent = mg2_round(curB);
      mg2_setFill(amphA, Math.min(100, 50 + (curA - 100) * 0.5));
      mg2_setFill(amphB, Math.min(100, 50 + (curB - 100) * 0.5));
      if (frame % 5 === 0) {
        mg2_dropCoin(stageEl, 25);
        mg2_dropCoin(stageEl, 70);
      }
      if (frame >= FRAMES) {
        clearInterval(animTimer);
        animTimer = null;
        // Highlight winner
        var wrapB = document.getElementById('mg2-wrap-B');
        if (wrapB) wrapB.classList.add('is-winner');
        showLevel3Result(pick, pts, mg2_round(A_FINAL), mg2_round(B_FINAL));
      }
    }, FRAME_MS);
  }

  function showLevel3Result(pick, pts, aFinal, bFinal) {
    if (!active) return;
    var narr = document.querySelector('.mg2-narrator');
    if (narr) {
      var msg = 'Cesta A: <strong>' + aFinal + '</strong>, Cesta B: <strong>' + bFinal + '</strong>. ';
      if (pick === 'B') {
        msg += '<strong>Trpělivost porazila i pětinásobný úrok.</strong> To si pamatuj na celý život.';
      } else {
        msg += 'Velký úrok lákal, ale čas zvítězil. Ponaučení stojí za 15 mincí Moudrosti.';
      }
      narr.innerHTML = msg;
    }

    setTimeout(function(){
      if (!active) return;
      showFinish();
    }, 2200);
  }

  // ════════ FINISH KARTA ════════
  function showFinish() {
    if (!active) return;
    seriesScore = levelScores[0] + levelScores[1] + levelScores[2];
    var result = (typeof finishMinigame === 'function')
      ? finishMinigame(idx, seriesScore)
      : { wisdomGiven: 0, isNewBest: false, previousBest: 0 };

    var iconText, titleText, subText;
    if (seriesScore === 90) {
      iconText = '🏆';
      titleText = 'Mistr trpělivosti!';
      subText = 'Hromada tě bude poslouchat celý život. Pochopil jsi tajemství úročení.';
    } else if (seriesScore >= 60) {
      iconText = '⭐';
      titleText = 'Skvěle!';
      subText = 'Cítíš sílu času. S každou hrou poroste i tvá moudrost.';
    } else if (seriesScore >= 30) {
      iconText = '✨';
      titleText = 'Dobrý začátek';
      subText = 'Úročení je zrádné — i dospělí mu nerozumí. Přijď zítra a uvidíš víc.';
    } else {
      iconText = '🌱';
      titleText = 'Zkus to znovu';
      subText = 'Čas dělá z malého velké, když vydržíš. To je celé tajemství.';
    }

    var wisdomLine = '';
    if (result.wisdomGiven > 0) {
      wisdomLine = '<div class="mg0-card-wisdom">+' + result.wisdomGiven + ' Moudrosti ✨</div>';
    } else if (state.minigames && state.minigames.plays && state.minigames.plays[2] > 1) {
      wisdomLine = '<div class="mg0-card-wisdom-note">Dnes už jsi Moudrost získal — zítra zase!</div>';
    }

    board.innerHTML =
      '<div class="mg0-card mg0-card-end">' +
        '<div class="mg0-card-icon">' + iconText + '</div>' +
        '<div class="mg0-card-title">' + titleText + '</div>' +
        '<div class="mg0-score">' + seriesScore + ' / 90 ✨</div>' +
        '<div class="mg0-twotrack">' +
          '<div class="mg0-track">Kolo 1<br><strong>' + levelScores[0] + ' / 30</strong></div>' +
          '<div class="mg0-track">Kolo 2<br><strong>' + levelScores[1] + ' / 30</strong></div>' +
          '<div class="mg0-track">Kolo 3<br><strong>' + levelScores[2] + ' / 30</strong></div>' +
        '</div>' +
        '<div class="mg0-card-text">' + subText + '</div>' +
        wisdomLine +
        '<div class="mg0-buttons">' +
          '<button class="mg0-btn mg0-btn-primary" id="mg2-replay">🔄 Hrát znovu</button>' +
          '<button class="mg0-btn mg0-btn-ghost" id="mg2-back">‹ Zpět</button>' +
        '</div>' +
      '</div>';

    var rb = document.getElementById('mg2-replay');
    var bb = document.getElementById('mg2-back');
    if (rb) rb.addEventListener('click', function(){
      currentLevel = 1;
      levelScores = [0, 0, 0];
      seriesScore = 0;
      showIntro();
    }, { once: true });
    if (bb) bb.addEventListener('click', function(){
      if (typeof showScreen === 'function') showScreen('tajemstvi');
    }, { once: true });

    // Arkádova reakce při perfektním skóre
    if (seriesScore === 90) {
      var name = (state.user && state.user.name) ? state.user.name : 'milý poutníku';
      var arkadText = result.isNewBest && state.minigames.plays[2] === 1
        ? '🎉 Mistře trpělivosti, ' + name + '! Tři kola, tři tajemství úročení — všechna pochopena. Tvá hromada bude v Babylonu legendou.'
        : '✨ Stále to umíš, ' + name + '! Čas a moudrost — tvoji nejlepší přátelé.';
      setTimeout(function(){
        if (typeof openArkadModal === 'function') {
          openArkadModal(arkadText, [{ label: 'Děkuji, Arkáde', response: 'Trpělivý kupec sklízí dvojnásob.' }]);
        }
      }, 1200);
    }
  }

  // ════════ CLEANUP ════════
  window._minigame_cleanup = function() {
    active = false;
    if (animTimer) { clearInterval(animTimer); animTimer = null; }
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    if (board && board.parentNode) {
      try { board.parentNode.removeChild(board); } catch(_){}
    }
  };

  // Start
  showIntro();
};
/* ═══════════════════════════════════════════════════════
   KONEC HRY 2
═══════════════════════════════════════════════════════ */
