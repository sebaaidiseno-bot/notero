"use client";

import { useEffect, useRef, useState } from "react";
import Lienzo, { type LienzoApi } from "@/components/Lienzo";
import type { Duda, Reconocimiento } from "@/lib/esquema";
import { GLOSARIO_INICIAL } from "@/lib/glosario";
import { aBlobLegible, prepararJpeg } from "@/lib/imagen";

const CLAVE_GLOSARIO = "notero:glosario";
const CLAVE_ACCESO = "notero:clave";
const CLAVE_TEXTO = "notero:texto";

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
  const hoja = useRef<LienzoApi>(null);
  const inputFoto = useRef<HTMLInputElement>(null);
  const [trazos, setTrazos] = useState(0);
  const [texto, setTexto] = useState("");
  const [dudas, setDudas] = useState<Duda[]>([]);
  const [glosario, setGlosario] = useState(GLOSARIO_INICIAL);
  const [claveAcceso, setClaveAcceso] = useState("");
  const [pideClave, setPideClave] = useState(false);
  const [ocupado, setOcupado] = useState<null | "hoja" | "foto">(null);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    const g = leerLocal(CLAVE_GLOSARIO);
    if (g) setGlosario(g);
    const c = leerLocal(CLAVE_ACCESO);
    if (c) setClaveAcceso(c);
    const t = leerLocal(CLAVE_TEXTO);
    if (t) setTexto(t);
  }, []);

  function actualizarTexto(nuevo: string) {
    setTexto(nuevo);
    guardarLocal(CLAVE_TEXTO, nuevo);
  }

  async function reconocer(imagen: Imagen): Promise<Reconocimiento | null> {
    const res = await fetch("/api/transcribir", {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-password": claveAcceso },
      body: JSON.stringify({ imagenes: [imagen], glosario }),
    });
    const datos = await res.json().catch(() => ({ error: `Error del servidor (${res.status}).` }));
    if (res.status === 401) {
      setPideClave(true);
      setError("Escribe la clave de acceso de la app y vuelve a intentarlo.");
      return null;
    }
    if (!res.ok) throw new Error(datos.error ?? `Error del servidor (${res.status}).`);
    return datos.resultado;
  }

  function agregar(r: Reconocimiento) {
    const limpio = r.texto.replace(/\s+$/, "");
    actualizarTexto(texto.trim() ? `${texto.replace(/\s+$/, "")}\n\n${limpio}` : limpio);
    setDudas(r.dudas);
  }

  async function convertirHoja() {
    const data = hoja.current?.exportar();
    if (!data) return;
    setOcupado("hoja");
    setError(null);
    try {
      const r = await reconocer({ data, media_type: "image/png" });
      if (r) {
        agregar(r);
        hoja.current?.borrar();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Algo salió mal.");
    } finally {
      setOcupado(null);
    }
  }

  async function convertirFoto(lista: FileList | null) {
    const archivo = lista?.[0];
    if (!archivo) return;
    setOcupado("foto");
    setError(null);
    try {
      const blob = await aBlobLegible(archivo);
      const url = URL.createObjectURL(blob);
      const data = await prepararJpeg(url, 0);
      URL.revokeObjectURL(url);
      const r = await reconocer({ data, media_type: "image/jpeg" });
      if (r) agregar(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer la foto.");
    } finally {
      setOcupado(null);
    }
  }

  function elegirAlternativa(d: Duda, alternativa: string) {
    const i = texto.lastIndexOf(d.leido);
    if (i >= 0) actualizarTexto(texto.slice(0, i) + alternativa + texto.slice(i + d.leido.length));
    setDudas((ds) => ds.filter((x) => x !== d));
  }

  async function copiar() {
    await navigator.clipboard.writeText(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1800);
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:py-10">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notero</h1>
          <p className="mt-1 text-sm opacity-70">Escribe a mano con el lápiz y conviértelo en texto.</p>
        </div>
        <button className="boton" disabled={ocupado !== null} onClick={() => inputFoto.current?.click()}>
          {ocupado === "foto" ? "Leyendo foto…" : "Convertir una foto"}
        </button>
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
      </header>

      <div className="mb-2 flex flex-wrap gap-2">
        <button className="boton" disabled={trazos === 0 || ocupado !== null} onClick={() => hoja.current?.deshacer()}>
          Deshacer
        </button>
        <button className="boton" disabled={trazos === 0 || ocupado !== null} onClick={() => hoja.current?.borrar()}>
          Borrar hoja
        </button>
        <button
          className="boton-primario ml-auto"
          disabled={trazos === 0 || ocupado !== null}
          onClick={convertirHoja}
        >
          {ocupado === "hoja" ? "Convirtiendo…" : "Convertir a texto"}
        </button>
      </div>

      <Lienzo ref={hoja} onCambio={setTrazos} />
      <p className="mt-1.5 text-xs opacity-60">
        Con el Apple Pencil, los toques de la mano se ignoran. Al convertir, la hoja se limpia para seguir escribiendo.
      </p>

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
          <h2 className="text-sm font-medium">Texto</h2>
          <div className="ml-auto flex gap-2">
            <button className="boton" disabled={!texto} onClick={copiar}>
              {copiado ? "Copiado" : "Copiar"}
            </button>
            <button
              className="boton"
              disabled={!texto}
              onClick={() => {
                actualizarTexto("");
                setDudas([]);
              }}
            >
              Limpiar
            </button>
          </div>
        </div>

        {dudas.length > 0 && (
          <div className="mb-2 space-y-1 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
            <p>{dudas.length === 1 ? "Una palabra dudosa" : `${dudas.length} palabras dudosas`}; toca la correcta:</p>
            {dudas.map((d) => (
              <div key={d.leido} className="flex flex-wrap items-center gap-1 text-xs">
                <span className="font-medium">¿{d.leido}?</span>
                {d.alternativas.map((alt) => (
                  <button
                    key={alt}
                    className="rounded border border-amber-900/25 px-1.5 py-0.5 dark:border-amber-200/30"
                    onClick={() => elegirAlternativa(d, alt)}
                  >
                    {alt}
                  </button>
                ))}
                <button className="px-1 opacity-60" onClick={() => setDudas((ds) => ds.filter((x) => x !== d))}>
                  ✓ dejar
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          className="h-56 w-full rounded-xl border border-black/10 bg-white p-3 font-mono text-sm leading-relaxed dark:border-white/10 dark:bg-white/5"
          placeholder="Aquí aparecerá lo que escribas."
          value={texto}
          onChange={(e) => actualizarTexto(e.target.value)}
        />
      </section>

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer select-none opacity-80">Glosario de siglas y nombres</summary>
        <textarea
          className="mt-2 h-48 w-full rounded-lg border border-black/15 bg-transparent p-2 font-mono text-xs dark:border-white/15"
          value={glosario}
          onChange={(e) => {
            setGlosario(e.target.value);
            guardarLocal(CLAVE_GLOSARIO, e.target.value);
          }}
        />
        <button
          className="mt-1 text-xs underline opacity-70"
          onClick={() => {
            setGlosario(GLOSARIO_INICIAL);
            guardarLocal(CLAVE_GLOSARIO, GLOSARIO_INICIAL);
          }}
        >
          Restaurar glosario original
        </button>
      </details>
    </main>
  );
}
