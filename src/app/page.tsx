"use client";

import { useEffect, useRef, useState } from "react";
import type { Duda, Estado, Marca, Transcripcion } from "@/lib/esquema";
import { GLOSARIO_INICIAL } from "@/lib/glosario";
import { aBlobLegible, prepararJpeg } from "@/lib/imagen";
import { ETIQUETA_ESTADO, ETIQUETA_MARCA, aMarkdown } from "@/lib/exportar";

type Foto = { id: string; nombre: string; url: string; grados: number };

const CLAVE_GLOSARIO = "notas-a-tareas:glosario";
const CLAVE_ACCESO = "notas-a-tareas:clave";

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

export default function Inicio() {
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [cargandoFotos, setCargandoFotos] = useState(false);
  const [glosario, setGlosario] = useState(GLOSARIO_INICIAL);
  const [claveAcceso, setClaveAcceso] = useState("");
  const [pideClave, setPideClave] = useState(false);
  const [estado, setEstado] = useState<"inicio" | "leyendo" | "listo">("inicio");
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Transcripcion | null>(null);
  const [vista, setVista] = useState<"tareas" | "literal">("tareas");
  const [copiado, setCopiado] = useState(false);
  const inputArchivos = useRef<HTMLInputElement>(null);
  const inputCamara = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const g = leerLocal(CLAVE_GLOSARIO);
    if (g) setGlosario(g);
    const c = leerLocal(CLAVE_ACCESO);
    if (c) setClaveAcceso(c);
  }, []);

  async function agregarArchivos(lista: FileList | null) {
    if (!lista?.length) return;
    setCargandoFotos(true);
    setError(null);
    try {
      const nuevas: Foto[] = [];
      for (const archivo of Array.from(lista)) {
        const blob = await aBlobLegible(archivo);
        nuevas.push({ id: crypto.randomUUID(), nombre: archivo.name, url: URL.createObjectURL(blob), grados: 0 });
      }
      setFotos((f) => [...f, ...nuevas].slice(0, 6));
    } catch {
      setError("No se pudo abrir una de las fotos. Prueba exportarla como JPG.");
    } finally {
      setCargandoFotos(false);
    }
  }

  function girar(id: string, paso: 90 | -90) {
    setFotos((f) => f.map((x) => (x.id === id ? { ...x, grados: (x.grados + paso + 360) % 360 } : x)));
  }
  function quitar(id: string) {
    setFotos((f) => {
      const foto = f.find((x) => x.id === id);
      if (foto) URL.revokeObjectURL(foto.url);
      return f.filter((x) => x.id !== id);
    });
  }

  async function transcribir() {
    setEstado("leyendo");
    setError(null);
    try {
      const imagenes = await Promise.all(
        fotos.map(async (f) => ({ data: await prepararJpeg(f.url, f.grados), media_type: "image/jpeg" })),
      );
      const res = await fetch("/api/transcribir", {
        method: "POST",
        headers: { "content-type": "application/json", "x-app-password": claveAcceso },
        body: JSON.stringify({ imagenes, glosario }),
      });
      const datos = await res.json().catch(() => ({ error: `Error del servidor (${res.status}).` }));
      if (res.status === 401) setPideClave(true);
      if (!res.ok) throw new Error(datos.error ?? `Error del servidor (${res.status}).`);
      setResultado(datos.resultado);
      setVista("tareas");
      setEstado("listo");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Algo salió mal.");
      setEstado(resultado ? "listo" : "inicio");
    }
  }

  function editar(cambio: (t: Transcripcion) => void) {
    setResultado((r) => {
      if (!r) return r;
      const copia = structuredClone(r);
      cambio(copia);
      return copia;
    });
  }

  async function copiarMarkdown() {
    if (!resultado) return;
    await navigator.clipboard.writeText(aMarkdown(resultado));
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1800);
  }

  function descargarJson() {
    if (!resultado) return;
    const blob = new Blob([JSON.stringify(resultado, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tareas-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const totalDudas =
    resultado?.paginas.reduce(
      (n, p) => n + p.proyectos.reduce((m, pr) => m + pr.dudas.length + pr.tareas.reduce((k, t) => k + t.dudas.length, 0), 0),
      0,
    ) ?? 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Notas a tareas</h1>
        <p className="mt-1 text-sm opacity-70">
          Fotografía tu cuaderno y conviértelo en proyectos y tareas que puedes revisar antes de guardar.
        </p>
      </header>

      <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/5">
        <div className="flex flex-wrap gap-2">
          <button className="boton-primario" onClick={() => inputCamara.current?.click()}>
            Tomar foto
          </button>
          <button className="boton" onClick={() => inputArchivos.current?.click()}>
            Subir fotos
          </button>
          <input
            ref={inputCamara}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              agregarArchivos(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={inputArchivos}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            hidden
            onChange={(e) => {
              agregarArchivos(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {cargandoFotos && <p className="mt-3 text-sm opacity-70">Abriendo fotos…</p>}

        {fotos.length > 0 && (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {fotos.map((f) => (
              <li key={f.id} className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
                <div className="flex aspect-square items-center justify-center bg-black/5 dark:bg-white/5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={f.url}
                    alt={f.nombre}
                    className="max-h-full max-w-full object-contain transition-transform"
                    style={{ transform: `rotate(${f.grados}deg)` }}
                  />
                </div>
                <div className="flex text-sm">
                  <button
                    className="flex-1 py-2 hover:bg-black/5 dark:hover:bg-white/10"
                    aria-label="Girar a la izquierda"
                    onClick={() => girar(f.id, -90)}
                  >
                    ↺
                  </button>
                  <button
                    className="flex-1 py-2 hover:bg-black/5 dark:hover:bg-white/10"
                    aria-label="Girar a la derecha"
                    onClick={() => girar(f.id, 90)}
                  >
                    ↻
                  </button>
                  <button className="flex-1 py-2 hover:bg-black/5 dark:hover:bg-white/10" onClick={() => quitar(f.id)}>
                    Quitar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {fotos.length > 0 && (
          <p className="mt-2 text-xs opacity-60">Gira cada foto hasta que el texto quede derecho: mejora la lectura.</p>
        )}

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

        {pideClave && (
          <label className="mt-4 block text-sm">
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

        <button
          className="boton-primario mt-4 w-full"
          disabled={fotos.length === 0 || estado === "leyendo" || cargandoFotos}
          onClick={transcribir}
        >
          {estado === "leyendo" ? "Leyendo tu letra… (puede tardar un minuto)" : "Transcribir"}
        </button>
        {error && <p className="mt-3 text-sm text-red-700 dark:text-red-400">{error}</p>}
      </section>

      {resultado && (
        <section className="mt-8">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-black/10 p-0.5 text-sm dark:border-white/10">
              {(["tareas", "literal"] as const).map((v) => (
                <button
                  key={v}
                  className={`rounded-md px-3 py-1 ${vista === v ? "bg-black/10 dark:bg-white/15" : "opacity-70"}`}
                  onClick={() => setVista(v)}
                >
                  {v === "tareas" ? "Tareas" : "Texto literal"}
                </button>
              ))}
            </div>
            <div className="ml-auto flex gap-2">
              <button className="boton" onClick={copiarMarkdown}>
                {copiado ? "Copiado" : "Copiar Markdown"}
              </button>
              <button className="boton" onClick={descargarJson}>
                Descargar JSON
              </button>
            </div>
          </div>

          {totalDudas > 0 && vista === "tareas" && (
            <p className="mb-4 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
              {totalDudas === 1
                ? "Hay 1 palabra que no se leyó con seguridad."
                : `Hay ${totalDudas} palabras que no se leyeron con seguridad.`} Toca una
              alternativa para reemplazarla, o edita el texto directamente.
            </p>
          )}

          {vista === "literal" ? (
            <pre className="whitespace-pre-wrap rounded-xl border border-black/10 bg-white p-4 font-mono text-sm dark:border-white/10 dark:bg-white/5">
              {resultado.texto_literal}
            </pre>
          ) : (
            <div className="space-y-6">
              {resultado.paginas.map((pagina, ip) => (
                <div key={ip} className="space-y-3">
                  {(pagina.encabezado || pagina.fecha) && (
                    <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
                      {[pagina.encabezado, pagina.fecha].filter(Boolean).join(" · ")}
                    </h2>
                  )}
                  {pagina.proyectos.map((proyecto, ipr) => (
                    <article
                      key={ipr}
                      className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/5"
                    >
                      <div className="flex items-start gap-2">
                        <input
                          className="campo flex-1 text-base font-semibold"
                          value={proyecto.titulo}
                          onChange={(e) => editar((t) => void (t.paginas[ip].proyectos[ipr].titulo = e.target.value))}
                        />
                        <SelectorEstado
                          valor={proyecto.estado}
                          onCambio={(v) => editar((t) => void (t.paginas[ip].proyectos[ipr].estado = v))}
                        />
                      </div>
                      {proyecto.titulo_expandido && proyecto.titulo_expandido !== proyecto.titulo && (
                        <p className="px-1 text-xs opacity-60">{proyecto.titulo_expandido}</p>
                      )}
                      <Marcas marcas={proyecto.marcas} />
                      <Dudas
                        dudas={proyecto.dudas}
                        onElegir={(d, alt) =>
                          editar((t) => {
                            const p = t.paginas[ip].proyectos[ipr];
                            p.titulo = p.titulo.replace(d.leido, alt);
                            p.dudas = p.dudas.filter((x) => x.leido !== d.leido);
                          })
                        }
                      />

                      <ul className="mt-3 space-y-2">
                        {proyecto.tareas.map((tarea, it) => (
                          <li key={it}>
                            <div className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                className="mt-2 size-4 accent-emerald-700"
                                checked={tarea.estado === "realizado"}
                                onChange={(e) =>
                                  editar(
                                    (t) =>
                                      void (t.paginas[ip].proyectos[ipr].tareas[it].estado = e.target.checked
                                        ? "realizado"
                                        : "pendiente"),
                                  )
                                }
                              />
                              <div className="flex-1">
                                <input
                                  className={`campo w-full ${tarea.estado === "realizado" ? "line-through opacity-60" : ""}`}
                                  value={tarea.texto}
                                  onChange={(e) =>
                                    editar((t) => void (t.paginas[ip].proyectos[ipr].tareas[it].texto = e.target.value))
                                  }
                                />
                                {tarea.texto_expandido && tarea.texto_expandido !== tarea.texto && (
                                  <p className="px-1 text-xs opacity-60">{tarea.texto_expandido}</p>
                                )}
                                <Marcas marcas={tarea.marcas} estado={tarea.estado} />
                                <Dudas
                                  dudas={tarea.dudas}
                                  onElegir={(d, alt) =>
                                    editar((t) => {
                                      const x = t.paginas[ip].proyectos[ipr].tareas[it];
                                      x.texto = x.texto.replace(d.leido, alt);
                                      if (x.texto_expandido) x.texto_expandido = x.texto_expandido.replace(d.leido, alt);
                                      x.dudas = x.dudas.filter((y) => y.leido !== d.leido);
                                    })
                                  }
                                />
                                {tarea.detalles.length > 0 && (
                                  <ul className="mt-1 space-y-1 border-l border-black/10 pl-3 dark:border-white/15">
                                    {tarea.detalles.map((det, id) => (
                                      <li key={id} className="flex items-center gap-2 text-sm">
                                        <span className="opacity-50">↳</span>
                                        <input
                                          className={`campo flex-1 ${det.estado === "realizado" ? "line-through opacity-60" : ""}`}
                                          value={det.texto}
                                          onChange={(e) =>
                                            editar(
                                              (t) =>
                                                void (t.paginas[ip].proyectos[ipr].tareas[it].detalles[id].texto =
                                                  e.target.value),
                                            )
                                          }
                                        />
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function SelectorEstado({ valor, onCambio }: { valor: Estado; onCambio: (v: Estado) => void }) {
  return (
    <select
      className="rounded-md border border-black/15 bg-transparent px-1.5 py-1 text-xs dark:border-white/15"
      value={valor}
      onChange={(e) => onCambio(e.target.value as Estado)}
    >
      {(Object.keys(ETIQUETA_ESTADO) as Estado[]).map((e) => (
        <option key={e} value={e}>
          {ETIQUETA_ESTADO[e]}
        </option>
      ))}
    </select>
  );
}

function Marcas({ marcas, estado }: { marcas: Marca[]; estado?: Estado }) {
  const extra = estado === "movido" || estado === "en_proceso" ? [ETIQUETA_ESTADO[estado]] : [];
  const todas = [...extra, ...marcas.map((m) => ETIQUETA_MARCA[m])];
  if (todas.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1 px-1">
      {todas.map((m) => (
        <span
          key={m}
          className={`rounded-full px-2 py-0.5 text-xs ${
            m === "Urgente"
              ? "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200"
              : "bg-black/5 dark:bg-white/10"
          }`}
        >
          {m}
        </span>
      ))}
    </div>
  );
}

function Dudas({ dudas, onElegir }: { dudas: Duda[]; onElegir: (d: Duda, alternativa: string) => void }) {
  if (dudas.length === 0) return null;
  return (
    <div className="mt-1 space-y-1 px-1">
      {dudas.map((d) => (
        <div key={d.leido} className="flex flex-wrap items-center gap-1 text-xs">
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
            ¿{d.leido}?
          </span>
          {d.alternativas.map((alt) => (
            <button
              key={alt}
              className="rounded border border-black/15 px-1.5 py-0.5 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
              onClick={() => onElegir(d, alt)}
            >
              {alt}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
