import { Router } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import {
  deleteAccountType,
  listAccountTypes,
  saveAccountType,
  updateAccountType,
} from '../repositories/accountTypes.js';

const router = Router();

router.get('/api/account-types', authenticateToken, requirePermission('users', 'read'), async (_req, res) => {
  try {
    const result = await listAccountTypes();
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка чтения типов учетной записи' });
  }
});

router.post('/api/account-types', authenticateToken, requirePermission('users', 'write'), async (req, res) => {
  try {
    const { name, permissions } = req.body || {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Некорректное имя типа' });
    await saveAccountType({ name, permissions });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка сохранения типа' });
  }
});

router.put('/api/account-types/:name', authenticateToken, requirePermission('users', 'write'), async (req, res) => {
  try {
    const currentName = decodeURIComponent(req.params.name || '');
    if (!currentName) return res.status(400).json({ error: 'Имя не указано' });
    const { name, permissions } = req.body || {};
    const accountType = await updateAccountType({ currentName, name, permissions });
    return res.json({ success: true, accountType });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка обновления типа' });
  }
});

router.delete('/api/account-types/:name', authenticateToken, requirePermission('users', 'write'), async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name || '');
    if (!name) return res.status(400).json({ error: 'Имя не указано' });
    await deleteAccountType(name);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка удаления типа' });
  }
});

export default router;
