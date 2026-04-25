import prisma from '../utils/prismaClient.js';
import { diagnoseSupportIssue } from './supportDiagnosticsService.js';

export async function recordSupportAutomationEvent({
  userId = null,
  ticketId = null,
  category,
  source = 'support',
  status = 'detected',
  actionTaken = null,
  metadata = null,
}) {
  try {
    return await prisma.supportAutomationEvent.create({
      data: {
        userId: userId ? Number(userId) : null,
        ticketId: ticketId ? Number(ticketId) : null,
        category,
        source,
        status,
        actionTaken,
        metadata,
      },
    });
  } catch (err) {
    console.error('[supportAutomation] failed to record event:', err);
    return null;
  }
}

export async function recordSupportAutoAction({
  userId = null,
  category,
  action,
  status = 'created',
  metadata = null,
}) {
  try {
    return await prisma.supportAutoAction.create({
      data: {
        userId: userId ? Number(userId) : null,
        category,
        action,
        status,
        metadata,
      },
    });
  } catch (err) {
    console.error('[supportAutomation] failed to record action:', err);
    return null;
  }
}

function chooseAutoAction(diagnosis) {
  switch (diagnosis.category) {
    case 'email_not_verified':
      return {
        action: 'offer_resend_verification',
        status: 'recommended',
      };

    case 'apple_sync_needed':
      return {
        action: 'prompt_restore_purchases_ios',
        status: 'recommended',
      };

    case 'premium_not_active':
    case 'paddle_subscription_not_active':
      return {
        action: 'route_to_billing_review',
        status: 'escalated',
      };

    case 'no_assigned_number':
      return {
        action: 'prompt_number_selection',
        status: 'recommended',
      };

    case 'assigned_number_ok':
    case 'billing_active':
    case 'auth_account_ok':
    case 'recent_messages_found':
      return {
        action: 'no_action_needed',
        status: 'resolved',
      };

    case 'safety_review_needed':
      return {
        action: 'escalate_to_moderation',
        status: 'escalated',
      };

    default:
      return {
        action: 'queue_for_support_review',
        status: 'queued',
      };
  }
}

export async function recordSupportSignal({
  userId = null,
  category,
  source = 'backend',
  actionTaken = null,
  status = 'detected',
  metadata = null,
} = {}) {
  if (!category) return null;

  return recordSupportAutomationEvent({
    userId,
    category,
    source,
    status,
    actionTaken,
    metadata,
  });
}

export async function runSupportAutomation({
  userId = null,
  email = null,
  message = '',
  ticketId = null,
  categoryHint = null,
  source = 'support_ticket',
} = {}) {
  const diagnosis = await diagnoseSupportIssue({
    userId,
    email,
    message,
    categoryHint,
  });

  const selected = chooseAutoAction(diagnosis);

  await recordSupportAutomationEvent({
    userId: diagnosis.userId || userId,
    ticketId,
    category: diagnosis.category,
    source,
    status: diagnosis.resolved ? 'resolved' : 'detected',
    actionTaken: selected.action,
    metadata: {
      inferredCategory: diagnosis.inferredCategory,
      severity: diagnosis.severity,
      nextAction: diagnosis.nextAction,
      diagnosisMetadata: diagnosis.metadata || null,
    },
  });

  await recordSupportAutoAction({
    userId: diagnosis.userId || userId,
    category: diagnosis.category,
    action: selected.action,
    status: selected.status,
    metadata: {
      ticketId,
      userMessage: diagnosis.userMessage,
      nextAction: diagnosis.nextAction,
    },
  });

  return {
    diagnosis,
    autoAction: selected,
  };
}