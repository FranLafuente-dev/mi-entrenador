# Auditoría — Mi Entrenador

Revisión del código al commit `b2ebec6` (5 de agosto de 2026), sobre `app.js`
(3.230 líneas), `rutinas.js`, `mensajes.js`, `styles.css`, `sw.js` e `index.html`.

Todo lo que dice **verificado** se comprobó ejecutando código o leyendo la línea
citada. Lo que dice **hipótesis** es razonamiento sobre el código que no pude
reproducir sin un teléfono y la cuenta real. Los números de línea son de este
commit y se mueven con cada cambio.

No se arregló nada de lo que sigue: es solo el relevamiento.

---

## Estado al 5 de agosto, después de los bloques A a D

Este documento quedó como el relevamiento original. Lo que ya se resolvió:

| Hallazgo | Dónde se arregló |
|---|---|
| 1.1 Foto obligatoria para cerrar | Bloque A — la foto va al principio y no bloquea el cierre |
| 1.2 Sesión abandonada se evapora | Bloque A — sesión en Firestore, cierre automático, estado `a-medias` |
| 1.3 Escrituras sin manejo de error | Bloque A — envoltorio `escribir()` con reintento |
| 1.4 Doble toque | Bloque A — el envoltorio deshabilita el botón |
| 1.5 Callback único de la hoja | Bloque A — pila de manejadores |
| 1.7 SDK de Firebase fuera del precache | sigue pendiente |
| 2.1 Mensajes de récord apagados | Bloque D |
| 2.2 Claves de `CONFIG` sin leer | Bloque D — las cuatro se leen; se agregó `horaLimite` |
| 2.3 `filaReg` calculada y descartada | sigue pendiente |
| 3.1 Agua en dos unidades | Bloque C — totales en litros, porciones en mililitros |
| 3.2 Tres formatos de kilos | Bloque C — `fmtNumero` única |
| 3.4 Terminología que baila | sigue pendiente |
| 3.5 Cinco clases de etiqueta iguales | sigue pendiente |
| 3.6 Resumen del peso duplicado | sigue pendiente |
| 4.1 Dos dispositivos se pisan campos | sigue pendiente |
| 4.2 Foto interrumpida | Bloque A — orden explícito, contenido antes que puntero |
| 5.1 Descanso persistente | Bloque B — barra flotante y campana agendada |
| 5.2 Corregir sesión terminada | Bloques A y D — editor con agregar y quitar series |
| 5.3 Récord al lado del peso | Bloque D |
| 5.5 Tipos de serie y notas por serie | sigue pendiente |
| 5.6 e1RM y volumen por músculo | sigue pendiente (sí hay volumen por semana) |

---

## Lo más importante, en una pantalla

| # | Hallazgo | Gravedad | Costo |
|---|----------|----------|-------|
| 1 | La foto es obligatoria para cerrar la sesión, y sin cerrarla el día cuenta como fallado | Crítico | Chico |
| 2 | Una sesión abandonada deja datos huérfanos y desaparece a la medianoche | Crítico | Mediano |
| 3 | Ninguna escritura a Firestore tiene manejo de error: si falla, falla en silencio | Alto | Mediano |
| 4 | Ningún botón de guardar se protege del doble toque | Alto | Chico |
| 5 | El descanso corre pero no se ve fuera de la pantalla de entrenamiento | Alto | Mediano |
| 6 | No se puede corregir una sesión ya terminada | Alto | Mediano |
| 7 | Dos dispositivos escribiendo el mismo día se pisan campos enteros | Medio | Mediano |
| 8 | La hoja modal tiene un solo callback global: una hoja sobre otra puede colgar el arranque | Medio | Chico |

---

## 1. Bugs y estados rotos

### 1.1 La foto obligatoria puede hacerte perder la sesión entera
**Crítico · costo chico**

`app.js:2246`. Para terminar una sesión hay que sacar la foto **o** escribir un
motivo. Si no hacés ninguna de las dos, `btn-terminar` sale por `return` y la
sesión no se cierra nunca.

Combinado con 1.2, esto significa que podés entrenar completo, marcar las doce
series, y perder todo porque saliste apurado del gimnasio sin sacar la foto.

**Verificado** por lectura. El día queda con `inicio`, `series` y `esfuerzo`
cargados, pero sin `estado`, y `estadoDia()` lo trata como no registrado.

Arreglo: que la foto sea opcional al cerrar y se pueda agregar después desde la
ficha del día. El motivo por escrito puede seguir existiendo, pero como pregunta
posterior, no como peaje.

### 1.2 Una sesión abandonada se evapora a la medianoche
**Crítico · costo mediano**

`app.js:1661-1666`. La sesión en curso vive en `localStorage` bajo
`sesionActiva`, y `sesionGuardadaHoy()` solo la devuelve si `s.fecha === hoyISO()`.
Pasada la medianoche argentina, esa sesión ya no se puede retomar: el botón
"Continuar entrenamiento" desaparece.

Lo que queda en Firestore es un documento de día con `inicio`, `series` y
`vueltas` pero sin `estado`. Para `estadoDia()` eso es un día **fallado**, con lo
cual baja la racha aunque el entrenamiento haya ocurrido de verdad.

**Verificado** por lectura de `sesionGuardadaHoy`, `estadoDia` (`app.js:428-444`)
y `empezarSesion` (`app.js:1485-1511`).

Arreglo: detectar al arrancar un día con `inicio` y sin `estado`, y ofrecer
cerrarlo o descartarlo. Es el mismo mecanismo que ya existe para el escudo.

### 1.3 Ninguna escritura a Firestore maneja el error
**Alto · costo mediano**

`guardarDia` (`app.js:600`) y `guardarConfig` (`app.js:596`) hacen `await setDoc`
sin `try/catch`, y **actualizan el estado local antes** de que la escritura se
confirme. El detector encontró **28 llamadas** a estas funciones sin ningún
`try/catch` en las doce líneas previas.

Consecuencias:

- Si la escritura rechaza (reglas, cuota, documento inválido), es una promesa sin
  catch: no aparece nada en pantalla y `S.dias` queda diciendo algo distinto de
  lo que hay en la nube.
- El usuario cree que guardó.

Matiz importante: con `persistentLocalCache` activo, `setDoc` resuelve cuando
escribe en la **caché local**, no cuando el servidor confirma. O sea que hoy
"guardado" significa "anotado en el teléfono", y un rechazo del servidor llega
después, por un camino que nadie escucha.

Arreglo: envolver las dos funciones, revertir el estado local si falla y avisar.
Es un solo lugar, pero hay que decidir qué hacer con el dato ya pintado.

### 1.4 Doble toque en los botones que guardan
**Alto · costo chico**

**Verificado**: en todo `app.js` no hay un solo `disabled = true` fuera de las
celdas del calendario (`app.js:2334`). Ningún botón de guardar se bloquea
mientras la escritura está en curso.

Los peores casos:

- `btn-terminar` (`app.js:2243`): dos toques rápidos disparan dos `guardarDia` y
  dos `momentoCierre`, con el segundo pisando el `fin` y el resumen.
- `pes-guardar` (`app.js:2743`): puede subir dos veces las fotos, que son lo más
  pesado que escribe la app.
- `retro-guardar` (`app.js:2431`) y `cm-guardar` (`app.js:1543`).

Arreglo: deshabilitar el botón al entrar y rehabilitarlo en el `finally`.

### 1.5 La hoja modal tiene un solo callback global
**Medio · costo chico**

`hojaOnCerrar` es una variable única (`app.js:889`) que `abrirHoja` pisa cada vez
(`app.js:895`). Si se abre una hoja mientras hay otra abierta, el callback de la
primera se pierde.

Esto importa por un caso puntual: `preguntarEscudo` (`app.js:808`) devuelve una
promesa que **solo** se resuelve por sus botones o por `onCerrar`. Si ese callback
se pierde, el `await preguntarEscudo(r)` de `procesarSemanasCerradas` no termina
nunca; y como `alCambiarDatos` hace `await procesarSemanasCerradas()` antes de
`irA("inicio")`, la app se queda en la pantalla de carga.

**Hipótesis**: no pude provocarlo, porque hace falta una semana pasada incompleta
y algo que abra otra hoja en ese momento. Pero es un tercer camino hacia el
síntoma "queda cargando" que ya perseguimos en la Fase 1, y el costo de blindarlo
es bajo: una pila de callbacks en vez de una variable, o resolver la promesa con
un `finally`.

### 1.6 `S.errorDatos` no se limpia nunca
**Bajo · costo chico**

Lo introduje yo en la Fase 1 (`app.js:634`): la semilla no corre si hubo un error
de datos, para no pisar información que quizá existe. Pero `S.errorDatos` no se
borra si después la conexión se recupera. Para un usuario nuevo que arranca con
un error de red transitorio, la semilla no se carga hasta recargar la app.

### 1.7 Comportamiento sin conexión, pantalla por pantalla
**Informativo**

| Pantalla | Sin conexión |
|---|---|
| Login, primera vez | No se puede entrar. Ya hay aviso explícito (Fase 1). |
| Login, ya entró antes | Entra: la sesión vive en IndexedDB. |
| Inicio, calendario, progreso | Funcionan con la caché de Firestore. |
| Entrenamiento | Funciona. Imágenes y campana están precacheadas en el SW. |
| Fotos | Se guardan local y suben después. |
| PDF | Falla: `jspdf` viene de un CDN. Hay mensaje de error (`app.js:2908`). |

Un hueco menor: el SDK de Firebase se cachea recién **después** del primer uso
(`sw.js:72-81`), no en el `install`. Una instalación seguida de un arranque
offline no encontraría el SDK.

---

## 2. Caminos muertos

### 2.1 Los mensajes de récord están escritos y nunca se usan
**Medio · costo chico**

**Verificado con el detector.** `mensajes.js` define la clave `record`, y es la
única de las quince que nunca se invoca. En su lugar, `bannerRecord` muestra un
texto fijo escrito en el código:

```js
bannerRecord(`Récord en ${e.nombre}: ${s.pesoActual[id]} kg`);   // app.js:1949
```

Por eso las variables `{ejercicio}` y `{peso}`, que existen en `mensajes.js`, no
se pasan desde ningún lado. Es una voz del sargento que escribiste y que nunca
suena, justo en el momento más motivante de la app.

Arreglo: `bannerRecord(sargento("record", { ejercicio: e.nombre, peso: ... }))`.

### 2.2 Cuatro claves de `CONFIG` declaradas y nunca leídas
**Bajo · costo chico**

**Verificado**: `CONFIG.horaEntreno`, `CONFIG.horaAviso`, `CONFIG.diasDescanso` y
`CONFIG.escudosPorMes` no aparecen en ningún lado fuera de su definición en
`rutinas.js:16-28`.

Lo problemático es que dos de ellas están **duplicadas como números sueltos**:

- Los umbrales de hora del inicio están escritos a mano: `hora >= 20` y
  `hora >= 12` (`app.js:1173, 1177`), en vez de `CONFIG.horaAviso`.
- El límite de un escudo por mes está implícito en
  `!(S.config.escudos && S.config.escudos[mes])` (`app.js:705`), que hace
  imposible configurar dos.

O sea que `rutinas.js` promete ser "el único archivo que se toca" y en estos
cuatro casos no lo es.

### 2.3 Variable calculada y descartada
**Bajo · costo trivial**

`app.js:2528`, dentro del armado de la ficha de intervalos:

```js
const filaReg = { series: {}, notas: reg.notas, esfuerzo: reg.esfuerzo };
```

Nunca se usa. Sospecho que la ficha de intervalos iba a mostrar notas y esfuerzo
por ejercicio como la de musculación, y quedó a medio hacer: hoy el circuito se
muestra con los valores de `rutinas.js`, no con lo que hizo ese día.

### 2.4 Falsos positivos que revisé y descarté

Para que no se vuelvan a levantar: `momentoCierre` y `comprimirFoto` **sí** se
llaman (`app.js:2265` y `2228`); las clases `galon-lleno`, `galon-vacio` y
`galon-rojo` **sí** se usan, generadas por template literal en `svgGalon`; y los
ids `carga-error` y `btn-no-llego` se crean por JavaScript, no están en el HTML.

---

## 3. Inconsistencias

### 3.1 El agua se muestra en dos unidades distintas
**Medio · costo chico**

- Tarjeta del inicio: `1,2 / 2 L` (`fmtLitros`, `app.js:1235`).
- Hoja de agua: `1200` sobre `de 2000 ml` (`app.js:1450-1452`).
- Ficha del día e indicadores del PDF: `Agua 1200 ml` (`app.js:2593`).

Es el mismo dato en tres formatos. El más raro es el de la hoja, que es
justamente donde se registra.

### 3.2 Los kilos tienen tres formatos
**Bajo · costo chico**

`fmtKg` usa `toLocaleString` (`app.js:139`); la tarjeta de peso usa
`toFixed(1).replace(".", ",")` (`app.js:1325`); y `renderPeso` mezcla las dos
(`app.js:2650`). En pantallas contiguas el mismo número puede verse como
`84,2`, `84.2` o `84`.

### 3.3 Las fechas tienen dos formatos sin criterio
**Bajo · costo chico**

`fmtFechaLarga` ("martes 4 de agosto") y `fmtFechaCorta` ("4/8", sin año)
conviven sin una regla clara de cuándo va cada una. En el PDF aparecen las dos en
la misma página. `fmtFechaCorta` sin año se vuelve ambigua en cuanto haya un año
de historial.

### 3.4 La terminología baila
**Medio · costo chico**

Cuatro palabras para la misma cosa, a veces en la misma pantalla:

| Dónde | Palabra |
|---|---|
| Tarjeta del inicio | "Entreno hoy" |
| Hoja del + | "Empezar entrenamiento" |
| Diálogo de salida | "¿Salir del entrenamiento?" / "Descartar la **sesión** de hoy" |
| Cierre | "**Sesión** terminada" |
| `rutinas.js` y la ficha | "**Rutina**: Intervalos / Musculación" |

Sugerencia: **rutina** es el plan (Intervalos, Musculación), **sesión** es la vez
que lo hacés, y "entrenar" queda solo como verbo.

### 3.5 Cinco clases CSS que son la misma etiqueta
**Bajo · costo chico**

`.etiqueta`, `.seccion-titulo`, `.ficha-seccion`, `.paso-indicador` y
`.tarjeta-titulo` definen todas lo mismo: 13 px, peso 600, `letter-spacing` 0.6,
mayúsculas, color `--texto2`. Cambian solo en márgenes y en si llevan borde.

Son cinco lugares para tocar cuando quieras ajustar la tipografía de las
etiquetas. Convendría una clase base y modificadores.

### 3.6 El resumen del peso está escrito dos veces
**Medio · costo chico**

`renderTarjetaPeso` (`app.js:1300`) y `renderPeso` (`app.js:2626`) calculan por
separado, con código casi idéntico pero no igual, la diferencia contra el
objetivo y contra el peso inicial. La tarjeta del inicio dice "Bajaste 3,1 kg ·
faltan 6,2" y la pantalla de progreso arma la misma frase con otras palabras y
otro redondeo. Cualquier cambio hay que hacerlo dos veces.

---

## 4. Riesgos de datos

### 4.1 Dos dispositivos el mismo día se pisan campos enteros
**Medio · costo mediano**

Todas las escrituras usan `{ merge: true }`, que funciona a nivel de **campo de
primer nivel**, no de contenido. Cuando `guardarDia` escribe:

```js
{ series: { ...(reg.series || {}), [id]: limpias } }   // app.js:1955
```

está mandando el objeto `series` **completo**, armado a partir de la copia local.
Si el iPhone y la tablet tienen la sesión abierta a la vez, el último en escribir
borra las series que cargó el otro. Lo mismo con `esfuerzo`, `notas` y
`aguaRegistros`.

En la práctica es poco probable —una sola persona, un solo teléfono por sesión—
pero el agua sí se registra desde donde sea que estés, y ahí el riesgo es real.

Arreglo correcto: `updateDoc` con rutas de campo (`series.dorsalera`) para no
mandar el objeto entero, y `arrayUnion` para los registros de agua.

### 4.2 Foto interrumpida a mitad de subida
**Bajo · costo chico**

`renderParteCierre` (`app.js:2229-2230`) hace dos escrituras seguidas sin
transacción: primero la foto en la subcolección `media`, después
`tieneFoto: true` en el día. Si la app se cierra entre las dos, queda la foto
guardada y el día diciendo que no tiene foto: la foto existe pero no se muestra
nunca.

El orden es el bueno (primero el contenido, después el puntero), así que no hay
pérdida de datos, solo una foto huérfana. El caso inverso —`tieneFoto: true` sin
foto— sí está contemplado: `abrirFicha` muestra "Sin foto disponible".

### 4.3 Límite de 1 MB por documento: sin riesgo real
**Bajo · sin acción**

Lo revisé porque era una de tus preguntas. `comprimirFoto` (`app.js:2272`) corta
en ~110.000 caracteres y rechaza por encima de 900.000, y cada foto va a su
**propio documento** en la subcolección `media`. Lejos del límite.

El documento del día crece con `series`, `esfuerzo`, `notas` y `aguaRegistros`,
pero todos están acotados por día. `aguaRegistros` es el único sin techo teórico
—un registro por vaso— y haría falta un disparate de toques para acercarse.

### 4.4 El estado local se actualiza antes de confirmar
**Medio · costo mediano**

Ya mencionado en 1.3, pero vale como riesgo aparte: `guardarDia` hace
`S.dias.set(...)` **antes** del `await`. Es lo que hace que la app se sienta
instantánea, y está bien como decisión, pero hoy no tiene la contraparte: si la
escritura falla, nadie revierte y nadie avisa.

---

## 5. Contra las mejores del rubro

Comparado con Strong, Hevy, Fitbod y Apple Fitness, ordenado por lo que más le
sirve a alguien que entrena cuatro veces por semana y quiere no abandonar.

### 5.1 Descanso persistente y con aviso — **lo que más falta**
**Alto · costo mediano**

En Strong y Hevy el descanso es una barra flotante que se ve en **cualquier**
pantalla, sigue corriendo con la app cerrada y manda una notificación al
terminar.

Acá el temporizador está bien construido —guarda `fin` como instante absoluto
(`app.js:1642`), así que sobrevive a que la pantalla se apague— pero:

- El descanso solo se dibuja dentro de la tarjeta del ejercicio
  (`app.js:1893-1897`). Si salís a mirar el calendario, sigue corriendo pero no
  lo ves.
- La campana suena por `Audio`, que en iOS con la pantalla bloqueada no suena.
- No hay notificación del sistema.

Es lo que más se usa en una sesión: entre doce series son once descansos.

### 5.2 Corregir una sesión ya terminada
**Alto · costo mediano**

En las cuatro apps podés abrir una sesión de la semana pasada y corregir un peso
mal tipeado. Acá `hojaRetro` (`app.js:2400`) solo sirve para días **sin** sesión;
una vez que la sesión está cerrada, la ficha es de solo lectura. Durante la
sesión sí se puede destildar una serie y rehacerla (`app.js:1934`).

Escribir 60 en vez de 6 es fácil y hoy queda para siempre, contaminando los
récords y la comparación con la vez anterior.

### 5.3 El récord al lado del peso que estás por poner
**Medio-alto · costo chico**

Hevy y Strong muestran, en el mismo renglón donde elegís el peso, la última vez
**y** el récord. Acá tenés "La vez pasada: 40 kg × 12" (`app.js:1868`) pero el
récord solo aparece como banner cuando ya lo superaste, o en una lista aparte en
Progreso.

Los datos ya están calculados: `maximosHistoricos()` se llama al empezar la
sesión y vive en `S.sesion.prMax`. Es agregarlo a la vista.

### 5.4 Sustituir un ejercicio
**Medio · costo mediano**

Fitbod y Hevy ofrecen alternativas cuando una máquina está ocupada. Acá "Máquina
ocupada" (`app.js:1984`) manda el ejercicio al final de la cola, que es una buena
solución para un gimnasio lleno, pero si la máquina sigue ocupada al final no hay
plan B.

### 5.5 Tipos de serie y notas por serie
**Medio · costo mediano**

Estándar en Strong y Hevy: marcar una serie como calentamiento, o al fallo, y
dejar una nota en esa serie. Acá la nota es por **ejercicio** y se guarda en
`config.notasEjercicio` (`app.js:2021`), o sea que es permanente y no queda
atada al día. El esfuerzo sí es por ejercicio y por día.

Las series de calentamiento importan para el volumen: hoy suman igual que las
efectivas y ensucian el total.

### 5.6 e1RM y volumen por grupo muscular
**Medio · costo mediano**

Las cuatro apps muestran el 1RM estimado, que es la métrica que de verdad indica
si estás progresando cuando cambian las repeticiones. Acá la progresión es el
**peso máximo** (`progresionDe`, `app.js:2806`), que se queda quieto si subís de
8 a 12 repeticiones con el mismo peso: progresaste y el gráfico no lo muestra.

Los ejercicios ya tienen `subtitulo` con el músculo, así que agrupar por grupo
muscular es barato.

### 5.7 Editar la rutina desde la app
**Medio · costo grande**

En las cuatro es lo normal. Acá `rutinas.js` es un archivo que se edita a mano y
se sube a GitHub. Fue una decisión deliberada y bien documentada, y tiene la
ventaja de que el historial no se rompe porque cada sesión guarda su
`rutinasVersion`. Lo dejo anotado como diferencia consciente, no como falta.

### 5.8 Lo que esta app hace mejor

Vale decirlo, porque conviene no perderlo al agregar cosas:

- La **racha con rangos** y el escudo mensual es mejor que el streak plano de
  Apple Fitness: perdona una semana mala sin regalar nada.
- Las **indicaciones técnicas del profe** dentro del ejercicio no las tiene
  ninguna de las cuatro, porque no tienen tu infografía.
- La **foto del día** como evidencia y el comparador de espejo son de Fitbod
  para arriba.
- El **PDF de la sesión** con los dibujos no existe en ninguna.

---

## 6. Orden sugerido

**Primero, que no se pierda un entrenamiento** — es lo único que hace abandonar
una app de gimnasio: 1.1 (foto obligatoria), 1.2 (sesión huérfana), 1.4 (doble
toque).

**Segundo, que los errores se vean**: 1.3 (escrituras sin catch), 1.5 (callback
de la hoja).

**Tercero, lo que más se usa**: 5.1 (descanso persistente), 5.3 (récord al lado
del peso), 2.1 (los mensajes de récord que ya escribiste).

**Cuarto, prolijidad**: 5.2 (editar sesión pasada), 3.1 a 3.6 (unidades,
terminología, duplicaciones), 4.1 (escrituras por campo).

Lo de la Fase 1 —login y zona horaria— ya está hecho y no entra en esta lista.
