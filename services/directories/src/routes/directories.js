import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

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
