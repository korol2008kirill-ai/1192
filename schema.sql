CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  login TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE trains (
  id SERIAL PRIMARY KEY,
  number TEXT NOT NULL,            -- '072А'
  name TEXT,                       -- 'САПСАН'
  train_type TEXT DEFAULT 'скоростной',
  from_city TEXT NOT NULL,
  to_city TEXT NOT NULL,
  from_station TEXT,               -- 'Ленинградский'
  to_station TEXT,                 -- 'СПб Гл.'
  depart_at TIMESTAMPTZ NOT NULL,
  arrive_at TIMESTAMPTZ NOT NULL,
  price_econom INT NOT NULL,
  price_coupe INT NOT NULL
);

CREATE TABLE tickets (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  train_id INT NOT NULL REFERENCES trains(id),
  class TEXT NOT NULL,             -- 'econom' | 'coupe'
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE password_resets (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

-- тестовые рейсы на ближайшие дни
INSERT INTO trains
(number, name, from_city, to_city, from_station, to_station, depart_at, arrive_at, price_econom, price_coupe)
VALUES
('072А','САПСАН','Москва','Санкт-Петербург','Ленинградский','СПб Гл.',
  current_date + 1 + time '07:15', current_date + 1 + time '11:20', 2450, 4100),
('072А','САПСАН','Москва','Санкт-Петербург','Ленинградский','СПб Гл.',
  current_date + 2 + time '07:15', current_date + 2 + time '11:20', 2450, 4100),
('072А','САПСАН','Москва','Санкт-Петербург','Ленинградский','СПб Гл.',
  current_date + 3 + time '10:15', current_date + 3 + time '14:20', 2450, 4100),
('072А','САПСАН','Москва','Санкт-Петербург','Ленинградский','СПб Гл.',
  current_date + 4 + time '09:15', current_date + 4 + time '13:20', 2450, 4100);