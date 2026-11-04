-- Restrict assertion consumption to protected mutation functions.
-- The application must not consume assertions independently.

REVOKE ALL ON FUNCTION
staff_security.consume_staff_assertion(TEXT)
FROM PUBLIC, chatforia_dev;

-- The verifier is an internal implementation detail.
REVOKE ALL ON FUNCTION
staff_security.verify_staff_assertion(TEXT)
FROM PUBLIC, chatforia_dev;

-- Restrict the security owner to the cryptographic
-- primitive required by the verifier.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA staff_security
FROM chatforia_staff_owner;

GRANT EXECUTE ON FUNCTION
staff_security.hmac(BYTEA, BYTEA, TEXT)
TO chatforia_staff_owner;

GRANT EXECUTE ON FUNCTION
staff_security.signature_matches(BYTEA, BYTEA)
TO chatforia_staff_owner;

GRANT EXECUTE ON FUNCTION
staff_security.verify_staff_assertion(TEXT)
TO chatforia_staff_owner;

GRANT EXECUTE ON FUNCTION
staff_security.consume_staff_assertion(TEXT)
TO chatforia_staff_owner;
