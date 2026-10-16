import { z } from "zod";

export const Reconocimiento = z.object({
  texto: z
    .string()
    .describe("Transcripción literal del texto manuscrito, respetando saltos de línea, sangrías y símbolos"),
  dudas: z
    .array(
      z.object({
        leido: z.string().describe("Palabra tal como se transcribió en el texto"),
        alternativas: z.array(z.string()).describe("Otras lecturas posibles, de más a menos probable"),
      }),
    )
    .describe("Palabras que no se leyeron con seguridad"),
});

export type Reconocimiento = z.infer<typeof Reconocimiento>;
export type Duda = Reconocimiento["dudas"][number];
