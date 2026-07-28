import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';

import { notifications } from '@mantine/notifications';

import {
  IconDeviceLaptop,
  IconDeviceMobile,
  IconPencil,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';

import { useTranslation } from 'react-i18next';

import axiosClient from '@/api/axiosClient';
import { useUser } from '@/context/UserContext';

import {
  getBrowserDeviceRecord,
} from '@/utils/browserDeviceClient';

function formatDate(value, fallback) {
  if (!value) return fallback;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return date.toLocaleString();
}

function detectBrowserName() {
  if (typeof navigator === 'undefined') {
    return 'Current browser';
  }

  const userAgent = navigator.userAgent || '';

  if (userAgent.includes('Edg/')) {
    return 'Microsoft Edge';
  }

  if (
    userAgent.includes('Chrome/') &&
    !userAgent.includes('Edg/')
  ) {
    return 'Google Chrome';
  }

  if (userAgent.includes('Firefox/')) {
    return 'Mozilla Firefox';
  }

  if (
    userAgent.includes('Safari/') &&
    !userAgent.includes('Chrome/')
  ) {
    return 'Safari';
  }

  return 'Current browser';
}

function simplifyPlatform(value) {
  const platform = String(value || '');
  const normalized = platform.toLowerCase();

  if (
    normalized.includes('iphone') ||
    normalized.includes('ios')
  ) {
    return 'iPhone';
  }

  if (normalized.includes('ipad')) {
    return 'iPad';
  }

  if (normalized.includes('android')) {
    return 'Android';
  }

  if (normalized.includes('windows')) {
    return 'Windows';
  }

  if (
    normalized.includes('macintosh') ||
    normalized.includes('mac os')
  ) {
    return 'macOS';
  }

  if (
    normalized.includes('browser') ||
    normalized.includes('web')
  ) {
    return 'Web browser';
  }

  if (platform.length > 40) {
    return 'Web browser';
  }

  return platform || 'Unknown platform';
}

function isMobilePlatform(value) {
  const normalized =
    String(value || '').toLowerCase();

  return (
    normalized.includes('iphone') ||
    normalized.includes('ipad') ||
    normalized.includes('ios') ||
    normalized.includes('android')
  );
}

function DeviceIcon({ platform }) {
  if (isMobilePlatform(platform)) {
    return (
      <IconDeviceMobile
        size={22}
        aria-hidden="true"
      />
    );
  }

  return (
    <IconDeviceLaptop
      size={22}
      aria-hidden="true"
    />
  );
}

export default function LinkedDevicesPanel() {
  const { t } = useTranslation();

  const {
    needsKeyUnlock,
  } = useUser();

  const [devices, setDevices] =
    useState([]);

  const [currentBrowser, setCurrentBrowser] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [initialLoaded, setInitialLoaded] =
    useState(false);

  const [loadError, setLoadError] =
    useState('');

  const [renameTarget, setRenameTarget] =
    useState(null);

  const [renameValue, setRenameValue] =
    useState('');

  const [renameBusy, setRenameBusy] =
    useState(false);

  const [removeTarget, setRemoveTarget] =
    useState(null);

  const [removeBusy, setRemoveBusy] =
    useState(false);

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    setLoadError('');

    try {
      const { data } =
        await axiosClient.get(
          '/devices/mine'
        );

      const list =
        Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data)
          ? data
          : [];

      setDevices(list);
      setInitialLoaded(true);
    } catch (error) {
      console.error(
        'Failed to load devices and sessions',
        error
      );

      setDevices([]);
      setInitialLoaded(true);

      setLoadError(
        error?.response?.data?.error ||
          error?.message ||
          t(
            'devicesSessions.loadFailed',
            'Could not load devices and sessions.'
          )
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    let active = true;

    getBrowserDeviceRecord()
      .then((record) => {
        if (!active) return;

        if (!record?.deviceId) {
          setCurrentBrowser(null);
          return;
        }

        // Deliberately retain only non-secret metadata.
        setCurrentBrowser({
          deviceId: record.deviceId,
          name: record.name || '',
          platform: record.platform || '',
        });
      })
      .catch(() => {
        if (active) {
          setCurrentBrowser(null);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  const currentDeviceId =
    currentBrowser?.deviceId || '';

  const registeredCurrentDevice =
    useMemo(
      () =>
        devices.find(
          (device) =>
            device?.deviceId ===
            currentDeviceId
        ) || null,
      [devices, currentDeviceId]
    );

  const otherDevices =
    useMemo(
      () =>
        devices.filter(
          (device) =>
            !currentDeviceId ||
            device?.deviceId !==
              currentDeviceId
        ),
      [devices, currentDeviceId]
    );

  function beginRename(device) {
    setRenameTarget(device);
    setRenameValue(
      device?.name || ''
    );
  }

  async function saveRename(event) {
    event.preventDefault();

    const name =
      renameValue.trim();

    if (
      !renameTarget?.deviceId ||
      !name
    ) {
      return;
    }

    setRenameBusy(true);

    try {
      await axiosClient.post(
        '/devices/rename',
        {
          deviceId:
            renameTarget.deviceId,
          name,
        }
      );

      setDevices((previous) =>
        previous.map((device) =>
          device.deviceId ===
          renameTarget.deviceId
            ? {
                ...device,
                name,
              }
            : device
        )
      );

      notifications.show({
        color: 'green',
        message: t(
          'devicesSessions.renamed',
          'Device renamed.'
        ),
      });

      setRenameTarget(null);
      setRenameValue('');
    } catch (error) {
      notifications.show({
        color: 'red',
        message:
          error?.response?.data?.error ||
          t(
            'devicesSessions.renameFailed',
            'Could not rename the device.'
          ),
      });
    } finally {
      setRenameBusy(false);
    }
  }

  async function confirmRemove() {
    if (!removeTarget?.deviceId) {
      return;
    }

    setRemoveBusy(true);

    try {
      await axiosClient.post(
        '/devices/revoke',
        {
          deviceId:
            removeTarget.deviceId,
        }
      );

      setDevices((previous) =>
        previous.filter(
          (device) =>
            device.deviceId !==
            removeTarget.deviceId
        )
      );

      notifications.show({
        color: 'green',
        message: t(
          'devicesSessions.removed',
          'Device registration removed.'
        ),
      });

      setRemoveTarget(null);
    } catch (error) {
      notifications.show({
        color: 'red',
        message:
          error?.response?.data?.error ||
          t(
            'devicesSessions.removeFailed',
            'Could not remove the device.'
          ),
      });
    } finally {
      setRemoveBusy(false);
    }
  }

  const currentName =
    registeredCurrentDevice?.name ||
    currentBrowser?.name ||
    detectBrowserName();

  const currentPlatform =
    registeredCurrentDevice?.platform ||
    currentBrowser?.platform ||
    (
      typeof navigator !== 'undefined'
        ? navigator.platform
        : ''
    );

  const showSkeletons =
    loading && !initialLoaded;

  return (
    <>
      <Stack gap="md">
        <div>
          <Group
            justify="space-between"
            align="flex-start"
          >
            <div>
              <Text fw={700}>
                {t(
                  'devicesSessions.title',
                  'Devices & Sessions'
                )}
              </Text>

              <Text
                size="sm"
                c="dimmed"
              >
                {t(
                  'devicesSessions.description',
                  'Review this browser and devices registered to your Chatforia account.'
                )}
              </Text>
            </div>

            <Button
              variant="subtle"
              size="compact-sm"
              leftSection={
                <IconRefresh size={16} />
              }
              onClick={fetchDevices}
              loading={loading}
            >
              {t(
                'devicesSessions.refresh',
                'Refresh'
              )}
            </Button>
          </Group>
        </div>

        <Card
          withBorder
          radius="md"
          padding="md"
        >
          <Group
            justify="space-between"
            align="flex-start"
            wrap="nowrap"
          >
            <Group
              align="flex-start"
              wrap="nowrap"
            >
              <DeviceIcon
                platform={currentPlatform}
              />

              <div>
                <Group gap="xs">
                  <Text fw={600}>
                    {currentName}
                  </Text>

                  <Badge
                    color="blue"
                    variant="light"
                  >
                    {t(
                      'devicesSessions.current',
                      'Current session'
                    )}
                  </Badge>
                </Group>

                <Text
                  size="sm"
                  c="dimmed"
                >
                  {simplifyPlatform(
                    currentPlatform
                  )}
                </Text>

                <Text
                  size="xs"
                  c="dimmed"
                  mt={4}
                >
                  {t(
                    'devicesSessions.activeNow',
                    'Last active: Now'
                  )}
                </Text>
              </div>
            </Group>

            <Badge
              color={
                needsKeyUnlock
                  ? 'yellow'
                  : 'green'
              }
              variant="light"
            >
              {needsKeyUnlock
                ? t(
                    'devicesSessions.messagesLocked',
                    'Secure messages locked'
                  )
                : t(
                    'devicesSessions.messagesAvailable',
                    'Secure messages available'
                  )}
            </Badge>
          </Group>
        </Card>

        <Alert
          color="blue"
          title={t(
            'devicesSessions.removalTitle',
            'About removing a device'
          )}
        >
          {t(
            'devicesSessions.removalDescription',
            'Removing a device disables its Chatforia device registration and future push delivery. It does not rotate your secure-message key or erase data already stored on that device.'
          )}
        </Alert>

        {loadError && (
          <Alert
            color="red"
            title={t(
              'devicesSessions.loadErrorTitle',
              'Devices could not be loaded'
            )}
          >
            {loadError}
          </Alert>
        )}

        {showSkeletons ? (
          <>
            <Skeleton h={96} />
            <Skeleton h={96} />
          </>
        ) : otherDevices.length === 0 ? (
          <Text
            size="sm"
            c="dimmed"
          >
            {t(
              'devicesSessions.noneOther',
              'No other registered devices were found.'
            )}
          </Text>
        ) : (
          <Stack gap="sm">
            {otherDevices.map(
              (device) => {
                const name =
                  device?.name?.trim() ||
                  t(
                    'devicesSessions.unnamed',
                    'Unnamed device'
                  );

                const pairingStatus =
                  String(
                    device?.pairingStatus ||
                      ''
                  ).toLowerCase();

                return (
                  <Card
                    key={
                      device.deviceId ||
                      device.id
                    }
                    withBorder
                    radius="md"
                    padding="md"
                  >
                    <Group
                      justify="space-between"
                      align="flex-start"
                      wrap="nowrap"
                    >
                      <Group
                        align="flex-start"
                        wrap="nowrap"
                      >
                        <DeviceIcon
                          platform={
                            device.platform
                          }
                        />

                        <div>
                          <Text fw={600}>
                            {name}
                          </Text>

                          <Text
                            size="sm"
                            c="dimmed"
                          >
                            {simplifyPlatform(
                              device.platform
                            )}
                          </Text>

                          <Group
                            gap="xs"
                            mt={6}
                          >
                            {device.isPrimary && (
                              <Badge
                                variant="light"
                              >
                                {t(
                                  'devicesSessions.primary',
                                  'Primary'
                                )}
                              </Badge>
                            )}

                            {pairingStatus ===
                              'pending' && (
                              <Badge
                                color="yellow"
                                variant="light"
                              >
                                {t(
                                  'devicesSessions.pending',
                                  'Pairing pending'
                                )}
                              </Badge>
                            )}

                            {pairingStatus ===
                              'approved' && (
                              <Badge
                                color="green"
                                variant="light"
                              >
                                {t(
                                  'devicesSessions.registered',
                                  'Registered'
                                )}
                              </Badge>
                            )}
                          </Group>

                          <Text
                            size="xs"
                            c="dimmed"
                            mt={6}
                          >
                            {t(
                              'devicesSessions.lastSeen',
                              'Last seen: {{date}}',
                              {
                                date: formatDate(
                                  device.lastSeenAt,
                                  t(
                                    'devicesSessions.unknown',
                                    'Unknown'
                                  )
                                ),
                              }
                            )}
                          </Text>
                        </div>
                      </Group>

                      <Group gap="xs">
                        <Tooltip
                          label={t(
                            'devicesSessions.rename',
                            'Rename device'
                          )}
                        >
                          <ActionIcon
                            variant="subtle"
                            onClick={() =>
                              beginRename(
                                device
                              )
                            }
                            aria-label={t(
                              'devicesSessions.rename',
                              'Rename device'
                            )}
                          >
                            <IconPencil
                              size={17}
                            />
                          </ActionIcon>
                        </Tooltip>

                        <Tooltip
                          label={t(
                            'devicesSessions.remove',
                            'Remove device'
                          )}
                        >
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            onClick={() =>
                              setRemoveTarget(
                                device
                              )
                            }
                            aria-label={t(
                              'devicesSessions.remove',
                              'Remove device'
                            )}
                          >
                            <IconTrash
                              size={17}
                            />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Group>
                  </Card>
                );
              }
            )}
          </Stack>
        )}
      </Stack>

      <Modal
        opened={Boolean(renameTarget)}
        onClose={() => {
          if (!renameBusy) {
            setRenameTarget(null);
            setRenameValue('');
          }
        }}
        title={t(
          'devicesSessions.renameTitle',
          'Rename device'
        )}
        centered
      >
        <form onSubmit={saveRename}>
          <Stack>
            <TextInput
              label={t(
                'devicesSessions.deviceName',
                'Device name'
              )}
              value={renameValue}
              onChange={(event) =>
                setRenameValue(
                  event.currentTarget.value
                )
              }
              maxLength={120}
              required
              autoFocus
            />

            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => {
                  setRenameTarget(null);
                  setRenameValue('');
                }}
                disabled={renameBusy}
              >
                {t(
                  'common.cancel',
                  'Cancel'
                )}
              </Button>

              <Button
                type="submit"
                loading={renameBusy}
                disabled={
                  renameValue.trim().length ===
                  0
                }
              >
                {t(
                  'common.save',
                  'Save'
                )}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal
        opened={Boolean(removeTarget)}
        onClose={() => {
          if (!removeBusy) {
            setRemoveTarget(null);
          }
        }}
        title={t(
          'devicesSessions.removeTitle',
          'Remove this device?'
        )}
        centered
      >
        <Stack>
          <Text>
            {t(
              'devicesSessions.removeConfirmation',
              'Chatforia will remove the registration for {{name}} and stop sending future push notifications to it.',
              {
                name:
                  removeTarget?.name ||
                  t(
                    'devicesSessions.thisDevice',
                    'this device'
                  ),
              }
            )}
          </Text>

          <Text
            size="sm"
            c="dimmed"
          >
            {t(
              'devicesSessions.noKeyRotation',
              'Your account secure-message key will not be rotated.'
            )}
          </Text>

          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() =>
                setRemoveTarget(null)
              }
              disabled={removeBusy}
            >
              {t(
                'common.cancel',
                'Cancel'
              )}
            </Button>

            <Button
              color="red"
              onClick={confirmRemove}
              loading={removeBusy}
            >
              {t(
                'devicesSessions.remove',
                'Remove device'
              )}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
