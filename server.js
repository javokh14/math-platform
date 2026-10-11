const express = require('express');
const cors = require('cors');
const { createClient } = require('@libsql/client');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '25mb' }));

const TURSO_URL = "https://backend-mathem-javokh14.aws-ap-northeast-1.turso.io";
const TURSO_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTE2OTY0MTgsImlkIjoiMDFhMTI5NmQtM2IwMS03NDU2LTljZDktNDc5MjExMjkzOTEzIiwia2lkIjoiZElaN0NzZExlZXZIZkJwU29vWW9nVGNrd3NMczRXSG1LT0x0aTMzT0tPayIsInJpZCI6IjM1OWFjYTRjLTYzNzgtNGU0Yy1hZDNmLTYxYWM2OGM4ZTI1ZCJ9.Ts1pks55CC58WcAvqc-x3VWOXDjzeXsPoFBRUdxo-IFC33S-e1wj9NIgAaFYyp9hIAoioWJ_ghl0Jfo0w2dWCA";

const turso = createClient({
  url: TURSO_URL,
  authToken: TURSO_TOKEN
});

// Создание всех таблиц
async function createTables() {
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      name TEXT,
      surname TEXT,
      age INTEGER,
      photo TEXT,
      balance INTEGER DEFAULT 0,
      solved_count INTEGER DEFAULT 0,
      certificate TEXT
    );
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      student_id TEXT,
      category TEXT,
      question TEXT,
      answer TEXT,
      created_at INTEGER
    );
  `);

  await turso.execute(`INSERT OR IGNORE INTO settings (key, value) VALUES ('isMaintenance', '0');`);
  await turso.execute(`INSERT OR IGNORE INTO settings (key, value) VALUES ('rewardPerTask', '100');`);
}

// Запуск при старте
createTables().then(() => {
  console.log("Turso jadvallari muvaffaqiyatli tekshirildi va yaratildi!");
}).catch(err => {
  console.error("Jadval yaratishda xato:", err);
});

// Маршрут для ручной инициализации таблиц через браузер
app.get('/setup', async (req, res) => {
  try {
    await createTables();
    res.send("<h1>Barcha jadvallar muvaffaqiyatli yaratildi! Endi saytdan foydalanishingiz mumkin.</h1>");
  } catch (e) {
    res.status(500).send("Xatolik: " + e.message);
  }
});

app.get('/', (req, res) => {
  res.json({ status: "ok", message: "API server ishlamoqda!" });
});

// 1. Настройки
app.get('/api/settings', async (req, res) => {
  try {
    const rs = await turso.execute("SELECT * FROM settings;");
    const settings = {};
    rs.rows.forEach(r => settings[r.key] = r.value);
    res.json({
      isMaintenance: settings.isMaintenance === '1',
      rewardPerTask: parseInt(settings.rewardPerTask || '100', 10)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. Обновление настроек
app.post('/api/settings', async (req, res) => {
  try {
    const { isMaintenance, rewardPerTask } = req.body;
    if (typeof isMaintenance !== 'undefined') {
      await turso.execute({
        sql: "UPDATE settings SET value = ? WHERE key = 'isMaintenance';",
        args: [isMaintenance ? '1' : '0']
      });
    }
    if (typeof rewardPerTask !== 'undefined') {
      await turso.execute({
        sql: "UPDATE settings SET value = ? WHERE key = 'rewardPerTask';",
        args: [String(rewardPerTask)]
      });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. Список учеников
app.get('/api/students', async (req, res) => {
  try {
    const rs = await turso.execute("SELECT * FROM students ORDER BY name ASC;");
    res.json(rs.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. Добавление ученика
app.post('/api/students', async (req, res) => {
  try {
    const { name, surname, age, photo } = req.body;
    const id = 'st_' + Date.now();
    await turso.execute({
      sql: "INSERT INTO students (id, name, surname, age, photo, balance, solved_count) VALUES (?, ?, ?, ?, ?, 0, 0);",
      args: [id, name, surname, age, photo || "badge"]
    });
    res.json({ success: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 5. Профиль ученика и текущая задача
app.get('/api/student/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const stRs = await turso.execute({
      sql: "SELECT * FROM students WHERE id = ?;",
      args: [id]
    });
    if (!stRs.rows.length) return res.status(404).json({ error: "O'quvchi topilmadi" });

    const taskRs = await turso.execute({
      sql: "SELECT * FROM tasks WHERE student_id = ? ORDER BY created_at ASC LIMIT 1;",
      args: [id]
    });

    res.json({
      student: stRs.rows[0],
      currentTask: taskRs.rows.length ? taskRs.rows[0] : null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 6. Добавление задачи
app.post('/api/tasks', async (req, res) => {
  try {
    const { studentId, category, question, answer } = req.body;
    const id = 'tsk_' + Date.now();
    await turso.execute({
      sql: "INSERT INTO tasks (id, student_id, category, question, answer, created_at) VALUES (?, ?, ?, ?, ?, ?);",
      args: [id, studentId, category, question, answer, Date.now()]
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 7. Проверка ответа
app.post('/api/tasks/solve', async (req, res) => {
  try {
    const { studentId, taskId, answer } = req.body;

    const taskRs = await turso.execute({
      sql: "SELECT * FROM tasks WHERE id = ? AND student_id = ?;",
      args: [taskId, studentId]
    });

    if (!taskRs.rows.length) {
      return res.status(400).json({ success: false, message: "Misol topilmadi yoki allaqachon yechilgan" });
    }

    const task = taskRs.rows[0];
    if (task.answer.trim().toLowerCase() !== answer.trim().toLowerCase()) {
      return res.json({ success: false, message: "Noto'g'ri javob, qayta urinib ko'ring! ❌" });
    }

    const settingRs = await turso.execute("SELECT value FROM settings WHERE key = 'rewardPerTask';");
    const reward = parseInt(settingRs.rows[0]?.value || '100', 10);

    await turso.execute({
      sql: "DELETE FROM tasks WHERE id = ?;",
      args: [taskId]
    });

    await turso.execute({
      sql: "UPDATE students SET balance = balance + ?, solved_count = solved_count + 1 WHERE id = ?;",
      args: [reward, studentId]
    });

    res.json({ success: true, reward, message: `To'g'ri! Hisobingizga +${reward.toLocaleString()} so'm qo'shildi! 🎉` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 8. Баланс
app.post('/api/students/balance', async (req, res) => {
  try {
    const { studentId, amount, action } = req.body;
    const diff = action === 'add' ? Math.abs(amount) : -Math.abs(amount);

    await turso.execute({
      sql: "UPDATE students SET balance = MAX(0, balance + ?) WHERE id = ?;",
      args: [diff, studentId]
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 9. Сертификат
app.post('/api/students/certificate', async (req, res) => {
  try {
    const { studentId, certificateData } = req.body;
    await turso.execute({
      sql: "UPDATE students SET certificate = ? WHERE id = ?;",
      args: [certificateData, studentId]
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server ishlamoqda: port ${PORT}`);
});
