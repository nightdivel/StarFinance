import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;

function authenticateToken(req, res, next) {
  if (!JWT_SECRET) return res.status(500).json({ error: 'JWT_SECRET не настроен' });
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Токен доступа отсутствует' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (error) {
    return res.status(403).json({ error: 'Недействительный токен' });
  }
}

router.use('/api', authenticateToken);

async function fetchRows(table, fields = ['*']) {
  const cols = fields.join(', ');
  const res = await pool.query(`SELECT ${cols} FROM ${table} ORDER BY ${fields[0]}`);
  return res.rows;
}

router.get('/api/directories', async (_req, res) => {
  try {
    const [productNames, warehouseLocations, warehouseTypes, productTypes, showcaseStatuses] = await Promise.all([
      fetchRows('product_names', ['name', 'id']),
      fetchRows('warehouse_locations', ['name', 'id']),
      fetchRows('warehouse_types', ['name']),
      fetchRows('product_types', ['name']),
      fetchRows('showcase_statuses', ['name']),
    ]);

    return res.json({
      productNames,
      warehouseLocations,
      warehouseTypes: warehouseTypes.map((r) => r.name),
      productTypes: productTypes.map((r) => r.name),
      showcaseStatuses: showcaseStatuses.map((r) => r.name),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка чтения справочников' });
  }
});

export default router;
