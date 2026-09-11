# PillMate

그룹 기반 상호 검증형 복약 케어 웹앱입니다. 가족이나 돌봄 그룹이 함께 복약 일정을 관리하고, 대상자가 복약을 완료하면 그룹 피드에 자동으로 공유되며, 정해진 시간 안에 확인되지 않으면 그룹에 경고가 전달됩니다.

## 주요 기능

- 가족/돌봄 그룹 생성 및 초대 코드 참여
- 그룹 소유자 기반 권한 관리
- 구성원별 개별 복약 스케줄 등록
- 오늘의 복약 카드와 원터치 완료
- 사진 업로드 기반 복약 인증
- Socket.io 기반 실시간 가족 대화방
- 복약 완료 시스템 피드 자동 생성
- 미복용 에스컬레이션 알림
- 선택적 Web Push 알림
- 모바일 하단 탭 및 데스크톱 2열 반응형 UI

## 기술 스택

- Language: TypeScript
- Backend: Node.js, Express, Socket.io, Multer, node-cron
- Database: SQLite
- Frontend: React, Vite, Tailwind CSS, Socket.io Client, Lucide React
- Notification: Web Push API, Service Worker

현재 서버는 Node.js 24 이상의 내장 `node:sqlite` 모듈을 사용합니다.

## 프로젝트 구조

```text
apps/
  server/                 Express, Socket.io, SQLite API 서버
    src/
      db/                 SQLite 연결, 스키마, 마이그레이션
      http/               에러 핸들러와 요청 타입
      middleware/         개발용 인증 및 그룹 권한 미들웨어
      routes/             REST API 라우터
      services/           피드, 푸시, 복약 스케줄러
      utils/              날짜, 초대 코드, 비밀번호, 검증 유틸
      index.ts            서버 진입점
  web/                    React/Vite 웹앱
    public/               PWA manifest, service worker, 아이콘
    src/                  화면, API 클라이언트, Socket.io 클라이언트
data/                     로컬 SQLite DB 파일
uploads/                  사진 인증 업로드 파일
```

## 실행 방법

의존성을 설치합니다.

```bash
pnpm install
```

SQLite 테이블 생성/갱신, API 서버 실행, 웹앱 실행을 한 번에 처리합니다.

```bash
pnpm dev
```

실행 후 아래 주소로 접속합니다.

```text
웹앱: http://localhost:5173
API 서버: http://localhost:4000
```

필요하면 각 작업을 따로 실행할 수도 있습니다.

SQLite 테이블만 생성하거나 갱신합니다.

```bash
pnpm db:init
```

API 서버를 실행합니다.

```bash
pnpm dev:server
```

서버 기본 주소는 `http://localhost:4000`입니다.

웹앱을 실행합니다.

```bash
pnpm dev:web
```

웹앱 기본 주소는 `http://localhost:5173`입니다.

## 환경 변수

서버 환경 변수 예시는 `apps/server/.env.example`에 있습니다.

```text
PORT=4000
DATABASE_URL=../../data/pillmate.sqlite
CORS_ORIGIN=http://localhost:5173
ESCALATION_MINUTES=30
VAPID_SUBJECT=mailto:admin@example.com
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
```

`VAPID_PUBLIC_KEY`와 `VAPID_PRIVATE_KEY`가 없으면 실제 브라우저 푸시는 전송되지 않습니다. 이 경우에도 Socket.io 실시간 이벤트와 그룹 피드는 정상 동작합니다.

## 개발용 인증 방식

현재 MVP는 빠른 개발과 테스트를 위해 `x-user-id` 헤더로 인증 사용자를 지정합니다.

먼저 사용자를 생성한 뒤, 응답으로 받은 `user.id`를 인증이 필요한 API 요청의 `x-user-id` 헤더에 넣으면 됩니다. 실제 서비스 단계에서는 JWT 또는 세션 기반 로그인으로 교체하는 것을 권장합니다.

## 구현된 API

사용자:

```text
POST   /api/users
GET    /api/me
POST   /api/me/push-subscription
DELETE /api/me/push-subscription
```

그룹:

```text
GET    /api/groups
POST   /api/groups
POST   /api/groups/join
GET    /api/groups/:groupId/members
PATCH  /api/groups/:groupId/members/:memberId/permissions
```

복약 스케줄:

```text
GET    /api/groups/:groupId/schedules
GET    /api/groups/:groupId/schedules/today
POST   /api/groups/:groupId/schedules
PATCH  /api/groups/:groupId/schedules/:scheduleId
DELETE /api/groups/:groupId/schedules/:scheduleId
```

복약 완료 및 대화:

```text
POST   /api/schedules/:scheduleId/complete
GET    /api/groups/:groupId/messages
POST   /api/groups/:groupId/messages
```

개발용 스케줄러 실행:

```text
POST   /api/scheduler/tick
```

## 권한 규칙

- 그룹 생성자는 `OWNER`가 됩니다.
- `OWNER`는 항상 스케줄 편집 권한을 가집니다.
- `OWNER`는 구성원의 `can_edit_schedule` 권한을 부여하거나 회수할 수 있습니다.
- 스케줄 생성, 수정, 삭제는 `OWNER` 또는 `can_edit_schedule = 1`인 구성원만 가능합니다.
- 복약 완료 처리는 해당 스케줄의 대상자 본인만 할 수 있습니다.

## 실시간 이벤트

클라이언트는 Socket.io 연결 후 아래 이벤트로 방에 참여합니다.

```text
user:join   user:{userId} 개인 방 참여
group:join  group:{groupId} 그룹 방 참여
```

서버에서 전달하는 이벤트는 다음과 같습니다.

```text
intake:due         정시 복약 알림
intake:completed   복약 완료 알림
intake:escalated   미복용 에스컬레이션 경고
chat:message       가족 대화방 메시지 또는 시스템 피드
```

## 스케줄러 동작

서버는 `node-cron`으로 1분마다 복약 스케줄을 확인합니다.

1. 현재 요일과 현재 시각에 해당하는 활성 스케줄을 찾습니다.
2. 해당 복약 건의 `PENDING` 로그를 생성합니다.
3. 대상자 개인 방으로 `intake:due` 이벤트를 전송합니다.
4. `ESCALATION_MINUTES`가 지나도 완료되지 않은 로그를 찾습니다.
5. 그룹 방에 `intake:escalated` 이벤트와 경고 시스템 피드를 전송합니다.

## 웹앱 화면

- 온보딩: 개발용 사용자 생성
- 그룹 설정: 가족 링 생성 또는 초대 코드 참여
- 오늘: 당일 복약 카드, 원터치 완료, 사진 인증
- 가족 대화방: 텍스트 메시지와 복약 인증 시스템 피드
- 스케줄 관리: 권한자용 복약 일정 생성 및 구성원 권한 관리

모바일에서는 하단 탭으로 `오늘`, `대화`, `관리` 화면을 전환합니다. 데스크톱에서는 복약 대시보드와 대화방을 2열로 함께 보여줍니다.

## 빌드 확인

서버 타입 체크:

```bash
pnpm --filter @pillmate/server build
```

웹앱 production build:

```bash
pnpm --filter @pillmate/web build
```

## 다음 개선 과제

- JWT 또는 세션 기반 로그인 구현
- 프론트엔드 Web Push 권한 요청 및 구독 등록 UI
- 스케줄 수정/삭제 UI 고도화
- 채팅 메시지 이모지 반응 기능
- API 통합 테스트와 데모 시드 데이터 추가
