import type { Duda } from "@/lib/esquema";

export type Punto = { x: number; y: number; p: number };
export type Xy = { x: number; y: number };

export type Trazo = { id: string; puntos: Punto[] };

export type ElementoTexto = {
  tipo: "texto";
  id: string;
  x: number;
  y: number;
  tam: number;
  texto: string;
  dudas: Duda[];
};

export type TipoForma = "linea" | "flecha" | "rect" | "elipse" | "poligono";

/**
 * linea/flecha: [inicio, fin] (la flecha apunta al fin).
 * rect y elipse: [esquina superior izquierda, esquina inferior derecha].
 * poligono: vértices en orden.
 */
export type ElementoForma = { tipo: "forma"; id: string; forma: TipoForma; puntos: Xy[] };

export type Elemento = ElementoTexto | ElementoForma;

export type Documento = { tinta: Trazo[]; elementos: Elemento[] };

export const DOCUMENTO_VACIO: Documento = { tinta: [], elementos: [] };
