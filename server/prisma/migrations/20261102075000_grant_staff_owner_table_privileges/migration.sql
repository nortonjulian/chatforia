-- Grant narrowly scoped access to the protected staff owner.
-- No unrestricted User UPDATE or FounderOwnership mutation.

GRANT SELECT ON "User"
TO chatforia_staff_owner;

GRANT SELECT ON "FounderOwnership"
TO chatforia_staff_owner;

GRANT UPDATE ("tokenVersion")
ON "User"
TO chatforia_staff_owner;

GRANT SELECT, INSERT, UPDATE
ON "StaffAssignment"
TO chatforia_staff_owner;

GRANT INSERT
ON "StaffAccessEvent"
TO chatforia_staff_owner;

GRANT INSERT
ON "AuditLog"
TO chatforia_staff_owner;

GRANT USAGE, SELECT
ON SEQUENCE
  "StaffAssignment_id_seq",
  "StaffAccessEvent_id_seq",
  "AuditLog_id_seq"
TO chatforia_staff_owner;
