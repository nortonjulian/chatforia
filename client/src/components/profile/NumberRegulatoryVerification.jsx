import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Loader,
  Radio,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCircleCheck,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import axiosClient from '@/api/axiosClient';

function getRequiredEndUserFields(requirements) {
  const entries = Array.isArray(requirements?.end_user)
    ? requirements.end_user
    : [];

  const fields = [];

  for (const entry of entries) {
    if (!Array.isArray(entry?.fields)) continue;

    for (const field of entry.fields) {
      const name = String(field || '').trim();

      if (name && !fields.includes(name)) {
        fields.push(name);
      }
    }
  }

  return fields;
}

function fieldLabel(field) {
  return String(field || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getSupportingDocumentGroups(requirements) {
  const groups = Array.isArray(requirements?.supporting_document)
    ? requirements.supporting_document
    : [];

  return groups
    .map((group) => {
      const entries = Array.isArray(group) ? group : [group];

      return entries
        .filter(
          (entry) =>
            entry &&
            typeof entry === 'object' &&
            String(entry.requirement_name || '').trim()
        )
        .map((entry) => ({
          requirementName: String(entry.requirement_name).trim(),
          type: String(entry.type || '').trim(),
          acceptedDocuments: Array.isArray(entry.accepted_documents)
            ? entry.accepted_documents
                .filter(
                  (document) =>
                    document &&
                    typeof document === 'object' &&
                    String(document.type || '').trim()
                )
                .map((document) => ({
                  name: String(document.name || document.type).trim(),
                  type: String(document.type).trim(),
                }))
            : [],
        }));
    })
    .filter((group) => group.length > 0);
}

export default function NumberRegulatoryVerification({
  e164,
  initialDecision,
  initialResponse,
  onBack,
  onApproved,
}) {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [submittingIdentity, setSubmittingIdentity] = useState(false);
  const [requirements, setRequirements] = useState(null);
  const [attributes, setAttributes] = useState({});
  const [missingFields, setMissingFields] = useState([]);
  const [error, setError] = useState('');
  const [identityReady, setIdentityReady] = useState(false);
  const [documentSelections, setDocumentSelections] = useState({});
  const [documentFieldRequirements, setDocumentFieldRequirements] = useState({});
  const [documentAttributes, setDocumentAttributes] = useState({});
  const [loadingDocumentRequirement, setLoadingDocumentRequirement] = useState('');
  const [documentFiles, setDocumentFiles] = useState({});
  const [uploadingDocument, setUploadingDocument] = useState('');
  const [completedDocuments, setCompletedDocuments] = useState({});
  const [bundleEmail, setBundleEmail] = useState('');
  const [submittingBundle, setSubmittingBundle] = useState(false);
  const [reviewPending, setReviewPending] = useState(
    initialDecision === 'VERIFICATION_PENDING'
  );
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [reviewRejected, setReviewRejected] = useState(
    initialDecision === 'VERIFICATION_REJECTED'
  );

  const rejected = initialDecision === 'VERIFICATION_REJECTED';

  const requiredFields = useMemo(
    () => getRequiredEndUserFields(requirements),
    [requirements]
  );

  const supportingDocumentGroups = useMemo(
    () => getSupportingDocumentGroups(requirements),
    [requirements]
  );

  const requiredDocumentNames = useMemo(
    () =>
      supportingDocumentGroups
        .flat()
        .map((requirement) => requirement.requirementName)
        .filter(Boolean),
    [supportingDocumentGroups]
  );

  const documentsReady =
    requiredDocumentNames.length === 0 ||
    requiredDocumentNames.every(
      (requirementName) => completedDocuments[requirementName]
    );

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      setLoading(true);
      setError('');

      try {
        const { data } = await axiosClient.post(
          '/numbers/regulatory/initialize',
          { e164 }
        );

        if (cancelled) return;

        setRequirements(data?.requirements || null);
        if (data?.profile?.endUserSid) {
          setIdentityReady(true);
        }
      } catch (e) {
        if (cancelled) return;

        setError(
          e?.response?.data?.error ||
            e?.response?.data?.reason ||
            t(
              'phoneNumberManager.regulatoryInitializationFailed',
              'Could not load the verification requirements.'
            )
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    initialize();

    return () => {
      cancelled = true;
    };
  }, [e164]);

  const selectDocumentType = async (requirementName, documentType) => {
    setDocumentSelections((current) => ({
      ...current,
      [requirementName]: documentType,
    }));

    setDocumentFieldRequirements((current) => {
      const next = { ...current };
      delete next[requirementName];
      return next;
    });

    setDocumentAttributes((current) => ({
      ...current,
      [requirementName]: {},
    }));

    setDocumentFiles((current) => {
      const next = { ...current };
      delete next[requirementName];
      return next;
    });

    setCompletedDocuments((current) => {
      const next = { ...current };
      delete next[requirementName];
      return next;
    });

    setLoadingDocumentRequirement(requirementName);
    setError('');

    try {
      const { data } = await axiosClient.post(
        '/numbers/regulatory/document-requirements',
        {
          e164,
          requirementName,
          documentType,
        }
      );

      if (!data?.resolved) {
        setError(
          data?.reason ||
            t(
              'phoneNumberManager.regulatoryDocumentRequirementsFailed',
              'Could not load the document requirements.'
            )
        );
        return;
      }

      setDocumentFieldRequirements((current) => ({
        ...current,
        [requirementName]: Array.isArray(data?.requiredFields)
          ? data.requiredFields
          : [],
      }));
    } catch (e) {
      const data = e?.response?.data || {};

      setError(
        data?.error ||
          data?.reason ||
          t(
            'phoneNumberManager.regulatoryDocumentRequirementsFailed',
            'Could not load the document requirements.'
          )
      );
    } finally {
      setLoadingDocumentRequirement((current) =>
        current === requirementName ? '' : current
      );
    }
  };

  const uploadDocument = async (requirementName) => {
    const documentType = documentSelections[requirementName];
    const file = documentFiles[requirementName];
    const requiredDocumentFields =
      documentFieldRequirements[requirementName] || [];
    const submittedAttributes =
      documentAttributes[requirementName] || {};

    if (!documentType || !file) {
      setError(
        t(
          'phoneNumberManager.regulatoryDocumentFileRequired',
          'Choose a document file before uploading.'
        )
      );
      return;
    }

    const missingDocumentFields = requiredDocumentFields.filter(
      (field) => !String(submittedAttributes[field] || '').trim()
    );

    if (missingDocumentFields.length > 0) {
      setError(
        t(
          'phoneNumberManager.regulatoryDocumentFieldsRequired',
          'Complete all required document fields before uploading.'
        )
      );
      return;
    }

    setUploadingDocument(requirementName);
    setError('');

    try {
      const formData = new FormData();

      formData.append('e164', e164);
      formData.append('requirementName', requirementName);
      formData.append('documentType', documentType);
      formData.append(
        'attributes',
        JSON.stringify(submittedAttributes)
      );
      formData.append('file', file);

      const { data } = await axiosClient.post(
        '/numbers/regulatory/documents',
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      if (!data?.provisioned && !data?.reused) {
        setError(
          data?.reason ||
            t(
              'phoneNumberManager.regulatoryDocumentUploadFailed',
              'Could not upload the regulatory document.'
            )
        );
        return;
      }

      setCompletedDocuments((current) => ({
        ...current,
        [requirementName]: true,
      }));
    } catch (e) {
      const data = e?.response?.data || {};

      setError(
        data?.error ||
          data?.reason ||
          t(
            'phoneNumberManager.regulatoryDocumentUploadFailed',
            'Could not upload the regulatory document.'
          )
      );
    } finally {
      setUploadingDocument((current) =>
        current === requirementName ? '' : current
      );
    }
  };

  const checkRegulatoryStatus = async () => {
    setCheckingStatus(true);
    setError('');

    try {
      const { data } = await axiosClient.post(
        '/numbers/regulatory/status',
        {
          e164,
        }
      );

      const decision = String(data?.decision || '').trim();

      if (decision === 'APPROVED' && data?.allowed) {
        setReviewPending(false);
        setReviewRejected(false);
        await onApproved?.();
        return;
      }

      if (decision === 'VERIFICATION_REJECTED') {
        setReviewPending(false);
        setReviewRejected(true);
        setError(
          data?.profile?.rejectionReason ||
            t(
              'phoneNumberManager.regulatoryReviewRejected',
              'The regulatory application was rejected. Review the requirements and submit corrected information.'
            )
        );
        return;
      }

      if (decision === 'VERIFICATION_PENDING') {
        setReviewPending(true);
        setReviewRejected(false);
        return;
      }

      if (
        decision === 'VERIFICATION_REQUIRED' &&
        data?.requiresVerification
      ) {
        setReviewPending(false);
        setReviewRejected(true);
        setError(
          t(
            'phoneNumberManager.regulatoryVerificationRequiredAgain',
            'Additional regulatory verification is required.'
          )
        );
        return;
      }

      setError(
        data?.error ||
          decision ||
          t(
            'phoneNumberManager.regulatoryStatusFailed',
            'Could not confirm the regulatory status.'
          )
      );
    } catch (e) {
      const data = e?.response?.data || {};

      setError(
        data?.error ||
          data?.reason ||
          t(
            'phoneNumberManager.regulatoryStatusFailed',
            'Could not confirm the regulatory status.'
          )
      );
    } finally {
      setCheckingStatus(false);
    }
  };

  const assembleAndSubmitBundle = async () => {
    const email = bundleEmail.trim();

    if (!email) {
      setError(
        t(
          'phoneNumberManager.regulatoryEmailRequired',
          'Email is required.'
        )
      );
      return;
    }

    if (!documentsReady) {
      setError(
        t(
          'phoneNumberManager.regulatoryDocumentsIncomplete',
          'Upload all required documents before submitting.'
        )
      );
      return;
    }

    setSubmittingBundle(true);
    setError('');

    try {
      const { data: assembly } = await axiosClient.post(
        '/numbers/regulatory/assemble',
        {
          e164,
          email,
        }
      );

      if (!assembly?.assembled) {
        setError(
          assembly?.reason ||
            t(
              'phoneNumberManager.regulatoryAssemblyFailed',
              'Could not assemble the regulatory application.'
            )
        );
        return;
      }

      const { data: submission } = await axiosClient.post(
        '/numbers/regulatory/submit',
        {
          e164,
        }
      );

      if (!submission?.submitted) {
        setError(
          submission?.reason ||
            t(
              'phoneNumberManager.regulatorySubmissionFailed',
              'Could not submit the regulatory application.'
            )
        );
        return;
      }

      setReviewPending(true);
      setReviewRejected(false);
    } catch (e) {
      const data = e?.response?.data || {};

      setError(
        data?.error ||
          data?.reason ||
          t(
            'phoneNumberManager.regulatorySubmissionFailed',
            'Could not submit the regulatory application.'
          )
      );
    } finally {
      setSubmittingBundle(false);
    }
  };

  const submitIdentity = async () => {
    setSubmittingIdentity(true);
    setError('');
    setMissingFields([]);

    try {
      const { data } = await axiosClient.post(
        '/numbers/regulatory/initialize',
        {
          e164,
          endUserAttributes: attributes,
        }
      );

      setRequirements(data?.requirements || requirements);
      if (data?.profile?.endUserSid) {
        setIdentityReady(true);
      }
    } catch (e) {
      const data = e?.response?.data || {};

      if (data?.reason === 'missing-end-user-fields') {
        setMissingFields(
          Array.isArray(data?.validation?.missingFields)
            ? data.validation.missingFields
            : []
        );

        setError(
          t(
            'phoneNumberManager.regulatoryMissingFields',
            'Complete all required verification fields.'
          )
        );
        return;
      }

      setError(
        data?.error ||
          data?.reason ||
          t(
            'phoneNumberManager.regulatoryIdentityFailed',
            'Could not save the verification information.'
          )
      );
    } finally {
      setSubmittingIdentity(false);
    }
  };

  return (
    <Stack gap="md">
      <div>
        <Title order={4}>
          {t(
            'phoneNumberManager.regulatoryVerificationHeading',
            'Identity verification required'
          )}
        </Title>

        <Text size="sm" c="dimmed">
          {t(
            'phoneNumberManager.regulatoryVerificationDescription',
            'Local regulations require additional information before this number can be assigned.'
          )}
        </Text>
      </div>

      <Text fw={600}>{e164}</Text>

      {rejected && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />}>
          {initialResponse?.rejectionReason ||
            t(
              'phoneNumberManager.regulatoryVerificationRejected',
              'The previous verification was not approved. Review the requirements and submit updated information.'
            )}
        </Alert>
      )}

      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Group justify="center" py="md">
          <Loader />
        </Group>
      ) : identityReady ? (
        <Stack gap="md">
          <Alert color="green" icon={<IconCircleCheck size={16} />}>
            {t(
              'phoneNumberManager.regulatoryIdentityReady',
              'Identity information is ready.'
            )}
          </Alert>

          {supportingDocumentGroups.length > 0 ? (
            <Stack gap="lg">
              <div>
                <Title order={5}>
                  {t(
                    'phoneNumberManager.regulatoryDocumentsHeading',
                    'Required documents'
                  )}
                </Title>
                <Text size="sm" c="dimmed">
                  {t(
                    'phoneNumberManager.regulatoryDocumentsDescription',
                    'Choose an accepted document for each requirement.'
                  )}
                </Text>
              </div>

              {supportingDocumentGroups.map((group, groupIndex) => (
                <Stack key={`document-group-${groupIndex}`} gap="sm">
                  {group.map((requirement) => (
                    <Radio.Group
                      key={requirement.requirementName}
                      label={fieldLabel(requirement.requirementName)}
                      value={
                        documentSelections[requirement.requirementName] || ''
                      }
                      onChange={(documentType) => {
                        selectDocumentType(
                          requirement.requirementName,
                          documentType
                        );
                      }}
                    >
                      <Stack gap="xs" mt="xs">
                        {requirement.acceptedDocuments.map((document) => (
                          <Radio
                            key={`${requirement.requirementName}-${document.type}`}
                            value={document.type}
                            label={document.name}
                          />
                        ))}
                      </Stack>

                      {loadingDocumentRequirement ===
                        requirement.requirementName && (
                        <Group mt="sm">
                          <Loader size="sm" />
                          <Text size="sm" c="dimmed">
                            {t(
                              'phoneNumberManager.regulatoryLoadingDocumentRequirements',
                              'Loading document requirements...'
                            )}
                          </Text>
                        </Group>
                      )}

                      {documentSelections[requirement.requirementName] &&
                        Object.prototype.hasOwnProperty.call(
                          documentFieldRequirements,
                          requirement.requirementName
                        ) && (
                          <Stack gap="xs" mt="sm">
                            {documentFieldRequirements[
                              requirement.requirementName
                            ].map((field) => (
                              <TextInput
                                key={`${requirement.requirementName}-${field}`}
                                label={fieldLabel(field)}
                                value={
                                  documentAttributes[
                                    requirement.requirementName
                                  ]?.[field] || ''
                                }
                                required
                                onChange={(event) => {
                                  const value = event.currentTarget.value;

                                  setDocumentAttributes((current) => ({
                                    ...current,
                                    [requirement.requirementName]: {
                                      ...(current[
                                        requirement.requirementName
                                      ] || {}),
                                      [field]: value,
                                    },
                                  }));
                                }}
                              />
                            ))}

                            {documentFieldRequirements[
                              requirement.requirementName
                            ].length === 0 && (
                              <Text size="sm" c="dimmed">
                                {t(
                                  'phoneNumberManager.regulatoryNoDocumentFields',
                                  'No additional document fields are required.'
                                )}
                              </Text>
                            )}

                            <input
                              type="file"
                              aria-label={`${fieldLabel(
                                requirement.requirementName
                              )} file`}
                              accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                              onChange={(event) => {
                                const file =
                                  event.currentTarget.files?.[0] || null;

                                setDocumentFiles((current) => ({
                                  ...current,
                                  [requirement.requirementName]: file,
                                }));

                                setCompletedDocuments((current) => {
                                  const next = { ...current };
                                  delete next[requirement.requirementName];
                                  return next;
                                });
                              }}
                            />

                            {completedDocuments[
                              requirement.requirementName
                            ] ? (
                              <Alert
                                color="green"
                                icon={<IconCircleCheck size={16} />}
                              >
                                {t(
                                  'phoneNumberManager.regulatoryDocumentUploaded',
                                  'Document uploaded.'
                                )}
                              </Alert>
                            ) : (
                              <Button
                                onClick={() =>
                                  uploadDocument(
                                    requirement.requirementName
                                  )
                                }
                                loading={
                                  uploadingDocument ===
                                  requirement.requirementName
                                }
                              >
                                {t(
                                  'phoneNumberManager.regulatoryUploadDocument',
                                  'Upload document'
                                )}
                              </Button>
                            )}
                          </Stack>
                        )}
                    </Radio.Group>
                  ))}
                </Stack>
              ))}
            </Stack>
          ) : (
            <Alert color="green" icon={<IconCircleCheck size={16} />}>
              {t(
                'phoneNumberManager.regulatoryNoDocuments',
                'No supporting documents are required.'
              )}
            </Alert>
          )}
        </Stack>
      ) : (
        <Stack gap="sm">
          {requiredFields.map((field) => (
            <TextInput
              key={field}
              label={fieldLabel(field)}
              value={attributes[field] || ''}
              required
              error={
                missingFields.includes(field)
                  ? t('phoneNumberManager.regulatoryFieldRequired', 'Required')
                  : undefined
              }
              onChange={(event) => {
                const value = event.currentTarget.value;

                setAttributes((current) => ({
                  ...current,
                  [field]: value,
                }));

                setMissingFields((current) =>
                  current.filter((name) => name !== field)
                );
              }}
            />
          ))}

          {requiredFields.length === 0 && (
            <Text size="sm" c="dimmed">
              {t(
                'phoneNumberManager.regulatoryNoIdentityFields',
                'No additional identity fields are required.'
              )}
            </Text>
          )}

          <Button onClick={submitIdentity} loading={submittingIdentity}>
            {t('phoneNumberManager.regulatoryContinue', 'Continue')}
          </Button>
        </Stack>
      )}

      {identityReady && documentsReady && (
        reviewPending ? (
          <Stack gap="sm">
            <Alert color="blue">
              {t(
                'phoneNumberManager.regulatoryReviewPending',
                'Your regulatory application has been submitted and is pending review.'
              )}
            </Alert>

            <Button
              variant="light"
              onClick={checkRegulatoryStatus}
              loading={checkingStatus}
            >
              {t(
                'phoneNumberManager.regulatoryCheckStatus',
                'Check status'
              )}
            </Button>
          </Stack>
        ) : reviewRejected ? (
          <Stack gap="sm">
            <Alert
              color="red"
              icon={<IconAlertTriangle size={16} />}
            >
              {t(
                'phoneNumberManager.regulatoryReviewRejected',
                'The regulatory application was rejected. Review the requirements and submit corrected information.'
              )}
            </Alert>

            <Button
              variant="light"
              onClick={checkRegulatoryStatus}
              loading={checkingStatus}
            >
              {t(
                'phoneNumberManager.regulatoryCheckStatus',
                'Check status'
              )}
            </Button>
          </Stack>
        ) : (
          <Stack gap="sm">
            <TextInput
              type="email"
              label={t(
                'phoneNumberManager.regulatoryBundleEmail',
                'Contact email'
              )}
              value={bundleEmail}
              required
              onChange={(event) =>
                setBundleEmail(event.currentTarget.value)
              }
            />

            <Button
              onClick={assembleAndSubmitBundle}
              loading={submittingBundle}
            >
              {t(
                'phoneNumberManager.regulatorySubmitApplication',
                'Submit for review'
              )}
            </Button>
          </Stack>
        )
      )}

      <Group justify="space-between">
        <Button
          variant="subtle"
          leftSection={<IconArrowLeft size={16} />}
          onClick={onBack}
        >
          {t('common.back', 'Back')}
        </Button>
      </Group>
    </Stack>
  );
}
