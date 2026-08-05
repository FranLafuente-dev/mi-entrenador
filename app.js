/* ============================================================================
   MI ENTRENADOR — lógica de la app
   ----------------------------------------------------------------------------
   Lee las rutinas de rutinas.js y los textos de mensajes.js (scripts clásicos,
   visibles acá como globales). Firebase v10 modular por CDN.
   ========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged,
  signInWithRedirect, signInWithPopup, getRedirectResult, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, setDoc, getDoc, getDocs, onSnapshot, deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

/* ==========================================================================
   ESTADO GLOBAL
   ========================================================================== */
const S = {
  user: null,
  db: null,
  auth: null,
  config: null,            // doc entrenador/{uid}/config/app
  dias: new Map(),         // "YYYY-MM-DD" -> data
  pesajes: new Map(),      // "YYYY-MM-DD" -> data
  semanas: new Map(),      // "YYYY-Www"  -> data
  listo: { dias: false, pesajes: false, semanas: false, config: false },
  cargado: false,
  sesion: null,            // sesión de entrenamiento activa
  calMes: null,            // primer día del mes visible en el calendario
  audioListo: false,
  wakeLock: null,
  procesandoSemanas: false,
};

const NOMBRE = "Fran";
const DIAS_NOMBRE = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES_NOMBRE = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/* ==========================================================================
   UTILIDADES
   ========================================================================== */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function esc(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* --- Fechas (todo en hora local) --- */
function fmtISO(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"),
    dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function hoyISO() { return fmtISO(new Date()); }
function sumarDias(iso, n) {
  const d = parseISO(iso); d.setDate(d.getDate() + n); return fmtISO(d);
}
function diaSemanaDe(iso) { return parseISO(iso).getDay(); }

/* Lunes de la semana de una fecha (semana lunes→domingo) */
function lunesDe(iso) {
  const d = parseISO(iso);
  const dif = (d.getDay() + 6) % 7;          // lunes=0 … domingo=6
  d.setDate(d.getDate() - dif);
  return fmtISO(d);
}
function domingoDe(iso) { return sumarDias(lunesDe(iso), 6); }

/* Clave ISO de semana: "2026-W32" */
function claveSemana(iso) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));   // jueves de la semana
  const anio = d.getFullYear();
  const ene4 = new Date(anio, 0, 4);
  const sem = 1 + Math.round(((d - ene4) / 86400000 - 3 + ((ene4.getDay() + 6) % 7)) / 7);
  return `${anio}-W${String(sem).padStart(2, "0")}`;
}

function fmtFechaLarga(iso) {
  const d = parseISO(iso);
  return `${DIAS_NOMBRE[d.getDay()]} ${d.getDate()} de ${MESES_NOMBRE[d.getMonth()]}`;
}
function fmtFechaCorta(iso) {
  const d = parseISO(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}
function fmtHora(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fmtDuracion(seg) {
  const m = Math.round(seg / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}
function fmtCrono(seg) {
  seg = Math.max(0, Math.ceil(seg));
  return `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, "0")}`;
}
function fmtKg(n) { return Number(n).toLocaleString("es-AR"); }

/* --- Toasts --- */
function toast(texto, tipo = "", dur = 4200) {
  const t = el("div", `toast ${tipo}`, esc(texto));
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), dur);
}

/* --- Mensajes del sargento: rotación diaria de variantes --- */
function sargento(clave, vars = {}) {
  const lista = (typeof MENSAJES !== "undefined" && MENSAJES[clave]) || [];
  if (!lista.length) return "";
  // Día contado en hora local del dispositivo (Buenos Aires), no UTC:
  // así la variante rota a la medianoche y no a las 21 h
  const ahora = new Date();
  const dia = Math.floor((ahora.getTime() - ahora.getTimezoneOffset() * 60000) / 86400000);
  let hash = 0;
  for (const c of clave) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  let m = lista[(dia + hash) % lista.length];
  for (const [k, v] of Object.entries(vars)) m = m.split(`{${k}}`).join(v);
  return m;
}

/* ==========================================================================
   TEMA
   ========================================================================== */
function aplicarTema(pref) {
  // pref: "auto" | "light" | "dark"
  if (!pref || pref === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", pref);
  localStorage.setItem("tema", pref || "auto");
}
aplicarTema(localStorage.getItem("tema") || "auto");

/* ==========================================================================
   FIREBASE — arranque
   ========================================================================== */
let refs = null;  // referencias firestore del usuario logueado

function esStandaloneIOS() {
  return window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
}

function iniciarFirebase() {
  const app = initializeApp(firebaseConfig);
  S.auth = getAuth(app);
  S.db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });

  getRedirectResult(S.auth).catch((e) => {
    mostrarErrorLogin(e);
  });

  onAuthStateChanged(S.auth, (user) => {
    if (user) {
      S.user = user;
      prepararRefs();
      conectarDatos();
      mostrarVista("inicio");
    } else {
      S.user = null;
      mostrarVista("login");
    }
  });
}

function prepararRefs() {
  const uid = S.user.uid;
  refs = {
    config: doc(S.db, "entrenador", uid, "config", "app"),
    dia: (f) => doc(S.db, "entrenador", uid, "dias", f),
    diaMedia: (f, cual) => doc(S.db, "entrenador", uid, "dias", f, "media", cual),
    dias: collection(S.db, "entrenador", uid, "dias"),
    pesaje: (f) => doc(S.db, "entrenador", uid, "pesajes", f),
    pesajeMedia: (f, cual) => doc(S.db, "entrenador", uid, "pesajes", f, "media", cual),
    pesajes: collection(S.db, "entrenador", uid, "pesajes"),
    semana: (c) => doc(S.db, "entrenador", uid, "semanas", c),
    semanas: collection(S.db, "entrenador", uid, "semanas"),
  };
}

function mostrarErrorLogin(e) {
  const caja = $("#login-error");
  caja.textContent = "No se pudo entrar. Probá de nuevo. (" + (e?.code || e?.message || e) + ")";
  caja.classList.remove("oculta");
}

async function entrar() {
  const proveedor = new GoogleAuthProvider();
  try {
    if (esStandaloneIOS()) {
      // En iOS instalado, el popup no funciona: redirect siempre.
      await signInWithRedirect(S.auth, proveedor);
    } else {
      try {
        await signInWithPopup(S.auth, proveedor);
      } catch (e) {
        if (e && (e.code === "auth/popup-blocked" || e.code === "auth/popup-closed-by-user" ||
                  e.code === "auth/operation-not-supported-in-this-environment")) {
          await signInWithRedirect(S.auth, proveedor);
        } else throw e;
      }
    }
  } catch (e) {
    mostrarErrorLogin(e);
  }
}

/* ==========================================================================
   DATOS — listeners y semilla
   ========================================================================== */
function conectarDatos() {
  onSnapshot(refs.config, (snap) => {
    S.config = snap.exists() ? snap.data() : null;
    S.listo.config = true;
    alCambiarDatos();
  });
  onSnapshot(refs.dias, (snap) => {
    S.dias = new Map();
    snap.forEach((d) => S.dias.set(d.id, d.data()));
    S.listo.dias = true;
    alCambiarDatos();
  });
  onSnapshot(refs.pesajes, (snap) => {
    S.pesajes = new Map();
    snap.forEach((d) => S.pesajes.set(d.id, d.data()));
    S.listo.pesajes = true;
    alCambiarDatos();
  });
  onSnapshot(refs.semanas, (snap) => {
    S.semanas = new Map();
    snap.forEach((d) => S.semanas.set(d.id, d.data()));
    S.listo.semanas = true;
    alCambiarDatos();
  });
}

let seedEnCurso = false;

async function alCambiarDatos() {
  if (!S.listo.config || !S.listo.dias || !S.listo.pesajes || !S.listo.semanas) return;

  if (!S.config && !seedEnCurso) {
    seedEnCurso = true;
    await cargarSemilla();
    seedEnCurso = false;
    return; // los snapshots vuelven a disparar
  }
  if (!S.config) return;

  S.cargado = true;
  await procesarSemanasCerradas();
  refrescarVistaActual();
}

/* Primera vez: configuración inicial + sesiones semilla de rutinas.js */
async function cargarSemilla() {
  const conf = {
    creado: Date.now(),
    seedCargada: true,
    botellaMl: CONFIG.botellaMl,
    vasoMl: CONFIG.vasoMl,
    aguaObjetivoMl: CONFIG.aguaObjetivoMl,
    descansoSeg: CONFIG.descansoEntreSeriesSeg,
    pesoObjetivo: null,
    escudos: {},          // { "2026-08": "2026-W33" } — escudo usado por mes
    notasEjercicio: {},   // { ejercicioId: "texto" } — nota persistente
    ascensos: [],         // ejercicios marcados para subir peso
  };

  if (S.dias.size === 0 && typeof SEED !== "undefined") {
    for (const s of SEED) {
      const dia = {
        fecha: s.fecha,
        tipo: "entreno",
        rutinaId: s.rutina,
        rutinasVersion: RUTINAS_VERSION,
        estado: s.estado || "hecha",
        inicio: null,
        fin: null,
        series: {},
        esfuerzo: s.esfuerzo || {},
        notas: s.notas || {},
        ascensoMarcado: [],
        comentario: [s.nota, s.extra].filter(Boolean).join(". "),
        aguaMl: 0,
        tieneFoto: false,
      };
      if (s.series) {
        for (const [id, series] of Object.entries(s.series)) {
          dia.series[id] = series.map((x) => ({ peso: x.peso, reps: x.reps, hecha: true }));
        }
      }
      if (s.vueltas) dia.vueltas = s.vueltas;
      await setDoc(refs.dia(s.fecha), dia);
    }
  }
  await setDoc(refs.config, conf, { merge: true });
}

async function guardarConfig(cambios) {
  Object.assign(S.config, cambios);
  await setDoc(refs.config, cambios, { merge: true });
}

async function guardarDia(fecha, cambios) {
  const previo = S.dias.get(fecha) || {};
  const nuevo = { ...previo, ...cambios, fecha };
  S.dias.set(fecha, nuevo);
  await setDoc(refs.dia(fecha), cambios, { merge: true });
}

/* ==========================================================================
   REGLAS DE NEGOCIO — estado del día
   ========================================================================== */
function esFeriado(iso) {
  return typeof FERIADOS !== "undefined" && FERIADOS.includes(iso);
}
function planDelDia(iso) {
  // Qué toca ese día según rutinas.js (sin mirar lo registrado)
  if (esFeriado(iso)) return { tipo: "descanso", feriado: true };
  const p = SEMANA[diaSemanaDe(iso)];
  return p ? { ...p } : { tipo: "descanso" };
}

/* Estado visible de un día (sección 4 del spec) */
function estadoDia(iso) {
  const reg = S.dias.get(iso);
  const plan = planDelDia(iso);
  const hoy = hoyISO();

  if (reg) {
    if (reg.estado === "hecha") return "hecha";
    if (reg.estado === "recuperada") return "recuperada";
    if (reg.estado === "causa-mayor") return "causa-mayor";
  }
  if (plan.tipo === "descanso") {
    return (reg && reg.caminata && reg.caminata.minutos) ? "descanso-caminata" : "descanso";
  }
  // Día de entreno sin registro cerrado
  if (iso < hoy) return "fallada";      // el rojo recién se pinta pasadas las 23:59
  return "pendiente";
}

function sesionRegistrada(iso) {
  const e = estadoDia(iso);
  return e === "hecha" || e === "recuperada";
}

/* ==========================================================================
   REGLAS DE NEGOCIO — semanas, racha, rangos
   ========================================================================== */
function primeraFechaConDatos() {
  let min = null;
  for (const f of S.dias.keys()) if (!min || f < min) min = f;
  return min || hoyISO();
}

/* Resumen de una semana a partir de los días registrados */
function resumenSemana(lunes) {
  const dias = [];
  for (let i = 0; i < 7; i++) dias.push(sumarDias(lunes, i));

  let sesiones = 0, recuperadas = 0, caminatas = 0, causaEscudo = false;
  const faltantes = [];
  for (const f of dias) {
    const e = estadoDia(f);
    const plan = planDelDia(f);
    if (e === "hecha") sesiones++;
    else if (e === "recuperada") { sesiones++; recuperadas++; }
    else if (e === "descanso-caminata") caminatas++;
    if (e === "causa-mayor") {
      const reg = S.dias.get(f);
      if (reg?.causaMayor?.conEscudo) causaEscudo = true;
    }
    if (plan.tipo === "entreno" && !sesionRegistrada(f)) faltantes.push(f);
  }
  const clave = claveSemana(lunes);
  const guardada = S.semanas.get(clave);
  const escudo = causaEscudo || !!guardada?.escudo;

  return {
    clave, lunes, domingo: sumarDias(lunes, 6),
    sesiones, recuperadas, caminatas, faltantes,
    completa: sesiones >= CONFIG.sesionesPorSemana,
    escudo,
    mencionHonor: sesiones >= CONFIG.sesionesPorSemana && caminatas > 0,
  };
}

/* Recorre todas las semanas cerradas y calcula racha + rango */
function calcularRacha() {
  const inicio = lunesDe(primeraFechaConDatos());
  const lunesActual = lunesDe(hoyISO());
  let racha = 0;
  const cerradas = [];

  for (let l = inicio; l < lunesActual; l = sumarDias(l, 7)) {
    const r = resumenSemana(l);
    if (r.completa) racha++;
    else if (r.escudo) { /* congelada */ }
    else racha = Math.max(0, racha - 1);
    r.rachaAlCierre = racha;
    cerradas.push(r);
  }
  return { racha, cerradas, semanaActual: resumenSemana(lunesActual) };
}

function rangoDe(racha) {
  let r = RANGOS[0];
  for (const x of RANGOS) if (racha >= x.semanas) r = x;
  return r;
}
function rangoSiFalla(racha) {
  return rangoDe(Math.max(0, racha - 1));
}

/* Mes al que pertenece una semana (el de su domingo) */
function mesDeSemana(lunes) { return domingoDe(lunes).slice(0, 7); }

function escudoDisponible(mes) {
  return !(S.config?.escudos && S.config.escudos[mes]);
}

/* Sesiones de la semana actual pendientes de recuperar */
function pendientesDeRecuperar() {
  const lunes = lunesDe(hoyISO());
  const hoy = hoyISO();
  const usadas = resumenSemana(lunes).recuperadas;
  if (usadas >= CONFIG.maxRecuperacionesPorSemana) return [];
  const out = [];
  for (let i = 0; i < 7; i++) {
    const f = sumarDias(lunes, i);
    if (f >= hoy) break;
    const plan = planDelDia(f);
    if (plan.tipo === "entreno" && !sesionRegistrada(f) && estadoDia(f) !== "causa-mayor") {
      out.push({ fecha: f, rutinaId: plan.rutina });
    }
  }
  return out;
}

/* Al abrir la app: cierra semanas pasadas, pide decisión de escudo si hace
   falta, guarda resúmenes y dispara los avisos de rango/logros. */
async function procesarSemanasCerradas() {
  if (S.procesandoSemanas) return;
  S.procesandoSemanas = true;
  try {
    let reiniciar = true;
    while (reiniciar) {
      reiniciar = false;
      const { cerradas } = calcularRacha();
      let rachaPrevia = 0;

      for (const r of cerradas) {
        const guardada = S.semanas.get(r.clave);

        // Semana incompleta, sin decisión de escudo todavía
        if (!r.completa && !r.escudo && !guardada?.decidida) {
          const mes = mesDeSemana(r.lunes);
          if (escudoDisponible(mes)) {
            const usa = await preguntarEscudo(r);
            if (usa) {
              const escudos = { ...(S.config.escudos || {}) };
              escudos[mes] = r.clave;
              await guardarConfig({ escudos });
              const marca = { clave: r.clave, escudo: true, decidida: true };
              S.semanas.set(r.clave, { ...(guardada || {}), ...marca });
              await setDoc(refs.semana(r.clave), marca, { merge: true });
              toast(sargento("escudoUsado"), "toast-alerta", 6000);
              reiniciar = true;      // recalcular la racha con el escudo puesto
              break;
            }
          }
        }

        const resumen = {
          clave: r.clave, lunes: r.lunes,
          sesiones: r.sesiones, recuperadas: r.recuperadas,
          caminatas: r.caminatas, completa: r.completa,
          escudo: r.escudo, mencionHonor: r.mencionHonor,
          racha: r.rachaAlCierre, rango: rangoDe(r.rachaAlCierre).nombre,
          decidida: true,
        };

        const yaAvisada = guardada?.avisada;
        const sinCambios = guardada && guardada.decidida &&
          guardada.completa === resumen.completa &&
          guardada.sesiones === resumen.sesiones &&
          guardada.recuperadas === resumen.recuperadas &&
          guardada.caminatas === resumen.caminatas &&
          guardada.escudo === resumen.escudo &&
          guardada.mencionHonor === resumen.mencionHonor &&
          guardada.racha === resumen.racha;
        if (!sinCambios) {
          S.semanas.set(r.clave, { ...(guardada || {}), ...resumen, avisada: true });
          await setDoc(refs.semana(r.clave), { ...resumen, avisada: true }, { merge: true });
        }

        // Avisos (una sola vez por semana cerrada)
        if (!yaAvisada) {
          const rangoAntes = rangoDe(rachaPrevia).nombre;
          const rangoAhora = rangoDe(r.rachaAlCierre).nombre;
          if (rangoAhora !== rangoAntes) {
            if (r.rachaAlCierre > rachaPrevia) {
              toast(sargento("subioRango", { rango: rangoAhora, racha: r.rachaAlCierre }), "toast-record", 7000);
            } else {
              toast(sargento("bajoRango", { rango: rangoAhora }), "toast-alerta", 7000);
            }
          }
          if (r.mencionHonor) toast(sargento("mencionHonor"), "toast-record", 6000);

          // Mes perfecto / de hierro: 4 semanas completas consecutivas
          const idx = cerradas.indexOf(r);
          if (idx >= 3) {
            const cuatro = cerradas.slice(idx - 3, idx + 1);
            if (cuatro.every((x) => x.completa)) {
              const hierro = cuatro.every((x) => x.recuperadas === 0 && !x.escudo);
              toast(sargento(hierro ? "mesHierro" : "mesPerfecto"), "toast-record", 7000);
            }
          }
        }
        rachaPrevia = r.rachaAlCierre;
      }
    }
  } finally {
    S.procesandoSemanas = false;
  }
}

/* Pregunta por el escudo con una hoja modal; devuelve true/false */
function preguntarEscudo(r) {
  return new Promise((resolver) => {
    abrirHoja(`
      <h3>Semana incompleta</h3>
      <p>La semana del ${fmtFechaCorta(r.lunes)} cerró con ${r.sesiones} de
      ${CONFIG.sesionesPorSemana} sesiones. Tenés un escudo disponible este mes:
      congela la racha (no baja, pero tampoco sube).</p>
      <div class="hoja-acciones">
        <button id="esc-si" class="btn btn-primario btn-grande">Usar el escudo</button>
        <button id="esc-no" class="btn btn-borde btn-grande">No usarlo (la racha baja 1)</button>
      </div>`, () => resolver(false));
    $("#esc-si").onclick = () => { cerrarHoja(true); resolver(true); };
    $("#esc-no").onclick = () => { cerrarHoja(true); resolver(false); };
  });
}

/* ==========================================================================
   NAVEGACIÓN Y HOJA MODAL
   ========================================================================== */
const VISTAS = ["login", "carga", "inicio", "entreno", "calendario", "peso", "historial"];
let vistaActual = "carga";

function mostrarVista(nombre) {
  vistaActual = nombre;
  for (const v of VISTAS) {
    const elv = $(`#vista-${v === "entreno" ? "entreno" : v}`);
    if (elv) elv.classList.toggle("oculta", v !== nombre);
  }
  refrescarVistaActual();
  window.scrollTo(0, 0);
}

function refrescarVistaActual() {
  if (!S.cargado && vistaActual !== "login" && vistaActual !== "carga") return;
  if (vistaActual === "inicio") renderInicio();
  else if (vistaActual === "calendario") renderCalendario();
  else if (vistaActual === "peso") renderPeso();
  else if (vistaActual === "historial") renderHistorial();
  else if (vistaActual === "entreno" && S.sesion) renderPasoSesion();
}

let hojaOnCerrar = null;
function abrirHoja(html, onCerrar) {
  $("#hoja-contenido").innerHTML = html;
  $("#hoja").classList.remove("oculta");
  $("#velo").classList.remove("oculta");
  hojaOnCerrar = onCerrar || null;
}
function cerrarHoja(silencioso) {
  $("#hoja").classList.add("oculta");
  $("#velo").classList.add("oculta");
  const cb = hojaOnCerrar; hojaOnCerrar = null;
  if (!silencioso && cb) cb();
}
$("#velo").addEventListener("click", () => cerrarHoja());

/* ==========================================================================
   INICIO
   ========================================================================== */
function renderInicio() {
  if (!S.cargado) return;
  const hoy = hoyISO();
  const plan = planDelDia(hoy);
  const reg = S.dias.get(hoy);
  const estado = estadoDia(hoy);
  const hora = new Date().getHours();
  const { racha, semanaActual } = calcularRacha();
  const pendientes = pendientesDeRecuperar();
  const rutinaHoy = plan.tipo === "entreno" ? RUTINAS[plan.rutina] : null;

  $("#inicio-fecha").textContent = fmtFechaLarga(hoy);

  /* --- a) Saludo --- */
  const saludo = $("#saludo");
  saludo.classList.remove("saludo-alerta");
  let stexto = "";
  const vars = {
    dia: DIAS_NOMBRE[diaSemanaDe(hoy)],
    rutina: rutinaHoy ? rutinaHoy.nombre : "",
    racha: String(racha),
    rango: rangoDe(racha).nombre,
    rangoAbajo: rangoSiFalla(racha).nombre,
    pendiente: pendientes.length ? RUTINAS[pendientes[0].rutinaId].nombre : "",
    resumen: reg ? resumenCortoSesion(reg) : "",
  };

  if (estado === "hecha" || estado === "recuperada") {
    stexto = sargento("yaEntreno", vars);
  } else if (plan.tipo === "descanso") {
    stexto = sargento("descanso", vars);
    if (reg?.caminata?.minutos) stexto = sargento("caminataRegistrada", vars);
  } else if (estado === "causa-mayor") {
    stexto = `Hoy quedó cubierto por causa mayor: ${esc(reg?.causaMayor?.motivo || "")}.`;
  } else if (pendientes.length && hora < 12) {
    stexto = sargento("pendienteRecuperar", vars);
  } else if (hora >= 20) {
    // De noche y con racha que perder: el mensaje pone la racha al frente
    stexto = racha > 0 ? sargento("rachaEnRiesgo", vars) : sargento("pasoTarde", vars);
    saludo.classList.add("saludo-alerta");
  } else if (hora >= 12) {
    stexto = sargento("pasoMediodia", vars);
  } else {
    stexto = sargento("aunNoEntreno", vars);
  }
  saludo.textContent = stexto;

  /* --- b) Racha --- */
  const rango = rangoDe(racha);
  const puntos = Array.from({ length: CONFIG.sesionesPorSemana }, (_, i) =>
    `<span class="punto ${i < semanaActual.sesiones ? "on" : ""}"></span>`).join("");

  const proximas = proximasSesiones(semanaActual);
  let falta = "";
  if (!semanaActual.completa && proximas.length) {
    falta = `<div class="racha-falta">Falta: ${proximas.map((p) =>
      `${DIAS_NOMBRE[diaSemanaDe(p.fecha)]} (${RUTINAS[p.rutinaId].nombre})`).join(", ")}</div>`;
  }

  let riesgo = "";
  const dow = diaSemanaDe(hoy);
  const diasQueQuedan = dow === 0 ? 0 : 7 - dow; // hasta el domingo inclusive... (domingo=0)
  const sesionesPosibles = posiblesHastaDomingo();
  if (!semanaActual.completa && racha > 0 &&
      semanaActual.sesiones + sesionesPosibles < CONFIG.sesionesPorSemana) {
    riesgo = `<div class="racha-riesgo">Semana perdida salvo escudo: bajarías a ${rangoSiFalla(racha).nombre}</div>`;
  } else if (!semanaActual.completa && racha > 0 && (dow === 0 || dow >= 5 || hora >= 20)) {
    riesgo = `<div class="racha-riesgo">Si fallás bajás a ${rangoSiFalla(racha).nombre}</div>`;
  } else if (semanaActual.escudo) {
    riesgo = `<div class="racha-congelada">Semana con escudo: racha congelada</div>`;
  }

  $("#racha-caja").innerHTML = `
    <div class="racha-rango">Rango: ${esc(rango.nombre)}</div>
    <div class="racha-num">${racha} <small>${racha === 1 ? "semana" : "semanas"} en racha</small></div>
    <div class="racha-semana">Semana en curso: ${semanaActual.sesiones} de ${CONFIG.sesionesPorSemana}
      <span class="racha-puntos">${puntos}</span></div>
    ${falta}${riesgo}`;

  /* --- c) Botón de acción --- */
  const accion = $("#accion-caja");
  accion.innerHTML = "";
  const sesionAbierta = sesionGuardadaHoy();

  if (estado === "hecha" || estado === "recuperada") {
    accion.appendChild(el("div", "resumen-hoy",
      `<strong>Hoy ya entrenaste</strong>${esc(resumenCortoSesion(reg))}`));
  } else if (sesionAbierta) {
    const b = el("button", "btn btn-rojo btn-gigante", "Continuar entrenamiento");
    b.onclick = () => reanudarSesion();
    accion.appendChild(b);
  } else if (plan.tipo === "entreno") {
    const b = el("button", "btn btn-rojo btn-gigante", "Empezar entrenamiento");
    b.onclick = () => empezarSesion(plan.rutina, false);
    accion.appendChild(b);
    if (estado !== "causa-mayor") {
      const noLlego = el("button", "btn btn-borde btn-medio accion-secundaria", "Hoy no llego");
      noLlego.style.width = "100%";
      noLlego.onclick = () => hojaNoLlego();
      accion.appendChild(noLlego);
    }
  } else if (pendientes.length) {
    const b = el("button", "btn btn-rojo btn-gigante",
      `Recuperar ${esc(RUTINAS[pendientes[0].rutinaId].nombre)}`);
    b.onclick = () => empezarSesion(pendientes[0].rutinaId, true, pendientes[0].fecha);
    accion.appendChild(b);
    const cam = el("button", "btn btn-borde btn-medio accion-secundaria", "Registrar caminata");
    cam.style.width = "100%";
    cam.onclick = () => hojaCaminata();
    accion.appendChild(cam);
  } else {
    const b = el("button", "btn btn-primario btn-gigante", "Registrar caminata");
    b.onclick = () => hojaCaminata();
    accion.appendChild(b);
  }

  /* --- Aviso de pendiente (si además hoy es día de entreno) --- */
  const aviso = $("#aviso-pendiente");
  if (pendientes.length && plan.tipo === "entreno" && !sesionRegistrada(hoy)) {
    aviso.innerHTML = esc(sargento("pendienteRecuperar", vars)) +
      ` <button class="btn btn-suave btn-medio mt" id="btn-recuperar" style="width:100%">Recuperar ${esc(RUTINAS[pendientes[0].rutinaId].nombre)} hoy</button>`;
    aviso.classList.remove("oculta");
    $("#btn-recuperar").onclick = () => empezarSesion(pendientes[0].rutinaId, true, pendientes[0].fecha);
  } else {
    aviso.classList.add("oculta");
  }

  guardarSnapshotInicio();
}

/* Sesiones que aún se pueden hacer esta semana (para el "Falta:") */
function proximasSesiones(semanaActual) {
  const hoy = hoyISO();
  const out = [];
  // primero las de días futuros de esta semana
  for (let i = 0; i < 7; i++) {
    const f = sumarDias(semanaActual.lunes, i);
    if (f < hoy) continue;
    const plan = planDelDia(f);
    if (plan.tipo === "entreno" && !sesionRegistrada(f)) out.push({ fecha: f, rutinaId: plan.rutina });
  }
  // más las pendientes de recuperar (días pasados)
  for (const p of pendientesDeRecuperar()) {
    if (!out.find((x) => x.rutinaId === p.rutinaId && x.fecha === p.fecha)) out.push(p);
  }
  return out.slice(0, CONFIG.sesionesPorSemana);
}

/* Cuántas sesiones puede llegar a sumar hasta el domingo */
function posiblesHastaDomingo() {
  const hoy = hoyISO();
  const domingo = domingoDe(hoy);
  let normales = 0;
  for (let f = hoy; f <= domingo; f = sumarDias(f, 1)) {
    const plan = planDelDia(f);
    if (plan.tipo === "entreno" && !sesionRegistrada(f)) normales++;
  }
  const rec = pendientesDeRecuperar().length ? 1 : 0;
  return normales + rec;
}

function resumenCortoSesion(reg) {
  if (!reg) return "";
  const r = RUTINAS[reg.rutinaId];
  const partes = [];
  if (r) partes.push(r.nombre);
  if (reg.rutinaId === "musculacion" && reg.series) {
    const vol = volumenSesion(reg);
    if (vol) partes.push(`${fmtKg(vol)} kg movidos`);
    const n = Object.values(reg.series).reduce((a, s) => a + s.filter((x) => x.hecha).length, 0);
    partes.push(`${n} series`);
  }
  if (reg.rutinaId === "intervalos" && reg.vueltas) {
    partes.push(`${reg.vueltas.reduce((a, b) => a + (b || 0), 0)} vueltas de circuito`);
  }
  if (reg.inicio && reg.fin) partes.push(fmtDuracion((reg.fin - reg.inicio) / 1000));
  return partes.join(" · ") + ".";
}

function volumenSesion(reg) {
  if (reg.rutinaId === "musculacion" && reg.series) {
    let v = 0;
    for (const s of Object.values(reg.series))
      for (const x of s) if (x.hecha) v += (x.peso || 0) * (x.reps || 0);
    return Math.round(v);
  }
  if (reg.rutinaId === "intervalos" && reg.vueltas) {
    const porVuelta = INTERVALOS.circuito.reduce((a, e) =>
      a + e.reps * (e.peso || 0) * (e.porLado ? 2 : 1), 0);
    return Math.round(reg.vueltas.reduce((a, b) => a + (b || 0), 0) * porVuelta);
  }
  return 0;
}

/* Snapshot para pintar el inicio en el próximo arranque antes de que
   responda Firestore */
function guardarSnapshotInicio() {
  try {
    localStorage.setItem("snapshotInicio", JSON.stringify({
      saludo: $("#saludo").textContent,
      racha: $("#racha-caja").innerHTML,
      fecha: hoyISO(),
    }));
  } catch (_) { /* sin espacio: no pasa nada */ }
}
function pintarSnapshotInicio() {
  try {
    const s = JSON.parse(localStorage.getItem("snapshotInicio") || "null");
    if (s && s.fecha === hoyISO()) {
      $("#saludo").textContent = s.saludo;
      $("#racha-caja").innerHTML = s.racha;
      $("#inicio-fecha").textContent = fmtFechaLarga(hoyISO());
      $("#vista-carga").classList.add("oculta");
      $("#vista-inicio").classList.remove("oculta");
    }
  } catch (_) { }
}

/* ==========================================================================
   AGUA
   ========================================================================== */
function hojaAgua() {
  const hoy = hoyISO();
  const pintar = () => {
    const reg = S.dias.get(hoy);
    const ml = reg?.aguaMl || 0;
    const objetivo = S.config.aguaObjetivoMl || 2000;
    const pct = Math.min(100, Math.round((ml / objetivo) * 100));
    abrirHoja(`
      <h3>Agua de hoy</h3>
      <div class="agua-progreso">
        <div class="agua-num">${ml} <small>/ ${objetivo} ml</small></div>
        <div class="agua-barra ${ml >= objetivo ? "llena" : ""}"><i style="width:${pct}%"></i></div>
      </div>
      <div class="agua-botones">
        <button id="agua-botella" class="btn btn-primario btn-grande">+ Botella (${S.config.botellaMl} ml)</button>
        <button id="agua-vaso" class="btn btn-borde btn-grande">+ Vaso (${S.config.vasoMl} ml)</button>
      </div>
      <button id="agua-menos" class="btn btn-texto mt" style="width:100%">Corregir (−${S.config.vasoMl} ml)</button>`);
    $("#agua-botella").onclick = () => sumar(S.config.botellaMl);
    $("#agua-vaso").onclick = () => sumar(S.config.vasoMl);
    $("#agua-menos").onclick = () => sumar(-S.config.vasoMl);
  };
  const sumar = async (ml) => {
    const reg = S.dias.get(hoy);
    const nuevo = Math.max(0, (reg?.aguaMl || 0) + ml);
    await guardarDia(hoy, { aguaMl: nuevo, tipo: reg?.tipo || planDelDia(hoy).tipo });
    pintar();
  };
  pintar();
}

/* ==========================================================================
   CAMINATA (día de descanso)
   ========================================================================== */
function hojaCaminata(fecha) {
  const f = fecha || hoyISO();
  const reg = S.dias.get(f);
  abrirHoja(`
    <h3>Caminata</h3>
    <div class="campo"><label>Minutos</label>
      <input id="cam-min" type="number" inputmode="numeric" value="${reg?.caminata?.minutos || 30}"></div>
    <div class="campo"><label>Nota (opcional)</label>
      <input id="cam-nota" type="text" value="${esc(reg?.caminata?.nota || "")}" placeholder="Por dónde, cómo te sentiste…"></div>
    <div class="hoja-acciones">
      <button id="cam-guardar" class="btn btn-primario btn-grande">Guardar caminata</button>
    </div>`);
  $("#cam-guardar").onclick = async () => {
    const minutos = Number($("#cam-min").value) || 0;
    if (minutos <= 0) return;
    await guardarDia(f, {
      tipo: "descanso",
      caminata: { minutos, nota: $("#cam-nota").value.trim() },
    });
    cerrarHoja(true);
    toast(sargento("caminataRegistrada"));
    refrescarVistaActual();
  };
}

/* ==========================================================================
   HOY NO LLEGO / CAUSA MAYOR
   ========================================================================== */
function hojaNoLlego() {
  const hoy = hoyISO();
  const mes = hoy.slice(0, 7);
  const hayEscudo = escudoDisponible(mes);
  abrirHoja(`
    <h3>Hoy no llego</h3>
    <p class="texto-2">Opciones: la recuperás otro día de esta semana (hasta el
    domingo), o la marcás como causa mayor con motivo.</p>
    <div class="hoja-acciones">
      <button id="nl-recuperar" class="btn btn-primario btn-grande">La recupero otro día</button>
      <button id="nl-causa" class="btn btn-borde btn-grande">Causa mayor</button>
    </div>`);
  $("#nl-recuperar").onclick = () => {
    cerrarHoja(true);
    toast("Queda pendiente. La podés recuperar cualquier día hasta el domingo.");
  };
  $("#nl-causa").onclick = () => hojaCausaMayor(hoy, hayEscudo);
}

function hojaCausaMayor(fecha, hayEscudo) {
  abrirHoja(`
    <h3>Causa mayor</h3>
    <div class="campo"><label>¿Qué pasó?</label>
      <input id="cm-motivo" type="text" placeholder="Ej: viaje de trabajo, enfermo…"></div>
    ${hayEscudo ? `
    <div class="config-fila" style="border:none">
      <span>Usar el escudo del mes<br><small class="texto-2">Congela la racha si la semana queda incompleta</small></span>
      <input id="cm-escudo" type="checkbox" style="width:24px;height:24px">
    </div>` : `<p class="texto-2">No te queda escudo este mes.</p>`}
    <div class="hoja-acciones">
      <button id="cm-guardar" class="btn btn-primario btn-grande">Marcar causa mayor</button>
    </div>`);
  $("#cm-guardar").onclick = async () => {
    const motivo = $("#cm-motivo").value.trim();
    if (!motivo) { $("#cm-motivo").focus(); return; }
    const conEscudo = hayEscudo && $("#cm-escudo")?.checked;
    await guardarDia(fecha, {
      tipo: "entreno",
      rutinaId: planDelDia(fecha).rutina || null,
      rutinasVersion: RUTINAS_VERSION,
      estado: "causa-mayor",
      causaMayor: { usada: true, motivo, conEscudo: !!conEscudo },
    });
    if (conEscudo) {
      const escudos = { ...(S.config.escudos || {}) };
      escudos[fecha.slice(0, 7)] = claveSemana(fecha);
      await guardarConfig({ escudos });
      toast(sargento("escudoUsado"), "toast-alerta", 6000);
    }
    cerrarHoja(true);
    refrescarVistaActual();
  };
}

/* ==========================================================================
   CONFIGURACIÓN
   ========================================================================== */
function hojaConfig() {
  const c = S.config;
  const tema = localStorage.getItem("tema") || "auto";
  abrirHoja(`
    <h3>Configuración</h3>
    <div class="config-fila"><span>Tema</span>
      <span class="segmentos" id="cfg-tema">
        <button data-t="auto" class="${tema === "auto" ? "sel" : ""}">Auto</button>
        <button data-t="light" class="${tema === "light" ? "sel" : ""}">Claro</button>
        <button data-t="dark" class="${tema === "dark" ? "sel" : ""}">Oscuro</button>
      </span></div>
    <div class="config-fila"><span>Botella (ml)</span>
      <input id="cfg-botella" type="number" inputmode="numeric" value="${c.botellaMl}"></div>
    <div class="config-fila"><span>Vaso (ml)</span>
      <input id="cfg-vaso" type="number" inputmode="numeric" value="${c.vasoMl}"></div>
    <div class="config-fila"><span>Objetivo de agua (ml)</span>
      <input id="cfg-agua" type="number" inputmode="numeric" value="${c.aguaObjetivoMl}"></div>
    <div class="config-fila"><span>Descanso entre series (seg)</span>
      <input id="cfg-descanso" type="number" inputmode="numeric" value="${c.descansoSeg || CONFIG.descansoEntreSeriesSeg}"></div>
    <div class="config-fila"><span>Peso objetivo (kg)</span>
      <input id="cfg-objetivo" type="number" inputmode="decimal" step="0.1" value="${c.pesoObjetivo ?? ""}"></div>
    <div class="hoja-acciones">
      <button id="cfg-guardar" class="btn btn-primario btn-grande">Guardar</button>
      <button id="cfg-salir" class="btn btn-texto">Cerrar sesión de Google</button>
    </div>
    <p class="texto-2 centrado mt" style="font-size:12px">Rutinas v${RUTINAS_VERSION}</p>`);

  $("#cfg-tema").querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      aplicarTema(b.dataset.t);
      $("#cfg-tema").querySelectorAll("button").forEach((x) => x.classList.toggle("sel", x === b));
    };
  });
  $("#cfg-guardar").onclick = async () => {
    await guardarConfig({
      botellaMl: Number($("#cfg-botella").value) || 1000,
      vasoMl: Number($("#cfg-vaso").value) || 250,
      aguaObjetivoMl: Number($("#cfg-agua").value) || 2000,
      descansoSeg: Number($("#cfg-descanso").value) || 90,
      pesoObjetivo: $("#cfg-objetivo").value ? Number($("#cfg-objetivo").value) : null,
    });
    cerrarHoja(true);
    toast("Configuración guardada.");
  };
  $("#cfg-salir").onclick = async () => { cerrarHoja(true); await signOut(S.auth); };
}

/* ==========================================================================
   AUDIO — campana (hay que desbloquearla con el primer gesto del usuario)
   ========================================================================== */
const campana = new Audio("campana.mp3");
campana.preload = "auto";

function desbloquearAudio() {
  if (S.audioListo) return;
  campana.muted = true;
  const p = campana.play();
  if (p) p.then(() => {
    campana.pause();
    campana.currentTime = 0;
    campana.muted = false;
    S.audioListo = true;
  }).catch(() => { campana.muted = false; });
}
function sonarCampana() {
  try { campana.currentTime = 0; campana.play().catch(() => { }); } catch (_) { }
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

/* ==========================================================================
   WAKE LOCK — pantalla prendida durante la sesión
   ========================================================================== */
async function pedirWakeLock() {
  try {
    if ("wakeLock" in navigator) S.wakeLock = await navigator.wakeLock.request("screen");
  } catch (_) { /* sin soporte o sin permiso: seguimos igual */ }
}
function soltarWakeLock() {
  if (S.wakeLock) { S.wakeLock.release().catch(() => { }); S.wakeLock = null; }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    if (S.sesion) pedirWakeLock();
    tickTimers(true);
  }
});

/* ==========================================================================
   TEMPORIZADORES — siempre contra Date.now(), nunca acumulando intervalos
   ========================================================================== */
let timerInterval = null;

function arrancarTickeo() {
  if (timerInterval) return;
  timerInterval = setInterval(() => tickTimers(false), 300);
}
function frenarTickeo() {
  clearInterval(timerInterval); timerInterval = null;
}

function tickTimers(alVolver) {
  const s = S.sesion;
  if (!s) { frenarTickeo(); return; }
  const ahora = Date.now();

  for (const clave of ["timer", "descanso"]) {
    const t = s[clave];
    if (!t) continue;
    const resta = (t.fin - ahora) / 1000;
    if (resta <= 0 && !t.sono) {
      t.sono = true;
      sonarCampana();
      guardarSesionLocal();
    }
    const nodo = $(`#t-${clave}`);
    if (nodo) {
      nodo.querySelector(".timer-num, .t-num").textContent = fmtCrono(resta);
      const barra = nodo.querySelector(".timer-barra i");
      if (barra) barra.style.width = `${Math.max(0, Math.min(100, 100 * (1 - resta / t.dur)))}%`;
      nodo.classList.toggle("fin", resta <= 0);
    }
    if (clave === "descanso" && resta <= -30) { s.descanso = null; guardarSesionLocal(); renderPasoSesion(); }
  }
  const reloj = $("#entreno-reloj");
  if (reloj && s.inicio) reloj.textContent = fmtCrono((ahora - s.inicio) / 1000);
}

function ponerTimer(dur, etiqueta) {
  S.sesion.timer = { fin: Date.now() + dur * 1000, dur, etiqueta, sono: false };
  guardarSesionLocal();
  renderPasoSesion();
}
function ponerDescanso() {
  const dur = S.config.descansoSeg || 90;
  S.sesion.descanso = { fin: Date.now() + dur * 1000, dur, sono: false };
  guardarSesionLocal();
}

/* ==========================================================================
   SESIÓN — armado, persistencia y reanudación
   ========================================================================== */
function guardarSesionLocal() {
  try { localStorage.setItem("sesionActiva", JSON.stringify(S.sesion)); } catch (_) { }
}
function limpiarSesionLocal() { localStorage.removeItem("sesionActiva"); }

function sesionGuardadaHoy() {
  try {
    const s = JSON.parse(localStorage.getItem("sesionActiva") || "null");
    return s && s.fecha === hoyISO() ? s : null;
  } catch (_) { return null; }
}

function armarCola(rutinaId) {
  if (rutinaId === "musculacion") {
    const cola = [{ t: "calor" }];
    for (const b of MUSCULACION.bloques)
      for (const e of b.ejercicios) cola.push({ t: "ej", id: e.id });
    cola.push({ t: "cinta-cierre" });
    cola.push({ t: "parte" });
    return cola;
  }
  const cola = [{ t: "movilidad" }];
  for (let v = 0; v < INTERVALOS.vueltas; v++) {
    cola.push({ t: "bloque", bloque: "cinta", vuelta: v });
    cola.push({ t: "bloque", bloque: "circuito", vuelta: v });
  }
  cola.push({ t: "parte" });
  return cola;
}

async function empezarSesion(rutinaId, esRecuperacion, fechaOriginal) {
  desbloquearAudio();
  const fecha = hoyISO();
  S.sesion = {
    fecha, rutinaId,
    esRecuperacion: !!esRecuperacion,
    fechaOriginal: fechaOriginal || null,
    inicio: Date.now(),
    paso: 0,
    cola: armarCola(rutinaId),
    calorHecho: {},
    pesoActual: {}, repsActual: {},
    vueltas: rutinaId === "intervalos" ? [0, 0, 0, 0] : null,
    timer: null, descanso: null,
    prMax: maximosHistoricos(),
  };
  guardarSesionLocal();
  await guardarDia(fecha, {
    tipo: "entreno",
    rutinaId,
    rutinasVersion: RUTINAS_VERSION,
    inicio: S.sesion.inicio,
    series: S.dias.get(fecha)?.series || {},
    vueltas: S.sesion.vueltas || null,
  });
  pedirWakeLock();
  arrancarTickeo();
  mostrarVista("entreno");
}

function reanudarSesion() {
  desbloquearAudio();
  const s = sesionGuardadaHoy();
  if (!s) return;
  S.sesion = s;
  pedirWakeLock();
  arrancarTickeo();
  mostrarVista("entreno");
}

function salirDeSesion() {
  abrirHoja(`
    <h3>¿Salir del entrenamiento?</h3>
    <p class="texto-2">Todo lo marcado ya está guardado. Podés volver y
    continuar donde estabas.</p>
    <div class="hoja-acciones">
      <button id="salir-si" class="btn btn-primario btn-grande">Salir (se puede continuar)</button>
      <button id="salir-cancelar" class="btn btn-borde btn-grande">Seguir entrenando</button>
      <button id="salir-descartar" class="btn btn-texto">Descartar la sesión de hoy</button>
    </div>`);
  $("#salir-si").onclick = () => { cerrarHoja(true); soltarWakeLock(); mostrarVista("inicio"); };
  $("#salir-cancelar").onclick = () => cerrarHoja(true);
  $("#salir-descartar").onclick = async () => {
    cerrarHoja(true);
    const f = S.sesion.fecha;
    S.sesion = null; limpiarSesionLocal(); soltarWakeLock(); frenarTickeo();
    const reg = S.dias.get(f) || {};
    await guardarDia(f, {
      estado: null, rutinaId: null, inicio: null, fin: null,
      series: {}, vueltas: null, esfuerzo: {},
      tipo: planDelDia(f).tipo, aguaMl: reg.aguaMl || 0,
    });
    mostrarVista("inicio");
  };
}

/* Máximo peso histórico por ejercicio (para detectar récords en vivo) */
function maximosHistoricos() {
  const hoy = hoyISO();
  const max = {};
  for (const [f, reg] of S.dias) {
    if (f >= hoy || !reg.series) continue;
    for (const [id, series] of Object.entries(reg.series))
      for (const x of series)
        if (x.hecha && (x.peso || 0) > (max[id] || 0)) max[id] = x.peso;
  }
  return max;
}

/* Última serie registrada de un ejercicio antes de hoy */
function laVezPasada(id) {
  const hoy = hoyISO();
  const fechas = [...S.dias.keys()].filter((f) => f < hoy).sort().reverse();
  for (const f of fechas) {
    const s = S.dias.get(f)?.series?.[id];
    if (s && s.length) {
      const hechas = s.filter((x) => x.hecha);
      const ult = hechas.length ? hechas[hechas.length - 1] : s[s.length - 1];
      return { peso: ult.peso, reps: ult.reps, fecha: f, esfuerzo: S.dias.get(f)?.esfuerzo?.[id] };
    }
  }
  return null;
}

function ejercicioPorId(id) {
  for (const b of MUSCULACION.bloques)
    for (const e of b.ejercicios) if (e.id === id) return e;
  for (const e of INTERVALOS.circuito) if (e.id === id) return e;
  return null;
}

/* ==========================================================================
   SESIÓN — render de pasos
   ========================================================================== */
function renderPasoSesion() {
  const s = S.sesion;
  if (!s) return;
  const r = RUTINAS[s.rutinaId];
  $("#entreno-titulo").textContent = r.nombre + (s.esRecuperacion ? " · recuperación" : "");
  const paso = s.cola[s.paso];
  const cont = $("#entreno-contenido");
  if (!paso) return;

  if (paso.t === "calor") renderCalorMusculacion(cont);
  else if (paso.t === "ej") renderEjercicio(cont, paso.id);
  else if (paso.t === "cinta-cierre") renderCintaCierre(cont);
  else if (paso.t === "movilidad") renderMovilidad(cont);
  else if (paso.t === "bloque") renderBloqueIntervalo(cont, paso);
  else if (paso.t === "parte") renderParteCierre(cont);
  tickTimers(true);
}

function avanzarPaso() {
  S.sesion.paso++;
  S.sesion.timer = null;
  S.sesion.descanso = null;
  guardarSesionLocal();
  window.scrollTo(0, 0);
  renderPasoSesion();
}

function htmlTimerGrande(etiqueta) {
  const t = S.sesion.timer;
  if (!t) return "";
  return `
    <div class="temporizador" id="t-timer">
      <div class="timer-num">${fmtCrono((t.fin - Date.now()) / 1000)}</div>
      <div class="timer-etiqueta">${esc(etiqueta || t.etiqueta || "")}</div>
      <div class="timer-barra"><i></i></div>
    </div>`;
}

/* --- Musculación: entrada en calor --- */
function renderCalorMusculacion(cont) {
  const cal = MUSCULACION.entradaEnCalor;
  const h = s => S.sesion.calorHecho[s];
  cont.innerHTML = `
    <div class="paso-indicador">Entrada en calor · 15 min</div>
    <div class="check-lista">
      ${cal.ejercicios.map((e) => `
        <button class="check-item ${h(e.id) ? "hecho" : ""}" data-cal="${e.id}">
          <img src="img/ejercicios/${e.img}" alt="">
          <span class="check-nombre">${esc(e.nombre)}
            <span class="check-detalle">${esc(e.detalle || "")}</span></span>
          <span class="check-tilde">${h(e.id) ? "✓" : ""}</span>
        </button>`).join("")}
    </div>
    ${htmlTimerGrande("Cinta · 4 km/h")}
    ${!S.sesion.timer ? `<button id="btn-cinta-calor" class="btn btn-borde btn-grande">Iniciar 10 min de cinta</button>` : ""}
    <div class="entreno-pie">
      <button id="btn-calor-listo" class="btn btn-rojo btn-gigante">Entrada en calor lista</button>
    </div>`;
  cont.querySelectorAll("[data-cal]").forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.cal;
      S.sesion.calorHecho[id] = !S.sesion.calorHecho[id];
      guardarSesionLocal();
      renderPasoSesion();
    };
  });
  const bc = $("#btn-cinta-calor");
  if (bc) bc.onclick = () => ponerTimer(600, "Cinta · 4 km/h");
  $("#btn-calor-listo").onclick = () => avanzarPaso();
}

/* --- Musculación: un ejercicio --- */
function renderEjercicio(cont, id) {
  const e = ejercicioPorId(id);
  const s = S.sesion;
  const reg = S.dias.get(s.fecha) || {};
  const series = (reg.series && reg.series[id]) || [];
  const previa = laVezPasada(id);
  const notaPersistente = S.config.notasEjercicio?.[id] || "";
  const marcadoAscenso = (S.config.ascensos || []).includes(id);

  if (!(id in s.pesoActual)) {
    s.pesoActual[id] = series.filter((x) => x.hecha).slice(-1)[0]?.peso
      ?? previa?.peso ?? e.pesoSugerido ?? 0;
  }
  if (!(id in s.repsActual)) s.repsActual[id] = e.reps;

  const numEj = s.cola.filter((p) => p.t === "ej").findIndex((p) => p.id === id) + 1;
  const totalEj = s.cola.filter((p) => p.t === "ej").length;
  const hechas = series.filter((x) => x.hecha).length;

  let sugerencia = "";
  if (previa?.esfuerzo === "sobrado") sugerencia = "La vez pasada quedaste sobrado acá. Si querés subir, el número lo ponés vos.";
  if (marcadoAscenso) sugerencia = "Marcaste esta máquina para ascenso. Vos decidís el peso.";

  const d = s.descanso;
  cont.innerHTML = `
    <div class="paso-indicador">Ejercicio ${numEj} de ${totalEj}</div>
    <div class="ej-tarjeta">
      <img class="ej-img" src="img/ejercicios/${e.img}" alt="">
      <div class="ej-nombre">${esc(e.nombre)}</div>
      ${e.subtitulo ? `<div class="ej-sub">${esc(e.subtitulo)} · ${e.series}×${e.reps}</div>`
        : `<div class="ej-sub">${e.series}×${e.reps}</div>`}
      <ul class="ej-cues">${(e.cues || []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
      ${previa ? `<div class="ej-anterior">La vez pasada: ${previa.peso} kg × ${previa.reps}</div>` : ""}
      ${sugerencia ? `<div class="ej-nota-guardada">${esc(sugerencia)}</div>` : ""}
      ${notaPersistente ? `<div class="ej-nota-guardada">📝 ${esc(notaPersistente)}</div>` : ""}

      <div class="peso-control">
        <button class="btn-paso" id="peso-menos">−</button>
        <input class="peso-input" id="peso-input" type="number" inputmode="decimal" step="${e.pesoPaso}" value="${s.pesoActual[id]}">
        <button class="btn-paso" id="peso-mas">+</button>
      </div>
      <div class="centrado peso-unidad">kg · pasos de ${e.pesoPaso}
        &nbsp;·&nbsp; reps <button id="reps-menos" class="btn btn-suave" style="min-width:36px;min-height:36px;border-radius:8px">−</button>
        <b id="reps-num">${s.repsActual[id]}</b>
        <button id="reps-mas" class="btn btn-suave" style="min-width:36px;min-height:36px;border-radius:8px">+</button></div>

      <div class="series-fila">
        ${[0, 1, 2, 3].map((i) => {
          const x = series[i];
          return `<button class="serie-cajita ${x?.hecha ? "hecha" : ""}" data-serie="${i}">
            ${x?.hecha ? `${x.peso}<small>kg × ${x.reps}</small>` : `${i + 1}<small>serie</small>`}
          </button>`;
        }).join("")}
      </div>

      ${d ? `<div class="timer-descanso-mini" id="t-descanso">
        <span class="t-num">${fmtCrono((d.fin - Date.now()) / 1000)}</span>
        <span class="texto-2" style="font-size:13px">descanso</span>
        <button id="descanso-saltar" class="btn btn-suave btn-medio">Saltar</button>
      </div>` : ""}

      <div class="ej-acciones">
        <button id="btn-nota" class="btn btn-borde">Nota ${notaPersistente ? "✓" : ""}</button>
        <button id="btn-ascenso" class="btn btn-borde ${marcadoAscenso ? "ej-accion-activa" : ""}">
          ${marcadoAscenso ? "Marcado para ascenso" : "Marcar para ascenso"}</button>
        <button id="btn-ocupada" class="btn btn-borde">Máquina ocupada</button>
        ${id.startsWith("prensa") ? `<button id="btn-discos" class="btn btn-borde">Discos</button>`
          : `<span></span>`}
      </div>

      ${hechas > 0 ? `
      <div class="paso-indicador">¿Las últimas 2 repeticiones costaron?</div>
      <div class="esfuerzo-botones">
        ${[["sobrado", "Sobrado"], ["justo", "Justo"], ["roto", "Se rompió la técnica"]].map(([v, t]) =>
          `<button data-esf="${v}" class="btn btn-borde ${reg.esfuerzo?.[id] === v ? "sel" : ""}">${t}</button>`).join("")}
      </div>
      ${!reg.esfuerzo?.[id] ? `<button id="btn-esf-saltear" class="btn btn-texto" style="width:100%">Saltear esta pregunta</button>` : ""}` : ""}

      <div class="entreno-pie">
        <button id="btn-ej-sig" class="btn btn-rojo btn-gigante">Siguiente</button>
      </div>
    </div>`;

  const inputPeso = $("#peso-input");
  const cambiarPeso = (delta) => {
    const v = Math.max(0, (Number(inputPeso.value) || 0) + delta);
    inputPeso.value = Math.round(v * 100) / 100;
    s.pesoActual[id] = Number(inputPeso.value);
    guardarSesionLocal();
  };
  $("#peso-menos").onclick = () => cambiarPeso(-e.pesoPaso);
  $("#peso-mas").onclick = () => cambiarPeso(e.pesoPaso);
  inputPeso.onchange = () => cambiarPeso(0);

  $("#reps-menos").onclick = () => { s.repsActual[id] = Math.max(1, s.repsActual[id] - 1); $("#reps-num").textContent = s.repsActual[id]; guardarSesionLocal(); };
  $("#reps-mas").onclick = () => { s.repsActual[id]++; $("#reps-num").textContent = s.repsActual[id]; guardarSesionLocal(); };

  cont.querySelectorAll("[data-serie]").forEach((b) => {
    b.onclick = async () => {
      const i = Number(b.dataset.serie);
      const nuevas = [...series];
      if (nuevas[i]?.hecha) {
        nuevas[i] = null;                       // desmarcar
      } else {
        nuevas[i] = { peso: s.pesoActual[id], reps: s.repsActual[id], hecha: true };
        ponerDescanso();
        // ¿récord? (solo si ya había una marca previa que superar)
        const marcaPrevia = s.prMax[id];
        if (marcaPrevia !== undefined && s.pesoActual[id] > marcaPrevia) {
          s.prMax[id] = s.pesoActual[id];
          toast(sargento("record", { ejercicio: e.nombre, peso: s.pesoActual[id] }), "toast-record", 6000);
        } else if (marcaPrevia === undefined) {
          s.prMax[id] = s.pesoActual[id];
        }
      }
      const limpias = nuevas.filter(Boolean);
      const todas = { ...(reg.series || {}), [id]: limpias };
      await guardarDia(s.fecha, { series: todas });
      guardarSesionLocal();
      renderPasoSesion();
    };
  });

  const saltar = $("#descanso-saltar");
  if (saltar) saltar.onclick = () => { s.descanso = null; guardarSesionLocal(); renderPasoSesion(); };

  cont.querySelectorAll("[data-esf]").forEach((b) => {
    b.onclick = async () => {
      const esfuerzo = { ...(reg.esfuerzo || {}), [id]: b.dataset.esf };
      await guardarDia(s.fecha, { esfuerzo });
      renderPasoSesion();
    };
  });

  $("#btn-nota").onclick = () => hojaNotaEjercicio(id, e.nombre);
  $("#btn-ascenso").onclick = async () => {
    let asc = [...(S.config.ascensos || [])];
    const diaAsc = [...(reg.ascensoMarcado || [])];
    if (asc.includes(id)) asc = asc.filter((x) => x !== id);
    else { asc.push(id); if (!diaAsc.includes(id)) diaAsc.push(id); }
    await guardarConfig({ ascensos: asc });
    await guardarDia(s.fecha, { ascensoMarcado: diaAsc });
    renderPasoSesion();
  };
  $("#btn-ocupada").onclick = () => {
    // saltea: manda este ejercicio al final de la cola, antes del cierre
    const cola = s.cola;
    const actual = cola[s.paso];
    cola.splice(s.paso, 1);
    let pos = cola.findIndex((p) => p.t === "cinta-cierre");
    if (pos < 0) pos = cola.length - 1;
    cola.splice(pos, 0, actual);
    s.timer = null; s.descanso = null;
    guardarSesionLocal();
    toast("Salteado. Vuelve al final.");
    renderPasoSesion();
  };
  const discos = $("#btn-discos");
  if (discos) discos.onclick = () => hojaDiscos(Number(inputPeso.value) || 0);

  const esfSaltear = $("#btn-esf-saltear");
  if (esfSaltear) esfSaltear.onclick = () => avanzarPaso();

  $("#btn-ej-sig").onclick = () => {
    if (hechas > 0 && !reg.esfuerzo?.[id]) {
      toast("Marcá cómo terminaste, o tocá \"Saltear esta pregunta\".", "toast-alerta");
      return;
    }
    avanzarPaso();
  };
}

function hojaNotaEjercicio(id, nombre) {
  const actual = S.config.notasEjercicio?.[id] || "";
  abrirHoja(`
    <h3>Nota · ${esc(nombre)}</h3>
    <div class="campo">
      <textarea id="nota-texto" placeholder="Ajuste del asiento, agarre, sensaciones…">${esc(actual)}</textarea>
    </div>
    <div class="hoja-acciones">
      <button id="nota-guardar" class="btn btn-primario btn-grande">Guardar nota</button>
    </div>`);
  $("#nota-guardar").onclick = async () => {
    const texto = $("#nota-texto").value.trim();
    // texto vacío = borrar; se guarda "" porque el merge de Firestore no
    // elimina claves de un mapa, y "" se trata como "sin nota" al mostrar
    const notasEjercicio = { ...(S.config.notasEjercicio || {}), [id]: texto };
    await guardarConfig({ notasEjercicio });
    const reg = S.dias.get(S.sesion.fecha) || {};
    const notas = { ...(reg.notas || {}), [id]: texto };
    await guardarDia(S.sesion.fecha, { notas });
    cerrarHoja(true);
    renderPasoSesion();
  };
}

/* Calculadora de discos para la prensa */
function hojaDiscos(pesoInicial) {
  abrirHoja(`
    <h3>Calculadora de discos</h3>
    <div class="campo"><label>Peso total (kg)</label>
      <input id="discos-total" type="number" inputmode="decimal" value="${pesoInicial || ""}"></div>
    <div id="discos-out" class="discos-resultado"></div>`);
  const calcular = () => {
    const total = Number($("#discos-total").value) || 0;
    const porLado = total / 2;
    const discos = [20, 15, 10, 5, 2.5, 1.25];
    let resto = porLado;
    const usados = [];
    for (const d of discos) {
      const n = Math.floor(resto / d + 1e-9);
      if (n > 0) { usados.push(`${n} × ${d} kg`); resto = Math.round((resto - n * d) * 100) / 100; }
    }
    $("#discos-out").innerHTML = total <= 0 ? "" : `
      <strong>${fmtKg(total)} kg</strong> → ${fmtKg(porLado)} kg por lado<br>
      ${usados.length ? "Por lado: " + usados.join(" + ") : "Sin discos"}
      ${resto > 0 ? `<br><span class="texto-2">Quedan ${resto} kg sin cubrir por lado</span>` : ""}`;
  };
  $("#discos-total").oninput = calcular;
  calcular();
}

/* --- Musculación: cinta de cierre --- */
function renderCintaCierre(cont) {
  cont.innerHTML = `
    <div class="paso-indicador">Cierre · 10 min de cinta</div>
    <img class="ej-img" src="img/ejercicios/calentamiento-cinta.webp" alt="">
    <p class="texto-2 centrado">4 km/h · caminata suave</p>
    ${htmlTimerGrande("Cinta de cierre")}
    ${!S.sesion.timer ? `<button id="btn-cinta" class="btn btn-rojo btn-gigante mt">Iniciar 10 minutos</button>` : ""}
    <div class="entreno-pie">
      <button id="btn-cinta-listo" class="btn ${S.sesion.timer ? "btn-rojo" : "btn-borde"} btn-grande">Cinta terminada</button>
    </div>`;
  const b = $("#btn-cinta");
  if (b) b.onclick = () => ponerTimer(MUSCULACION.cierre.duracionSeg, "Cinta de cierre");
  $("#btn-cinta-listo").onclick = () => avanzarPaso();
}

/* --- Intervalos: movilidad --- */
function renderMovilidad(cont) {
  const cal = INTERVALOS.entradaEnCalor;
  const h = (x) => S.sesion.calorHecho[x];
  cont.innerHTML = `
    <div class="paso-indicador">${esc(cal.nombre)} · 6-7 min</div>
    <p class="texto-2">${esc(cal.nota || "")}</p>
    <div class="check-lista mt">
      ${cal.ejercicios.map((e) => `
        <button class="check-item ${h(e.id) ? "hecho" : ""}" data-cal="${e.id}">
          <img src="img/ejercicios/${e.img}" alt="">
          <span class="check-nombre">${esc(e.nombre)}</span>
          <span class="check-tilde">${h(e.id) ? "✓" : ""}</span>
        </button>`).join("")}
    </div>
    ${htmlTimerGrande("Movilidad")}
    ${!S.sesion.timer ? `<button id="btn-mov-timer" class="btn btn-borde btn-grande">Iniciar ${Math.round(cal.duracionSeg / 60)} min</button>` : ""}
    <div class="entreno-pie">
      <button id="btn-mov-listo" class="btn btn-rojo btn-gigante">Movilidad lista · empezar bloques</button>
    </div>`;
  cont.querySelectorAll("[data-cal]").forEach((b) => {
    b.onclick = () => {
      S.sesion.calorHecho[b.dataset.cal] = !S.sesion.calorHecho[b.dataset.cal];
      guardarSesionLocal(); renderPasoSesion();
    };
  });
  const bt = $("#btn-mov-timer");
  if (bt) bt.onclick = () => ponerTimer(cal.duracionSeg, "Movilidad");
  $("#btn-mov-listo").onclick = () => avanzarPaso();
}

/* --- Intervalos: bloques de 7 minutos --- */
function renderBloqueIntervalo(cont, paso) {
  const s = S.sesion;
  const esCinta = paso.bloque === "cinta";
  const bloqueDef = INTERVALOS.bloques.find((b) => b.id === paso.bloque);
  const numBloque = s.cola.filter((p) => p.t === "bloque").indexOf(paso) + 1;
  const timerActivo = !!s.timer;
  const termino = timerActivo && (s.timer.fin - Date.now()) <= 0;

  let cuerpo = "";
  if (esCinta) {
    cuerpo = `<img class="ej-img" src="img/ejercicios/calentamiento-cinta.webp" alt="">`;
  } else {
    const v = paso.vuelta;
    cuerpo = `
      <div class="circuito-grilla">
        ${INTERVALOS.circuito.map((e) => `
          <div class="circuito-ej">
            <img src="img/ejercicios/${e.img}" alt="">
            <div class="c-nombre">${esc(e.nombre)}</div>
            <div class="c-detalle">${e.reps} reps${e.peso ? ` · ${e.peso} kg${e.porLado ? " por lado" : ""}` : " · sin carga"}</div>
          </div>`).join("")}
      </div>
      <div class="vueltas-etiqueta">Vueltas de este bloque</div>
      <div class="vueltas-contador">
        <button class="btn-paso" id="v-menos">−</button>
        <span class="vueltas-num">${s.vueltas[v] || 0}</span>
        <button class="btn-paso" id="v-media">+½</button>
        <button class="btn-paso" id="v-mas">+1</button>
      </div>`;
  }

  cont.innerHTML = `
    <div class="paso-indicador">Bloque ${numBloque} de 8 · ${esc(bloqueDef.nombre)}</div>
    ${bloqueDef.nota ? `<p class="texto-2">${esc(bloqueDef.nota)}</p>` : ""}
    ${cuerpo}
    ${htmlTimerGrande(bloqueDef.nombre)}
    ${!timerActivo ? `<button id="btn-bloque-ir" class="btn btn-rojo btn-gigante mt">Arrancar bloque · 7:00</button>` : ""}
    <div class="entreno-pie">
      ${timerActivo ? `<button id="btn-bloque-sig" class="btn ${termino ? "btn-rojo" : "btn-borde"} btn-grande">
        Bloque terminado · siguiente</button>` : ""}
    </div>`;

  if (!esCinta) {
    const v = paso.vuelta;
    const cambiarV = async (d) => {
      s.vueltas[v] = Math.max(0, Math.round(((s.vueltas[v] || 0) + d) * 2) / 2);
      guardarSesionLocal();
      await guardarDia(s.fecha, { vueltas: s.vueltas });
      renderPasoSesion();
    };
    $("#v-menos").onclick = () => cambiarV(-0.5);
    $("#v-media").onclick = () => cambiarV(0.5);
    $("#v-mas").onclick = () => cambiarV(1);
  }
  const ir = $("#btn-bloque-ir");
  if (ir) ir.onclick = () => ponerTimer(bloqueDef.duracionSeg, bloqueDef.nombre);
  const sig = $("#btn-bloque-sig");
  if (sig) sig.onclick = () => avanzarPaso();
}

/* --- Parte de cierre (las dos rutinas) --- */
function renderParteCierre(cont) {
  const s = S.sesion;
  const reg = S.dias.get(s.fecha) || {};
  const vol = volumenSesion({ ...reg, rutinaId: s.rutinaId });
  const durSeg = (Date.now() - s.inicio) / 1000;

  // comparación con la sesión anterior de la misma rutina
  const previas = [...S.dias.entries()]
    .filter(([f, d]) => f < s.fecha && d.rutinaId === s.rutinaId && sesionRegistrada(f))
    .sort((a, b) => (a[0] < b[0] ? 1 : -1));
  let comparacion = "";
  if (previas.length) {
    const [fPrev, dPrev] = previas[0];
    const volPrev = volumenSesion(dPrev);
    if (vol && volPrev) {
      const dif = vol - volPrev;
      comparacion = dif >= 0
        ? `Moviste ${fmtKg(vol)} kg, ${fmtKg(dif)} más que el ${DIAS_NOMBRE[diaSemanaDe(fPrev)]}.`
        : `Moviste ${fmtKg(vol)} kg, ${fmtKg(-dif)} menos que el ${DIAS_NOMBRE[diaSemanaDe(fPrev)]}.`;
    }
  }

  const esc15 = (nombre, valor) => `
    <div class="paso-indicador">${nombre}</div>
    <div class="escala-15" data-escala="${nombre}">
      ${[1, 2, 3, 4, 5].map((n) =>
        `<button class="btn btn-borde ${valor === n ? "sel" : ""}" data-v="${n}">${n}</button>`).join("")}
    </div>`;

  cont.innerHTML = `
    <div class="paso-indicador">Parte de cierre</div>
    <div class="cierre-resumen">
      ${vol ? `<strong>${fmtKg(vol)} kg movidos</strong>` : ""}
      Duración: ${fmtDuracion(durSeg)}<br>
      ${s.rutinaId === "intervalos" && s.vueltas ? `Vueltas por bloque: ${s.vueltas.join(" · ")}<br>` : ""}
      ${comparacion}
    </div>
    ${esc15("Hambre", reg.hambre)}
    ${esc15("Cansancio", reg.cansancio)}
    <div class="campo"><label>Comentario libre</label>
      <textarea id="cierre-comentario" placeholder="Cómo salió, qué ajustar…">${esc(reg.comentario || "")}</textarea></div>

    <div class="paso-indicador">Foto del gym</div>
    <div class="foto-zona" id="foto-zona">${reg.tieneFoto ? "" : "Tocá para sacar la foto"}</div>
    <input id="foto-input" type="file" accept="image/*" capture="environment" style="display:none">
    ${!reg.tieneFoto ? `
    <button id="btn-sin-foto" class="btn btn-borde btn-medio" style="width:100%">No pude sacar foto</button>
    <div id="sin-foto-caja" class="campo mt ${reg.motivoSinFoto ? "" : "oculta"}"><label>¿Por qué no?</label>
      <input id="foto-motivo" type="text" value="${esc(reg.motivoSinFoto || "")}" placeholder="Ej: mucha gente, salí apurado…"></div>` : ""}

    <div class="entreno-pie">
      <button id="btn-terminar" class="btn btn-rojo btn-gigante">Terminar y guardar</button>
    </div>`;

  // cargar la foto ya sacada, si hay
  if (reg.tieneFoto) {
    getDoc(refs.diaMedia(s.fecha, "foto")).then((snap) => {
      if (snap.exists()) $("#foto-zona").innerHTML = `<img src="${snap.data().data}" alt="Foto del gym">`;
    });
  }

  cont.querySelectorAll("[data-escala]").forEach((caja) => {
    const nombre = caja.dataset.escala;
    caja.querySelectorAll("button").forEach((b) => {
      b.onclick = async () => {
        const campo = nombre === "Hambre" ? "hambre" : "cansancio";
        await guardarDia(s.fecha, { [campo]: Number(b.dataset.v) });
        renderPasoSesion();
      };
    });
  });

  $("#foto-zona").onclick = () => $("#foto-input").click();
  $("#foto-input").onchange = async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    $("#foto-zona").textContent = "Comprimiendo…";
    try {
      const data = await comprimirFoto(file);
      await setDoc(refs.diaMedia(s.fecha, "foto"), { data, hora: Date.now() });
      await guardarDia(s.fecha, { tieneFoto: true, motivoSinFoto: null });
      renderPasoSesion();
    } catch (e) {
      $("#foto-zona").textContent = "No se pudo procesar la foto";
    }
  };

  const sinFoto = $("#btn-sin-foto");
  if (sinFoto) sinFoto.onclick = () => {
    $("#sin-foto-caja").classList.remove("oculta");
    $("#foto-motivo").focus();
  };

  $("#btn-terminar").onclick = async () => {
    // La foto es obligatoria: sin foto solo se cierra dejando constancia
    const motivoEl = $("#foto-motivo");
    const motivo = motivoEl ? motivoEl.value.trim() : "";
    if (!reg.tieneFoto && !motivo) {
      $("#sin-foto-caja")?.classList.remove("oculta");
      toast('Falta la foto. Sacala, o tocá "No pude sacar foto" y contá por qué.', "toast-alerta");
      return;
    }
    const cambios = {
      estado: s.esRecuperacion ? "recuperada" : "hecha",
      fin: Date.now(),
      comentario: $("#cierre-comentario").value.trim(),
    };
    if (!reg.tieneFoto && motivo) cambios.motivoSinFoto = motivo;
    if (s.esRecuperacion && s.fechaOriginal) cambios.recuperaDe = s.fechaOriginal;
    await guardarDia(s.fecha, cambios);
    S.sesion = null;
    limpiarSesionLocal();
    soltarWakeLock();
    frenarTickeo();
    mostrarVista("inicio");
    toast(sargento("yaEntreno", { resumen: resumenCortoSesion(S.dias.get(s.fecha)) }), "toast-record", 6000);
  };
}

/* ==========================================================================
   FOTOS — cámara directa + compresión en el navegador
   ========================================================================== */
function comprimirFoto(file, ladoMax = 800) {
  return new Promise((resolver, rechazar) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const escala = Math.min(1, ladoMax / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * escala);
      canvas.height = Math.round(img.height * escala);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);

      // WebP si el navegador sabe; si no (Safari viejo), JPEG
      let calidad = 0.8, data = "";
      for (let intento = 0; intento < 6; intento++) {
        data = canvas.toDataURL("image/webp", calidad);
        if (!data.startsWith("data:image/webp")) data = canvas.toDataURL("image/jpeg", calidad);
        // objetivo 60-80 KB; límite duro por el tope de 1 MB del documento
        if (data.length <= 110_000 || calidad <= 0.35) break;
        calidad -= 0.1;
      }
      if (data.length > 900_000) rechazar(new Error("Foto demasiado grande"));
      else resolver(data);
    };
    img.onerror = rechazar;
    img.src = url;
  });
}

/* ==========================================================================
   CALENDARIO
   ========================================================================== */
function renderCalendario() {
  if (!S.calMes) {
    const h = parseISO(hoyISO());
    S.calMes = fmtISO(new Date(h.getFullYear(), h.getMonth(), 1));
  }
  renderHeatmap();
  const base = parseISO(S.calMes);
  $("#cal-mes-titulo").textContent = `${MESES_NOMBRE[base.getMonth()]} ${base.getFullYear()}`;

  const grilla = $("#cal-grilla");
  grilla.innerHTML = ["L", "M", "M", "J", "V", "S", "D"]
    .map((d) => `<div class="cal-dow">${d}</div>`).join("");

  const primero = new Date(base.getFullYear(), base.getMonth(), 1);
  const offset = (primero.getDay() + 6) % 7;    // lunes=0
  const diasMes = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const hoy = hoyISO();

  for (let i = 0; i < offset; i++) grilla.appendChild(el("div", "cal-dia d-otro", ""));
  for (let d = 1; d <= diasMes; d++) {
    const iso = fmtISO(new Date(base.getFullYear(), base.getMonth(), d));
    let cls = "";
    if (iso <= hoy || S.dias.has(iso)) {
      const e = estadoDia(iso);
      if (e === "hecha") cls = "d-hecha";
      else if (e === "recuperada") cls = "d-recuperada";
      else if (e === "causa-mayor") cls = "d-causa";
      else if (e === "fallada") cls = "d-fallada";
      else if (e === "descanso-caminata") cls = "d-descanso-caminata";
      else if (e === "descanso") cls = "d-descanso";
    }
    const celda = el("button", `cal-dia ${cls} ${iso === hoy ? "d-hoy" : ""}`, String(d));
    celda.onclick = () => hojaDetalleDia(iso);
    grilla.appendChild(celda);
  }
}

function renderHeatmap() {
  const hoy = hoyISO();
  const inicio = lunesDe(sumarDias(hoy, -364));
  let html = `<div class="heatmap-grilla">`;
  for (let f = inicio; f <= domingoDe(hoy); f = sumarDias(f, 1)) {
    let cls = "";
    if (f <= hoy) {
      const e = estadoDia(f);
      if (e === "hecha" || e === "recuperada") cls = "h2";
      else if (e === "descanso-caminata") cls = "h1";
      else if (e === "fallada") cls = "hx";
      else if (e === "causa-mayor") cls = "hc";
    }
    html += `<span class="hm-celda ${cls}" title="${f}"></span>`;
  }
  $("#heatmap").innerHTML = html + "</div>";
  $("#heatmap").scrollLeft = 99999;
}

function nombreEjercicio(id) {
  const e = ejercicioPorId(id);
  return e ? e.nombre : id;
}

function hojaDetalleDia(fecha) {
  const reg = S.dias.get(fecha);
  const estado = estadoDia(fecha);
  const plan = planDelDia(fecha);
  const ETIQUETAS = {
    "hecha": "Entrenó", "recuperada": "Recuperada", "descanso": "Descanso",
    "descanso-caminata": "Descanso con caminata", "causa-mayor": "Causa mayor",
    "fallada": "Fallada", "pendiente": "Pendiente",
  };
  const ESFUERZO_TXT = { sobrado: "sobrado", justo: "justo", roto: "se rompió la técnica" };

  let cuerpo = `<div class="dia-detalle-fila"><span>Estado</span><span>${ETIQUETAS[estado] || estado}</span></div>`;
  if (reg?.rutinaId && RUTINAS[reg.rutinaId])
    cuerpo += `<div class="dia-detalle-fila"><span>Rutina</span><span>${RUTINAS[reg.rutinaId].nombre}</span></div>`;
  if (reg?.inicio && reg?.fin)
    cuerpo += `<div class="dia-detalle-fila"><span>Horario</span><span>${fmtHora(reg.inicio)}–${fmtHora(reg.fin)} (${fmtDuracion((reg.fin - reg.inicio) / 1000)})</span></div>`;
  if (reg?.causaMayor?.motivo)
    cuerpo += `<div class="dia-detalle-fila"><span>Motivo</span><span>${esc(reg.causaMayor.motivo)}${reg.causaMayor.conEscudo ? " · con escudo" : ""}</span></div>`;
  if (reg?.series && Object.keys(reg.series).length) {
    cuerpo += `<div class="dia-detalle-series">`;
    for (const [id, ss] of Object.entries(reg.series)) {
      const hechas = ss.filter((x) => x.hecha);
      if (!hechas.length) continue;
      const pesos = hechas.map((x) => `${x.peso}×${x.reps}`).join(", ");
      const esf = reg.esfuerzo?.[id] ? ` · ${ESFUERZO_TXT[reg.esfuerzo[id]] || reg.esfuerzo[id]}` : "";
      cuerpo += `<b>${esc(nombreEjercicio(id))}</b>: ${pesos} kg${esf}<br>`;
      if (reg.notas?.[id]) cuerpo += `<span class="texto-2">— ${esc(reg.notas[id])}</span><br>`;
    }
    cuerpo += `</div>`;
    const vol = volumenSesion(reg);
    if (vol) cuerpo += `<div class="dia-detalle-fila"><span>Volumen</span><span>${fmtKg(vol)} kg</span></div>`;
  }
  if (reg?.vueltas)
    cuerpo += `<div class="dia-detalle-fila"><span>Vueltas circuito</span><span>${reg.vueltas.join(" · ")}</span></div>`;
  if (reg?.caminata?.minutos)
    cuerpo += `<div class="dia-detalle-fila"><span>Caminata</span><span>${reg.caminata.minutos} min${reg.caminata.nota ? " · " + esc(reg.caminata.nota) : ""}</span></div>`;
  if (reg?.hambre) cuerpo += `<div class="dia-detalle-fila"><span>Hambre</span><span>${reg.hambre}/5</span></div>`;
  if (reg?.cansancio) cuerpo += `<div class="dia-detalle-fila"><span>Cansancio</span><span>${reg.cansancio}/5</span></div>`;
  if (reg?.aguaMl) cuerpo += `<div class="dia-detalle-fila"><span>Agua</span><span>${reg.aguaMl} ml</span></div>`;
  if (reg?.comentario) cuerpo += `<p class="mt">${esc(reg.comentario)}</p>`;
  if (reg?.motivoSinFoto) cuerpo += `<div class="dia-detalle-fila"><span>Sin foto</span><span>${esc(reg.motivoSinFoto)}</span></div>`;

  let acciones = "";
  if (plan.tipo === "entreno" && !sesionRegistrada(fecha) && estado !== "causa-mayor" && fecha < hoyISO()) {
    acciones += `<button id="dd-retro" class="btn btn-primario btn-grande">Registrar retroactivo</button>`;
  }
  if (plan.tipo === "descanso" && fecha <= hoyISO()) {
    acciones += `<button id="dd-caminata" class="btn btn-borde btn-grande">${reg?.caminata ? "Editar" : "Registrar"} caminata</button>`;
  }

  abrirHoja(`
    <h3 style="text-transform:capitalize">${fmtFechaLarga(fecha)}</h3>
    ${cuerpo}
    ${reg?.tieneFoto ? `<div id="dd-foto" class="centrado mt texto-2">Cargando foto…</div>` : ""}
    ${acciones ? `<div class="hoja-acciones">${acciones}</div>` : ""}`);

  if (reg?.tieneFoto) {
    getDoc(refs.diaMedia(fecha, "foto")).then((snap) => {
      const caja = $("#dd-foto");
      if (caja && snap.exists())
        caja.outerHTML = `<img class="dia-foto" src="${snap.data().data}" alt="Foto del día">` +
          (snap.data().hora ? `<p class="texto-2 centrado" style="font-size:12px">Foto: ${fmtHora(snap.data().hora)}</p>` : "");
      else if (caja) caja.textContent = "Sin foto disponible";
    });
  }
  const retro = $("#dd-retro");
  if (retro) retro.onclick = () => hojaRetro(fecha);
  const cam = $("#dd-caminata");
  if (cam) cam.onclick = () => hojaCaminata(fecha);
}

/* Registro retroactivo de un día que quedó sin cargar */
function hojaRetro(fecha) {
  const plan = planDelDia(fecha);
  const rutinaId = plan.rutina || "musculacion";
  const r = RUTINAS[rutinaId];

  let campos = "";
  if (rutinaId === "musculacion") {
    campos = MUSCULACION.bloques.flatMap((b) => b.ejercicios).map((e) => {
      const previa = laVezPasada(e.id);
      return `<div class="campo"><label>${esc(e.nombre)} — peso (kg)</label>
        <input data-retro-ej="${e.id}" type="number" inputmode="decimal" step="${e.pesoPaso}"
          value="${previa?.peso ?? e.pesoSugerido ?? ""}"></div>`;
    }).join("");
  } else {
    campos = `<div class="campo"><label>Vueltas por bloque (4 bloques)</label>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
        ${[0, 1, 2, 3].map((i) => `<input data-retro-v="${i}" type="number" inputmode="decimal" step="0.5" value="3"
          style="min-height:48px;border:1.5px solid var(--borde);border-radius:12px;text-align:center;font-size:17px;background:var(--fondo)">`).join("")}
      </div></div>`;
  }

  abrirHoja(`
    <h3>Registro retroactivo</h3>
    <p class="texto-2" style="text-transform:capitalize">${fmtFechaLarga(fecha)} · ${r.nombre}</p>
    ${campos}
    <div class="campo"><label>Comentario</label>
      <input id="retro-comentario" type="text" placeholder="Opcional"></div>
    <div class="hoja-acciones">
      <button id="retro-guardar" class="btn btn-primario btn-grande">Guardar como hecha</button>
    </div>`);

  $("#retro-guardar").onclick = async () => {
    const dia = {
      tipo: "entreno", rutinaId, rutinasVersion: RUTINAS_VERSION,
      estado: "hecha", retroactivo: true,
      comentario: $("#retro-comentario").value.trim(),
    };
    if (rutinaId === "musculacion") {
      dia.series = {};
      $$("[data-retro-ej]").forEach((inp) => {
        const id = inp.dataset.retroEj;
        const peso = Number(inp.value);
        if (!peso && peso !== 0) return;
        const e = ejercicioPorId(id);
        dia.series[id] = Array.from({ length: e.series }, () => ({ peso, reps: e.reps, hecha: true }));
      });
    } else {
      dia.vueltas = $$("[data-retro-v]").map((inp) => Number(inp.value) || 0);
    }
    await guardarDia(fecha, dia);
    cerrarHoja(true);
    await procesarSemanasCerradas();
    refrescarVistaActual();
    toast("Día registrado.");
  };
}

/* ==========================================================================
   PESO
   ========================================================================== */
function pesajesOrdenados() {
  return [...S.pesajes.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([f, d]) => ({ fecha: f, ...d }));
}
function tendenciaEn(lista, i) {
  const desde = Math.max(0, i - 3);
  const ventana = lista.slice(desde, i + 1);
  return ventana.reduce((a, x) => a + x.pesoKg, 0) / ventana.length;
}

function renderPeso() {
  const cont = $("#peso-contenido");
  const lista = pesajesOrdenados();
  const objetivo = S.config.pesoObjetivo;
  const ultimo = lista[lista.length - 1];
  const tendencia = lista.length ? tendenciaEn(lista, lista.length - 1) : null;
  const inicial = lista[0];
  const esLunes = diaSemanaDe(hoyISO()) === CONFIG.pesajeDia;

  // Resumen contra el objetivo, cubriendo también los casos "ya lo pasé"
  // y "subí en vez de bajar"
  let resumenObjetivo = "";
  if (objetivo && tendencia) {
    const dif = tendencia - objetivo;
    if (dif > 0.05) resumenObjetivo = `Te faltan ${dif.toFixed(1)} kg para el objetivo`;
    else if (dif < -0.05) resumenObjetivo = `Objetivo cumplido y superado: estás ${(-dif).toFixed(1)} kg por debajo`;
    else resumenObjetivo = "Estás justo en tu peso objetivo";
    if (lista.length >= 2) {
      const delta = inicial.pesoKg - ultimo.pesoKg;
      if (delta > 0.05) resumenObjetivo += ` · bajaste ${delta.toFixed(1)} kg desde el inicio`;
      else if (delta < -0.05) resumenObjetivo += ` · subiste ${(-delta).toFixed(1)} kg desde el inicio`;
    }
  }

  cont.innerHTML = `
    ${esLunes && !S.pesajes.has(hoyISO()) ? `<p class="aviso-pendiente">Hoy es lunes: día de pesaje.</p>` : ""}
    <button id="btn-pesaje" class="btn btn-rojo btn-grande">Registrar pesaje</button>
    <div class="peso-resumen mt">
      <div class="peso-tarjeta"><strong>${ultimo ? ultimo.pesoKg.toFixed(1) : "—"}</strong><span>Último (kg)</span></div>
      <div class="peso-tarjeta"><strong>${tendencia ? tendencia.toFixed(1) : "—"}</strong><span>Tendencia</span></div>
      <div class="peso-tarjeta"><strong>${objetivo ?? "—"}</strong><span>Objetivo</span></div>
    </div>
    ${resumenObjetivo ? `<p class="texto-2 centrado">${resumenObjetivo}</p>` : ""}
    <div class="seccion-titulo">Evolución</div>
    <canvas id="peso-canvas" class="grafico"></canvas>
    <div class="seccion-titulo">Espejo — comparador</div>
    <div id="comparador-zona"><p class="texto-2">Cargando fotos…</p></div>`;

  $("#btn-pesaje").onclick = hojaPesaje;
  if (lista.length >= 2) dibujarGraficoPeso($("#peso-canvas"), lista, objetivo);
  else $("#peso-canvas").replaceWith(el("p", "texto-2", "Con dos pesajes o más aparece el gráfico."));
  renderComparador();
}

function dibujarGraficoPeso(canvas, lista, objetivo) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 340, H = 220;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const cTexto2 = css.getPropertyValue("--texto-2").trim();
  const cTexto = css.getPropertyValue("--texto").trim();
  const cRojo = css.getPropertyValue("--rojo").trim();

  const valores = lista.map((x) => x.pesoKg);
  const tend = lista.map((_, i) => tendenciaEn(lista, i));
  let min = Math.min(...valores, ...(objetivo ? [objetivo] : [])) - 1;
  let max = Math.max(...valores, ...(objetivo ? [objetivo] : [])) + 1;
  const M = { izq: 34, der: 10, arr: 12, aba: 22 };
  const x = (i) => M.izq + (i / Math.max(1, lista.length - 1)) * (W - M.izq - M.der);
  const y = (v) => M.arr + (1 - (v - min) / (max - min)) * (H - M.arr - M.aba);

  ctx.font = "11px -apple-system, sans-serif";
  ctx.fillStyle = cTexto2;
  for (let v = Math.ceil(min); v <= max; v += Math.max(1, Math.round((max - min) / 4))) {
    ctx.fillText(v.toFixed(0), 6, y(v) + 4);
    ctx.strokeStyle = cTexto2; ctx.globalAlpha = 0.15;
    ctx.beginPath(); ctx.moveTo(M.izq, y(v)); ctx.lineTo(W - M.der, y(v)); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.fillText(fmtFechaCorta(lista[0].fecha), M.izq, H - 6);
  ctx.fillText(fmtFechaCorta(lista[lista.length - 1].fecha), W - M.der - 34, H - 6);

  // puntos crudos, tenues
  ctx.fillStyle = cTexto2;
  lista.forEach((p, i) => { ctx.beginPath(); ctx.arc(x(i), y(p.pesoKg), 2.5, 0, 7); ctx.fill(); });

  // línea de objetivo
  if (objetivo) {
    ctx.strokeStyle = cRojo; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(M.izq, y(objetivo)); ctx.lineTo(W - M.der, y(objetivo)); ctx.stroke();
    ctx.setLineDash([]);
  }

  // línea de tendencia (promedio móvil de 4)
  ctx.strokeStyle = cTexto; ctx.lineWidth = 2.5;
  ctx.beginPath();
  tend.forEach((v, i) => { i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v)); });
  ctx.stroke();
}

function hojaPesaje() {
  const hoy = hoyISO();
  const previo = S.pesajes.get(hoy);
  abrirHoja(`
    <h3>Pesaje</h3>
    <div class="campo"><label>Peso (kg)</label>
      <input id="pes-kg" type="number" inputmode="decimal" step="0.1" value="${previo?.pesoKg ?? ""}"></div>
    <div class="campo"><label>Foto de la balanza</label>
      <div class="foto-zona" id="pes-balanza-zona">${previo?.tieneBalanza ? "Foto ya guardada · tocá para cambiar" : "Tocá para sacar la foto"}</div>
      <input id="pes-balanza" type="file" accept="image/*" capture="environment" style="display:none"></div>
    <div class="campo"><label>Foto del espejo</label>
      <div class="foto-zona" id="pes-espejo-zona">${previo?.tieneEspejo ? "Foto ya guardada · tocá para cambiar" : "Tocá para sacar la foto"}</div>
      <input id="pes-espejo" type="file" accept="image/*" capture="environment" style="display:none"></div>
    <div class="hoja-acciones">
      <button id="pes-guardar" class="btn btn-primario btn-grande">Guardar pesaje</button>
    </div>`);

  const fotos = {};
  for (const cual of ["balanza", "espejo"]) {
    const zona = $(`#pes-${cual}-zona`), input = $(`#pes-${cual}`);
    zona.onclick = () => input.click();
    input.onchange = async (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      zona.textContent = "Comprimiendo…";
      try {
        fotos[cual] = await comprimirFoto(f);
        zona.innerHTML = `<img src="${fotos[cual]}" alt="">`;
      } catch (_) { zona.textContent = "No se pudo procesar"; }
    };
  }

  $("#pes-guardar").onclick = async () => {
    const kg = Number($("#pes-kg").value);
    if (!kg) { $("#pes-kg").focus(); return; }
    const data = {
      fecha: hoy, pesoKg: kg, hora: Date.now(),
      tieneBalanza: !!(fotos.balanza || previo?.tieneBalanza),
      tieneEspejo: !!(fotos.espejo || previo?.tieneEspejo),
    };
    await setDoc(refs.pesaje(hoy), data, { merge: true });
    if (fotos.balanza) await setDoc(refs.pesajeMedia(hoy, "balanza"), { data: fotos.balanza, hora: Date.now() });
    if (fotos.espejo) await setDoc(refs.pesajeMedia(hoy, "espejo"), { data: fotos.espejo, hora: Date.now() });
    S.pesajes.set(hoy, data);
    cerrarHoja(true);
    toast("Pesaje guardado.");
    refrescarVistaActual();
  };
}

/* Comparador de fotos del espejo */
async function renderComparador() {
  const zona = $("#comparador-zona");
  if (!zona) return;
  const conEspejo = pesajesOrdenados().filter((p) => p.tieneEspejo);
  if (conEspejo.length < 2) {
    zona.innerHTML = `<p class="texto-2">Con dos fotos de espejo o más aparece el comparador.</p>`;
    return;
  }
  const opciones = conEspejo.map((p) =>
    `<option value="${p.fecha}">${fmtFechaCorta(p.fecha)} · ${p.pesoKg} kg</option>`).join("");
  zona.innerHTML = `
    <div class="comp-selects">
      <select id="comp-a">${opciones}</select>
      <select id="comp-b">${opciones}</select>
    </div>
    <div id="comp-caja"></div>`;
  $("#comp-a").value = conEspejo[0].fecha;
  $("#comp-b").value = conEspejo[conEspejo.length - 1].fecha;
  const cargar = async () => {
    const fa = $("#comp-a").value, fb = $("#comp-b").value;
    $("#comp-caja").innerHTML = `<p class="texto-2">Cargando…</p>`;
    const [sa, sb] = await Promise.all([
      getDoc(refs.pesajeMedia(fa, "espejo")), getDoc(refs.pesajeMedia(fb, "espejo"))]);
    if (!sa.exists() || !sb.exists()) { $("#comp-caja").innerHTML = `<p class="texto-2">Falta alguna foto.</p>`; return; }
    $("#comp-caja").innerHTML = `
      <div class="comparador" id="comp-vista">
        <img src="${sa.data().data}" alt="antes">
        <div class="comp-encima" id="comp-encima" style="width:50%">
          <img src="${sb.data().data}" alt="después"></div>
        <div class="comp-linea" id="comp-linea" style="left:50%"></div>
      </div>
      <input id="comp-rango" class="comp-slider" type="range" min="0" max="100" value="50">
      <div class="comp-fechas"><span>${fmtFechaCorta(fa)}</span><span>${fmtFechaCorta(fb)}</span></div>`;
    const encima = $("#comp-encima"), linea = $("#comp-linea");
    $("#comp-rango").oninput = (e) => {
      encima.style.width = `${e.target.value}%`;
      linea.style.left = `${e.target.value}%`;
    };
  };
  $("#comp-a").onchange = cargar;
  $("#comp-b").onchange = cargar;
  await cargar();
}

/* ==========================================================================
   HISTORIAL
   ========================================================================== */
function renderHistorial() {
  const cont = $("#historial-contenido");
  const ejercicios = [...MUSCULACION.bloques.flatMap((b) => b.ejercicios), ...INTERVALOS.circuito];
  const sel = localStorage.getItem("histEj") || "prensa-pos1";

  cont.innerHTML = `
    <div class="seccion-titulo">Progresión de carga</div>
    <div class="campo"><select id="hist-ej">
      ${ejercicios.map((e) => `<option value="${e.id}" ${e.id === sel ? "selected" : ""}>${esc(e.nombre)}</option>`).join("")}
    </select></div>
    <canvas id="hist-canvas" class="grafico"></canvas>
    <div class="seccion-titulo">Récords personales</div>
    <div id="pr-lista" class="pr-lista"></div>
    <div class="seccion-titulo">Álbum del gym</div>
    <div class="cal-nav">
      <button id="alb-prev" class="btn-icono">‹</button>
      <span id="alb-titulo"></span>
      <button id="alb-sig" class="btn-icono">›</button>
    </div>
    <div id="album" class="album"></div>
    <div class="seccion-titulo">Exportar</div>
    <div class="hoja-acciones">
      <button id="pdf-dia" class="btn btn-borde btn-grande">PDF del último día</button>
      <button id="pdf-semana" class="btn btn-borde btn-grande">PDF de la semana</button>
    </div>`;

  $("#hist-ej").onchange = (e) => { localStorage.setItem("histEj", e.target.value); renderHistorial(); };
  dibujarProgresion($("#hist-canvas"), sel);
  renderPRs($("#pr-lista"));

  if (!S.albumMes) S.albumMes = hoyISO().slice(0, 7);
  renderAlbum();
  $("#alb-prev").onclick = () => { S.albumMes = mesVecino(S.albumMes, -1); renderAlbum(); };
  $("#alb-sig").onclick = () => { S.albumMes = mesVecino(S.albumMes, 1); renderAlbum(); };

  $("#pdf-dia").onclick = () => exportarPDF("dia");
  $("#pdf-semana").onclick = () => exportarPDF("semana");
}

function mesVecino(mes, d) {
  const [y, m] = mes.split("-").map(Number);
  const f = new Date(y, m - 1 + d, 1);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}`;
}

/* Serie histórica de peso máximo por sesión para un ejercicio */
function progresionDe(id) {
  const puntos = [];
  for (const [f, reg] of [...S.dias.entries()].sort()) {
    const ss = reg.series?.[id];
    if (!ss) continue;
    const hechas = ss.filter((x) => x.hecha);
    if (!hechas.length) continue;
    puntos.push({ fecha: f, pesoKg: Math.max(...hechas.map((x) => x.peso || 0)) });
  }
  return puntos;
}

function dibujarProgresion(canvas, id) {
  const puntos = progresionDe(id);
  if (puntos.length < 2) {
    canvas.replaceWith(el("p", "texto-2", "Con dos sesiones o más de este ejercicio aparece el gráfico."));
    return;
  }
  dibujarGraficoPeso(canvas, puntos, null);
}

function renderPRs(caja) {
  const ejercicios = [...MUSCULACION.bloques.flatMap((b) => b.ejercicios), ...INTERVALOS.circuito];
  const max = {};
  for (const [f, reg] of S.dias) {
    if (!reg.series) continue;
    for (const [id, ss] of Object.entries(reg.series))
      for (const x of ss)
        if (x.hecha && (!max[id] || x.peso > max[id].peso)) max[id] = { peso: x.peso, fecha: f };
  }
  caja.innerHTML = ejercicios.filter((e) => max[e.id]).map((e) => `
    <div class="pr-fila"><span>${esc(e.nombre)}</span>
      <strong>${max[e.id].peso} kg <span class="texto-2" style="font-weight:400">· ${fmtFechaCorta(max[e.id].fecha)}</span></strong></div>`).join("")
    || `<p class="texto-2">Todavía no hay récords registrados.</p>`;
}

async function renderAlbum() {
  $("#alb-titulo").textContent = `${MESES_NOMBRE[Number(S.albumMes.slice(5)) - 1]} ${S.albumMes.slice(0, 4)}`;
  const album = $("#album");
  const conFoto = [...S.dias.entries()]
    .filter(([f, d]) => f.startsWith(S.albumMes) && d.tieneFoto).sort();
  if (!conFoto.length) { album.innerHTML = `<p class="album-vacio">Sin fotos este mes.</p>`; return; }
  album.innerHTML = conFoto.map(([f]) => `<div data-alb="${f}" class="hm-celda" style="width:auto;height:auto;aspect-ratio:1;border-radius:10px;background:var(--fondo-2)"></div>`).join("");
  for (const [f] of conFoto) {
    getDoc(refs.diaMedia(f, "foto")).then((snap) => {
      const celda = album.querySelector(`[data-alb="${f}"]`);
      if (celda && snap.exists()) {
        celda.outerHTML = `<img src="${snap.data().data}" alt="${f}" title="${f}">`;
      }
    });
  }
}

/* ==========================================================================
   PDF — resumen del día y de la semana (jsPDF por CDN, carga perezosa)
   ========================================================================== */
function cargarJsPDF() {
  return new Promise((resolver, rechazar) => {
    if (window.jspdf) return resolver(window.jspdf);
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    s.onload = () => resolver(window.jspdf);
    s.onerror = () => rechazar(new Error("Sin conexión: el PDF necesita internet."));
    document.head.appendChild(s);
  });
}

function lineasDeDia(f) {
  const reg = S.dias.get(f);
  const lineas = [`${fmtFechaLarga(f)} — ${({ hecha: "Entrenó", recuperada: "Recuperada", "causa-mayor": "Causa mayor", fallada: "Fallada", descanso: "Descanso", "descanso-caminata": "Descanso + caminata", pendiente: "Pendiente" })[estadoDia(f)]}`];
  if (!reg) return lineas;
  if (reg.rutinaId && RUTINAS[reg.rutinaId]) lineas.push(`Rutina: ${RUTINAS[reg.rutinaId].nombre}`);
  if (reg.inicio && reg.fin) lineas.push(`Horario: ${fmtHora(reg.inicio)}-${fmtHora(reg.fin)} (${fmtDuracion((reg.fin - reg.inicio) / 1000)})`);
  if (reg.series) for (const [id, ss] of Object.entries(reg.series)) {
    const hechas = ss.filter((x) => x.hecha);
    if (hechas.length) lineas.push(`  ${nombreEjercicio(id)}: ${hechas.map((x) => `${x.peso}x${x.reps}`).join(", ")} kg`);
  }
  if (reg.vueltas) lineas.push(`Vueltas circuito: ${reg.vueltas.join(", ")}`);
  const vol = volumenSesion(reg);
  if (vol) lineas.push(`Volumen: ${fmtKg(vol)} kg`);
  if (reg.hambre) lineas.push(`Hambre: ${reg.hambre}/5`);
  if (reg.cansancio) lineas.push(`Cansancio: ${reg.cansancio}/5`);
  if (reg.aguaMl) lineas.push(`Agua: ${reg.aguaMl} ml`);
  if (reg.caminata?.minutos) lineas.push(`Caminata: ${reg.caminata.minutos} min`);
  if (reg.comentario) lineas.push(`Comentario: ${reg.comentario}`);
  const pesaje = S.pesajes.get(f);
  if (pesaje) lineas.push(`Peso corporal: ${pesaje.pesoKg} kg`);
  return lineas;
}

async function exportarPDF(tipo) {
  let jspdf;
  try { jspdf = await cargarJsPDF(); }
  catch (e) { toast(e.message, "toast-alerta"); return; }
  const docpdf = new jspdf.jsPDF();
  let y = 16;
  const escribir = (t, negrita) => {
    docpdf.setFont("helvetica", negrita ? "bold" : "normal");
    docpdf.setFontSize(negrita ? 13 : 11);
    const partes = docpdf.splitTextToSize(t, 180);
    for (const p of partes) {
      if (y > 280) { docpdf.addPage(); y = 16; }
      docpdf.text(p, 14, y); y += 6;
    }
  };

  if (tipo === "dia") {
    const conDatos = [...S.dias.keys()].filter((f) => sesionRegistrada(f)).sort();
    const f = conDatos[conDatos.length - 1] || hoyISO();
    escribir("Mi Entrenador — Resumen del día", true);
    y += 2;
    for (const l of lineasDeDia(f)) escribir(l);
    docpdf.save(`entrenador-${f}.pdf`);
  } else {
    const lunes = lunesDe(hoyISO());
    const r = resumenSemana(lunes);
    escribir("Mi Entrenador — Resumen semanal", true);
    escribir(`Semana del ${fmtFechaCorta(lunes)} al ${fmtFechaCorta(r.domingo)}`);
    const { racha } = calcularRacha();
    escribir(`Racha: ${racha} semanas · Rango: ${rangoDe(racha).nombre}`);
    escribir(`Sesiones: ${r.sesiones}/${CONFIG.sesionesPorSemana}${r.mencionHonor ? " · Mención de honor" : ""}`);
    y += 2;
    for (let i = 0; i < 7; i++) {
      const f = sumarDias(lunes, i);
      if (f > hoyISO()) break;
      for (const l of lineasDeDia(f)) escribir(l);
      y += 2;
    }
    docpdf.save(`entrenador-semana-${claveSemana(lunes)}.pdf`);
  }
}

/* ==========================================================================
   EVENTOS GLOBALES Y ARRANQUE
   ========================================================================== */
$("#btn-login").addEventListener("click", entrar);
$("#btn-config").addEventListener("click", hojaConfig);
$("#btn-entreno-salir").addEventListener("click", salirDeSesion);
$("#cal-prev").addEventListener("click", () => {
  const b = parseISO(S.calMes); S.calMes = fmtISO(new Date(b.getFullYear(), b.getMonth() - 1, 1));
  renderCalendario();
});
$("#cal-sig").addEventListener("click", () => {
  const b = parseISO(S.calMes); S.calMes = fmtISO(new Date(b.getFullYear(), b.getMonth() + 1, 1));
  renderCalendario();
});
$$("[data-ir]").forEach((b) => {
  b.addEventListener("click", () => {
    const destino = b.dataset.ir;
    if (destino === "agua") hojaAgua();
    else mostrarVista(destino);
  });
});

/* Al volver al primer plano, refrescar el estado del día (cambio de fecha,
   avisos de mediodía, etc.) */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.cargado && vistaActual === "inicio") renderInicio();
});

/* Service worker */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { });
  });
}

/* Arranque */
pintarSnapshotInicio();
if (firebaseConfig.apiKey.startsWith("PEGAR")) {
  mostrarVista("login");
  $("#login-error").textContent = "Falta completar firebase-config.js con las credenciales del proyecto.";
  $("#login-error").classList.remove("oculta");
} else {
  iniciarFirebase();
}
if (sesionGuardadaHoy()) arrancarTickeo();
