// Admin audit log viewer.
//
// GET /api/users/audit-logs?  — sengaja di bawah router admin yang sudah
// requireAuth + requireAdmin, jadi gak perlu guard tambahan.
//
// Query params:
//   limit   (1..100, default 50)
//   offset  (default 0)
//   action  filter persis (mis. LOGIN_FAILED)
//   actor   filter actor_user_id
//   from / to  rentang created_at (ISO 8601)
const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { cleanId } = require('../lib/validate');


/**
 * @swagger
 * /api/users/audit-logs:
 *   get:
 *     summary: Audit trail (admin only) — pagination + filter action/actor/rentang tanggal
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: limit, schema: { type: integer, default: 50 } }
 *       - { in: query, name: offset, schema: { type: integer, default: 0 } }
 *       - { in: query, name: action, schema: { type: string }, description: Filter persis, mis. LOGIN_FAILED }
 *       - { in: query, name: actor, schema: { type: integer }, description: actor_user_id }
 *       - { in: query, name: from, schema: { type: string, format: date-time } }
 *       - { in: query, name: to, schema: { type: string, format: date-time } }
 *     responses:
 *       200: { description: Daftar audit log (tanpa secret) }
 *       401: { description: Token tidak valid }
 *       403: { description: Bukan admin }
 *       403x: { description: API key selalu ditolak di endpoint admin }
 */
router.get('/audit-logs', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const where = [];
  const vals = [];
  if (req.query.action) {
    vals.push(String(req.query.action).slice(0, 64));
    where.push(`action = $${vals.length}`);
  }
  const actor = cleanId(req.query.actor);
  if (actor !== null) {
    vals.push(actor);
    where.push(`actor_user_id = $${vals.length}`);
  }
  for (const [field, op] of [['from', '>='], ['to', '<=']]) {
    const v = req.query[field];
    if (v) {
      const d = new Date(String(v));
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ message: `${field} harus tanggal ISO 8601.` });
      }
      vals.push(d.toISOString());
      where.push(`a.created_at ${op} $${vals.length}`);
    }
  }

  const whereSql = where.length ? 'where ' + where.join(' and ') : '';
  try {
    const { rows } = await db.query(
      `select a.id, a.action, a.target_type, a.target_id, a.request_id,
              a.ip_address, a.user_agent, a.metadata, a.created_at,
              a.actor_user_id, u.email as actor_email
       from audit_logs a left join users u on u.id = a.actor_user_id
       ${whereSql}
       order by a.created_at desc
       limit ${limit} offset ${offset}`,
      vals
    );
    const { rows: cnt } = await db.query(
      `select count(*)::int as n from audit_logs a ${whereSql}`,
      vals
    );
    return res.json({ total: cnt[0].n, limit, offset, logs: rows });
  } catch (err) {
    console.error('[GET /api/users/audit-logs]', err.message);
    return res.status(500).json({ message: 'Failed to fetch audit logs' });
  }
});

module.exports = router;
