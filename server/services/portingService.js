import prisma from '../utils/prismaClient.js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

async function checkUserHasWirelessPlan(user) {
  if (!user?.stripeCustomerId) return false;

  const subs = await stripe.subscriptions.list({
    customer: user.stripeCustomerId,
    status: 'active',
  });

  return subs.data.some((sub) =>
    sub.items.data.some((item) =>
      // You set this metadata on the Stripe price
      item.price.metadata?.chatforiaWireless === 'true'
    )
  );
}

export async function createPortRequestForUser(user, input) {
  const hasWirelessPlan = await checkUserHasWirelessPlan(user);
  if (!hasWirelessPlan) {
    throw new Error('A Chatforia Wireless plan is required to port a number.');
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
      userId: user.id,
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

  // We'll plug Twilio here in the next section
  // await submitPortToTwilio(portRequest, user);

  return portRequest;
}

export async function getUserPortRequests(userId) {
  return prisma.portRequest.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getUserPortRequestById(userId, portRequestId) {
  const pr = await prisma.portRequest.findUnique({
    where: { id: portRequestId },
  });
  if (!pr || pr.userId !== userId) return null;
  return pr;
}

export async function updatePortStatus(portRequestId, { status, statusReason, scheduledAt, completedAt }) {
  return prisma.portRequest.update({
    where: { id: portRequestId },
    data: {
      status,
      statusReason,
      scheduledAt: scheduledAt ?? undefined,
      completedAt: completedAt ?? undefined,
    },
  });
}
