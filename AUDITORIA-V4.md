# Auditoría v4 — flujo y robustez

Revisión al commit `6ad9ce6`. Todo lo que dice **confirmado** se comprobó leyendo
la línea citada. Lo que dice **no verificable** necesita un teléfono real y lo
digo en vez de darlo por bueno.

Ningún cambio de código en esta pasada.

---

## 1.1 La sesión tiene que sobrevivir a todo

### A. La campana no se vuelve a agendar al volver a foco — **lo más grave**

`app.js:2025`. El manejador de `visibilitychange` hace `resume()` del contexto,
pero **no vuelve a agendar la campana**.

Por qué eso la deja muda: el `start(when)` de Web Audio se programa contra
`ctx.currentTime`, que es el reloj **del contexto**. Cuando iOS lo suspende, ese
reloj se congela junto con él. Si estuviste tres minutos fuera, al volver el
reloj del contexto arrancó tres minutos atrasado respecto del reloj de pared, y
la campana suena tres minutos tarde — o directamente nunca, porque para entonces
`tickTimers` ya la dio por sonada.

Y la da por sonada sin sonar: en `tickTimers`, cuando `resta <= 0` marca
`t.sono = true` y **si `t.agendada` es true sólo vibra**, asumiendo que el hilo
de audio ya se encargó. Si el contexto estaba suspendido, no se encargó nadie.

Hace falta: al volver a foco, `resume()` y **re-agendar** todo instante que
todavía no pasó, más un toque inmediato si venció mientras no estabas.

### B. Faltan `pagehide`, `freeze` y `resume`

Confirmado: sólo existe `visibilitychange`. En iOS el evento fiable justo antes
de que el sistema descarte la pestaña es `pagehide`, y `freeze`/`resume` son los
de Chrome. Sin ellos no hay último guardado garantizado.

### C. El autoguardado con retardo puede perder lo último

`app.js:2179`. `guardarSesion()` espera 1,2 s antes de escribir. Marcar una serie
escribe aparte y al instante, pero **el paso actual, los pesos y las repeticiones
van por ese retardo**. Si iOS mata la pestaña dentro de esa ventana, se pierden.

### D. `localStorage` se escribe y no se lee nunca

`app.js:2181` guarda `sesionActiva` en cada cambio, y `limpiarSesionLocal` la
borra. **Ninguna función la lee.** `retomarSesion` reconstruye sólo desde
Firestore. El comentario dice "caché de arranque rápido" y esa caché no existe:
si Firestore todavía no cargó, no hay nada de dónde reconstruir.

### E. Los temporizadores no se persisten

`sesionParaGuardar` (`app.js:2163`) no incluye `timer` ni `descanso`, y
`sesionDesdeRegistro` los deja en `null`. Tras una recarga, **un bloque de 7
minutos o un descanso en curso desaparecen**. Es exactamente el "timer
congelado" que no querés.

### F. La recarga no devuelve al entrenamiento

`app.js:591`. Al volver con una sesión abierta, la app va al inicio y muestra un
aviso: "Tocá la tarjeta para seguir". Vuelve al ejercicio correcto porque `paso`
sí se persiste, pero **con un toque de más**, y si el aviso se va antes de que lo
leas, hay que darse cuenta solo.

### G. Wake Lock — correcto

`app.js:2027` lo vuelve a pedir en `visibilitychange`. Esto ya funciona.

### H. Bluetooth — no verificable

Web Audio sale por la ruta por defecto del sistema, así que en principio suena
por los auriculares. Pero si el contexto se creó **antes** de conectarlos, iOS
puede sostener la ruta vieja hasta un `resume()`. No lo puedo probar sin el
teléfono y los auriculares.

### I. Llamada entrante

Una llamada interrumpe la sesión de audio y deja el contexto suspendido. Sin el
re-agendado del punto A, el descanso termina mudo. Además, tras una interrupción
iOS puede exigir un gesto del usuario para devolver el audio: si pasa eso, no hay
forma programática de recuperarlo y conviene que la app lo diga.

### J. Sin conexión — funciona

Marcar series, cargar pesos y sacar la foto escriben en la caché local y
sincronizan al volver la red; el indicador "Sin sincronizar" aparece y no bloquea
nada. `waitForPendingWrites` no resuelve mientras no hay red, así que el
indicador queda puesto hasta que vuelve, que es el comportamiento correcto.

### K. Bloque terminado estando afuera — cosmético

`fmtCrono` recorta a cero, así que **no hay números en negativo**. Pero
`renderBloqueIntervalo` no se vuelve a dibujar al regresar, así que el botón
"Bloque terminado · siguiente" no pasa a rojo hasta el siguiente redibujo.

---

## 1.2 Caminos sin salida y pasos de más

Ordenado por cuánto molesta entrenando.

### 1. La pregunta de esfuerzo corta el avance en cada ejercicio
`app.js:2894`. "Siguiente" no avanza si no marcaste sobrado/justo/roto. Son
**seis interrupciones obligatorias por sesión**, con las manos ocupadas. Existe
"Saltear esta pregunta", que es otro toque más.
**Cómo lo simplificaría:** que "Siguiente" avance siempre y el esfuerzo quede
como opcional en la misma tarjeta, o que se pregunte una sola vez en el cierre.

### 2. Empezar a entrenar son cinco toques
`+` → Registrar entrenamiento → Continuar → Sacar foto → (cámara) → Empezar
entrenamiento. Hay **dos hojas antes de la cámara** para el caso más común, que
es "hoy toca lo que toca".
**Cómo lo simplificaría:** una sola hoja con la rutina de hoy ya elegida y el
botón de cámara arriba; lo de cambiar o cubrir otra sesión, abajo como enlace.

### 3. No hay manejo del botón atrás de Android
No existe `popstate` ni `history.pushState` en todo el proyecto. Instalada como
PWA, el botón atrás puede cerrar la app o sacarte del historial **en medio de una
hoja con datos escritos**. Es literalmente "perder algo cargado por tocar atrás
sin querer".
**Cómo lo simplificaría:** que atrás cierre la hoja abierta, y si no hay hoja,
vuelva al inicio antes de salir.

### 4. Se puede quedar en una sección sin ícono
`app.js:1047`: `ORDEN_SECCIONES` todavía incluye `"ajustes"`, que dejó de ser
pestaña. Deslizando desde Progreso llegás a Ajustes, y ahí **ningún ícono de la
barra queda marcado**.

### 5. La barra tiene cuatro elementos, no cinco
Falta partir Progreso en Entrenamiento y Peso, como pide el Bloque 3.1.

### 6. Dos hojas sin botón de salida visible
"Sin series cargadas" y la calculadora de discos se cierran sólo por el velo o
arrastrando. Se sale, pero nada lo dice.

### 7. La caminata está en el `+` y debería estar dentro de Registrar
Como pide el Bloque 3.3.

---

## 1.3 Repaso funcional

**Andan de punta a punta según el código:** registrar con foto, entrada en calor,
los seis ejercicios con series y pesos, el descanso, los bloques de intervalos
con vueltas, el parte de cierre, hambre y cansancio, la foto, el agua, el pesaje,
la caminata, el calendario, la recuperación, el escudo, los récords y la racha.

**No están o están incompletos:**

| Qué | Estado |
|---|---|
| Exportar copia de seguridad | No existe (es el 6.4) |
| PDF con imágenes | Arreglado pero **nunca abrí un PDF generado**: necesita tu sesión |
| Recordatorio de pesaje | `app.js:3832` sólo avisa **si hoy es lunes**; si no te pesás, el martes ya no insiste |
| Volumen por grupo muscular | No existe (6.1) |
| Parte del domingo | No existe (6.3) |
| Bitácora de problemas | No existe (6.6) |
| Vista previa de la rutina | No existe (6.2) |
| Marcar feriados | `FERIADOS` está vacío y **sólo se puede editar el archivo**; no hay forma desde la app |
| Causa mayor y feriado restando del objetivo | No: `resumenSemana` compara contra `CONFIG.sesionesPorSemana` fijo en 4 |

---

## Bloque 2 — los tres confirmados, con una precisión

**2.1 La escala del 1 al 5.** Confirmado, y conviene el detalle: en la **pantalla
de entrenamiento** sí se ve, porque ahí `.vista-entreno .btn-borde` pinta el
fondo `#1C1C1E` y el seleccionado `#F5F5F7` contrasta. Donde **no se ve** es en
la hoja "Completar hambre y cansancio" en **modo claro**: ahí `.btn-borde` usa
`var(--superficie)`, que es exactamente `#F5F5F7`, el mismo color que pinta el
seleccionado (`styles.css:638`). Queda el mismo color sobre el mismo color. Lo
mismo en `.esfuerzo-botones .sel` (`styles.css:606`).

**2.2 La insignia desaparece.** Confirmado, `styles.css:203`.

**2.3 Nombres de archivo en la grilla.** Confirmado, `app.js:4472`.

---

## Lo que no voy a poder verificar yo

Para que no quede como aprobado sin serlo: la campana con la pantalla bloqueada,
el comportamiento con auriculares Bluetooth, la llamada entrante, el PDF abierto
de verdad y el login. Todo eso necesita tu teléfono y tu cuenta.
