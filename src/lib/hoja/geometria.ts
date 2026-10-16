import type { Elemento, ElementoForma, Trazo, Xy } from "./tipos";

export type Caja = { x0: number; y0: number; x1: number; y1: number };

export function caja(puntos: Xy[]): Caja {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const { x, y } of puntos) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

export const ancho = (c: Caja) => c.x1 - c.x0;
export const alto = (c: Caja) => c.y1 - c.y0;

export function unirCajas(cs: Caja[]): Caja {
  return {
    x0: Math.min(...cs.map((c) => c.x0)),
    y0: Math.min(...cs.map((c) => c.y0)),
    x1: Math.max(...cs.map((c) => c.x1)),
    y1: Math.max(...cs.map((c) => c.y1)),
  };
}

export function areaInterseccion(a: Caja, b: Caja) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

const dist = (a: Xy, b: Xy) => Math.hypot(a.x - b.x, a.y - b.y);

export function longitud(puntos: Xy[]) {
  let l = 0;
  for (let i = 1; i < puntos.length; i++) l += dist(puntos[i - 1], puntos[i]);
  return l;
}

function distanciaASegmento(p: Xy, a: Xy, b: Xy) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Simplificación Ramer–Douglas–Peucker: deja solo los vértices relevantes del trazo. */
export function simplificar(puntos: Xy[], tolerancia: number): Xy[] {
  if (puntos.length < 3) return puntos.slice();
  let maxD = 0, indice = 0;
  const a = puntos[0], b = puntos[puntos.length - 1];
  for (let i = 1; i < puntos.length - 1; i++) {
    const d = distanciaASegmento(puntos[i], a, b);
    if (d > maxD) {
      maxD = d;
      indice = i;
    }
  }
  if (maxD <= tolerancia) return [a, b];
  const izq = simplificar(puntos.slice(0, indice + 1), tolerancia);
  const der = simplificar(puntos.slice(indice), tolerancia);
  return [...izq.slice(0, -1), ...der];
}

// Tamaños mínimos de una forma (px de pantalla); solo se evalúa si el lápiz se mantuvo quieto al final.
const LADO_MIN_FORMA = 24;
const LARGO_MIN_LINEA = 40;

function errorElipse(puntos: Xy[], c: Caja) {
  const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2;
  const rx = ancho(c) / 2, ry = alto(c) / 2;
  let suma = 0;
  for (const p of puntos) suma += Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1);
  return suma / puntos.length;
}

/** Reconoce una forma dibujada de un solo trazo; null si parece escritura. */
export function reconocerForma(puntos: Xy[]): Omit<ElementoForma, "id"> | null {
  if (puntos.length < 4) return null;
  const c = caja(puntos);
  const w = ancho(c), h = alto(c);
  const diag = Math.hypot(w, h);
  const largo = longitud(puntos);
  const inicio = puntos[0], fin = puntos[puntos.length - 1];
  const cerrado = dist(inicio, fin) < 0.2 * Math.max(w, h) && largo > 1.4 * Math.max(w, h);

  if (cerrado) {
    if (Math.max(w, h) < LADO_MIN_FORMA) return null;
    const errElipse = errorElipse(puntos, c);
    if (errElipse < 0.08) return { tipo: "forma", forma: "elipse", puntos: [{ x: c.x0, y: c.y0 }, { x: c.x1, y: c.y1 }] };

    let vertices = simplificar(puntos, 0.07 * diag);
    if (vertices.length > 2 && dist(vertices[0], vertices[vertices.length - 1]) < 0.15 * diag) vertices = vertices.slice(0, -1);

    const esquinas = [
      { x: c.x0, y: c.y0 },
      { x: c.x1, y: c.y0 },
      { x: c.x1, y: c.y1 },
      { x: c.x0, y: c.y1 },
    ];
    const cercaDeEsquina = new Set(
      vertices.map((v) => esquinas.findIndex((e) => dist(v, e) < 0.12 * diag)).filter((i) => i >= 0),
    );
    if (vertices.length >= 4 && vertices.length <= 6 && cercaDeEsquina.size === 4) {
      return { tipo: "forma", forma: "rect", puntos: [{ x: c.x0, y: c.y0 }, { x: c.x1, y: c.y1 }] };
    }

    const medios = [
      { x: (c.x0 + c.x1) / 2, y: c.y0 },
      { x: c.x1, y: (c.y0 + c.y1) / 2 },
      { x: (c.x0 + c.x1) / 2, y: c.y1 },
      { x: c.x0, y: (c.y0 + c.y1) / 2 },
    ];
    const cercaDeMedio = new Set(
      vertices.map((v) => medios.findIndex((m) => dist(v, m) < 0.12 * diag)).filter((i) => i >= 0),
    );
    if (vertices.length >= 4 && vertices.length <= 6 && cercaDeMedio.size === 4) {
      return { tipo: "forma", forma: "poligono", puntos: medios };
    }

    if (errElipse < 0.15) return { tipo: "forma", forma: "elipse", puntos: [{ x: c.x0, y: c.y0 }, { x: c.x1, y: c.y1 }] };
    if (vertices.length >= 3 && vertices.length <= 6) return { tipo: "forma", forma: "poligono", puntos: vertices };
    return null;
  }

  // Trazo abierto: línea recta o flecha dibujada de un solo trazo.
  const recta = dist(inicio, fin);
  if (recta >= LARGO_MIN_LINEA && largo < recta * 1.08) {
    return { tipo: "forma", forma: "linea", puntos: [inicio, fin] };
  }
  const v = simplificar(puntos, Math.max(4, 0.05 * largo));
  if (v.length >= 3) {
    const cuerpo = dist(v[0], v[1]);
    const resto = v.slice(1);
    const cabezaCompacta = resto.every((p) => dist(p, v[1]) < 0.4 * cuerpo);
    if (cuerpo >= LARGO_MIN_LINEA && cabezaCompacta && longitud(resto) < 1.2 * cuerpo) {
      return { tipo: "forma", forma: "flecha", puntos: [v[0], v[1]] };
    }
  }
  return null;
}

/** Una "V" pequeña dibujada junto a un extremo de una línea la convierte en flecha. Devuelve el extremo o null. */
export function puntaDeFlecha(puntos: Xy[], linea: ElementoForma): 0 | 1 | null {
  if (linea.forma !== "linea") return null;
  const v = simplificar(puntos, Math.max(3, 0.08 * longitud(puntos)));
  if (v.length !== 3) return null;
  const largoLinea = dist(linea.puntos[0], linea.puntos[1]);
  if (longitud(puntos) > 0.7 * largoLinea) return null;
  const vertice = v[1];
  const tolerancia = Math.max(25, 0.15 * largoLinea);
  if (dist(vertice, linea.puntos[1]) < tolerancia) return 1;
  if (dist(vertice, linea.puntos[0]) < tolerancia) return 0;
  return null;
}

/** Zigzag para borrar: varios cambios de dirección horizontal y mucho recorrido para su tamaño. */
export function esTachado(puntos: Xy[]) {
  const c = caja(puntos);
  const w = ancho(c);
  if (w < 20) return false;
  let cambios = 0, signo = 0, acumulado = 0;
  for (let i = 1; i < puntos.length; i++) {
    acumulado += puntos[i].x - puntos[i - 1].x;
    if (Math.abs(acumulado) > 6) {
      const s = Math.sign(acumulado);
      if (signo !== 0 && s !== signo) cambios++;
      signo = s;
      acumulado = 0;
    }
  }
  return cambios >= 4 && longitud(puntos) > 3 * w;
}

/** Raya casi horizontal y recta (para tachar texto convertido). */
export function esRayaHorizontal(puntos: Xy[]) {
  const c = caja(puntos);
  const w = ancho(c);
  const inicio = puntos[0], fin = puntos[puntos.length - 1];
  return w > 30 && alto(c) < 0.25 * w && longitud(puntos) < 1.15 * dist(inicio, fin);
}

export function cajaTrazo(t: Trazo): Caja {
  return caja(t.puntos);
}

export function cajaElemento(e: Elemento, medirTexto: (e: Extract<Elemento, { tipo: "texto" }>) => number): Caja {
  if (e.tipo === "forma") {
    const c = caja(e.puntos);
    return { x0: c.x0 - 4, y0: c.y0 - 4, x1: c.x1 + 4, y1: c.y1 + 4 };
  }
  const lineas = e.texto.split("\n").length;
  return { x0: e.x, y0: e.y, x1: e.x + medirTexto(e), y1: e.y + e.tam * 1.3 * lineas };
}

function mediana(v: number[]) {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

/** Agrupa trazos de tinta en renglones (palabras de una misma línea escritas cerca). */
export function agruparRenglones(trazos: Trazo[]): Trazo[][] {
  if (trazos.length === 0) return [];
  const cajas = trazos.map(cajaTrazo);
  const altoTipico = Math.max(12, mediana(cajas.map(alto)));
  const grandes: number[] = [];
  const chicos: number[] = [];
  cajas.forEach((c, i) => (Math.max(ancho(c), alto(c)) < 0.35 * altoTipico ? chicos : grandes).push(i));

  const padre = trazos.map((_, i) => i);
  const raiz = (i: number): number => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
  const unir = (a: number, b: number) => (padre[raiz(a)] = raiz(b));

  for (let i = 0; i < grandes.length; i++) {
    for (let j = i + 1; j < grandes.length; j++) {
      const a = cajas[grandes[i]], b = cajas[grandes[j]];
      const solape = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      const separacion = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
      if (solape > 0.35 * Math.min(alto(a), alto(b), altoTipico) && separacion < 1.8 * altoTipico) {
        unir(grandes[i], grandes[j]);
      }
    }
  }
  // Puntos, tildes y signos pequeños se suman al renglón más cercano.
  for (const i of chicos) {
    const c = cajas[i];
    const centro = { x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 };
    let mejor = -1, mejorD = Infinity;
    for (const j of grandes) {
      const g = cajas[j];
      const dx = Math.max(g.x0 - centro.x, 0, centro.x - g.x1);
      const dy = Math.max(g.y0 - centro.y, 0, centro.y - g.y1);
      const d = Math.hypot(dx, dy);
      if (d < mejorD) {
        mejorD = d;
        mejor = j;
      }
    }
    if (mejor >= 0 && mejorD < altoTipico) unir(i, mejor);
  }

  const grupos = new Map<number, Trazo[]>();
  trazos.forEach((t, i) => {
    const r = raiz(i);
    grupos.set(r, [...(grupos.get(r) ?? []), t]);
  });
  return [...grupos.values()].sort((a, b) => unirCajas(a.map(cajaTrazo)).y0 - unirCajas(b.map(cajaTrazo)).y0);
}
