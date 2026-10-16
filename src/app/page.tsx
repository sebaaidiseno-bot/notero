"use client";

import { useEffect, useRef, useState } from "react";
import Hoja, { type HojaApi } from "@/components/Hoja";
import type { Bloque } from "@/lib/esquema";
import { GLOSARIO_INICIAL } from "@/lib/glosario";
import { aBlobLegible, prepararJpeg } from "@/lib/imagen";
import { textoDelDocumento } from "@/lib/hoja/texto";
import { DOCUMENTO_VACIO, type Documento } from "@/lib/hoja/tipos";

const CLAVE_GLOSARIO = "notero:glosario";
const CLAVE_ACCESO = "notero:clave";
const CLAVE_HOJA = "notero:hoja";
const CLAVE_AUTOMATICO = "notero:automatico";

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
  const [puedeDeshacer, setPuedeDeshacer] = useState(false);
  const [automatico, setAutomatico] = useState(true);
  const [glosario, setGlosario] = useState(GLOSARIO_INICIAL);
  const [claveAcceso, setClaveAcceso] = useState("");
  const [pideClave, setPideClave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [leyendoFoto, setLeyendoFoto] = useState(false);
  const [textoFoto, setTextoFoto] = useState("");
  const claveRef = useRef("");
  const glosarioRef = useRef(GLOSARIO_INICIAL);
  claveRef.current = claveAcceso;
  glosarioRef.current = glosario;

  useEffect(() => {
    const g = leerLocal(CLAVE_GLOSARIO);
    if (g) setGlosario(g);
    const c = leerLocal(CLAVE_ACCESO);
    if (c) setClaveAcceso(c);
    if (leerLocal(CLAVE_AUTOMATICO) === "no") setAutomatico(false);
    let doc = DOCUMENTO_VACIO;
    try {
      const guardado = leerLocal(CLAVE_HOJA);
      if (guardado) doc = JSON.parse(guardado);
    } catch {}
    setInicial(doc);
    setTexto(textoDelDocumento(doc));
  }, []);

  async function reconocer(imagenes: Imagen[]): Promise<Bloque[]> {
    const res = await fetch("/api/transcribir", {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-password": claveRef.current },
      body: JSON.stringify({ imagenes, glosario: glosarioRef.current }),
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
    <main className="mx-auto max-w-5xl px-4 py-5 sm:py-8">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold tracking-tight">Notero</h1>
          <p className="text-sm opacity-70">Escribe a mano: al hacer una pausa, la tinta se convierte en texto.</p>
        </div>
        <button className="boton" disabled={!puedeDeshacer} onClick={() => hoja.current?.deshacer()}>
          Deshacer
        </button>
        <button
          className="boton"
          onClick={() => {
            if (window.confirm("¿Empezar una hoja nueva? Podrás deshacerlo.")) hoja.current?.nuevaHoja();
          }}
        >
          Hoja nueva
        </button>
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
      </header>

      {inicial ? (
        <Hoja
          ref={hoja}
          inicial={inicial}
          automatico={automatico}
          reconocer={(pngs) => reconocer(pngs.map((data) => ({ data, media_type: "image/png" })))}
          onCambio={(doc, deshacer) => {
            guardarLocal(CLAVE_HOJA, JSON.stringify(doc));
            setTexto(textoDelDocumento(doc));
            setPuedeDeshacer(deshacer);
          }}
          onError={setError}
        />
      ) : (
        <div className="hoja h-[70vh] min-h-96 rounded-xl border border-black/10 dark:border-white/10" />
      )}

      <details className="mt-2 text-xs opacity-70">
        <summary className="cursor-pointer select-none">Gestos</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>Tacha en zigzag sobre algo para borrarlo (tinta, texto o forma).</li>
          <li>Una raya horizontal sobre un texto ya convertido lo borra.</li>
          <li>Toca un texto convertido (con el lápiz o el dedo) para corregirlo, elegir otra lectura o borrarlo.</li>
          <li>Dibuja grande un círculo, rectángulo, triángulo, rombo o línea y quedará perfecto.</li>
          <li>Para una flecha, dibuja la línea con la punta en el mismo trazo, o la línea y luego una “V” en un extremo.</li>
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

      <details className="mt-6 text-sm">
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
