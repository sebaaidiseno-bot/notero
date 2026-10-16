import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { Transcripcion } from "@/lib/esquema";
import { SIMBOLOGIA } from "@/lib/glosario";

export const runtime = "nodejs";
export const maxDuration = 300;

const client = new Anthropic();

type Imagen = { data: string; media_type: "image/jpeg" | "image/png" | "image/webp" };

const SISTEMA = `Transcribes páginas de un cuaderno escrito a mano en español (Chile) y las conviertes en proyectos y tareas.

La persona usa esta simbología:
${SIMBOLOGIA}

Cómo trabajar:
- La foto puede venir girada o con dos páginas abiertas; lee cada página por separado, de izquierda a derecha.
- Mantén el orden y la jerarquía del cuaderno: cada * es un proyecto, cada → o ↳ bajo él es una tarea, y lo que cuelga de una tarea va en "detalles".
- Las marcas de estado se escriben encima o al final de la línea. "//" o "✓✓" al final de una línea significa realizado.
- Usa el glosario para reconocer nombres propios y siglas. En "texto" deja la sigla como está escrita; en "texto_expandido" escríbela completa.
- Cuando una palabra no se lea con seguridad, escribe tu mejor lectura en el texto y regístrala en "dudas" con sus alternativas. No inventes contenido que no está en la página.
- Ignora las marcas que se transparentan desde la otra cara de la hoja.`;

export async function POST(req: Request) {
  const claveApp = process.env.APP_PASSWORD;
  if (claveApp && req.headers.get("x-app-password") !== claveApp) {
    return Response.json({ error: "Clave de acceso incorrecta." }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "Falta configurar ANTHROPIC_API_KEY en el servidor." }, { status: 500 });
  }

  let cuerpo: { imagenes?: Imagen[]; glosario?: string };
  try {
    cuerpo = await req.json();
  } catch {
    return Response.json({ error: "Solicitud inválida." }, { status: 400 });
  }
  const imagenes = cuerpo.imagenes ?? [];
  if (imagenes.length === 0 || imagenes.length > 6) {
    return Response.json({ error: "Envía entre 1 y 6 imágenes." }, { status: 400 });
  }

  const contenido: Anthropic.Beta.BetaContentBlockParam[] = [
    ...imagenes.map(
      (img): Anthropic.Beta.BetaImageBlockParam => ({
        type: "image",
        source: { type: "base64", media_type: img.media_type, data: img.data },
      }),
    ),
    {
      type: "text",
      text: `Glosario de siglas y nombres frecuentes:\n${cuerpo.glosario ?? ""}\n\nTranscribe estas páginas.`,
    },
  ];

  try {
    const respuesta = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "high", format: betaZodOutputFormat(Transcripcion) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SISTEMA,
      messages: [{ role: "user", content: contenido }],
    });

    if (respuesta.stop_reason === "refusal") {
      return Response.json({ error: "El modelo no pudo procesar esta imagen." }, { status: 422 });
    }
    if (respuesta.stop_reason === "max_tokens" || !respuesta.parsed_output) {
      return Response.json(
        { error: "La respuesta quedó incompleta. Prueba con menos páginas por foto." },
        { status: 502 },
      );
    }
    return Response.json({ resultado: respuesta.parsed_output });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return Response.json({ error: "Falta o es inválida la ANTHROPIC_API_KEY del servidor." }, { status: 500 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "Límite de uso alcanzado; intenta en un minuto." }, { status: 429 });
    }
    if (error instanceof Anthropic.BadRequestError) {
      return Response.json({ error: `Solicitud rechazada: ${error.message}` }, { status: 400 });
    }
    if (error instanceof Anthropic.APIError) {
      return Response.json({ error: `Error de la API (${error.status}).` }, { status: 502 });
    }
    throw error;
  }
}
