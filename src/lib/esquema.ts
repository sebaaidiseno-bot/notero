import { z } from "zod";

export const Estado = z.enum(["pendiente", "realizado", "movido", "en_proceso"]);
export type Estado = z.infer<typeof Estado>;

export const Marca = z.enum([
  "urgente",
  "por_confirmar",
  "follow_up",
  "contactar",
  "feedback",
  "aprobacion",
]);
export type Marca = z.infer<typeof Marca>;

const Duda = z.object({
  leido: z.string().describe("Lo que se alcanzó a leer, tal cual"),
  alternativas: z.array(z.string()).describe("Otras lecturas posibles, de más a menos probable"),
});

const Detalle = z.object({
  texto: z.string(),
  estado: Estado,
  marcas: z.array(Marca),
});

const Tarea = z.object({
  texto: z.string().describe("Texto de la tarea tal como está escrito, corrigiendo solo la ortografía obvia"),
  texto_expandido: z
    .string()
    .nullable()
    .describe("El mismo texto con las siglas del glosario expandidas; null si no hay siglas"),
  estado: Estado,
  marcas: z.array(Marca),
  detalles: z.array(Detalle).describe("Subtareas o datos (↳) que cuelgan de esta tarea"),
  dudas: z.array(Duda),
});

const Proyecto = z.object({
  titulo: z.string(),
  titulo_expandido: z.string().nullable(),
  estado: Estado,
  marcas: z.array(Marca),
  tareas: z.array(Tarea),
  dudas: z.array(Duda),
});

export const Transcripcion = z.object({
  paginas: z.array(
    z.object({
      encabezado: z.string().nullable().describe("Título general de la página, si lo hay"),
      fecha: z.string().nullable().describe("Fecha escrita en la página, si la hay"),
      proyectos: z.array(Proyecto),
    }),
  ),
  texto_literal: z
    .string()
    .describe("Transcripción literal de todo el texto, respetando líneas, sangrías y símbolos"),
});

export type Transcripcion = z.infer<typeof Transcripcion>;
export type Proyecto = z.infer<typeof Proyecto>;
export type Tarea = z.infer<typeof Tarea>;
export type Detalle = z.infer<typeof Detalle>;
export type Duda = z.infer<typeof Duda>;
