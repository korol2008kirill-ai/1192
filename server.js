require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

// текущий пользователь доступен во всех шаблонах (для «Вход» / «Выход» в шапке)
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

const needAuth = (req, res, next) =>
  req.session.user ? next() : res.status(401).json({ error: 'Войдите в аккаунт' });

/* ---------- страницы ---------- */

// главная: форма поиска + результаты
app.get('/', async (req, res) => {
  const q = req.query;
  const searched = !!(q.from && q.to);
  let trains = [];

  if (searched) {
    const where = ['from_city ILIKE $1', 'to_city ILIKE $2', 'depart_at > now()'];
    const params = [q.from, q.to];

    if (q.date) {
      params.push(q.date);
      where.push(`depart_at::date = $${params.length}`);
    }
    if (q.train_type) {
      params.push(q.train_type);
      where.push(`train_type = $${params.length}`);
    }
    if (q.max_price) {
      params.push(Number(q.max_price));
      where.push(`price_econom <= $${params.length}`);
    }
    if (q.time === 'morning') where.push('EXTRACT(HOUR FROM depart_at) < 12');
    if (q.time === 'day')     where.push('EXTRACT(HOUR FROM depart_at) BETWEEN 12 AND 17');
    if (q.time === 'evening') where.push('EXTRACT(HOUR FROM depart_at) >= 18');

    const sql = `SELECT * FROM trains WHERE ${where.join(' AND ')} ORDER BY depart_at`;
    trains = (await db.query(sql, params)).rows;
  }
  res.render('index', { trains, q, searched });
});

app.get('/login',    (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));
app.get('/reset',    (req, res) => res.render('reset'));
app.get('/help',     (req, res) => res.render('help'));

app.get('/tickets', async (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const { rows } = await db.query(
    `SELECT t.id, t.class, tr.number, tr.name, tr.from_city, tr.to_city,
            tr.depart_at, tr.arrive_at,
            CASE t.class WHEN 'coupe' THEN tr.price_coupe ELSE tr.price_econom END AS price
     FROM tickets t JOIN trains tr ON tr.id = t.train_id
     WHERE t.user_id = $1 ORDER BY tr.depart_at`,
    [req.session.user.id]
  );
  res.render('tickets', { tickets: rows });
});

/* ---------- регистрация / вход / выход ---------- */

app.post('/api/register', async (req, res) => {
  const { login, email, password, password2 } = req.body;
  if (!login || !email || !password) return res.status(400).json({ error: 'Заполните все поля' });
  if (password.length < 6)           return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  if (password !== password2)        return res.status(400).json({ error: 'Пароли не совпадают' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      'INSERT INTO users (login, email, password_hash) VALUES ($1, $2, $3) RETURNING id, login',
      [login, email, hash]
    );
    req.session.user = rows[0];
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Логин или e-mail уже заняты' });
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/login', async (req, res) => {
  const { login, password } = req.body;
  const { rows } = await db.query('SELECT * FROM users WHERE login = $1', [login]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password || '', u.password_hash)))
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  req.session.user = { id: u.id, login: u.login };
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

/* ---------- сброс пароля ---------- */

// шаг 1: логин + e-mail → код
app.post('/api/reset/request', async (req, res) => {
  const { login, email } = req.body;
  const { rows } = await db.query(
    'SELECT id FROM users WHERE login = $1 AND email = $2', [login, email]
  );
  if (rows[0]) {
    const code = String(crypto.randomInt(100000, 1000000));
    await db.query(
      `INSERT INTO password_resets (user_id, code_hash, expires_at)
       VALUES ($1, $2, now() + interval '15 minutes')`,
      [rows[0].id, await bcrypt.hash(code, 10)]
    );
    console.log(`Код сброса для ${email}: ${code}`); // в продакшене отправляй через nodemailer
  }
  // всегда один и тот же ответ, чтобы нельзя было угадывать чужие аккаунты
  res.json({ ok: true });
});

// шаг 2: код + новый пароль
app.post('/api/reset/confirm', async (req, res) => {
  const { login, code, password } = req.body;
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'Пароль минимум 6 символов' });

  const { rows } = await db.query(
    `SELECT pr.id, pr.user_id, pr.code_hash
     FROM password_resets pr JOIN users u ON u.id = pr.user_id
     WHERE u.login = $1 AND pr.expires_at > now()
     ORDER BY pr.id DESC LIMIT 1`, [login]
  );
  if (!rows[0] || !(await bcrypt.compare(String(code), rows[0].code_hash)))
    return res.status(400).json({ error: 'Неверный или просроченный код' });

  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2',
    [await bcrypt.hash(password, 10), rows[0].user_id]);
  await db.query('DELETE FROM password_resets WHERE user_id = $1', [rows[0].user_id]);
  res.json({ ok: true });
});

/* ---------- покупка билета ---------- */

app.post('/api/tickets', needAuth, async (req, res) => {
  const { train_id, class: cls } = req.body;
  if (!['econom', 'coupe'].includes(cls)) return res.status(400).json({ error: 'Неверный класс' });
  await db.query('INSERT INTO tickets (user_id, train_id, class) VALUES ($1, $2, $3)',
    [req.session.user.id, train_id, cls]);
  res.json({ ok: true });
});

app.listen(process.env.PORT, () => console.log(`http://localhost:${process.env.PORT}`));