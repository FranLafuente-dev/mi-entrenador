# MI ENTRENADOR — Construcción completa

Vas a construir una PWA personal de entrenamiento para una sola persona (Fran), instalable en iPhone y iPad, con sincronización entre dispositivos, hosteada en GitHub Pages.

**Antes de escribir una línea de código, leé estos archivos que ya están en la carpeta:**

- `rutinas.js` — las dos rutinas completas, los rangos, la configuración y las sesiones semilla. **Es la fuente de verdad. No lo modifiques.** Todo lo que la app muestre sobre ejercicios, series, reps, pesos, imágenes y tiempos sale de ahí. No hardcodees nada de esto en el código.
- `img/ejercicios/` — una imagen `.webp` por ejercicio. Los nombres de archivo ya están referenciados en `rutinas.js`.
- `campana.mp3` — campana de boxeo, tres toques. Se usa al terminar cada bloque cronometrado.

---

## 1. Stack y estructura

HTML, CSS y JavaScript vanilla. **Sin frameworks, sin bundler, sin paso de build**: GitHub Pages sirve archivos estáticos y tiene que funcionar tal cual se sube.

Firebase v10 modular vía CDN con módulos ES.

Archivos a crear:

```
index.html          markup y arranque
styles.css          todos los estilos
app.js              lógica de la app
mensajes.js         textos del sargento (archivo aparte, editable a mano)
firebase-config.js  credenciales (con placeholders para completar)
manifest.json       PWA
sw.js               service worker
```

Ya existentes, **no los toques ni los regeneres**: `rutinas.js`, `img/`, `campana.mp3`, `icons/`.

---

## 2. Firebase

**Aviso crítico: el proyecto de Firebase está compartido con otra app en producción llamada "Mis Finanzas", con más de tres meses de datos reales.**

- No leas, no escribas, no renombres ni borres ninguna colección que no sea `entrenador`.
- En las reglas de seguridad de Firestore, **entregá únicamente el bloque nuevo a agregar**, en un archivo `REGLAS-A-AGREGAR.txt`, con la instrucción de pegarlo dentro del `match /databases/{database}/documents` existente. **No generes un archivo de reglas completo ni sugieras reemplazar el actual.**

Autenticación: Google. En iOS instalado en pantalla de inicio, `signInWithPopup` falla en modo standalone: usá `signInWithRedirect` + `getRedirectResult`, con popup solo como fallback en escritorio.

Habilitá persistencia offline de Firestore (`persistentLocalCache`). En el subsuelo de un gimnasio no hay señal, y la app tiene que dejar registrar igual y sincronizar después.

---

## 3. Modelo de datos

```
entrenador/{uid}/config                                doc único
entrenador/{uid}/dias/{YYYY-MM-DD}                     doc del día (liviano)
entrenador/{uid}/dias/{YYYY-MM-DD}/media/foto          foto del gym
entrenador/{uid}/pesajes/{YYYY-MM-DD}                  pesaje
entrenador/{uid}/pesajes/{YYYY-MM-DD}/media/balanza    foto de la balanza
entrenador/{uid}/pesajes/{YYYY-MM-DD}/media/espejo     foto del espejo
entrenador/{uid}/semanas/{YYYY-Www}                    resumen semanal, racha, rango
```

**Las fotos van SIEMPRE en subcolección `media`, nunca en el documento del día.** El calendario y el historial tienen que cargar sin bajar una sola imagen. La foto se descarga solo cuando el usuario la abre.

Documento de día:

```js
{
  fecha, tipo,            // "entreno" | "descanso"
  rutinaId,               // "intervalos" | "musculacion" | null
  rutinasVersion,         // snapshot de RUTINAS_VERSION del día
  estado,                 // ver sección 4
  inicio, fin,            // timestamps, para calcular duración
  series: { ejercicioId: [{ peso, reps, hecha }] },
  vueltas: [n, n, n, n],  // solo intervalos
  esfuerzo: { ejercicioId: "sobrado" | "justo" | "roto" },
  notas: { ejercicioId: "texto" },
  ascensoMarcado: [ejercicioId],
  hambre, cansancio,      // 1-5
  comentario,             // texto libre
  aguaMl,
  caminata: { minutos, nota },
  tieneFoto, motivoSinFoto,
  causaMayor: { usada, motivo, conEscudo }
}
```

Cada sesión guarda su propio snapshot de los ejercicios que hizo, con los ids estables de `rutinas.js`. Cuando la rutina cambie en el futuro, el historial viejo tiene que seguir mostrándose correcto.

---

## 4. Reglas de negocio

Esta es la parte que no se puede equivocar. Implementala exactamente así.

### Estados del día y colores

| Estado | Cuándo | Color |
|---|---|---|
| `hecha` | Entrenó el día que le tocaba | Verde lleno |
| `recuperada` | Hizo una sesión atrasada otro día | Verde con borde punteado |
| `descanso` | Miércoles, sábado, domingo o feriado | Gris |
| `descanso-caminata` | Día de descanso con caminata registrada | Gris con marca verde |
| `causa-mayor` | Él la marcó, con motivo escrito | Amarillo |
| `fallada` | Día de entreno sin registro al cerrar el día | Rojo |
| `pendiente` | Día de entreno en curso | Sin color |

El rojo se pinta solo a las 23:59, nunca antes.

### Racha

- La semana va de lunes a domingo. **La racha es semanal, no diaria.**
- Semana completa = 4 sesiones registradas, sin importar el día exacto en que se hicieron.
- **Recuperación:** si falta una sesión, se puede hacer cualquier día hasta el domingo 23:59. Máximo **1 recuperación por semana**, y **no se pueden recuperar dos sesiones el mismo día**. Queda con estado `recuperada`.
- **Escudo:** 1 por mes calendario. Si la semana queda incompleta y se usa el escudo, la racha **se congela**: no se corta pero tampoco sube. Se marca la semana en amarillo. El escudo se repone el 1 de cada mes.
- Semana incompleta sin escudo: la racha **baja una semana** (mínimo 0) y con eso puede bajar un rango. **Nunca vuelve a cero de golpe.**

### Rangos

Salen de `RANGOS` en `rutinas.js`, atados a semanas completas consecutivas. Recluta → Soldado (1) → Cabo (2) → Cabo Primero (3) → Sargento (4) → Sargento Primero (8) → Suboficial (12) → Sargento de Hierro (24).

### Logros

- **Mención de honor:** semana completa + al menos una caminata registrada en un día de descanso. Es un extra de esa semana; **la caminata no cuenta como sesión ni suma a la racha.**
- **Mes perfecto:** 4 semanas completas consecutivas.
- **Mes de hierro:** 4 semanas completas sin usar ni una recuperación ni el escudo.

### Feriados

En `rutinas.js` agregá un array `FERIADOS = []` vacío al final, con un comentario explicando el formato `"YYYY-MM-DD"`, para completar a mano. Mientras esté vacío, los feriados se marcan con el botón de causa mayor.

---

## 5. Pantallas

### Inicio

Lo primero que se ve, sin scroll, tres bloques:

**a) El saludo del día.** Cambia según el estado:

- Día de entreno, todavía no fue, antes de las 12: *"Hoy es martes. Musculación. ¿A qué hora vas?"*
- Pasadas las 12: *"Son las 12 y no fuiste. Tu objetivo no se mueve solo."*
- Pasadas las 20: tono más duro, con la racha en riesgo bien visible.
- Ya entrenó: *"Bien Fran, hoy ya entrenaste"* + resumen rápido de lo que hizo.
- Día de descanso: *"Hoy es tu día de descanso. Relajá que te lo merecés."* + botón para registrar caminata.
- Con sesión pendiente de recuperar: *"Tenés Piernas pendiente. Recuperala antes del domingo y la semana sigue intacta."*

**b) El contador de racha.** Es el elemento más visible de la app:

```
        RANGO: CABO PRIMERO
     ▮▮▮ 3 SEMANAS EN RACHA ▮▮▮
   Semana en curso: 2 de 4   ●●○○
   Falta: jueves (Intervalos), viernes (Musculación)
   Si fallás bajás a CABO
```

**c) El botón grande de acción.** Uno solo, gigante, según el estado: "Empezar entrenamiento", "Registrar caminata", "Recuperar sesión", o el resumen si ya entrenó.

Abajo, accesos rápidos: agua, calendario, peso, historial.

### Entrenamiento — Musculación

Pantalla completa, un ejercicio por vez, sin scroll para lo esencial.

1. **Entrada en calor** (15 min): rotaciones, abdominales + espinales 4×(20+20), 10 min de cinta a 4 km/h con temporizador y campana.
2. **Los 6 ejercicios en orden**, cada uno con:
   - La imagen de la máquina, grande, arriba.
   - Nombre, subtítulo y los cues técnicos de `rutinas.js`.
   - **"La vez pasada: 60 kg × 12"**, bien visible.
   - El peso precargado con el último usado, con botones − / + del `pesoPaso` del ejercicio y opción de tipear el número directo.
   - 4 casilleros de serie. Al marcar una, arranca solo el temporizador de descanso (90 s configurable) con campana al terminar.
   - Botón de nota persistente por ejercicio (queda guardada y aparece siempre).
   - Al cerrar el ejercicio: **"¿Las últimas 2 repeticiones costaron?"** con tres botones: *Sobrado · Justo · Se rompió la técnica*. Esto se guarda como `esfuerzo` y alimenta la sugerencia de la próxima vez.
   - Botón **"Marcar para ascenso"**: Fran decide en qué máquina quiere subir. **La app nunca cambia el peso sola.** Como mucho sugiere: *"La vez pasada quedaste sobrado acá"*, pero el número lo pone él.
   - Botón **"Máquina ocupada"**: saltea el ejercicio, sigue con el siguiente y vuelve después sin perder el registro ni el orden.
   - Botón **calculadora de discos** para la prensa: le pone el peso total y le dice qué discos poner de cada lado.
3. **Cierre**: 10 min de cinta con temporizador.
4. **Parte de cierre de sesión**: volumen total en kg, duración, comparación contra la vez anterior (*"Moviste 4.320 kg, 380 más que el viernes"*), registro de hambre y cansancio 1-5 con recuadro de texto libre, y la foto.

### Entrenamiento — Intervalos

1. Entrada en calor de movilidad, 6-7 min, con las 5 imágenes como checklist.
2. **8 bloques alternados de 7 minutos**: cinta 4 km/h → circuito → cinta → circuito, cuatro vueltas. Campana al final de cada bloque y avance al siguiente con confirmación.
3. Durante cada bloque de circuito, las 4 imágenes de los ejercicios con sus reps y pesos, y un **contador de vueltas con botón +** (el circuito corta por tiempo, no por repeticiones: se registra cuántas vueltas entraron en cada bloque).
4. Mismo parte de cierre que musculación.

### Calendario

Vista mensual con los colores de la sección 4. Cada día tocable muestra qué hizo, los pesos, la foto y las notas. Arriba, el **heatmap del año en cuadraditos** tipo GitHub.

### Peso

- Pesaje los lunes: número + foto de la balanza + foto del espejo.
- Gráfico con la línea de tendencia (promedio de los últimos 4 pesajes), no el número crudo, más la línea del objetivo.
- Peso objetivo, distancia al objetivo y kilos bajados desde el inicio.
- **Comparador de fotos de espejo** con slider: la primera contra la última, y opción de elegir dos fechas cualesquiera.

### Historial

- Gráfico de progresión de carga por ejercicio (la prensa de 60 a X en el tiempo).
- Récords personales por ejercicio, con aviso en el momento cuando se rompe uno.
- Álbum mensual de fotos del gym.
- Descarga del resumen del día y de la semana (horarios, pesos, hambre, cansancio, agua, peso corporal) en PDF.

### Agua

Objetivo 2000 ml. Botón de botella (1000 ml) y botón de vaso (250 ml). Los dos valores editables desde configuración.

### Registro retroactivo

Poder completar un día anterior que quedó sin cargar, desde el calendario.

### Botón "hoy no llego"

En el inicio, en días de entreno. Abre directamente la reprogramación en vez de esperar a que el día se pinte rojo.

---

## 6. Detalles técnicos que no se pueden equivocar

1. **Los temporizadores se calculan con `Date.now()`, no con `setInterval` acumulativo.** iOS congela el JavaScript con la pantalla apagada. Guardá el timestamp de inicio y recalculá el tiempo restante cada vez que la app vuelve a foco.
2. **El audio de la campana hay que desbloquearlo con el primer gesto del usuario.** Cargá y reproducí `campana.mp3` en silencio al tocar "Empezar entrenamiento", si no iOS no lo va a dejar sonar después.
3. **Wake Lock activo durante toda la sesión** para que la pantalla no se apague y la campana suene. Liberalo al terminar.
4. **Fotos:** input `capture="environment"` para que abra la cámara directo, pero dejando disponible la galería. Comprimir en el navegador antes de subir: redimensionar a 800 px de lado mayor, WebP calidad 0.8, apuntando a 60-80 KB. Guardar como base64 en la subcolección `media`. Un documento de Firestore no puede pasar 1 MB: si después de comprimir sigue grande, bajá calidad hasta que entre.
5. **Guardar cada serie apenas se marca**, no al final. Si se cierra la app a mitad de la sesión, no se pierde nada y al volver retoma donde estaba.
6. **Registrar la hora exacta** de cada foto y de cada sesión, y mostrarla en el resumen semanal.
7. Nada de dependencias externas más allá de Firebase y la librería de PDF.

---

## 7. Diseño

Negro sobre blanco, con rojo solo como acento. Estética Apple: mucho aire, tipografía del sistema (`-apple-system`), jerarquía por tamaño y peso, no por color. Bordes suaves, sin sombras exageradas.

**Nada de neón, nada de degradados violeta, nada de emojis decorativos, nada que parezca vibecodeado.** El rojo se usa para la racha en riesgo, los días fallados y el botón principal. Nada más.

Modo claro y oscuro, siguiendo la preferencia del sistema, con toggle manual.

Los botones de la vista de entrenamiento tienen que ser grandes: se usan con las manos transpiradas, apurado y de pie. Nada crítico a menos de 60 px de alto.

Todo tiene que ser rápido: la app abre y en menos de un segundo se ve el estado del día, aunque los datos todavía estén cargando.

---

## 8. El sargento

Todos los textos motivacionales van en `mensajes.js`, en plantillas con variables, agrupados por situación. Sin IA, sin llamadas de red: instantáneo y funciona sin señal.

El tono es de sargento: directo, exigente, nada condescendiente, sin insultos. **Aprieta cuando falta y festeja fuerte cuando cumple.** Escribí al menos 5 variantes por situación para que no se vuelva repetitivo, y que rote.

Situaciones: aún no entrenó, pasó el mediodía, pasó la tarde, ya entrenó, día de descanso, caminata registrada, racha en riesgo, subió de rango, bajó de rango, récord personal, sesión pendiente de recuperar, escudo usado, mes perfecto, semana con mención de honor.

Español rioplatense, voseo. Ejemplos del registro buscado: *"Son las 12 y seguís en casa. La prensa no se levanta sola."* / *"Cuarta semana seguida. Sos Sargento. No aflojes ahora."*

---

## 9. PWA

### Íconos

La carpeta `icons/` ya viene con todos los archivos hechos. **Usalos tal cual, no generes ni modifiques ninguno:**

```
icons/icon-1024.png            master
icons/icon-512.png             manifest, purpose "any"
icons/icon-192.png             manifest, purpose "any"
icons/icon-512-maskable.png    manifest, purpose "maskable" (Android)
icons/icon-192-maskable.png    manifest, purpose "maskable" (Android)
icons/apple-touch-icon.png     180x180, iOS
icons/favicon-32.png           pestaña del navegador
```

`manifest.json` con nombre "Mi Entrenador", `short_name: "Entrenador"`, `display: standalone`, `background_color` y `theme_color` en `#0A0A0B`, `orientation: portrait`, `start_url: "./"`, `scope: "./"`, y el array de íconos con las cuatro entradas y su `purpose` correcto:

```json
"icons": [
  { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
  { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
  { "src": "icons/icon-192-maskable.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
  { "src": "icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
]
```

**iOS ignora por completo los íconos del manifest.** En el `<head>` de `index.html` tienen que ir sí o sí estas etiquetas, o al agregar a pantalla de inicio el iPhone va a mostrar una captura de pantalla en vez del ícono:

```html
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">
<link rel="manifest" href="manifest.json">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Mi Entrenador">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0A0A0B">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

Las rutas van **relativas** (`icons/...`, sin barra inicial), porque la app se sirve desde un subdirectorio de GitHub Pages y con rutas absolutas el ícono no carga.

El service worker tiene que cachear los siete archivos de `icons/` junto con el resto de la app.

Con `viewport-fit=cover` y la barra de estado translúcida, respetá `env(safe-area-inset-*)` en el CSS para que el contenido no quede tapado por el notch ni por la barra inferior del iPhone.

Service worker con cacheo de la aplicación e imágenes para que funcione sin conexión.

Tiene que instalarse bien desde Safari en iPhone y iPad con "Agregar a pantalla de inicio", y mantener la sesión iniciada entre aperturas.

**No implementes notificaciones push.** Los avisos los maneja un Atajo de Apple por fuera. Dejá la estructura de datos lista para agregarlas más adelante.

---

## 10. Semilla

`rutinas.js` trae la constante `SEED` con dos sesiones ya hechas (lunes 3 y martes 4 de agosto de 2026, con los pesos reales). La primera vez que la app arranca con la base vacía, cargá esas dos sesiones para que la racha, los pesos precargados y el "la vez pasada" arranquen con datos reales.

---

## 11. Prohibido

- Modificar `rutinas.js`, salvo para agregar el array `FERIADOS` vacío.
- Tocar cualquier colección de Firestore que no sea `entrenador`.
- Generar un archivo de reglas de seguridad completo. Solo el bloque a agregar.
- Poner claves de API de terceros en el código del cliente.
- Editar rutinas desde la interfaz: los cambios de rutina se hacen editando `rutinas.js`.
- Agregar frameworks o cualquier cosa que requiera compilar.

---

## 12. Entregables

1. Todos los archivos de la sección 1, funcionando.
2. `REGLAS-A-AGREGAR.txt` con solo el bloque de reglas nuevo.
3. `README.md` con: cómo completar `firebase-config.js`, cómo cambiar la rutina, cómo cambiar los mensajes del sargento y cómo subir cambios a GitHub Pages.
4. Un repaso final verificando punto por punto la sección 6, que es donde este tipo de app se rompe, y la sección 9, verificando que las siete referencias a `icons/` existan y apunten a archivos reales.

Trabajá de a partes y andá mostrando: primero la estructura y el modelo de datos, después el inicio con la racha, después la sesión de entrenamiento, y al final el resto de las pantallas. Preguntame si algo del spec no cierra en vez de asumir.
