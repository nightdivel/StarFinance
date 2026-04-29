// backend/services/tools/server.js
// Сервис для инструментов: история запусков, настройки, очистка

const express = require('express');
const { query } = require('../../db');
const router = express.Router();

const TOOLS_SETTINGS_KEY = 'tools_settings';

// Получить настройки инструментов
router.get('/settings', async (req, res) => {
  try {
    const r = await query('SELECT value FROM settings WHERE key = $1', [TOOLS_SETTINGS_KEY]);
    let out = { toolsHistoryAutoClearMonths: 3 };
    if (r.rows.length > 0) {
      const val = r.rows[0].value;
      if (val && typeof val === 'object' && typeof val.toolsHistoryAutoClearMonths === 'number') {
        out.toolsHistoryAutoClearMonths = val.toolsHistoryAutoClearMonths;
      } else if (typeof val === 'string') {
        try {
          const parsed = JSON.parse(val);
          if (typeof parsed?.toolsHistoryAutoClearMonths === 'number') {
            out.toolsHistoryAutoClearMonths = parsed.toolsHistoryAutoClearMonths;
          }
        } catch (_) {}
      }
    }
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка чтения настроек инструментов' });
  }
});

// Обновить настройки инструментов
router.put('/settings', async (req, res) => {
  try {
    const value = {
      toolsHistoryAutoClearMonths: Math.max(1, Math.min(24, Number(req.body?.toolsHistoryAutoClearMonths) || 3)),
    };
    await query(
      `INSERT INTO settings(key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [TOOLS_SETTINGS_KEY, JSON.stringify(value)]
    );
    res.json(value);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сохранения настроек инструментов' });
  }
});

// Получить историю запусков инструментов
router.get('/runs', async (req, res) => {
  try {
    const r = await query('SELECT * FROM tool_runs ORDER BY started_at DESC LIMIT 100');
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка чтения истории запусков' });
  }
});

// Очистить историю запусков инструментов
router.delete('/runs', async (req, res) => {
  try {
    await query('DELETE FROM tool_runs');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка очистки истории запусков' });
  }
});

if (require.main === module) {
  const app = express();
  app.use(express.json());
  app.use('/api/tools', router);
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Tools service listening on port ${port}`);
  });
}

module.exports = router;
