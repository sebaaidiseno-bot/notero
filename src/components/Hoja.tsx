"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { Bloque } from "@/lib/esquema";
import {
  agruparRenglones,
  alto,
  ancho,
  areaInterseccion,
  caja,
  cajaElemento,
  cajaTrazo,
  esRayaHorizontal,
  esTachado,
  puntaDeFlecha,
  reconocerForma,
  unirCajas,
  type Caja,
} from "@/lib/hoja/geometria";
import type {
  Color,
  Documento,
  Elemento,
  ElementoForma,
  ElementoTexto,
  Papel,
  Punto,
  Trazo,
  Xy,
} from "@/lib/hoja/tipos";

export type HojaApi = {
  deshacer: () => void;
  rehacer: () => void;
  nuevaHoja: () => void;
  convertirAhora: () => void;
  vistaNormal: () => void;
};

export type EstadoHoja = { puedeDeshacer: boolean; puedeRehacer: boolean; pendientes: number; convirtiendo: boolean };

/** Vista de la hoja: pantalla = mundo × s + (x, y). */
export type Vista = { s: number; x: number; y: number };

type Props = {
  ref: Ref<HojaApi>;
  inicial: Documento;
  vistaInicial: Vista;
  automatico: boolean;
  color: Color;
  papel: Papel;
  reconocer: (imagenesPng: string[]) => Promise<Bloque[]>;
  onCambio: (doc: Documento, estado: EstadoHoja) => void;
  onVista: (vista: Vista) => void;
  onError: (mensaje: string) => void;
  onAviso: (mensaje: string) => void;
};

const GROSOR = 2.4;
const PAUSA_CONVERSION_MS = 1500;
const ESPERA_FORMA_MS = 500; // lápiz quieto al final del trazo para convertirlo en forma
const TOLERANCIA_QUIETO = 4;
const ALTO_MAX_RENGLON = 150; // tinta más alta se considera dibujo y no se envía a Gemini
const DESLIZ_MIN = 90;
const PASO_PAPEL = 36; // ≈ 7 mm en un iPad al 100 %
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const FUENTE = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const LADO_MAXIMO_EXPORT = 1600;
const MARGEN_EXPORT = 16;

const COLORES: Record<Color, { claro: string; oscuro: string } | null> = {
  negro: null, // usa el color del tema (negro en claro, casi blanco en oscuro)
  rojo: { claro: "#d22b2b", oscuro: "#ff7070" },
  azul: { claro: "#1d5fd6", oscuro: "#74a7ff" },
};

const nuevoId = () => Math.random().toString(36).slice(2, 10);
const anchoTrazo = (p: number) => GROSOR * (0.5 + p);
const dist = (a: Xy, b: Xy) => Math.hypot(a.x - b.x, a.y - b.y);
const medio = (a: Punto, b: Punto): Punto => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, p: (a.p + b.p) / 2 });

function prepararPincel(ctx: CanvasRenderingContext2D, color: string) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
}

/** Tramo i de un trazo suavizado: curva cuadrática entre puntos medios, con el punto i como control. */
function dibujarTramo(ctx: CanvasRenderingContext2D, pts: Punto[], i: number) {
  const desde = i === 1 ? pts[0] : medio(pts[i - 1], pts[i]);
  const hasta = i === pts.length - 1 ? pts[i] : medio(pts[i], pts[i + 1]);
  const control = i === pts.length - 1 ? medio(pts[i - 1], pts[i]) : pts[i];
  ctx.lineWidth = anchoTrazo(control.p);
  ctx.beginPath();
  ctx.moveTo(desde.x, desde.y);
  ctx.quadraticCurveTo(control.x, control.y, hasta.x, hasta.y);
  ctx.stroke();
}

function dibujarTrazo(ctx: CanvasRenderingContext2D, pts: Punto[]) {
  if (pts.length === 1) {
    const { x, y, p } = pts[0];
    ctx.beginPath();
    ctx.arc(x, y, anchoTrazo(p) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = 1; i < pts.length; i++) dibujarTramo(ctx, pts, i);
}

function trazarForma(ctx: CanvasRenderingContext2D, f: Pick<ElementoForma, "forma" | "puntos">) {
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  const [a, b] = f.puntos;
  if (f.forma === "rect") ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
  else if (f.forma === "elipse")
    ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
  else if (f.forma === "poligono") {
    f.puntos.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  } else {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    if (f.forma === "flecha") {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const largo = Math.min(18, Math.hypot(b.x - a.x, b.y - a.y) * 0.3);
      for (const lado of [-1, 1]) {
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - largo * Math.cos(ang + lado * 0.45), b.y - largo * Math.sin(ang + lado * 0.45));
      }
    }
  }
  ctx.stroke();
}

const fuente = (tam: number) => `${tam}px ${FUENTE}`;

function dibujarTexto(ctx: CanvasRenderingContext2D, t: ElementoTexto) {
  ctx.font = fuente(t.tam);
  ctx.textBaseline = "top";
  t.texto.split("\n").forEach((linea, i) => ctx.fillText(linea, t.x, t.y + i * t.tam * 1.3));
}

let lienzoMedidas: CanvasRenderingContext2D | null = null;
function medirTexto(t: ElementoTexto) {
  lienzoMedidas ??= document.createElement("canvas").getContext("2d");
  const ctx = lienzoMedidas!;
  ctx.font = fuente(t.tam);
  return Math.max(...t.texto.split("\n").map((l) => ctx.measureText(l).width), 10);
}

const cajaDe = (e: Elemento) => cajaElemento(e, medirTexto);

function exportarPng(trazos: Trazo[]): string {
  const c = unirCajas(trazos.map(cajaTrazo));
  const minX = c.x0 - MARGEN_EXPORT, minY = c.y0 - MARGEN_EXPORT;
  const w = ancho(c) + 2 * MARGEN_EXPORT, h = alto(c) + 2 * MARGEN_EXPORT;
  const escala = Math.min(2, LADO_MAXIMO_EXPORT / Math.max(w, h));
  const salida = document.createElement("canvas");
  salida.width = Math.round(w * escala);
  salida.height = Math.round(h * escala);
  const ctx = salida.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, salida.width, salida.height);
  ctx.setTransform(escala, 0, 0, escala, -minX * escala, -minY * escala);
  prepararPincel(ctx, "#000000");
  for (const t of trazos) dibujarTrazo(ctx, t.puntos);
  return salida.toDataURL("image/png").split(",")[1];
}

/** Proporción de la caja `objetivo` cubierta por `zona`. */
function cobertura(objetivo: Caja, zona: Caja) {
  return areaInterseccion(objetivo, zona) / Math.max(1, ancho(objetivo) * alto(objetivo));
}

function colorMayoritario(trazos: Trazo[]): Color {
  const cuenta = new Map<Color, number>();
  for (const t of trazos) cuenta.set(t.color ?? "negro", (cuenta.get(t.color ?? "negro") ?? 0) + 1);
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "negro";
}

function moverElemento(e: Elemento, dx: number, dy: number): Elemento {
  if (e.tipo === "texto") return { ...e, x: e.x + dx, y: e.y + dy };
  return { ...e, puntos: e.puntos.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
}

type TrazoEnCurso = {
  id: number;
  puntos: Punto[];
  inicio: number;
  quieto: Xy;
  forma: Omit<ElementoForma, "id"> | null;
  flechaDe: { lineaId: string; extremo: 0 | 1 } | null;
};

type Pellizco = { s0: number; x0: number; y0: number; medio0: Xy; d0: number };

type Dedo = {
  id: number;
  x: number;
  y: number;
  t: number;
  arrastre: { elementoId: string; original: Elemento; guardado: boolean } | null;
};

export default function Hoja({
  ref,
  inicial,
  vistaInicial,
  automatico,
  color,
  papel,
  reconocer,
  onCambio,
  onVista,
  onError,
  onAviso,
}: Props) {
  const contenedor = useRef<HTMLDivElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const doc = useRef<Documento>(inicial);
  const pasado = useRef<Documento[]>([]);
  const futuro = useRef<Documento[]>([]);
  const enVuelo = useRef(new Set<string>());
  const noLegibles = useRef(new Set<string>());
  const actual = useRef<TrazoEnCurso | null>(null);
  const dedo = useRef<Dedo | null>(null);
  const usaLapiz = useRef(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const temporizadorForma = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultimaLinea = useRef<string | null>(null);
  const props = useRef({ automatico, color, papel });
  const vista = useRef<Vista>(vistaInicial);
  const toques = useRef(new Map<number, Xy>());
  const pellizco = useRef<Pellizco | null>(null);
  const ignorarDedos = useRef(false);
  const [editando, setEditando] = useState<string | null>(null);
  const editandoRef = useRef<string | null>(null);
  const [, refrescar] = useState(0);

  props.current = { automatico, color, papel };
  editandoRef.current = editando;

  function oscuro() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function pintura(c: Color | undefined) {
    const def = COLORES[c ?? "negro"];
    if (!def) return getComputedStyle(lienzo.current!).color;
    return oscuro() ? def.oscuro : def.claro;
  }

  function dibujarPapel(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const { s, x, y } = vista.current;
    const paso = PASO_PAPEL * s;
    if (props.current.papel === "blanco" || paso < 7) return;
    const tinte = oscuro() ? "255 255 255" : "0 0 0";
    const inicioX = ((x % paso) + paso) % paso;
    const inicioY = ((y % paso) + paso) % paso;
    if (props.current.papel === "puntos") {
      ctx.fillStyle = `rgb(${tinte} / 0.3)`;
      const r = Math.max(0.8, 1.3 * Math.min(s, 1.5));
      for (let px = inicioX; px < w; px += paso)
        for (let py = inicioY; py < h; py += paso) {
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
        }
      return;
    }
    ctx.strokeStyle = `rgb(${tinte} / 0.09)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let py = inicioY; py < h; py += paso) {
      ctx.moveTo(0, Math.round(py) + 0.5);
      ctx.lineTo(w, Math.round(py) + 0.5);
    }
    if (props.current.papel === "cuadricula")
      for (let px = inicioX; px < w; px += paso) {
        ctx.moveTo(Math.round(px) + 0.5, 0);
        ctx.lineTo(Math.round(px) + 0.5, h);
      }
    ctx.stroke();
  }

  /** Deja el contexto con la transformación del mundo (para seguir dibujando el trazo en curso). */
  function aplicarVista(ctx: CanvasRenderingContext2D) {
    const dpr = window.devicePixelRatio || 1;
    const { s, x, y } = vista.current;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * x, dpr * y);
  }

  function dibujar() {
    const c = lienzo.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    dibujarPapel(ctx, c.width / dpr, c.height / dpr);
    aplicarVista(ctx);
    for (const e of doc.current.elementos) {
      prepararPincel(ctx, pintura(e.color));
      if (e.tipo === "forma") trazarForma(ctx, e);
      else if (e.id !== editandoRef.current) dibujarTexto(ctx, e);
    }
    for (const t of doc.current.tinta) {
      prepararPincel(ctx, pintura(t.color));
      ctx.globalAlpha = enVuelo.current.has(t.id) ? 0.35 : 1;
      dibujarTrazo(ctx, t.puntos);
    }
    ctx.globalAlpha = 1;
    const a = actual.current;
    if (a) {
      prepararPincel(ctx, pintura(props.current.color));
      if (a.forma) trazarForma(ctx, a.forma);
      else dibujarTrazo(ctx, a.puntos);
    }
  }

  function avisar() {
    dibujar();
    onCambio(doc.current, {
      puedeDeshacer: pasado.current.length > 0,
      puedeRehacer: futuro.current.length > 0,
      pendientes: doc.current.tinta.filter((t) => !noLegibles.current.has(t.id)).length,
      convirtiendo: enVuelo.current.size > 0,
    });
    refrescar((n) => n + 1);
  }

  function cambiarVista(nueva: Vista) {
    vista.current = { ...nueva, s: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nueva.s)) };
    dibujar();
    onVista(vista.current);
    refrescar((n) => n + 1);
  }

  /** Zoom manteniendo fijo el punto de pantalla (px, py). */
  function zoomEn(px: number, py: number, nuevaEscala: number) {
    const { s, x, y } = vista.current;
    const s2 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nuevaEscala));
    cambiarVista({ s: s2, x: px - ((px - x) / s) * s2, y: py - ((py - y) / s) * s2 });
  }

  function guardarEstado() {
    pasado.current.push(structuredClone(doc.current));
    if (pasado.current.length > 80) pasado.current.shift();
    futuro.current = [];
  }

  function deshacer() {
    const previo = pasado.current.pop();
    if (!previo) return false;
    futuro.current.push(structuredClone(doc.current));
    doc.current = previo;
    setEditando(null);
    avisar();
    return true;
  }

  function rehacer() {
    const siguiente = futuro.current.pop();
    if (!siguiente) return false;
    pasado.current.push(structuredClone(doc.current));
    doc.current = siguiente;
    setEditando(null);
    avisar();
    return true;
  }

  useEffect(() => {
    const c = lienzo.current!;
    const ajustar = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = c.getBoundingClientRect();
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
      dibujar();
    };
    ajustar();
    const observador = new ResizeObserver(ajustar);
    observador.observe(c);
    const tema = window.matchMedia("(prefers-color-scheme: dark)");
    tema.addEventListener("change", dibujar);
    // En computador: rueda o trackpad desplazan; con Ctrl (o pellizco en trackpad) hacen zoom.
    const rueda = (e: WheelEvent) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      if (e.ctrlKey) zoomEn(e.clientX - r.left, e.clientY - r.top, vista.current.s * Math.exp(-e.deltaY * 0.01));
      else cambiarVista({ ...vista.current, x: vista.current.x - e.deltaX, y: vista.current.y - e.deltaY });
    };
    c.addEventListener("wheel", rueda, { passive: false });
    return () => {
      observador.disconnect();
      tema.removeEventListener("change", dibujar);
      c.removeEventListener("wheel", rueda);
      if (temporizador.current) clearTimeout(temporizador.current);
      if (temporizadorForma.current) clearTimeout(temporizadorForma.current);
    };
    // Solo al montar: dibujar lee el documento desde refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(dibujar);

  function programarConversion() {
    if (temporizador.current) clearTimeout(temporizador.current);
    if (!props.current.automatico) return;
    temporizador.current = setTimeout(() => void convertirPendiente(), PAUSA_CONVERSION_MS);
  }

  async function convertirPendiente() {
    if (actual.current) return programarConversion();
    const pendientes = doc.current.tinta.filter((t) => !enVuelo.current.has(t.id) && !noLegibles.current.has(t.id));
    if (pendientes.length === 0) return;
    const grupos = agruparRenglones(pendientes).filter((g) => {
      // Tinta muy alta es un dibujo o boceto: se queda como tinta y no gasta cuota.
      if (alto(unirCajas(g.map(cajaTrazo))) <= ALTO_MAX_RENGLON) return true;
      g.forEach((t) => noLegibles.current.add(t.id));
      return false;
    });
    if (grupos.length === 0) return avisar();
    for (const g of grupos) for (const t of g) enVuelo.current.add(t.id);
    avisar();
    try {
      const bloques = await reconocer(grupos.map(exportarPng));
      const vivos = new Set(doc.current.tinta.map((t) => t.id));
      let guardado = false;
      grupos.forEach((grupo, i) => {
        const texto = bloques[i]?.texto?.trim();
        if (!grupo.every((t) => vivos.has(t.id))) return; // se borró o deshizo mientras se convertía
        if (!texto) {
          grupo.forEach((t) => noLegibles.current.add(t.id)); // probablemente un dibujo: se deja como tinta
          return;
        }
        if (!guardado) {
          guardarEstado();
          guardado = true;
        }
        const c = unirCajas(grupo.map(cajaTrazo));
        const tam = Math.round(Math.min(64, Math.max(14, alto(c) * 0.6)));
        const lineas = texto.split("\n").length;
        const ids = new Set(grupo.map((t) => t.id));
        doc.current = {
          tinta: doc.current.tinta.filter((t) => !ids.has(t.id)),
          elementos: [
            ...doc.current.elementos,
            {
              tipo: "texto",
              id: nuevoId(),
              x: c.x0,
              y: c.y0 + Math.max(0, (alto(c) - tam * 1.3 * lineas) / 2),
              tam,
              texto,
              dudas: bloques[i].dudas ?? [],
              color: colorMayoritario(grupo),
            },
          ],
        };
      });
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se pudo convertir la escritura.");
    } finally {
      for (const g of grupos) for (const t of g) enVuelo.current.delete(t.id);
      avisar();
    }
  }

  useImperativeHandle(ref, () => ({
    deshacer,
    rehacer,
    nuevaHoja() {
      guardarEstado();
      doc.current = { tinta: [], elementos: [] };
      setEditando(null);
      avisar();
    },
    convertirAhora() {
      if (temporizador.current) clearTimeout(temporizador.current);
      noLegibles.current.clear(); // al pedirlo a mano, se reintenta todo lo que quedó como tinta
      void convertirPendiente();
    },
    vistaNormal() {
      cambiarVista({ s: 1, x: 0, y: 0 });
    },
  }));

  function enPantalla(e: { clientX: number; clientY: number }): Xy {
    const r = lienzo.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function puntoDe(e: { clientX: number; clientY: number; pointerType: string; pressure: number }): Punto {
    const { x, y } = enPantalla(e);
    const v = vista.current;
    const p = e.pointerType === "mouse" || e.pressure === 0 ? 0.5 : e.pressure;
    return { x: (x - v.x) / v.s, y: (y - v.y) / v.s, p };
  }

  function elementoEn(x: number, y: number, soloTexto = false) {
    const candidatos = doc.current.elementos.filter((e) => !soloTexto || e.tipo === "texto");
    return [...candidatos].reverse().find((e) => {
      const c = cajaDe(e);
      const m = 8 / vista.current.s;
      return x >= c.x0 - m && x <= c.x1 + m && y >= c.y0 - m && y <= c.y1 + m;
    });
  }

  /** Al mantener el lápiz quieto: ¿el trazo en curso es una forma, o la punta de una flecha? */
  function intentarForma() {
    const a = actual.current;
    if (!a || a.forma || a.flechaDe) return;
    const linea = doc.current.elementos.find(
      (e): e is ElementoForma => e.id === ultimaLinea.current && e.tipo === "forma",
    );
    const extremo = linea ? puntaDeFlecha(a.puntos, linea) : null;
    if (linea && extremo !== null) {
      a.flechaDe = { lineaId: linea.id, extremo };
      const [p0, p1] = linea.puntos;
      a.forma = { tipo: "forma", forma: "flecha", puntos: extremo === 1 ? [p0, p1] : [p1, p0] };
    } else {
      a.forma = reconocerForma(a.puntos);
    }
    if (a.forma) dibujar();
  }

  function procesarTrazo(a: TrazoEnCurso) {
    const { puntos } = a;
    const c = caja(puntos);
    const duracion = Date.now() - a.inicio;

    if (a.forma) {
      guardarEstado();
      if (a.flechaDe) {
        const { lineaId } = a.flechaDe;
        const flecha = a.forma;
        doc.current = {
          ...doc.current,
          elementos: doc.current.elementos.map((e) => (e.id === lineaId ? { ...e, ...flecha, id: lineaId } : e)),
        };
        ultimaLinea.current = null;
      } else {
        const id = nuevoId();
        doc.current = { ...doc.current, elementos: [...doc.current.elementos, { ...a.forma, id, color: props.current.color }] };
        ultimaLinea.current = a.forma.forma === "linea" ? id : null;
      }
      return avisar();
    }

    if (Math.max(ancho(c), alto(c)) * vista.current.s < 5 && duracion < 350) {
      const t = elementoEn(puntos[0].x, puntos[0].y, true);
      if (t) return abrirEdicion(t.id);
    }

    if (esTachado(puntos)) {
      const tintaTocada = doc.current.tinta.filter((t) => cobertura(cajaTrazo(t), c) > 0.3);
      const elementosTocados = doc.current.elementos.filter((e) => cobertura(cajaDe(e), c) > 0.3);
      if (tintaTocada.length || elementosTocados.length) {
        guardarEstado();
        const fuera = new Set([...tintaTocada, ...elementosTocados].map((x) => x.id));
        doc.current = {
          tinta: doc.current.tinta.filter((t) => !fuera.has(t.id)),
          elementos: doc.current.elementos.filter((e) => !fuera.has(e.id)),
        };
        return avisar();
      }
    }

    if (esRayaHorizontal(puntos)) {
      const tachado = doc.current.elementos.find((e) => {
        if (e.tipo !== "texto") return false;
        const ct = cajaDe(e);
        const centro = (c.y0 + c.y1) / 2;
        const cubre = Math.min(c.x1, ct.x1) - Math.max(c.x0, ct.x0);
        return centro > ct.y0 + alto(ct) * 0.2 && centro < ct.y1 - alto(ct) * 0.2 && cubre > 0.5 * ancho(ct);
      });
      if (tachado) {
        guardarEstado();
        doc.current = { ...doc.current, elementos: doc.current.elementos.filter((e) => e.id !== tachado.id) };
        return avisar();
      }
    }

    guardarEstado();
    doc.current = { ...doc.current, tinta: [...doc.current.tinta, { id: nuevoId(), puntos, color: props.current.color }] };
    avisar();
    programarConversion();
  }

  function abrirEdicion(id: string) {
    if (temporizador.current) clearTimeout(temporizador.current);
    guardarEstado();
    setEditando(id);
  }

  function iniciarPellizco() {
    const d = dedo.current;
    dedo.current = null;
    if (d?.arrastre?.guardado) avisar();
    if (actual.current) {
      // Un trazo con el dedo (sin lápiz) se descarta al empezar a usar dos dedos.
      actual.current = null;
      if (temporizadorForma.current) clearTimeout(temporizadorForma.current);
      dibujar();
    }
    const [p1, p2] = [...toques.current.values()];
    const { s, x, y } = vista.current;
    pellizco.current = {
      s0: s,
      x0: x,
      y0: y,
      medio0: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
      d0: Math.max(10, dist(p1, p2)),
    };
    ignorarDedos.current = true;
  }

  function alBajar(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "pen") usaLapiz.current = true;
    if (editando) setEditando(null);

    if (e.pointerType === "touch") {
      // Mientras el lápiz escribe, cualquier toque es la mano apoyada.
      if (actual.current && usaLapiz.current) return;
      if (e.width > 40) return; // la palma
      toques.current.set(e.pointerId, enPantalla(e));
      if (toques.current.size === 2) return iniciarPellizco();
      if (toques.current.size > 2 || ignorarDedos.current) return;
      if (usaLapiz.current) {
        // Con el lápiz en uso, un dedo no dibuja: mueve formas y textos, toca para editar y desliza para deshacer/rehacer.
        const p = puntoDe(e);
        const el = elementoEn(p.x, p.y);
        dedo.current = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          t: Date.now(),
          arrastre: el ? { elementoId: el.id, original: el, guardado: false } : null,
        };
        return;
      }
    }

    if (actual.current) return;
    e.preventDefault();
    if (temporizador.current) clearTimeout(temporizador.current);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Sin captura el trazo igual funciona mientras el lápiz siga sobre la hoja.
    }
    const p = puntoDe(e);
    actual.current = { id: e.pointerId, puntos: [p], inicio: Date.now(), quieto: p, forma: null, flechaDe: null };
    if (temporizadorForma.current) clearTimeout(temporizadorForma.current);
    const ctx = e.currentTarget.getContext("2d")!;
    aplicarVista(ctx);
    prepararPincel(ctx, pintura(props.current.color));
    dibujarTrazo(ctx, actual.current.puntos);
  }

  function alMover(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "touch" && toques.current.has(e.pointerId)) {
      toques.current.set(e.pointerId, enPantalla(e));
      const pz = pellizco.current;
      if (pz && toques.current.size >= 2) {
        const [p1, p2] = [...toques.current.values()];
        const medioActual = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const s2 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (pz.s0 * dist(p1, p2)) / pz.d0));
        // El punto del mundo que estaba bajo el centro de los dedos sigue bajo los dedos.
        cambiarVista({
          s: s2,
          x: medioActual.x - ((pz.medio0.x - pz.x0) / pz.s0) * s2,
          y: medioActual.y - ((pz.medio0.y - pz.y0) / pz.s0) * s2,
        });
        return;
      }
    }

    const d = dedo.current;
    if (d && e.pointerId === d.id) {
      if (!d.arrastre) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.arrastre.guardado && Math.hypot(dx, dy) < 6) return;
      if (!d.arrastre.guardado) {
        guardarEstado();
        d.arrastre.guardado = true;
      }
      const s = vista.current.s;
      const movido = moverElemento(d.arrastre.original, dx / s, dy / s);
      doc.current = { ...doc.current, elementos: doc.current.elementos.map((x) => (x.id === movido.id ? movido : x)) };
      dibujar();
      return;
    }

    const a = actual.current;
    if (!a || e.pointerId !== a.id) return;
    const ctx = e.currentTarget.getContext("2d")!;
    aplicarVista(ctx);
    prepararPincel(ctx, pintura(props.current.color));
    const escala = vista.current.s;
    const agrupados = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of agrupados.length > 0 ? agrupados : [e.nativeEvent]) {
      const nuevo = puntoDe(ev);
      if (dist(nuevo, a.puntos[a.puntos.length - 1]) * escala < 0.75) continue;
      a.puntos.push(nuevo);
      if (!a.forma && a.puntos.length >= 3) dibujarTramo(ctx, a.puntos, a.puntos.length - 2);
    }
    const ultimo = a.puntos[a.puntos.length - 1];
    if (dist(ultimo, a.quieto) * escala > TOLERANCIA_QUIETO) {
      a.quieto = ultimo;
      if (a.forma) {
        // Se volvió a mover después de convertirse: sigue como tinta.
        a.forma = null;
        a.flechaDe = null;
        dibujar();
      }
      if (temporizadorForma.current) clearTimeout(temporizadorForma.current);
      temporizadorForma.current = setTimeout(intentarForma, ESPERA_FORMA_MS);
    }
  }

  function alSubir(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "touch" && toques.current.has(e.pointerId)) {
      toques.current.delete(e.pointerId);
      if (toques.current.size < 2) pellizco.current = null;
      if (ignorarDedos.current) {
        // Termina un gesto de dos dedos: los dedos que quedan no hacen nada hasta levantarse.
        if (toques.current.size === 0) ignorarDedos.current = false;
        dedo.current = null;
        return;
      }
    }

    const d = dedo.current;
    if (d && d.id === e.pointerId) {
      dedo.current = null;
      if (d.arrastre?.guardado) return avisar();
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      const rapido = Date.now() - d.t < 700;
      if (Math.hypot(dx, dy) < 10 && Date.now() - d.t < 400) {
        const p = puntoDe(e);
        const t = elementoEn(p.x, p.y, true);
        if (t) abrirEdicion(t.id);
      } else if (rapido && Math.abs(dx) > DESLIZ_MIN && Math.abs(dy) < 0.6 * Math.abs(dx)) {
        if (dx < 0) onAviso(deshacer() ? "Deshecho" : "Nada que deshacer");
        else onAviso(rehacer() ? "Rehecho" : "Nada que rehacer");
      }
      return;
    }
    const a = actual.current;
    if (!a || e.pointerId !== a.id) return;
    if (temporizadorForma.current) clearTimeout(temporizadorForma.current);
    actual.current = null;
    if (e.type === "pointercancel") return dibujar();
    procesarTrazo(a);
  }

  const textoEditado = doc.current.elementos.find((e): e is ElementoTexto => e.id === editando && e.tipo === "texto");

  function cambiarTexto(cambio: (t: ElementoTexto) => ElementoTexto | null) {
    if (!textoEditado) return;
    const nuevo = cambio(textoEditado);
    doc.current = {
      ...doc.current,
      elementos: nuevo
        ? doc.current.elementos.map((e) => (e.id === textoEditado.id ? nuevo : e))
        : doc.current.elementos.filter((e) => e.id !== textoEditado.id),
    };
    if (!nuevo) setEditando(null);
    avisar();
  }

  return (
    <div ref={contenedor} className="relative">
      <canvas
        ref={lienzo}
        className={`hoja block h-[72vh] min-h-96 w-full rounded-xl border border-black/10 text-neutral-900 dark:border-white/10 dark:text-neutral-100`}
        onPointerDown={alBajar}
        onPointerMove={alMover}
        onPointerUp={alSubir}
        onPointerCancel={alSubir}
      />
      {textoEditado && (
        <div
          className="seleccionable absolute z-10 w-72 max-w-[calc(100%-1rem)] rounded-xl border border-black/10 bg-white p-2 shadow-lg dark:border-white/10 dark:bg-neutral-800"
          style={{
            left: Math.max(
              8,
              Math.min(textoEditado.x * vista.current.s + vista.current.x, (contenedor.current?.clientWidth ?? 400) - 296),
            ),
            top: Math.max(8, textoEditado.y * vista.current.s + vista.current.y),
          }}
        >
          <textarea
            autoFocus
            rows={Math.max(1, textoEditado.texto.split("\n").length)}
            className="w-full resize-none rounded-md border border-black/15 bg-transparent px-2 py-1 text-base dark:border-white/15"
            value={textoEditado.texto}
            onChange={(e) => cambiarTexto((t) => ({ ...t, texto: e.target.value }))}
          />
          {textoEditado.dudas.length > 0 && (
            <div className="mt-1 space-y-1 text-xs">
              {textoEditado.dudas.map((d) => (
                <div key={d.leido} className="flex flex-wrap items-center gap-1">
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
                    ¿{d.leido}?
                  </span>
                  {d.alternativas.map((alt) => (
                    <button
                      key={alt}
                      className="rounded border border-black/15 px-1.5 py-0.5 dark:border-white/15"
                      onClick={() =>
                        cambiarTexto((t) => ({
                          ...t,
                          texto: t.texto.replace(d.leido, alt),
                          dudas: t.dudas.filter((x) => x !== d),
                        }))
                      }
                    >
                      {alt}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex justify-between">
            <button className="boton text-red-700 dark:text-red-400" onClick={() => cambiarTexto(() => null)}>
              Borrar
            </button>
            <button className="boton-primario" onClick={() => setEditando(null)}>
              Listo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
