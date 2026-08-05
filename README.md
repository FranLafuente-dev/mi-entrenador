# Mi Entrenador

PWA personal de entrenamiento. HTML, CSS y JavaScript vanilla, sin build:
lo que está en la carpeta es exactamente lo que se sirve desde GitHub Pages.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | Markup y arranque |
| `styles.css` | Todos los estilos (claro/oscuro) |
| `app.js` | Toda la lógica |
| `rutinas.js` | **La fuente de verdad de las rutinas.** Se edita a mano |
| `mensajes.js` | Los textos del sargento. Se edita a mano |
| `firebase-config.js` | Credenciales de Firebase (completar) |
| `manifest.json`, `sw.js` | PWA y funcionamiento offline |
| `REGLAS-A-AGREGAR.txt` | Bloque de reglas de Firestore a agregar |
| `img/`, `icons/`, `campana.mp3` | Assets, no tocar |

## Completar firebase-config.js

1. Firebase Console → tu proyecto (el mismo de Mis Finanzas) →
   **Project settings → General → Your apps** → app web → **SDK setup and configuration**.
2. Copiá los valores del objeto `firebaseConfig` (apiKey, authDomain, projectId,
   storageBucket, messagingSenderId, appId).
3. Abrí `firebase-config.js` y reemplazá cada `PEGAR_...` por su valor,
   entre comillas, sin tocar nada más.
4. Reglas: abrí `REGLAS-A-AGREGAR.txt` y seguí los pasos. Es un bloque que se
   **agrega** adentro de las reglas existentes; no reemplaces el archivo de
   reglas completo. La app solo usa la colección `entrenador`.

## Cambiar la rutina

Todo sale de `rutinas.js`. La app no edita rutinas: se cambia el archivo,
se sube, y listo.

- **Pesos sugeridos, reps, series, descansos**: editá los valores del
  ejercicio correspondiente (`pesoSugerido`, `reps`, `series`, `pesoPaso`).
- **Agregar o sacar un ejercicio**: copiá el formato de uno existente. El `id`
  tiene que ser único y estable (el historial se guarda por `id`); la imagen
  va en `img/ejercicios/` y se referencia por nombre de archivo.
- **Cambiar días de entreno/descanso**: editá `SEMANA` y `CONFIG.diasDescanso`.
- **Feriados**: agregalos al array `FERIADOS` del final, formato `"YYYY-MM-DD"`.
- Cuando hagas un cambio de rutina de verdad (no un feriado), actualizá
  `RUTINAS_VERSION`. Las sesiones viejas guardan su propio snapshot, así que
  el historial no se rompe.

Después del cambio: `git add . && git commit -m "Rutina" && git push`, y en
`sw.js` subí `VERSION` (ej. `"v2"`) para que los teléfonos se actualicen.

## Cambiar los mensajes del sargento

Editá `mensajes.js`. Cada situación tiene una lista de variantes; la app las
rota día a día. Podés agregar, sacar o reescribir variantes libremente —
mantené al menos una por situación. Las palabras entre llaves (`{racha}`,
`{rango}`, `{rutina}`…) las reemplaza la app; usá solo las que ya aparecen
en ese grupo. Después: commit, push y subir `VERSION` en `sw.js`.

## Subir cambios a GitHub Pages

```powershell
cd "C:\Mi Entrenador"
git add .
git commit -m "Descripción del cambio"
git push
```

GitHub Pages publica solo la rama `main`; uno o dos minutos después del push
el cambio está en `https://franlafuente-dev.github.io/mi-entrenador`.

Para que los iPhone/iPad tomen el cambio: subí `VERSION` en `sw.js` antes del
push, y en el dispositivo cerrá y volvé a abrir la app dos veces (la primera
descarga la versión nueva, la segunda la muestra).

## Notas de funcionamiento

- **Offline**: la app entera queda cacheada (incluido el SDK de Firebase).
  En el subsuelo sin señal se puede registrar todo; Firestore sincroniza solo
  al volver la conexión.
- **Campana**: el audio se desbloquea al tocar "Empezar entrenamiento".
  Si el iPhone está en silencio con el interruptor físico, no suena.
- **Fotos**: se comprimen en el navegador (~800 px, WebP/JPEG) y se guardan
  en Firestore en la subcolección `media` de cada día; el calendario y el
  historial no las descargan hasta que las abrís.
- **PDF**: la exportación usa jsPDF por CDN, necesita conexión.
- **Notificaciones**: no hay push; el aviso del mediodía lo maneja un Atajo
  de Apple por fuera de la app.
