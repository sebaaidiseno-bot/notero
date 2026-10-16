import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { Reconocimiento } from "@/lib/esquema";

export const runtime = "nodejs";
export const maxDuration = 300;

// Si un modelo está saturado (503) o sin cuota (429), se reintenta y luego se prueba el siguiente.
const MODELOS = [
  ...(process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []),
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
].filter((m, i, lista) => lista.indexOf(m) === i);

const REINTENTABLE = new Set([429, 500, 503, 504]);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Imagen = { data: string; media_type: "image/jpeg" | "image/png" | "image/webp" };

const SISTEMA = `Transcribes texto escrito a mano en español (Chile): notas hechas con lápiz en un iPad o fotos de un cuaderno.

Si hay símbolos (asteriscos, flechas, viñetas, marcas de verificación), transcríbelos con el carácter más parecido (*, →, ↳, //, ✓, ?, !!).

Cómo trabajar:
- Recibirás una o más imágenes numeradas. Cada una es un renglón escrito con lápiz en un iPad, o una foto de una página. Devuelve exactamente un bloque por imagen, en el mismo orden.
- Transcribe de forma literal: no resumas, no reordenes, no corrijas el estilo ni agregues nada que no esté escrito.
- Respeta los saltos de línea y la sangría de cada línea (usa espacios para la sangría).
- Si la imagen viene girada, léela igual en el orden correcto.
- Deja las siglas y abreviaturas tal como están escritas, sin expandirlas.
- Si una imagen no contiene escritura (es un dibujo, un boceto o un garabato), devuelve el texto vacío para ese bloque.
- Cuando una palabra no se lea con seguridad, escribe tu mejor lectura en el texto y regístrala en "dudas" con sus alternativas.
- Ignora tachones, garabatos sueltos y marcas que se transparentan desde la otra cara de la hoja.`;

// Gemini no necesita la clave $schema del JSON Schema generado por Zod.
const ESQUEMA_JSON: Record<string, unknown> = z.toJSONSchema(Reconocimiento);
delete ESQUEMA_JSON.$schema;

export async function POST(req: Request) {
  const claveApp = process.env.APP_PASSWORD;
  if (claveApp && req.headers.get("x-app-password") !== claveApp) {
    return Response.json({ error: "Clave de acceso incorrecta." }, { status: 401 });
  }
  if (!process.env.GEMINI_API_KEY) {
    return Response.json({ error: "Falta configurar GEMINI_API_KEY en el servidor." }, { status: 500 });
  }

  let cuerpo: { imagenes?: Imagen[] };
  try {
    cuerpo = await req.json();
  } catch {
    return Response.json({ error: "Solicitud inválida." }, { status: 400 });
  }
  const imagenes = cuerpo.imagenes ?? [];
  if (imagenes.length === 0 || imagenes.length > 20) {
    return Response.json({ error: "Envía entre 1 y 20 imágenes." }, { status: 400 });
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  try {
    const pedir = (model: string) =>
      ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              ...imagenes.flatMap((img, i) => [
                { text: `Imagen ${i + 1}:` },
                { inlineData: { mimeType: img.media_type, data: img.data } },
              ]),
              { text: `Transcribe las ${imagenes.length} imágenes: un bloque por imagen, en orden.` },
            ],
          },
        ],
        config: {
          systemInstruction: SISTEMA,
          responseMimeType: "application/json",
          responseJsonSchema: ESQUEMA_JSON,
        },
      });

    let respuesta: Awaited<ReturnType<typeof pedir>> | undefined;
    let ultimoError: unknown;
    for (const modelo of MODELOS) {
      for (let intento = 0; intento < 2 && !respuesta; intento++) {
        try {
          respuesta = await pedir(modelo);
        } catch (e) {
          if (!(e instanceof ApiError)) throw e;
          ultimoError = e;
          if (e.status === 404) break; // modelo no disponible para esta clave: pasar al siguiente
          if (!REINTENTABLE.has(e.status)) throw e;
          if (intento === 0) await esperar(3000);
        }
      }
      if (respuesta) break;
    }
    if (!respuesta) throw ultimoError;

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
    const resultado = Reconocimiento.safeParse(json);
    if (!resultado.success) {
      return Response.json({ error: "La respuesta no tuvo el formato esperado. Intenta de nuevo." }, { status: 502 });
    }
    // Garantiza un bloque por imagen aunque el modelo devuelva de más o de menos.
    const bloques = imagenes.map((_, i) => resultado.data.bloques[i] ?? { texto: "", dudas: [] });
    return Response.json({ resultado: { bloques } });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 400 || error.status === 401 || error.status === 403) {
        return Response.json({ error: `Gemini rechazó la solicitud (${error.status}): revisa la clave y el modelo.` }, { status: 502 });
      }
      if (error.status === 429) {
        return Response.json({ error: "Se alcanzó el límite gratuito de Gemini; intenta más tarde." }, { status: 429 });
      }
      if (error.status === 503 || error.status === 500 || error.status === 504) {
        return Response.json(
          { error: "Los servidores de Gemini están saturados en este momento. Intenta de nuevo en unos minutos." },
          { status: 503 },
        );
      }
      return Response.json({ error: `Error de Gemini (${error.status}).` }, { status: 502 });
    }
    throw error;
  }
}
