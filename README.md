# Notas a tareas

App web que transcribe notas escritas a mano (fotos del cuaderno) y las convierte en proyectos y tareas, respetando la simbología personal (`*` proyecto, `→` tarea, `↳` detalle, `//` realizado, `!!` urgente, etc.).

**Fase 1 (esta versión):** foto → transcripción con Gemini (visión) → revisión y corrección → exportar a Markdown o JSON.
**Fase 2 (pendiente):** enviar a Notion e integrar con el dashboard en Vercel.

## Cómo funciona

1. Tomas o subes una o más fotos (acepta HEIC del iPhone). Puedes girarlas para que el texto quede derecho.
2. El navegador reduce cada foto a 2000 px y la envía a `/api/transcribir` junto con tu glosario.
3. El servidor llama a Gemini (`gemini-3.8-flash` por defecto, cambiable con `GEMINI_MODEL`) con salida estructurada: páginas → proyectos → tareas → detalles, con estado, marcas y palabras dudosas con alternativas.
4. Revisas: editas textos, marcas tareas hechas y eliges alternativas para las palabras dudosas.

El glosario de siglas se edita en la app y se guarda en el navegador. El inicial está en `src/lib/glosario.ts`, junto con la simbología.

## Desarrollo local

```bash
npm install
cp .env.example .env.local   # y completa GEMINI_API_KEY
npm run dev
```

## Desplegar en Vercel

1. Sube este repositorio a GitHub e impórtalo en Vercel (framework: Next.js, sin configuración extra).
2. En *Settings → Environment Variables* agrega:
   - `GEMINI_API_KEY`: clave de https://aistudio.google.com (botón "Get API key"). Sin facturación es gratis con límite diario; en ese plan Google puede usar el contenido enviado para mejorar sus productos.
   - `GEMINI_MODEL` (opcional): otro modelo de Gemini, por ejemplo uno Pro.
   - `APP_PASSWORD` (recomendado): una clave para que solo tú puedas usar la app; la app la pide la primera vez y la recuerda.
3. Despliega. La función de transcripción permite hasta 300 s (`maxDuration`).

## Estructura

- `src/app/page.tsx`: interfaz (captura, revisión, exportación).
- `src/app/api/transcribir/route.ts`: llamada a Gemini.
- `src/lib/esquema.ts`: esquema de datos (Zod), base para la fase de Notion.
- `src/lib/glosario.ts`: glosario y simbología.
- `src/lib/imagen.ts`: conversión HEIC, reducción y rotación en el navegador.
- `src/lib/exportar.ts`: exportación a Markdown.

## Usar en iPad o iPhone

Abre la dirección de Vercel en Safari. "Tomar foto" abre la cámara y "Subir fotos" la galería (HEIC funciona directo). Para tenerla como app: Compartir → "Agregar a pantalla de inicio".
