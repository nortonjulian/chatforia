import prisma from '../utils/prismaClient.js';

function hasWirelessEntitlement(user, subscriber) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;

  const plan = String(user.plan || '').toUpperCase();
  const subscriptionStatus = String(user.subscriptionStatus || '').toUpperCase();
  const subscriptionEndsAt = user.subscriptionEndsAt
    ? new Date(user.subscriptionEndsAt)
    : null;

  const hasActiveSubscription =
    subscriptionStatus === 'ACTIVE' &&
    (!subscriptionEndsAt || subscriptionEndsAt > new Date());

  const hasWirelessPlan = plan === 'WIRELESS';
  const hasActiveSubscriber =
    subscriber &&
    ['ACTIVE', 'TRIAL', 'PENDING', 'PROVISIONING'].includes(
      String(subscriber.status || '').toUpperCase()
    );

  return (hasWirelessPlan && hasActiveSubscription) || hasActiveSubscriber;
}

async function checkUserHasWirelessPlan(user) {
  if (!user?.id) return false;

  const freshUser = await prisma.user.findUnique({
    where: { id: Number(user.id) },
    select: {
      id: true,
      role: true,
      plan: true,
      subscriptionStatus: true,
      subscriptionEndsAt: true,
    },
  });

  if (!freshUser) return false;

  let subscriber = null;
  try {
    subscriber = await prisma.subscriber.findFirst({
      where: { userId: Number(user.id) },
      select: {
        id: true,
        status: true,
        provider: true,
      },
    });
  } catch (err) {
    console.warn('[porting] subscriber lookup failed', err);
  }

  return hasWirelessEntitlement(freshUser, subscriber);
}

export async function createPortRequestForUser(user, input) {
  const hasWirelessPlan = await checkUserHasWirelessPlan(user);
  if (!hasWirelessPlan) {
    const err = new Error('A Chatforia Wireless plan is required to port a number.');
    err.code = 'WIRELESS_PLAN_REQUIRED';
    throw err;
  }

  const {
    phoneNumber,
    carrier,
    accountNumber,
    pin,
    fullName,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    country = 'US',
  } = input;

  const portRequest = await prisma.portRequest.create({
    data: {
      userId: Number(user.id),
      phoneNumber,
      carrier,
      accountNumber,
      pin,
      fullName,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country,
      status: 'PENDING',
    },
  });

  return portRequest;
}

export async function getUserPortRequests(userId) {
  return prisma.portRequest.findMany({
    where: { userId: Number(userId) },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getUserPortRequestById(userId, portRequestId) {
  const pr = await prisma.portRequest.findUnique({
    where: { id: Number(portRequestId) },
  });

  if (!pr || Number(pr.userId) !== Number(userId)) return null;
  return pr;
}

export async function updatePortStatus(
  portRequestId,
  { status, statusReason, scheduledAt, completedAt }
) {
  return prisma.portRequest.update({
    where: { id: Number(portRequestId) },
    data: {
      status,
      statusReason,
      scheduledAt: scheduledAt ?? undefined,
      completedAt: completedAt ?? undefined,
    },
  });
}