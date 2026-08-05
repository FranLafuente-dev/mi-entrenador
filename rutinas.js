/* ============================================================================
   MI ENTRENADOR — Datos de rutinas
   ----------------------------------------------------------------------------
   Este es el ÚNICO archivo que se toca para cambiar la rutina.
   La app NO edita nada de acá: lee y listo.
   Si cambia la rutina, se edita este archivo, se sube a GitHub y se actualiza
   "version" de abajo. El historial viejo NO se rompe porque cada sesión
   guarda su propio snapshot con la version que estaba vigente ese día.

   Imágenes: en /img/ejercicios/  (extraídas de las infografías del profe)
   ========================================================================== */

const RUTINAS_VERSION = "2026-08";

/* --- Configuración general ------------------------------------------------ */
const CONFIG = {
  horaEntreno: "10:00",          // hora habitual
  horaAviso: "12:00",            // "todavía no fuiste, ¿a qué hora vas?"
  horaLimite: "20:00",           // a partir de acá, "la racha está en juego"
  aguaObjetivoMl: 2000,          // 2 botellas de 1 L
  botellaMl: 1000,               // editable desde la app
  vasoMl: 250,                   // editable desde la app
  pesajeDia: 1,                  // lunes
  descansoEntreSeriesSeg: 90,    // 60-90 seg según la infografía
  diasDescanso: [0, 3, 6],       // domingo, miércoles, sábado
  sesionesPorSemana: 4,
  maxRecuperacionesPorSemana: 1,
  escudosPorMes: 1,
};

/* --- Rangos (racha en semanas completas consecutivas) --------------------- */
const RANGOS = [
  { semanas: 0,  nombre: "Recluta" },
  { semanas: 1,  nombre: "Soldado" },
  { semanas: 2,  nombre: "Cabo" },
  { semanas: 3,  nombre: "Cabo Primero" },
  { semanas: 4,  nombre: "Sargento" },
  { semanas: 8,  nombre: "Sargento Primero" },
  { semanas: 12, nombre: "Suboficial" },
  { semanas: 24, nombre: "Sargento de Hierro" },
];

/* ==========================================================================
   RUTINA A — INTERVALOS (lunes y jueves) · ~60 min
   Estructura: entrada en calor + 4 vueltas de (7' cinta + 7' circuito)
   El circuito CORTA POR TIEMPO, no por repeticiones.
   ========================================================================== */
const INTERVALOS = {
  id: "intervalos",
  nombre: "Intervalos",
  dias: [1, 4],                  // lunes y jueves
  duracionAproxMin: 60,
  tipo: "intervalos",

  entradaEnCalor: {
    nombre: "Entrada en calor · Movilidad",
    duracionSeg: 400,            // 6-7 min
    nota: "Sin peso. De arriba hacia abajo. Sin forzar.",
    imgResumen: "movilidad-completa.webp",
    ejercicios: [
      { id: "mov-hombros",    nombre: "Círculos de hombros y brazos", img: "movilidad-circulos-hombros.webp" },
      { id: "mov-torso",      nombre: "Rotaciones de torso y cadera", img: "movilidad-rotaciones-torso.webp" },
      { id: "mov-rodilla",    nombre: "Rodilla al pecho",             img: "movilidad-rodilla-pecho.webp" },
      { id: "mov-sentadilla", nombre: "Sentadillas sin peso",         img: "movilidad-sentadilla-sin-peso.webp" },
      { id: "mov-tobillo",    nombre: "Círculos de tobillo",          img: "movilidad-circulos-tobillo.webp" },
    ],
  },

  vueltas: 4,
  bloques: [
    { id: "cinta",    tipo: "cardio",   nombre: "Cinta · 4 km/h", duracionSeg: 420, campana: true },
    { id: "circuito", tipo: "circuito", nombre: "Circuito",       duracionSeg: 420, campana: true,
      nota: "Corta por tiempo, no por repeticiones. Las vueltas que entren." },
  ],

  // Ejercicios del bloque "circuito"
  circuito: [
    { id: "sentadilla-press", orden: 1, grupo: "piernas",
      nombre: "Sentadilla con press",
      reps: 20, peso: 5, unidad: "kg", pesoPaso: 1, material: "mancuerna",
      img: "sentadilla-con-press.webp",
      cues: ["Pecho arriba, rodillas hacia afuera.", "Empujá arriba al subir."] },

    { id: "curl-biceps", orden: 2, grupo: "brazos",
      nombre: "Curl de bíceps alternado",
      reps: 20, peso: 5, unidad: "kg", pesoPaso: 1, porLado: true, material: "mancuerna",
      img: "curl-biceps-alternado.webp",
      cues: ["Espalda recta, codo fijo.", "Un brazo por vez, sin balancear."] },

    { id: "elevacion-gemelos", orden: 3, grupo: "piernas",
      nombre: "Elevación de gemelos",
      reps: 20, peso: 0, unidad: "kg", pesoPaso: 1, material: "sin carga",
      img: "elevacion-gemelos.webp",
      cues: ["Subí lo más alto posible.", "Pausá 1 seg arriba. Bajá lento."] },

    { id: "patada-triceps", orden: 4, grupo: "brazos",
      nombre: "Patada de tríceps",
      reps: 20, peso: 5, unidad: "kg", pesoPaso: 1, porLado: true, material: "mancuerna",
      img: "patada-triceps.webp",
      cues: ["Codos quietos y pegados.", "Solo se mueve el antebrazo."] },
  ],
};

/* ==========================================================================
   RUTINA B — MUSCULACIÓN (martes y viernes) · ~70 min
   3 tren inferior + 3 tren superior · 4 series cada uno
   NO es circuito: 4 series del mismo ejercicio, descanso 60-90 seg,
   recién ahí se pasa al siguiente.
   ========================================================================== */
const MUSCULACION = {
  id: "musculacion",
  nombre: "Musculación",
  dias: [2, 5],                  // martes y viernes
  duracionAproxMin: 70,
  tipo: "series",

  criterioPeso: "El peso correcto es el que te deja terminar la serie con las últimas 2 repeticiones difíciles, pero con técnica limpia. Si llegás sobrado, subí. Si se rompe la técnica, bajá.",

  entradaEnCalor: {
    nombre: "Entrada en calor",
    duracionSeg: 900,            // 15 min
    imgResumen: "calentamiento-completo.webp",
    ejercicios: [
      { id: "cal-rotaciones", nombre: "Rotaciones",
        detalle: "Cuello · hombros · brazos · torso · cadera · tobillos",
        img: "calentamiento-rotaciones.webp" },
      { id: "cal-abdominales", nombre: "Abdominales + espinales",
        detalle: "4 series de 20 + 20", series: 4, reps: "20 + 20",
        img: "calentamiento-abdominales.webp" },
      { id: "cal-cinta", nombre: "Cinta · 4 km/h",
        detalle: "10 min", duracionSeg: 600, campana: true,
        img: "calentamiento-cinta.webp" },
    ],
  },

  bloques: [
    {
      nombre: "Tren inferior",
      ejercicios: [
        { id: "prensa-pos1", orden: 1, grupo: "piernas",
          nombre: "Prensa · Posición 1",
          subtitulo: "Cuádriceps",
          series: 4, reps: 12, pesoPaso: 5, pesoSugerido: 60,
          pesoNota: "Calibrado el 4/8: 60 kg, cómodo",
          img: "prensa-posicion-1.webp",
          cues: ["Pies bajos y juntos: trabaja el cuádriceps.",
                 "No estires del todo la rodilla arriba. No despegues la cola."] },

        { id: "prensa-pos2", orden: 2, grupo: "piernas",
          nombre: "Prensa · Posición 2",
          subtitulo: "Glúteo e isquios",
          series: 4, reps: 12, pesoPaso: 5, pesoSugerido: 60,
          pesoNota: "Calibrado el 4/8: 60 kg, costó más que la posición 1",
          img: "prensa-posicion-2.webp",
          cues: ["Pies altos y separados: trabaja glúteo e isquios.",
                 "Empujá con el talón, no con la punta del pie."] },

        { id: "extension-cuadriceps", orden: 3, grupo: "piernas",
          nombre: "Extensión de cuádriceps",
          series: 4, reps: 12, pesoPaso: 2.5, pesoSugerido: 30,
          pesoNota: "Calibrado el 4/8: 30 kg",
          img: "extension-cuadriceps.webp",
          cues: ["Apretá 1 segundo arriba con las piernas estiradas.",
                 "Bajá lento, sin dejar caer el peso."] },
      ],
    },
    {
      nombre: "Tren superior",
      ejercicios: [
        { id: "dorsalera", orden: 4, grupo: "espalda",
          nombre: "Dorsalera",
          series: 4, reps: 12, pesoPaso: 2.5, pesoSugerido: 38,
          pesoNota: "Calibrado el 4/8: 38 kg (45 fue demasiado)",
          img: "dorsalera.webp",
          cues: ["Pecho arriba, tirá con los codos, no con las manos.",
                 "No te tires para atrás con el torso."] },

        { id: "press-pecho", orden: 5, grupo: "pecho",
          nombre: "Press de pecho en máquina",
          series: 4, reps: 12, pesoPaso: 2.5, pesoSugerido: 30,
          pesoNota: "Calibrado el 4/8: 30 kg, con lo justo",
          img: "press-pecho-maquina.webp",
          cues: ["Espalda apoyada en el respaldo todo el movimiento.",
                 "Codos a la altura del pecho, no más arriba."] },

        { id: "remo-sentado", orden: 6, grupo: "espalda",
          nombre: "Remo sentado en máquina",
          series: 4, reps: 12, pesoPaso: 2.5, pesoSugerido: 45,
          pesoNota: "Calibrado el 4/8: 45 kg, con lo justo",
          img: "remo-sentado.webp",
          cues: ["Pecho afuera, juntá los omóplatos atrás.",
                 "El torso queda quieto, no uses envión."] },
      ],
    },
  ],

  cierre: {
    nombre: "Cierre",
    detalle: "10 min de cinta · 4 km/h · caminata suave",
    duracionSeg: 600,
    campana: true,
    img: "calentamiento-cinta.webp",
  },

  recordatorio: "Anotá los kilos de cada serie. La próxima semana subí en al menos uno.",
};

/* --- Calendario semanal --------------------------------------------------- */
const SEMANA = {
  0: { tipo: "descanso" },                 // domingo
  1: { tipo: "entreno", rutina: "intervalos" },
  2: { tipo: "entreno", rutina: "musculacion" },
  3: { tipo: "descanso" },                 // miércoles
  4: { tipo: "entreno", rutina: "intervalos" },
  5: { tipo: "entreno", rutina: "musculacion" },
  6: { tipo: "descanso" },                 // sábado
};

const RUTINAS = { intervalos: INTERVALOS, musculacion: MUSCULACION };

/* ==========================================================================
   SEMILLA — sesiones ya hechas, se cargan la primera vez que abre la app
   ========================================================================== */
const SEED = [
  {
    fecha: "2026-08-03",           // lunes
    rutina: "intervalos",
    estado: "hecha",
    vueltas: [2.5, 3, 3, 3],       // vueltas del circuito en cada bloque
    extra: "10 min extra de caminata a 4 km/h al final",
    nota: "Primera sesión de intervalos",
  },
  {
    fecha: "2026-08-04",           // martes
    rutina: "musculacion",
    estado: "hecha",
    series: {
      "prensa-pos1":           [{ peso: 60, reps: 12 }, { peso: 60, reps: 12 }, { peso: 60, reps: 12 }, { peso: 60, reps: 12 }],
      "prensa-pos2":           [{ peso: 60, reps: 12 }, { peso: 60, reps: 12 }, { peso: 60, reps: 12 }, { peso: 60, reps: 12 }],
      "extension-cuadriceps":  [{ peso: 30, reps: 12 }, { peso: 30, reps: 12 }, { peso: 30, reps: 12 }, { peso: 30, reps: 12 }],
      "dorsalera":             [{ peso: 38, reps: 12 }, { peso: 38, reps: 12 }, { peso: 38, reps: 12 }, { peso: 38, reps: 12 }],
      "press-pecho":           [{ peso: 30, reps: 12 }, { peso: 30, reps: 12 }, { peso: 30, reps: 12 }, { peso: 30, reps: 12 }],
      "remo-sentado":          [{ peso: 45, reps: 12 }, { peso: 45, reps: 12 }, { peso: 45, reps: 12 }, { peso: 45, reps: 12 }],
    },
    esfuerzo: {
      "prensa-pos1": "justo",
      "prensa-pos2": "justo",
      "extension-cuadriceps": "justo",
      "dorsalera": "justo",
      "press-pecho": "justo",
      "remo-sentado": "justo",
    },
    notas: {
      "prensa-pos2": "Isquios y glúteo costaron más que cuádriceps",
      "dorsalera": "45 kg costó mucho, bajé a 38",
      "remo-sentado": "45 kg con lo justo",
      "press-pecho": "30 kg con lo justo",
    },
  },
];

/* ==========================================================================
   FERIADOS — completar a mano.
   Formato: "YYYY-MM-DD", uno por línea, entre comillas y separados por coma.
   Ejemplo:
     const FERIADOS = [
       "2026-12-25",
       "2027-01-01",
     ];
   Los días listados acá cuentan como descanso: no se pintan de rojo ni
   descuentan de la semana. Mientras esté vacío, los feriados se marcan
   desde la app con el botón de causa mayor.
   ========================================================================== */
const FERIADOS = [];
