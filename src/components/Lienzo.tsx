"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

type Punto = { x: number; y: number; p: number };
type Trazo = Punto[];

export type LienzoApi = {
  /** PNG en base64 (sin prefijo data:) con tinta negra sobre blanco, recortado al contenido; null si está vacío. */
  exportar: () => string | null;
  deshacer: () => void;
  borrar: () => void;
};

const GROSOR = 2.6;
const LADO_MAXIMO_EXPORT = 2000;
const MARGEN_EXPORT = 24;

function anchoTrazo(p: number) {
  return GROSOR * (0.55 + p);
}

function dibujarTrazo(ctx: CanvasRenderingContext2D, trazo: Trazo) {
  if (trazo.length === 1) {
    const { x, y, p } = trazo[0];
    ctx.beginPath();
    ctx.arc(x, y, anchoTrazo(p) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = 1; i < trazo.length; i++) {
    const a = trazo[i - 1];
    const b = trazo[i];
    ctx.lineWidth = anchoTrazo((a.p + b.p) / 2);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

function prepararPincel(ctx: CanvasRenderingContext2D, color: string) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
}

export default function Lienzo({ ref, onCambio }: { ref: Ref<LienzoApi>; onCambio: (trazos: number) => void }) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const trazos = useRef<Trazo[]>([]);
  const actual = useRef<Trazo | null>(null);
  const punteroActivo = useRef<number | null>(null);
  const usaLapiz = useRef(false);

  function colorTinta() {
    return getComputedStyle(lienzo.current!).color;
  }

  function redibujar() {
    const c = lienzo.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    prepararPincel(ctx, colorTinta());
    for (const t of trazos.current) dibujarTrazo(ctx, t);
  }

  useEffect(() => {
    const c = lienzo.current!;
    const ajustar = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = c.getBoundingClientRect();
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
      redibujar();
    };
    ajustar();
    const observador = new ResizeObserver(ajustar);
    observador.observe(c);
    const tema = window.matchMedia("(prefers-color-scheme: dark)");
    tema.addEventListener("change", redibujar);
    return () => {
      observador.disconnect();
      tema.removeEventListener("change", redibujar);
    };
    // Solo al montar: redibujar lee los trazos desde refs, no desde el estado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    exportar() {
      const todos = trazos.current.flat();
      if (todos.length === 0) return null;
      const xs = todos.map((p) => p.x);
      const ys = todos.map((p) => p.y);
      const minX = Math.min(...xs) - MARGEN_EXPORT;
      const minY = Math.min(...ys) - MARGEN_EXPORT;
      const ancho = Math.max(...xs) - minX + MARGEN_EXPORT;
      const alto = Math.max(...ys) - minY + MARGEN_EXPORT;
      const escala = Math.min(2, LADO_MAXIMO_EXPORT / Math.max(ancho, alto));

      const salida = document.createElement("canvas");
      salida.width = Math.round(ancho * escala);
      salida.height = Math.round(alto * escala);
      const ctx = salida.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, salida.width, salida.height);
      ctx.setTransform(escala, 0, 0, escala, -minX * escala, -minY * escala);
      prepararPincel(ctx, "#000000");
      for (const t of trazos.current) dibujarTrazo(ctx, t);
      return salida.toDataURL("image/png").split(",")[1];
    },
    deshacer() {
      trazos.current.pop();
      redibujar();
      onCambio(trazos.current.length);
    },
    borrar() {
      trazos.current = [];
      redibujar();
      onCambio(0);
    },
  }));

  function punto(e: PointerEvent | React.PointerEvent): Punto {
    const r = lienzo.current!.getBoundingClientRect();
    const p = e.pointerType === "mouse" || e.pressure === 0 ? 0.5 : e.pressure;
    return { x: e.clientX - r.left, y: e.clientY - r.top, p };
  }

  function alBajar(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "pen") usaLapiz.current = true;
    // Rechazo de palma: con el lápiz en uso, los toques con la mano no dibujan.
    if (e.pointerType === "touch" && usaLapiz.current) return;
    if (punteroActivo.current !== null) return;
    e.preventDefault();
    punteroActivo.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Sin captura el trazo igual funciona mientras el lápiz siga sobre la hoja.
    }
    actual.current = [punto(e)];
    const ctx = e.currentTarget.getContext("2d")!;
    prepararPincel(ctx, colorTinta());
    dibujarTrazo(ctx, actual.current);
  }

  function alMover(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerId !== punteroActivo.current || !actual.current) return;
    const ctx = e.currentTarget.getContext("2d")!;
    prepararPincel(ctx, colorTinta());
    const agrupados = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const eventos = agrupados.length > 0 ? agrupados : [e.nativeEvent];
    for (const ev of eventos) {
      const nuevo = punto(ev);
      const previo = actual.current[actual.current.length - 1];
      actual.current.push(nuevo);
      dibujarTrazo(ctx, [previo, nuevo]);
    }
  }

  function alSubir(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerId !== punteroActivo.current) return;
    punteroActivo.current = null;
    if (actual.current) trazos.current.push(actual.current);
    actual.current = null;
    onCambio(trazos.current.length);
  }

  return (
    <canvas
      ref={lienzo}
      className="hoja block h-[60vh] min-h-80 w-full rounded-xl border border-black/10 text-neutral-900 dark:border-white/10 dark:text-neutral-100"
      onPointerDown={alBajar}
      onPointerMove={alMover}
      onPointerUp={alSubir}
      onPointerCancel={alSubir}
    />
  );
}
