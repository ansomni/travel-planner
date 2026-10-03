# 여행 일정 앱

## 앱 구조

- `index.html`: 여행 선택 화면, 일정 화면, 정산 화면
- `css/app.css`: 앱 스타일
- `js/trip-session.js`: 여행 생성·조회, 기기별 로그인 상태, 편집·이미지 업로드
- `js/app.js`: 정산 화면과 계산·표시
- `js/tabs.js`: 일정 탭 키보드 이동
- `firestore.rules`, `storage.rules`: 가족·친구용 공개 접근 규칙
- `백두산 일정표.html`: 기존 일정 원본 백업 및 일정 가져오기 소스

## 데이터 저장

여행은 `trips/{여행코드}`에, 정산은 `tripSettlements/{여행코드}`에 저장합니다. 사진 파일은 Firebase Storage의 `trip-files/{여행코드}/...`에 저장하고, 여행 문서에는 사진 URL과 경로만 기록합니다. 브라우저에서 여행 데이터를 한 번 불러오면 코드별 `localStorage` 캐시도 남겨 오프라인 조회에 사용합니다. 오프라인 수정은 임시 보관되며, 서버 저장은 연결 복구 후 온라인에서 직접 다시 저장해야 합니다.

## 로그인 동작과 접근 범위

PIN은 브라우저가 DB에서 읽어와 비교하고, 로그인 성공 표시는 해당 기기의 `localStorage`에 기록합니다. 로그아웃하면 그 표시를 지웁니다. Node.js, Firebase CLI, Cloud Functions는 사용하지 않습니다.

이 모드는 가족·친구끼리만 쓰는 간편 모드입니다. Firestore 규칙상 여행 코드를 아는 누구나 여행 문서와 PIN을 읽고 수정할 수 있고, PIN 확인은 앱 화면의 편의 기능입니다. 사진도 공개 접근 규칙을 사용합니다. 코드는 공유할 사람에게만 알려주세요. 이 데이터에 민감한 정보를 저장하지 마세요.

## Firebase 설정과 배포

Firebase 프로젝트 `travel-settlement-f3949`가 `.firebaserc`에 설정되어 있습니다. Firebase 콘솔에서 Firestore Database와 Storage를 활성화하고, 웹 앱 설정을 `js/trip-session.js`, `js/app.js`의 Firebase 설정과 맞춰주세요. Storage가 프로젝트에서 활성화되지 않았다면 콘솔에서 버킷을 준비해야 합니다.

Firebase CLI로 다음 규칙만 배포하면 됩니다. Functions 배포와 Node.js 설치는 필요하지 않습니다.

```powershell
firebase deploy --only firestore:rules,storage
```

GitHub Pages에는 `index.html`, `css/`, `js/` 및 일정 가져오기에 필요한 `백두산 일정표.html`을 배포합니다. 백업 HTML은 공개 URL로 열릴 수 있으니 기존 일정 가져오기를 마친 뒤 배포 산출물에서 제외하는 것을 권합니다. 앱은 HTTPS 또는 로컬 HTTP에서 실행해야 하며 `file://` 실행은 지원하지 않습니다.

Firebase 규칙은 로컬 파일에만 반영되어 있고 실제 프로젝트에는 아직 배포되지 않았습니다. GitHub Pages의 PWA manifest와 service worker 설정도 별도 작업입니다.
