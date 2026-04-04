import prisma from '../utils/prismaClient.js';

export function requirePlan(...allowedPlans) {
  const normalized = allowedPlans.map((p) => String(p).toUpperCase());

  return async function requirePlanMiddleware(req, res, next) {
    try {
      if (process.env.NODE_ENV === 'test') return next();

      if (!req.user?.id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const me = await prisma.user.findUnique({
        where: { id: Number(req.user.id) },
        select: {
          id: true,
          role: true,
          plan: true,
          subscriptionStatus: true,
          subscriptionEndsAt: true,
        },
      });

      if (!me) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (me.role === 'ADMIN') {
        req.userPlan = me.plan;
        return next();
      }

      const now = new Date();
      const isEntitled =
        (me.subscriptionStatus === 'ACTIVE' || me.subscriptionStatus === 'TRIALING') &&
        (!me.subscriptionEndsAt || me.subscriptionEndsAt > now);

      if (!isEntitled) {
        return res.status(402).json({
          error: 'Payment Required',
          code: 'SUBSCRIPTION_INACTIVE',
          message: 'Your subscription is not active.',
        });
      }

      if (!normalized.includes(String(me.plan).toUpperCase())) {
        return res.status(402).json({
          error: 'Payment Required',
          code: 'PLAN_REQUIRED',
          message: `This feature requires one of: ${normalized.join(', ')}`,
        });
      }

      req.userPlan = me.plan;
      req.userEntitlements = {
        plan: me.plan,
        subscriptionStatus: me.subscriptionStatus,
        subscriptionEndsAt: me.subscriptionEndsAt,
      };

      return next();
    } catch (err) {
      console.error('requirePlan error', err);
      return res.status(500).json({ error: 'Server error' });
    }
  };
}