# Notero

App web para escribir a mano alzada en el iPad (con Apple Pencil) y convertirlo en texto. También convierte fotos de páginas manuscritas.

## Cómo funciona

Inspirada en la tinta interactiva de MyScript, pero con Gemini como lector de escritura:

- **Conversión en el lugar:** al hacer una pausa de 1,5 s, la tinta se agrupa en renglones, se envía a Gemini (una sola solicitud por pausa) y cada renglón se reemplaza por texto en el mismo sitio. La tinta muy alta (bocetos) no se envía. Se puede desactivar ("Convertir al pausar") y convertir a mano.
- **Formas:** al terminar un trazo, dejar el lápiz quieto medio segundo lo convierte en círculo/elipse, rectángulo, triángulo, rombo, línea o flecha (reconocido en el propio dispositivo). Una "V" sostenida junto al extremo de una línea la vuelve flecha.
- **Gestos con el lápiz:** tachar en zigzag borra lo que esté debajo; una raya horizontal sobre texto convertido lo borra; tocar un texto abre un editor con alternativas.
- **Gestos con el dedo** (cuando se usa Apple Pencil): arrastrar formas y textos para moverlos, tocar un texto para editarlo, deslizar a la izquierda para deshacer y a la derecha para rehacer. La mano apoyada no dibuja.
- **Tinta** negra, roja o azul; **hoja** cuadriculada (~7 mm), rayada, punteada o en blanco.
- Trazo suavizado con curvas y grosor según la presión. La hoja se guarda en el navegador, con deshacer y rehacer.
- "Convertir una foto" transcribe una foto de un cuaderno (acepta HEIC).

## Variables de entorno (Vercel → Settings → Environment Variables)

- `GEMINI_API_KEY`: clave de https://aistudio.google.com ("Get API key"). Sin facturación es gratis con límite diario; en ese plan Google puede usar el contenido enviado para mejorar sus productos.
- `APP_PASSWORD` (recomendado): contraseña para usar la app; se pide la primera vez y queda recordada.
- `GEMINI_MODEL` (opcional): modelo preferido. Por defecto `gemini-3.8-flash`; si está saturado se prueban `gemini-3.6-flash` y `gemini-3.5-flash-lite`.

## Desarrollo local

```bash
npm install
cp .env.example .env.local   # y completa GEMINI_API_KEY
npm run dev
```

## Estructura

- `src/app/page.tsx`: pantalla principal (barra de herramientas, hoja, texto, foto).
- `src/components/Hoja.tsx`: hoja interactiva (tinta, conversión en el lugar, formas, gestos, mover, deshacer/rehacer, editor de texto).
- `src/lib/hoja/geometria.ts`: reconocimiento de formas, gestos y agrupación en renglones.
- `src/lib/hoja/texto.ts`: texto plano de la hoja en orden de lectura.
- `src/app/api/transcribir/route.ts`: llamada a Gemini con reintentos y modelos de respaldo.
- `src/lib/esquema.ts`: formato de la respuesta (un bloque de texto y sus palabras dudosas por imagen).
- `src/lib/imagen.ts`: conversión HEIC y reducción de fotos.

## Usar en iPad

Abre la dirección de Vercel en Safari → Compartir → "Agregar a pantalla de inicio".
