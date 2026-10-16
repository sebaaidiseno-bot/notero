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
import type { Documento, Elemento, ElementoForma, ElementoTexto, Punto, Trazo } from "@/lib/hoja/tipos";

export type HojaApi = {
  deshacer: () => void;
  nuevaHoja: () => void;
  convertirAhora: () => void;
};

type Props = {
  ref: Ref<HojaApi>;
  inicial: Documento;
  automatico: boolean;
  reconocer: (imagenesPng: string[]) => Promise<Bloque[]>;
  onCambio: (doc: Documento, puedeDeshacer: boolean) => void;
  onError: (mensaje: string) => void;
};

const GROSOR = 2.6;
const PAUSA_MS = 1500;
const FUENTE = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const LADO_MAXIMO_EXPORT = 1600;
const MARGEN_EXPORT = 16;

const nuevoId = () => Math.random().toString(36).slice(2, 10);
const anchoTrazo = (p: number) => GROSOR * (0.55 + p);

function prepararPincel(ctx: CanvasRenderingContext2D, color: string) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
}

function dibujarTrazo(ctx: CanvasRenderingContext2D, puntos: Punto[]) {
  if (puntos.length === 1) {
    const { x, y, p } = puntos[0];
    ctx.beginPath();
    ctx.arc(x, y, anchoTrazo(p) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = 1; i < puntos.length; i++) {
    const a = puntos[i - 1], b = puntos[i];
    ctx.lineWidth = anchoTrazo((a.p + b.p) / 2);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

function dibujarForma(ctx: CanvasRenderingContext2D, f: ElementoForma) {
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  const [a, b] = f.puntos;
  if (f.forma === "rect") ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
  else if (f.forma === "elipse") ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, (b.x - a.x) / 2, (b.y - a.y) / 2, 0, 0, Math.PI * 2);
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

function fuente(tam: number) {
  return `${tam}px ${FUENTE}`;
}

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
  const area = Math.max(1, ancho(objetivo) * alto(objetivo));
  return areaInterseccion(objetivo, zona) / area;
}

export default function Hoja({ ref, inicial, automatico, reconocer, onCambio, onError }: Props) {
  const contenedor = useRef<HTMLDivElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const doc = useRef<Documento>(inicial);
  const historial = useRef<Documento[]>([]);
  const enVuelo = useRef(new Set<string>());
  const noLegibles = useRef(new Set<string>());
  const actual = useRef<{ id: number; puntos: Punto[]; inicio: number } | null>(null);
  const toqueDedo = useRef<{ id: number; x: number; y: number; t: number } | null>(null);
  const usaLapiz = useRef(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultimaLinea = useRef<{ id: string; t: number } | null>(null);
  const automaticoRef = useRef(automatico);
  const [editando, setEditando] = useState<string | null>(null);
  const [, refrescar] = useState(0);

  automaticoRef.current = automatico;

  function colorTinta() {
    return getComputedStyle(lienzo.current!).color;
  }

  function dibujar() {
    const c = lienzo.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const color = colorTinta();
    prepararPincel(ctx, color);
    for (const e of doc.current.elementos) {
      if (e.tipo === "forma") dibujarForma(ctx, e);
      else if (e.id !== editando) dibujarTexto(ctx, e);
    }
    for (const t of doc.current.tinta) {
      ctx.globalAlpha = enVuelo.current.has(t.id) ? 0.35 : 1;
      dibujarTrazo(ctx, t.puntos);
    }
    ctx.globalAlpha = 1;
  }

  function avisar() {
    dibujar();
    onCambio(doc.current, historial.current.length > 0);
    refrescar((n) => n + 1);
  }

  function guardarEstado() {
    historial.current.push(structuredClone(doc.current));
    if (historial.current.length > 60) historial.current.shift();
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
    return () => {
      observador.disconnect();
      tema.removeEventListener("change", dibujar);
      if (temporizador.current) clearTimeout(temporizador.current);
    };
    // Solo al montar: dibujar lee el documento desde refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(dibujar);

  function programarConversion() {
    if (temporizador.current) clearTimeout(temporizador.current);
    if (!automaticoRef.current) return;
    temporizador.current = setTimeout(() => void convertirPendiente(), PAUSA_MS);
  }

  async function convertirPendiente() {
    if (actual.current) return programarConversion();
    const pendientes = doc.current.tinta.filter((t) => !enVuelo.current.has(t.id) && !noLegibles.current.has(t.id));
    if (pendientes.length === 0) return;
    const grupos = agruparRenglones(pendientes);
    for (const t of pendientes) enVuelo.current.add(t.id);
    dibujar();
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
    deshacer() {
      const previo = historial.current.pop();
      if (!previo) return;
      doc.current = previo;
      setEditando(null);
      avisar();
    },
    nuevaHoja() {
      guardarEstado();
      doc.current = { tinta: [], elementos: [] };
      setEditando(null);
      avisar();
    },
    convertirAhora() {
      if (temporizador.current) clearTimeout(temporizador.current);
      void convertirPendiente();
    },
  }));

  function puntoDe(e: { clientX: number; clientY: number; pointerType: string; pressure: number }): Punto {
    const r = lienzo.current!.getBoundingClientRect();
    const p = e.pointerType === "mouse" || e.pressure === 0 ? 0.5 : e.pressure;
    return { x: e.clientX - r.left, y: e.clientY - r.top, p };
  }

  function textoEn(x: number, y: number) {
    const textos = doc.current.elementos.filter((e): e is ElementoTexto => e.tipo === "texto");
    return textos.reverse().find((t) => {
      const c = cajaDe(t);
      return x >= c.x0 - 6 && x <= c.x1 + 6 && y >= c.y0 - 6 && y <= c.y1 + 6;
    });
  }

  function procesarTrazo(puntos: Punto[], duracion: number) {
    const c = caja(puntos);
    const esToque = Math.max(ancho(c), alto(c)) < 5 && duracion < 350;

    if (esToque) {
      const t = textoEn(puntos[0].x, puntos[0].y);
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
        const medio = (c.y0 + c.y1) / 2;
        const cubre = Math.min(c.x1, ct.x1) - Math.max(c.x0, ct.x0);
        return medio > ct.y0 + alto(ct) * 0.2 && medio < ct.y1 - alto(ct) * 0.2 && cubre > 0.5 * ancho(ct);
      });
      if (tachado) {
        guardarEstado();
        doc.current = { ...doc.current, elementos: doc.current.elementos.filter((e) => e.id !== tachado.id) };
        return avisar();
      }
    }

    const reciente = ultimaLinea.current;
    if (reciente && Date.now() - reciente.t < 2500) {
      const linea = doc.current.elementos.find((e): e is ElementoForma => e.id === reciente.id && e.tipo === "forma");
      const extremo = linea ? puntaDeFlecha(puntos, linea) : null;
      if (linea && extremo !== null) {
        guardarEstado();
        const [a, b] = linea.puntos;
        const flecha: ElementoForma = { ...linea, forma: "flecha", puntos: extremo === 1 ? [a, b] : [b, a] };
        doc.current = { ...doc.current, elementos: doc.current.elementos.map((e) => (e.id === linea.id ? flecha : e)) };
        ultimaLinea.current = null;
        return avisar();
      }
    }

    const forma = reconocerForma(puntos);
    if (forma) {
      guardarEstado();
      const id = nuevoId();
      doc.current = { ...doc.current, elementos: [...doc.current.elementos, { ...forma, id }] };
      ultimaLinea.current = forma.forma === "linea" ? { id, t: Date.now() } : null;
      return avisar();
    }

    guardarEstado();
    doc.current = { ...doc.current, tinta: [...doc.current.tinta, { id: nuevoId(), puntos }] };
    avisar();
    programarConversion();
  }

  function abrirEdicion(id: string) {
    if (temporizador.current) clearTimeout(temporizador.current);
    guardarEstado();
    setEditando(id);
  }

  function alBajar(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "pen") usaLapiz.current = true;
    if (editando) setEditando(null);
    if (e.pointerType === "touch" && usaLapiz.current) {
      // Con el lápiz en uso, el dedo no dibuja: solo sirve para tocar un texto y editarlo.
      if (e.width < 40) toqueDedo.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now() };
      return;
    }
    if (actual.current) return;
    e.preventDefault();
    if (temporizador.current) clearTimeout(temporizador.current);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Sin captura el trazo igual funciona mientras el lápiz siga sobre la hoja.
    }
    actual.current = { id: e.pointerId, puntos: [puntoDe(e)], inicio: Date.now() };
    const ctx = e.currentTarget.getContext("2d")!;
    prepararPincel(ctx, colorTinta());
    dibujarTrazo(ctx, actual.current.puntos);
  }

  function alMover(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!actual.current || e.pointerId !== actual.current.id) return;
    const ctx = e.currentTarget.getContext("2d")!;
    prepararPincel(ctx, colorTinta());
    const agrupados = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of agrupados.length > 0 ? agrupados : [e.nativeEvent]) {
      const nuevo = puntoDe(ev);
      const previo = actual.current.puntos[actual.current.puntos.length - 1];
      actual.current.puntos.push(nuevo);
      dibujarTrazo(ctx, [previo, nuevo]);
    }
  }

  function alSubir(e: React.PointerEvent<HTMLCanvasElement>) {
    const dedo = toqueDedo.current;
    if (dedo && dedo.id === e.pointerId) {
      toqueDedo.current = null;
      const movido = Math.hypot(e.clientX - dedo.x, e.clientY - dedo.y);
      if (movido < 10 && Date.now() - dedo.t < 400) {
        const p = puntoDe(e);
        const t = textoEn(p.x, p.y);
        if (t) abrirEdicion(t.id);
      }
      return;
    }
    if (!actual.current || e.pointerId !== actual.current.id) return;
    const { puntos, inicio } = actual.current;
    actual.current = null;
    if (e.type === "pointercancel") return dibujar();
    procesarTrazo(puntos, Date.now() - inicio);
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
        className="hoja block h-[70vh] min-h-96 w-full rounded-xl border border-black/10 text-neutral-900 dark:border-white/10 dark:text-neutral-100"
        onPointerDown={alBajar}
        onPointerMove={alMover}
        onPointerUp={alSubir}
        onPointerCancel={alSubir}
      />
      {textoEditado && (
        <div
          className="absolute z-10 w-72 max-w-[calc(100%-1rem)] rounded-xl border border-black/10 bg-white p-2 shadow-lg dark:border-white/10 dark:bg-neutral-800"
          style={{
            left: Math.max(8, Math.min(textoEditado.x, (contenedor.current?.clientWidth ?? 400) - 296)),
            top: textoEditado.y,
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
