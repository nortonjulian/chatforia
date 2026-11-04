-- Remove unnecessary application access to staff sequences.
-- Protected security-owner operations retain sequence access.

REVOKE ALL ON SEQUENCE
  public."StaffAssignment_id_seq",
  public."StaffAccessEvent_id_seq"
FROM chatforia_dev;

DO $verify$
BEGIN
  IF has_sequence_privilege(
    'chatforia_dev',
    'public."StaffAssignment_id_seq"',
    'USAGE'
  ) OR has_sequence_privilege(
    'chatforia_dev',
    'public."StaffAccessEvent_id_seq"',
    'USAGE'
  ) THEN
    RAISE EXCEPTION 'Application retains staff sequence access';
  END IF;

  IF NOT has_sequence_privilege(
    'chatforia_staff_owner',
    'public."StaffAssignment_id_seq"',
    'USAGE'
  ) OR NOT has_sequence_privilege(
    'chatforia_staff_owner',
    'public."StaffAccessEvent_id_seq"',
    'USAGE'
  ) THEN
    RAISE EXCEPTION 'Protected owner lost sequence access';
  END IF;

  RAISE NOTICE 'PASS: Staff sequence permissions restricted';
  RAISE NOTICE 'PASS: Security owner sequence access retained';
END;
$verify$;
