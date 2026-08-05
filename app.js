/* ============================================================================
   MI ENTRENADOR — lógica de la app (v2)
   ----------------------------------------------------------------------------
   Lee las rutinas de rutinas.js y los textos de mensajes.js (scripts clásicos,
   visibles acá como globales). Firebase v10 modular por CDN.

   Regla de oro del arranque: NINGUNA pantalla se decide hasta que el estado
   de autenticación esté resuelto (incluido getRedirectResult), y el inicio
   no se muestra hasta que los datos estén cargados.
   ========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, initializeAuth, GoogleAuthProvider, onAuthStateChanged,
  signInWithCredential, signInWithPopup, signInWithRedirect, getRedirectResult, signOut,
  indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, setDoc, getDoc, onSnapshot, waitForPendingWrites,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig, googleClientId } from "./firebase-config.js";

/* ==========================================================================
   ESTADO GLOBAL
   ========================================================================== */
const S = {
  user: null, db: null, auth: null,
  config: null,
  dias: new Map(), pesajes: new Map(), semanas: new Map(),
  listo: { dias: false, pesajes: false, semanas: false, config: false },
  cargado: false,
  errorDatos: null,
  sesion: null,
  calMes: null, albumMes: null,
  audioListo: false, wakeLock: null,
  procesandoSemanas: false,
};

const FECHA_INICIO_APP = "2026-08-03";   // piso: antes de esto no hay historia
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

/* --- Fechas ------------------------------------------------------------------
   REGLA ÚNICA: el día calendario es SIEMPRE el de Buenos Aires, no importa la
   zona horaria que tenga configurada el teléfono. El día pasa a las 00:00 de
   Argentina y en ningún lado se asume UTC.

   `fmtISO`/`parseISO` son aritmética civil pura: convierten entre "YYYY-MM-DD"
   y un Date al mediodía local, que es solo un envase para sumar y restar días
   sin cruzarse de fecha. No consultan el reloj y por eso dan igual en todos los
   dispositivos. La única función que mira la hora real es `hoyISO()`.        */
const TZ = "America/Argentina/Buenos_Aires";

const _fmtDiaTZ = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
});
const _fmtHoraTZ = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
});
function _partes(fmt, fecha) {
  const p = {};
  for (const x of fmt.formatToParts(fecha)) p[x.type] = x.value;
  return p;
}

function fmtISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12);   // mediodía: inmune a saltos de horario
}
/* El día de hoy en Buenos Aires. Único punto del código que lee el reloj. */
function hoyISO() {
  const p = _partes(_fmtDiaTZ, new Date());
  return `${p.year}-${p.month}-${p.day}`;
}
/* La hora de Buenos Aires (0-23), para los mensajes que cambian de tono. */
function horaAhora() {
  return Number(_partes(_fmtHoraTZ, new Date()).hour);
}
function sumarDias(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return fmtISO(d); }
function diaSemanaDe(iso) { return parseISO(iso).getDay(); }
function lunesDe(iso) {
  const d = parseISO(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return fmtISO(d);
}
function domingoDe(iso) { return sumarDias(lunesDe(iso), 6); }
function claveSemana(iso) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const anio = d.getFullYear();
  const ene4 = parseISO(`${anio}-01-04`);   // mismo envase que d: la resta da días exactos
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
  const p = _partes(_fmtHoraTZ, new Date(ts));
  return `${p.hour}:${p.minute}`;
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
function fmtLitros(ml) { return (ml / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 }); }

const movReducido = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* --- Toasts --- */
function toast(texto, tipo = "", dur = 4200) {
  const t = el("div", `toast ${tipo}`, esc(texto));
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), dur);
}

/* --- Vibración: tres patrones y nada más (solo si la API existe) --- */
const VIBRA = { leve: 10, confirmar: [30, 40, 30], celebrar: [50, 80, 50, 80, 120] };
function vibrar(tipo) {
  if (navigator.vibrate) navigator.vibrate(VIBRA[tipo] || 10);
}

/* --- Números que cuentan hasta su valor --- */
function contarNumero(nodo, hasta, { dur = 600, dec = 0, prefijo = "", sufijo = "" } = {}) {
  if (!nodo) return;
  const desde = parseFloat((nodo.dataset.valor || "0").replace(",", ".")) || 0;
  nodo.dataset.valor = String(hasta);
  if (movReducido() || desde === hasta) {
    nodo.textContent = prefijo + hasta.toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + sufijo;
    return;
  }
  const t0 = performance.now();
  const paso = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);           // desaceleración
    const v = desde + (hasta - desde) * e;
    nodo.textContent = prefijo + v.toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + sufijo;
    if (p < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}

/* --- Mensajes del sargento: rotación por día local --- */
function sargento(clave, vars = {}) {
  const lista = (typeof MENSAJES !== "undefined" && MENSAJES[clave]) || [];
  if (!lista.length) return "";
  // El mensaje rota una vez por día calendario argentino, igual en todos los teléfonos.
  const [anio, mes, diaMes] = hoyISO().split("-").map(Number);
  const dia = Math.floor(Date.UTC(anio, mes - 1, diaMes) / 86400000);
  let hash = 0;
  for (const c of clave) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  let m = lista[(dia + hash) % lista.length];
  for (const [k, v] of Object.entries(vars)) m = m.split(`{${k}}`).join(v);
  return m;
}

/* --- SVG: galones (chevrones) y anillos --- */
function svgGalon(estado, extra = "") {
  // estado: "lleno" | "vacio" | "rojo"
  return `<svg viewBox="0 0 24 20" class="${extra}" aria-hidden="true">
    <path class="galon-${estado}" d="M12 2.5 22 10v5L12 8 2 15v-5z"/></svg>`;
}
function svgAnillo(pct, { tilde = false } = {}) {
  const r = 45, c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(1, Math.max(0, pct)));
  return `
    <svg viewBox="0 0 100 100">
      <circle class="pista" cx="50" cy="50" r="${r}"/>
      <circle class="valor" cx="50" cy="50" r="${r}"
        stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
    </svg>
    ${tilde ? `<svg class="tilde-svg" viewBox="0 0 24 24"><path d="M4 12.5 10 18 20 6"/></svg>` : ""}`;
}

/* ==========================================================================
   TEMA — sigue al sistema, con toggle manual, y transición animada
   ========================================================================== */
function aplicarTema(pref, animado) {
  if (animado && !movReducido()) {
    document.documentElement.classList.add("transicion-tema");
    setTimeout(() => document.documentElement.classList.remove("transicion-tema"), 350);
  }
  if (!pref || pref === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", pref);
  localStorage.setItem("tema", pref || "auto");
}
aplicarTema(localStorage.getItem("tema") || "auto", false);

/* ==========================================================================
   MODO PRUEBA — timers de 10s, sesiones que no cuentan
   ========================================================================== */
function modoPrueba() { return localStorage.getItem("modoPrueba") === "1"; }
function durT(seg) { return modoPrueba() ? 10 : seg; }

/* ==========================================================================
   AUTENTICACIÓN
   --------------------------------------------------------------------------
   Por qué no se usa el flujo de redirect de Firebase: ese flujo abre un
   iframe contra `authDomain` (mis-finanzas-d65e0.firebaseapp.com), que es un
   dominio distinto del que sirve la app (franlafuente-dev.github.io). Safari
   particiona el almacenamiento de ese tercer dominio, así que el token nunca
   vuelve al origen de la app: queda cargando o rebota al login. En GitHub
   Pages no se puede aplicar el arreglo oficial (servir el manejador desde el
   propio dominio con un proxy inverso).

   En su lugar: Google Identity Services devuelve un ID token sin iframes
   entre dominios, y ese token se le entrega a Firebase con
   signInWithCredential. Funciona igual instalada en la pantalla de inicio.

   REGLA: la app NUNCA cierra sesión sola. `signOut` se llama en un solo lugar
   de todo el proyecto, `cerrarSesionManual()`, y solo desde el botón de
   Ajustes. Un error de red o de permisos jamás devuelve al login.
   ========================================================================== */
let refs = null;

function esIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function esStandalone() {
  return window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
}

/* --- Bitácora de sesión: sobrevive a recargas y se puede leer en Ajustes --- */
const AUTH_LOG = [];
try {
  const previo = JSON.parse(localStorage.getItem("authLog") || "[]");
  if (Array.isArray(previo)) AUTH_LOG.push(...previo.slice(-40));
} catch (_) { }

function logAuth(msj) {
  const linea = `${fmtHora(Date.now())} · ${msj}`;
  AUTH_LOG.push(linea);
  while (AUTH_LOG.length > 40) AUTH_LOG.shift();
  try { localStorage.setItem("authLog", JSON.stringify(AUTH_LOG)); } catch (_) { }
  console.log("[auth]", linea);
}

function iniciarFirebase() {
  logAuth(`arranque · ${esStandalone() ? "instalada" : "navegador"} · ${esIOS() ? "iOS" : "otro"}`);
  const app = initializeApp(firebaseConfig);

  // Persistencia explícita: IndexedDB primero, localStorage de respaldo.
  // Con initializeAuth queda fijada ANTES del primer chequeo de sesión, así no
  // hay ventana en la que la sesión guardada todavía no se haya restaurado.
  try {
    S.auth = initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch (e) {
    logAuth(`initializeAuth falló (${e?.code || e?.message}), sigo con getAuth`);
    S.auth = getAuth(app);
  }

  S.db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });

  // El listener se registra PRIMERO y sin esperar nada. Es lo único que decide
  // qué pantalla se ve. Antes esto iba después de `await getRedirectResult`, y
  // si esa promesa no resolvía (justo lo que pasa en Safari), el listener no
  // llegaba a registrarse nunca y la app quedaba cargando para siempre.
  onAuthStateChanged(S.auth, (user) => {
    if (user) {
      const cambioDeUsuario = S.user?.uid !== user.uid;
      logAuth(`sesión activa: ${user.email}${cambioDeUsuario ? "" : " (refresco)"}`);
      S.user = user;
      if (cambioDeUsuario) {
        prepararRefs();
        conectarDatos();
      }
      if (!S.cargado) mostrarVista("carga");
    } else {
      logAuth("sin sesión → pantalla de login");
      S.user = null;
      S.cargado = false;
      mostrarVista("login");
      prepararGoogle();
    }
  }, (e) => {
    // Error del propio observador: no es motivo para expulsar a nadie.
    logAuth(`error del observador: ${e?.code || e?.message || e}`);
  });

  // Solo por si quedó un redirect viejo en vuelo de la versión anterior.
  // Va suelto a propósito: no puede bloquear el arranque.
  getRedirectResult(S.auth)
    .then((r) => { if (r?.user) logAuth(`redirect heredado resuelto: ${r.user.email}`); })
    .catch((e) => logAuth(`redirect heredado falló: ${e?.code || e?.message}`));
}

/* --- Google Identity Services ---------------------------------------------- */
let gisListo = false;

function cargarScriptGIS() {
  return new Promise((resolver, rechazar) => {
    if (window.google?.accounts?.id) return resolver();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolver();
    s.onerror = () => rechazar(new Error("No se pudo cargar el cliente de Google."));
    document.head.appendChild(s);
  });
}

async function prepararGoogle() {
  if (gisListo) return;
  const cid = (googleClientId || "").trim();

  if (!cid || cid.startsWith("PEGAR")) {
    avisoLogin("Falta pegar el Client ID de Google en firebase-config.js. " +
      "Mientras tanto podés entrar con el botón de abajo (funciona en Android y en la compu).");
    return;
  }
  if (!navigator.onLine) {
    avisoLogin("Sin conexión. Conectate para entrar la primera vez; después la sesión queda guardada.");
    return;
  }

  try {
    await cargarScriptGIS();
  } catch (e) {
    logAuth("no cargó el script de Google");
    avisoLogin("No se pudo contactar a Google. Probá con el botón de abajo.");
    return;
  }

  try {
    window.google.accounts.id.initialize({
      client_id: cid,
      callback: recibirCredencialGoogle,
      auto_select: true,            // si ya entró antes, entra solo
      cancel_on_tap_outside: false,
      use_fedcm_for_prompt: true,   // el camino que Safari y Chrome sí permiten
      context: "signin",
    });
    window.google.accounts.id.renderButton($("#gis-boton"), {
      type: "standard", theme: "filled_black", size: "large",
      text: "signin_with", shape: "pill", locale: "es-419", width: 280,
    });
    window.google.accounts.id.prompt();
    gisListo = true;
    logAuth("Google Identity Services listo");

    // Google dibuja el botón aunque el origen no esté autorizado: el rechazo
    // recién aparece al pedir el token, y no lanza ninguna excepción que se
    // pueda atrapar acá. Así que esto solo cubre el caso de que el botón no
    // llegue a dibujarse (script a medias, Client ID malformado), que si no
    // dejaría la pantalla con el botón de respaldo y sin explicación.
    setTimeout(() => {
      if ($("#gis-boton")?.childElementCount) return;
      logAuth("Google no llegó a dibujar el botón");
      avisoLogin("Google no llegó a dibujar su botón. Puede ser el Client ID " +
        `o que este origen (${location.origin}) no esté autorizado en ` +
        "console.cloud.google.com → Credenciales → Authorized JavaScript origins.");
    }, 2500);
  } catch (e) {
    logAuth(`GIS no se pudo inicializar: ${e?.message || e}`);
    avisoLogin("Google no respondió como se esperaba. Probá con el botón de abajo.");
  }
}

async function recibirCredencialGoogle(respuesta) {
  if (!respuesta?.credential) {
    logAuth("Google no devolvió credencial");
    return;
  }
  logAuth("Google devolvió el ID token; se lo paso a Firebase");
  $("#login-error").classList.add("oculta");
  try {
    await signInWithCredential(S.auth, GoogleAuthProvider.credential(respuesta.credential));
    logAuth("signInWithCredential OK");
  } catch (e) {
    logAuth(`signInWithCredential falló: ${e?.code || e?.message}`);
    mostrarErrorLogin(e);
  }
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
  const codigo = e?.code || "";
  let ayuda = "";
  if (codigo.includes("unauthorized-domain")) ayuda = "Este dominio no está autorizado en Firebase (Authentication → Settings → Authorized domains).";
  else if (codigo.includes("network")) ayuda = "Parece un problema de conexión. Probá de nuevo con señal.";
  else if (codigo.includes("invalid-credential")) ayuda = "Revisá que el Client ID de firebase-config.js sea el del proyecto mis-finanzas-d65e0.";
  caja.innerHTML = `<b>No se pudo entrar.</b><br>${esc(e?.message || e)}${ayuda ? `<br><br>${esc(ayuda)}` : ""}`;
  caja.classList.remove("oculta");
}

function avisoLogin(texto) {
  const caja = $("#login-aviso");
  caja.textContent = texto;
  caja.classList.remove("oculta");
}

/* Botón de respaldo: popup (Android y escritorio). El redirect quedó como
   último recurso y solo fuera de iOS, donde es justamente el que no vuelve. */
async function entrar() {
  $("#login-error").classList.add("oculta");
  const proveedor = new GoogleAuthProvider();
  try {
    logAuth("entrada manual con popup");
    await signInWithPopup(S.auth, proveedor);
  } catch (e) {
    const recuperable = e && (e.code === "auth/popup-blocked" ||
      e.code === "auth/operation-not-supported-in-this-environment" ||
      e.code === "auth/cancelled-popup-request");
    if (recuperable && !esIOS()) {
      logAuth(`popup bloqueado (${e.code}), voy por redirect`);
      try { await signInWithRedirect(S.auth, proveedor); return; } catch (e2) { e = e2; }
    }
    if (e.code === "auth/popup-closed-by-user") { logAuth("popup cerrado por el usuario"); return; }
    logAuth(`entrada manual falló: ${e?.code || e?.message}`);
    mostrarErrorLogin(e);
  }
}

/* El ÚNICO signOut del proyecto. Si aparece otro, es un bug. */
async function cerrarSesionManual() {
  logAuth("cierre de sesión pedido por el usuario");
  try { window.google?.accounts?.id?.disableAutoSelect(); } catch (_) { }
  gisListo = false;
  await signOut(S.auth);
}

/* ==========================================================================
   DATOS — listeners CON manejo de errores, y semilla
   ========================================================================== */
function errorDatos(e) {
  S.errorDatos = e;
  const esPermiso = (e?.code || "").includes("permission-denied");
  const msj = esPermiso
    ? "Firestore rechazó el acceso: falta agregar el bloque de REGLAS-A-AGREGAR.txt en las reglas."
    : `No se pudieron cargar los datos (${e?.code || e?.message || e}).`;
  // Visible siempre: en la pantalla de carga y como toast.
  toast(msj, "toast-alerta", 8000);
  const carga = $("#vista-carga");
  if (!carga.classList.contains("oculta") && !$("#carga-error")) {
    const caja = el("div", "login-error", `<b>Error de datos.</b><br>${esc(msj)}`);
    caja.id = "carga-error";
    const btn = el("button", "btn btn-primario btn-grande mt", "Reintentar");
    btn.onclick = () => location.reload();
    carga.appendChild(caja); carga.appendChild(btn);
  }
}

/* Si un listener falla, igual hay que marcarlo como resuelto: de lo contrario
   `alCambiarDatos` espera a los cuatro para siempre y la app se queda en el
   esqueleto de carga sin decir por qué. */
function alFallarListener(cual) {
  return (e) => {
    S.listo[cual] = true;
    errorDatos(e);
    alCambiarDatos();
  };
}

function conectarDatos() {
  onSnapshot(refs.config, (snap) => {
    S.config = snap.exists() ? snap.data() : null;
    S.listo.config = true;
    alCambiarDatos();
  }, alFallarListener("config"));
  onSnapshot(refs.dias, (snap) => {
    S.dias = new Map();
    snap.forEach((d) => S.dias.set(d.id, d.data()));
    S.listo.dias = true;
    alCambiarDatos();
  }, alFallarListener("dias"));
  onSnapshot(refs.pesajes, (snap) => {
    S.pesajes = new Map();
    snap.forEach((d) => S.pesajes.set(d.id, d.data()));
    S.listo.pesajes = true;
    alCambiarDatos();
  }, alFallarListener("pesajes"));
  onSnapshot(refs.semanas, (snap) => {
    S.semanas = new Map();
    snap.forEach((d) => S.semanas.set(d.id, d.data()));
    S.listo.semanas = true;
    alCambiarDatos();
  }, alFallarListener("semanas"));
}

let seedEnCurso = false;

async function alCambiarDatos() {
  if (!S.listo.config || !S.listo.dias || !S.listo.pesajes || !S.listo.semanas) return;

  // Sin config y sin error: es la primera vez, se siembra. Con error de por
  // medio no se siembra nada, para no pisar datos que quizá sí existen.
  if (!S.config && !seedEnCurso && !S.errorDatos) {
    seedEnCurso = true;
    try { await cargarSemilla(); } catch (e) { errorDatos(e); }
    seedEnCurso = false;
    return;
  }
  if (!S.config) return;
  if (!S.config.fechaInicio) await guardarConfig({ fechaInicio: FECHA_INICIO_APP });

  const primeraVez = !S.cargado;
  S.cargado = true;

  // Cualquier sesión de un día anterior se cierra sola antes de calcular nada,
  // así la racha ya la ve como hecha y no como un día colgado.
  if (primeraVez) await cerrarSesionesViejas();

  await procesarSemanasCerradas();
  if (primeraVez && (vistaActual === "carga" || vistaActual === "login")) {
    irA("inicio", true);
    // Si retomó una sesión abierta de hoy, se entra directo al entrenamiento.
    const abierta = diaConSesionAbierta();
    if (abierta?.fecha === hoyISO() && !S.sesion) toast("Tenés un entrenamiento sin cerrar. Tocá la tarjeta para seguir.", "", 6000);
    else avisarCierreAutomatico();
  } else refrescarVistaActual();
}

async function cargarSemilla() {
  const conf = {
    creado: Date.now(),
    seedCargada: true,
    fechaInicio: FECHA_INICIO_APP,
    botellaMl: CONFIG.botellaMl,
    vasoMl: CONFIG.vasoMl,
    aguaObjetivoMl: CONFIG.aguaObjetivoMl,
    descansoSeg: CONFIG.descansoEntreSeriesSeg,
    pesoObjetivo: null,
    escudos: {},
    notasEjercicio: {},
    ascensos: [],
  };

  if (S.dias.size === 0 && typeof SEED !== "undefined") {
    for (const s of SEED) {
      const dia = {
        fecha: s.fecha, tipo: "entreno", rutinaId: s.rutina,
        rutinasVersion: RUTINAS_VERSION, estado: s.estado || "hecha",
        inicio: null, fin: null, series: {}, esPrueba: false,
        esfuerzo: s.esfuerzo || {}, notas: s.notas || {},
        ascensoMarcado: [], aguaMl: 0, tieneFoto: false,
        comentario: [s.nota, s.extra].filter(Boolean).join(". "),
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

/* ==========================================================================
   ESCRITURAS — nunca en silencio, nunca dos veces
   --------------------------------------------------------------------------
   Con la caché persistente, `setDoc` resuelve cuando el dato quedó escrito en
   el TELÉFONO, no cuando el servidor lo confirma. Por eso hay dos niveles:

   - El try/catch atrapa el fallo inmediato (documento inválido, sin refs).
   - `waitForPendingWrites` avisa cuándo el servidor terminó de aceptar todo
     lo que había en cola; mientras tanto se muestra "Guardando…".

   Un rechazo del servidor por reglas no rechaza la promesa: Firestore revierte
   el documento local y el onSnapshot reparte el valor viejo. Por eso el estado
   local se actualiza DESPUÉS de que la escritura resuelva y nunca antes: si
   algo se revierte, la pantalla sigue al snapshot y no a una copia optimista.
   ========================================================================== */
let syncPendientes = 0;

function pintarSync() {
  const n = $("#sync-indicador");
  if (!n) return;
  n.classList.toggle("oculta", syncPendientes <= 0);
  // Offline el dato ya está guardado en el teléfono: lo que falta es subirlo.
  n.textContent = navigator.onLine ? "Guardando…" : "Sin sincronizar";
}

function mostrarFalloEscritura(queHacia, e, reintentar) {
  const caja = $("#fallo-escritura");
  if (!caja) return;
  caja.innerHTML = `<span>No se pudo guardar ${esc(queHacia)}.<small>${esc(e?.code || e?.message || e)}</small></span>`;
  const btn = el("button", "btn btn-medio", "Reintentar");
  btn.onclick = async () => {
    caja.classList.add("oculta");
    await escribir(queHacia, reintentar);
  };
  const cerrar = el("button", "btn-icono", "✕");
  cerrar.setAttribute("aria-label", "Descartar aviso");
  cerrar.onclick = () => caja.classList.add("oculta");
  caja.append(btn, cerrar);
  caja.classList.remove("oculta");
  vibrar("confirmar");
}

/* Envoltorio de toda escritura. `boton` queda deshabilitado mientras dura,
   que es lo que evita el doble toque. Devuelve true solo si salió bien. */
async function escribir(queHacia, fn, boton) {
  if (boton) {
    if (boton.disabled) return false;      // ya hay una en curso: se ignora
    boton.disabled = true;
    boton.classList.add("ocupado");
  }
  syncPendientes++;
  pintarSync();
  try {
    await fn();
    waitForPendingWrites(S.db)
      .catch(() => { })
      .then(() => { syncPendientes = Math.max(0, syncPendientes - 1); pintarSync(); });
    return true;
  } catch (e) {
    syncPendientes = Math.max(0, syncPendientes - 1);
    pintarSync();
    console.error("escritura fallida:", queHacia, e);
    mostrarFalloEscritura(queHacia, e, fn);
    return false;
  } finally {
    if (boton) { boton.disabled = false; boton.classList.remove("ocupado"); }
  }
}

async function guardarConfig(cambios, opts = {}) {
  const ok = await escribir(opts.queHacia || "la configuración",
    () => setDoc(refs.config, cambios, { merge: true }), opts.boton);
  if (ok) Object.assign(S.config, cambios);
  return ok;
}

async function guardarDia(fecha, cambios, opts = {}) {
  const ok = await escribir(opts.queHacia || "el día",
    () => setDoc(refs.dia(fecha), { ...cambios, fecha }, { merge: true }), opts.boton);
  if (ok) {
    const previo = S.dias.get(fecha) || {};
    S.dias.set(fecha, { ...previo, ...cambios, fecha });
  }
  return ok;
}

/* ==========================================================================
   REGLAS DE NEGOCIO — estado del día
   Piso: nada anterior a fechaInicio cuenta ni se pinta.
   Las sesiones de prueba (esPrueba) no existen para ningún cálculo.
   ========================================================================== */
function pisoFecha() { return S.config?.fechaInicio || FECHA_INICIO_APP; }

/* Registro "real" de un día: ignora sesiones de prueba */
function regReal(iso) {
  const d = S.dias.get(iso);
  return d && !d.esPrueba ? d : null;
}

function esFeriado(iso) {
  return typeof FERIADOS !== "undefined" && FERIADOS.includes(iso);
}
function planDelDia(iso) {
  if (esFeriado(iso)) return { tipo: "descanso", feriado: true };
  const p = SEMANA[diaSemanaDe(iso)];
  return p ? { ...p } : { tipo: "descanso" };
}

/* REGLA DE ORO: si hay foto, hora de inicio, alguna serie marcada o alguna
   vuelta contada, ese día se entrenó. No importa si nunca se tocó "Terminar":
   un día con evidencia JAMÁS puede leerse como fallado. */
function tieneEvidencia(reg) {
  if (!reg) return false;
  if (reg.tieneFoto || reg.inicio) return true;
  if (reg.series && Object.values(reg.series)
    .some((ss) => (ss || []).some((x) => x?.hecha))) return true;
  if (reg.vueltas && reg.vueltas.some((v) => (v || 0) > 0)) return true;
  return false;
}

function estadoDia(iso) {
  if (iso < pisoFecha()) return "previo";      // antes de usar la app: gris neutro
  const reg = regReal(iso);
  const plan = planDelDia(iso);
  const hoy = hoyISO();

  if (reg) {
    if (reg.estado === "hecha") return "hecha";
    if (reg.estado === "recuperada") return "recuperada";
    if (reg.estado === "causa-mayor") return "causa-mayor";
  }
  if (plan.tipo === "descanso" && !tieneEvidencia(reg)) {
    return (reg && reg.caminata && reg.caminata.minutos) ? "descanso-caminata" : "descanso";
  }
  // Entrenó pero el registro quedó a medias (datos viejos, o sesión sin cerrar
  // de una versión anterior). Cuenta como hecho y se puede completar después.
  if (tieneEvidencia(reg)) return "a-medias";
  if (iso < hoy) return "fallada";             // el rojo, solo con el día terminado
  return "pendiente";
}

/* "a-medias" cuenta como sesión: hay evidencia de que entrenó. */
function sesionRegistrada(iso) {
  const e = estadoDia(iso);
  return e === "hecha" || e === "recuperada" || e === "a-medias";
}

/* ==========================================================================
   REGLAS DE NEGOCIO — semanas, racha, rangos
   ========================================================================== */
function resumenSemana(lunes) {
  const dias = [];
  for (let i = 0; i < 7; i++) dias.push(sumarDias(lunes, i));

  let sesiones = 0, recuperadas = 0, caminatas = 0, causaEscudo = false;
  const faltantes = [];
  for (const f of dias) {
    const e = estadoDia(f);
    const plan = planDelDia(f);
    if (e === "hecha" || e === "a-medias") sesiones++;
    else if (e === "recuperada") { sesiones++; recuperadas++; }
    else if (e === "descanso-caminata") caminatas++;
    if (e === "causa-mayor" && regReal(f)?.causaMayor?.conEscudo) causaEscudo = true;
    if (plan.tipo === "entreno" && f >= pisoFecha() && !sesionRegistrada(f)) faltantes.push(f);
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

function calcularRacha() {
  const inicio = lunesDe(pisoFecha());
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
function rangoIndice(racha) { return RANGOS.indexOf(rangoDe(racha)); }
function rangoSiFalla(racha) { return rangoDe(Math.max(0, racha - 1)); }
function mesDeSemana(lunes) { return domingoDe(lunes).slice(0, 7); }
function escudoDisponible(mes) {
  return !(S.config?.escudos && S.config.escudos[mes]);
}

function pendientesDeRecuperar() {
  const lunes = lunesDe(hoyISO());
  const hoy = hoyISO();
  const usadas = resumenSemana(lunes).recuperadas;
  if (usadas >= CONFIG.maxRecuperacionesPorSemana) return [];
  const out = [];
  for (let i = 0; i < 7; i++) {
    const f = sumarDias(lunes, i);
    if (f >= hoy) break;
    if (f < pisoFecha()) continue;
    const plan = planDelDia(f);
    if (plan.tipo === "entreno" && !sesionRegistrada(f) && estadoDia(f) !== "causa-mayor") {
      out.push({ fecha: f, rutinaId: plan.rutina });
    }
  }
  return out;
}

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
              reiniciar = true;
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

        if (!yaAvisada) {
          const rangoAntes = rangoDe(rachaPrevia).nombre;
          const rangoAhora = rangoDe(r.rachaAlCierre).nombre;
          if (rangoAhora !== rangoAntes) {
            if (r.rachaAlCierre > rachaPrevia) {
              momentoRango(rangoAhora, r.rachaAlCierre);
            } else {
              toast(sargento("bajoRango", { rango: rangoAhora }), "toast-alerta", 7000);
            }
          }
          if (r.mencionHonor) toast(sargento("mencionHonor"), "toast-record", 6000);
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

function preguntarEscudo(r) {
  return new Promise((resolver) => {
    abrirHoja(`
      <h3>Semana incompleta</h3>
      <p class="texto-2">La semana del ${fmtFechaCorta(r.lunes)} cerró con ${r.sesiones} de
      ${CONFIG.sesionesPorSemana} sesiones. Tenés un escudo disponible este mes:
      congela la racha (no baja, pero tampoco sube).</p>
      <div class="hoja-acciones">
        <button id="esc-si" class="btn btn-primario btn-grande">Usar el escudo</button>
        <button id="esc-no" class="btn btn-borde btn-grande">No usarlo (la racha baja 1)</button>
      </div>`, { onCerrar: () => resolver(false) });
    $("#esc-si").onclick = () => { cerrarHoja(true); resolver(true); };
    $("#esc-no").onclick = () => { cerrarHoja(true); resolver(false); };
  });
}

/* ==========================================================================
   NAVEGACIÓN — vistas con transición y tabbar
   ========================================================================== */
const VISTAS = ["login", "carga", "inicio", "calendario", "progreso", "ajustes", "entreno"];
let vistaActual = "carga";

function mostrarVista(nombre) {
  vistaActual = nombre;
  for (const v of VISTAS) $(`#vista-${v}`)?.classList.toggle("oculta", v !== nombre);
  actualizarTabbar();
  refrescarVistaActual();
  window.scrollTo(0, 0);
}

/* Cambio animado entre secciones: la saliente sube y se apaga,
   la entrante llega desde abajo, escalonadas 60 ms */
function irA(nombre, directo) {
  if (nombre === vistaActual) return;
  const saliente = $(`#vista-${vistaActual}`);
  if (directo || movReducido() || !saliente || saliente.classList.contains("oculta")) {
    mostrarVista(nombre);
    if (!movReducido()) animarEntrada(nombre);
    return;
  }
  saliente.classList.add("sale");
  setTimeout(() => {
    saliente.classList.remove("sale");
    mostrarVista(nombre);
    animarEntrada(nombre);
  }, 200);
}
function animarEntrada(nombre) {
  const entrante = $(`#vista-${nombre}`);
  if (!entrante) return;
  entrante.classList.add("entra");
  setTimeout(() => entrante.classList.remove("entra"), 500);
}

function actualizarTabbar() {
  const bar = $("#tabbar");
  const sinBarra = ["login", "carga", "entreno"].includes(vistaActual);
  bar.classList.toggle("oculta", vistaActual === "login" || vistaActual === "carga");
  bar.classList.toggle("escondida", sinBarra);
  $$(".tab").forEach((t) => t.classList.toggle("activo", t.dataset.tab === vistaActual));
}

function refrescarVistaActual() {
  if (!S.cargado && !["login", "carga"].includes(vistaActual)) return;
  if (vistaActual === "inicio") renderInicio();
  else if (vistaActual === "calendario") renderCalendario();
  else if (vistaActual === "progreso") renderProgreso();
  else if (vistaActual === "ajustes") renderAjustes();
  else if (vistaActual === "entreno" && S.sesion) renderPasoSesion();
}

/* Encabezado que se contrae al hacer scroll (como Ajustes de iOS) */
window.addEventListener("scroll", () => {
  const mini = $("#inicio-mini");
  if (!mini || vistaActual !== "inicio") return;
  mini.classList.toggle("compacta", window.scrollY > 48);
}, { passive: true });

/* ==========================================================================
   HOJA MODAL — sube desde abajo, se cierra arrastrando, escala el fondo
   ========================================================================== */
/* Pila de manejadores: cada hoja guarda el suyo. Antes era una sola variable
   global, así que abrir una hoja encima de otra se tragaba el manejador de la
   de abajo y podía dejar una promesa sin resolver para siempre (eso colgaba el
   arranque cuando aparecía el diálogo del escudo).

   Visualmente las hojas se reemplazan, no se apilan: no hay dos hojas a la vez.
   Por eso al abrir una nueva se cierra la anterior EN ORDEN, corriendo su
   manejador. Así ninguna queda esperando una respuesta que no va a llegar. */
const pilaHojas = [];
let hojaAbierta = false;

function correrManejador(entrada) {
  if (!entrada?.onCerrar) return;
  try { entrada.onCerrar(); } catch (e) { console.error("manejador de hoja:", e); }
}

function abrirHoja(html, opts = {}) {
  const hoja = $("#hoja");
  while (pilaHojas.length) correrManejador(pilaHojas.pop());
  $("#hoja-contenido").innerHTML = html;
  pilaHojas.push({ onCerrar: opts.onCerrar || null });
  hoja.classList.remove("oculta");
  $("#velo").classList.remove("oculta");
  hoja.scrollTop = 0;

  // Expansión desde una tarjeta: el mismo elemento creciendo (FLIP aproximado)
  if (opts.desde && !movReducido()) {
    const r = opts.desde.getBoundingClientRect();
    const alto = Math.min(window.innerHeight * 0.9, hoja.scrollHeight + 60);
    const escX = r.width / window.innerWidth;
    const escY = Math.max(0.15, r.height / alto);
    hoja.style.transition = "none";
    hoja.style.transformOrigin = `${r.left + r.width / 2}px bottom`;
    hoja.style.transform = `translateY(${-(window.innerHeight - r.bottom)}px) scale(${escX.toFixed(3)}, ${escY.toFixed(3)})`;
    hoja.style.opacity = "0.4";
    requestAnimationFrame(() => requestAnimationFrame(() => {
      hoja.style.transition = "";
      hoja.style.transform = "";
      hoja.style.opacity = "";
      hoja.classList.add("visible");
    }));
  } else {
    requestAnimationFrame(() => hoja.classList.add("visible"));
  }
  requestAnimationFrame(() => $("#velo").classList.add("visible"));
  $("#lienzo").classList.add("atras");
  hojaAbierta = true;
}

function cerrarHoja(silencioso) {
  const hoja = $("#hoja");
  hoja.classList.remove("visible");
  $("#velo").classList.remove("visible");
  $("#lienzo").classList.remove("atras");
  hojaAbierta = false;
  const entrada = pilaHojas.pop() || null;
  setTimeout(() => {
    if (!hojaAbierta) { hoja.classList.add("oculta"); $("#velo").classList.add("oculta"); }
  }, movReducido() ? 0 : 300);
  if (!silencioso) correrManejador(entrada);
}
$("#velo").addEventListener("click", () => cerrarHoja());

/* Arrastre para cerrar, siguiendo el dedo, con resistencia hacia arriba */
(function () {
  const hoja = $("#hoja");
  const tirador = $("#hoja-tirador");
  let y0 = 0, dy = 0, arrastrando = false;

  tirador.addEventListener("pointerdown", (e) => {
    arrastrando = true; y0 = e.clientY; dy = 0;
    hoja.classList.add("arrastrando");
    tirador.setPointerCapture(e.pointerId);
  });
  tirador.addEventListener("pointermove", (e) => {
    if (!arrastrando) return;
    dy = e.clientY - y0;
    const v = dy >= 0 ? dy : -Math.pow(-dy, 0.7);   // resistencia elástica arriba
    hoja.style.transform = `translateY(${v}px)`;
  });
  const soltar = () => {
    if (!arrastrando) return;
    arrastrando = false;
    hoja.classList.remove("arrastrando");
    hoja.style.transform = "";
    if (dy > Math.min(160, hoja.clientHeight / 2)) cerrarHoja();
  };
  tirador.addEventListener("pointerup", soltar);
  tirador.addEventListener("pointercancel", soltar);
})();

/* ==========================================================================
   BANNER DE RÉCORD — baja, se queda 2 segundos y se va sola
   ========================================================================== */
let bannerTimer = null;
function bannerRecord(texto) {
  const b = $("#banner");
  b.textContent = texto;
  b.classList.remove("oculta");
  requestAnimationFrame(() => b.classList.add("visible"));
  vibrar("confirmar");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    b.classList.remove("visible");
    setTimeout(() => b.classList.add("oculta"), 400);
  }, 2000);
}

/* ==========================================================================
   MOMENTOS — pantalla completa, contención, sin papelitos
   ========================================================================== */
function abrirMomento(html) {
  const m = $("#momento");
  m.innerHTML = html;
  m.classList.remove("oculta");
  requestAnimationFrame(() => m.classList.add("visible"));
}
function cerrarMomento() {
  const m = $("#momento");
  m.classList.remove("visible");
  setTimeout(() => { m.classList.add("oculta"); m.innerHTML = ""; }, movReducido() ? 0 : 400);
}

/* Galón grande para animar trazo a trazo (de abajo hacia arriba) */
const GALON_TRAZO = `<svg class="galon-anim" viewBox="0 0 120 100">
  <path d="M10 62 60 22l50 40M10 88 60 48l50 40" pathLength="400"/></svg>`;

/* Subida de rango: el momento más importante de la app */
function momentoRango(nombre, racha) {
  const letras = nombre.split("").map((l, i) =>
    `<span class="letra" style="animation-delay:${i * 40}ms">${l === " " ? "&nbsp;" : esc(l)}</span>`).join("");
  abrirMomento(`
    ${GALON_TRAZO}
    <div class="etiqueta" style="color:#98989D">Nuevo rango</div>
    <div class="momento-titulo">${letras}</div>
    <p class="momento-detalle">${esc(sargento("subioRango", { rango: nombre, racha: String(racha) }))}</p>
    <button id="momento-ok" class="btn btn-primario btn-grande">Firme</button>`);
  vibrar("celebrar");
  $("#momento-ok").onclick = cerrarMomento;
}

/* Fin de sesión: galón dibujándose + volumen contando + comparación */
function momentoCierre({ vol, dur, comparacion, esPrueba, alCerrar }) {
  abrirMomento(`
    ${GALON_TRAZO}
    <div class="etiqueta" style="color:#98989D">Sesión terminada${esPrueba ? " · prueba" : ""}</div>
    ${vol ? `<div class="momento-cifra num" id="momento-vol" data-valor="0">0</div>
             <div class="dato" style="color:#98989D">kg movidos</div>` : ""}
    <p class="momento-detalle">${esc(fmtDuracion(dur))}${comparacion ? `<br>${esc(comparacion)}` : ""}</p>
    <button id="momento-ok" class="btn btn-primario btn-grande">Listo</button>`);
  vibrar("celebrar");
  if (vol) setTimeout(() => contarNumero($("#momento-vol"), vol), 400);
  $("#momento-ok").onclick = () => { cerrarMomento(); if (alCerrar) alCerrar(); };
}

/* Tarjeta élite: borde que reacciona apenas a la inclinación */
window.addEventListener("deviceorientation", (e) => {
  const elite = document.querySelector(".racha.r-elite");
  if (!elite || e.gamma == null) return;
  elite.style.setProperty("--tilt", `${Math.max(-14, Math.min(14, e.gamma / 3))}deg`);
}, { passive: true });

/* ==========================================================================
   DATOS DERIVADOS (siempre filtrando sesiones de prueba)
   ========================================================================== */
function volumenSesion(reg) {
  if (!reg) return 0;
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

function resumenCortoSesion(reg) {
  if (!reg) return "";
  const r = RUTINAS[reg.rutinaId];
  const partes = [];
  if (r) partes.push(r.nombre);
  if (reg.rutinaId === "musculacion" && reg.series) {
    const vol = volumenSesion(reg);
    if (vol) partes.push(`${fmtKg(vol)} kg movidos`);
  }
  if (reg.rutinaId === "intervalos" && reg.vueltas) {
    partes.push(`${reg.vueltas.reduce((a, b) => a + (b || 0), 0)} vueltas`);
  }
  if (reg.inicio && reg.fin) partes.push(fmtDuracion((reg.fin - reg.inicio) / 1000));
  return partes.join(" · ");
}

function laVezPasada(id) {
  const hoy = hoyISO();
  const fechas = [...S.dias.keys()].filter((f) => f < hoy && regReal(f)).sort().reverse();
  for (const f of fechas) {
    const s = regReal(f)?.series?.[id];
    if (s && s.length) {
      const hechas = s.filter((x) => x.hecha);
      const ult = hechas.length ? hechas[hechas.length - 1] : s[s.length - 1];
      return { peso: ult.peso, reps: ult.reps, fecha: f, esfuerzo: regReal(f)?.esfuerzo?.[id] };
    }
  }
  return null;
}

function maximosHistoricos() {
  const hoy = hoyISO();
  const max = {};
  for (const f of S.dias.keys()) {
    if (f >= hoy) continue;
    const reg = regReal(f);
    if (!reg?.series) continue;
    for (const [id, series] of Object.entries(reg.series))
      for (const x of series)
        if (x.hecha && (x.peso || 0) > (max[id] || 0)) max[id] = x.peso;
  }
  return max;
}

function ejercicioPorId(id) {
  for (const b of MUSCULACION.bloques)
    for (const e of b.ejercicios) if (e.id === id) return e;
  for (const e of INTERVALOS.circuito) if (e.id === id) return e;
  return null;
}
function nombreEjercicio(id) {
  const e = ejercicioPorId(id);
  return e ? e.nombre : id;
}

function sesionAnterior(rutinaId, antesDe) {
  const previas = [...S.dias.keys()]
    .filter((f) => f < antesDe && regReal(f)?.rutinaId === rutinaId && sesionRegistrada(f))
    .sort().reverse();
  return previas.length ? { fecha: previas[0], reg: regReal(previas[0]) } : null;
}

function comparacionConAnterior(fecha, reg) {
  const ant = sesionAnterior(reg.rutinaId, fecha);
  if (!ant) return "";
  const vol = volumenSesion(reg), volPrev = volumenSesion(ant.reg);
  if (!vol || !volPrev) return "";
  const dif = vol - volPrev;
  const dia = DIAS_NOMBRE[diaSemanaDe(ant.fecha)];
  return dif >= 0
    ? `Moviste ${fmtKg(vol)} kg, ${fmtKg(dif)} más que el ${dia}.`
    : `Moviste ${fmtKg(vol)} kg, ${fmtKg(-dif)} menos que el ${dia}.`;
}

/* ==========================================================================
   INICIO
   ========================================================================== */
function renderInicio() {
  if (!S.cargado) return;
  const hoy = hoyISO();
  const plan = planDelDia(hoy);
  const reg = regReal(hoy);
  const estado = estadoDia(hoy);
  const hora = horaAhora();
  const { racha, semanaActual } = calcularRacha();
  const pendientes = pendientesDeRecuperar();
  const rutinaHoy = plan.tipo === "entreno" ? RUTINAS[plan.rutina] : null;
  const entrenado = sesionRegistrada(hoy);
  const abierta = diaConSesionAbierta();
  const sesionAbierta = abierta?.fecha === hoy ? abierta : null;
  const sinFoto = entrenado && !reg?.tieneFoto;

  $("#inicio-fecha").textContent = fmtFechaLarga(hoy);
  $("#inicio-mini-titulo").textContent = fmtFechaLarga(hoy);

  /* --- Titular + frase del sargento --- */
  const titular = $("#inicio-titular");
  titular.style.color = "";
  const vars = {
    dia: DIAS_NOMBRE[diaSemanaDe(hoy)],
    rutina: rutinaHoy ? rutinaHoy.nombre : "",
    racha: String(racha),
    rango: rangoDe(racha).nombre,
    rangoAbajo: rangoSiFalla(racha).nombre,
    pendiente: pendientes.length ? RUTINAS[pendientes[0].rutinaId].nombre : "",
    resumen: reg ? resumenCortoSesion(reg) + "." : "",
  };

  let tTitular = "", tFrase = "";
  if (entrenado) {
    tTitular = "Ya entrenaste 💪";
    tFrase = sargento("yaEntreno", vars);
  } else if (estado === "causa-mayor") {
    tTitular = "Día cubierto";
    tFrase = `Causa mayor: ${reg?.causaMayor?.motivo || ""}.`;
  } else if (plan.tipo === "descanso") {
    tTitular = pendientes.length ? "Tenés una pendiente" : "Día de descanso";
    tFrase = pendientes.length ? sargento("pendienteRecuperar", vars)
      : (reg?.caminata?.minutos ? sargento("caminataRegistrada", vars) : sargento("descanso", vars));
  } else if (hora >= 20) {
    tTitular = "La racha está en juego";
    titular.style.color = "var(--rojo)";
    tFrase = racha > 0 ? sargento("rachaEnRiesgo", vars) : sargento("pasoTarde", vars);
  } else if (hora >= 12) {
    tTitular = `Todavía no fuiste`;
    tFrase = sargento("pasoMediodia", vars);
  } else {
    tTitular = `Hoy toca ${rutinaHoy.nombre}`;
    tFrase = sargento("aunNoEntreno", vars);
  }
  titular.textContent = tTitular;
  $("#inicio-frase").textContent = tFrase;

  /* --- Tarjeta de racha --- */
  renderRacha(racha, semanaActual);

  /* --- Tarjeta "Entreno hoy" --- */
  const tEntreno = $("#tarjeta-entreno");
  if (sesionAbierta) {
    tEntreno.innerHTML = `
      <div><div class="tarjeta-titulo">Entreno hoy</div>
      <div class="tarjeta-valor">En curso</div>
      <div class="tarjeta-nota">Ya cuenta. Tocá para continuar donde estabas.</div></div>
      <div class="tarjeta-estado">💪</div>`;
    tEntreno.onclick = () => retomarSesion(hoy);
  } else if (entrenado) {
    tEntreno.innerHTML = `
      <div><div class="tarjeta-titulo">Entreno hoy</div>
      <div class="tarjeta-valor">Completado</div>
      <div class="tarjeta-nota">${esc(resumenCortoSesion(reg))}${sinFoto ? " · falta la foto" : ""}</div></div>
      <div class="tarjeta-estado">${sinFoto ? "✳️" : "✅"}</div>`;
    tEntreno.onclick = () => abrirFicha(hoy, tEntreno);
  } else if (plan.tipo === "entreno" && estado !== "causa-mayor") {
    tEntreno.innerHTML = `
      <div><div class="tarjeta-titulo">Entreno hoy</div>
      <div class="tarjeta-valor">${esc(rutinaHoy.nombre)}</div>
      <div class="tarjeta-nota">Sacate la foto y ya cuenta</div></div>
      <span class="btn btn-rojo btn-medio" style="align-self:stretch;display:flex;align-items:center;justify-content:center">Registrar</span>`;
    tEntreno.onclick = () => abrirRegistroEntrenamiento();
  } else if (pendientes.length) {
    tEntreno.innerHTML = `
      <div><div class="tarjeta-titulo">Entreno hoy</div>
      <div class="tarjeta-valor">Recuperar ${esc(RUTINAS[pendientes[0].rutinaId].nombre)}</div>
      <div class="tarjeta-nota">Hasta el domingo estás a tiempo</div></div>
      <div class="tarjeta-estado">🔥</div>`;
    tEntreno.onclick = () => abrirRegistroEntrenamiento({
      rutinaId: pendientes[0].rutinaId, esRecuperacion: true, fechaOriginal: pendientes[0].fecha,
    });
  } else {
    tEntreno.innerHTML = `
      <div><div class="tarjeta-titulo">Entreno hoy</div>
      <div class="tarjeta-valor">${estado === "causa-mayor" ? "Causa mayor" : "Descanso"}</div>
      <div class="tarjeta-nota">${reg?.caminata?.minutos ? `Caminata: ${reg.caminata.minutos} min` : "¿Sumás una caminata?"}</div></div>
      ${reg?.caminata?.minutos ? `<div class="tarjeta-estado">✅</div>` : ""}`;
    tEntreno.onclick = () => hojaCaminata();
  }

  /* --- Tarjeta "Agua hoy" --- */
  const regHoy = S.dias.get(hoy);   // el agua vale aunque el día sea de prueba
  const ml = regHoy?.aguaMl || 0;
  const objetivo = S.config.aguaObjetivoMl || 2000;
  const cumplida = ml >= objetivo;
  const tAgua = $("#tarjeta-agua");
  tAgua.innerHTML = `
    <div><div class="tarjeta-titulo">Agua hoy</div>
    <div class="tarjeta-valor num">${fmtLitros(ml)} / ${fmtLitros(objetivo)} L</div>
    <div class="tarjeta-nota">${cumplida ? "Objetivo cumplido" : "Tocá para registrar"}</div></div>
    <div class="anillo ${cumplida ? "pulso" : ""}">${svgAnillo(ml / objetivo, { tilde: cumplida })}</div>`;
  tAgua.onclick = () => hojaAgua(tAgua);

  /* --- Tarjeta de peso --- */
  renderTarjetaPeso();

  /* --- "Hoy no llego" (día de entreno, sin sesión, sin causa mayor) --- */
  let noLlego = $("#btn-no-llego");
  if (plan.tipo === "entreno" && !entrenado && !sesionAbierta && estado !== "causa-mayor") {
    if (!noLlego) {
      noLlego = el("button", "btn btn-texto", "Hoy no llego →");
      noLlego.id = "btn-no-llego";
      noLlego.style.width = "100%";
      $("#tarjeta-peso").before(noLlego);
    }
    noLlego.onclick = () => hojaNoLlego();
  } else if (noLlego) noLlego.remove();

  /* --- Logros --- */
  renderLogros();
}

function renderRacha(racha, semanaActual) {
  const idx = rangoIndice(racha);
  const clase = idx >= 5 ? "r-elite" : idx >= 3 ? "r-negra" : "r-base";
  const rango = rangoDe(racha);
  const proximas = proximasSesiones(semanaActual);
  const hoy = hoyISO();
  const hora = horaAhora();
  const dow = diaSemanaDe(hoy);

  const galones = Array.from({ length: CONFIG.sesionesPorSemana }, (_, i) =>
    svgGalon(i < semanaActual.sesiones ? (clase === "r-elite" && i === semanaActual.sesiones - 1 ? "rojo" : "lleno") : "vacio")).join("");

  let falta = "";
  if (!semanaActual.completa && proximas.length) {
    falta = `<div class="racha-falta">Falta: ${proximas.map((p) =>
      `${DIAS_NOMBRE[diaSemanaDe(p.fecha)]} (${RUTINAS[p.rutinaId].nombre})`).join(", ")}</div>`;
  }
  let alerta = "";
  const posibles = posiblesHastaDomingo();
  if (!semanaActual.completa && racha > 0 &&
      semanaActual.sesiones + posibles < CONFIG.sesionesPorSemana) {
    alerta = `<div class="racha-alerta">Semana perdida salvo escudo: bajás a ${rangoSiFalla(racha).nombre}</div>`;
  } else if (!semanaActual.completa && racha > 0 && (dow === 0 || dow >= 5 || hora >= 20)) {
    alerta = `<div class="racha-alerta">Si fallás bajás a ${rangoSiFalla(racha).nombre}</div>`;
  } else if (semanaActual.escudo) {
    alerta = `<div class="racha-congelada">Semana con escudo: racha congelada</div>`;
  }

  $("#racha-tarjeta").innerHTML = `
    <div class="racha ${clase}">
      ${svgGalon(clase === "r-elite" ? "rojo" : "lleno", "racha-galon-grande")}
      <div class="racha-rango">${esc(rango.nombre)}</div>
      <div class="racha-num num">${racha} <small>${racha === 1 ? "semana seguida" : "semanas seguidas"}</small></div>
      <div class="racha-galones">${galones}</div>
      <div class="racha-semana num">${semanaActual.sesiones} de ${CONFIG.sesionesPorSemana} esta semana</div>
      ${falta}${alerta}
    </div>`;
}

function renderTarjetaPeso() {
  const t = $("#tarjeta-peso");
  const lista = pesajesOrdenados();
  const objetivo = S.config.pesoObjetivo;
  const ultimo = lista[lista.length - 1];
  const tendencia = lista.length ? tendenciaEn(lista, lista.length - 1) : null;

  if (!lista.length) {
    t.innerHTML = `
      <div class="tarjeta-titulo">Peso</div>
      <div class="tarjeta-nota">Pesate el lunes y empezamos a medir. Tocá para registrar el primero.</div>`;
    t.onclick = () => hojaPesaje();
    return;
  }
  let resumen = "";
  if (objetivo && tendencia) {
    const dif = tendencia - objetivo;
    if (dif > 0.05) resumen = `faltan ${dif.toFixed(1).replace(".", ",")}`;
    else if (dif < -0.05) resumen = `objetivo superado por ${(-dif).toFixed(1).replace(".", ",")}`;
    else resumen = "en el objetivo";
    const delta = lista[0].pesoKg - ultimo.pesoKg;
    if (delta > 0.05) resumen = `Bajaste ${delta.toFixed(1).replace(".", ",")} kg · ${resumen}`;
    else if (delta < -0.05) resumen = `Subiste ${(-delta).toFixed(1).replace(".", ",")} kg · ${resumen}`;
    else resumen = `Mismo peso que al inicio · ${resumen}`;
  }
  t.innerHTML = `
    <div class="peso-fila"><span class="dato">Peso</span>
      <span class="num-grande" style="font-size:22px">${ultimo.pesoKg.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg</span></div>
    <div class="peso-fila"><span class="dato">Objetivo</span>
      <span>${objetivo ? `<b class="num">${objetivo.toLocaleString("es-AR")} kg</b>` : "sin definir"} <span class="lapiz" role="button" aria-label="Editar objetivo">✏️</span></span></div>
    ${resumen ? `<div class="tarjeta-nota num">${resumen}</div>` : ""}`;
  t.onclick = (ev) => {
    if (ev.target.closest(".lapiz")) hojaObjetivoPeso();
    else irA("progreso");
  };
}

function hojaObjetivoPeso() {
  abrirHoja(`
    <h3>Peso objetivo</h3>
    <div class="campo"><label>Kilos</label>
      <input id="obj-kg" type="number" inputmode="decimal" step="0.5" value="${S.config.pesoObjetivo ?? ""}"></div>
    <div class="hoja-acciones">
      <button id="obj-guardar" class="btn btn-primario btn-grande">Guardar</button>
    </div>`);
  $("#obj-guardar").onclick = async () => {
    const v = $("#obj-kg").value ? Number($("#obj-kg").value) : null;
    await guardarConfig({ pesoObjetivo: v });
    cerrarHoja(true);
    refrescarVistaActual();
  };
}

function renderLogros() {
  const zona = $("#logros-zona");
  const { cerradas } = calcularRacha();
  const menciones = cerradas.filter((s) => s.mencionHonor).length;
  let perfectos = 0, hierros = 0, corrida = 0, corridaLimpia = 0;
  for (const s of cerradas) {
    if (s.completa) {
      corrida++;
      corridaLimpia = (s.recuperadas === 0 && !s.escudo) ? corridaLimpia + 1 : 0;
      if (corrida % 4 === 0) { perfectos++; if (corridaLimpia >= 4) hierros++; }
    } else { corrida = 0; corridaLimpia = 0; }
  }
  const chips = [];
  if (menciones) chips.push(`🔥 Mención de honor × ${menciones}`);
  if (perfectos) chips.push(`Mes perfecto × ${perfectos}`);
  if (hierros) chips.push(`Mes de hierro × ${hierros}`);
  zona.innerHTML = chips.length
    ? `<div class="etiqueta">Logros</div><div class="logros-fila">${chips.map((c) => `<span class="logro">${c}</span>`).join("")}</div>`
    : "";
}

function proximasSesiones(semanaActual) {
  const hoy = hoyISO();
  const out = [];
  for (let i = 0; i < 7; i++) {
    const f = sumarDias(semanaActual.lunes, i);
    if (f < hoy) continue;
    const plan = planDelDia(f);
    if (plan.tipo === "entreno" && !sesionRegistrada(f)) out.push({ fecha: f, rutinaId: plan.rutina });
  }
  for (const p of pendientesDeRecuperar()) {
    if (!out.find((x) => x.rutinaId === p.rutinaId && x.fecha === p.fecha)) out.push(p);
  }
  return out.slice(0, CONFIG.sesionesPorSemana);
}
function posiblesHastaDomingo() {
  const hoy = hoyISO();
  const domingo = domingoDe(hoy);
  let normales = 0;
  for (let f = hoy; f <= domingo; f = sumarDias(f, 1)) {
    const plan = planDelDia(f);
    if (plan.tipo === "entreno" && !sesionRegistrada(f)) normales++;
  }
  return normales + (pendientesDeRecuperar().length ? 1 : 0);
}

/* ==========================================================================
   HOJA DE ACCIÓN DEL + (se adapta al día)
   ========================================================================== */
function hojaMas() {
  const hoy = hoyISO();
  const plan = planDelDia(hoy);
  const entrenado = sesionRegistrada(hoy);
  const pendientes = pendientesDeRecuperar();
  const abierta = diaConSesionAbierta();
  const items = [];

  const esDescanso = plan.tipo === "descanso";
  const caminata = { id: "mas-caminata", titulo: "Registrar caminata", dato: esDescanso ? "Suma para la mención de honor" : "" };
  if (esDescanso) items.push(caminata);

  if (abierta) {
    items.push({
      id: "mas-continuar", titulo: "Continuar entrenamiento",
      dato: abierta.fecha === hoy ? "Retoma donde estabas" : `Quedó abierto el ${fmtFechaCorta(abierta.fecha)}`,
    });
  } else if (!entrenado && plan.tipo === "entreno") {
    items.push({ id: "mas-entrenar", titulo: "Registrar entrenamiento con foto", dato: RUTINAS[plan.rutina].nombre });
  } else if (!entrenado && pendientes.length) {
    items.push({ id: "mas-recuperar", titulo: `Recuperar ${RUTINAS[pendientes[0].rutinaId].nombre}`, dato: "Hasta el domingo" });
  } else if (!entrenado) {
    items.push({ id: "mas-entrenar", titulo: "Registrar entrenamiento con foto", dato: "Hoy tocaba descanso" });
  } else {
    // Ya entrenó y quiere entrenar igual: adelantar la sesión de mañana.
    items.push({ id: "mas-igual", titulo: "Entrenar igual", dato: "Se suma al día de hoy" });
  }
  if (entrenado && !S.dias.get(hoy)?.tieneFoto) {
    items.push({ id: "mas-foto", titulo: "Agregar la foto de hoy", dato: "El día quedó sin foto" });
  }

  items.push({ id: "mas-agua", titulo: "Registrar agua" });
  if (!esDescanso) items.push(caminata);
  items.push({ id: "mas-peso", titulo: "Registrar peso" });

  abrirHoja(`
    <h3>Registrar</h3>
    <div class="accion-lista">
      ${items.map((i) => `<button class="accion-item" id="${i.id}">
        <span>${esc(i.titulo)}${i.dato ? `<span class="dato">${esc(i.dato)}</span>` : ""}</span></button>`).join("")}
    </div>`);

  const on = (id, fn) => { const b = $(`#${id}`); if (b) b.onclick = () => { cerrarHoja(true); fn(); }; };
  on("mas-entrenar", () => abrirRegistroEntrenamiento());
  on("mas-continuar", () => abrirRegistroEntrenamiento());
  on("mas-igual", () => abrirRegistroEntrenamiento({ forzarNueva: true }));
  on("mas-foto", () => hojaAgregarFoto(hoy));
  on("mas-recuperar", () => abrirRegistroEntrenamiento({
    rutinaId: pendientes[0].rutinaId, esRecuperacion: true, fechaOriginal: pendientes[0].fecha,
  }));
  on("mas-agua", () => hojaAgua());
  on("mas-caminata", () => hojaCaminata());
  on("mas-peso", () => hojaPesaje());
}

/* ==========================================================================
   AGUA — anillo, registros del día, números que cuentan
   ========================================================================== */
function hojaAgua(desde) {
  const hoy = hoyISO();
  const pintar = (primera) => {
    const reg = S.dias.get(hoy);
    const ml = reg?.aguaMl || 0;
    const objetivo = S.config.aguaObjetivoMl || 2000;
    const registros = reg?.aguaRegistros || [];
    const cumplida = ml >= objetivo;
    const html = `
      <h3>Agua de hoy</h3>
      <div class="agua-detalle">
        <div class="anillo ${cumplida ? "pulso" : ""}">${svgAnillo(ml / objetivo, { tilde: cumplida })}</div>
        <div class="agua-cifra num" id="agua-cifra" data-valor="${ml}">${ml.toLocaleString("es-AR")}</div>
        <small class="texto-2">de ${objetivo.toLocaleString("es-AR")} ml</small>
      </div>
      <div class="agua-botones">
        <button id="agua-botella" class="btn btn-primario btn-grande">+ Botella (${S.config.botellaMl} ml)</button>
        <button id="agua-vaso" class="btn btn-borde btn-grande">+ Vaso (${S.config.vasoMl} ml)</button>
      </div>
      <button id="agua-menos" class="btn btn-texto" style="width:100%">Corregir (−${S.config.vasoMl} ml)</button>
      ${registros.length ? `<ul class="agua-registros">
        ${registros.slice().reverse().map((r) => `<li><b class="num">${r.ml > 0 ? "+" : ""}${r.ml} ml</b><span>${fmtHora(r.hora)}</span></li>`).join("")}
      </ul>` : ""}`;
    if (primera) abrirHoja(html, { desde });
    else $("#hoja-contenido").innerHTML = html;
    $("#agua-botella").onclick = () => sumar(S.config.botellaMl);
    $("#agua-vaso").onclick = () => sumar(S.config.vasoMl);
    $("#agua-menos").onclick = () => sumar(-S.config.vasoMl);
  };
  const sumar = async (delta) => {
    const reg = S.dias.get(hoy);
    const previo = reg?.aguaMl || 0;
    const nuevo = Math.max(0, previo + delta);
    const objetivo = S.config.aguaObjetivoMl || 2000;
    const registros = [...(reg?.aguaRegistros || []), { ml: delta, hora: Date.now() }];
    vibrar(previo < objetivo && nuevo >= objetivo ? "confirmar" : "leve");
    await guardarDia(hoy, { aguaMl: nuevo, aguaRegistros: registros, tipo: reg?.tipo || planDelDia(hoy).tipo });
    pintar(false);
    const cifra = $("#agua-cifra");
    if (cifra) { cifra.dataset.valor = String(previo); contarNumero(cifra, nuevo); }
    if (vistaActual === "inicio") renderInicio();
  };
  pintar(true);
}

/* ==========================================================================
   CAMINATA / HOY NO LLEGO / CAUSA MAYOR
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
    await guardarDia(f, { tipo: "descanso", caminata: { minutos, nota: $("#cam-nota").value.trim() } });
    cerrarHoja(true);
    vibrar("confirmar");
    toast(sargento("caminataRegistrada"));
    refrescarVistaActual();
  };
}

function hojaNoLlego() {
  const hoy = hoyISO();
  const hayEscudo = escudoDisponible(hoy.slice(0, 7));
  abrirHoja(`
    <h3>Hoy no llego</h3>
    <p class="texto-2">La recuperás otro día de esta semana (hasta el domingo),
    o la marcás como causa mayor con motivo.</p>
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
      <span>Usar el escudo del mes<small>Congela la racha si la semana queda incompleta</small></span>
      <span class="interruptor"><input id="cm-escudo" type="checkbox"><i></i></span>
    </div>` : `<p class="texto-2">No te queda escudo este mes.</p>`}
    <div class="hoja-acciones">
      <button id="cm-guardar" class="btn btn-primario btn-grande">Marcar causa mayor</button>
    </div>`);
  $("#cm-guardar").onclick = async () => {
    const motivo = $("#cm-motivo").value.trim();
    if (!motivo) { $("#cm-motivo").focus(); return; }
    const conEscudo = hayEscudo && $("#cm-escudo")?.checked;
    await guardarDia(fecha, {
      tipo: "entreno", rutinaId: planDelDia(fecha).rutina || null,
      rutinasVersion: RUTINAS_VERSION, estado: "causa-mayor", esPrueba: false,
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
   AUDIO — campana (se desbloquea con el primer gesto)
   ========================================================================== */
const campana = new Audio("campana.mp3");
campana.preload = "auto";

function desbloquearAudio() {
  if (S.audioListo) return;
  campana.muted = true;
  const p = campana.play();
  if (p) p.then(() => {
    campana.pause(); campana.currentTime = 0; campana.muted = false;
    S.audioListo = true;
  }).catch(() => { campana.muted = false; });
}
function sonarCampana() {
  try { campana.currentTime = 0; campana.play().catch(() => { }); } catch (_) { }
  vibrar("confirmar");
}

/* ==========================================================================
   WAKE LOCK
   ========================================================================== */
async function pedirWakeLock() {
  try {
    if ("wakeLock" in navigator) S.wakeLock = await navigator.wakeLock.request("screen");
  } catch (_) { }
}
function soltarWakeLock() {
  if (S.wakeLock) { S.wakeLock.release().catch(() => { }); S.wakeLock = null; }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    if (S.sesion) pedirWakeLock();
    tickTimers(true);
    if (S.cargado && vistaActual === "inicio") renderInicio();
  }
});

/* ==========================================================================
   TEMPORIZADORES — contra Date.now(), con anillo que se vacía
   ========================================================================== */
let timerInterval = null;
const CIRC = 2 * Math.PI * 45;

function arrancarTickeo() {
  if (!timerInterval) timerInterval = setInterval(() => tickTimers(false), 300);
}
function frenarTickeo() { clearInterval(timerInterval); timerInterval = null; }

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
      guardarSesion();
    }
    const nodo = $(`#t-${clave}`);
    if (nodo) {
      const num = nodo.querySelector(".timer-num, .t-num");
      if (num) num.textContent = fmtCrono(resta);
      const circ = nodo.querySelector("circle.valor");
      if (circ) circ.style.strokeDashoffset = (CIRC * Math.min(1, Math.max(0, 1 - resta / t.dur))).toFixed(1);
      nodo.classList.toggle("fin", resta <= 0);
      nodo.classList.toggle("late", resta > 0 && resta <= 3);
    }
    if (clave === "descanso" && resta <= -30) { s.descanso = null; guardarSesion(); renderPasoSesion(); }
  }
  const reloj = $("#entreno-reloj");
  if (reloj && s.inicio) reloj.textContent = fmtCrono((ahora - s.inicio) / 1000);
}

function ponerTimer(seg, etiqueta) {
  const dur = durT(seg);
  S.sesion.timer = { fin: Date.now() + dur * 1000, dur, etiqueta, sono: false };
  guardarSesion();
  renderPasoSesion();
}
function ponerDescanso() {
  const dur = durT(S.config.descansoSeg || 90);
  S.sesion.descanso = { fin: Date.now() + dur * 1000, dur, sono: false };
  guardarSesion();
}

/* ==========================================================================
   SESIÓN — armado, persistencia, reanudación
   ========================================================================== */
/* La sesión en curso vive en FIRESTORE, dentro del documento del día, para que
   se pueda retomar desde cualquier dispositivo y en cualquier momento.
   localStorage queda solo como caché de arranque rápido. */
function limpiarSesionLocal() { localStorage.removeItem("sesionActiva"); }

/* Lo que se persiste de la sesión. `cola` y `prMax` no van: se regeneran. */
function sesionParaGuardar(s) {
  return {
    abierta: true, rutinaId: s.rutinaId, fecha: s.fecha,
    esRecuperacion: !!s.esRecuperacion, fechaOriginal: s.fechaOriginal || null,
    esPrueba: !!s.esPrueba, inicio: s.inicio, paso: s.paso,
    calorHecho: s.calorHecho || {}, pesoActual: s.pesoActual || {},
    repsActual: s.repsActual || {}, tocada: Date.now(),
  };
}

/* Autoguardado: cada cambio del estado de la sesión, no solo al marcar serie.
   Se agrupa a 1,2 s para no escribir en cada toque del botón de peso. */
let guardarSesionTimer = null;
function guardarSesion({ yaMismo = false } = {}) {
  try {
    if (S.sesion) localStorage.setItem("sesionActiva", JSON.stringify(S.sesion));
    else localStorage.removeItem("sesionActiva");
  } catch (_) { }
  if (!S.sesion || !refs) return;
  clearTimeout(guardarSesionTimer);
  const escribirla = () => {
    if (!S.sesion) return;
    guardarDia(S.sesion.fecha, { sesion: sesionParaGuardar(S.sesion) },
      { queHacia: "el avance del entrenamiento" });
  };
  if (yaMismo) escribirla();
  else guardarSesionTimer = setTimeout(escribirla, 1200);
}

/* Cualquier día con una sesión abierta, sin importar la fecha. */
function diaConSesionAbierta() {
  for (const [fecha, reg] of S.dias) {
    if (reg?.sesion?.abierta) return { fecha, reg };
  }
  return null;
}

/* Rehidrata una sesión guardada en Firestore a la forma que usa la app. */
function sesionDesdeRegistro(fecha, reg) {
  const g = reg.sesion;
  return {
    fecha, rutinaId: g.rutinaId,
    esRecuperacion: !!g.esRecuperacion, fechaOriginal: g.fechaOriginal || null,
    esPrueba: !!g.esPrueba, inicio: g.inicio, paso: g.paso || 0,
    cola: armarCola(g.rutinaId),
    calorHecho: g.calorHecho || {}, pesoActual: g.pesoActual || {},
    repsActual: g.repsActual || {},
    vueltas: reg.vueltas || (g.rutinaId === "intervalos" ? [0, 0, 0, 0] : null),
    timer: null, descanso: null,
    prMax: maximosHistoricos(),
  };
}

function armarCola(rutinaId) {
  if (rutinaId === "musculacion") {
    const cola = [{ t: "calor" }];
    for (const b of MUSCULACION.bloques)
      for (const e of b.ejercicios) cola.push({ t: "ej", id: e.id });
    cola.push({ t: "cinta-cierre" }, { t: "parte" });
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

/* ==========================================================================
   REGISTRAR ENTRENAMIENTO CON FOTO — la única puerta de entrada
   --------------------------------------------------------------------------
   Todos los caminos (tarjeta del inicio, botón +, recuperar una pendiente,
   entrenar en un día de descanso) pasan por acá. La foto es la prueba de que
   llegó al gimnasio, así que va ANTES de entrenar, no después.
   ========================================================================== */
/* Una línea que describe la rutina, armada de rutinas.js para no duplicar datos. */
function resumenRutina(rutinaId) {
  if (rutinaId === "intervalos") {
    return `${INTERVALOS.vueltas} vueltas · cinta y circuito`;
  }
  const n = MUSCULACION.bloques.reduce((a, b) => a + b.ejercicios.length, 0);
  return `${n} ejercicios · entrada en calor y cierre`;
}

function abrirRegistroEntrenamiento(opts = {}) {
  const hoy = hoyISO();

  // Si ya hay una sesión abierta, se retoma. Nunca se pide otra foto ni se
  // empieza una segunda sesión encima.
  const abierta = diaConSesionAbierta();
  if (abierta && !opts.forzarNueva) {
    if (abierta.fecha === hoy) { retomarSesion(abierta.fecha); return; }
    hojaSesionDeOtroDia(abierta.fecha);
    return;
  }

  const fecha = opts.fecha || hoy;
  const plan = planDelDia(fecha);
  const rutinaId = opts.rutinaId || plan.rutina ||
    (S.dias.get(fecha)?.rutinaId) || "musculacion";
  pasoElegirRutina({ ...opts, fecha, rutinaId });
}

/* Paso 1: qué sesión va a hacer. Un toque si es la de hoy. */
function pasoElegirRutina(ctx) {
  const r = RUTINAS[ctx.rutinaId];
  const plan = planDelDia(ctx.fecha);
  const esHoy = ctx.fecha === hoyISO();
  const yaRegistrado = sesionRegistrada(ctx.fecha);

  abrirHoja(`
    <h3>Registrar entrenamiento</h3>
    <div class="registro-rutina">
      <div class="etiqueta">${esHoy ? "Hoy" : esc(fmtFechaLarga(ctx.fecha))}</div>
      <div class="registro-nombre">${esc(r.nombre)}</div>
      <div class="dato">${esc(resumenRutina(ctx.rutinaId))}${plan.tipo === "descanso" ? " · hoy tocaba descanso" : ""}</div>
    </div>
    ${yaRegistrado ? `<p class="texto-2">Este día ya está registrado. Si entrenás igual,
      se suma al mismo día.</p>` : ""}
    ${ctx.esRecuperacion ? `<p class="texto-2">Vas a recuperar la sesión del
      ${esc(fmtFechaLarga(ctx.fechaOriginal))}.</p>` : ""}
    <div class="hoja-acciones">
      <button id="reg-seguir" class="btn btn-rojo btn-grande">Continuar</button>
      <button id="reg-cambiar" class="btn btn-texto">Cambiar de rutina</button>
    </div>`);

  $("#reg-seguir").onclick = () => pasoFoto(ctx);
  $("#reg-cambiar").onclick = () => {
    const otra = ctx.rutinaId === "musculacion" ? "intervalos" : "musculacion";
    pasoElegirRutina({ ...ctx, rutinaId: otra });
  };
}

/* Paso 2: la foto. Cámara y galería valen igual; sin foto es el desvío. */
function pasoFoto(ctx) {
  abrirHoja(`
    <h3>Foto del gimnasio</h3>
    <p class="texto-2">Sacate la foto y el entrenamiento queda registrado al instante:
    el día pasa a verde y la racha suma. Después entrás a la rutina.</p>
    <div class="foto-zona" id="reg-foto-zona">Todavía sin foto</div>
    <input id="reg-foto-camara" type="file" accept="image/*" capture="environment" hidden>
    <input id="reg-foto-galeria" type="file" accept="image/*" hidden>
    <div class="hoja-acciones">
      <button id="reg-camara" class="btn btn-rojo btn-grande">Sacar foto</button>
      <button id="reg-galeria" class="btn btn-borde btn-grande">Elegir de galería</button>
      <button id="reg-empezar" class="btn btn-primario btn-grande oculta">Empezar entrenamiento</button>
      <button id="reg-sin-foto" class="btn btn-texto">Empezar sin foto</button>
    </div>`);

  let fotoLista = null;
  const zona = $("#reg-foto-zona");

  const tomar = async (input) => {
    const file = input.files?.[0];
    if (!file) return;
    zona.textContent = "Comprimiendo…";
    try {
      fotoLista = await comprimirFoto(file);
      zona.innerHTML = `<img src="${fotoLista}" alt="Foto del gimnasio">`;
      $("#reg-empezar").classList.remove("oculta");
      $("#reg-camara").textContent = "Sacar otra";
      vibrar("confirmar");
    } catch (_) {
      zona.textContent = "No se pudo procesar la foto. Probá con la galería.";
    }
  };
  $("#reg-foto-camara").onchange = (e) => tomar(e.target);
  $("#reg-foto-galeria").onchange = (e) => tomar(e.target);
  $("#reg-camara").onclick = () => $("#reg-foto-camara").click();
  $("#reg-galeria").onclick = () => $("#reg-foto-galeria").click();
  zona.onclick = () => $("#reg-foto-camara").click();

  $("#reg-empezar").onclick = async (ev) => {
    const ok = await iniciarEntrenamiento({ ...ctx, foto: fotoLista, boton: ev.currentTarget });
    if (ok) cerrarHoja(true);
  };
  $("#reg-sin-foto").onclick = async (ev) => {
    const ok = await iniciarEntrenamiento({ ...ctx, foto: null, boton: ev.currentTarget });
    if (ok) {
      cerrarHoja(true);
      toast("Sin foto por ahora. La podés agregar después desde el calendario.", "", 6000);
    }
  };
}

/* Sesión abierta de otro día: se retoma o se cierra, no se pierde. */
function hojaSesionDeOtroDia(fecha) {
  abrirHoja(`
    <h3>Tenés una sesión abierta</h3>
    <p class="texto-2">Quedó abierta la del ${esc(fmtFechaLarga(fecha))}.
    Ese día ya está registrado; podés retomarla o cerrarla y empezar una nueva.</p>
    <div class="hoja-acciones">
      <button id="so-retomar" class="btn btn-primario btn-grande">Retomar esa</button>
      <button id="so-nueva" class="btn btn-borde btn-grande">Cerrarla y empezar hoy</button>
    </div>`);
  $("#so-retomar").onclick = () => { cerrarHoja(true); retomarSesion(fecha); };
  $("#so-nueva").onclick = async (ev) => {
    ev.currentTarget.disabled = true;
    await cerrarSesionAutomatica(fecha);
    cerrarHoja(true);
    abrirRegistroEntrenamiento({ forzarNueva: true });
  };
}

/* ==========================================================================
   ENTRAR AL ENTRENAMIENTO
   --------------------------------------------------------------------------
   El día queda registrado como HECHO acá, al empezar, no al terminar. A partir
   de este punto nada puede desregistrarlo: ni salir de la app, ni quedarse sin
   batería, ni no llegar nunca a "Terminar y guardar".
   ========================================================================== */
async function iniciarEntrenamiento({ fecha, rutinaId, esRecuperacion, fechaOriginal, foto, boton }) {
  desbloquearAudio();
  const esPrueba = modoPrueba();
  const inicio = Date.now();
  const previo = S.dias.get(fecha) || {};

  S.sesion = {
    fecha, rutinaId,
    esRecuperacion: !!esRecuperacion,
    fechaOriginal: fechaOriginal || null,
    esPrueba,
    inicio, paso: 0,
    cola: armarCola(rutinaId),
    calorHecho: {}, pesoActual: {}, repsActual: {},
    vueltas: previo.vueltas || (rutinaId === "intervalos" ? [0, 0, 0, 0] : null),
    timer: null, descanso: null,
    prMax: maximosHistoricos(),
  };

  const cambios = {
    tipo: "entreno", rutinaId, rutinasVersion: RUTINAS_VERSION,
    estado: esRecuperacion ? "recuperada" : "hecha",   // registrado desde YA
    inicio, fin: null, esPrueba,
    series: previo.series || {},
    vueltas: S.sesion.vueltas || null,
    sesion: sesionParaGuardar(S.sesion),
    cerradaAutomatica: false,
  };
  if (esRecuperacion && fechaOriginal) cambios.recuperaDe = fechaOriginal;

  if (foto) {
    cambios.tieneFoto = true;
    cambios.motivoSinFoto = null;
    cambios.fotoAgregadaEl = fecha;      // sacada el mismo día: sin asterisco
  } else if (!previo.tieneFoto) {
    cambios.tieneFoto = false;
  }

  const ok = await guardarDia(fecha, cambios, { queHacia: "el inicio del entrenamiento", boton });
  if (!ok) { S.sesion = null; return false; }

  if (foto) {
    await escribir("la foto del día",
      () => setDoc(refs.diaMedia(fecha, "foto"), { data: foto, hora: inicio }));
  }

  guardarSesion();
  pedirWakeLock();
  arrancarTickeo();
  programarCierreAutomatico();
  irA("entreno");
  if (esPrueba) toast("Modo prueba: los tiempos corren a 10 s y la sesión no cuenta.", "", 5000);
  else toast("Entrenamiento registrado. Ya cuenta para la racha.", "toast-record", 4000);
  return true;
}

function retomarSesion(fecha) {
  desbloquearAudio();
  const reg = S.dias.get(fecha);
  if (!reg?.sesion?.abierta) return false;
  S.sesion = sesionDesdeRegistro(fecha, reg);
  guardarSesion();
  pedirWakeLock();
  arrancarTickeo();
  programarCierreAutomatico();
  irA("entreno");
  return true;
}

/* --- Cierre automático a las 23:59 ---------------------------------------- */

/* Cierra la sesión de un día dado sin preguntar nada y sin descartar nada. */
async function cerrarSesionAutomatica(fecha) {
  const reg = S.dias.get(fecha);
  if (!reg?.sesion?.abierta) return;
  const fin = reg.sesion.tocada || reg.inicio || Date.now();
  if (S.sesion?.fecha === fecha) {
    S.sesion = null;
    limpiarSesionLocal();
    soltarWakeLock();
    frenarTickeo();
  }
  await guardarDia(fecha, {
    estado: reg.estado || (reg.sesion.esRecuperacion ? "recuperada" : "hecha"),
    fin, sesion: { abierta: false }, cerradaAutomatica: true,
  }, { queHacia: "el cierre del entrenamiento" });
}

/* Al abrir la app: cualquier sesión de un día anterior se cierra sola. */
async function cerrarSesionesViejas() {
  const hoy = hoyISO();
  for (const [fecha, reg] of [...S.dias]) {
    if (reg?.sesion?.abierta && fecha < hoy) await cerrarSesionAutomatica(fecha);
  }
}

/* Si la app queda abierta cruzando la medianoche, se cierra igual. */
let cierreAutoTimer = null;
function programarCierreAutomatico() {
  clearTimeout(cierreAutoTimer);
  if (!S.sesion) return;
  const ahora = new Date();
  const p = _partes(_fmtHoraTZ, ahora);
  const faltaMin = (23 * 60 + 59) - (Number(p.hour) * 60 + Number(p.minute));
  if (faltaMin <= 0) return;
  cierreAutoTimer = setTimeout(() => {
    if (S.sesion) {
      const f = S.sesion.fecha;
      cerrarSesionAutomatica(f).then(() => {
        toast("Cerramos tu entrenamiento con lo que registraste.", "", 7000);
        irA("inicio");
      });
    }
  }, Math.min(faltaMin * 60000, 2 ** 31 - 1));
}

/* Aviso amable cuando una sesión se cerró sola. */
function avisarCierreAutomatico() {
  const pendiente = [...S.dias.entries()]
    .filter(([, r]) => r?.cerradaAutomatica && !r?.avisoCierreVisto && !r?.esPrueba)
    .sort()[0];
  if (!pendiente) return;
  const [fecha, reg] = pendiente;
  const dia = DIAS_NOMBRE[diaSemanaDe(fecha)];
  const faltanDatos = !reg.hambre || !reg.cansancio || !reg.comentario;

  abrirHoja(`
    <h3>Te cerramos la sesión</h3>
    <p class="texto-2">Cerramos tu sesión del ${esc(dia)} con lo que registraste.
    El día quedó en verde y cuenta para la racha.
    ${faltanDatos ? "¿Querés completar hambre y cansancio?" : ""}</p>
    <div class="hoja-acciones">
      ${faltanDatos ? `<button id="ca-completar" class="btn btn-primario btn-grande">Completar</button>` : ""}
      <button id="ca-listo" class="btn btn-borde btn-grande">Está bien así</button>
    </div>`, { onCerrar: () => marcarAvisoVisto(fecha) });

  const completar = $("#ca-completar");
  if (completar) completar.onclick = () => {
    cerrarHoja(true);
    marcarAvisoVisto(fecha);
    hojaCompletarCierre(fecha);
  };
  $("#ca-listo").onclick = () => { cerrarHoja(true); marcarAvisoVisto(fecha); };
}
function marcarAvisoVisto(fecha) {
  guardarDia(fecha, { avisoCierreVisto: true }, { queHacia: "el aviso" });
}

function salirDeSesion() {
  const fecha = S.sesion?.fecha;
  abrirHoja(`
    <h3>¿Salir del entrenamiento?</h3>
    <p class="texto-2">El día ya está registrado y todo lo marcado está guardado.
    Podés volver y seguir donde estabas, desde acá o desde el calendario.</p>
    <div class="hoja-acciones">
      <button id="salir-si" class="btn btn-primario btn-grande">Salir (se puede continuar)</button>
      <button id="salir-cancelar" class="btn btn-borde btn-grande">Seguir entrenando</button>
      <button id="salir-descartar" class="btn btn-texto">Descartar el entrenamiento</button>
    </div>`);
  $("#salir-si").onclick = () => {
    cerrarHoja(true);
    guardarSesion({ yaMismo: true });
    soltarWakeLock();
    irA("inicio");
  };
  $("#salir-cancelar").onclick = () => cerrarHoja(true);
  $("#salir-descartar").onclick = () => {
    cerrarHoja(true);
    confirmarDescarte(fecha);
  };
}

/* Descartar es destructivo y ahora borra un día YA registrado: se confirma. */
function confirmarDescarte(fecha) {
  abrirHoja(`
    <h3>¿Descartar el entrenamiento?</h3>
    <p class="texto-2">Se borran las series, la hora de inicio y la foto de ese día,
    y vuelve a contar como no entrenado. Esto no se puede deshacer.</p>
    <div class="hoja-acciones">
      <button id="desc-si" class="btn btn-rojo btn-grande">Sí, descartar</button>
      <button id="desc-no" class="btn btn-borde btn-grande">Mejor no</button>
    </div>`);
  $("#desc-no").onclick = () => cerrarHoja(true);
  $("#desc-si").onclick = async (ev) => {
    const reg = S.dias.get(fecha) || {};
    if (S.sesion?.fecha === fecha) {
      S.sesion = null; limpiarSesionLocal(); soltarWakeLock(); frenarTickeo();
    }
    const ok = await guardarDia(fecha, {
      estado: null, rutinaId: null, inicio: null, fin: null,
      series: {}, vueltas: null, esfuerzo: {}, esPrueba: false,
      sesion: { abierta: false }, cerradaAutomatica: false,
      tieneFoto: false, fotoAgregadaEl: null,
      tipo: planDelDia(fecha).tipo, aguaMl: reg.aguaMl || 0,
    }, { queHacia: "el descarte", boton: ev.currentTarget });
    if (!ok) return;
    cerrarHoja(true);
    irA("inicio");
  };
}

/* ==========================================================================
   SESIÓN — render de pasos
   ========================================================================== */
function renderPasoSesion() {
  const s = S.sesion;
  if (!s) return;
  const r = RUTINAS[s.rutinaId];
  $("#entreno-titulo").textContent = r.nombre +
    (s.esRecuperacion ? " · recuperación" : "") + (s.esPrueba ? " · prueba" : "");
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
  guardarSesion();
  window.scrollTo(0, 0);
  const cont = $("#entreno-contenido");
  cont.classList.remove("desliza");
  void cont.offsetWidth;               // reinicia la animación
  cont.classList.add("desliza");
  renderPasoSesion();
}

function htmlTimerGrande(etiqueta) {
  const t = S.sesion.timer;
  if (!t) return "";
  const resta = (t.fin - Date.now()) / 1000;
  const off = (CIRC * Math.min(1, Math.max(0, 1 - resta / t.dur))).toFixed(1);
  return `
    <div class="temporizador" id="t-timer">
      <div class="timer-anillo">
        <svg viewBox="0 0 100 100">
          <circle class="pista" cx="50" cy="50" r="45"/>
          <circle class="valor" cx="50" cy="50" r="45"
            stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${off}"/>
        </svg>
        <div class="timer-num num">${fmtCrono(resta)}</div>
      </div>
      <div class="timer-etiqueta">${esc(etiqueta || t.etiqueta || "")}</div>
    </div>`;
}

/* --- Musculación: entrada en calor --- */
function renderCalorMusculacion(cont) {
  const cal = MUSCULACION.entradaEnCalor;
  const h = (x) => S.sesion.calorHecho[x];
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
      S.sesion.calorHecho[b.dataset.cal] = !S.sesion.calorHecho[b.dataset.cal];
      vibrar("leve");
      guardarSesion();
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
    s.pesoActual[id] = series.filter((x) => x?.hecha).slice(-1)[0]?.peso
      ?? previa?.peso ?? e.pesoSugerido ?? 0;
  }
  if (!(id in s.repsActual)) s.repsActual[id] = e.reps;

  const numEj = s.cola.filter((p) => p.t === "ej").findIndex((p) => p.id === id) + 1;
  const totalEj = s.cola.filter((p) => p.t === "ej").length;
  const hechas = series.filter((x) => x?.hecha).length;

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
      ${previa ? `<div class="ej-anterior num">La vez pasada: ${previa.peso} kg × ${previa.reps}</div>` : ""}
      ${sugerencia ? `<div class="ej-nota-guardada">${esc(sugerencia)}</div>` : ""}
      ${notaPersistente ? `<div class="ej-nota-guardada">Nota: ${esc(notaPersistente)}</div>` : ""}

      <div class="peso-control">
        <button class="btn-paso" id="peso-menos" aria-label="Bajar peso">−</button>
        <input class="peso-input" id="peso-input" type="number" inputmode="decimal" step="${e.pesoPaso}" value="${s.pesoActual[id]}">
        <button class="btn-paso" id="peso-mas" aria-label="Subir peso">+</button>
      </div>
      <div class="centrado peso-unidad">kg · pasos de ${e.pesoPaso}
        &nbsp;·&nbsp; reps <button id="reps-menos" class="btn reps-mini">−</button>
        <b id="reps-num" class="num">${s.repsActual[id]}</b>
        <button id="reps-mas" class="btn reps-mini">+</button></div>

      <div class="series-fila">
        ${[0, 1, 2, 3].map((i) => {
          const x = series[i];
          return `<button class="serie-cajita ${x?.hecha ? "hecha" : ""}" data-serie="${i}">
            ${x?.hecha ? `${x.peso}<small>kg × ${x.reps}</small>
              <svg class="tilde-serie" viewBox="0 0 24 24"><path d="M4 12.5 10 18 20 6" pathLength="20"/></svg>`
              : `${i + 1}<small>serie</small>`}
          </button>`;
        }).join("")}
      </div>

      ${d ? `<div class="timer-descanso-mini" id="t-descanso">
        <span class="t-num num">${fmtCrono((d.fin - Date.now()) / 1000)}</span>
        <span class="texto-2" style="font-size:13px">descanso</span>
        <button id="descanso-saltar" class="btn btn-suave btn-medio">Saltar</button>
      </div>` : ""}

      <div class="ej-acciones">
        <button id="btn-nota" class="btn btn-borde">Nota ${notaPersistente ? "✓" : ""}</button>
        <button id="btn-ascenso" class="btn btn-borde ${marcadoAscenso ? "ej-accion-activa" : ""}">
          ${marcadoAscenso ? "Marcado para ascenso" : "Marcar para ascenso"}</button>
        <button id="btn-ocupada" class="btn btn-borde">Máquina ocupada</button>
        ${id.startsWith("prensa") ? `<button id="btn-discos" class="btn btn-borde">Discos</button>` : `<span></span>`}
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
    guardarSesion();
  };
  $("#peso-menos").onclick = () => cambiarPeso(-e.pesoPaso);
  $("#peso-mas").onclick = () => cambiarPeso(e.pesoPaso);
  inputPeso.onchange = () => cambiarPeso(0);

  $("#reps-menos").onclick = () => { s.repsActual[id] = Math.max(1, s.repsActual[id] - 1); $("#reps-num").textContent = s.repsActual[id]; guardarSesion(); };
  $("#reps-mas").onclick = () => { s.repsActual[id]++; $("#reps-num").textContent = s.repsActual[id]; guardarSesion(); };

  cont.querySelectorAll("[data-serie]").forEach((b) => {
    b.onclick = async () => {
      const i = Number(b.dataset.serie);
      const nuevas = [...series];
      if (nuevas[i]?.hecha) {
        nuevas[i] = null;
      } else {
        nuevas[i] = { peso: s.pesoActual[id], reps: s.repsActual[id], hecha: true };
        ponerDescanso();
        const esUltima = nuevas.filter((x) => x?.hecha).length >= e.series;
        vibrar(esUltima ? "confirmar" : "leve");
        // ¿récord? (solo si ya había una marca previa, y nunca en modo prueba)
        const marcaPrevia = s.prMax[id];
        if (!s.esPrueba && marcaPrevia !== undefined && s.pesoActual[id] > marcaPrevia) {
          s.prMax[id] = s.pesoActual[id];
          bannerRecord(`Récord en ${e.nombre}: ${s.pesoActual[id]} kg`);
        } else if (marcaPrevia === undefined) {
          s.prMax[id] = s.pesoActual[id];
        }
      }
      const limpias = nuevas.filter(Boolean);
      await guardarDia(s.fecha, { series: { ...(reg.series || {}), [id]: limpias } });
      guardarSesion();
      renderPasoSesion();
    };
  });

  const saltar = $("#descanso-saltar");
  if (saltar) saltar.onclick = () => { s.descanso = null; guardarSesion(); renderPasoSesion(); };

  cont.querySelectorAll("[data-esf]").forEach((b) => {
    b.onclick = async () => {
      await guardarDia(s.fecha, { esfuerzo: { ...(reg.esfuerzo || {}), [id]: b.dataset.esf } });
      vibrar("leve");
      renderPasoSesion();
    };
  });
  const esfSaltear = $("#btn-esf-saltear");
  if (esfSaltear) esfSaltear.onclick = () => avanzarPaso();

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
    const cola = s.cola;
    const actual = cola[s.paso];
    cola.splice(s.paso, 1);
    let pos = cola.findIndex((p) => p.t === "cinta-cierre");
    if (pos < 0) pos = cola.length - 1;
    cola.splice(pos, 0, actual);
    s.timer = null; s.descanso = null;
    guardarSesion();
    toast("Salteado. Vuelve al final.");
    renderPasoSesion();
  };
  const discos = $("#btn-discos");
  if (discos) discos.onclick = () => hojaDiscos(Number(inputPeso.value) || 0);

  $("#btn-ej-sig").onclick = () => {
    if (hechas > 0 && !reg.esfuerzo?.[id]) {
      toast('Marcá cómo terminaste, o tocá "Saltear esta pregunta".', "toast-alerta");
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
    // vacío = borrar; se guarda "" porque el merge de Firestore no saca claves
    await guardarConfig({ notasEjercicio: { ...(S.config.notasEjercicio || {}), [id]: texto } });
    const reg = S.dias.get(S.sesion.fecha) || {};
    await guardarDia(S.sesion.fecha, { notas: { ...(reg.notas || {}), [id]: texto } });
    cerrarHoja(true);
    renderPasoSesion();
  };
}

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
    for (const dk of discos) {
      const n = Math.floor(resto / dk + 1e-9);
      if (n > 0) { usados.push(`${n} × ${dk} kg`); resto = Math.round((resto - n * dk) * 100) / 100; }
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
      vibrar("leve");
      guardarSesion(); renderPasoSesion();
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
        <button class="btn-paso" id="v-menos" aria-label="Restar media vuelta">−</button>
        <span class="vueltas-num" id="vueltas-num" data-valor="${s.vueltas[v] || 0}">${s.vueltas[v] || 0}</span>
        <button class="btn-paso" id="v-media" aria-label="Sumar media vuelta">+½</button>
        <button class="btn-paso" id="v-mas" aria-label="Sumar una vuelta">+1</button>
      </div>`;
  }

  cont.innerHTML = `
    <div class="paso-indicador">Bloque ${numBloque} de 8 · ${esc(bloqueDef.nombre)}</div>
    ${bloqueDef.nota ? `<p class="texto-2">${esc(bloqueDef.nota)}</p>` : ""}
    ${cuerpo}
    ${htmlTimerGrande(bloqueDef.nombre)}
    ${!timerActivo ? `<button id="btn-bloque-ir" class="btn btn-rojo btn-gigante mt">Arrancar bloque · ${fmtCrono(durT(bloqueDef.duracionSeg))}</button>` : ""}
    <div class="entreno-pie">
      ${timerActivo ? `<button id="btn-bloque-sig" class="btn ${termino ? "btn-rojo" : "btn-borde"} btn-grande">
        Bloque terminado · siguiente</button>` : ""}
    </div>`;

  if (!esCinta) {
    const v = paso.vuelta;
    const cambiarV = async (delta) => {
      s.vueltas[v] = Math.max(0, Math.round(((s.vueltas[v] || 0) + delta) * 2) / 2);
      vibrar("leve");
      guardarSesion();
      await guardarDia(s.fecha, { vueltas: s.vueltas });
      const num = $("#vueltas-num");
      if (num) { num.textContent = s.vueltas[v]; num.dataset.valor = String(s.vueltas[v]); }
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

/* --- Parte de cierre --- */
function renderParteCierre(cont) {
  const s = S.sesion;
  const reg = S.dias.get(s.fecha) || {};
  const vol = volumenSesion({ ...reg, rutinaId: s.rutinaId });
  const durSeg = (Date.now() - s.inicio) / 1000;
  const comparacion = s.esPrueba ? "" : comparacionConAnterior(s.fecha, { ...reg, rutinaId: s.rutinaId });

  const esc15 = (nombre, valor) => `
    <div class="paso-indicador">${nombre}</div>
    <div class="escala-15" data-escala="${nombre}">
      ${[1, 2, 3, 4, 5].map((n) =>
        `<button class="btn btn-borde ${valor === n ? "sel" : ""}" data-v="${n}">${n}</button>`).join("")}
    </div>`;

  cont.innerHTML = `
    <div class="paso-indicador">Parte de cierre</div>
    <div class="cierre-resumen">
      ${vol ? `<strong class="num">${fmtKg(vol)} kg movidos</strong>` : ""}
      Duración: ${fmtDuracion(durSeg)}<br>
      ${s.rutinaId === "intervalos" && s.vueltas ? `Vueltas por bloque: ${s.vueltas.join(" · ")}<br>` : ""}
      ${esc(comparacion)}
    </div>
    ${esc15("Hambre", reg.hambre)}
    ${esc15("Cansancio", reg.cansancio)}
    <div class="campo"><label>Comentario libre</label>
      <textarea id="cierre-comentario" placeholder="Cómo salió, qué ajustar…">${esc(reg.comentario || "")}</textarea></div>

    <div class="paso-indicador">Foto del gym</div>
    <div class="foto-zona" id="foto-zona">${reg.tieneFoto ? "" : "Este día quedó sin foto. Tocá para agregarla."}</div>
    <input id="foto-input" type="file" accept="image/*" hidden>

    <div class="entreno-pie">
      <button id="btn-terminar" class="btn btn-rojo btn-gigante">Terminar y guardar</button>
      <p class="dato centrado">El día ya está registrado. Esto es el cierre, no un requisito.</p>
    </div>`;

  if (reg.tieneFoto) {
    getDoc(refs.diaMedia(s.fecha, "foto")).then((snap) => {
      if (snap.exists()) $("#foto-zona").innerHTML = `<img src="${snap.data().data}" alt="Foto del gym">`;
    });
  }

  cont.querySelectorAll("[data-escala]").forEach((caja) => {
    const nombre = caja.dataset.escala;
    caja.querySelectorAll("button").forEach((b) => {
      b.onclick = async () => {
        await guardarDia(s.fecha, { [nombre === "Hambre" ? "hambre" : "cansancio"]: Number(b.dataset.v) });
        vibrar("leve");
        renderPasoSesion();
      };
    });
  });

  $("#foto-zona").onclick = () => $("#foto-input").click();
  $("#foto-input").onchange = (ev) => guardarFotoDelDia(s.fecha, ev.target.files[0], {
    alTerminar: () => renderPasoSesion(),
    zona: $("#foto-zona"),
  });

  /* El día YA está registrado desde que empezó. Terminar solo cierra la sesión
     y guarda el parte: nunca decide si el día cuenta o no. */
  $("#btn-terminar").onclick = async (ev) => {
    const ok = await guardarDia(s.fecha, {
      fin: Date.now(),
      comentario: $("#cierre-comentario").value.trim(),
      sesion: { abierta: false },
      cerradaAutomatica: false,
    }, { queHacia: "el cierre del entrenamiento", boton: ev.currentTarget });
    if (!ok) return;
    const datos = { vol, dur: durSeg, comparacion, esPrueba: s.esPrueba };
    S.sesion = null;
    limpiarSesionLocal();
    soltarWakeLock();
    frenarTickeo();
    clearTimeout(cierreAutoTimer);
    momentoCierre({ ...datos, alCerrar: () => irA("inicio", true) });
  };
}

/* ==========================================================================
   FOTO DEL DÍA — se puede agregar en cualquier momento, sin ventana de tiempo
   ========================================================================== */
async function guardarFotoDelDia(fecha, file, { alTerminar, zona, boton } = {}) {
  if (!file) return false;
  if (zona) zona.textContent = "Comprimiendo…";
  let data;
  try {
    data = await comprimirFoto(file);
  } catch (_) {
    if (zona) zona.textContent = "No se pudo procesar la foto. Probá con otra.";
    return false;
  }
  // Primero el contenido, después el puntero: si se corta en el medio queda
  // una foto sin referencia, nunca una referencia sin foto.
  const okFoto = await escribir("la foto del día",
    () => setDoc(refs.diaMedia(fecha, "foto"), { data, hora: Date.now() }), boton);
  if (!okFoto) return false;
  const ok = await guardarDia(fecha, {
    tieneFoto: true, motivoSinFoto: null, fotoAgregadaEl: hoyISO(),
  }, { queHacia: "la foto del día" });
  if (ok) {
    vibrar("confirmar");
    if (alTerminar) alTerminar();
  }
  return ok;
}

function hojaAgregarFoto(fecha) {
  abrirHoja(`
    <h3>Agregar la foto</h3>
    <p class="texto-2">De ${esc(fmtFechaLarga(fecha))}. Podés sacarla ahora o buscarla
    en la galería: no hay límite de tiempo para agregarla.</p>
    <div class="foto-zona" id="af-zona">Todavía sin foto</div>
    <input id="af-camara" type="file" accept="image/*" capture="environment" hidden>
    <input id="af-galeria" type="file" accept="image/*" hidden>
    <div class="hoja-acciones">
      <button id="af-btn-camara" class="btn btn-rojo btn-grande">Sacar foto</button>
      <button id="af-btn-galeria" class="btn btn-borde btn-grande">Elegir de galería</button>
    </div>`);

  const guardar = (ev) => guardarFotoDelDia(fecha, ev.target.files?.[0], {
    zona: $("#af-zona"),
    alTerminar: () => {
      cerrarHoja(true);
      toast("Foto agregada. El día quedó completo.", "toast-record");
      refrescarVistaActual();
    },
  });
  $("#af-camara").onchange = guardar;
  $("#af-galeria").onchange = guardar;
  $("#af-btn-camara").onclick = () => $("#af-camara").click();
  $("#af-btn-galeria").onclick = () => $("#af-galeria").click();
}

/* Completar hambre, cansancio y comentario cuando no se pasó por el cierre. */
function hojaCompletarCierre(fecha) {
  const reg = S.dias.get(fecha) || {};
  const escala = (nombre, campo, valor) => `
    <div class="paso-indicador">${nombre}</div>
    <div class="escala-15" data-campo="${campo}">
      ${[1, 2, 3, 4, 5].map((n) =>
        `<button class="btn btn-borde ${valor === n ? "sel" : ""}" data-v="${n}">${n}</button>`).join("")}
    </div>`;

  abrirHoja(`
    <h3>Completar el día</h3>
    <p class="texto-2">${esc(fmtFechaLarga(fecha))}</p>
    ${escala("Hambre", "hambre", reg.hambre)}
    ${escala("Cansancio", "cansancio", reg.cansancio)}
    <div class="campo"><label>Comentario</label>
      <textarea id="cc-comentario" placeholder="Cómo salió, qué ajustar…">${esc(reg.comentario || "")}</textarea></div>
    <div class="hoja-acciones">
      <button id="cc-guardar" class="btn btn-primario btn-grande">Guardar</button>
    </div>`);

  const elegido = { hambre: reg.hambre, cansancio: reg.cansancio };
  $$("#hoja-contenido [data-campo]").forEach((caja) => {
    caja.querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        elegido[caja.dataset.campo] = Number(b.dataset.v);
        caja.querySelectorAll("button").forEach((x) => x.classList.toggle("sel", x === b));
        vibrar("leve");
      };
    });
  });
  $("#cc-guardar").onclick = async (ev) => {
    const ok = await guardarDia(fecha, {
      hambre: elegido.hambre ?? null,
      cansancio: elegido.cansancio ?? null,
      comentario: $("#cc-comentario").value.trim(),
    }, { queHacia: "el parte del día", boton: ev.currentTarget });
    if (!ok) return;
    cerrarHoja(true);
    toast("Día completado.");
    refrescarVistaActual();
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
      let calidad = 0.8, data = "";
      for (let intento = 0; intento < 6; intento++) {
        data = canvas.toDataURL("image/webp", calidad);
        if (!data.startsWith("data:image/webp")) data = canvas.toDataURL("image/jpeg", calidad);
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
   CALENDARIO — nada anterior a fechaInicio se pinta
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
  const offset = (primero.getDay() + 6) % 7;
  const diasMes = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const hoy = hoyISO();

  for (let i = 0; i < offset; i++) grilla.appendChild(el("div", "cal-dia d-otro", ""));
  for (let d = 1; d <= diasMes; d++) {
    const iso = fmtISO(new Date(base.getFullYear(), base.getMonth(), d));
    let cls = "";
    const e = estadoDia(iso);
    if (e === "previo") cls = "d-previo";
    else if (iso <= hoy || S.dias.has(iso)) {
      if (e === "hecha") cls = "d-hecha";
      else if (e === "a-medias") cls = "d-hecha d-a-medias";
      else if (e === "recuperada") cls = "d-recuperada";
      else if (e === "causa-mayor") cls = "d-causa";
      else if (e === "fallada") cls = "d-fallada";
      else if (e === "descanso-caminata") cls = "d-descanso-caminata";
      else if (e === "descanso") cls = "d-descanso";
    }
    const reg = S.dias.get(iso);
    if (sesionRegistrada(iso) && !reg?.tieneFoto) cls += " d-sin-foto";
    if (reg?.sesion?.abierta) cls += " d-abierta";
    const celda = el("button", `cal-dia ${cls} ${iso === hoy ? "d-hoy" : ""}`, String(d));
    if (e === "previo") celda.disabled = true;
    // Siempre el detalle: es desde donde se arregla cualquier cosa del día.
    else celda.onclick = () => hojaDetalleDia(iso);
    grilla.appendChild(celda);
  }
}

function renderHeatmap() {
  const hoy = hoyISO();
  const piso = pisoFecha();
  const inicio = lunesDe(sumarDias(hoy, -364));
  const menciones = new Set(
    [...S.semanas.values()].filter((s) => s.mencionHonor).map((s) => s.clave));
  let html = `<div class="heatmap-grilla">`;
  for (let f = inicio; f <= domingoDe(hoy); f = sumarDias(f, 1)) {
    let cls = "";
    if (f <= hoy && f >= piso) {
      const e = estadoDia(f);
      if (e === "hecha" || e === "recuperada") cls = "h2";
      else if (e === "descanso-caminata") cls = "h1";
      else if (e === "fallada") cls = "hx";
      else if (e === "causa-mayor") cls = "hc";
    }
    if (diaSemanaDe(f) === 0 && menciones.has(claveSemana(f))) cls += " hm-mencion";
    html += `<span class="hm-celda ${cls}" title="${f}"></span>`;
  }
  $("#heatmap").innerHTML = html + "</div>";
  $("#heatmap").scrollLeft = 99999;
}

/* Detalle de un día: la puerta para arreglar cualquier cosa que quedó a medias.
   Las acciones que ofrece dependen del estado en que quedó ese día. */
function hojaDetalleDia(fecha) {
  const reg = regReal(fecha);
  const estado = estadoDia(fecha);
  const plan = planDelDia(fecha);
  const hoy = hoyISO();
  const ETIQUETAS = {
    "hecha": "Entrenó", "recuperada": "Recuperada", "descanso": "Descanso",
    "descanso-caminata": "Descanso con caminata", "causa-mayor": "Causa mayor",
    "fallada": "Fallada", "pendiente": "Pendiente", "a-medias": "Entrenó (sin cerrar)",
  };
  const abierta = !!reg?.sesion?.abierta;
  const registrado = sesionRegistrada(fecha);
  const faltaFoto = registrado && !reg?.tieneFoto;
  const faltaParte = registrado && (!reg?.hambre || !reg?.cansancio);

  let cuerpo = `<div class="dia-detalle-fila"><span>Estado</span><span>${ETIQUETAS[estado] || estado}${abierta ? " · abierta" : ""}</span></div>`;
  if (reg?.rutinaId) cuerpo += `<div class="dia-detalle-fila"><span>Rutina</span><span>${esc(RUTINAS[reg.rutinaId]?.nombre || reg.rutinaId)}</span></div>`;
  if (reg?.cerradaAutomatica) cuerpo += `<div class="dia-detalle-fila"><span>Cierre</span><span>Automático</span></div>`;
  if (reg?.causaMayor?.motivo)
    cuerpo += `<div class="dia-detalle-fila"><span>Motivo</span><span>${esc(reg.causaMayor.motivo)}${reg.causaMayor.conEscudo ? " · con escudo" : ""}</span></div>`;
  if (reg?.caminata?.minutos)
    cuerpo += `<div class="dia-detalle-fila"><span>Caminata</span><span>${reg.caminata.minutos} min${reg.caminata.nota ? " · " + esc(reg.caminata.nota) : ""}</span></div>`;
  if (reg?.aguaMl) cuerpo += `<div class="dia-detalle-fila"><span>Agua</span><span class="num">${fmtLitros(reg.aguaMl)} L</span></div>`;
  if (faltaFoto) cuerpo += `<div class="dia-detalle-fila"><span>Foto</span><span>Sin foto ✳️</span></div>`;
  else if (reg?.fotoAgregadaEl && reg.fotoAgregadaEl !== fecha)
    cuerpo += `<div class="dia-detalle-fila"><span>Foto</span><span class="dato">agregada el ${DIAS_NOMBRE[diaSemanaDe(reg.fotoAgregadaEl)]}</span></div>`;
  if (reg?.comentario) cuerpo += `<p class="mt">${esc(reg.comentario)}</p>`;

  const acciones = [];
  if (abierta) acciones.push(`<button id="dd-retomar" class="btn btn-rojo btn-grande">Retomar el entrenamiento</button>`);
  if (registrado) acciones.push(`<button id="dd-ficha" class="btn btn-borde btn-grande">Ver la ficha completa</button>`);
  if (registrado && reg?.rutinaId) acciones.push(`<button id="dd-series" class="btn btn-borde btn-grande">Corregir pesos y repeticiones</button>`);
  if (faltaFoto) acciones.push(`<button id="dd-foto" class="btn btn-borde btn-grande">Agregar la foto</button>`);
  if (faltaParte) acciones.push(`<button id="dd-parte" class="btn btn-borde btn-grande">Completar hambre y cansancio</button>`);
  if (!registrado && estado !== "causa-mayor" && fecha <= hoy) {
    acciones.push(`<button id="dd-hecho" class="btn btn-primario btn-grande">Marcar como hecho</button>`);
    acciones.push(`<button id="dd-retro" class="btn btn-borde btn-grande">Cargar los pesos que hice</button>`);
  }
  if (plan.tipo === "descanso" && fecha <= hoy) {
    acciones.push(`<button id="dd-caminata" class="btn btn-borde btn-grande">${reg?.caminata ? "Editar" : "Registrar"} caminata</button>`);
  }

  abrirHoja(`
    <h3 style="text-transform:capitalize">${fmtFechaLarga(fecha)}</h3>
    ${cuerpo}
    ${acciones.length ? `<div class="hoja-acciones">${acciones.join("")}</div>` : ""}`);

  const on = (id, fn) => { const b = $(`#${id}`); if (b) b.onclick = fn; };
  on("dd-retomar", () => { cerrarHoja(true); retomarSesion(fecha); });
  on("dd-ficha", () => { cerrarHoja(true); abrirFicha(fecha); });
  on("dd-series", () => hojaEditarSeries(fecha));
  on("dd-foto", () => hojaAgregarFoto(fecha));
  on("dd-parte", () => hojaCompletarCierre(fecha));
  on("dd-retro", () => hojaRetro(fecha));
  on("dd-caminata", () => hojaCaminata(fecha));
  on("dd-hecho", async (ev) => {
    const rutinaId = plan.rutina || reg?.rutinaId || "musculacion";
    const ok = await guardarDia(fecha, {
      tipo: "entreno", rutinaId, rutinasVersion: RUTINAS_VERSION,
      estado: "hecha", registradoAMano: true, esPrueba: false,
      inicio: reg?.inicio || parseISO(fecha).getTime(),
    }, { queHacia: "el día", boton: ev.currentTarget });
    if (!ok) return;
    cerrarHoja(true);
    await procesarSemanasCerradas();
    refrescarVistaActual();
    toast("Día marcado como hecho.", "toast-record");
  });
}

/* Corregir pesos y repeticiones de series ya cargadas, en cualquier momento. */
function hojaEditarSeries(fecha) {
  const reg = S.dias.get(fecha) || {};
  const rutinaId = reg.rutinaId || "musculacion";

  if (rutinaId === "intervalos") {
    const v = reg.vueltas || [0, 0, 0, 0];
    abrirHoja(`
      <h3>Corregir vueltas</h3>
      <p class="texto-2">${esc(fmtFechaLarga(fecha))}</p>
      <div class="campo"><label>Vueltas por bloque</label>
        <div class="retro-vueltas">
          ${[0, 1, 2, 3].map((i) => `<input data-ed-v="${i}" type="number" inputmode="decimal"
            step="0.5" min="0" value="${v[i] || 0}">`).join("")}
        </div></div>
      <div class="hoja-acciones">
        <button id="ed-guardar" class="btn btn-primario btn-grande">Guardar</button>
      </div>`);
    $("#ed-guardar").onclick = async (ev) => {
      const vueltas = $$("[data-ed-v]").map((i) => Number(i.value) || 0);
      const ok = await guardarDia(fecha, { vueltas },
        { queHacia: "las vueltas", boton: ev.currentTarget });
      if (!ok) return;
      cerrarHoja(true);
      refrescarVistaActual();
      toast("Corregido.");
    };
    return;
  }

  const ejercicios = MUSCULACION.bloques.flatMap((b) => b.ejercicios);
  const filas = ejercicios.map((e) => {
    const ss = reg.series?.[e.id] || [];
    if (!ss.length) return "";
    return `
      <div class="ed-ejercicio">
        <div class="ficha-nombre">${esc(e.nombre)}</div>
        ${ss.map((x, i) => `
          <div class="ed-serie">
            <span class="dato">Serie ${i + 1}</span>
            <input data-ed="${e.id}" data-i="${i}" data-campo="peso" type="number"
              inputmode="decimal" step="${e.pesoPaso}" min="0" value="${x?.peso ?? ""}" aria-label="Peso">
            <span class="dato">kg ×</span>
            <input data-ed="${e.id}" data-i="${i}" data-campo="reps" type="number"
              inputmode="numeric" step="1" min="0" value="${x?.reps ?? ""}" aria-label="Repeticiones">
          </div>`).join("")}
      </div>`;
  }).join("");

  if (!filas.trim()) {
    abrirHoja(`<h3>Sin series cargadas</h3>
      <p class="texto-2">Ese día no tiene series para corregir. Podés cargarlas
      con "Cargar los pesos que hice".</p>`);
    return;
  }

  abrirHoja(`
    <h3>Corregir series</h3>
    <p class="texto-2">${esc(fmtFechaLarga(fecha))}. Se recalculan récords y volumen.</p>
    ${filas}
    <div class="hoja-acciones">
      <button id="ed-guardar" class="btn btn-primario btn-grande">Guardar cambios</button>
    </div>`);

  $("#ed-guardar").onclick = async (ev) => {
    const series = JSON.parse(JSON.stringify(reg.series || {}));
    for (const inp of $$("[data-ed]")) {
      const id = inp.dataset.ed, i = Number(inp.dataset.i);
      if (!series[id]?.[i]) continue;
      const valor = Number(inp.value);
      if (Number.isFinite(valor)) series[id][i][inp.dataset.campo] = valor;
    }
    const ok = await guardarDia(fecha, { series },
      { queHacia: "las series", boton: ev.currentTarget });
    if (!ok) return;
    cerrarHoja(true);
    refrescarVistaActual();
    toast("Series corregidas.");
  };
}

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
          style="min-height:48px;border:1px solid var(--separador);border-radius:14px;text-align:center;font-size:17px;background:var(--superficie)">`).join("")}
      </div></div>`;
  }

  abrirHoja(`
    <h3>Registro retroactivo</h3>
    <p class="texto-2" style="text-transform:capitalize">${fmtFechaLarga(fecha)} · ${r.nombre}</p>
    ${campos}
    <div class="campo"><label>Comentario</label>
      <input id="retro-comentario" type="text" placeholder="Opcional"></div>
    <div class="paso-indicador">Foto (opcional)</div>
    <p class="dato">De un día pasado no se puede sacar en el momento, así que buscala
    en la galería si la tenés. El día cuenta igual sin foto.</p>
    <div class="foto-zona" id="retro-zona">Sin foto</div>
    <input id="retro-galeria" type="file" accept="image/*" hidden>
    <button id="retro-btn-galeria" class="btn btn-borde btn-medio" style="width:100%">Elegir de galería</button>
    <div class="hoja-acciones">
      <button id="retro-guardar" class="btn btn-primario btn-grande">Guardar como hecha</button>
    </div>`);

  let fotoRetro = null;
  $("#retro-btn-galeria").onclick = () => $("#retro-galeria").click();
  $("#retro-galeria").onchange = async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const zona = $("#retro-zona");
    zona.textContent = "Comprimiendo…";
    try {
      fotoRetro = await comprimirFoto(file);
      zona.innerHTML = `<img src="${fotoRetro}" alt="Foto del día">`;
    } catch (_) { zona.textContent = "No se pudo procesar la foto"; }
  };

  $("#retro-guardar").onclick = async (ev) => {
    const dia = {
      tipo: "entreno", rutinaId, rutinasVersion: RUTINAS_VERSION,
      estado: "hecha", retroactivo: true, esPrueba: false,
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
    if (fotoRetro) { dia.tieneFoto = true; dia.fotoAgregadaEl = hoyISO(); }
    const ok = await guardarDia(fecha, dia, { queHacia: "el día", boton: ev.currentTarget });
    if (!ok) return;
    if (fotoRetro) {
      await escribir("la foto del día",
        () => setDoc(refs.diaMedia(fecha, "foto"), { data: fotoRetro, hora: Date.now() }));
    }
    cerrarHoja(true);
    await procesarSemanasCerradas();
    refrescarVistaActual();
    toast("Día registrado.");
  };
}

/* ==========================================================================
   FICHA DE SESIÓN — la infografía del día, en pantalla
   ========================================================================== */
function seriesTexto(e, ss) {
  const hechas = (ss || []).filter((x) => x?.hecha);
  if (!hechas.length) return `${e.series || 4} × ${e.reps} · sin registro`;
  const pesos = hechas.map((x) => x.peso);
  const reps = hechas[0].reps;
  const mismoPeso = pesos.every((p) => p === pesos[0]);
  const mismasReps = hechas.every((x) => x.reps === reps);
  if (mismoPeso && mismasReps) return `${hechas.length} × ${reps} · ${fmtKg(pesos[0])} kg`;
  return `${pesos.map(fmtKg).join(" · ")} kg${mismasReps ? ` (×${reps})` : ""}`;
}

function filaFichaHTML(e, reg, num) {
  const ESFUERZO_TXT = { sobrado: "quedó sobrado", justo: "justo", roto: "se rompió la técnica" };
  const nota = reg.notas?.[e.id];
  const esf = reg.esfuerzo?.[e.id];
  const pie = [esf ? `Esfuerzo: ${ESFUERZO_TXT[esf]}` : "", nota ? `Nota: ${nota}` : ""].filter(Boolean).join(" · ");
  return `
    <div class="ficha-fila">
      <div class="ficha-num num">${num}</div>
      <div class="ficha-cuerpo">
        <div class="ficha-nombre">${esc(e.nombre)}</div>
        ${e.subtitulo ? `<div class="ficha-sub">${esc(e.subtitulo)}</div>` : ""}
        <div class="ficha-series num">${seriesTexto(e, reg.series?.[e.id])}</div>
        <ul class="ficha-cues">${(e.cues || []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
        ${pie ? `<div class="ficha-pie">${esc(pie)}</div>` : ""}
      </div>
      <img class="ficha-img" src="img/ejercicios/${e.img}" alt="">
    </div>`;
}

function abrirFicha(fecha, desdeEl) {
  const reg = S.dias.get(fecha);
  if (!reg?.rutinaId) { hojaDetalleDia(fecha); return; }
  const r = RUTINAS[reg.rutinaId];
  const vol = volumenSesion(reg);
  const comparacion = comparacionConAnterior(fecha, reg);
  const datos = [];
  if (reg.inicio && reg.fin) datos.push(`${fmtHora(reg.inicio)}–${fmtHora(reg.fin)}`, fmtDuracion((reg.fin - reg.inicio) / 1000));
  if (vol) datos.push(`${fmtKg(vol)} kg movidos`);
  if (reg.esPrueba) datos.push("sesión de prueba");

  let cuerpo = "";
  if (reg.rutinaId === "musculacion") {
    const cal = MUSCULACION.entradaEnCalor;
    cuerpo += `<div class="ficha-seccion">Entrada en calor</div>
      <div class="ficha-fila"><div class="ficha-cuerpo">
        <div class="ficha-nombre">${esc(cal.nombre)}</div>
        <div class="ficha-sub">${cal.ejercicios.map((x) => x.nombre).join(" · ")}</div>
      </div><img class="ficha-img" src="img/ejercicios/${cal.imgResumen}" alt=""></div>`;
    let n = 1;
    for (const b of MUSCULACION.bloques) {
      cuerpo += `<div class="ficha-seccion">${esc(b.nombre)}</div>`;
      for (const e of b.ejercicios) cuerpo += filaFichaHTML(e, reg, n++);
    }
    cuerpo += `<div class="ficha-seccion">Cierre</div>
      <div class="ficha-fila"><div class="ficha-cuerpo">
        <div class="ficha-nombre">${esc(MUSCULACION.cierre.nombre)}</div>
        <div class="ficha-sub">${esc(MUSCULACION.cierre.detalle)}</div>
      </div><img class="ficha-img" src="img/ejercicios/${MUSCULACION.cierre.img}" alt=""></div>`;
  } else {
    const cal = INTERVALOS.entradaEnCalor;
    cuerpo += `<div class="ficha-seccion">Movilidad</div>
      <div class="ficha-fila"><div class="ficha-cuerpo">
        <div class="ficha-nombre">${esc(cal.nombre)}</div>
        <div class="ficha-sub">${cal.ejercicios.map((x) => x.nombre).join(" · ")}</div>
      </div><img class="ficha-img" src="img/ejercicios/${cal.imgResumen}" alt=""></div>`;
    cuerpo += `<div class="ficha-seccion">El circuito</div>`;
    INTERVALOS.circuito.forEach((e, i) => {
      const filaReg = { series: {}, notas: reg.notas, esfuerzo: reg.esfuerzo };
      cuerpo += `
        <div class="ficha-fila">
          <div class="ficha-num num">${i + 1}</div>
          <div class="ficha-cuerpo">
            <div class="ficha-nombre">${esc(e.nombre)}</div>
            <div class="ficha-series num">${e.reps} reps${e.peso ? ` · ${e.peso} kg${e.porLado ? " por lado" : ""}` : " · sin carga"}</div>
            <ul class="ficha-cues">${(e.cues || []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
          </div>
          <img class="ficha-img" src="img/ejercicios/${e.img}" alt="">
        </div>`;
    });
    if (reg.vueltas) {
      cuerpo += `<div class="ficha-seccion">Vueltas por bloque</div>`;
      reg.vueltas.forEach((v, i) => {
        cuerpo += `<div class="dia-detalle-fila"><span>Vuelta ${i + 1} · circuito</span><span class="num">${v} vueltas</span></div>`;
      });
    }
  }

  // Gráficos de progresión de los ejercicios con historia
  const conHistoria = Object.keys(reg.series || {}).filter((id) => progresionDe(id).length >= 2);
  const graficos = conHistoria.length
    ? `<div class="ficha-seccion">Progresión</div><div class="ficha-graficos">
        ${conHistoria.map((id) => `<div class="dato" style="margin:8px 0 4px">${esc(nombreEjercicio(id))}</div>
        <canvas class="grafico-mini" data-prog="${id}"></canvas>`).join("")}
      </div>`
    : "";

  abrirHoja(`
    <div class="ficha-cabecera">
      <div class="etiqueta" style="text-transform:capitalize">${fmtFechaLarga(fecha)}</div>
      <h3 class="titular" style="margin:0">${esc(r.nombre)}</h3>
      <div class="ficha-datos">${datos.map((x) => `<span class="num">${esc(x)}</span>`).join("")}</div>
      ${comparacion ? `<div class="dato mt">${esc(comparacion)}</div>` : ""}
      ${reg.comentario ? `<div class="dato mt">${esc(reg.comentario)}</div>` : ""}
    </div>
    ${cuerpo}
    ${indicadoresDiaHTML(fecha)}
    ${graficos}
    ${reg.tieneFoto ? `<div class="ficha-seccion">Foto del día</div><div id="ficha-foto" class="dato">Cargando…</div>` : ""}
    ${reg.motivoSinFoto ? `<div class="dato mt">Sin foto: ${esc(reg.motivoSinFoto)}</div>` : ""}
  `, { desde: desdeEl });

  // Dibujar los gráficos una vez montados
  requestAnimationFrame(() => {
    $$("#hoja-contenido [data-prog]").forEach((cv) => {
      dibujarGraficoPeso(cv, progresionDe(cv.dataset.prog), null);
    });
  });

  if (reg.tieneFoto) {
    getDoc(refs.diaMedia(fecha, "foto")).then((snap) => {
      const caja = $("#ficha-foto");
      if (caja && snap.exists()) {
        caja.outerHTML = `<img class="dia-foto" src="${snap.data().data}" alt="Foto del día">` +
          (snap.data().hora ? `<div class="foto-hora">${fmtHora(snap.data().hora)}</div>` : "");
      } else if (caja) caja.textContent = "Sin foto disponible";
    });
  }
}

function indicadoresDiaHTML(fecha) {
  const reg = S.dias.get(fecha);
  const chips = [];
  if (reg?.aguaMl) chips.push(`Agua ${reg.aguaMl} ml`);
  if (reg?.hambre) chips.push(`Hambre ${reg.hambre}/5`);
  if (reg?.cansancio) chips.push(`Cansancio ${reg.cansancio}/5`);
  const pesaje = S.pesajes.get(fecha);
  if (pesaje) chips.push(`Peso ${pesaje.pesoKg} kg`);
  return chips.length
    ? `<div class="ficha-seccion">Indicadores</div>
       <div class="ficha-indicadores">${chips.map((c) => `<span class="logro num">${esc(c)}</span>`).join("")}</div>`
    : "";
}

/* ==========================================================================
   PROGRESO — Peso + Historial
   ========================================================================== */
function renderProgreso() {
  const seg = localStorage.getItem("progresoSeg") || "peso";
  $$("#progreso-segmentos button").forEach((b) => b.classList.toggle("sel", b.dataset.seg === seg));
  $("#progreso-peso").classList.toggle("oculta", seg !== "peso");
  $("#progreso-historial").classList.toggle("oculta", seg !== "historial");
  if (seg === "peso") renderPeso();
  else renderHistorial();
}

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
  const cont = $("#progreso-peso");
  const lista = pesajesOrdenados();
  const objetivo = S.config.pesoObjetivo;
  const ultimo = lista[lista.length - 1];
  const tendencia = lista.length ? tendenciaEn(lista, lista.length - 1) : null;
  const esLunes = diaSemanaDe(hoyISO()) === CONFIG.pesajeDia;

  let resumenObjetivo = "";
  if (objetivo && tendencia) {
    const dif = tendencia - objetivo;
    if (dif > 0.05) resumenObjetivo = `Te faltan ${dif.toFixed(1).replace(".", ",")} kg para el objetivo`;
    else if (dif < -0.05) resumenObjetivo = `Objetivo cumplido y superado: estás ${(-dif).toFixed(1).replace(".", ",")} kg por debajo`;
    else resumenObjetivo = "Estás justo en tu peso objetivo";
    if (lista.length >= 2) {
      const delta = lista[0].pesoKg - ultimo.pesoKg;
      if (delta > 0.05) resumenObjetivo += ` · bajaste ${delta.toFixed(1).replace(".", ",")} kg desde el inicio`;
      else if (delta < -0.05) resumenObjetivo += ` · subiste ${(-delta).toFixed(1).replace(".", ",")} kg desde el inicio`;
    }
  }

  cont.innerHTML = `
    ${esLunes && !S.pesajes.has(hoyISO()) ? `<p class="vacio-direccion">Hoy es lunes: día de pesaje.</p>` : ""}
    <button id="btn-pesaje" class="btn btn-rojo btn-grande">Registrar pesaje</button>
    <div class="peso-resumen">
      <div class="peso-tarjeta"><strong>${ultimo ? ultimo.pesoKg.toFixed(1).replace(".", ",") : "—"}</strong><span>Último (kg)</span></div>
      <div class="peso-tarjeta"><strong>${tendencia ? tendencia.toFixed(1).replace(".", ",") : "—"}</strong><span>Tendencia</span></div>
      <div class="peso-tarjeta"><strong>${objetivo ?? "—"}</strong><span>Objetivo</span></div>
    </div>
    ${resumenObjetivo ? `<p class="dato centrado num">${resumenObjetivo}</p>` : ""}
    <div class="seccion-titulo">Evolución</div>
    ${lista.length >= 2 ? `<canvas id="peso-canvas" class="grafico"></canvas>`
      : `<p class="vacio-direccion">Pesate el lunes y empezamos a medir. Con dos pesajes aparece el gráfico.</p>`}
    <div class="seccion-titulo">Espejo — comparador</div>
    <div id="comparador-zona"><p class="dato">Cargando fotos…</p></div>`;

  $("#btn-pesaje").onclick = () => hojaPesaje();
  if (lista.length >= 2) dibujarGraficoPeso($("#peso-canvas"), lista, objetivo);
  renderComparador();
}

function dibujarGraficoPeso(canvas, lista, objetivo) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 340, H = canvas.clientHeight || 200;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const cTexto2 = css.getPropertyValue("--texto2").trim();
  const cTexto = css.getPropertyValue("--texto").trim();
  const cRojo = css.getPropertyValue("--rojo").trim();

  const valores = lista.map((x) => x.pesoKg);
  const tend = lista.map((_, i) => tendenciaEn(lista, i));
  const min = Math.min(...valores, ...(objetivo ? [objetivo] : [])) - 1;
  const max = Math.max(...valores, ...(objetivo ? [objetivo] : [])) + 1;
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

  ctx.fillStyle = cTexto2;
  lista.forEach((p, i) => { ctx.beginPath(); ctx.arc(x(i), y(p.pesoKg), 2.5, 0, 7); ctx.fill(); });

  if (objetivo) {
    ctx.strokeStyle = cRojo; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(M.izq, y(objetivo)); ctx.lineTo(W - M.der, y(objetivo)); ctx.stroke();
    ctx.setLineDash([]);
  }
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
      <div class="foto-zona" id="pes-balanza-zona" style="border-color:var(--separador);color:var(--texto2)">${previo?.tieneBalanza ? "Foto ya guardada · tocá para cambiar" : "Tocá para sacar la foto"}</div>
      <input id="pes-balanza" type="file" accept="image/*" capture="environment" style="display:none"></div>
    <div class="campo"><label>Foto del espejo</label>
      <div class="foto-zona" id="pes-espejo-zona" style="border-color:var(--separador);color:var(--texto2)">${previo?.tieneEspejo ? "Foto ya guardada · tocá para cambiar" : "Tocá para sacar la foto"}</div>
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
    vibrar("confirmar");
    toast("Pesaje guardado.");
    refrescarVistaActual();
  };
}

async function renderComparador() {
  const zona = $("#comparador-zona");
  if (!zona) return;
  const conEspejo = pesajesOrdenados().filter((p) => p.tieneEspejo);
  if (conEspejo.length < 2) {
    zona.innerHTML = `<p class="vacio-direccion">Con dos fotos de espejo aparece el comparador. La primera contra la última: ahí se ve el cambio.</p>`;
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
    $("#comp-caja").innerHTML = `<p class="dato">Cargando…</p>`;
    const [sa, sb] = await Promise.all([
      getDoc(refs.pesajeMedia(fa, "espejo")), getDoc(refs.pesajeMedia(fb, "espejo"))]);
    if (!sa.exists() || !sb.exists()) { $("#comp-caja").innerHTML = `<p class="dato">Falta alguna foto.</p>`; return; }
    $("#comp-caja").innerHTML = `
      <div class="comparador">
        <img src="${sa.data().data}" alt="antes">
        <div class="comp-encima" id="comp-encima" style="width:50%">
          <img src="${sb.data().data}" alt="después"></div>
        <div class="comp-linea" id="comp-linea" style="left:50%"></div>
      </div>
      <input id="comp-rango" class="comp-slider" type="range" min="0" max="100" value="50" aria-label="Comparar fotos">
      <div class="comp-fechas"><span>${fmtFechaCorta(fa)}</span><span>${fmtFechaCorta(fb)}</span></div>`;
    $("#comp-rango").oninput = (e) => {
      $("#comp-encima").style.width = `${e.target.value}%`;
      $("#comp-linea").style.left = `${e.target.value}%`;
    };
  };
  $("#comp-a").onchange = cargar;
  $("#comp-b").onchange = cargar;
  await cargar();
}

/* --- Historial --- */
function progresionDe(id) {
  const puntos = [];
  for (const f of [...S.dias.keys()].sort()) {
    const reg = regReal(f);
    const ss = reg?.series?.[id];
    if (!ss) continue;
    const hechas = ss.filter((x) => x.hecha);
    if (!hechas.length) continue;
    puntos.push({ fecha: f, pesoKg: Math.max(...hechas.map((x) => x.peso || 0)) });
  }
  return puntos;
}

function renderHistorial() {
  const cont = $("#progreso-historial");
  const ejercicios = [...MUSCULACION.bloques.flatMap((b) => b.ejercicios), ...INTERVALOS.circuito];
  const sel = localStorage.getItem("histEj") || "prensa-pos1";

  cont.innerHTML = `
    <div class="seccion-titulo">Progresión de carga</div>
    <div class="campo"><select id="hist-ej">
      ${ejercicios.map((e) => `<option value="${e.id}" ${e.id === sel ? "selected" : ""}>${esc(e.nombre)}</option>`).join("")}
    </select></div>
    <div id="hist-canvas-zona"><canvas id="hist-canvas" class="grafico"></canvas></div>
    <div class="seccion-titulo">Récords personales</div>
    <div id="pr-lista" class="pr-lista"></div>
    <div class="seccion-titulo">Álbum del gym</div>
    <div class="cal-nav">
      <button id="alb-prev" class="btn-icono" aria-label="Mes anterior">‹</button>
      <span id="alb-titulo"></span>
      <button id="alb-sig" class="btn-icono" aria-label="Mes siguiente">›</button>
    </div>
    <div id="album" class="album"></div>
    <div class="seccion-titulo">Exportar</div>
    <div class="hoja-acciones" style="margin-top:8px">
      <button id="pdf-dia" class="btn btn-borde btn-grande">PDF del día (ficha completa)</button>
      <button id="pdf-semana" class="btn btn-borde btn-grande">PDF de la semana</button>
    </div>`;

  $("#hist-ej").onchange = (e) => { localStorage.setItem("histEj", e.target.value); renderHistorial(); };
  const puntos = progresionDe(sel);
  if (puntos.length >= 2) dibujarGraficoPeso($("#hist-canvas"), puntos, null);
  else $("#hist-canvas-zona").innerHTML = `<p class="vacio-direccion">Con dos sesiones de este ejercicio aparece la curva. Seguí sumando.</p>`;
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

function renderPRs(caja) {
  const ejercicios = [...MUSCULACION.bloques.flatMap((b) => b.ejercicios), ...INTERVALOS.circuito];
  const max = {};
  for (const f of S.dias.keys()) {
    const reg = regReal(f);
    if (!reg?.series) continue;
    for (const [id, ss] of Object.entries(reg.series))
      for (const x of ss)
        if (x.hecha && (!max[id] || x.peso > max[id].peso)) max[id] = { peso: x.peso, fecha: f };
  }
  caja.innerHTML = ejercicios.filter((e) => max[e.id]).map((e) => `
    <div class="pr-fila"><span>${esc(e.nombre)}</span>
      <strong class="num">${max[e.id].peso} kg <span class="dato" style="font-weight:400">· ${fmtFechaCorta(max[e.id].fecha)}</span></strong></div>`).join("")
    || `<p class="vacio-direccion">Todavía no hay récords. El primero cae esta semana.</p>`;
}

async function renderAlbum() {
  $("#alb-titulo").textContent = `${MESES_NOMBRE[Number(S.albumMes.slice(5)) - 1]} ${S.albumMes.slice(0, 4)}`;
  const album = $("#album");
  const conFoto = [...S.dias.keys()]
    .filter((f) => f.startsWith(S.albumMes) && regReal(f)?.tieneFoto).sort();
  if (!conFoto.length) {
    album.innerHTML = `<p class="vacio-direccion" style="grid-column:1/-1">Sin fotos este mes. La próxima sesión deja la primera.</p>`;
    return;
  }
  album.innerHTML = conFoto.map((f) => `<div data-alb="${f}" class="esq alb-esq"></div>`).join("");
  for (const f of conFoto) {
    getDoc(refs.diaMedia(f, "foto")).then((snap) => {
      const celda = album.querySelector(`[data-alb="${f}"]`);
      if (celda && snap.exists()) celda.outerHTML = `<img src="${snap.data().data}" alt="${f}" title="${f}">`;
    });
  }
}

/* ==========================================================================
   PDF — la ficha exportada, con los dibujos
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

/* jsPDF no acepta WebP: se convierte a JPEG por canvas y se cachea */
const cacheJPEG = new Map();
function imagenJPEG(nombre) {
  if (cacheJPEG.has(nombre)) return Promise.resolve(cacheJPEG.get(nombre));
  return new Promise((resolver) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      const out = { data: canvas.toDataURL("image/jpeg", 0.85), w: img.naturalWidth, h: img.naturalHeight };
      cacheJPEG.set(nombre, out);
      resolver(out);
    };
    img.onerror = () => resolver(null);
    img.src = `img/ejercicios/${nombre}`;
  });
}

function lineasResumenAcumulado() {
  const { racha, cerradas } = calcularRacha();
  const completas = cerradas.filter((s) => s.completa).length;
  const totalSemanas = cerradas.length + 1;
  let sesiones = 0, recuperadas = 0, caminatas = 0;
  const porRutina = {};
  for (const f of [...S.dias.keys()].sort()) {
    const reg = regReal(f);
    if (!reg) continue;
    if (reg.estado === "hecha" || reg.estado === "recuperada") {
      sesiones++;
      if (reg.estado === "recuperada") recuperadas++;
      if (reg.rutinaId) {
        porRutina[reg.rutinaId] = porRutina[reg.rutinaId] || { veces: 0, ultima: f };
        porRutina[reg.rutinaId].veces++;
        porRutina[reg.rutinaId].ultima = f;
      }
    }
    if (reg.caminata?.minutos && planDelDia(f).tipo === "descanso") caminatas++;
  }
  const filas = [
    ["Semanas usando la app", String(totalSemanas)],
    ["Semanas completas", String(completas)],
    ["Racha actual", `${racha} ${racha === 1 ? "semana" : "semanas"} · ${rangoDe(racha).nombre}`],
    ["", ""],
  ];
  for (const [id, x] of Object.entries(porRutina)) {
    filas.push([RUTINAS[id]?.nombre || id, `${x.veces} veces · última ${fmtFechaLarga(x.ultima)}`]);
  }
  filas.push(["", ""], ["Sesiones totales", String(sesiones)],
    ["Recuperadas", String(recuperadas)], ["Caminatas en descanso", String(caminatas)]);
  return filas;
}

async function exportarPDF(tipo) {
  let jspdf;
  try { jspdf = await cargarJsPDF(); }
  catch (e) { toast(e.message, "toast-alerta"); return; }
  toast("Armando el PDF…", "", 2500);
  const pdf = new jspdf.jsPDF();
  const MARGEN = 15, ANCHO = 180;
  let y = 16;

  const salto = (necesita) => {
    if (y + necesita > 282) { pdf.addPage(); y = 16; }
  };
  const texto = (t, { tam = 11, negrita = false, color = [29, 29, 31], x = MARGEN, ancho = ANCHO } = {}) => {
    pdf.setFont("helvetica", negrita ? "bold" : "normal");
    pdf.setFontSize(tam);
    pdf.setTextColor(...color);
    const partes = pdf.splitTextToSize(t, ancho);
    for (const p of partes) { salto(6); pdf.text(p, x, y); y += tam * 0.5; }
    return partes.length;
  };
  const seccion = (t) => {
    y += 6; salto(10);
    pdf.setDrawColor(220); pdf.line(MARGEN, y, MARGEN + ANCHO, y); y += 5;
    texto(t.toUpperCase(), { tam: 9, negrita: true, color: [110, 110, 115] });
    y += 1;
  };

  const encabezado = () => {
    const { racha } = calcularRacha();
    texto("MI ENTRENADOR", { tam: 9, negrita: true, color: [214, 40, 40] });
    y += 1;
    texto(`${rangoDe(racha).nombre} · ${racha} ${racha === 1 ? "semana" : "semanas"} en racha`, { tam: 10, color: [110, 110, 115] });
    y += 2;
  };

  /* Una fila de ejercicio con su dibujo, sin cortarse entre páginas */
  const filaEjercicio = async (e, reg, num) => {
    const img = await imagenJPEG(e.img);
    const imgW = 62;
    const imgH = img ? Math.min(50, imgW * (img.h / img.w)) : 0;
    const textW = ANCHO - imgW - 14 - 8;
    const lineasTexto = 3 + (e.cues || []).length + (reg.notas?.[e.id] || reg.esfuerzo?.[e.id] ? 1 : 0);
    const altoFila = Math.max(imgH + 4, lineasTexto * 5 + 8);
    salto(altoFila + 4);
    const y0 = y;

    pdf.setFont("helvetica", "bold"); pdf.setFontSize(16); pdf.setTextColor(214, 40, 40);
    pdf.text(String(num), MARGEN, y0 + 6);
    const xT = MARGEN + 10;
    let yT = y0 + 5;
    pdf.setFontSize(12); pdf.setTextColor(29, 29, 31);
    pdf.text(e.nombre, xT, yT); yT += 5;
    if (e.subtitulo) {
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(110, 110, 115);
      pdf.text(e.subtitulo, xT, yT); yT += 4.5;
    }
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(10); pdf.setTextColor(29, 29, 31);
    pdf.text(seriesTexto(e, reg.series?.[e.id]), xT, yT); yT += 5;
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(110, 110, 115);
    for (const c of (e.cues || [])) {
      const ls = pdf.splitTextToSize("· " + c, textW - 10);
      for (const l of ls) { pdf.text(l, xT, yT); yT += 4.2; }
    }
    const pie = [];
    if (reg.esfuerzo?.[e.id]) pie.push(`Esfuerzo: ${({ sobrado: "sobrado", justo: "justo", roto: "se rompió la técnica" })[reg.esfuerzo[e.id]]}`);
    if (reg.notas?.[e.id]) pie.push(`Nota: ${reg.notas[e.id]}`);
    if (pie.length) {
      const ls = pdf.splitTextToSize(pie.join(" · "), textW - 10);
      for (const l of ls) { pdf.text(l, xT, yT); yT += 4.2; }
    }
    if (img) pdf.addImage(img.data, "JPEG", MARGEN + ANCHO - imgW, y0, imgW, imgH);
    y = y0 + altoFila;
    pdf.setDrawColor(235); pdf.line(MARGEN, y, MARGEN + ANCHO, y);
    y += 4;
  };

  const fichaDia = async (f, conImagenes) => {
    const reg = regReal(f);
    texto(fmtFechaLarga(f), { tam: 15, negrita: true });
    if (!reg || !sesionRegistrada(f)) {
      texto(({ descanso: "Descanso", "descanso-caminata": "Descanso con caminata", "causa-mayor": `Causa mayor: ${reg?.causaMayor?.motivo || ""}`, fallada: "Fallada", pendiente: "Pendiente" })[estadoDia(f)] || "Sin registro", { color: [110, 110, 115] });
      if (reg?.caminata?.minutos) texto(`Caminata: ${reg.caminata.minutos} min`, { color: [110, 110, 115] });
      y += 2;
      return;
    }
    const r = RUTINAS[reg.rutinaId];
    const datos = [r.nombre];
    if (reg.inicio && reg.fin) datos.push(`${fmtHora(reg.inicio)}-${fmtHora(reg.fin)}`, fmtDuracion((reg.fin - reg.inicio) / 1000));
    const vol = volumenSesion(reg);
    if (vol) datos.push(`${fmtKg(vol)} kg movidos`);
    texto(datos.join("  ·  "), { tam: 10, color: [110, 110, 115] });
    const comp = comparacionConAnterior(f, reg);
    if (comp) texto(comp, { tam: 10, color: [110, 110, 115] });
    y += 2;

    if (reg.rutinaId === "musculacion") {
      let n = 1;
      for (const b of MUSCULACION.bloques) {
        seccion(b.nombre);
        for (const e of b.ejercicios) {
          if (conImagenes) await filaEjercicio(e, reg, n++);
          else texto(`${n++}. ${e.nombre}: ${seriesTexto(e, reg.series?.[e.id])}`, { tam: 10 });
        }
      }
      seccion("Cierre");
      texto(MUSCULACION.cierre.detalle, { tam: 10, color: [110, 110, 115] });
    } else {
      seccion("El circuito");
      let n = 1;
      for (const e of INTERVALOS.circuito) {
        if (conImagenes) await filaEjercicio(e, reg, n++);
        else texto(`${n++}. ${e.nombre}: ${e.reps} reps${e.peso ? ` · ${e.peso} kg` : ""}`, { tam: 10 });
      }
      if (reg.vueltas) {
        seccion("Vueltas por bloque");
        texto(reg.vueltas.map((v, i) => `Vuelta ${i + 1}: ${v}`).join("  ·  "), { tam: 10 });
      }
    }
    // Indicadores del día en una fila
    const chips = [];
    if (reg.aguaMl) chips.push(`Agua ${reg.aguaMl} ml`);
    if (reg.hambre) chips.push(`Hambre ${reg.hambre}/5`);
    if (reg.cansancio) chips.push(`Cansancio ${reg.cansancio}/5`);
    const pesaje = S.pesajes.get(f);
    if (pesaje) chips.push(`Peso corporal ${pesaje.pesoKg} kg`);
    if (chips.length) { seccion("Indicadores"); texto(chips.join("   ·   "), { tam: 10 }); }
    if (reg.comentario) texto(`"${reg.comentario}"`, { tam: 10, color: [110, 110, 115] });
  };

  const resumenAcumulado = () => {
    seccion("Resumen");
    for (const [k, v] of lineasResumenAcumulado()) {
      if (!k) { y += 2; continue; }
      salto(6);
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); pdf.setTextColor(110, 110, 115);
      pdf.text(k, MARGEN, y);
      pdf.setFont("helvetica", "bold"); pdf.setTextColor(29, 29, 31);
      pdf.text(v, MARGEN + 75, y);
      y += 5.5;
    }
  };

  try {
    if (tipo === "dia") {
      const conDatos = [...S.dias.keys()].filter((f) => sesionRegistrada(f)).sort();
      const f = conDatos[conDatos.length - 1] || hoyISO();
      encabezado();
      await fichaDia(f, true);
      resumenAcumulado();
      pdf.save(`entrenador-${f}.pdf`);
    } else {
      const lunes = lunesDe(hoyISO());
      const r = resumenSemana(lunes);
      encabezado();
      texto(`Semana del ${fmtFechaCorta(lunes)} al ${fmtFechaCorta(r.domingo)}  ·  ${r.sesiones}/${CONFIG.sesionesPorSemana} sesiones${r.mencionHonor ? "  ·  Mención de honor" : ""}`, { tam: 12, negrita: true });
      y += 2;
      for (let i = 0; i < 7; i++) {
        const f = sumarDias(lunes, i);
        if (f > hoyISO()) break;
        await fichaDia(f, false);
        y += 2;
      }
      resumenAcumulado();
      pdf.save(`entrenador-semana-${claveSemana(lunes)}.pdf`);
    }
  } catch (e) {
    toast("No se pudo armar el PDF: " + (e?.message || e), "toast-alerta");
  }
}

/* ==========================================================================
   AJUSTES — configuración + modo prueba
   ========================================================================== */
function imagenesDeRutinas() {
  const set = new Set();
  for (const e of INTERVALOS.entradaEnCalor.ejercicios) set.add(e.img);
  set.add(INTERVALOS.entradaEnCalor.imgResumen);
  for (const e of INTERVALOS.circuito) set.add(e.img);
  for (const e of MUSCULACION.entradaEnCalor.ejercicios) set.add(e.img);
  set.add(MUSCULACION.entradaEnCalor.imgResumen);
  for (const b of MUSCULACION.bloques) for (const e of b.ejercicios) set.add(e.img);
  set.add(MUSCULACION.cierre.img);
  return [...set];
}

function renderAjustes() {
  const c = S.config;
  const tema = localStorage.getItem("tema") || "auto";
  const cont = $("#ajustes-contenido");
  cont.innerHTML = `
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
    <button id="cfg-guardar" class="btn btn-primario btn-grande mt">Guardar</button>

    <div class="seccion-titulo">Modo prueba</div>
    <div class="config-fila"><span>Modo prueba<small>Timers a 10 s · las sesiones no cuentan</small></span>
      <span class="interruptor"><input id="cfg-prueba" type="checkbox" ${modoPrueba() ? "checked" : ""}><i></i></span></div>
    <div class="hoja-acciones" style="margin-top:8px">
      <button id="cfg-campana" class="btn btn-borde btn-grande">Probar campana</button>
      <button id="cfg-imagenes" class="btn btn-borde btn-grande">Ver imágenes de ejercicios</button>
    </div>
    <div id="cfg-grilla-imgs" class="oculta"></div>

    <div class="seccion-titulo">Cuenta</div>
    <div class="config-fila"><span>${esc(S.user?.email || "")}</span>
      <button id="cfg-salir" class="btn btn-texto">Cerrar sesión</button></div>
    <div class="config-fila"><span>Diagnóstico de sesión<small>Últimos movimientos del login</small></span>
      <button id="cfg-diag" class="btn btn-texto">Ver</button></div>
    <div id="cfg-diag-caja" class="oculta"></div>
    <p class="dato centrado mt">Rutinas v${RUTINAS_VERSION} · fecha de inicio ${fmtFechaCorta(pisoFecha())}
      <br>Día calendario según ${TZ} · hoy es ${hoyISO()}</p>`;

  $("#cfg-tema").querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      aplicarTema(b.dataset.t, true);
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
    toast("Configuración guardada.");
  };
  $("#cfg-prueba").onchange = (e) => {
    localStorage.setItem("modoPrueba", e.target.checked ? "1" : "0");
    toast(e.target.checked
      ? "Modo prueba activo: timers a 10 s, las sesiones no cuentan."
      : "Modo prueba desactivado.");
  };
  $("#cfg-campana").onclick = () => { desbloquearAudio(); setTimeout(sonarCampana, 150); };
  $("#cfg-imagenes").onclick = () => {
    const g = $("#cfg-grilla-imgs");
    if (!g.classList.contains("oculta")) { g.classList.add("oculta"); return; }
    g.innerHTML = `<div class="prueba-grilla">
      ${imagenesDeRutinas().map((img) => `
        <figure><img src="img/ejercicios/${img}" alt="${img}"
          onerror="this.style.outline='2px solid var(--rojo)';this.alt='NO CARGA'">
        <figcaption>${img}</figcaption></figure>`).join("")}
    </div>`;
    g.classList.remove("oculta");
  };
  $("#cfg-diag").onclick = () => {
    const caja = $("#cfg-diag-caja");
    if (!caja.classList.contains("oculta")) { caja.classList.add("oculta"); return; }
    const zona = Intl.DateTimeFormat().resolvedOptions().timeZone || "desconocida";
    caja.innerHTML = `
      <div class="diag">
        <div class="dato">Zona horaria del teléfono: ${esc(zona)}</div>
        <div class="dato">Día calendario que usa la app: ${hoyISO()} (${TZ})</div>
        <div class="dato">Modo: ${esStandalone() ? "instalada" : "navegador"}${esIOS() ? " · iOS" : ""}</div>
        <pre>${esc(AUTH_LOG.join("\n") || "sin registros")}</pre>
      </div>`;
    caja.classList.remove("oculta");
  };
  $("#cfg-salir").onclick = () => {
    abrirHoja(`
      <h3>¿Cerrar sesión?</h3>
      <p class="texto-2">Tus datos quedan guardados en la nube. Vas a tener que
      entrar de nuevo con Google para volver a verlos.</p>
      <div class="hoja-acciones">
        <button id="salir-confirmar" class="btn btn-rojo btn-grande">Cerrar sesión</button>
        <button id="salir-no" class="btn btn-borde btn-grande">Quedarme adentro</button>
      </div>`);
    $("#salir-no").onclick = () => cerrarHoja(true);
    $("#salir-confirmar").onclick = async () => { cerrarHoja(true); await cerrarSesionManual(); };
  };
}

/* ==========================================================================
   EVENTOS GLOBALES Y ARRANQUE
   ========================================================================== */
$("#btn-login").addEventListener("click", entrar);
$("#btn-entreno-salir").addEventListener("click", salirDeSesion);
$("#tab-mas").addEventListener("click", () => { vibrar("leve"); hojaMas(); });
$$(".tab").forEach((t) => t.addEventListener("click", () => irA(t.dataset.tab)));
$$("#progreso-segmentos button").forEach((b) => {
  b.addEventListener("click", () => {
    localStorage.setItem("progresoSeg", b.dataset.seg);
    renderProgreso();
  });
});
$("#cal-prev").addEventListener("click", () => {
  const b = parseISO(S.calMes); S.calMes = fmtISO(new Date(b.getFullYear(), b.getMonth() - 1, 1));
  renderCalendario();
});
$("#cal-sig").addEventListener("click", () => {
  const b = parseISO(S.calMes); S.calMes = fmtISO(new Date(b.getFullYear(), b.getMonth() + 1, 1));
  renderCalendario();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { });
  });
}

/* Si vuelve la conexión estando en el login, se reintenta armar el botón. */
window.addEventListener("online", () => {
  logAuth("volvió la conexión");
  if (vistaActual === "login") { $("#login-aviso").classList.add("oculta"); prepararGoogle(); }
});

/* Arranque: pantalla de carga hasta que la autenticación se resuelva */
mostrarVista("carga");
if (firebaseConfig.apiKey.startsWith("PEGAR")) {
  mostrarVista("login");
  $("#login-error").innerHTML = "<b>Falta configurar.</b><br>Completá firebase-config.js con las credenciales del proyecto.";
  $("#login-error").classList.remove("oculta");
} else {
  iniciarFirebase();

  // Cinturón de seguridad: si a los 12 segundos seguimos mirando el esqueleto,
  // algo se colgó. Antes que dejar la pantalla cargando para siempre, se dice
  // qué pasó y se ofrece salida. No cierra sesión: solo informa.
  setTimeout(() => {
    if (vistaActual !== "carga" || S.cargado) return;
    logAuth("12 s sin resolver el arranque");
    const carga = $("#vista-carga");
    if ($("#carga-error")) return;
    const caja = el("div", "login-error",
      `<b>Está tardando más de lo normal.</b><br>` +
      (S.user
        ? "La sesión está bien, pero los datos no llegan. Puede ser la conexión."
        : "No se pudo confirmar la sesión.") +
      "<br><br>Podés reintentar, o entrar con Google de nuevo.");
    caja.id = "carga-error";
    const reintentar = el("button", "btn btn-primario btn-grande mt", "Reintentar");
    reintentar.onclick = () => location.reload();
    const irLogin = el("button", "btn btn-texto", "Ir a la pantalla de login");
    irLogin.style.width = "100%";
    irLogin.onclick = () => { mostrarVista("login"); prepararGoogle(); };
    carga.append(caja, reintentar, irLogin);
  }, 12000);
}
