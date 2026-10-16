"use client";

import { useEffect, useRef, useState } from "react";
import Hoja, { type EstadoHistorial, type HojaApi } from "@/components/Hoja";
import type { Bloque } from "@/lib/esquema";
import { aBlobLegible, prepararJpeg } from "@/lib/imagen";
import { textoDelDocumento } from "@/lib/hoja/texto";
import { DOCUMENTO_VACIO, type Color, type Documento, type Papel } from "@/lib/hoja/tipos";

const CLAVE_ACCESO = "notero:clave";
const CLAVE_HOJA = "notero:hoja";
const CLAVE_AUTOMATICO = "notero:automatico";
const CLAVE_PAPEL = "notero:papel";

const COLORES: { valor: Color; nombre: string; muestra: string }[] = [
  { valor: "negro", nombre: "Negro", muestra: "bg-neutral-900 dark:bg-neutral-100" },
  { valor: "rojo", nombre: "Rojo", muestra: "bg-[#d22b2b] dark:bg-[#ff7070]" },
  { valor: "azul", nombre: "Azul", muestra: "bg-[#1d5fd6] dark:bg-[#74a7ff]" },
];

const PAPELES: { valor: Papel; nombre: string }[] = [
  { valor: "cuadricula", nombre: "Cuadriculado" },
  { valor: "lineas", nombre: "Rayado" },
  { valor: "puntos", nombre: "Punteado" },
  { valor: "blanco", nombre: "En blanco" },
];

function leerLocal(clave: string) {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}
function guardarLocal(clave: string, valor: string) {
  try {
    localStorage.setItem(clave, valor);
  } catch {}
}

type Imagen = { data: string; media_type: "image/png" | "image/jpeg" };

export default function Inicio() {
  const hoja = useRef<HojaApi>(null);
  const inputFoto = useRef<HTMLInputElement>(null);
  const [inicial, setInicial] = useState<Documento | null>(null);
  const [texto, setTexto] = useState("");
  const [historial, setHistorial] = useState<EstadoHistorial>({ puedeDeshacer: false, puedeRehacer: false });
  const [automatico, setAutomatico] = useState(true);
  const [color, setColor] = useState<Color>("negro");
  const [papel, setPapel] = useState<Papel>("cuadricula");
  const [claveAcceso, setClaveAcceso] = useState("");
  const [pideClave, setPideClave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [leyendoFoto, setLeyendoFoto] = useState(false);
  const [textoFoto, setTextoFoto] = useState("");
  const claveRef = useRef("");
  const avisoTemporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  claveRef.current = claveAcceso;

  useEffect(() => {
    const c = leerLocal(CLAVE_ACCESO);
    if (c) setClaveAcceso(c);
    if (leerLocal(CLAVE_AUTOMATICO) === "no") setAutomatico(false);
    const p = leerLocal(CLAVE_PAPEL);
    if (p && PAPELES.some((x) => x.valor === p)) setPapel(p as Papel);
    let doc = DOCUMENTO_VACIO;
    try {
      const guardado = leerLocal(CLAVE_HOJA);
      if (guardado) doc = JSON.parse(guardado);
    } catch {}
    setInicial(doc);
    setTexto(textoDelDocumento(doc));
  }, []);

  function mostrarAviso(mensaje: string) {
    setAviso(mensaje);
    if (avisoTemporizador.current) clearTimeout(avisoTemporizador.current);
    avisoTemporizador.current = setTimeout(() => setAviso(null), 1200);
  }

  async function reconocer(imagenes: Imagen[]): Promise<Bloque[]> {
    const res = await fetch("/api/transcribir", {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-password": claveRef.current },
      body: JSON.stringify({ imagenes }),
    });
    const datos = await res.json().catch(() => ({ error: `Error del servidor (${res.status}).` }));
    if (res.status === 401) {
      setPideClave(true);
      throw new Error("Escribe la clave de acceso de la app; la hoja se convertirá en tu próxima pausa.");
    }
    if (!res.ok) throw new Error(datos.error ?? `Error del servidor (${res.status}).`);
    setError(null);
    return datos.resultado.bloques;
  }

  async function convertirFoto(lista: FileList | null) {
    const archivo = lista?.[0];
    if (!archivo) return;
    setLeyendoFoto(true);
    setError(null);
    try {
      const blob = await aBlobLegible(archivo);
      const url = URL.createObjectURL(blob);
      const data = await prepararJpeg(url, 0);
      URL.revokeObjectURL(url);
      const [bloque] = await reconocer([{ data, media_type: "image/jpeg" }]);
      setTextoFoto(bloque?.texto ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer la foto.");
    } finally {
      setLeyendoFoto(false);
    }
  }

  async function copiar(valor: string) {
    await navigator.clipboard.writeText(valor);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1800);
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-4 sm:py-6">
      <header className="mb-3 flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Notero</h1>
        <p className="text-sm opacity-60">Escribe a mano: al hacer una pausa, la tinta se convierte en texto.</p>
      </header>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-black/15 px-2 py-1 dark:border-white/15" role="radiogroup" aria-label="Color de tinta">
          {COLORES.map((c) => (
            <button
              key={c.valor}
              role="radio"
              aria-checked={color === c.valor}
              aria-label={c.nombre}
              title={c.nombre}
              className={`size-7 rounded-full ${c.muestra} ${
                color === c.valor ? "ring-2 ring-emerald-600 ring-offset-2 ring-offset-[var(--background)]" : ""
              }`}
              onClick={() => setColor(c.valor)}
            />
          ))}
        </div>

        <select
          aria-label="Tipo de hoja"
          className="boton bg-transparent"
          value={papel}
          onChange={(e) => {
            setPapel(e.target.value as Papel);
            guardarLocal(CLAVE_PAPEL, e.target.value);
          }}
        >
          {PAPELES.map((p) => (
            <option key={p.valor} value={p.valor}>
              {p.nombre}
            </option>
          ))}
        </select>

        <button className="boton" aria-label="Deshacer" disabled={!historial.puedeDeshacer} onClick={() => hoja.current?.deshacer()}>
          ↶ Deshacer
        </button>
        <button className="boton" aria-label="Rehacer" disabled={!historial.puedeRehacer} onClick={() => hoja.current?.rehacer()}>
          Rehacer ↷
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="boton flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              className="accent-emerald-700"
              checked={automatico}
              onChange={(e) => {
                setAutomatico(e.target.checked);
                guardarLocal(CLAVE_AUTOMATICO, e.target.checked ? "si" : "no");
              }}
            />
            Convertir al pausar
          </label>
          {!automatico && (
            <button className="boton-primario" onClick={() => hoja.current?.convertirAhora()}>
              Convertir ahora
            </button>
          )}
          <button
            className="boton"
            onClick={() => {
              if (window.confirm("¿Empezar una hoja nueva? Podrás deshacerlo.")) hoja.current?.nuevaHoja();
            }}
          >
            Hoja nueva
          </button>
        </div>
      </div>

      <div className="relative">
        {inicial ? (
          <Hoja
            ref={hoja}
            inicial={inicial}
            automatico={automatico}
            color={color}
            papel={papel}
            reconocer={(pngs) => reconocer(pngs.map((data) => ({ data, media_type: "image/png" })))}
            onCambio={(doc, h) => {
              guardarLocal(CLAVE_HOJA, JSON.stringify(doc));
              setTexto(textoDelDocumento(doc));
              setHistorial(h);
            }}
            onError={setError}
            onAviso={mostrarAviso}
          />
        ) : (
          <div className={`hoja papel-${papel} h-[72vh] min-h-96 rounded-xl border border-black/10 dark:border-white/10`} />
        )}
        {aviso && (
          <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-neutral-900/85 px-4 py-1.5 text-sm text-white dark:bg-white/90 dark:text-neutral-900">
            {aviso}
          </div>
        )}
      </div>

      <details className="mt-2 text-xs opacity-70">
        <summary className="cursor-pointer">Gestos</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>Lápiz: escribe y dibuja. Al hacer una pausa, cada renglón escrito se convierte en texto.</li>
          <li>Para una forma perfecta, al terminar el trazo deja el lápiz quieto medio segundo: círculo, rectángulo, triángulo, rombo, línea o flecha.</li>
          <li>Para una flecha: dibuja la línea con la punta en el mismo trazo, o una línea y luego una “V” en un extremo (manteniendo el lápiz quieto al terminar).</li>
          <li>Tacha en zigzag sobre algo para borrarlo. Una raya horizontal sobre un texto convertido lo borra.</li>
          <li>Dedo: arrastra formas y textos para moverlos; toca un texto para corregirlo; desliza a la izquierda para deshacer y a la derecha para rehacer.</li>
          <li>Con el Apple Pencil, la mano apoyada no dibuja.</li>
        </ul>
      </details>

      {error && <p className="mt-3 text-sm text-red-700 dark:text-red-400">{error}</p>}

      {pideClave && (
        <label className="mt-3 block max-w-sm text-sm">
          Clave de acceso
          <input
            type="password"
            className="mt-1 block w-full rounded-lg border border-black/15 bg-transparent px-2 py-1.5 dark:border-white/15"
            value={claveAcceso}
            onChange={(e) => {
              setClaveAcceso(e.target.value);
              guardarLocal(CLAVE_ACCESO, e.target.value);
            }}
          />
        </label>
      )}

      <section className="mt-6">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-medium">Texto de la hoja</h2>
          <button className="boton ml-auto" disabled={!texto} onClick={() => copiar(texto)}>
            {copiado ? "Copiado" : "Copiar"}
          </button>
        </div>
        <pre className="min-h-24 whitespace-pre-wrap rounded-xl border border-black/10 bg-white p-3 font-mono text-sm leading-relaxed dark:border-white/10 dark:bg-white/5">
          {texto || <span className="opacity-50">Aquí aparecerá el texto convertido de la hoja.</span>}
        </pre>
      </section>

      <section className="mt-6">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-medium">Foto de un cuaderno</h2>
          <button className="boton ml-auto" disabled={leyendoFoto} onClick={() => inputFoto.current?.click()}>
            {leyendoFoto ? "Leyendo foto…" : "Convertir una foto"}
          </button>
          {textoFoto && (
            <button className="boton" onClick={() => copiar(textoFoto)}>
              Copiar
            </button>
          )}
          <input
            ref={inputFoto}
            type="file"
            accept="image/*,.heic,.heif"
            hidden
            onChange={(e) => {
              convertirFoto(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {textoFoto && (
          <textarea
            className="h-48 w-full rounded-xl border border-black/10 bg-white p-3 font-mono text-sm dark:border-white/10 dark:bg-white/5"
            value={textoFoto}
            onChange={(e) => setTextoFoto(e.target.value)}
          />
        )}
      </section>
    </main>
  );
}
