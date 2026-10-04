(function(){
  'use strict';

  var firebaseConfig = {
    apiKey: 'AIzaSyDemDlX73nIOp0sqNSzTR-YQ0b4MAUMuLM',
    authDomain: 'travel-settlement-f3949.firebaseapp.com',
    projectId: 'travel-settlement-f3949',
    storageBucket: 'travel-settlement-f3949.firebasestorage.app',
    messagingSenderId: '586979034221',
    appId: '1:586979034221:web:e64a617e26b733f338ab64',
    measurementId: 'G-579R0KKQKH'
  };
  var activeCode = '';
  var content = null;
  var dirty = false;
  var editBaseline = '';
  var editing = false;
  var fns = null;
  var lockHeld = false;
  var lockTimer = null;
  var lockLossHandling = false;
  var authReady = null;
  var main = document.querySelector('main');
  var panelsNav = document.querySelector('.tabs');
  var tripGate = document.getElementById('tripGate');
  var tripApp = document.getElementById('tripApp');
  var statusEl = document.getElementById('tripGateStatus');

  function call(name, data){ return fns.httpsCallable(name)(data).then(function(result){ return result.data; }); }
  function getTrip(code){ return call('getTrip', {code:normalizeCode(code)}); }
  function saveTrip(code, data){ return call('saveTrip', {code:normalizeCode(code), content:data.content}); }
  function localKey(code){ return 'travelTrip_' + code; }
  function draftKey(code){ return localKey(code) + '_draft'; }
  function normalizeCode(value){ return String(value || '').trim().toUpperCase(); }
  function escapeHtml(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }
  function safeLink(value){
    try{
      var url=new URL(String(value || ''),location.href);
      return url.protocol==='http:' || url.protocol==='https:' ? url.href : '#';
    }catch(e){return '#';}
  }
  function safeContent(raw){
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      schemaVersion: 1,
      title: String(raw.title || '~를 입력해주세요'),
      destination: String(raw.destination || '~를 입력해주세요'),
      startDate: String(raw.startDate || ''),
      endDate: String(raw.endDate || ''),
      preTrip: Object.assign({title:'여행 전 · 기본 정보', checklist:[], note:''}, raw.preTrip || {}),
      days: Array.isArray(raw.days) ? raw.days.map(function(day){return Object.assign({items:[],note:''},day,{items:Array.isArray(day.items)?day.items:[],links:Array.isArray(day.links)?day.links:[]});}) : [],
      reservations: (function(){
        var source=Object.assign({tickets:[],hotels:[],transport:[]},raw.reservations || {});
        ['tickets','hotels','transport'].forEach(function(key){
          source[key]=Array.isArray(source[key])?source[key].map(function(item){
            return Object.assign({id:'res-'+Math.random().toString(36).slice(2),title:'~를 입력해주세요',note:'',images:[]},item,{images:Array.isArray(item.images)?item.images:[]});
          }):[];
        });
        return source;
      })(),
      links: Array.isArray(raw.links) ? raw.links : []
    };
  }
  function cacheTrip(code, data){
    try{ localStorage.setItem(localKey(code), JSON.stringify({content:data, savedAt:Date.now()})); }catch(e){}
  }
  function readCache(code){
    try{
      var raw = localStorage.getItem(localKey(code));
      return raw ? JSON.parse(raw).content : null;
    }catch(e){ return null; }
  }
  function rememberRecentTrip(code, data){
    try{
      localStorage.setItem('recentTrip', JSON.stringify({
        id:'trip-'+code, title:data.title || data.destination || code, destination:data.destination || '',
        startDate:data.startDate || '', endDate:data.endDate || '', tripCode:code, lastViewedAt:new Date().toISOString()
      }));
    }catch(e){}
  }
  function recentTrips(){
    var trips=[], seen={};
    try{
      for(var i=0;i<localStorage.length;i++){
        var key=localStorage.key(i)||'', match=key.match(/^travelTrip_([A-Z0-9]{6})$/);
        if(!match) continue;
        var saved=JSON.parse(localStorage.getItem(key));
        if(!saved || !saved.content) continue;
        trips.push({code:match[1],content:saved.content,savedAt:Number(saved.savedAt)||0}); seen[match[1]]=true;
      }
      var recent=JSON.parse(localStorage.getItem('recentTrip')||'null');
      if(recent && /^[A-Z0-9]{6}$/.test(recent.tripCode||'') && !seen[recent.tripCode]) trips.push({code:recent.tripCode,content:recent,savedAt:Date.parse(recent.lastViewedAt)||0});
    }catch(e){}
    return trips.sort(function(a,b){return b.savedAt-a.savedAt;});
  }
  function recentLabel(code){
    var found = recentTrips().filter(function(trip){return trip.code === code;})[0];
    var name = found && (found.content.title || found.content.destination);
    return name ? "[" + name + "]" : code;
  }
  function renderRecentTrips(){
    var trips=recentTrips(), latest=trips[0], resume=document.getElementById('resumeTrip');
    var title=document.getElementById('recentTripTitle'), dates=document.getElementById('recentTripDates');
    if(resume) resume.dataset.code=latest ? latest.code : '';
    if(title) title.textContent=latest ? (latest.content.title || latest.content.destination || latest.code) : '아직 최근 여행이 없어요';
    if(dates) dates.textContent=latest ? (formatDate(latest.content.startDate)+' — '+formatDate(latest.content.endDate)) : '여행코드로 조회하거나 새 여행을 만들어보세요.';
    var count=document.getElementById('recentTripCount'), list=document.getElementById('recentTripList');
    if(count) count.textContent=trips.length+'개';
    if(list) list.innerHTML=trips.length ? trips.map(function(trip){return '<div class="recent-trip-item"><button type="button" class="recent-trip-open" data-recent-code="'+trip.code+'"><b>'+escapeHtml(trip.content.title || trip.content.destination || trip.code)+'</b><span>'+escapeHtml(formatDate(trip.content.startDate)+' — '+formatDate(trip.content.endDate))+'</span></button><button type="button" class="recent-trip-delete" data-delete-recent="'+trip.code+'" aria-label="'+escapeHtml(trip.code)+' 삭제">×</button></div>';}).join('') : '<p class="recent-trip-empty">최근 조회한 여행이 없어요.</p>';
  }
  function saveDraft(code, data){
    try{localStorage.setItem(draftKey(code),JSON.stringify(data));return true;}
    catch(error){console.error('Failed to save local trip draft',error);return false;}
  }
  function readDraft(code){ try{var raw=localStorage.getItem(draftKey(code));return raw?JSON.parse(raw):null;}catch(e){return null;} }
  function clearDraft(code){ try{localStorage.removeItem(draftKey(code));}catch(e){} }
  function setGateStatus(message, isError){ if(statusEl){ statusEl.textContent = message || ''; statusEl.classList.toggle('error', !!isError); } }
  function showGateForm(id){
    document.getElementById('tripGateHome').hidden = id !== '';
    document.getElementById('joinTripForm').hidden = id !== 'joinTripForm';
    document.getElementById('createTripForm').hidden = id !== 'createTripForm';
    renderRecentTrips();
    setGateStatus('');
  }
  function editorSession(){
    if(!activeCode) return Promise.resolve(false);
    if(!authReady) authReady = new Promise(function(resolve){ var off = firebase.auth().onAuthStateChanged(function(){ off(); resolve(); }); });
    return authReady.then(function(){
      var user = firebase.auth().currentUser;
      return user ? user.getIdTokenResult().then(function(token){ return token.claims.tripCode === activeCode && token.claims.tripEditor === true; }) : false;
    }).catch(function(){ return false; }).then(function(ok){
      try{ if(ok) localStorage.setItem('trip_editor_ok_'+activeCode,'1'); else localStorage.removeItem('trip_editor_ok_'+activeCode); }catch(e){}
      return ok;
    });
  }
  function formatDate(date){
    if(!date) return '';
    var parts = String(date).split('-');
    return parts.length === 3 ? parts[0] + '.' + parts[1] + '.' + parts[2] : date;
  }
  function tabDate(day,index){
    var normalizeDate = function(value){
      var match = String(value || '').match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
      if(!match) return '';
      var date = new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])));
      if(date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2])-1 || date.getUTCDate() !== Number(match[3])) return '';
      return date.toISOString().slice(0,10);
    };
    var existingDate = normalizeDate(day.date);
    if(existingDate) return existingDate;
    var startDate = normalizeDate(content.startDate);
    if(!startDate) return '';
    var date = new Date(startDate + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0,10);
  }
  function tabLabel(day,index){
    var label = String(day.tabLabel || '').trim();
    if(label) return label;
    var date = tabDate(day,index);
    return date ? date.slice(5).replace('-', '/') : '';
  }
  function makeNav(){
    var current = panelsNav.querySelector('[aria-selected="true"]');
    var keepId = current ? current.getAttribute('aria-controls') : '';
    if(!/^trip-panel-(pre|\d+)$/.test(keepId) || (keepId !== 'trip-panel-pre' && Number(keepId.slice(11)) >= content.days.length)) keepId = 'trip-panel-pre';
    var buttons = ['<button role="tab" aria-selected="' + (keepId === 'trip-panel-pre') + '" aria-controls="trip-panel-pre" data-panel="trip-panel-pre"><b>여행 전</b>기본 정보</button>'];
    content.days.forEach(function(day, i){
      var customLabel = String(day.tabLabel || '').trim();
      var labelClass = customLabel ? '' : ' class="tab-date-label"';
      buttons.push('<button role="tab" aria-selected="' + (keepId === 'trip-panel-' + i) + '" aria-controls="trip-panel-' + i + '" data-panel="trip-panel-' + i + '"><b>' + (i + 1) + '일차</b><span' + labelClass + '>' + escapeHtml(tabLabel(day,i)) + '</span></button>');
    });
    panelsNav.innerHTML = buttons.join('');
  }
  function checksKey(){ return 'travelChecks_' + activeCode; }
  function readChecks(){ try{ return JSON.parse(localStorage.getItem(checksKey()) || '{}') || {}; }catch(e){ return {}; } }
  function writeChecks(checks){ try{ localStorage.setItem(checksKey(), JSON.stringify(checks)); }catch(e){} }
  function checklistMarkup(items){
    if(!items.length) return '<tr><td class="empty-hint">체크리스트가 비어 있어요.</td></tr>';
    return items.map(function(item, i){
      return '<tr class="checklist-row" data-row="checklist" data-index="' + i + '" data-editable-row><td><div class="checklist-content"><input class="display-check" type="checkbox" tabindex="-1"' + (readChecks()[item.text] ? ' checked' : '') + '><span class="checklist-text">' + escapeHtml(item.text || '~를 입력해주세요') + '</span></div></td></tr>';
    }).join('');
  }
  function reservationMarkup(category, label, icon){
    var list = content.reservations[category] || [];
    return '<div class="wrap ticket-card" data-reservation="' + category + '" data-index="0"><div style="font-size:20px; margin-bottom:4px;">' + icon + '</div><div style="font-weight:600; font-size:13px; color:var(--ink);">' + escapeHtml(label) + '</div></div>';
  }
  function linksOf(scope){ return scope === 'pre' ? content.links : content.days[Number(scope)].links; }
  function linkMarkup(links, scope){
    var list = links.map(function(link, i){
      var label = escapeHtml(link.title || '~를 입력해주세요');
      if(editing) return '<div class="wrap quick-link link-edit-row"><button type="button" class="legacy-link-edit" data-link-scope="' + scope + '" data-link-index="' + i + '"><span><span class="label">REFERENCE LINK</span><span class="title">' + label + '</span></span><span class="go">수정</span></button><button type="button" class="link-delete" data-link-scope="' + scope + '" data-link-delete="' + i + '">삭제</button></div>';
      return '<div class="wrap quick-link"><a href="' + escapeHtml(safeLink(link.url)) + '" target="_blank" rel="noopener noreferrer"><span><span class="label">REFERENCE LINK</span><span class="title">' + label + '</span></span><span class="go">↗</span></a></div>';
    }).join('');
    return list + (editing ? '<button type="button" class="btn add-row legacy-add-row link-add-btn" data-add-link="' + scope + '">+ 링크 추가</button>' : '');
  }
  function updateHeader(){
    var tripDays = content.days.length || 1;
    document.getElementById('tripTitle').textContent = content.title || content.destination;
    document.getElementById('tripDates').textContent = content.startDate ? formatDate(content.startDate) + ' ~ ' + formatDate(content.endDate) : '';
    document.title = (content.title || '여행 일정') + ' | 여행 일정';
  }
  function editTripInfo(){
    var slash = function(date){ return String(date || '').replace(/-/g,'/'); };
    openEditor('여행 정보 수정',[{name:'title',label:'여행명',value:content.title},{name:'start',label:'시작일 (YYYY/MM/DD)',value:slash(content.startDate),mask:'date',placeholder:'YYYY/MM/DD'},{name:'end',label:'종료일 (YYYY/MM/DD)',value:slash(content.endDate),mask:'date',placeholder:'YYYY/MM/DD'}],function(values){
      var start = normalizeInputDate(values.start), end = normalizeInputDate(values.end);
      var count = Math.floor((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000)+1;
      if(!values.title || !start || !end || !(count >= 1 && count <= 31)){ toast('여행명과 날짜(1~31일)를 확인해 주세요.'); return false; }
      content.title = values.title; content.destination = values.title; content.startDate = start; content.endDate = end;
      var first = new Date(start+'T12:00:00Z'), days = [];
      for(var i=0;i<count;i++){
        var date = new Date(first); date.setUTCDate(date.getUTCDate()+i);
        var day = content.days[i] || {id:'day-'+(i+1),title:(i+1)+'일차 일정',items:[],note:''};
        day.order = i+1; day.date = date.toISOString().slice(0,10); days.push(day);
      }
      content.days = days;
      setDirty(); renderPanels(); showPanel(activePanelId());
    });
  }
  function renderPanels(){
    updateHeader();
    makeNav();
    var pre = '<section class="panel trip-panel" id="trip-panel-pre" role="tabpanel"><h2>예약 정보</h2><div class="legacy-reservation-grid">' + reservationMarkup('tickets','티켓','🎫') + reservationMarkup('hotels','호텔','🏨') + reservationMarkup('transport','교통','🚕') + '</div><h2 style="margin-top:20px;">체크 리스트</h2><div class="wrap"><table><tr><th>준비할 것</th></tr>' + checklistMarkup(content.preTrip.checklist || []) + (editing ? '<tr><td class="add-td"><button type="button" class="legacy-add-row" data-add-checklist>+ 체크 항목 추가</button></td></tr>' : '') + '</table></div>' + linkMarkup(content.links, 'pre') + (content.preTrip.note ? '<p class="note trip-note' + (editing ? ' note-empty' : '') + '" data-note="pre">' + escapeHtml(content.preTrip.note) + '</p>' : (editing ? '<p class="note trip-note note-empty is-empty" data-note="pre">여행 안내 메모를 입력하세요.</p>' : '')) + '</section>';
    var days = content.days.map(function(day, dayIndex){
      var rows = (day.items || []).map(function(item, i){ return {item:item, i:i}; }).sort(function(a,b){ return timeMinutes(a.item.time) - timeMinutes(b.item.time) || a.i - b.i; }).map(function(entry){
        var item = entry.item, i = entry.i, undecided = timeMinutes(item.time) === Infinity;
        return '<tr class="' + (undecided ? 'row-undecided' : '') + '" data-row="schedule" data-day="' + dayIndex + '" data-index="' + i + '" data-editable-row><td class="t">' + escapeHtml(item.time || '미정') + '</td><td>' + escapeHtml(item.text || '~를 입력해주세요') + '</td><td class="c">' + escapeHtml(item.cost || '-') + '</td></tr>';
      }).join('');
      if(!rows) rows = '<tr><td colspan="3" class="empty-hint">일정이 비어 있어요. 편집 모드에서 추가할 수 있습니다.</td></tr>';
      return '<section class="panel trip-panel" id="trip-panel-' + dayIndex + '" role="tabpanel" hidden><h2 class="day-title" data-day-title="' + dayIndex + '">' + escapeHtml(day.title || '~를 입력해주세요') + '</h2><div class="wrap"><table><tr><th>시간</th><th>일정</th><th class="c">비고</th></tr>' + rows + (editing ? '<tr><td colspan="3" class="add-td"><button type="button" class="legacy-add-row" data-add-schedule="' + dayIndex + '">+ 일정 추가</button></td></tr>' : '') + '</table></div>' + linkMarkup(day.links || [], dayIndex) + '<p class="note day-note' + (editing ? ' trip-note note-empty' + (day.note ? '' : ' is-empty') : '') + '" data-day-note="' + dayIndex + '">' + escapeHtml(day.note || (editing ? '일정 메모를 입력하세요.' : '')) + '</p></section>';
    }).join('');
    main.innerHTML = pre + days;
  }
  function activateTrip(code, raw, fromCache){
    activeCode = normalizeCode(code);
    content = safeContent(raw);
    dirty = false;
    cacheTrip(activeCode, content);
    rememberRecentTrip(activeCode, content);
    try{ localStorage.setItem('lastTravelCode', activeCode); }catch(e){}
    updateHeader();
    tripGate.hidden = true;
    tripApp.hidden = false;
    makeNav();
    renderPanels();
    if(window.setSettlementTripCode) window.setSettlementTripCode(activeCode);
    updateLoginButton();
    showPanel('trip-panel-pre');
    editorSession().then(function(ok){
      if(!ok){try{localStorage.removeItem('trip_editor_ok_'+activeCode);}catch(e){}}
      window.dispatchEvent(new CustomEvent('trip:activate',{detail:{code:activeCode}}));
    });
  }
  function showPanel(id){
    var tabs = panelsNav.querySelectorAll('[role="tab"]');
    tabs.forEach(function(tab){
      var selected = tab.getAttribute('aria-controls') === id;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      var panel = document.getElementById(tab.getAttribute('aria-controls'));
      if(panel) panel.hidden = !selected;
    });
  }
  function activePanelId(){
    var tab = panelsNav.querySelector('[aria-selected="true"]');
    return tab ? tab.getAttribute('aria-controls') : 'trip-panel-pre';
  }
  function switchPanel(nextId){
    if(editing && dirty){
      askConfirm(
        '저장하지 않은 변경이 있어요',
        '저장하지 않은 내용은 사라지고 편집 모드가 종료돼요. 이 탭으로 이동할까요?',
        function(){ cancelEditing().then(function(){ showPanel(nextId); }); },
        '탭 이동',
        true,
        '계속 편집'
      );
      return;
    }else if(editing){ cancelEditing(); }
    showPanel(nextId);
  }
  function setDirty(){ dirty = true; saveDraft(activeCode,content); }
  function showEditControls(on){
    var loggedIn = false;
    try{ loggedIn = localStorage.getItem('trip_editor_ok_' + activeCode) === '1'; }catch(e){}
    document.getElementById('tripEditBtn').hidden = on || !loggedIn;
    document.getElementById('tripEditSaveBtn').hidden = !on;
    document.getElementById('tripEditCancelBtn').hidden = !on;
    document.body.classList.toggle('trip-editing', on);
  }
  function startLock(){
    return call('acquireTripEditLock', {code:activeCode}).then(function(){
      lockHeld = true;
      clearInterval(lockTimer);
      lockTimer = setInterval(function(){
        call('renewTripEditLock', {code:activeCode}).catch(function(error){ handleEditLockLoss(error); });
      }, 30000);
      beginEditing();
    });
  }
  function beginEditing(){
    var savedDraft = readDraft(activeCode);
    editBaseline = JSON.stringify(content);
    if(savedDraft){
      content = safeContent(savedDraft); dirty = true;
    }
    editing = true; showEditControls(true); renderPanels(); showPanel(activePanelId());
    if(savedDraft) showNotice('임시 저장된 내용을 불러왔어요','이 기기에 저장해 둔 변경 내용을 이어서 편집할 수 있어요.','✓');
  }
  function finishEditingWithDraftNotice(title,message,contentSaved){
    clearInterval(lockTimer); lockTimer = null;
    editing = false; dirty = false; lockHeld = false; showEditControls(false);
    renderPanels(); showPanel(activePanelId());
    showNotice(title,message,contentSaved ? '✓' : '!');
  }
  function handleEditLockLoss(error){
    if(!editing || lockLossHandling) return;
    lockLossHandling = true;
    var code = activeCode;
    var hadChanges = dirty;
    var contentSaved = !hadChanges || saveDraft(code,content);
    var expired = !!error && (error.code === 'functions/aborted' || /편집 (?:시간|권한)이 만료/.test(error.message || ''));
    releaseLock().then(function(){
      finishEditingWithDraftNotice(
        expired ? '편집 권한이 만료됐어요' : '편집 권한을 확인할 수 없어요',
        !hadChanges
          ? '편집 권한이 끝났어요.\n계속 편집하려면 편집 버튼을 눌러 주세요.'
          : contentSaved
            ? '변경 내용은 이 기기에 임시 저장했어요.\n편집 버튼을 누르면 이어서 불러올 수 있어요.'
            : '변경 내용을 이 기기에 저장하지 못했어요.\n화면을 닫지 말고 내용을 확인해 주세요.'
              + (error && error.message ? '\n' + error.message : ''),
        contentSaved
      );
      lockLossHandling = false;
    });
  }
  function releaseLock(){
    clearInterval(lockTimer); lockTimer = null;
    var held = lockHeld; lockHeld = false;
    if(!held || !navigator.onLine) return Promise.resolve();
    return call('releaseTripEditLock', {code:activeCode}).catch(function(){});
  }
  function cancelEditing(){
    showLoading('편집을 취소하고 있어요...');
    var code = activeCode;
    var original = editBaseline ? JSON.parse(editBaseline) : content;
    var cleanup = cleanupAddedStorageFiles(original,content);
    editing = false; dirty = false; showEditControls(false); clearDraft(code);
    content = safeContent(original);
    return cleanup.then(releaseLock).then(function(){return navigator.onLine ? getTrip(code) : Promise.reject(new Error('offline'));}).then(function(result){
      content = safeContent(result.content); cacheTrip(activeCode, content); renderPanels(); showPanel(activePanelId());
      hideLoading();
    }).catch(function(){ renderPanels(); showPanel(activePanelId()); hideLoading(); });
  }
  function saveEditing(){
    showLoading('변경 내용을 저장하고 있어요...');
    if(!editing || !navigator.onLine){
      hideLoading();
      var offlineSaved = !content || !activeCode || saveDraft(activeCode,content);
      showNotice(
        '온라인 저장을 할 수 없어요',
        offlineSaved
          ? '변경 내용은 이 기기에 임시 저장했어요.\n온라인 상태에서 편집 버튼을 눌러 이어서 불러올 수 있어요.'
          : '변경 내용을 이 기기에 저장하지 못했어요.\n화면을 닫지 말고 내용을 확인해 주세요.',
        offlineSaved ? '✓' : '!'
      );
      return;
    }
    var oldContent = editBaseline ? JSON.parse(editBaseline) : {};
    saveTrip(activeCode, {content:content}).then(function(){
      return cleanupRemovedStorageFiles(oldContent,content);
    }).then(function(){
      dirty = false; cacheTrip(activeCode, content); clearDraft(activeCode); editing = false; showEditControls(false);
      return releaseLock();
    }).then(function(){ renderPanels(); showPanel(activePanelId()); hideLoading(); toast('저장했습니다.'); })
      .catch(function(error){
        hideLoading();
        cacheTrip(activeCode, content);
        var contentSaved = saveDraft(activeCode,content);
        var lockExpired = error && (error.code === 'functions/aborted' || /편집 (?:시간|권한)이 만료/.test(error.message || ''));
        if(lockExpired){
          handleEditLockLoss(error);
          return;
        }
        showNotice(
          '저장하지 못했어요',
          contentSaved
            ? '변경 내용은 이 기기에 임시 저장했어요.\n잠시 후 다시 저장해 주세요.'
            : '변경 내용을 이 기기에 저장하지 못했어요.\n화면을 닫지 말고 내용을 확인해 주세요.\n' + (error.message || ''),
          contentSaved ? '✓' : '!'
        );
      });
  }
  function toast(text){
    var el = document.getElementById('tripToast');
    if(!el){ el = document.createElement('div'); el.id = 'tripToast'; el.className = 'edit-toast'; el.setAttribute('role','status'); document.body.appendChild(el); }
    el.textContent = text; el.classList.add('active');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function(){ el.classList.remove('active'); }, 1800);
  }
  function showLoading(text){
    var el = document.getElementById('tripLoading');
    if(!el){ el = document.createElement('div'); el.id = 'tripLoading'; el.className = 'trip-loading'; el.innerHTML = '<div class="trip-loading-box"><div class="trip-spinner"></div><p></p></div>'; document.body.appendChild(el); }
    el.querySelector('p').textContent = text; el.classList.add('active');
  }
  function hideLoading(){ var el = document.getElementById('tripLoading'); if(el) el.classList.remove('active'); }
  function imagePaths(tripContent){
    var paths=[];
    if(!tripContent || !tripContent.reservations) return paths;
    ['tickets','hotels','transport'].forEach(function(category){
      (tripContent.reservations[category] || []).forEach(function(item){
        (item.images || []).forEach(function(image){if(image.path)paths.push(image.path);});
      });
    });
    return paths;
  }
  function cleanupAddedStorageFiles(before,after){
    var oldPaths=imagePaths(before);
    return Promise.all(imagePaths(after).filter(function(path){return oldPaths.indexOf(path)<0;}).map(function(path){return firebase.storage().ref(path).delete().catch(function(){});}));
  }
  function cleanupRemovedStorageFiles(before,after){
    var newPaths=imagePaths(after);
    return Promise.all(imagePaths(before).filter(function(path){return newPaths.indexOf(path)<0;}).map(function(path){return firebase.storage().ref(path).delete().catch(function(){});}));
  }
  function maskValue(kind, value){
    var d = String(value).replace(/\D/g,'');
    if(kind === 'time'){ d = d.slice(0,4); return d.length > 2 ? d.slice(0,2)+':'+d.slice(2) : d; }
    d = d.slice(0,8);
    return d.length > 6 ? d.slice(0,4)+'/'+d.slice(4,6)+'/'+d.slice(6) : d.length > 4 ? d.slice(0,4)+'/'+d.slice(4) : d;
  }
  function validTime(value){ return /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
  function timeMinutes(value){
    var match = String(value || '').match(/^\s*(\d{1,2}):(\d{2})/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : Infinity;
  }
  function openEditor(title, fields, onSave){
    var modal=document.getElementById('tripEditorModal'), form=document.getElementById('tripEditorForm');
    document.getElementById('tripEditorTitle').textContent=title;
    form.innerHTML=fields.map(function(field){var control=field.multiline?'<textarea name="'+field.name+'">'+escapeHtml(field.value||'')+'</textarea>':'<input name="'+field.name+'" type="'+(field.type||'text')+'" value="'+escapeHtml(field.value||'')+'"'+(field.placeholder?' placeholder="'+escapeHtml(field.placeholder)+'"':'')+'>';return '<label>'+escapeHtml(field.label)+control+(field.hint?'<small class="editor-form-hint">'+escapeHtml(field.hint)+'</small>':'')+'</label>';}).join('')+'<div class="editor-form-actions"><button class="btn" type="button" data-editor-cancel>취소</button><button class="btn primary" type="submit">확인</button></div>';
    form.onsubmit=function(event){event.preventDefault();var values={};fields.forEach(function(field){values[field.name]=String(form.elements[field.name].value||'').trim();});if(onSave(values)!==false)modal.classList.remove('active');};
    fields.forEach(function(field){
      if(!field.mask) return;
      var input=form.elements[field.name];
      input.setAttribute('inputmode','numeric'); input.maxLength=field.mask==='date'?10:5; input.placeholder=field.placeholder||'';
      input.addEventListener('input',function(){input.value=maskValue(field.mask,input.value);});
    });
    form.querySelector('[data-editor-cancel]').onclick=function(){modal.classList.remove('active');};
    modal.classList.add('active');setTimeout(function(){var first=form.querySelector('input,textarea');if(first)first.focus();},0);
  }
  function askConfirm(title,message,onAccept,acceptLabel,info,cancelLabel){
    var modal=document.getElementById('tripConfirmModal');document.getElementById('tripConfirmTitle').textContent=title;document.getElementById('tripConfirmMessage').textContent=message;
    modal.classList.toggle('confirm-info',!!info); modal.querySelector('.confirm-icon').textContent=info?'?':'!';
    document.getElementById('tripConfirmAccept').textContent=acceptLabel||'삭제';
    document.getElementById('tripConfirmCancel').textContent=cancelLabel||'취소';
    document.getElementById('tripConfirmCancel').hidden=false;
    document.getElementById('tripConfirmCancel').onclick=function(){modal.classList.remove('active');};
    document.getElementById('tripConfirmAccept').onclick=function(){modal.classList.remove('active');onAccept();};modal.classList.add('active');
  }
  window.askConfirm = askConfirm;
  function showNotice(title,message,icon){
    askConfirm(title,message,function(){},'확인',true);
    if(icon) document.querySelector('#tripConfirmModal .confirm-icon').textContent=icon;
    document.getElementById('tripConfirmCancel').hidden=true;
  }
  function isEditLockBusy(error){
    return !!error && (error.code === 'functions/aborted' || /다른 사람이 편집 중/.test(error.message || ''));
  }
  var swipeStart = null;
  var skipRowClick = false;
  function finishRowSwipe(clientX, clientY){
    if(!swipeStart) return;
    var dx = clientX - swipeStart.x;
    var dy = Math.abs(clientY - swipeStart.y);
    var row = swipeStart.row; swipeStart = null;
    row.style.transform='';row.classList.remove('swipe-armed');
    if(!editing || dx > -75 || dy > 45) return;
    skipRowClick=true;setTimeout(function(){skipRowClick=false;},0);
    askConfirm('이 항목을 삭제할까요?','저장하기 전까지는 취소할 수 있어요.',function(){
      var type = row.dataset.row, index = Number(row.dataset.index);
      if(type === 'checklist') content.preTrip.checklist.splice(index, 1);
      if(type === 'schedule') content.days[Number(row.dataset.day)].items.splice(index, 1);
      setDirty(); renderPanels(); showPanel(activePanelId());
    });
  }
  function onRowPointerDown(event){
    var row = event.target.closest('[data-editable-row]');
    if(!editing || !row) return;
    swipeStart = {row:row, x:event.clientX, y:event.clientY};
  }
  function onRowPointerUp(event){
    if(!swipeStart) return;
    finishRowSwipe(event.clientX, event.clientY);
  }
  function onRowPointerMove(event){
    if(!swipeStart || !editing) return;
    var dx=Math.min(0,Math.max(-88,event.clientX-swipeStart.x)), row=swipeStart.row;
    if(Math.abs(event.clientY-swipeStart.y)>45) return;
    row.style.transform='translateX('+dx+'px)';row.classList.toggle('swipe-armed',dx<=-56);
  }
  function onRowTouchStart(event){
    if(!editing || !event.touches || event.touches.length !== 1) return;
    var row = event.target.closest('[data-editable-row]');
    if(!row) return;
    swipeStart = {row:row, x:event.touches[0].clientX, y:event.touches[0].clientY};
  }
  function onRowTouchMove(event){
    if(!swipeStart || !editing || !event.touches || event.touches.length !== 1) return;
    var dx=Math.min(0,Math.max(-88,event.touches[0].clientX-swipeStart.x)), row=swipeStart.row;
    if(Math.abs(event.touches[0].clientY-swipeStart.y)>45) return;
    row.style.transform='translateX('+dx+'px)';row.classList.toggle('swipe-armed',dx<=-56);
  }
  function onRowTouchEnd(event){
    if(!swipeStart || !event.changedTouches || event.changedTouches.length !== 1) return;
    finishRowSwipe(event.changedTouches[0].clientX, event.changedTouches[0].clientY);
  }
  function onPanelClick(event){
    var checkRow = event.target.closest('[data-row="checklist"]');
    if(checkRow && !editing){
      var box = checkRow.querySelector('.display-check');
      if(event.target !== box) box.checked = !box.checked;
      var checkItem = content.preTrip.checklist[Number(checkRow.dataset.index)];
      var checks = readChecks();
      if(box.checked) checks[checkItem.text] = true; else delete checks[checkItem.text];
      writeChecks(checks);
      return;
    }
    var row = event.target.closest('[data-editable-row]');
    if(row && editing){
      if(skipRowClick) return;
      var index = Number(row.dataset.index);
      if(row.dataset.row === 'checklist'){
        var item = content.preTrip.checklist[index];
        openEditor('체크 항목 수정',[{name:'text',label:'내용',value:item.text,multiline:true}],function(values){item.text=values.text;setDirty();renderPanels();showPanel(activePanelId());});
      }else if(row.dataset.row === 'schedule'){
        var day = content.days[Number(row.dataset.day)]; var entry = day.items[index];
        openEditor('일정 수정',[{name:'time',label:'시간',value:entry.time,mask:'time',placeholder:''},{name:'text',label:'일정 *',value:entry.text},{name:'cost',label:'비고',value:entry.cost}],function(values){if(values.time&&!validTime(values.time)){toast('시간은 16:20 형식으로 입력해 주세요.');return false;}if(!values.text.trim()){toast('일정을 입력해 주세요.');return false;}entry.time=values.time;entry.text=values.text;entry.cost=values.cost;setDirty();renderPanels();showPanel(activePanelId());});
      }
      return;
    }
    var addCheck = event.target.closest('[data-add-checklist]');
    if(addCheck && editing){ openEditor('체크 항목 추가',[{name:'text',label:'내용',value:'',multiline:true}],function(values){if(!values.text.trim()) return;content.preTrip.checklist.push({text:values.text.trim(),checked:false});setDirty();renderPanels();showPanel(activePanelId());});return; }
    var addSchedule = event.target.closest('[data-add-schedule]');
    if(addSchedule && editing){
      var targetDay = content.days[Number(addSchedule.dataset.addSchedule)];
      openEditor('일정 추가',[{name:'time',label:'시간',value:'',mask:'time',placeholder:''},{name:'text',label:'일정 *',value:''},{name:'cost',label:'비고',value:''}],function(values){if(values.time&&!validTime(values.time)){toast('시간은 16:20 형식으로 입력해 주세요.');return false;}if(!values.text.trim()){toast('일정을 입력해 주세요.');return false;}targetDay.items.push({time:values.time,text:values.text,cost:values.cost});setDirty();renderPanels();showPanel(activePanelId());});return;
    }
    var addLink = event.target.closest('[data-add-link]');
    if(addLink && editing){ editLink(addLink.dataset.addLink, -1); return; }
    var link = event.target.closest('[data-link-index]');
    if(link && editing){ editLink(link.dataset.linkScope, Number(link.dataset.linkIndex)); return; }
    var linkDelete = event.target.closest('[data-link-delete]');
    if(linkDelete && editing){
      askConfirm('링크를 삭제할까요?','저장하기 전까지는 취소할 수 있어요.',function(){linksOf(linkDelete.dataset.linkScope).splice(Number(linkDelete.dataset.linkDelete),1);setDirty();renderPanels();showPanel(activePanelId());});
      return;
    }
    var reservation = event.target.closest('[data-reservation]');
    if(reservation){
      var category=reservation.dataset.reservation;
      if(editing) openReservation(category, 0, 'list');
      else if(!(content.reservations[category] || []).length) toast('등록된 ' + RES_LABELS[category] + ' 정보가 없습니다.');
      else openReservation(category, 0, 'view');
      return;
    }
    var note = event.target.closest('[data-note="pre"]');
    if(note && editing){ openEditor('여행 안내 · 메모',[{name:'note',label:'내용',value:content.preTrip.note,multiline:true}],function(values){content.preTrip.note=values.note;setDirty();renderPanels();showPanel(activePanelId());}); }
    var dayTitle = event.target.closest('[data-day-title]');
    if(dayTitle && editing){
      var titleIndex=Number(dayTitle.dataset.dayTitle), day=content.days[titleIndex], date=tabDate(day,titleIndex);
      var dateLabel=date ? date.slice(5).replace('-', '/') : '';
      openEditor('일차 이름 수정',[{name:'title',label:'일정 제목',value:day.title},{name:'tabLabel',label:'탭 이름',value:day.tabLabel||dateLabel}],function(values){day.title=values.title;day.tabLabel=values.tabLabel===dateLabel?'':values.tabLabel;setDirty();renderPanels();showPanel(activePanelId());});
      return;
    }
    var dayNote = event.target.closest('[data-day-note]');
    if(dayNote && editing){
      var noteIndex=Number(dayNote.dataset.dayNote);openEditor('일정 메모 수정',[{name:'note',label:'내용',value:content.days[noteIndex].note,multiline:true}],function(values){content.days[noteIndex].note=values.note;setDirty();renderPanels();showPanel(activePanelId());});
    }
  }
  function editLink(scope, index){
    var links = linksOf(scope);
    var old = index >= 0 ? links[index] : {title:'',url:''};
    openEditor(index>=0?'참고 링크 수정':'참고 링크 추가',[{name:'title',label:'링크 제목',value:old.title},{name:'url',label:'URL',value:old.url}],function(values){
      if(!values.url){toast('URL을 입력해 주세요.');return false;}
      if(!/^https?:\/\//i.test(values.url)) values.url='https://'+values.url;
      var value={title:values.title||values.url,url:values.url};if(index>=0)links[index]=value;else links.push(value);setDirty();renderPanels();showPanel(activePanelId());
    });
  }
  var RES_LABELS = {tickets:'티켓',hotels:'호텔',transport:'교통'};
  var resState = {category:'',index:0,mode:'view',form:null,imgIndex:0};
  function resBody(){ return document.getElementById('reservationViewBody'); }
  function validImageSrc(image){ var url=image && image.url || ''; return /^https:\/\//i.test(url) || /^images\//i.test(url) || /^data:image\//i.test(url) ? url : ''; }
  function openReservation(category, index, mode){
    resState = {category:category,index:index||0,mode:mode,form:null,imgIndex:0};
    renderReservation();
    document.getElementById('reservationViewModal').classList.add('active');
  }
  function parseReservationBlocks(value){
    var text = String(value || '').replace(/\r\n/g,'\n').trim();
    if(!text) return [];
    var blocks = text.split(/\n{2,}/).map(function(part){ return part.trim(); }).filter(function(part){ return !!part; });
    if(!blocks.length) return [];
    return blocks.map(function(part){
      var trimmed = String(part || '').trim();
      var kind = 'info';
      var kindMatch = trimmed.match(/^\[\[kind:(info|memo)\]\]\s*/);
      if(kindMatch){ kind = kindMatch[1]; trimmed = trimmed.replace(/^\[\[kind:(info|memo)\]\]\s*/, ''); }
      var strong = /^\*\*.*\*\*$/.test(trimmed) || trimmed.indexOf('**') !== -1;
      var plainText = strong ? trimmed.replace(/^\*\*(.*)\*\*$/,'$1').trim() : trimmed;
      return {kind: kind, text: plainText, strong: strong};
    });
  }
  function serializeReservationBlocks(blocks){
    return (blocks || []).map(function(block){
      var text = String(block && block.text || '').trim();
      if(!text) return '';
      var kindPrefix = block.kind === 'memo' ? '[[kind:memo]] ' : '[[kind:info]] ';
      return kindPrefix + text;
    }).filter(function(text){ return !!text; }).join('\n\n');
  }
  function renderReservationNoteHtml(value){
    return escapeHtml(String(value || '')).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
  }
  function insertBoldToTextarea(textarea){
    if(!textarea) return;
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var value = textarea.value;
    var selected = value.slice(start, end);
    if(selected.startsWith('**') && selected.endsWith('**') && selected.length >= 4){
      var unwrapped = selected.slice(2, -2);
      textarea.value = value.slice(0, start) + unwrapped + value.slice(end);
      textarea.focus();
      textarea.setSelectionRange(start, start + unwrapped.length);
    }else{
      var boldText = selected || '텍스트';
      var insertion = '**' + boldText + '**';
      textarea.value = value.slice(0, start) + insertion + value.slice(end);
      textarea.focus();
      var pos = start + insertion.length;
      textarea.setSelectionRange(pos, pos);
    }
    var idx = Number(textarea.dataset.resBlockText);
    if(!isNaN(idx) && resState.form && resState.form.blocks[idx]) resState.form.blocks[idx].text = textarea.value;
  }
  function renderReservation(){
    var list = content.reservations[resState.category] || (content.reservations[resState.category] = []);
    var label = RES_LABELS[resState.category] || '예약';
    var html = '';
    document.getElementById('reservationViewTitle').textContent = label + ' 예약 정보';
    if(resState.mode === 'form'){
      var form = resState.form;
      var blockHtml = (form.blocks || []).map(function(block,index){
        var selectedInfo = block.kind === 'info' ? ' active' : '';
        var selectedMemo = block.kind === 'memo' ? ' active' : '';
        return '<div class="reservation-block"><div class="reservation-block-header"><div class="reservation-block-kind"><button type="button" class="res-kind-btn' + selectedInfo + '" data-res-kind="info" data-res-block-index="' + index + '">일반</button><button type="button" class="res-kind-btn' + selectedMemo + '" data-res-kind="memo" data-res-block-index="' + index + '">중요</button></div><div class="reservation-block-tools"><button type="button" class="res-close-btn" data-res-remove-block="' + index + '" aria-label="블록 삭제">×</button></div></div><textarea data-res-block-text="' + index + '" placeholder="굵은 글씨는 **중요한 내용**의 형식으로 입력할 수 있습니다">' + escapeHtml(block.text || '') + '</textarea></div>';
      }).join('');
      html = '<div class="reservation-form"><label>예약 항목 이름<input type="text" data-res-field="title" placeholder="예: 공연 티켓" value="' + escapeHtml(form.title) + '"></label><div class="reservation-field-header"><span>메모</span><button type="button" class="res-add-block-btn" data-res-add-block aria-label="새 블록 추가">＋</button></div><div class="reservation-block-list">' + blockHtml + '</div>' +
        '<div class="reservation-photos">' + form.images.map(function(image,i){ var src=validImageSrc(image); return '<figure class="reservation-photo">' + (src ? '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(image.name || '') + '">' : '<p class="empty-hint">' + escapeHtml(image.name || '이미지') + '</p>') + '<button type="button" class="btn mini-del" data-res-remove-image="' + i + '" aria-label="이미지 삭제">×</button></figure>'; }).join('') + '</div>' +
        '<ul class="reservation-pending">' + form.files.map(function(file,i){ return '<li>' + escapeHtml(file.name) + ' <button type="button" class="btn mini-del" data-res-remove-file="' + i + '" aria-label="선택 취소">×</button></li>'; }).join('') + '</ul>' +
        '<div class="reservation-manage"><button type="button" class="res-add-btn" data-res-act="pick">이미지 업로드</button></div>' +
        '<div class="editor-form-actions"><button type="button" class="btn" data-res-act="form-cancel">취소</button><button type="button" class="btn primary" data-res-act="form-save"' + (form.busy ? ' disabled' : '') + '>' + (form.busy ? '저장 중...' : '확인') + '</button></div></div>';
    }else if(resState.mode === 'list'){
      html = (list.length ? '<div class="reservation-rows">' + list.map(function(item,i){ return '<div class="reservation-row"><span class="reservation-row-name">' + escapeHtml(item.title || '~를 입력해주세요') + '</span><button type="button" class="res-text-btn" data-res-act="edit" data-i="' + i + '">수정</button><button type="button" class="res-text-btn" data-res-act="delete" data-i="' + i + '">삭제</button></div>'; }).join('') + '</div>' : '<p class="empty-hint">등록된 예약 항목이 없어요.</p>') + '<div class="res-actions"><button type="button" class="res-add-btn" data-res-act="add">+ 항목 추가</button><button type="button" class="res-apply-btn" data-res-act="apply">적용</button></div>';
    }else{
      if(resState.index >= list.length) resState.index = Math.max(0, list.length - 1);
      var item = list[resState.index];
      if(!item){ html = '<p class="empty-hint">등록된 예약 항목이 없어요.</p>'; }
      else{
        var tabs = list.length >= 1 ? '<div class="modal-tabs">' + list.map(function(entry,i){ return '<button type="button" class="modal-tab-btn' + (i === resState.index ? ' active' : '') + '" data-res-tab="' + i + '">' + escapeHtml(entry.title || '~') + '</button>'; }).join('') + '</div>' : '';
        var imgs = (item.images || []).filter(validImageSrc);
        var noteHtml = '';
        if(item.note){
          var noteText = String(item.note).replace(/\r\n/g,'\n');
          noteHtml = '<div class="reservation-note-list">' + noteText.split(/\n{2,}/).filter(function(part){ return part && part.trim(); }).map(function(part){
            var block = parseReservationBlocks(part)[0] || {kind:'info',text:part};
            var blockClass = block.kind === 'memo' ? 'important' : 'general';
            return '<div class="reservation-note-item ' + blockClass + '">' + renderReservationNoteHtml(block.text || part) + '</div>';
          }).join('') + '</div>';
        }
        var carousel = imgs.length ? '<div class="modal-image-carousel"><div class="carousel-wrapper"><div class="carousel-track" style="transform:translateX(' + (-resState.imgIndex * 100) + '%)">' + imgs.map(function(image){ return '<div class="carousel-slide-wrapper loading"><div class="carousel-loading-label"><span class="carousel-loading-spinner" aria-hidden="true"></span><span>로딩 중입니다...</span></div><img class="carousel-slide" src="' + escapeHtml(validImageSrc(image)) + '" alt="' + escapeHtml(image.name || item.title) + '" draggable="false" onload="this.parentElement.classList.remove(\'loading\')" onerror="this.parentElement.classList.remove(\'loading\')"></div>'; }).join('') + '</div><div class="image-counter">' + (resState.imgIndex + 1) + '/' + imgs.length + '</div></div></div>' : '';
        html = tabs + noteHtml + carousel + (!item.note && !imgs.length ? '<p class="empty-hint">등록된 예약 정보가 없습니다.</p>' : '');
      }
    }
    var oldTabs = resBody().querySelector('.modal-tabs');
    var oldScroll = oldTabs ? oldTabs.scrollLeft : 0;
    resBody().innerHTML = html;
    var newTabs = resBody().querySelector('.modal-tabs');
    if(newTabs){
      newTabs.scrollLeft = oldScroll;
      var activeTab = newTabs.querySelector('.modal-tab-btn.active');
      if(activeTab){
        if(activeTab.offsetLeft < newTabs.scrollLeft) newTabs.scrollLeft = activeTab.offsetLeft;
        else if(activeTab.offsetLeft + activeTab.offsetWidth > newTabs.scrollLeft + newTabs.clientWidth) newTabs.scrollLeft = activeTab.offsetLeft + activeTab.offsetWidth - newTabs.clientWidth;
      }
    }
  }
  function openReservationForm(index){
    var list = content.reservations[resState.category];
    var current = index >= 0 ? list[index] : {title:'',note:'',images:[]};
    resState.mode = 'form';
    resState.form = {index:index,title:current.title || '',blocks:parseReservationBlocks(current.note),images:(current.images || []).slice(),files:[],busy:false};
    renderReservation();
  }
  function saveReservationForm(){
    var form = resState.form, list = content.reservations[resState.category];
    if(form.busy) return;
    if(!form.title.trim()){ toast('예약 항목 이름을 입력해 주세요.'); return; }
    var current = form.index >= 0 ? list[form.index] : null;
    var id = current && current.id || ('res-' + Date.now());
    var images = form.images.slice();
    form.busy = true; renderReservation();
    form.files.reduce(function(chain,file){
      return chain.then(function(){
        var path = 'trip-files/' + activeCode + '/' + id + '/' + Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
        return firebase.storage().ref(path).put(file).then(function(snap){ return snap.ref.getDownloadURL().then(function(url){ images.push({name:file.name,path:path,url:url}); }); });
      });
    }, Promise.resolve()).then(function(){
      var value = {id:id,title:form.title.trim(),note:serializeReservationBlocks(form.blocks),images:images};
      if(form.index >= 0) list[form.index] = value; else list.push(value);
      setDirty(); resState.mode = 'list'; resState.form = null; renderReservation(); renderPanels(); showPanel(activePanelId());
      toast('저장 버튼을 눌러 반영하세요.');
    }).catch(function(err){
      form.busy = false; renderReservation(); alert(err.message || '이미지를 올리지 못했습니다.');
    });
  }
  function pickReservationFiles(){
    var picker = document.createElement('input'); picker.type='file'; picker.accept='image/*'; picker.multiple=true;
    picker.onchange = function(){
      if(!resState.form) return;
      Array.prototype.push.apply(resState.form.files, Array.prototype.slice.call(picker.files || []));
      renderReservation();
    };
    picker.click();
  }
  function onReservationClick(event){
    var t = event.target;
    var tab = t.closest('[data-res-tab]');
    if(tab){ resState.index = Number(tab.dataset.resTab); resState.imgIndex = 0; renderReservation(); return; }
    var addBlock = t.closest('[data-res-add-block]');
    if(addBlock && resState.form){ resState.form.blocks.push({kind:'info',text:'',strong:false}); renderReservation(); return; }
    var removeBlock = t.closest('[data-res-remove-block]');
    if(removeBlock && resState.form){ var idx = Number(removeBlock.dataset.resRemoveBlock); if(isNaN(idx)) return; resState.form.blocks.splice(idx,1); renderReservation(); return; }
    var kindBtn = t.closest('[data-res-kind]');
    if(kindBtn && resState.form){ var idx = Number(kindBtn.dataset.resBlockIndex); if(isNaN(idx)) return; resState.form.blocks[idx].kind = kindBtn.dataset.resKind || 'info'; renderReservation(); return; }
    var boldBtn = t.closest('[data-res-bold-block]');
    if(boldBtn && resState.form){ var idx = Number(boldBtn.dataset.resBoldBlock); if(isNaN(idx)) return; var textarea = document.querySelector('[data-res-block-text="' + idx + '"]'); insertBoldToTextarea(textarea); return; }
    var rmImg = t.closest('[data-res-remove-image]');
    if(rmImg && resState.form){ resState.form.images.splice(Number(rmImg.dataset.resRemoveImage),1); renderReservation(); return; }
    var rmFile = t.closest('[data-res-remove-file]');
    if(rmFile && resState.form){ resState.form.files.splice(Number(rmFile.dataset.resRemoveFile),1); renderReservation(); return; }
    var action = t.closest('[data-res-act]');
    if(!action || !editing) return;
    var kind = action.dataset.resAct, i = Number(action.dataset.i);
    if(kind === 'add') openReservationForm(-1);
    else if(kind === 'apply'){ document.getElementById('reservationViewModal').classList.remove('active'); toast('예약 정보를 적용했어요.'); }
    else if(kind === 'edit') openReservationForm(i);
    else if(kind === 'pick') pickReservationFiles();
    else if(kind === 'form-cancel'){ resState.mode = 'list'; resState.form = null; renderReservation(); }
    else if(kind === 'form-save') saveReservationForm();
    else if(kind === 'delete'){
      askConfirm('예약 항목을 삭제할까요?','저장하기 전까지는 취소할 수 있어요.',function(){
        content.reservations[resState.category].splice(i,1); setDirty(); renderReservation(); renderPanels(); showPanel(activePanelId());
      });
    }
  }
  var carouselDrag = null;
  function onCarouselDown(event){
    var wrapper = event.target.closest('.carousel-wrapper');
    if(!wrapper) return;
    var track = wrapper.querySelector('.carousel-track');
    carouselDrag = {wrapper:wrapper, track:track, x:event.clientX, dx:0, width:wrapper.clientWidth, count:track.children.length};
    track.style.transition = 'none';
    try{ wrapper.setPointerCapture(event.pointerId); }catch(e){}
  }
  function onCarouselMove(event){
    if(!carouselDrag) return;
    var drag = carouselDrag, dx = event.clientX - drag.x;
    var atEdge = (resState.imgIndex === 0 && dx > 0) || (resState.imgIndex === drag.count - 1 && dx < 0);
    drag.dx = atEdge ? dx * 0.3 : dx;
    drag.track.style.transform = 'translateX(calc(' + (-resState.imgIndex * 100) + '% + ' + drag.dx + 'px))';
  }
  function onCarouselUp(){
    if(!carouselDrag) return;
    var drag = carouselDrag; carouselDrag = null;
    var threshold = Math.min(60, drag.width * 0.2);
    if(drag.dx < -threshold && resState.imgIndex < drag.count - 1) resState.imgIndex += 1;
    else if(drag.dx > threshold && resState.imgIndex > 0) resState.imgIndex -= 1;
    drag.track.style.transition = 'transform .25s ease';
    drag.track.style.transform = 'translateX(' + (-resState.imgIndex * 100) + '%)';
    drag.wrapper.querySelector('.image-counter').textContent = (resState.imgIndex + 1) + '/' + drag.count;
  }
  function updateLoginButton(){
    editorSession().then(function(ok){
      var btn = document.getElementById('tripLoginBtn');
      if(btn){
        var icon=btn.querySelector('img');
        if(icon) icon.src='icons/user.svg';
        btn.setAttribute('aria-label', '사용자');
        btn.setAttribute('title', '사용자');
      }
      var editBtn = document.getElementById('tripEditBtn');
      if(editBtn){
        editBtn.hidden = !ok || editing;
        editBtn.title = '현재 탭 편집';
      }
    });
  }
  function openLogin(code){
    document.getElementById('tripLoginCode').value = code || activeCode || '';
    document.getElementById('tripLoginPin').value = '';
    document.getElementById('tripLoginStatus').textContent = '';
    document.getElementById('tripLoginModal').classList.add('active');
  }
  function login(code, pin){
    if(!navigator.onLine) return Promise.reject(new Error('편집 로그인은 온라인에서만 할 수 있습니다.'));
    code = normalizeCode(code);
    return call('loginToTrip', {code:code, pin:String(pin || '')}).then(function(result){
      return firebase.auth().signInWithCustomToken(result.token);
    }).then(function(){
      try{ localStorage.setItem('trip_editor_ok_' + code, '1'); }catch(e){}
      updateLoginButton();
      window.dispatchEvent(new CustomEvent('trip:login',{detail:{code:code}}));
      return true;
    });
  }
  function loadTrip(code, options){
    code = normalizeCode(code);
    if(!/^[A-Z0-9]{6}$/.test(code)) return Promise.reject(new Error('여행 코드는 영문 대문자와 숫자 6자리로 입력해 주세요.'));
    setGateStatus('');
    if(!navigator.onLine){
      var offlineCopy = readCache(code);
      if(!offlineCopy) return Promise.reject(new Error('오프라인 저장 데이터가 없습니다. 인터넷에 연결해 여행을 먼저 불러와 주세요.'));
      activateTrip(code,offlineCopy,true); return Promise.resolve();
    }
    var confirmFirst = !!(options && options.confirm), quick = !!(options && options.quick);
    showLoading(quick ? '여행을 불러오고 있어요...' : '여행코드를 확인하는 중이에요...');
    return getTrip(code).then(function(result){
      var name = result.content && (result.content.title || result.content.destination) || code;
      var enter = function(){
        showLoading(quick ? '여행을 불러오고 있어요...' : name + ' 여행을 불러오고 있어요');
        setTimeout(function(){ activateTrip(code,result.content,false); hideLoading(); }, 500);
      };
      if(!confirmFirst){ enter(); return; }
      hideLoading();
      askConfirm('[' + name + ']\n여행을 불러올까요?', '여행코드 ' + code, enter, '불러오기', true);
    })
      .catch(function(error){
        var saved = readCache(code);
        var reason=String(error && error.code || '');
        var connectionError=!navigator.onLine || /unavailable|deadline-exceeded|network-request-failed|internal/.test(reason);
        if(saved && connectionError){ hideLoading(); activateTrip(code,saved,true); return; }
        if(error && /존재하지 않는/.test(error.message)){ hideLoading(); showNotice('존재하지 않는 여행코드입니다','여행코드 ' + code + '에 해당하는 여행이 없어요.\n코드를 다시 확인해 주세요.'); }
        throw error;
      }).catch(function(error){ hideLoading(); throw error; });
  }
  function validateTripDates(showError){
    var startEl = document.getElementById('newTripStart'), endEl = document.getElementById('newTripEnd');
    var errorEl = document.getElementById('newTripDateError');
    var realDate = function(value){
      var m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if(!m || Number(m[1]) < 1900) return false;
      var date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      return date.getUTCMonth() === Number(m[2]) - 1 && date.getUTCDate() === Number(m[3]);
    };
    var start = normalizeInputDate(startEl.value), end = normalizeInputDate(endEl.value);
    var startDone = startEl.value.length === 10, endDone = endEl.value.length === 10;
    var bad = false;
    if(startDone && !realDate(start)) bad = true;
    if(endDone && !realDate(end)) bad = true;
    if(!bad && startDone && endDone){
      var days = Math.floor((Date.parse(end+'T00:00:00Z') - Date.parse(start+'T00:00:00Z')) / 86400000) + 1;
      if(days < 1 || days > 31) bad = true;
    }
    if(showError && (!startDone || !endDone)) bad = true;
    errorEl.hidden = !bad;
    return !bad;
  }
  function newTrip(form){
    if(!validateTripDates(true)) return;
    var code = normalizeCode(document.getElementById('newTripCode').value);
    var pin = document.getElementById('newTripPin').value;
    var data = {
      code:code,pin:pin,
      destination:document.getElementById('newTripDestination').value.trim(),
      startDate:normalizeInputDate(document.getElementById('newTripStart').value),
      endDate:normalizeInputDate(document.getElementById('newTripEnd').value)
    };
    var daysCount=Math.floor((Date.parse(data.endDate+'T00:00:00Z')-Date.parse(data.startDate+'T00:00:00Z'))/86400000)+1;
    if(!/^[A-Z0-9]{6}$/.test(code) || !/^\d{4}$/.test(pin) || !data.destination || !/^\d{4}-\d{2}-\d{2}$/.test(data.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(data.endDate) || daysCount<1 || daysCount>31){setGateStatus('여행 코드는 영문·숫자 6자리, 비밀번호는 숫자 4자리로 입력하고 여행 기간은 1~31일로 설정해 주세요.');return;}
    showLoading('여행을 만드는 중이에요...');
    setGateStatus('');
    return call('createTrip',{code:code,pin:pin,destination:data.destination,startDate:data.startDate,endDate:data.endDate}).then(function(result){
      var initial = result.content;
      initial.title = data.destination; initial.destination = data.destination;
      initial.startDate = data.startDate; initial.endDate = data.endDate;
      cacheTrip(code,result.content);
      return login(code,pin).catch(function(error){
        throw new Error('여행은 만들어졌지만 편집 로그인에 실패했어요. 여행코드로 조회한 뒤 다시 로그인해 주세요. (' + (error && error.message || error) + ')');
      }).then(function(){
        activateTrip(code,initial,false);
      });
    }).catch(function(error){
      setGateStatus(error.code === 'functions/already-exists' ? '이미 사용 중인 여행코드입니다.' : (error.message || '여행을 만들지 못했습니다.') + (error.code === 'functions/internal' ? ' [internal]' : ''), true);
    }).then(hideLoading);
  }
  function normalizeInputDate(value){
    var match=String(value||'').trim().match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
    if(!match) return '';
    return match[1]+'-'+String(match[2]).padStart(2,'0')+'-'+String(match[3]).padStart(2,'0');
  }

  function logout(){
    askConfirm('로그아웃 할까요?', editing && dirty ? '저장하지 않은 변경 내용은 취소돼요.\n로그아웃하면 조회 모드로 전환돼요.' : '로그아웃하면 조회 모드로 전환돼요.', doLogout, '로그아웃');
  }
  function doLogout(){
    var cleanup = editing && dirty ? cleanupAddedStorageFiles(editBaseline ? JSON.parse(editBaseline) : {},content) : Promise.resolve();
    if(editing && dirty){ content=editBaseline ? safeContent(JSON.parse(editBaseline)) : content; clearDraft(activeCode); }
    var done = editing ? cleanup.then(releaseLock) : Promise.resolve();
    done.then(function(){
      return firebase.auth().signOut().catch(function(){});
    }).then(function(){
      try{ localStorage.removeItem('trip_editor_ok_' + activeCode); }catch(e){}
      editing=false; dirty=false; showEditControls(false); updateLoginButton();
      window.dispatchEvent(new CustomEvent('trip:logout',{detail:{code:activeCode}}));
      if(tripApp.hidden) return;
      if(content){ renderPanels(); showPanel(activePanelId()); }
      toast('로그아웃했습니다.');
    });
  }
  function leaveTrip(){
    if(editing && dirty && !window.confirm('저장하지 않은 변경이 취소됩니다. 여행에서 나갈까요?')) return;
    var cleanup = editing && dirty ? cleanupAddedStorageFiles(editBaseline ? JSON.parse(editBaseline) : {},content) : Promise.resolve();
    if(editing && dirty) clearDraft(activeCode);
    var done = activeCode ? cleanup.then(releaseLock) : Promise.resolve();
    done.then(function(){
      editing=false; dirty=false; showEditControls(false); activeCode=''; content=null;
      window.dispatchEvent(new CustomEvent('trip:leave'));
      tripApp.hidden=true; tripGate.hidden=false; showGateForm('');
      setGateStatus(''); refreshResumeButton();
    });
  }
  function refreshResumeButton(){
    renderRecentTrips();
  }
  function init(){
    if(!window.firebase){ setGateStatus('Firebase SDK를 불러오지 못했습니다.'); return; }
    if(!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    fns = firebase.app().functions('asia-northeast3');
    showGateForm(''); refreshResumeButton();
    ['joinTripCode','newTripCode','tripLoginCode'].forEach(function(id){
      var el = document.getElementById(id);
      el.addEventListener('input',function(){ el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g,''); });
    });
    ['newTripStart','newTripEnd'].forEach(function(id){
      var el = document.getElementById(id);
      el.addEventListener('input',function(){
        var d = el.value.replace(/\D/g,'').slice(0,8);
        el.value = maskValue('date', el.value);
        validateTripDates(false);
      });
    });
    document.getElementById('newTripCode').addEventListener('input',function(e){
      var value = normalizeCode(e.target.value);
      if(!/^[A-Z0-9]{6}$/.test(value) || !navigator.onLine){ setGateStatus(''); return; }
      getTrip(value).then(function(){
        if(normalizeCode(e.target.value) !== value) return;
        setGateStatus('이미 사용 중인 여행코드입니다.'); toast('이미 사용 중인 여행코드입니다.');
      }).catch(function(error){
        if(normalizeCode(e.target.value) === value && error && error.code === 'functions/not-found') setGateStatus('');
      });
    });
    document.getElementById('openJoinTrip').addEventListener('click',function(){showGateForm('joinTripForm');});
    document.getElementById('openCreateTrip').addEventListener('click',function(){showGateForm('createTripForm');});
    document.querySelectorAll('[data-gate-back]').forEach(function(btn){btn.addEventListener('click',function(){showGateForm('');});});
    document.getElementById('joinTripForm').addEventListener('submit',function(e){
      e.preventDefault(); loadTrip(document.getElementById('joinTripCode').value, {confirm:true}).catch(function(err){setGateStatus(err.message || '여행을 불러오지 못했습니다.', true);});
    });
    document.getElementById('createTripForm').addEventListener('submit',function(e){e.preventDefault();newTrip(e.currentTarget);});
    document.getElementById('resumeTrip').addEventListener('click',function(e){
      var code=e.currentTarget.dataset.code;
      if(!code){showGateForm('joinTripForm');return;}
      loadTrip(code,{quick:true}).catch(function(err){setGateStatus(err.message);});
    });
    document.getElementById('recentTripList').addEventListener('click',function(e){
      var open=e.target.closest('[data-recent-code]');
      if(open){loadTrip(open.dataset.recentCode,{quick:true}).catch(function(err){setGateStatus(err.message);});return;}
      var remove=e.target.closest('[data-delete-recent]');
      if(!remove) return;
      var code=remove.dataset.deleteRecent;
      askConfirm('최근 여행을 지울까요?','이 기기에 저장된\n '+recentLabel(code)+' 여행 정보와 이미지 메타데이터를 삭제해요.\nDB의 여행 데이터는 그대로 남아요.',function(){
        try{
          localStorage.removeItem(localKey(code));
          localStorage.removeItem(draftKey(code));
          localStorage.removeItem('baekdu_settlement_v1_'+code);
          localStorage.removeItem('baekdu_settlement_v1_'+code.toLowerCase());
          localStorage.removeItem('trip_editor_ok_'+code);
          localStorage.removeItem('baekdu_pin_ok_'+code);
          localStorage.removeItem('baekdu_pin_ok_'+code.toLowerCase());
          if((JSON.parse(localStorage.getItem('recentTrip')||'{}')).tripCode===code)localStorage.removeItem('recentTrip');
          if(localStorage.getItem('lastTravelCode')===code)localStorage.removeItem('lastTravelCode');
        }catch(err){}
        renderRecentTrips();
      });
    });
    document.getElementById('deleteTripCache').addEventListener('click',function(){
      var codes=[];
      try{for(var i=0;i<localStorage.length;i++){var key=localStorage.key(i)||'';var match=key.match(/^travelTrip_([A-Z0-9]{6})(?:_draft)?$/);if(match && codes.indexOf(match[1])<0)codes.push(match[1]);}}catch(e){}
      var code=normalizeCode(window.prompt('이 기기에 저장된 여행 코드를 입력하세요.'+(codes.length?'\n저장된 코드: '+codes.join(', '):''),codes[0]||''));
      if(!/^[A-Z0-9]{6}$/.test(code)) return;
      if(!window.confirm(code+' 여행의 이 기기 저장 데이터와 로그인 상태를 삭제할까요? 서버의 여행 데이터는 삭제되지 않습니다.')) return;
      try{
        localStorage.removeItem(localKey(code)); localStorage.removeItem(draftKey(code));
        localStorage.removeItem('baekdu_settlement_v1_'+code);
        localStorage.removeItem('baekdu_settlement_v1_'+code.toLowerCase());
        localStorage.removeItem('trip_editor_ok_'+code);
        localStorage.removeItem('baekdu_pin_ok_'+code);
        localStorage.removeItem('baekdu_pin_ok_'+code.toLowerCase());
        if(localStorage.getItem('lastTravelCode')===code)localStorage.removeItem('lastTravelCode');
      }catch(e){}
      refreshResumeButton();setGateStatus('이 기기에 저장된 '+code+' 여행 데이터를 삭제했습니다.');
    });
    document.getElementById('leaveTripBtn').addEventListener('click',leaveTrip);
    document.getElementById('tripLoginBtn').addEventListener('click',function(){
      editorSession().then(function(ok){ if(ok) logout(); else openLogin(activeCode); });
    });
    document.getElementById('closeTripLogin').addEventListener('click',function(){document.getElementById('tripLoginModal').classList.remove('active');});
    document.getElementById('closeTripEditor').addEventListener('click',function(){document.getElementById('tripEditorModal').classList.remove('active');});
    document.getElementById('closeReservationView').addEventListener('click',function(){document.getElementById('reservationViewModal').classList.remove('active');});
    var resEl=document.getElementById('reservationViewBody');
    resEl.addEventListener('click',onReservationClick);
    resEl.addEventListener('input',function(e){
      var blockField=e.target.closest('[data-res-block-text]');
      if(blockField && resState.form){
        var idx = Number(blockField.dataset.resBlockText);
        if(!isNaN(idx) && resState.form.blocks[idx]) resState.form.blocks[idx].text = blockField.value;
        return;
      }
      var field=e.target.closest('[data-res-field]');
      if(field && resState.form) resState.form[field.dataset.resField]=field.value;
    });
    resEl.addEventListener('pointerdown',onCarouselDown);
    resEl.addEventListener('pointermove',onCarouselMove);
    resEl.addEventListener('pointerup',onCarouselUp);
    resEl.addEventListener('pointercancel',onCarouselUp);
    document.getElementById('submitTripLogin').addEventListener('click',function(){
      var code=normalizeCode(document.getElementById('tripLoginCode').value); var pin=document.getElementById('tripLoginPin').value;
      document.getElementById('tripLoginStatus').textContent='로그인 중...';
      login(code,pin).then(function(){
        document.getElementById('tripLoginModal').classList.remove('active');
        if(!activeCode) loadTrip(code).catch(function(err){setGateStatus(err.message);});
        updateLoginButton();
      }).catch(function(err){document.getElementById('tripLoginStatus').textContent=err.message || '로그인하지 못했습니다.';});
    });
    document.getElementById('tripEditBtn').addEventListener('click',function(){
      showLoading('편집 모드를 준비하고 있어요...');
      editorSession().then(function(ok){
        if(!ok){hideLoading();openLogin(activeCode);return;}
        if(!navigator.onLine){hideLoading();alert('편집 모드는 온라인에서만 시작할 수 있습니다.');return;}
        return startLock().then(function(){hideLoading();});
      }).catch(function(err){
        hideLoading();
        if(isEditLockBusy(err)){
          showNotice('잠시만 기다려 주세요','다른 사람이 이 여행을 편집하고 있어요.\n편집이 끝나면 다시 시도해 주세요.','✎');
          return;
        }
        alert(err.message || '편집 모드를 시작하지 못했습니다.');
      });
    });
    document.getElementById('tripEditSaveBtn').addEventListener('click',saveEditing);
    document.getElementById('tripEditCancelBtn').addEventListener('click',function(){
      if(dirty){
        askConfirm('편집을 취소할까요?', '저장하지 않은 변경 내용은 사라져요.', cancelEditing, '편집 취소', true);
        return;
      }
      cancelEditing();
    });
    main.addEventListener('click', onPanelClick);
    document.querySelector('.app-header-title').addEventListener('click',function(){ if(editing) editTripInfo(); });
    main.addEventListener('pointerdown', onRowPointerDown);
    main.addEventListener('pointermove', onRowPointerMove);
    main.addEventListener('pointerup', onRowPointerUp);
    main.addEventListener('touchstart', onRowTouchStart, {passive:true});
    main.addEventListener('touchmove', onRowTouchMove, {passive:true});
    main.addEventListener('touchend', onRowTouchEnd, {passive:true});
    main.addEventListener('pointercancel', function(){if(!swipeStart)return;swipeStart.row.style.transform='';swipeStart.row.classList.remove('swipe-armed');swipeStart=null;});
    panelsNav.addEventListener('click',function(e){
      var tab=e.target.closest('[role="tab"]'); if(!tab)return;
      switchPanel(tab.getAttribute('aria-controls'));
    });
    window.addEventListener('online',function(){
      if(activeCode && content && !dirty){ getTrip(activeCode).then(function(result){content=safeContent(result.content);cacheTrip(activeCode,content);renderPanels();showPanel(activePanelId());}).catch(function(){}); }
    });
    window.addEventListener('offline',function(){
      if(!editing) return;
      if(dirty) saveDraft(activeCode,content);
      releaseLock();
      editing=false; dirty=false; showEditControls(false);
      content=editBaseline ? safeContent(JSON.parse(editBaseline)) : content;
      renderPanels(); showPanel(activePanelId());
      alert('네트워크가 끊겨 편집 모드를 종료했습니다. 저장되지 않은 변경은 이 기기에 임시 보관했습니다.');
    });
    window.tripSession = {
      requestLogin:function(){openLogin(activeCode);},
      login:login,
      logout:logout,
      editorSession:editorSession,
      activeCode:function(){return activeCode;},
      getContent:function(){return content;},
      loadTrip:loadTrip
    };
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
