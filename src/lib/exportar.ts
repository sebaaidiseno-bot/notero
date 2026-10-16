import type { Estado, Marca, Transcripcion } from "./esquema";

export const ETIQUETA_MARCA: Record<Marca, string> = {
  urgente: "Urgente",
  por_confirmar: "Por confirmar",
  follow_up: "Follow up",
  contactar: "Contactar",
  feedback: "Feedback",
  aprobacion: "Aprobación",
};

export const ETIQUETA_ESTADO: Record<Estado, string> = {
  pendiente: "Pendiente",
  realizado: "Realizado",
  movido: "Movido",
  en_proceso: "En proceso",
};

function sufijo(marcas: Marca[], estado: Estado) {
  const partes = marcas.map((m) => ETIQUETA_MARCA[m]);
  if (estado === "movido" || estado === "en_proceso") partes.unshift(ETIQUETA_ESTADO[estado]);
  return partes.length ? ` _(${partes.join(", ")})_` : "";
}

const casilla = (estado: Estado) => (estado === "realizado" ? "[x]" : "[ ]");

export function aMarkdown(t: Transcripcion): string {
  const lineas: string[] = [];
  for (const pagina of t.paginas) {
    if (pagina.encabezado) lineas.push(`# ${pagina.encabezado}`);
    if (pagina.fecha) lineas.push(`Fecha: ${pagina.fecha}`);
    for (const p of pagina.proyectos) {
      lineas.push("", `## ${p.titulo_expandido || p.titulo}${p.estado === "realizado" ? " ✓" : ""}${sufijo(p.marcas, p.estado)}`);
      for (const tarea of p.tareas) {
        lineas.push(`- ${casilla(tarea.estado)} ${tarea.texto_expandido || tarea.texto}${sufijo(tarea.marcas, tarea.estado)}`);
        for (const d of tarea.detalles) {
          lineas.push(`  - ${casilla(d.estado)} ${d.texto}${sufijo(d.marcas, d.estado)}`);
        }
      }
    }
    lineas.push("");
  }
  return lineas.join("\n").trim() + "\n";
}
