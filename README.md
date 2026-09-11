# PillMate

PillMate is a group-based medication care web app for families and care groups.

## Project Structure

```text
apps/
  server/                 Express, Socket.io, SQLite API server
    src/
      db/                 SQLite connection and schema initialization
      index.ts            Server entry point
data/                     Local SQLite database files
uploads/                  Future Multer upload target
```

## Step 1: SQLite Server Setup

This project currently targets Node.js 24+ because the server uses the built-in
`node:sqlite` module.

Install dependencies:

```bash
pnpm install
```

Create the SQLite tables:

```bash
pnpm db:init
```

Start the API server:

```bash
pnpm dev:server
```

The server defaults to `http://localhost:4000`.

## Step 2: Backend API

During early development, authenticated API calls use an `x-user-id` request
header. Create a user first, then pass that user's `id` in the header.

Implemented endpoints:

```text
POST   /api/users
GET    /api/me

POST   /api/groups
POST   /api/groups/join
GET    /api/groups/:groupId/members
PATCH  /api/groups/:groupId/members/:memberId/permissions

GET    /api/groups/:groupId/schedules
GET    /api/groups/:groupId/schedules/today
POST   /api/groups/:groupId/schedules
PATCH  /api/groups/:groupId/schedules/:scheduleId
DELETE /api/groups/:groupId/schedules/:scheduleId

POST   /api/schedules/:scheduleId/complete
GET    /api/groups/:groupId/messages
POST   /api/groups/:groupId/messages
```

Schedule writes require group owner access or `can_edit_schedule = 1`.
Medication completion is restricted to the schedule's target user. Photo
verification is accepted as multipart form data with the `photo` file field.

## Step 3: Scheduler, Realtime, and Push

The server starts a `node-cron` job every minute. It creates pending intake logs
for due schedules, sends a personal `intake:due` Socket.io event to
`user:{targetUserId}`, and escalates still-pending logs after
`ESCALATION_MINUTES`.

Socket.io rooms:

```text
user:join   joins user:{userId}
group:join  joins group:{groupId}
```

Realtime events:

```text
intake:due
intake:completed
intake:escalated
chat:message
```

Web Push is optional. Store a browser subscription with:

```text
POST   /api/me/push-subscription
DELETE /api/me/push-subscription
```

Set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` to enable actual browser push
delivery. Without VAPID keys, realtime Socket.io events and feed messages still
work normally.

For development, an authenticated user can manually run one scheduler pass:

```text
POST /api/scheduler/tick
```
