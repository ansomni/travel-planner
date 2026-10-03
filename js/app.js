function toggleSettlementPage(isOpen) {
  var page = document.getElementById('settlementPage');
  if (!page) return;
  var wasOpen = page.classList.contains('active');
  page.classList.toggle('active', !!isOpen);
  page.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  if (isOpen) {
    document.body.classList.add('no-scroll');
  } else if (wasOpen) {
    var unlockScroll = function(event){
      if (event && (event.target !== page || event.propertyName !== 'opacity')) return;
      page.removeEventListener('transitionend', unlockScroll);
      if (!page.classList.contains('active')) document.body.classList.remove('no-scroll');
    };
    page.addEventListener('transitionend', unlockScroll);
    window.setTimeout(function(){ unlockScroll(); }, 260);
  } else {
    document.body.classList.remove('no-scroll');
  }
}

function openSettlementPage() {
  toggleSettlementPage(true);
  window.dispatchEvent(new CustomEvent('settlement:opened'));
}

function closeSettlementPage() {
  if (location.hash === '#settlement') history.replaceState(null, '', location.pathname + location.search);
  toggleSettlementPage(false);
}
window.addEventListener('hashchange', function() {
  var open = location.hash === '#settlement';
  toggleSettlementPage(open);
  if (open) window.dispatchEvent(new CustomEvent('settlement:opened'));
});

if (location.hash === '#settlement') {
  toggleSettlementPage(true);
}

(function(){
var key = 'baekdu_settlement_v1';
// HTML 관리자용 공유 설정값
var travelCode = (function(){ try{return localStorage.getItem('lastTravelCode') || '2610yb';}catch(e){return '2610yb';} })();
var state = {
  participants: [],
  currencies: [],
  expenses: [],
  deletedExpenseIds: [],
  pendingMeta: { participants: false, fxRate: false }
};
var uiState = {
  showKrwOnly: false
};
var remote = {
  enabled: false,
  unsub: null,
  syncTimer: null,
  applying: false
};

var firebaseConfig = {
  apiKey: "AIzaSyDemDlX73nIOp0sqNSzTR-YQ0b4MAUMuLM",
  authDomain: "travel-settlement-f3949.firebaseapp.com",
  projectId: "travel-settlement-f3949",
  storageBucket: "travel-settlement-f3949.firebasestorage.app",
  messagingSenderId: "586979034221",
  appId: "1:586979034221:web:e64a617e26b733f338ab64",
  measurementId: "G-579R0KKQKH"
};

function byId(id){ return document.getElementById(id); }
function escapeHtml(value){
  return String(value == null ? '' : value).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});
}
function asNumber(v){ var n = parseFloat(v); return isNaN(n) ? 0 : n; }
function fmtKrw(v){ return Math.round(v).toLocaleString('ko-KR') + '원'; }
var CURRENCY_SYMBOLS = {KRW:'₩',CNY:'¥',JPY:'¥',USD:'$',EUR:'€',GBP:'£',THB:'฿',VND:'₫',TWD:'NT$',HKD:'HK$',SGD:'S$',PHP:'₱'};
function normCurrency(code){ var c = String(code || '').trim().toUpperCase(); return /^[A-Z]{3}$/.test(c) ? c : 'KRW'; }
function currencySymbol(code){
  if(CURRENCY_SYMBOLS[code]) return CURRENCY_SYMBOLS[code];
  try{
    var part = new Intl.NumberFormat('ko-KR', {style:'currency', currency:code, currencyDisplay:'narrowSymbol'}).formatToParts(0).filter(function(p){ return p.type === 'currency'; })[0];
    if(part && part.value && part.value !== code) return part.value;
  }catch(e){}
  return code + ' ';
}
function fmtMoney(code, v){
  var symbol = currencySymbol(code);
  return symbol + (code === 'KRW' ? Math.round(v).toLocaleString('ko-KR') : Number(v.toFixed(2)).toLocaleString('ko-KR'));
}
function normalizeCurrencies(list){
  var seen = {};
  return (Array.isArray(list) ? list : []).map(function(c){ return {code:normCurrency(c && c.code), rate:asNumber(c && c.rate)}; })
    .filter(function(c){ if(c.code === 'KRW' || seen[c.code]) return false; seen[c.code] = true; return true; });
}
function currenciesFromData(data){
  if(data && Array.isArray(data.currencies)) return normalizeCurrencies(data.currencies);
  if(data && asNumber(data.fxRate)) return [{code:'CNY', rate:asNumber(data.fxRate)}];
  return [];
}
function currencyRate(code){
  if(code === 'KRW') return 1;
  var found = (state.currencies || []).filter(function(c){ return c.code === code; })[0];
  return found ? asNumber(found.rate) : 0;
}
function fmtKrwSymbol(v){ return fmtMoney('KRW', v); }

function setRemoteStatus(msg){
  var el = byId('remoteStatus');
  if(!el) return;
  var text = String(msg || '').trim();
  if(text === '잠금 상태입니다. 사용자 버튼에서 PIN을 입력해 주세요') text = '';
  el.textContent = text;
}

function setPullIndicator(text, distance, active){
  var indicator = byId('pullRefreshIndicator');
  var label = byId('pullRefreshText');
  var content = byId('pullContent');
  var shown = Math.max(0, Math.min(distance || 0, 64));
  if(indicator){
    indicator.style.height = shown + 'px';
    indicator.classList.toggle('active', !!active || shown > 0);
    indicator.setAttribute('aria-hidden', shown > 0 ? 'false' : 'true');
  }
  if(label && text) label.textContent = text;
  if(content) content.style.transform = shown > 0 ? 'translateY(' + Math.min(shown, 40) + 'px)' : '';
}

var editToastTimer = null;
function showEditNotice(message){
  var toast = byId('editNoticeToast');
  if(!toast) return;
  toast.textContent = message || '로그인 해주세요! 현재 변경은 이 기기에만 저장돼요.';
  toast.classList.add('active');
  toast.setAttribute('aria-hidden', 'false');
  if(editToastTimer) clearTimeout(editToastTimer);
  editToastTimer = setTimeout(function(){
    toast.classList.remove('active');
    toast.setAttribute('aria-hidden', 'true');
  }, 3200);
}

function clearPendingSync(){
  (state.expenses || []).forEach(function(exp){ delete exp._pendingSync; });
  state.deletedExpenseIds = [];
  state.pendingMeta = { participants: false, fxRate: false };
}

function markExpensePending(idx){
  if(!state.expenses || !state.expenses[idx]) return;
  state.expenses[idx]._pendingSync = true;
}

function markAllExpensesPending(){
  (state.expenses || []).forEach(function(exp){ exp._pendingSync = true; });
}

function markPendingMeta(key){
  state.pendingMeta = normalizePendingMeta(state.pendingMeta);
  if(state.pendingMeta.hasOwnProperty(key)) state.pendingMeta[key] = true;
}

function hasPendingSync(){
  return (state.expenses || []).some(function(exp){ return !!exp._pendingSync; }) ||
    !!((state.deletedExpenseIds || []).length) ||
    !!(state.pendingMeta && (state.pendingMeta.participants || state.pendingMeta.fxRate));
}

function createExpenseId(){
  return 'exp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function ensureExpenseId(exp){
  if(!exp.id) exp.id = createExpenseId();
  return exp.id;
}

function normalizeExpense(exp){
  var clean = {
    id: ensureExpenseId(exp || {}),
    payer: String((exp && exp.payer) || '').trim(),
    item: String((exp && exp.item) || '').trim(),
    currency: normCurrency(exp && exp.currency),
    amount: asNumber(exp && exp.amount),
    included: !exp || exp.included !== false
  };
  if(exp && exp._pendingSync) clean._pendingSync = true;
  return clean;
}

function normalizePendingMeta(meta){
  return {
    participants: !!(meta && meta.participants),
    fxRate: !!(meta && meta.fxRate)
  };
}

function expenseSignature(exp){
  return [
    String((exp && exp.payer) || '').trim(),
    String((exp && exp.item) || '').trim(),
    normCurrency(exp && exp.currency),
    String(asNumber(exp && exp.amount)),
    exp && exp.included !== false ? '1' : '0'
  ].join('||');
}

function mergeRemoteWithPending(remoteData){
  var merged = {
    participants: Array.isArray(remoteData && remoteData.participants) ? remoteData.participants.slice() : getParticipants().slice(),
    currencies: Array.isArray(remoteData && remoteData.currencies) || asNumber(remoteData && remoteData.fxRate) ? currenciesFromData(remoteData) : normalizeCurrencies(state.currencies),
    expenses: []
  };
  var deletedIds = {};
  (state.deletedExpenseIds || []).forEach(function(id){ if(id) deletedIds[id] = true; });
  var byId = {};
  var signatureToId = {};

  (Array.isArray(remoteData && remoteData.expenses) ? remoteData.expenses : []).forEach(function(exp){
    var hadId = !!(exp && exp.id);
    var clean = normalizeExpense(exp);
    if(deletedIds[clean.id]) return;
    var sig = expenseSignature(clean);
    if(signatureToId[sig]) return;
    byId[clean.id] = clean;
    signatureToId[sig] = clean.id;
    if(!hadId) clean._legacyNoId = true;
  });

  (state.expenses || []).forEach(function(exp){
    var clean = normalizeExpense(exp);
    var sig = expenseSignature(clean);
    var matchedId = signatureToId[sig];
    if(matchedId && matchedId !== clean.id){
      clean.id = matchedId;
      delete clean._legacyNoId;
      byId[matchedId] = clean;
      return;
    }
    if(exp._pendingSync || !byId[clean.id]){
      byId[clean.id] = clean;
      signatureToId[sig] = clean.id;
    }
  });

  if(state.pendingMeta && state.pendingMeta.participants){
    merged.participants = getParticipants().slice();
  }
  if(state.pendingMeta && state.pendingMeta.fxRate){
    merged.currencies = normalizeCurrencies(state.currencies);
  }

  merged.expenses = Object.keys(byId).map(function(id){
    var exp = byId[id];
    delete exp._legacyNoId;
    return exp;
  });
  return merged;
}

function normalizeCode(v){
  var code = String(v || '').trim().toLowerCase();
  code = code.replace(/[^a-z0-9_-]/g, '');
  if(!code) code = '2610yb';
  return code.slice(0, 20);
}

function isUnlocked(){
  try{ return localStorage.getItem('trip_editor_ok_' + travelCode) === '1'; }catch(e){ return false; }
}
function canEditOnline(){ return isUnlocked() && navigator.onLine; }

function lockCurrentCode(){
  try{ localStorage.removeItem('trip_editor_ok_' + travelCode); }catch(e){}
}

window.setSettlementTripCode = function(code){
  code = String(code || '').trim().toUpperCase();
  if(!/^[A-Z0-9]{6}$/.test(code)) return;
  if(code === travelCode) return;
  if(remote.unsub){ clearInterval(remote.unsub); remote.unsub = null; }
  if(remote.syncTimer){ clearTimeout(remote.syncTimer); remote.syncTimer = null; }
  if(code === '2610YB'){
    try{
      var oldKey = key + '_2610yb'; var newKey = key + '_2610YB';
      if(!localStorage.getItem(newKey) && localStorage.getItem(oldKey)) localStorage.setItem(newKey,localStorage.getItem(oldKey));
    }catch(e){}
  }
  travelCode = code;
  state = {participants:[],currencies:[],expenses:[],deletedExpenseIds:[],pendingMeta:{participants:false,fxRate:false}};
  load();
  renderAll();
};

function getLocalKey(){
  return key + '_' + travelCode;
}

function exportState(){
  return {
    participants: getParticipants(),
    currencies: normalizeCurrencies(state.currencies),
    expenses: (state.expenses || []).map(function(exp){
      return {
        id: ensureExpenseId(exp),
        payer: String(exp.payer || '').trim(),
        item: String(exp.item || '').trim(),
        currency: normCurrency(exp.currency),
        amount: asNumber(exp.amount),
        included: exp.included !== false
      };
    }),
    deletedExpenseIds: (state.deletedExpenseIds || []).slice(),
    pendingMeta: normalizePendingMeta(state.pendingMeta)
  };
}

function applyState(data){
  if(!data || typeof data !== 'object') return;
  if(Array.isArray(data.participants)){
    state.participants = data.participants;
  }else if(typeof data.participants === 'string'){
    state.participants = data.participants.split(',');
  }
  state.currencies = currenciesFromData(data);
  state.expenses = Array.isArray(data.expenses) ? data.expenses.map(normalizeExpense) : [];
  state.deletedExpenseIds = Array.isArray(data.deletedExpenseIds) ? data.deletedExpenseIds.slice() : [];
  state.pendingMeta = normalizePendingMeta(data.pendingMeta);
  state.expenses.forEach(function(exp){
    if(typeof exp.included === 'undefined') exp.included = true;
    if(!data.pendingMeta && !data.deletedExpenseIds) delete exp._pendingSync;
  });
}

function initFirebase(){
  try{
    if(!window.firebase){
      setRemoteStatus('Firebase SDK 로드 실패');
      return;
    }
    if(!firebase.apps.length){
      firebase.initializeApp(firebaseConfig);
    }
    remote.enabled = !!firebase.functions;
    setRemoteStatus(isUnlocked() ? '공유 저장 연결됨' : '');
  }catch(e){
    remote.enabled = false;
    setRemoteStatus('공유 저장 연결 실패');
  }
}

function settlementRef(){
  var fns = firebase.app().functions('asia-northeast3');
  var code = travelCode;
  var inactive = function(){ return !window.tripSession || window.tripSession.activeCode() !== code; };
  return {
    get: function(){
      if(inactive()) return Promise.reject(new Error('여행이 선택되지 않았어요.'));
      return fns.httpsCallable('getSettlement')({code:code}).then(function(result){
        if(code !== travelCode) return new Promise(function(){});
        var data = result.data && result.data.data;
        return {exists:!!data, data:function(){ return data; }};
      });
    },
    set: function(payload){
      if(inactive()) return Promise.reject(new Error('여행이 선택되지 않았어요.'));
      return fns.httpsCallable('saveSettlement')({code:code, payload:payload});
    }
  };
}

function saveRemoteNow(){
  if(!isUnlocked()){
    setRemoteStatus('잠금 상태입니다. 사용자 버튼에서 PIN을 입력해 주세요');
    return Promise.resolve();
  }
  if(!navigator.onLine){
    setRemoteStatus('네트워크가 오프라인입니다. 로컬에만 저장됨');
    return Promise.resolve();
  }
  var payload = exportState();
  return settlementRef().set(Object.assign({},payload,{travelCode:travelCode,updatedAt:new Date().toISOString()}),{merge:true}).then(function(){
    clearPendingSync();
    saveLocalOnly();
    renderAll();
    setRemoteStatus('공유 저장 완료');
  }).catch(function(error){
    setRemoteStatus(error && error.message ? error.message : '네트워크가 불안정합니다. 로컬에만 저장됨');
  });
}

function saveMergedRemoteNow(remoteData){
  if(!isUnlocked()) return Promise.resolve();
  if(!navigator.onLine) return Promise.resolve();
  var payload = mergeRemoteWithPending(remoteData || {});
  return settlementRef().set(Object.assign({},payload,{travelCode:travelCode,updatedAt:new Date().toISOString()}),{merge:true}).then(function(){
    clearPendingSync();
    applyState(payload);
    saveLocalOnly();
    renderAll();
    setRemoteStatus('공유 저장 완료');
  }).catch(function(error){
    setRemoteStatus(error && error.message ? error.message : '네트워크가 불안정합니다. 로컬에만 저장됨');
  });
}

function queueRemoteSave(){
  if(!remote.enabled || remote.applying || !isUnlocked()) return;
  if(remote.syncTimer) clearTimeout(remote.syncTimer);
  remote.syncTimer = setTimeout(function(){
    syncRemotePreferringPending();
  }, 350);
}

function syncRemotePreferringPending(){
  if(!isUnlocked()){
    loadRemoteNow();
    subscribeRemote();
    return Promise.resolve();
  }
  if(hasPendingSync()){
    if(!navigator.onLine) return Promise.resolve();
    return settlementRef().get().then(function(snapshot){
      return saveMergedRemoteNow(snapshot.exists ? snapshot.data() : {});
    }).then(function(){
      subscribeRemote();
    }).catch(function(){
      setRemoteStatus('네트워크가 불안정합니다. 로컬에만 저장됨');
    });
  }
  loadRemoteNow();
  subscribeRemote();
  return Promise.resolve();
}

function subscribeRemote(){
  if(remote.unsub){
    clearInterval(remote.unsub);
    remote.unsub = null;
  }
  if(!navigator.onLine){
    setRemoteStatus('오프라인: 로컬 데이터 사용 중');
    return;
  }
  setRemoteStatus('공유 저장 연결됨');
  remote.unsub = setInterval(loadRemoteNow, 20000);
  loadRemoteNow();
}

function loadRemoteNow(){
  if(!navigator.onLine){
    setRemoteStatus('오프라인: 로컬 데이터 사용 중');
    renderAll();
    return;
  }
  setRemoteStatus('불러오는 중...');
  settlementRef().get().then(function(snapshot){
    if(!snapshot.exists){
      setRemoteStatus('저장된 데이터가 없어요');
      return;
    }
    applyState(snapshot.data());
    renderAll();
    saveLocalOnly();
    setRemoteStatus('불러오기 완료');
  }).catch(function(){
    setRemoteStatus('불러오기 실패');
  });
}

function saveLocalOnly(){
  try{ localStorage.setItem(getLocalKey(), JSON.stringify(state)); }catch(e){}
}

function save(){
  saveLocalOnly();
  if(!isUnlocked()) showEditNotice('로그인 해주세요! 현재 변경은 이 기기에만 저장돼요.');
  queueRemoteSave();
}

function saveWithPending(mode){
  if(mode === 'all'){
    markAllExpensesPending();
  }else if(typeof mode === 'number'){
    markExpensePending(mode);
  }else if(mode === 'participants'){
    markPendingMeta('participants');
    markAllExpensesPending();
  }else if(mode === 'fxRate'){
    markPendingMeta('fxRate');
    markAllExpensesPending();
  }
  save();
}

function load(){
  try{
    var raw = localStorage.getItem(getLocalKey());
    if(!raw && travelCode === '2610YB') raw = localStorage.getItem(key + '_2610yb');
    if(!raw) return;
    var parsed = JSON.parse(raw);
    if(parsed && typeof parsed === 'object') applyState(parsed);
  }catch(e){}
}

function getParticipants(){
  var names = (state.participants || []).map(function(v){ return String(v).trim(); }).filter(Boolean);
  var seen = {};
  return names.filter(function(n){
    if(seen[n]) return false;
    seen[n] = true;
    return true;
  });
}

function addParticipant(name){
  var clean = String(name || '').trim();
  if(!clean) return false;
  var participants = getParticipants();
  if(participants.indexOf(clean) !== -1) return false;
  participants.push(clean);
  state.participants = participants;
  markPendingMeta('participants');
  return true;
}

function removeParticipant(name){
  var used = state.expenses.some(function(exp){ return (exp.payer || '').trim() === name; });
  if(used) return false;
  state.participants = getParticipants().filter(function(v){ return v !== name; });
  markPendingMeta('participants');
  return true;
}

function expenseToKrw(exp){
  var amount = asNumber(exp.amount);
  return amount * currencyRate(normCurrency(exp.currency));
}

function deleteExpense(idx){
  var target = state.expenses[idx];
  if(target && target.id){
    state.deletedExpenseIds = state.deletedExpenseIds || [];
    if(state.deletedExpenseIds.indexOf(target.id) === -1) state.deletedExpenseIds.push(target.id);
  }
  state.expenses.splice(idx, 1);
  saveWithPending('all');
  renderAll();
}

function bindRowDeleteGesture(row, idx){
  if(!canEditOnline()) return;
  var startX = 0;
  var deltaX = 0;
  var tracking = false;
  var mouseTracking = false;

  row.classList.add('swipe-row');
  row.setAttribute('title', '왼쪽으로 밀거나 우클릭해서 삭제');

  row.addEventListener('contextmenu', function(e){
    if(e.target.closest && e.target.closest('input,button,select,label')) return;
    e.preventDefault();
    if(confirm('삭제하시겠습니까?')){
      deleteExpense(idx);
    }
  });

  row.addEventListener('touchstart', function(e){
    if(!e.touches || e.touches.length !== 1) return;
    if(e.target.closest && e.target.closest('input,button,select,label')) return;
    tracking = true;
    startX = e.touches[0].clientX;
    deltaX = 0;
    row.classList.remove('swipe-armed');
  }, { passive: true });

  row.addEventListener('touchmove', function(e){
    if(!tracking || !e.touches || e.touches.length !== 1) return;
    deltaX = e.touches[0].clientX - startX;
    if(deltaX > 0) deltaX = 0;
    if(deltaX < -80) deltaX = -80;
    row.style.transform = 'translateX(' + deltaX + 'px)';
    row.classList.toggle('swipe-armed', deltaX <= -56);
  }, { passive: true });

  row.addEventListener('touchend', function(){
    if(!tracking) return;
    tracking = false;
    if(deltaX <= -70){
      row.style.transform = '';
      row.classList.remove('swipe-armed');
      if(confirm('삭제하시겠습니까?')){
        deleteExpense(idx);
      }
      return;
    }
    row.style.transform = '';
    row.classList.remove('swipe-armed');
  });

  row.addEventListener('mousedown', function(e){
    if(e.button !== 0) return;
    if(e.target.closest && e.target.closest('input,button,select,label')) return;
    mouseTracking = true;
    startX = e.clientX;
    deltaX = 0;
    row.classList.remove('swipe-armed');
    document.body.style.userSelect = 'none';
  });

  row.addEventListener('mousemove', function(e){
    if(!mouseTracking) return;
    deltaX = e.clientX - startX;
    if(deltaX > 0) deltaX = 0;
    if(deltaX < -80) deltaX = -80;
    row.style.transform = 'translateX(' + deltaX + 'px)';
    row.classList.toggle('swipe-armed', deltaX <= -56);
  });

  function endMouseSwipe(){
    if(!mouseTracking) return;
    mouseTracking = false;
    document.body.style.userSelect = '';
    if(deltaX <= -70){
      row.style.transform = '';
      row.classList.remove('swipe-armed');
      if(confirm('삭제하시겠습니까?')){
        deleteExpense(idx);
      }
      return;
    }
    row.style.transform = '';
    row.classList.remove('swipe-armed');
  }

  row.addEventListener('mouseup', endMouseSwipe);
  row.addEventListener('mouseleave', endMouseSwipe);
}

function renderTable(){
  var body = byId('expenseTable').querySelector('tbody');
  var showKrwOnly = !!uiState.showKrwOnly;
  body.innerHTML = '';
  if(!state.expenses.length){
    body.innerHTML = '<tr><td colspan="4" style="color:var(--mute)">아직 입력된 비용이 없어요.</td></tr>';
    return;
  }
  state.expenses.forEach(function(exp, idx){
    var included = typeof exp.included === 'undefined' ? true : !!exp.included;
    var tr = document.createElement('tr');
    if(exp._pendingSync) tr.className = 'expense-pending';
    var krwText = fmtKrw(expenseToKrw(exp));
    var amountText = showKrwOnly ? krwText : fmtMoney(normCurrency(exp.currency), asNumber(exp.amount));
    var amountClass = showKrwOnly ? 'amount-cell krw-only' : 'amount-cell';
    var amountDetail = '';
    tr.innerHTML = '<td class="payer-cell">' + escapeHtml(exp.payer) + '</td>' +
      '<td>' + escapeHtml(exp.item) + '</td>' +
      '<td class="' + amountClass + '">' + amountText + amountDetail + '</td>' +
      '<td class="include-cell"><input type="checkbox" data-inc="' + idx + '"' + (included ? ' checked' : '') + (canEditOnline() ? '' : ' disabled') + '></td>';
    body.appendChild(tr);
    bindRowDeleteGesture(tr, idx);
  });
  body.querySelectorAll('input[data-inc]').forEach(function(chk){
    chk.addEventListener('change', function(){
      if(!canEditOnline()) return;
      var idx = parseInt(chk.getAttribute('data-inc'), 10);
      state.expenses[idx].included = chk.checked;
      saveWithPending(idx);
      renderTable();
      renderSettlement();
    });
  });
}

function renderParticipants(){
  var wrap = byId('participantList');
  if(!wrap) return;
  var participants = getParticipants();
  wrap.innerHTML = '';
  if(!participants.length){
    wrap.innerHTML = '<span style="color:var(--mute);font-size:11px">참여자가 없어요.</span>';
    return;
  }
  participants.forEach(function(name){
    var chip = document.createElement('span');
    chip.className = 'participant-chip';
    chip.innerHTML = '<span>' + escapeHtml(name) + '</span>' + (canEditOnline() ? '<button type="button" data-remove="' + escapeHtml(name) + '">×</button>' : '');
    wrap.appendChild(chip);
  });
  wrap.querySelectorAll('button[data-remove]').forEach(function(btn){
    btn.addEventListener('click', function(){
      if(!canEditOnline()) return;
      var target = btn.getAttribute('data-remove');
      if(!removeParticipant(target)){
        alert('이미 결제 내역에 사용된 참여자는 삭제할 수 없어요.');
        return;
      }
      saveWithPending('all');
      renderAll();
    });
  });
}

function renderPayerOptions(){
  var select = byId('payerInput');
  var participants = getParticipants();
  var current = select.value;
  select.innerHTML = '';
  if(!participants.length){
    var empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '미등록';
    select.appendChild(empty);
    select.disabled = true;
    return;
  }
  select.disabled = !canEditOnline();
  participants.forEach(function(name){
    var opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });
  if(current && participants.indexOf(current) !== -1){
    select.value = current;
  }
}

function renderSettlement(){
  var summary = byId('summaryContent');
  var transfer = byId('transferContent');
  var participants = getParticipants();
  var paid = {};
  var total = 0;
  var includedCount = 0;

  state.expenses.forEach(function(exp){
    if(exp.included === false) return;
    includedCount += 1;
    var payer = (exp.payer || '').trim();
    var krw = expenseToKrw(exp);
    total += krw;
    if(!paid[payer]) paid[payer] = 0;
    paid[payer] += krw;
    if(payer && participants.indexOf(payer) === -1) participants.push(payer);
  });

  if(!participants.length){
    summary.innerHTML = '참여자를 먼저 입력해 주세요.';
    transfer.innerHTML = '정산할 참여자가 없어요.';
    return;
  }

  if(includedCount === 0){
    summary.innerHTML = '정산에 포함된 항목이 없어요. 표에서 체크해 주세요.';
    transfer.innerHTML = '현재 송금이 필요 없어요.';
    return;
  }

  var perPerson = total / participants.length;
  var lines = ['<table><tr><th>이름</th><th>결제 합계</th><th>미정산 금액</th></tr>'];
  var creditors = [];
  var debtors = [];

  participants.forEach(function(name){
    var paidAmount = paid[name] || 0;
    var balance = paidAmount - perPerson;
    var unsettledText = balance >= 0 ? ('+' + fmtKrw(balance)) : ('-' + fmtKrw(Math.abs(balance)));
    lines.push('<tr><td>' + escapeHtml(name) + '</td><td>' + fmtKrw(paidAmount) + '</td><td>' + unsettledText + '</td></tr>');
    if(balance > 1) creditors.push({name:name, amount:balance});
    if(balance < -1) debtors.push({name:name, amount:-balance});
  });
  lines.push('</table>');
  lines.push('<p class="note" style="margin:8px 0 0">총합 ' + fmtKrw(total) + ' (1인 부담금 ' + fmtKrw(perPerson) + ') </p>');
  summary.innerHTML = lines.join('');

  var moves = [];
  var i = 0;
  var j = 0;
  while(i < debtors.length && j < creditors.length){
    var d = debtors[i];
    var c = creditors[j];
    var amt = Math.min(d.amount, c.amount);
    var firstForeign = (state.currencies || [])[0];
    var foreignHint = firstForeign && firstForeign.rate ? ' (약 ' + fmtMoney(firstForeign.code, amt / firstForeign.rate) + ')' : '';
    moves.push(escapeHtml(d.name) + ' → ' + escapeHtml(c.name) + ' : ' + fmtKrw(amt) + foreignHint);
    d.amount -= amt;
    c.amount -= amt;
    if(d.amount <= 1) i += 1;
    if(c.amount <= 1) j += 1;
  }

  if(!moves.length){
    transfer.innerHTML = '현재 송금이 필요 없어요.';
    return;
  }
  transfer.innerHTML = '<ul><li>' + moves.join('</li><li>') + '</li></ul>';
}

function renderCurrencies(){
  var select = byId('currencyInput');
  if(select){
    var current = select.value;
    select.innerHTML = ['KRW'].concat((state.currencies || []).map(function(c){ return c.code; })).map(function(code){ return '<option value="' + code + '">' + code + '</option>'; }).join('');
    if(current && Array.prototype.some.call(select.options, function(o){ return o.value === current; })) select.value = current;
  }
  var list = byId('currencyList');
  if(!list) return;
  if(!(state.currencies || []).length){
    list.innerHTML = '<span style="color:var(--mute);font-size:11px">외화가 없어요.</span>';
    return;
  }
  list.innerHTML = state.currencies.map(function(c){
    return '<div class="currency-row"><span>1 ' + c.code + ' =</span><input type="number" min="0" step="0.0001" value="' + c.rate + '" data-rate-code="' + c.code + '"><span>KRW</span><button type="button" class="participant-remove" data-del-currency="' + c.code + '" aria-label="' + c.code + ' 삭제">×</button></div>';
  }).join('');
  list.querySelectorAll('[data-rate-code]').forEach(function(input){
    input.addEventListener('change', function(){
      if(!canEditOnline()) return;
      var target = state.currencies.filter(function(c){ return c.code === input.getAttribute('data-rate-code'); })[0];
      if(target) target.rate = asNumber(input.value);
      saveWithPending('fxRate');
      renderAll();
    });
  });
  list.querySelectorAll('[data-del-currency]').forEach(function(btn){
    btn.addEventListener('click', function(){
      if(!canEditOnline()) return;
      var code = btn.getAttribute('data-del-currency');
      if(state.expenses.some(function(exp){ return normCurrency(exp.currency) === code; })){
        alert('이미 결제 내역에 사용된 통화는 삭제할 수 없어요.');
        return;
      }
      state.currencies = state.currencies.filter(function(c){ return c.code !== code; });
      saveWithPending('fxRate');
      renderAll();
    });
  });
}

function renderAll(){
  var participants = getParticipants();
  state.participants = participants;
  renderParticipants();
  renderPayerOptions();
  var canEdit = canEditOnline();
  var expenseForm = document.querySelector('.settle-add');
  if(expenseForm) expenseForm.hidden = !canEdit;
  var settingsButton = byId('openSettingsBtn');
  if(settingsButton) settingsButton.hidden = !canEdit;
  var participantButton = byId('toggleParticipantBtn');
  if(participantButton) participantButton.hidden = !canEdit;
  if(!canEdit){
    var settingsModal = byId('settingsModal');
    if(settingsModal) settingsModal.classList.remove('active');
  }
  renderCurrencies();
  if(byId('unlockBtn')){
    var unlockButton = byId('unlockBtn');
    var unlockIcon = unlockButton.querySelector('img');
    if(unlockIcon) unlockIcon.src = 'icons/user.svg';
    unlockButton.setAttribute('title', '사용자');
    unlockButton.setAttribute('aria-label', '사용자');
  }
  if(byId('toggleKrwViewBtn')){
    byId('toggleKrwViewBtn').textContent = '₩';
    byId('toggleKrwViewBtn').setAttribute('title', uiState.showKrwOnly ? '원래 통화도 보기' : '원화로만 보기');
    byId('toggleKrwViewBtn').setAttribute('aria-label', uiState.showKrwOnly ? '원래 통화도 보기' : '원화로만 보기');
    byId('toggleKrwViewBtn').classList.toggle('active', !!uiState.showKrwOnly);
  }
  renderTable();
  renderSettlement();
}

function bind(){
  var openBtn = byId('openSettlementBtn');
  var closeBtn = byId('closeSettlementBtn');
  var openSettingsBtn = byId('openSettingsBtn');
  var closeSettingsBtn = byId('closeSettingsBtn');
  var unlockBtn = byId('unlockBtn');
  var closeUnlockBtn = byId('closeUnlockBtn');
  var unlockSubmitBtn = byId('unlockSubmitBtn');
  var applyFxBtn = byId('applyFxBtn');
  var toggleKrwViewBtn = byId('toggleKrwViewBtn');
  var logoutBtn = byId('logoutBtn');
  var settingsModal = byId('settingsModal');
  var unlockModal = byId('unlockModal');
  var settlementPage = byId('settlementPage');
  var unlockPinInput = byId('unlockPinInput');
  var unlockError = byId('unlockError');
  var unlockFormSection = byId('unlockFormSection');
  var unlockLoggedInSection = byId('unlockLoggedInSection');

  function setUnlockError(message){
    if(unlockError) unlockError.textContent = message || '';
    if(unlockPinInput) unlockPinInput.style.borderColor = message ? '#c23a3a' : 'var(--line)';
  }

  function renderUnlockModal(){
    var unlocked = isUnlocked();
    if(unlockFormSection) unlockFormSection.hidden = unlocked;
    if(unlockLoggedInSection) unlockLoggedInSection.hidden = !unlocked;
    if(unlockPinInput) unlockPinInput.value = '';
    setUnlockError('');
  }

  function openModalEl(el){
    if(!el) return;
    el.classList.add('active');
    el.setAttribute('aria-hidden', 'false');
  }
  function closeModalEl(el){
    if(!el) return;
    el.classList.remove('active');
    el.setAttribute('aria-hidden', 'true');
  }

  if (openBtn) {
    openBtn.addEventListener('click', openSettlementPage);
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', closeSettlementPage);
  }

  if(openSettingsBtn){
    openSettingsBtn.addEventListener('click', function(){
      renderAll();
      openModalEl(settingsModal);
    });
  }
  if(closeSettingsBtn){
    closeSettingsBtn.addEventListener('click', function(){ closeModalEl(settingsModal); });
  }
  if(unlockBtn){
    unlockBtn.addEventListener('click', function(){
      if(isUnlocked()){
        if(!window.tripSession && !window.confirm('로그아웃 하시겠습니까?')) return;
        if(window.tripSession) window.tripSession.logout(); else lockCurrentCode();
        renderAll();
        setRemoteStatus('');
        if(remote.unsub){ clearInterval(remote.unsub); remote.unsub = null; }
        return;
      }
      renderUnlockModal();
      openModalEl(unlockModal);
    });
  }
  if(closeUnlockBtn){
    closeUnlockBtn.addEventListener('click', function(){ closeModalEl(unlockModal); });
  }
  if(unlockSubmitBtn){
    unlockSubmitBtn.addEventListener('click', function(){
      var pin = unlockPinInput.value;
      if(!window.tripSession){ setUnlockError('로그인 기능을 불러오지 못했습니다.'); return; }
      window.tripSession.login(travelCode, pin).then(function(){
        closeModalEl(unlockModal);
        renderAll();
        setRemoteStatus('로그인됨. 공유 동기화를 시작합니다.');
      }).catch(function(error){ setUnlockError(error.message || '비밀번호를 확인해 주세요.'); });
    });
  }
  if(logoutBtn){
    logoutBtn.addEventListener('click', function(){
      if(!window.tripSession && !window.confirm('로그아웃 하시겠습니까?')) return;
      closeModalEl(unlockModal);
      if(window.tripSession) window.tripSession.logout();
      else lockCurrentCode();
      renderAll(); setRemoteStatus('');
      if(remote.unsub){ clearInterval(remote.unsub); remote.unsub = null; }
    });
  }
  if(applyFxBtn){
    applyFxBtn.addEventListener('click', function(){
      if(!canEditOnline()) return;
      var code = normCurrency(byId('currencyCodeInput').value);
      var rate = asNumber(byId('currencyRateInput').value);
      if(code === 'KRW' || !rate){
        alert('통화 코드(영문 3글자, 예: CNY)와 환율을 입력해 주세요.');
        return;
      }
      var existing = state.currencies.filter(function(c){ return c.code === code; })[0];
      if(existing) existing.rate = rate; else state.currencies.push({code:code, rate:rate});
      byId('currencyRateInput').value = '';
      saveWithPending('fxRate');
      renderAll();
      setRemoteStatus('통화 저장됨');
    });
  }
  if(toggleKrwViewBtn){
    toggleKrwViewBtn.addEventListener('click', function(){
      uiState.showKrwOnly = !uiState.showKrwOnly;
      renderAll();
    });
  }

  if(settlementPage){
    var pullStartY = 0;
    var pullActive = false;
    var pullDone = false;
    var pullPointerId = null;
    var pullThreshold = 76;
    function pullBlocked(target){
      return !!(target && target.closest('input,select,button,textarea,a,label,#expenseTable tbody tr'));
    }
    function startPull(clientY, target){
      if(!settlementPage.classList.contains('active')) return false;
      if(settlementPage.scrollTop > 0) return false;
      if(pullBlocked(target)) return false;
      pullStartY = clientY;
      pullActive = true;
      pullDone = false;
      document.body.style.userSelect = 'none';
      setPullIndicator('새로고침하기', 0, false);
      return true;
    }
    function movePull(clientY){
      if(!pullActive || pullDone) return;
      var delta = clientY - pullStartY;
      if(delta <= 0){
        setPullIndicator('새로고침하기', 0, false);
        return;
      }
      setPullIndicator(delta >= pullThreshold ? '손을 놓아 새로고침' : '새로고침하기', delta, true);
      if(delta > pullThreshold){
        pullDone = true;
        setPullIndicator('새로고침 중...', 52, true);
        syncRemotePreferringPending();
      }
    }
    function endPull(){
      pullActive = false;
      pullPointerId = null;
      document.body.style.userSelect = '';
      setPullIndicator('', 0, false);
    }
    settlementPage.addEventListener('touchstart', function(e){
      if(!e.touches || !e.touches.length) return;
      startPull(e.touches[0].clientY, e.target);
    }, { passive: true });
    settlementPage.addEventListener('touchmove', function(e){
      if(!e.touches || !e.touches.length) return;
      movePull(e.touches[0].clientY);
    }, { passive: true });
    settlementPage.addEventListener('touchend', function(){
      endPull();
    }, { passive: true });

    settlementPage.addEventListener('pointerdown', function(e){
      if(e.pointerType !== 'mouse' || e.button !== 0) return;
      if(!startPull(e.clientY, e.target)) return;
      pullPointerId = e.pointerId;
      settlementPage.setPointerCapture(e.pointerId);
    });
    settlementPage.addEventListener('pointermove', function(e){
      if(e.pointerType !== 'mouse') return;
      if(pullPointerId !== e.pointerId) return;
      movePull(e.clientY);
    });
    settlementPage.addEventListener('pointerup', function(e){
      if(pullPointerId === e.pointerId) endPull();
    });
    settlementPage.addEventListener('pointercancel', function(e){
      if(pullPointerId === e.pointerId) endPull();
    });
  }

  window.addEventListener('click', function(e){
    if(e.target === settingsModal) closeModalEl(settingsModal);
    if(e.target === unlockModal) closeModalEl(unlockModal);
  });

  byId('unlockPinInput').addEventListener('keydown', function(e){
    if(e.key !== 'Enter') return;
    e.preventDefault();
    byId('unlockSubmitBtn').click();
  });
  byId('unlockPinInput').addEventListener('input', function(){
    setUnlockError('');
  });

  var toggleParticipantBtn = byId('toggleParticipantBtn');
  if(toggleParticipantBtn){
    toggleParticipantBtn.addEventListener('click', function(){
      if(!canEditOnline()) return;
      openModalEl(settingsModal);
    });
  }

  byId('addParticipantBtn').addEventListener('click', function(){
    if(!canEditOnline()) return;
    var input = byId('participantInput');
    if(!addParticipant(input.value)){
      alert('참여자 이름을 확인해 주세요. (빈 값/중복 불가)');
      return;
    }
    input.value = '';
    saveWithPending('participants');
    renderAll();
  });

  byId('participantInput').addEventListener('keydown', function(e){
    if(e.key !== 'Enter') return;
    e.preventDefault();
    byId('addParticipantBtn').click();
  });

  ['currencyCodeInput','currencyRateInput'].forEach(function(id){
    byId(id).addEventListener('keydown', function(e){
      if(e.key !== 'Enter') return;
      e.preventDefault();
      byId('applyFxBtn').click();
    });
  });
  byId('currencyCodeInput').addEventListener('input', function(e){
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
  });
  document.querySelectorAll('[data-quick-currency]').forEach(function(btn){
    btn.addEventListener('click', function(){
      byId('currencyCodeInput').value = btn.getAttribute('data-quick-currency');
      byId('currencyRateInput').focus();
    });
  });

  ['payerInput','itemInput','currencyInput','amountInput'].forEach(function(id){
    byId(id).addEventListener('keydown', function(e){
      if(e.key !== 'Enter') return;
      e.preventDefault();
      byId('addExpenseBtn').click();
    });
  });

  byId('addExpenseBtn').addEventListener('click', function(){
    if(!canEditOnline()) return;
    var payer = byId('payerInput').value.trim();
    var item = byId('itemInput').value.trim();
    var currency = normCurrency(byId('currencyInput').value);
    var amount = asNumber(byId('amountInput').value);
    if(!payer || !item || amount <= 0){
      alert('결제자, 항목, 금액을 입력해 주세요.');
      return;
    }
    if(!currencyRate(currency)){
      alert(currency + ' 환율이 설정되지 않았어요. 설정에서 환율을 입력해 주세요.');
      return;
    }
    state.expenses.push({id:createExpenseId(), payer:payer, item:item, currency:currency, amount:amount, included:true});
    byId('itemInput').value = '';
    byId('amountInput').value = '';
    saveWithPending(state.expenses.length - 1);
    renderAll();
  });

  window.addEventListener('online', function(){
    setRemoteStatus('온라인 복구됨. 공유 동기화 재개');
    renderAll();
    subscribeRemote();
    queueRemoteSave();
  });

  window.addEventListener('offline', function(){
    setRemoteStatus('오프라인: 로컬 데이터 사용 중');
    renderAll();
  });

  window.addEventListener('trip:login', function(){
    renderAll();
    syncRemotePreferringPending();
  });
  window.addEventListener('trip:logout', function(){
    lockCurrentCode();
    if(remote.unsub){ clearInterval(remote.unsub); remote.unsub = null; }
    renderAll(); setRemoteStatus('');
  });
  window.addEventListener('trip:activate', function(){
    syncRemotePreferringPending();
  });
  window.addEventListener('trip:leave', function(){
    if(remote.unsub){ clearInterval(remote.unsub); remote.unsub = null; }
  });

  window.addEventListener('settlement:opened', function(){
    syncRemotePreferringPending();
  });
}

load();
initFirebase();
if(byId('expenseTable')){
  bind();
  renderAll();
}
})();
