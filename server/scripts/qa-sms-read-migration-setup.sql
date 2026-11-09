-- Run only in a newly created disposable local PostgreSQL database.
CREATE TABLE "SmsThread" (
  id integer PRIMARY KEY,
  "lastReadAt" timestamp(3)
);
CREATE TABLE "SmsMessage" (
  id integer PRIMARY KEY,
  "threadId" integer NOT NULL REFERENCES "SmsThread"(id),
  direction text NOT NULL,
  "createdAt" timestamp(3) NOT NULL
);
INSERT INTO "SmsThread"(id,"lastReadAt") VALUES
  (67,'2026-11-09 12:00:00.000'),
  (68,NULL);
INSERT INTO "SmsMessage"(id,"threadId",direction,"createdAt") VALUES
  (500,67,'in','2026-11-09 11:59:59.000'),
  (501,67,'in','2026-11-09 12:00:00.000'),
  (502,67,'in','2026-11-09 12:00:01.000'),
  (503,67,'out','2026-11-09 11:59:59.000'),
  (600,68,'in','2026-11-09 11:59:59.000');
