// Prepara las fotos en el navegador: convierte HEIC, reduce tamaño y aplica rotación.

const LADO_MAXIMO = 2000;

function esHeic(archivo: File) {
  return /image\/hei[cf]/i.test(archivo.type) || /\.hei[cf]$/i.test(archivo.name);
}

async function seDecodifica(blob: Blob) {
  try {
    (await createImageBitmap(blob)).close();
    return true;
  } catch {
    return false;
  }
}

/** Devuelve una imagen que el navegador puede dibujar; convierte HEIC solo si hace falta (Safari lo abre nativo). */
export async function aBlobLegible(archivo: File): Promise<Blob> {
  if (!esHeic(archivo) || (await seDecodifica(archivo))) return archivo;
  const { heicTo } = await import("heic-to/next");
  return heicTo({ blob: archivo, type: "image/jpeg", quality: 0.92 });
}

function cargarImagen(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo leer la imagen."));
    img.src = url;
  });
}

/** Devuelve un JPEG en base64 (sin prefijo data:) girado `grados` en sentido horario. */
export async function prepararJpeg(url: string, grados: number): Promise<string> {
  const img = await cargarImagen(url);
  const escala = Math.min(1, LADO_MAXIMO / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * escala);
  const h = Math.round(img.naturalHeight * escala);
  const girada = grados % 180 !== 0;

  const lienzo = document.createElement("canvas");
  lienzo.width = girada ? h : w;
  lienzo.height = girada ? w : h;
  const ctx = lienzo.getContext("2d")!;
  ctx.translate(lienzo.width / 2, lienzo.height / 2);
  ctx.rotate((grados * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);

  return lienzo.toDataURL("image/jpeg", 0.85).split(",")[1];
}
