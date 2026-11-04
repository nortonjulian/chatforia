-- Install cryptographic functions in the protected schema.
-- The migration executor must have the required database privileges.

CREATE EXTENSION IF NOT EXISTS pgcrypto
WITH SCHEMA staff_security;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA staff_security
FROM PUBLIC, chatforia_dev;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA staff_security
TO chatforia_staff_owner;
