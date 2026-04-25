import prisma from '../utils/prismaClient.js';

function textIncludes(text, terms = []) {
  const value = String(text || '').toLowerCase();
  return terms.some((term) => value.includes(term));
}

function classifyMessage(message = '') {
  const text = String(message || '').toLowerCase();

  if (textIncludes(text, ['premium', 'paid', 'subscription', 'billing', 'charge', 'apple', 'paddle'])) {
    return 'billing_or_premium';
  }

  if (textIncludes(text, ['login', 'log in', 'password', 'verify', 'verification', 'email'])) {
    return 'auth_or_verification';
  }

  if (textIncludes(text, ['message', 'send', 'chat', 'socket', 'not sending', 'delivered'])) {
    return 'message_delivery';
  }

  if (textIncludes(text, ['sms', 'text', 'number', 'phone number', 'twilio'])) {
    return 'sms_or_number';
  }

  if (textIncludes(text, ['report', 'spam', 'harassment', 'abuse', 'scam', 'block'])) {
    return 'safety_or_abuse';
  }

  return 'general';
}

async function findUser({ userId, email }) {
  if (userId) {
    return prisma.user.findUnique({
      where: { id: Number(userId) },
      select: {
        id: true,
        email: true,
        username: true,
        plan: true,
        subscriptionStatus: true,
        subscriptionEndsAt: true,
        billingProvider: true,
        billingSubscriptionId: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
      },
    });
  }

  if (email) {
    return prisma.user.findFirst({
      where: { email: { equals: String(email).trim().toLowerCase(), mode: 'insensitive' } },
      select: {
        id: true,
        email: true,
        username: true,
        plan: true,
        subscriptionStatus: true,
        subscriptionEndsAt: true,
        billingProvider: true,
        billingSubscriptionId: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
      },
    });
  }

  return null;
}

async function diagnoseBilling(user) {
  if (!user) {
    return {
      category: 'billing_user_not_found',
      severity: 'medium',
      resolved: false,
      userMessage: 'We could not match this request to an account yet.',
      nextAction: 'Ask the user to log in or provide the email used for billing.',
    };
  }

  if (user.plan !== 'FREE' && user.subscriptionStatus === 'ACTIVE') {
    return {
      category: 'billing_active',
      severity: 'low',
      resolved: true,
      userMessage: `Your account is currently on the ${user.plan} plan.`,
      nextAction: 'No action needed.',
    };
  }

  if (user.billingProvider === 'APPLE') {
    return {
      category: 'apple_sync_needed',
      severity: 'medium',
      resolved: false,
      userMessage: 'Your Apple purchase may need to be restored or synced from the app.',
      nextAction: 'Ask the user to tap Restore Purchases in iOS.',
    };
  }

  if (user.billingProvider === 'PADDLE') {
    return {
      category: 'paddle_subscription_not_active',
      severity: 'medium',
      resolved: false,
      userMessage: 'Your web subscription is not currently showing as active.',
      nextAction: 'Check Paddle webhook/payment status.',
    };
  }

  return {
    category: 'premium_not_active',
    severity: 'medium',
    resolved: false,
    userMessage: 'Your account is currently showing as Free.',
    nextAction: 'Guide user to upgrade or restore purchase.',
  };
}

async function diagnoseAuth(user) {
  if (!user) {
    return {
      category: 'account_not_found',
      severity: 'medium',
      resolved: false,
      userMessage: 'We could not find an account matching this request.',
      nextAction: 'Ask user to confirm email/username.',
    };
  }

  if (!user.emailVerifiedAt) {
    return {
      category: 'email_not_verified',
      severity: 'medium',
      resolved: false,
      userMessage: 'Your email address has not been verified yet.',
      nextAction: 'Offer resend verification email.',
    };
  }

  return {
    category: 'auth_account_ok',
    severity: 'low',
    resolved: true,
    userMessage: 'Your account looks active and verified.',
    nextAction: 'No account-level issue detected.',
  };
}

async function diagnoseSmsOrNumber(user) {
  if (!user) {
    return {
      category: 'sms_user_not_found',
      severity: 'medium',
      resolved: false,
      userMessage: 'We could not check SMS status because no account was matched.',
      nextAction: 'Ask user to log in.',
    };
  }

  const assignedNumber = await prisma.phoneNumber.findFirst({
    where: {
      assignedUserId: Number(user.id),
      status: { in: ['ASSIGNED', 'HOLD'] },
    },
    select: {
      id: true,
      e164: true,
      status: true,
      keepLocked: true,
      holdUntil: true,
      lastOutboundAt: true,
    },
    orderBy: { assignedAt: 'desc' },
  });

  if (!assignedNumber) {
    return {
      category: 'no_assigned_number',
      severity: 'medium',
      resolved: false,
      userMessage: 'You do not currently have an assigned Chatforia number.',
      nextAction: 'Guide user to pick or assign a number.',
    };
  }

  return {
    category: 'assigned_number_ok',
    severity: 'low',
    resolved: true,
    userMessage: `Your active number is ${assignedNumber.e164}.`,
    nextAction: 'No number assignment issue detected.',
    metadata: { assignedNumber },
  };
}

async function diagnoseMessageDelivery(user) {
  if (!user) {
    return {
      category: 'message_user_not_found',
      severity: 'medium',
      resolved: false,
      userMessage: 'We could not check message delivery because no account was matched.',
      nextAction: 'Ask user to log in.',
    };
  }

  const recentMessages = await prisma.message.findMany({
    where: { senderId: Number(user.id) },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      chatRoomId: true,
      clientMessageId: true,
      createdAt: true,
      deletedForAll: true,
      expiresAt: true,
    },
  });

  return {
    category: recentMessages.length ? 'recent_messages_found' : 'no_recent_messages',
    severity: 'low',
    resolved: recentMessages.length > 0,
    userMessage: recentMessages.length
      ? 'Recent messages were found on your account.'
      : 'No recent outgoing messages were found.',
    nextAction: recentMessages.length
      ? 'If the user still reports delivery failure, inspect socket/push status.'
      : 'Ask user to retry sending and capture clientMessageId.',
    metadata: { recentMessages },
  };
}

export async function diagnoseSupportIssue({
  userId = null,
  email = null,
  message = '',
  categoryHint = null,
} = {}) {
  const user = await findUser({ userId, email });
  const inferredCategory = categoryHint || classifyMessage(message);

  let result;

  switch (inferredCategory) {
    case 'billing_or_premium':
      result = await diagnoseBilling(user);
      break;

    case 'auth_or_verification':
      result = await diagnoseAuth(user);
      break;

    case 'sms_or_number':
      result = await diagnoseSmsOrNumber(user);
      break;

    case 'message_delivery':
      result = await diagnoseMessageDelivery(user);
      break;

    case 'safety_or_abuse':
      result = {
        category: 'safety_review_needed',
        severity: 'high',
        resolved: false,
        userMessage: 'This issue should be reviewed for safety or abuse.',
        nextAction: 'Escalate to moderation/admin review.',
      };
      break;

    default:
      result = {
        category: 'general_support',
        severity: 'low',
        resolved: false,
        userMessage: 'Thanks — we received your request.',
        nextAction: 'Queue for normal support review.',
      };
  }

  return {
    inferredCategory,
    userId: user?.id || null,
    user,
    ...result,
  };
}