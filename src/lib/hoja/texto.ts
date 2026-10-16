import type { Documento, ElementoTexto } from "./tipos";

/** Texto plano de la hoja: los textos convertidos, ordenados por renglón y de izquierda a derecha. */
export function textoDelDocumento(doc: Documento): string {
  const textos = doc.elementos.filter((e): e is ElementoTexto => e.tipo === "texto" && e.texto.trim() !== "");
  const ordenados = [...textos].sort((a, b) => a.y - b.y);
  const renglones: ElementoTexto[][] = [];
  for (const t of ordenados) {
    const ultimo = renglones[renglones.length - 1];
    const ref = ultimo?.[0];
    if (ref && t.y < ref.y + ref.tam * 0.8 && t.y + t.tam * 0.8 > ref.y) ultimo.push(t);
    else renglones.push([t]);
  }
  return renglones.map((r) => r.sort((a, b) => a.x - b.x).map((t) => t.texto).join(" ")).join("\n");
}
