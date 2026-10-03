const crypto = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');

initializeApp();
setGlobalOptions({ region: 'asia-northeast3', maxInstances: 20 });

const db = getFirestore();
const LOCK_MS = 90 * 1000;
const PIN_WINDOW_MS = 15 * 60 * 1000;
const PIN_MAX_ATTEMPTS = 8;
const MAX_CONTENT_BYTES = 800 * 1024;

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function tripRef(code) {
  return db.collection('trips').doc(code);
}

function requireCode(value) {
  const code = normalizeCode(value);
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    throw new HttpsError('invalid-argument', '여행 코드는 영문 대문자와 숫자 6자리여야 합니다.');
  }
  return code;
}

function requireEditor(request, code) {
  const auth = request.auth;
  if (!auth || auth.token.tripCode !== code || auth.token.tripEditor !== true) {
    throw new HttpsError('permission-denied', '편집 로그인 후 이용해 주세요.');
  }
  return auth.uid;
}

function pinDigest(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 64).toString('hex');
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{128}$/i.test(left || '') || !/^[a-f0-9]{128}$/i.test(right || '')) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function limitRef(code, request) {
  const ip = request.rawRequest && request.rawRequest.ip ? request.rawRequest.ip : 'unknown';
  const key = crypto.createHash('sha256').update(`${code}:${ip}`).digest('hex');
  return db.collection('tripPinAttempts').doc(key);
}

function toJsonSafe(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === 'object') {
    const result = {};
    Object.keys(value).forEach((key) => { result[key] = toJsonSafe(value[key]); });
    return result;
  }
  return value;
}

function freshContent(startDate, endDate) {
  const start = new Date(`${startDate}T12:00:00.000Z`);
  const end = new Date(`${endDate}T12:00:00.000Z`);
  const days = [];
  const checklist = [
    '여권·신분증 챙기기', '유심·eSIM·로밍 확인',
    '충전기와 보조배터리 챙기기', '여행자 보험 확인'
  ].map((text, index) => ({ id: `check-${index + 1}`, text, checked: false }));
  for (let date = new Date(start), index = 0; date <= end && index < 31; date.setUTCDate(date.getUTCDate() + 1), index += 1) {
    days.push({ id: `day-${index + 1}`, order: index + 1, date: date.toISOString().slice(0, 10), title: `${index + 1}일차 일정`, items: [], note: '' });
  }
  return {
    schemaVersion: 1, title: '새 여행', destination: '', startDate, endDate,
    preTrip: { title: '여행 전 준비', checklist, note: '' },
    days, reservations: { tickets: [], hotels: [], transport: [] }, links: [],
    createdAt: new Date().toISOString()
  };
}
exports.createTrip = onCall(async (request) => {
  const code = requireCode(request.data && request.data.code);
  const pin = String(request.data && request.data.pin || '');
  const destination = String(request.data && request.data.destination || '').trim();
  const startDate = String(request.data && request.data.startDate || '');
  const endDate = String(request.data && request.data.endDate || '');
  if (!/^\d{4}$/.test(pin)) throw new HttpsError('invalid-argument', '비밀번호는 숫자 4자리로 입력해 주세요.');
  if (!destination || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
    throw new HttpsError('invalid-argument', '여행지와 올바른 여행 기간을 입력해 주세요.');
  }
  const daysCount = Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1;
  if (daysCount < 1 || daysCount > 31) throw new HttpsError('invalid-argument', '여행 기간은 1일에서 31일 사이로 입력해 주세요.');
  const salt = crypto.randomBytes(16).toString('hex');
  const content = freshContent(startDate, endDate);
  content.destination = destination;
  content.title = destination;
  const ref = tripRef(code);
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) throw new HttpsError('already-exists', '이미 사용 중인 여행코드입니다.');
    tx.create(ref, {
      code,
      pinSalt: salt,
      pinHash: pinDigest(pin, salt),
      content,
      editLock: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  });
  return { code, content };
});

exports.getTrip = onCall(async (request) => {
  const code = requireCode(request.data && request.data.code);
  const snap = await tripRef(code).get();
  if (!snap.exists) throw new HttpsError('not-found', '존재하지 않는 여행 코드예요. 다시 입력해 주세요.');
  const trip = snap.data();
  return { code, content: trip.content || {}, updatedAt: trip.updatedAt && trip.updatedAt.toDate ? trip.updatedAt.toDate().toISOString() : null };
});

exports.loginToTrip = onCall(async (request) => {
  const code = requireCode(request.data && request.data.code);
  const pin = String(request.data && request.data.pin || '');
  const uid = (request.auth && request.auth.uid) || `editor-${crypto.randomUUID()}`;
  if (!/^\d{4}$/.test(pin)) throw new HttpsError('invalid-argument', '비밀번호는 숫자 4자리로 입력해 주세요.');
  const attempts = limitRef(code, request);
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const attemptSnap = await tx.get(attempts);
    const previous = attemptSnap.exists ? attemptSnap.data() : {};
    const withinWindow = previous.windowStart && now - previous.windowStart < PIN_WINDOW_MS;
    const count = withinWindow ? Number(previous.count || 0) : 0;
    if (count >= PIN_MAX_ATTEMPTS) throw new HttpsError('resource-exhausted', '비밀번호 입력 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.');
    tx.set(attempts, {
      count: count + 1,
      windowStart: withinWindow ? previous.windowStart : now,
      updatedAt: FieldValue.serverTimestamp()
    });
  });
  const ref = tripRef(code);
  const snap = await ref.get();
  const trip = snap.exists ? snap.data() : null;
  const matches = !!trip && safeEqualHex(pinDigest(pin, trip.pinSalt), trip.pinHash);
  if (!matches) {
    throw new HttpsError('permission-denied', '여행 코드 또는 비밀번호를 확인해 주세요.');
  }
  await attempts.delete().catch(() => {});
  let token;
  try {
    token = await getAuth().createCustomToken(uid, { tripCode: code, tripEditor: true });
  } catch (error) {
    console.error('createCustomToken failed', error);
    throw new HttpsError('internal', '편집 토큰을 만들지 못했습니다. 서비스 계정 권한(서비스 계정 토큰 생성자)을 확인해 주세요.');
  }
  return { token };
});

exports.acquireTripEditLock = onCall(async (request) => {
  const code = requireCode(request.data && request.data.code);
  const uid = requireEditor(request, code);
  const ref = tripRef(code);
  const now = Date.now();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', '여행을 찾을 수 없습니다.');
    const lock = snap.get('editLock');
    const expiresAt = lock && lock.expiresAt && lock.expiresAt.toMillis ? lock.expiresAt.toMillis() : 0;
    if (lock && expiresAt > now && lock.uid !== uid) {
      throw new HttpsError('aborted', '다른 사람이 편집 중입니다. 잠시 후 다시 시도해 주세요.');
    }
    tx.update(ref, { editLock: { uid, expiresAt: Timestamp.fromMillis(now + LOCK_MS) } });
    return { expiresInMs: LOCK_MS };
  });
});

exports.renewTripEditLock = onCall(async (request) => {
  const code = requireCode(request.data && request.data.code);
  const uid = requireEditor(request, code);
  const ref = tripRef(code);
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const lock = snap.exists ? snap.get('editLock') : null;
    const expiry = lock && lock.expiresAt && lock.expiresAt.toMillis ? lock.expiresAt.toMillis() : 0;
    if (!lock || lock.uid !== uid || expiry <= now) throw new HttpsError('aborted', '편집 시간이 만료되었습니다. 다시 편집 모드에 들어가 주세요.');
    tx.update(ref, { 'editLock.expiresAt': Timestamp.fromMillis(now + LOCK_MS) });
  });
  return { expiresInMs: LOCK_MS };
});

exports.releaseTripEditLock = onCall(async (request) => {
  const code = requireCode(request.data && request.data.code);
  const uid = requireEditor(request, code);
  const ref = tripRef(code);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.get('editLock.uid') === uid) tx.update(ref, { editLock: null });
  });
  return { released: true };
});

exports.saveTrip = onCall(async (request) => {
  const code = requireCode(request.data && request.data.code);
  const uid = requireEditor(request, code);
  const content = request.data && request.data.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) throw new HttpsError('invalid-argument', '여행 데이터 형식이 올바르지 않습니다.');
  if (Buffer.byteLength(JSON.stringify(content), 'utf8') > MAX_CONTENT_BYTES) throw new HttpsError('resource-exhausted', '여행 데이터가 너무 큽니다. 이미지는 파일 저장소를 사용해 주세요.');
  const ref = tripRef(code);
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const lock = snap.exists ? snap.get('editLock') : null;
    const expiry = lock && lock.expiresAt && lock.expiresAt.toMillis ? lock.expiresAt.toMillis() : 0;
    if (!lock || lock.uid !== uid || expiry <= now) throw new HttpsError('aborted', '편집 권한이 만료되었습니다. 변경 내용을 복사한 뒤 다시 편집해 주세요.');
    tx.update(ref, { content, updatedAt: FieldValue.serverTimestamp(), 'editLock.expiresAt': Timestamp.fromMillis(now + LOCK_MS) });
  });
  return { saved: true, updatedAt: new Date().toISOString() };
});

exports.getSettlement = onCall(async (request) => {
  const code = requireCode(request.data && request.data.code);
  const snap = await db.collection('tripSettlements').doc(code.toLowerCase()).get();
  return { data: snap.exists ? toJsonSafe(snap.data()) : null };
});

exports.saveSettlement = onCall(async (request) => {
  const code = requireCode(request.data && request.data.code);
  requireEditor(request, code);
  const payload = request.data && request.data.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new HttpsError('invalid-argument', '정산 데이터 형식이 올바르지 않습니다.');
  const ref = tripRef(code);
  const settlementRef = db.collection('tripSettlements').doc(code.toLowerCase());
  const trip = await ref.get();
  if (!trip.exists) throw new HttpsError('not-found', '여행을 찾을 수 없습니다.');
  await settlementRef.set({
    ...payload,
    travelCode: code,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return { saved: true };
});
