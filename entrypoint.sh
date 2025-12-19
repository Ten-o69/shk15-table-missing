#!/bin/sh
set -e

echo "Ожидаю PostgresSQL на db:5432..."

# ждем, пока база поднимется
while ! nc -z db 5432; do
  sleep 1
done

echo "PostgresSQL доступен, запускаю миграции..."

python manage.py makemigrations --noinput
python manage.py migrate --noinput

echo "Собираю статику..."

python manage.py collectstatic --noinput || echo "collectstatic пропущен"

echo "Старт Django-сервера..."

python manage.py runserver 0.0.0.0:8000