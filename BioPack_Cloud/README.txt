BIOPACK SIMULADOR – BUSINESS CHALLENGE 2026

Aplicación web para el simulador de la Gran Final BioPack.

Despliegue en Render:
- Tipo: Web Service
- Build Command: npm install
- Start Command: npm start
- Environment variable ADMIN_KEY: una clave privada para el panel de administración.
- Environment variable DATABASE_URL: conexión de PostgreSQL de Render.

La aplicación usa PostgreSQL cuando DATABASE_URL está configurada. Si se ejecuta localmente sin DATABASE_URL, conserva el modo de archivo JSON para las pruebas locales.

Panel de administración: /admin
Clave inicial local: BIOPACK2026

IMPORTANTE: cambiar ADMIN_KEY en Render antes del evento.
