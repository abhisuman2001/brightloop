import { Router } from 'express';
import { todayISO } from '../../shared/dates';
import type { PublicPlan } from '../../shared/types';
import { db } from '../db';

export const publicRouter = Router();

/** What the landing page shows as pricing: the plans on sale today, so the admin only sets prices in one place. */
publicRouter.get('/plans', (_req, res) => {
  const rows = db()
    .prepare(
      `SELECT pl.id, pl.name, pr.name AS productName, pr.notes, pl.price, pl.billing_period AS billingPeriod, pl.min_quantity AS minQuantity,
         pl.closable, pl.pausable, pl.renewable
       FROM plans pl JOIN products pr ON pr.id = pl.product_id
       WHERE pl.active = 1 AND pr.active = 1 AND (pl.start_date IS NULL OR pl.start_date <= @today) AND (pl.end_date IS NULL OR pl.end_date >= @today)
       ORDER BY pl.price`,
    )
    .all({ today: todayISO() }) as Array<Omit<PublicPlan, 'closable' | 'pausable' | 'renewable'> & { closable: number; pausable: number; renewable: number }>;
  const plans: PublicPlan[] = rows.map((p) => ({ ...p, closable: Boolean(p.closable), pausable: Boolean(p.pausable), renewable: Boolean(p.renewable) }));
  res.json(plans);
});
