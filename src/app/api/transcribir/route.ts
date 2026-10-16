import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { Transcripcion } from "@/lib/esquema";
import { SIMBOLOGIA } from "@/lib/glosario";

export const runtime = "nodejs";
export const maxDuration = 300;

const MODELO = process.env.GEMINI_MODEL || "gemini-3.8-flash";

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

// Gemini no necesita la clave $schema del JSON Schema generado por Zod.
const ESQUEMA_JSON: Record<string, unknown> = z.toJSONSchema(Transcripcion);
delete ESQUEMA_JSON.$schema;

export async function POST(req: Request) {
  const claveApp = process.env.APP_PASSWORD;
  if (claveApp && req.headers.get("x-app-password") !== claveApp) {
    return Response.json({ error: "Clave de acceso incorrecta." }, { status: 401 });
  }
  if (!process.env.GEMINI_API_KEY) {
    return Response.json({ error: "Falta configurar GEMINI_API_KEY en el servidor." }, { status: 500 });
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

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  try {
    const respuesta = await ai.models.generateContent({
      model: MODELO,
      contents: [
        {
          role: "user",
          parts: [
            ...imagenes.map((img) => ({ inlineData: { mimeType: img.media_type, data: img.data } })),
            { text: `Glosario de siglas y nombres frecuentes:\n${cuerpo.glosario ?? ""}\n\nTranscribe estas páginas.` },
          ],
        },
      ],
      config: {
        systemInstruction: SISTEMA,
        responseMimeType: "application/json",
        responseJsonSchema: ESQUEMA_JSON,
      },
    });

    const texto = respuesta.text;
    if (!texto) {
      const motivo = respuesta.candidates?.[0]?.finishReason ?? respuesta.promptFeedback?.blockReason;
      return Response.json({ error: `El modelo no devolvió texto (${motivo ?? "sin motivo"}).` }, { status: 502 });
    }
    let json: unknown;
    try {
      json = JSON.parse(texto);
    } catch {
      return Response.json(
        { error: "La respuesta quedó incompleta. Prueba con menos páginas por foto." },
        { status: 502 },
      );
    }
    const resultado = Transcripcion.safeParse(json);
    if (!resultado.success) {
      return Response.json({ error: "La respuesta no tuvo el formato esperado. Intenta de nuevo." }, { status: 502 });
    }
    return Response.json({ resultado: resultado.data });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 400 || error.status === 401 || error.status === 403) {
        return Response.json({ error: `Gemini rechazó la solicitud (${error.status}): revisa la clave y el modelo.` }, { status: 502 });
      }
      if (error.status === 429) {
        return Response.json({ error: "Se alcanzó el límite gratuito de Gemini; intenta más tarde." }, { status: 429 });
      }
      return Response.json({ error: `Error de Gemini (${error.status}).` }, { status: 502 });
    }
    throw error;
  }
}
