# Notero

App web para escribir a mano alzada en el iPad (con Apple Pencil) y convertirlo en texto. También convierte fotos de páginas manuscritas.

## Cómo funciona

1. Escribes en la hoja con el lápiz. Mientras usas el lápiz, los toques con la mano se ignoran (rechazo de palma).
2. "Convertir a texto" recorta lo escrito, lo envía como imagen a `/api/transcribir` y Gemini devuelve la transcripción literal (respetando líneas y símbolos como `*`, `→`, `↳`, `//`).
3. El texto se suma a la casilla de abajo (se guarda en el navegador), se puede editar y copiar. Las palabras dudosas aparecen con alternativas para elegir.
4. "Convertir una foto" hace lo mismo con una foto (acepta HEIC del iPhone).

El glosario de siglas y nombres (`src/lib/glosario.ts`, editable en la app) ayuda a leer nombres propios.

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

- `src/app/page.tsx`: pantalla principal (hoja, texto, glosario).
- `src/components/Lienzo.tsx`: hoja para escribir con lápiz (presión, rechazo de palma, deshacer, exportar).
- `src/app/api/transcribir/route.ts`: llamada a Gemini con reintentos y modelos de respaldo.
- `src/lib/esquema.ts`: formato de la respuesta (texto y palabras dudosas).
- `src/lib/imagen.ts`: conversión HEIC y reducción de fotos.

## Usar en iPad

Abre la dirección de Vercel en Safari → Compartir → "Agregar a pantalla de inicio".
