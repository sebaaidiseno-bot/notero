# Notero

App web para escribir a mano alzada en el iPad (con Apple Pencil) y convertirlo en texto. También convierte fotos de páginas manuscritas.

## Cómo funciona

Inspirada en la tinta interactiva de MyScript, pero con Gemini como lector de escritura:

- **Conversión en el lugar:** al hacer una pausa de 1,5 s, la tinta se agrupa en renglones, se envía a Gemini (una sola solicitud por pausa) y cada renglón se reemplaza por texto escrito en el mismo sitio. Se puede desactivar ("Convertir al pausar") y convertir a mano.
- **Gestos:** tachar en zigzag borra lo que esté debajo; una raya horizontal sobre texto convertido lo borra; tocar un texto abre un editor con alternativas y la opción de borrar.
- **Formas y diagramas:** círculos/elipses, rectángulos, triángulos, rombos, líneas y flechas dibujados en tamaño grande se reconocen en el propio dispositivo (sin llamar a Gemini) y se dibujan en limpio. Una línea seguida de una "V" en un extremo se vuelve flecha.
- **Rechazo de palma:** con el Apple Pencil en uso, el dedo no dibuja (solo sirve para tocar textos).
- La hoja se guarda en el navegador y tiene deshacer. Abajo aparece el texto de la hoja listo para copiar.
- "Convertir una foto" transcribe una foto de un cuaderno (acepta HEIC).

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

- `src/app/page.tsx`: pantalla principal (barra, hoja, texto, foto, glosario).
- `src/components/Hoja.tsx`: hoja interactiva (tinta, conversión en el lugar, gestos, formas, editor de texto).
- `src/lib/hoja/geometria.ts`: reconocimiento de formas, gestos y agrupación en renglones.
- `src/lib/hoja/texto.ts`: texto plano de la hoja en orden de lectura.
- `src/app/api/transcribir/route.ts`: llamada a Gemini con reintentos y modelos de respaldo.
- `src/lib/esquema.ts`: formato de la respuesta (un bloque de texto y sus palabras dudosas por imagen).
- `src/lib/imagen.ts`: conversión HEIC y reducción de fotos.

## Usar en iPad

Abre la dirección de Vercel en Safari → Compartir → "Agregar a pantalla de inicio".
