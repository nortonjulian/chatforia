import express from 'express';
import prisma from '../utils/prismaClient.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(requireAuth, requireAdmin);

// GET /admin/support/summary
router.get('/summary', async (_req, res, next) => {
  try {
    const [
      totalTickets,
      openTickets,
      escalatedTickets,
      autoResolvedTickets,
      recentEvents,
      topCategories,
      topIssuesDetailed,
    ] = await Promise.all([
      prisma.supportTicket.count(),
      prisma.supportTicket.count({ where: { status: 'new' } }),
      prisma.supportTicket.count({ where: { status: 'escalated' } }),
      prisma.supportTicket.count({ where: { status: 'auto_resolved' } }),

      prisma.supportAutomationEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),

      prisma.supportAutomationEvent.groupBy({
        by: ['category'],
        _count: { category: true },
        orderBy: { _count: { category: 'desc' } },
        take: 10,
      }),
      prisma.supportAutomationEvent.groupBy({
        by: ['category', 'actionTaken'],
        _count: { category: true },
        orderBy: { _count: { category: 'desc' } },
        take: 10,
      }),
    ]);

    res.json({
      totals: {
        totalTickets,
        openTickets,
        escalatedTickets,
        autoResolvedTickets,
      },
      topCategories: topCategories.map((row) => ({
        category: row.category,
        count: row._count.category,
      })),
      topIssuesDetailed: topIssuesDetailed.map((row) => ({
        category: row.category,
        action: row.actionTaken,
        count: row._count.category,
      })),
      recentEvents,
    });
  } catch (err) {
    next(err);
  }
});

// GET /admin/support/tickets
router.get('/tickets', async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;

    const tickets = await prisma.supportTicket.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json({ tickets });
  } catch (err) {
    next(err);
  }
});

// PATCH /admin/support/tickets/:id
router.patch('/tickets/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body || {};

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid ticket id' });
    }

    if (!status) {
      return res.status(400).json({ error: 'status required' });
    }

    const ticket = await prisma.supportTicket.update({
      where: { id },
      data: { status },
    });

    res.json({ ok: true, ticket });
  } catch (err) {
    next(err);
  }
});

export default router;