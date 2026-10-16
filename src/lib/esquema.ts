import { z } from "zod";

const Bloque = z.object({
  texto: z
    .string()
    .describe("Transcripción literal del texto manuscrito de esa imagen, respetando saltos de línea y símbolos"),
  dudas: z
    .array(
      z.object({
        leido: z.string().describe("Palabra tal como se transcribió en el texto"),
        alternativas: z.array(z.string()).describe("Otras lecturas posibles, de más a menos probable"),
      }),
    )
    .describe("Palabras que no se leyeron con seguridad"),
});

export const Reconocimiento = z.object({
  bloques: z.array(Bloque).describe("Un bloque por imagen recibida, en el mismo orden"),
});

export type Reconocimiento = z.infer<typeof Reconocimiento>;
export type Bloque = z.infer<typeof Bloque>;
export type Duda = Bloque["dudas"][number];
