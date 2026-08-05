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
/* El día calendario argentino de un instante cualquiera. */
function isoDeInstante(ts) {
  const p = _partes(_fmtDiaTZ, new Date(ts));
  return `${p.year}-${p.month}-${p.day}`;
}
/* "20:00" → 20. Los umbrales del día viven en rutinas.js, no sueltos acá. */
function horaDe(hhmm, siFalla) {
  const cruda = String(hhmm ?? "").split(":")[0].trim();
  if (!cruda) return siFalla;               // sin la clave, vale el respaldo
  const n = Number(cruda);
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : siFalla;
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
/* ==========================================================================
   NÚMEROS — una sola puerta de entrada y una sola de salida
   --------------------------------------------------------------------------
   El teclado en español entrega coma, y `input type="number"` descarta lo que
   no entiende: por eso no se podían escribir decimales. Los campos numéricos
   pasan a type="text" con inputmode="decimal", y todo lo que se escribe se lee
   por acá, que acepta coma y punto.
   ========================================================================== */
const DECIMALES = { peso: 3, objetivo: 3, carga: 1, ml: 0 };

function leerNumero(entrada, tipo = "carga") {
  const crudo = (typeof entrada === "string" ? entrada : entrada?.value ?? "").trim();
  if (!crudo) return null;
  const n = Number(crudo.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const dec = DECIMALES[tipo] ?? 1;
  return Math.round(n * 10 ** dec) / 10 ** dec;
}

/* Siempre con coma y sin ceros de más: 84,25 kg y no 84,250 kg. */
function fmtNumero(n, tipo = "carga") {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString("es-AR", {
    minimumFractionDigits: 0, maximumFractionDigits: DECIMALES[tipo] ?? 1,
  });
}
function fmtKg(n) { return fmtNumero(n, "carga"); }
function fmtLitros(ml) { return (ml / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 }); }

const movReducido = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* --- Toasts --- */
function toast(texto, tipo = "", dur = 4200) {
  const t = el("div", `toast ${tipo}`, esc(texto));
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), dur);
}

/* ==========================================================================
   DESHACER — un solo mecanismo para todas las acciones que borran o avanzan
   --------------------------------------------------------------------------
   Ocho segundos con un botón. `revertir` tiene que devolver el estado exacto
   anterior, incluidos los temporizadores y lo ya escrito en Firestore.
   ========================================================================== */
let deshacerTimer = null;

function ofrecerDeshacer(texto, revertir) {
  const caja = $("#deshacer");
  if (!caja) return;
  clearTimeout(deshacerTimer);
  caja.innerHTML = `<span>${esc(texto)}</span>`;
  const btn = el("button", "btn btn-medio", "Deshacer");
  caja.appendChild(btn);
  caja.classList.remove("oculta");

  const cerrar = () => { caja.classList.add("oculta"); caja.innerHTML = ""; };
  btn.onclick = async () => {
    clearTimeout(deshacerTimer);
    btn.disabled = true;
    try { await revertir(); vibrar("leve"); }
    catch (e) { anotarProblema(`deshacer falló: ${e?.message || e}`); }
    cerrar();
  };
  deshacerTimer = setTimeout(cerrar, 8000);
}

/* ==========================================================================
   BITÁCORA DE PROBLEMAS — entrenando no se puede anotar nada a mano
   ========================================================================== */
function anotarProblema(texto, automatico = true) {
  const nota = {
    hora: Date.now(), pantalla: vistaActual,
    texto: String(texto || "").slice(0, 400), automatico,
  };
  try {
    const previas = JSON.parse(localStorage.getItem("bitacora") || "[]");
    previas.push(nota);
    localStorage.setItem("bitacora", JSON.stringify(previas.slice(-80)));
  } catch (_) { }
  if (automatico) console.warn("[problema]", nota.texto);
}
function leerBitacora() {
  try { return JSON.parse(localStorage.getItem("bitacora") || "[]"); }
  catch (_) { return []; }
}
function borrarBitacora() { localStorage.removeItem("bitacora"); }

/* Anotar a mano, en dos segundos, sin salir de donde estaba. */
function hojaAnotarProblema() {
  const donde = vistaActual;
  abrirHoja(`
    <h3>¿Qué pasó?</h3>
    <p class="texto-2">Una línea alcanza. Queda con la hora y la pantalla
    (${esc(donde)}) para poder reconstruirlo después.</p>
    <div class="campo">
      <textarea id="ap-texto" placeholder="Ej: no sonó la campana del descanso"></textarea>
    </div>
    <div class="hoja-acciones">
      <button id="ap-guardar" class="btn btn-primario btn-grande">Anotar</button>
    </div>`);
  setTimeout(() => $("#ap-texto")?.focus(), 250);
  $("#ap-guardar").onclick = () => {
    const texto = $("#ap-texto").value.trim();
    if (!texto) { $("#ap-texto").focus(); return; }
    anotarProblema(texto, false);
    cerrarHoja(true);
    vibrar("confirmar");
    toast("Anotado.");
    if (vistaActual === "ajustes") renderAjustes();
  };
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
  // estado: "lleno" | "vacio" | "rojo" | "hecho" (verde) | "extra" (azul)
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
/* Claro y oscuro siguen al sistema y punto: no hay selector. Se limpia el
   `data-theme` que pudo dejar una versión anterior. */
document.documentElement.removeAttribute("data-theme");
localStorage.removeItem("tema");

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
      try { localStorage.setItem("ultimoUsuario", user.email || user.uid); } catch (_) { }
      pedirAlmacenamientoPersistente();
      if (cambioDeUsuario) {
        prepararRefs();
        conectarDatos();
      }
      if (!S.cargado) mostrarVista("carga");
    } else if (!navigator.onLine && localStorage.getItem("ultimoUsuario")) {
      // Sin red y con un usuario conocido: NO se manda al login. Esperamos a
      // que vuelva la conexión o a que Firebase restaure la sesión guardada.
      logAuth("sin red y con usuario guardado: no se muestra el login");
      mostrarEsperaSinConexion();
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

/* Sin esto el navegador puede borrar los datos del sitio cuando le falta
   espacio, y con ellos la sesión. Se pide una sola vez. */
async function pedirAlmacenamientoPersistente() {
  if (localStorage.getItem("almacenamientoPedido")) return;
  try {
    if (navigator.storage?.persist) {
      const ok = await navigator.storage.persisted() || await navigator.storage.persist();
      logAuth(`almacenamiento persistente: ${ok ? "concedido" : "denegado"}`);
    }
  } catch (_) { }
  try { localStorage.setItem("almacenamientoPedido", "1"); } catch (_) { }
}

/* Sin red y con usuario conocido: cartel de espera, nunca el login. */
function mostrarEsperaSinConexion() {
  mostrarVista("carga");
  const carga = $("#vista-carga");
  if ($("#espera-sin-red")) return;
  const caja = el("div", "login-error", `<b>Sin conexión.</b><br>` +
    `Estás como ${esc(localStorage.getItem("ultimoUsuario") || "")}. ` +
    `En cuanto vuelva internet seguimos: no hace falta volver a entrar.`);
  caja.id = "espera-sin-red";
  carga.appendChild(caja);
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

/* El botón de respaldo aparece SOLO si Google no llegó a dibujar el suyo.
   Nunca los dos juntos. */
function mostrarRespaldoLogin(motivo) {
  $("#btn-login")?.classList.remove("oculta");
  logAuth(`respaldo de login visible: ${motivo}`);
}

async function prepararGoogle() {
  if (gisListo) return;
  const cid = (googleClientId || "").trim();

  if (!cid || cid.startsWith("PEGAR")) {
    avisoLogin("Falta pegar el Client ID de Google en firebase-config.js.");
    mostrarRespaldoLogin("sin Client ID");
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
    avisoLogin("No se pudo contactar a Google.");
    mostrarRespaldoLogin("script bloqueado");
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
    gisListo = true;
    logAuth("Google Identity Services listo");

    // El aviso automático va aparte: si falla, el botón ya está dibujado y
    // sirve igual, así que no es motivo para sacar el de respaldo.
    try { window.google.accounts.id.prompt(); }
    catch (e) { logAuth(`prompt() no salió: ${e?.message || e}`); }

    // Google dibuja el botón aunque el origen no esté autorizado: el rechazo
    // recién aparece al pedir el token, y no lanza ninguna excepción que se
    // pueda atrapar acá. Así que esto solo cubre el caso de que el botón no
    // llegue a dibujarse (script a medias, Client ID malformado), que si no
    // dejaría la pantalla con el botón de respaldo y sin explicación.
    setTimeout(() => {
      if ($("#gis-boton")?.childElementCount) return;
      avisoLogin("Google no llegó a dibujar su botón. Puede ser el Client ID " +
        `o que este origen (${location.origin}) no esté autorizado en ` +
        "console.cloud.google.com → Credenciales → Authorized JavaScript origins.");
      mostrarRespaldoLogin("no dibujó el botón");
    }, 2500);
  } catch (e) {
    logAuth(`GIS no se pudo inicializar: ${e?.message || e}`);
    avisoLogin("Google no respondió como se esperaba.");
    mostrarRespaldoLogin(`falló initialize: ${e?.message || e}`);
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
    // Con una sesión abierta de hoy se entra DIRECTO al entrenamiento, al mismo
    // ejercicio y la misma serie. Sin pasar por el inicio ni pedir un toque.
    const abierta = diaConSesionAbierta();
    if (abierta?.fecha === hoyISO() && !S.sesion && retomarSesion(abierta.fecha)) {
      toast("Seguimos donde estabas.", "", 3500);
    } else {
      irA("inicio", true);
      avisarCierreAutomatico();
    }
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

/* Feriados: los de rutinas.js (cargas masivas) más los marcados desde el
   calendario, que viven en la configuración. */
function esFeriado(iso) {
  if (typeof FERIADOS !== "undefined" && FERIADOS.includes(iso)) return true;
  return !!S.config?.feriados?.[iso];
}
function esFeriadoDeArchivo(iso) {
  return typeof FERIADOS !== "undefined" && FERIADOS.includes(iso);
}

/* El día ya cumplió el objetivo de agua. Vale también en días de descanso. */
function cumplioAgua(iso) {
  const reg = S.dias.get(iso);
  return (reg?.aguaMl || 0) >= (S.config?.aguaObjetivoMl || 2000);
}
/* Los días de descanso salen de CONFIG.diasDescanso y la rutina de cada día de
   entrenamiento sale de SEMANA. Las dos cosas viven en rutinas.js. */
function planDelDia(iso) {
  if (esFeriado(iso)) return { tipo: "descanso", feriado: true };
  const dow = diaSemanaDe(iso);
  if ((CONFIG.diasDescanso || []).includes(dow)) return { tipo: "descanso" };
  const p = SEMANA[dow];
  return p && p.tipo === "entreno" ? { ...p } : { tipo: "descanso" };
}

/* Si alguien edita rutinas.js y deja las dos listas peleadas, que se note. */
(function avisarSiRutinasNoCoinciden() {
  for (let d = 0; d < 7; d++) {
    const descansoEnConfig = (CONFIG.diasDescanso || []).includes(d);
    const descansoEnSemana = (SEMANA[d]?.tipo || "descanso") === "descanso";
    if (descansoEnConfig !== descansoEnSemana) {
      console.warn(`rutinas.js: el día ${DIAS_NOMBRE[d]} figura distinto en ` +
        `CONFIG.diasDescanso y en SEMANA. Manda diasDescanso.`);
    }
  }
})();

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
/* El objetivo de una semana NO es siempre cuatro: cada feriado y cada causa
   mayor que caiga en un día de entreno baja el objetivo en uno. Un viernes
   feriado deja la semana en 3 de 3. Si no queda ningún día de entreno, la
   semana no cuenta ni a favor ni en contra. */
function resumenSemana(lunes) {
  const dias = [];
  for (let i = 0; i < 7; i++) dias.push(sumarDias(lunes, i));

  let sesiones = 0, recuperadas = 0, caminatas = 0, causaEscudo = false;
  let objetivo = 0, feriados = 0, causasMayores = 0, diasAgua = 0;
  const faltantes = [];
  for (const f of dias) {
    const e = estadoDia(f);
    const plan = planDelDia(f);
    if (e === "hecha" || e === "a-medias") sesiones++;
    else if (e === "recuperada") { sesiones++; recuperadas++; }
    else if (e === "descanso-caminata") caminatas++;
    if (cumplioAgua(f)) diasAgua++;
    if (e === "causa-mayor" && regReal(f)?.causaMayor?.conEscudo) causaEscudo = true;

    if (f < pisoFecha()) continue;
    // El feriado ya volvió el día "descanso" en planDelDia, así que no suma.
    if (esFeriado(f) && (SEMANA[diaSemanaDe(f)]?.tipo === "entreno")) { feriados++; continue; }
    if (plan.tipo !== "entreno") continue;
    if (e === "causa-mayor") { causasMayores++; continue; }
    objetivo++;
    if (!sesionRegistrada(f)) faltantes.push(f);
  }
  const clave = claveSemana(lunes);
  const guardada = S.semanas.get(clave);
  const escudo = causaEscudo || !!guardada?.escudo;

  return {
    clave, lunes, domingo: sumarDias(lunes, 6),
    sesiones, recuperadas, caminatas, faltantes,
    objetivo, feriados, causasMayores, diasAgua,
    // Sin días de entreno disponibles, la semana queda neutra.
    neutra: objetivo === 0,
    completa: objetivo > 0 && sesiones >= objetivo,
    escudo,
    mencionHonor: objetivo > 0 && sesiones >= objetivo && caminatas > 0,
  };
}

function calcularRacha() {
  const inicio = lunesDe(pisoFecha());
  const lunesActual = lunesDe(hoyISO());
  let racha = 0;
  const cerradas = [];
  for (let l = inicio; l < lunesActual; l = sumarDias(l, 7)) {
    const r = resumenSemana(l);
    // Semana sin días de entreno disponibles: la racha se congela sin gastar
    // el escudo. Ni feriado ni causa mayor rompen la racha.
    if (r.neutra) { /* ni suma ni resta */ }
    else if (r.completa) racha++;
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
/* Los escudos usados en un mes. Las versiones viejas guardaban una sola clave
   suelta en vez de una lista, así que se acepta cualquiera de las dos formas. */
function escudosDelMes(mes) {
  const v = S.config?.escudos?.[mes];
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}
function escudosRestantes(mes) {
  return Math.max(0, (CONFIG.escudosPorMes || 1) - escudosDelMes(mes).length);
}
function escudoDisponible(mes) { return escudosRestantes(mes) > 0; }
/* Devuelve el objeto `escudos` completo con uno más anotado en ese mes. */
function conEscudoAnotado(mes, clave) {
  const escudos = { ...(S.config.escudos || {}) };
  escudos[mes] = [...escudosDelMes(mes), clave];
  return escudos;
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

        // El escudo es solo para semanas incompletas SIN feriado ni causa
        // mayor: en esas el objetivo ya bajó, no hace falta gastarlo.
        const puedeEscudo = !r.completa && !r.neutra && !r.escudo &&
          r.feriados === 0 && r.causasMayores === 0;
        if (puedeEscudo && !guardada?.decidida) {
          const mes = mesDeSemana(r.lunes);
          if (escudoDisponible(mes)) {
            const usa = await preguntarEscudo(r);
            if (usa) {
              const escudosAntes = { ...(S.config.escudos || {}) };
              await guardarConfig({ escudos: conEscudoAnotado(mes, r.clave) });
              ofrecerDeshacer("Escudo usado", async () => {
                await guardarConfig({ escudos: escudosAntes }, { queHacia: "el escudo" });
                await setDoc(refs.semana(r.clave), { escudo: false, decidida: false }, { merge: true });
                refrescarVistaActual();
              });
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
      ${CONFIG.sesionesPorSemana} sesiones. Te queda${escudosRestantes(mesDeSemana(r.lunes)) === 1 ? "" : "n"}
      ${escudosRestantes(mesDeSemana(r.lunes))} escudo${escudosRestantes(mesDeSemana(r.lunes)) === 1 ? "" : "s"} este mes:
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
const VISTAS = ["login", "carga", "inicio", "calendario", "progreso", "peso", "ajustes", "entreno"];
let vistaActual = "carga";

function mostrarVista(nombre) {
  vistaActual = nombre;
  for (const v of VISTAS) $(`#vista-${v}`)?.classList.toggle("oculta", v !== nombre);
  actualizarTabbar();
  refrescarVistaActual();
  pintarBarraDescanso();     // el descanso sigue a la vista, no al revés
  pintarBarraSesion();
  pintarAvisoVersion();      // al cerrarse la sesión, el aviso puede aparecer
  ponerRedHistorial();       // que atrás pueda volver al inicio
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
  else if (vistaActual === "progreso") renderHistorial();
  else if (vistaActual === "peso") renderPeso();
  else if (vistaActual === "ajustes") renderAjustes();
  else if (vistaActual === "entreno" && S.sesion) renderPasoSesion();
}

/* ==========================================================================
   BANNER DE SESIÓN EN CURSO — rojo lleno, en todas las pantallas
   --------------------------------------------------------------------------
   Es la única vez que el rojo ocupa una barra entera: tiene que molestar.
   No se puede cerrar; se va cuando la sesión se cierra.
   ========================================================================== */
function pintarBarraSesion() {
  const barra = $("#barra-sesion");
  if (!barra) return;
  const abierta = S.cargado ? diaConSesionAbierta() : null;
  const hayAlgo = !!(S.sesion || abierta);
  const mostrar = hayAlgo && vistaActual !== "entreno" &&
    !["login", "carga"].includes(vistaActual);

  barra.classList.toggle("oculta", !mostrar);
  document.body.classList.toggle("con-barra-sesion", mostrar);
  if (!mostrar) return;

  const s = S.sesion;
  const fecha = s?.fecha || abierta.fecha;
  const reg = S.dias.get(fecha) || {};
  const rutinaId = s?.rutinaId || reg.sesion?.rutinaId;
  const deHoy = (s?.hechoEl || reg.sesion?.hechoEl || fecha) === hoyISO();

  if (deHoy && s) {
    const seg = (Date.now() - s.inicio) / 1000;
    $("#bs-titulo").textContent = `ESTÁS ENTRENANDO · ${fmtCrono(seg)}`;
    $("#bs-detalle").textContent = `${RUTINAS[rutinaId]?.nombre || ""} · ${dondeVaLaSesion(s)}`;
  } else if (deHoy) {
    $("#bs-titulo").textContent = "ENTRENAMIENTO SIN CERRAR";
    $("#bs-detalle").textContent = `${RUTINAS[rutinaId]?.nombre || ""} · tocá para seguir`;
  } else {
    $("#bs-titulo").textContent = `SESIÓN DEL ${DIAS_NOMBRE[diaSemanaDe(fecha)].toUpperCase()} SIN CERRAR`;
    $("#bs-detalle").textContent = `${RUTINAS[rutinaId]?.nombre || ""} · tocá para seguir`;
  }
  barra.onclick = () => { if (!S.sesion) retomarSesion(fecha); else irA("entreno"); };
}

/* "Dorsalera, serie 2" — en qué punto exacto quedó la sesión. */
function dondeVaLaSesion(s) {
  const paso = s.cola?.[s.paso];
  if (!paso) return "terminando";
  if (paso.t === "ej") {
    const e = ejercicioPorId(paso.id);
    const hechas = ((S.dias.get(s.fecha)?.series || {})[paso.id] || [])
      .filter((x) => x?.hecha).length;
    return `${e?.nombre || paso.id}, serie ${Math.min(hechas + 1, e?.series || 4)}`;
  }
  if (paso.t === "bloque") {
    const n = s.cola.filter((p) => p.t === "bloque").indexOf(paso) + 1;
    return `bloque ${n} de 8`;
  }
  if (paso.t === "calor" || paso.t === "movilidad") return "entrada en calor";
  if (paso.t === "cinta-cierre") return "cinta de cierre";
  return "parte de cierre";
}


/* ==========================================================================
   DESLIZAR ENTRE SECCIONES
   --------------------------------------------------------------------------
   Sigue al dedo en tiempo real, con resistencia en los extremos. Solo se activa
   si el gesto es claramente horizontal (el doble que el vertical y más de 12 px),
   así no pelea con el scroll ni con el arrastre de las hojas.
   ========================================================================== */
/* Ajustes queda afuera: se llega solo por el engranaje, no deslizando. */
const ORDEN_SECCIONES = ["inicio", "calendario", "progreso", "peso"];

(function () {
  const lienzo = $("#lienzo");
  let x0 = 0, y0 = 0, dx = 0;
  let decidido = null;      // null = todavía no se sabe; "h" | "v"
  let activo = false;

  const puedeDeslizar = () =>
    ORDEN_SECCIONES.includes(vistaActual) && !hojaAbierta && !movReducido();

  lienzo.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || !puedeDeslizar()) { activo = false; return; }
    activo = true; decidido = null; dx = 0;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });

  lienzo.addEventListener("touchmove", (e) => {
    if (!activo || e.touches.length !== 1) return;
    const ex = e.touches[0].clientX - x0;
    const ey = e.touches[0].clientY - y0;

    if (decidido === null) {
      if (Math.abs(ex) < 12 && Math.abs(ey) < 12) return;   // todavía indeciso
      decidido = Math.abs(ex) > Math.abs(ey) * 2 ? "h" : "v";
      if (decidido === "v") activo = false;
      return;
    }
    if (decidido !== "h") return;

    const i = ORDEN_SECCIONES.indexOf(vistaActual);
    const enBorde = (ex > 0 && i === 0) || (ex < 0 && i === ORDEN_SECCIONES.length - 1);
    dx = enBorde ? Math.sign(ex) * Math.pow(Math.abs(ex), 0.62) : ex;   // resistencia
    lienzo.style.transition = "none";
    lienzo.style.transform = `translateX(${dx}px)`;
  }, { passive: true });

  const soltar = () => {
    if (!activo || decidido !== "h") { activo = false; return; }
    activo = false;
    lienzo.style.transition = "";
    lienzo.style.transform = "";
    const i = ORDEN_SECCIONES.indexOf(vistaActual);
    const umbral = Math.min(90, window.innerWidth * 0.22);
    if (dx <= -umbral && i < ORDEN_SECCIONES.length - 1) irA(ORDEN_SECCIONES[i + 1]);
    else if (dx >= umbral && i > 0) irA(ORDEN_SECCIONES[i - 1]);
    dx = 0;
  };
  lienzo.addEventListener("touchend", soltar, { passive: true });
  lienzo.addEventListener("touchcancel", soltar, { passive: true });
})();

/* ==========================================================================
   BOTÓN ATRÁS DE ANDROID
   --------------------------------------------------------------------------
   Sin esto, atrás cierra la app instalada aunque estés en medio de una hoja
   con datos escritos. Se mantiene siempre una entrada de historial de sobra:
   atrás la consume, la app decide qué cerrar y vuelve a poner otra. Solo se
   deja salir cuando ya estás en el inicio y no hay nada abierto.
   ========================================================================== */
let redPuesta = false;

/* Mantiene UNA entrada de reserva mientras haya algo que atrás pueda cerrar.
   En el inicio y sin nada abierto no hay reserva, así que atrás sale de la
   app como corresponde y no hay que tocarlo dos veces. */
function ponerRedHistorial() {
  const haceFalta = hojaAbierta || panelRutinaAbierto() || vistaActual !== "inicio";
  if (haceFalta && !redPuesta) {
    try { history.pushState({ red: true }, ""); redPuesta = true; } catch (_) { }
  }
}

window.addEventListener("popstate", () => {
  redPuesta = false;                        // la reserva se consumió
  if (panelRutinaAbierto()) { cerrarPanelRutina(); ponerRedHistorial(); return; }
  if (hojaAbierta) { cerrarHoja(); ponerRedHistorial(); return; }
  if (vistaActual === "entreno") { salirDeSesion(); ponerRedHistorial(); return; }
  if (vistaActual !== "inicio") { irA("inicio"); return; }
  // En el inicio y sin nada abierto: se deja salir de verdad.
});

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
  ponerRedHistorial();                     // que atrás cierre la hoja
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
$("#hoja-cerrar").addEventListener("click", () => cerrarHoja());

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
/* Kilos movidos en una sesión.
   En intervalos, los ejercicios del circuito con mancuerna SÍ entran al total:
   cuentan peso × repeticiones, y los que son `porLado` cuentan doble porque se
   hacen con los dos brazos (el curl y la patada de tríceps). Los que no tienen
   peso no suman kilos. */
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
      a + (e.peso || 0) * e.reps * (e.porLado ? 2 : 1), 0);
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
  } else if (hora >= horaDe(CONFIG.horaLimite, 20)) {
    tTitular = "La racha está en juego";
    titular.style.color = "var(--rojo)";
    tFrase = racha > 0 ? sargento("rachaEnRiesgo", vars) : sargento("pasoTarde", vars);
  } else if (hora >= horaDe(CONFIG.horaAviso, 12)) {
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
      <div class="tarjeta-nota">${hora < horaDe(CONFIG.horaEntreno, 10)
        ? `Solés ir ${esc(CONFIG.horaEntreno)}` : "Sacate la foto y ya cuenta"}</div></div>
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

  /* Los cuatro días de la semana en verde a medida que se completan, y un
     quinto en azul que aparece solo si hubo caminata en día de descanso: es un
     extra por encima de los cuatro, no un reemplazo. */
  const objetivo = Math.max(semanaActual.objetivo, semanaActual.sesiones);
  let galones = Array.from({ length: objetivo }, (_, i) =>
    svgGalon(i < semanaActual.sesiones ? "hecho" : "vacio")).join("");
  if (semanaActual.caminatas > 0) galones += svgGalon("extra", "galon-extra");

  let falta = "";
  if (!semanaActual.completa && proximas.length) {
    falta = `<div class="racha-falta">Falta: ${proximas.map((p) =>
      `${DIAS_NOMBRE[diaSemanaDe(p.fecha)]} (${RUTINAS[p.rutinaId].nombre})`).join(", ")}</div>`;
  }
  let alerta = "";
  const posibles = posiblesHastaDomingo();
  if (semanaActual.neutra) {
    alerta = `<div class="racha-congelada">Semana sin días de entreno: la racha no se toca</div>`;
  } else if (!semanaActual.completa && racha > 0 &&
      semanaActual.sesiones + posibles < semanaActual.objetivo) {
    alerta = `<div class="racha-alerta">Semana perdida salvo escudo: bajás a ${rangoSiFalla(racha).nombre}</div>`;
  } else if (!semanaActual.completa && racha > 0 &&
      (dow === 0 || dow >= 5 || hora >= horaDe(CONFIG.horaLimite, 20))) {
    alerta = `<div class="racha-alerta">Si fallás bajás a ${rangoSiFalla(racha).nombre}</div>`;
  } else if (semanaActual.escudo) {
    alerta = `<div class="racha-congelada">Semana con escudo: racha congelada</div>`;
  }

  /* La marca chica que explica por qué el objetivo bajó de cuatro. */
  const motivos = [];
  if (semanaActual.feriados) motivos.push(`${semanaActual.feriados} feriado${semanaActual.feriados > 1 ? "s" : ""}`);
  if (semanaActual.causasMayores) motivos.push(`${semanaActual.causasMayores} causa${semanaActual.causasMayores > 1 ? "s" : ""} mayor${semanaActual.causasMayores > 1 ? "es" : ""}`);
  const marca = motivos.length ? ` <span class="racha-marca">· ${esc(motivos.join(" y "))}</span>` : "";

  const zona = $("#racha-tarjeta");
  zona.innerHTML = `
    <button class="racha ${clase} ${semanaActual.completa ? "completa" : ""}">
      ${svgGalon(clase === "r-elite" ? "rojo" : "lleno", "racha-galon-grande")}
      <div class="racha-rango">${esc(rango.nombre)}</div>
      <div class="racha-num num">${racha} <small>${racha === 1 ? "semana seguida" : "semanas seguidas"}</small></div>
      <div class="racha-galones">${galones}</div>
      <div class="racha-semana num">${semanaActual.sesiones} de ${semanaActual.objetivo} esta semana${
        semanaActual.caminatas > 0 ? ` <span class="racha-extra">+ caminata</span>` : ""}${marca}</div>
      ${falta}${alerta}
      <div id="logros-en-racha"></div>
    </button>`;
  // Tocar la tarjeta del rango lleva al calendario.
  zona.querySelector(".racha").onclick = () => irA("calendario");
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
      <input id="obj-kg" type="text" inputmode="decimal" value="${fmtNumero(S.config.pesoObjetivo, "objetivo")}"></div>
    <div class="hoja-acciones">
      <button id="obj-guardar" class="btn btn-primario btn-grande">Guardar</button>
    </div>`);
  $("#obj-guardar").onclick = async (ev) => {
    const ok = await guardarConfig({ pesoObjetivo: leerNumero($("#obj-kg"), "objetivo") },
      { queHacia: "el peso objetivo", boton: ev.currentTarget });
    if (!ok) return;
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

  const fila = chips.map((c) => `<span class="logro">${esc(c)}</span>`).join("");
  zona.innerHTML = chips.length
    ? `<div class="etiqueta">Logros</div><div class="logros-fila">${fila}</div>` : "";
  // Copia compacta que la hoja de estilos usa en pantallas bajas, plegándola
  // dentro de la tarjeta de racha para que el inicio siga entrando entero.
  const dentro = $("#logros-en-racha");
  if (dentro) dentro.innerHTML = chips.length ? `<div class="logros-fila">${fila}</div>` : "";
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

  // La caminata salió de acá: vive dentro de Registrar entrenamiento, para que
  // toda la actividad física esté en un solo lugar.
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
/* Una sola pantalla: el anillo, los botones, los registros del día uno por uno
   (borrables) y el lápiz para editar los mililitros ahí mismo. */
function hojaAgua(desde) {
  const hoy = hoyISO();

  const totalDe = (registros) => registros.reduce((a, r) => a + (r.ml || 0), 0);

  const pintar = (primera) => {
    const reg = S.dias.get(hoy);
    const registros = reg?.aguaRegistros || [];
    const ml = reg?.aguaMl || 0;
    const objetivo = S.config.aguaObjetivoMl || 2000;
    const cumplida = ml >= objetivo;
    const html = `
      <h3>Agua de hoy</h3>
      <div class="agua-detalle">
        <div class="anillo ${cumplida ? "pulso" : ""}">${svgAnillo(ml / objetivo, { tilde: cumplida })}</div>
        <div class="agua-cifra num" id="agua-cifra" data-valor="${ml / 1000}">${fmtLitros(ml)}</div>
        <small class="texto-2">de ${fmtLitros(objetivo)} L
          <button id="agua-lapiz-obj" class="lapiz-btn" aria-label="Editar el objetivo">✏️</button></small>
      </div>
      <div class="agua-botones">
        <button id="agua-botella" class="btn btn-primario btn-grande">
          + Botella<small>${fmtNumero(S.config.botellaMl, "ml")} ml</small></button>
        <button id="agua-vaso" class="btn btn-borde btn-grande">
          + Vaso<small>${fmtNumero(S.config.vasoMl, "ml")} ml</small></button>
      </div>
      <div class="agua-editar">
        <button id="agua-lapiz" class="btn btn-texto">✏️ Cambiar los mililitros</button>
      </div>
      ${registros.length ? `
        <div class="paso-indicador">Registros de hoy</div>
        <ul class="agua-registros">
          ${registros.map((r, i) => `
            <li>
              <b class="num">${r.ml > 0 ? "+" : "−"}${fmtNumero(Math.abs(r.ml), "ml")} ml</b>
              <span>${fmtHora(r.hora)}</span>
              <button class="btn-icono" data-borrar="${i}" aria-label="Borrar este registro">✕</button>
            </li>`).reverse().join("")}
        </ul>`
        : `<p class="vacio-direccion">Todavía no registraste agua hoy.</p>`}`;

    if (primera) abrirHoja(html, { desde });
    else $("#hoja-contenido").innerHTML = html;

    $("#agua-botella").onclick = (ev) => sumar(S.config.botellaMl, ev.currentTarget);
    $("#agua-vaso").onclick = (ev) => sumar(S.config.vasoMl, ev.currentTarget);
    // Abrir otra hoja cierra esta, así que al volver se reabre entera.
    $("#agua-lapiz").onclick = () => hojaMedidasAgua(() => hojaAgua());
    $("#agua-lapiz-obj").onclick = () => hojaMedidasAgua(() => hojaAgua());
    $$("#hoja-contenido [data-borrar]").forEach((b) => {
      b.onclick = (ev) => borrar(Number(b.dataset.borrar), ev.currentTarget);
    });
  };

  const guardar = async (registros, boton, previo) => {
    const nuevo = Math.max(0, totalDe(registros));
    const objetivo = S.config.aguaObjetivoMl || 2000;
    vibrar(previo < objetivo && nuevo >= objetivo ? "confirmar" : "leve");
    const ok = await guardarDia(hoy, {
      aguaMl: nuevo, aguaRegistros: registros,
      tipo: S.dias.get(hoy)?.tipo || planDelDia(hoy).tipo,
    }, { queHacia: "el agua", boton });
    if (!ok) return;
    pintar(false);
    const cifra = $("#agua-cifra");
    if (cifra) {
      cifra.dataset.valor = String(previo / 1000);
      contarNumero(cifra, nuevo / 1000, { dec: 1 });
    }
    if (vistaActual === "inicio") renderInicio();
  };

  const sumar = (delta, boton) => {
    const reg = S.dias.get(hoy);
    const registros = [...(reg?.aguaRegistros || []), { ml: delta, hora: Date.now() }];
    return guardar(registros, boton, reg?.aguaMl || 0);
  };

  const borrar = async (indice, boton) => {
    const reg = S.dias.get(hoy);
    const antes = [...(reg?.aguaRegistros || [])];
    const borrado = antes[indice];
    const registros = antes.filter((_, i) => i !== indice);
    await guardar(registros, boton, reg?.aguaMl || 0);
    ofrecerDeshacer(`${fmtNumero(Math.abs(borrado?.ml || 0), "ml")} ml borrados`,
      () => guardar(antes, null, S.dias.get(hoy)?.aguaMl || 0));
  };

  pintar(true);
}

/* Los mililitros se editan acá, donde se usan, no en Ajustes. */
function hojaMedidasAgua(alVolver) {
  const c = S.config;
  abrirHoja(`
    <h3>Medidas de agua</h3>
    <div class="campo"><label>Botella (ml)</label>
      <input id="ma-botella" type="text" inputmode="numeric" value="${fmtNumero(c.botellaMl, "ml")}"></div>
    <div class="campo"><label>Vaso (ml)</label>
      <input id="ma-vaso" type="text" inputmode="numeric" value="${fmtNumero(c.vasoMl, "ml")}"></div>
    <div class="campo"><label>Objetivo del día (ml)</label>
      <input id="ma-objetivo" type="text" inputmode="numeric" value="${fmtNumero(c.aguaObjetivoMl, "ml")}"></div>
    <div class="hoja-acciones">
      <button id="ma-guardar" class="btn btn-primario btn-grande">Guardar</button>
    </div>`);
  $("#ma-guardar").onclick = async (ev) => {
    const ok = await guardarConfig({
      botellaMl: leerNumero($("#ma-botella"), "ml") || 1000,
      vasoMl: leerNumero($("#ma-vaso"), "ml") || 250,
      aguaObjetivoMl: leerNumero($("#ma-objetivo"), "ml") || 2000,
    }, { queHacia: "las medidas de agua", boton: ev.currentTarget });
    if (!ok) return;
    cerrarHoja(true);
    if (alVolver) alVolver();
  };
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
    </div>` : `<p class="texto-2">No te quedan escudos este mes.</p>`}
    <div class="hoja-acciones">
      <button id="cm-guardar" class="btn btn-primario btn-grande">Marcar causa mayor</button>
    </div>`);
  $("#cm-guardar").onclick = async () => {
    const motivo = $("#cm-motivo").value.trim();
    if (!motivo) { $("#cm-motivo").focus(); return; }
    const conEscudo = hayEscudo && $("#cm-escudo")?.checked;
    const antes = { ...(S.dias.get(fecha) || {}) };
    await guardarDia(fecha, {
      tipo: "entreno", rutinaId: planDelDia(fecha).rutina || null,
      rutinasVersion: RUTINAS_VERSION, estado: "causa-mayor", esPrueba: false,
      causaMayor: { usada: true, motivo, conEscudo: !!conEscudo },
    });
    const escudosAntes = { ...(S.config.escudos || {}) };
    if (conEscudo) {
      await guardarConfig({ escudos: conEscudoAnotado(fecha.slice(0, 7), claveSemana(fecha)) });
      toast(sargento("escudoUsado"), "toast-alerta", 6000);
    }
    cerrarHoja(true);
    refrescarVistaActual();
    ofrecerDeshacer("Día marcado como causa mayor", async () => {
      await guardarDia(fecha, {
        estado: antes.estado ?? null, causaMayor: null,
        tipo: antes.tipo ?? planDelDia(fecha).tipo,
      }, { queHacia: "la causa mayor" });
      if (conEscudo) await guardarConfig({ escudos: escudosAntes }, { queHacia: "el escudo" });
      await procesarSemanasCerradas();
      refrescarVistaActual();
    });
  };
}

/* ==========================================================================
   AUDIO — la campana tiene que sonar con la pantalla apagada
   --------------------------------------------------------------------------
   Un setTimeout no sirve: cuando la app pasa a segundo plano, iOS congela los
   temporizadores de JavaScript. Lo que sí sobrevive es el reloj del hilo de
   audio. Así que la campana no se "dispara cuando toca": se AGENDA en tiempo
   absoluto sobre el AudioContext apenas arranca el descanso.

   Para que ese reloj no se detenga, el contexto tiene que seguir activo, y iOS
   solo lo mantiene vivo si hay audio realmente sonando. De ahí el bucle de
   ruido inaudible (no silencio digital: el silencio absoluto lo ignora) que
   corre únicamente mientras hay un temporizador pendiente.

   `audioSession.type = "transient"` hace que la campana BAJE la música en vez
   de cortarla. Ojo con el compromiso: el tipo que mejor sobrevive al segundo
   plano es "playback", pero ese se apropia de la sesión y te para la música.
   Está en una constante para poder cambiarlo de un lado.
   ========================================================================== */
const TIPO_SESION_AUDIO = "transient";   // "playback" si la campana no suena bloqueada

const AUDIO = {
  ctx: null, buffer: null, vivo: null,
  agendadas: new Map(),   // clave → { src, instante }
  sonadas: new Set(),     // claves cuya campana disparó de verdad
};
const campana = new Audio("campana.mp3");   // respaldo para primer plano
campana.preload = "auto";

async function prepararAudio() {
  if (AUDIO.ctx) {
    if (AUDIO.ctx.state === "suspended") await AUDIO.ctx.resume().catch(() => { });
    return AUDIO.ctx;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try {
    AUDIO.ctx = new Ctx();
    if (navigator.audioSession) navigator.audioSession.type = TIPO_SESION_AUDIO;
    await AUDIO.ctx.resume().catch(() => { });
    const res = await fetch("campana.mp3");
    AUDIO.buffer = await AUDIO.ctx.decodeAudioData(await res.arrayBuffer());
  } catch (e) {
    console.warn("audio:", e);
  }
  return AUDIO.ctx;
}

/* Se llama desde un gesto del usuario: es la única forma de habilitar audio. */
function desbloquearAudio() {
  prepararAudio().then(() => { S.audioListo = !!AUDIO.buffer; });
  if (S.audioListo) return;
  campana.muted = true;
  const p = campana.play();
  if (p) p.then(() => {
    campana.pause(); campana.currentTime = 0; campana.muted = false;
  }).catch(() => { campana.muted = false; });
}

/* Mantiene vivo el reloj de audio mientras haya algo agendado. */
function mantenerAudioVivo(encender) {
  const ctx = AUDIO.ctx;
  if (!ctx) return;
  if (encender && !AUDIO.vivo) {
    const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 2), ctx.sampleRate);
    const datos = buf.getChannelData(0);
    for (let i = 0; i < datos.length; i++) datos[i] = (Math.random() * 2 - 1) * 1e-4;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0.0015;                 // inaudible, pero no cero
    src.connect(g).connect(ctx.destination);
    try { src.start(); } catch (_) { return; }
    AUDIO.vivo = src;
  } else if (!encender && AUDIO.vivo) {
    try { AUDIO.vivo.stop(); } catch (_) { }
    AUDIO.vivo = null;
  }
}

/* Agenda la campana para un instante absoluto (Date.now en ms).

   `onended` es la prueba de que sonó DE VERDAD: si el contexto estaba
   suspendido, el nodo nunca dispara y nunca se marca. Ese era el bug: la app
   daba por tocada una campana que nadie escuchó. */
function agendarCampana(clave, instanteMs) {
  cancelarCampana(clave);
  const ctx = AUDIO.ctx;
  if (!ctx || !AUDIO.buffer) return false;
  if (ctx.state === "suspended") ctx.resume().catch(() => { });
  const faltanSeg = (instanteMs - Date.now()) / 1000;
  if (faltanSeg < 0) return false;
  const src = ctx.createBufferSource();
  src.buffer = AUDIO.buffer;
  src.connect(ctx.destination);
  src.onended = () => {
    AUDIO.sonadas.add(clave);
    AUDIO.agendadas.delete(clave);
    if (AUDIO.agendadas.size === 0) mantenerAudioVivo(false);
  };
  try { src.start(ctx.currentTime + faltanSeg); } catch (_) { return false; }
  AUDIO.agendadas.set(clave, { src, instante: instanteMs });
  AUDIO.sonadas.delete(clave);
  mantenerAudioVivo(true);
  return true;
}

function cancelarCampana(clave) {
  const a = AUDIO.agendadas.get(clave);
  if (a) {
    a.src.onended = null;                  // cancelar no es haber sonado
    try { a.src.stop(); } catch (_) { }
    AUDIO.agendadas.delete(clave);
  }
  AUDIO.sonadas.delete(clave);
  // Sin nada agendado no hace falta seguir sosteniendo el contexto de audio.
  if (AUDIO.agendadas.size === 0) mantenerAudioVivo(false);
}

function campanaYaSono(clave) { return AUDIO.sonadas.has(clave); }
function campanaEnEspera(clave) {
  return AUDIO.agendadas.has(clave) && AUDIO.ctx?.state === "running";
}

/* Al volver a foco: reanudar el reloj de audio y volver a agendar lo que
   todavía no venció. El reloj del contexto se congela con la suspensión, así
   que un `start(when)` viejo quedó apuntando a un momento que ya no coincide
   con el reloj de pared: hay que rehacerlo contra el instante absoluto. */
async function resincronizarAudio() {
  const ctx = AUDIO.ctx;
  if (!ctx) return;
  try { await ctx.resume(); } catch (_) { }

  if (ctx.state !== "running") {
    // iOS a veces exige un gesto para devolver el audio tras una llamada.
    mostrarAvisoAudio(true);
    return;
  }
  mostrarAvisoAudio(false);

  for (const clave of ["timer", "descanso"]) {
    const t = S.sesion?.[clave];
    if (!t || t.sono) continue;
    if (t.fin > Date.now()) t.agendada = agendarCampana(clave, t.fin);
  }
}

/* Cartel para reactivar el audio a mano cuando el sistema lo retuvo. */
function mostrarAvisoAudio(visible) {
  const caja = $("#aviso-audio");
  if (!caja) return;
  caja.classList.toggle("oculta", !visible);
  if (!visible) return;
  const btn = caja.querySelector("button");
  if (btn) btn.onclick = async () => {
    await prepararAudio();
    await resincronizarAudio();
    if (AUDIO.ctx?.state === "running") {
      caja.classList.add("oculta");
      toast("Audio reactivado. La campana vuelve a sonar.", "toast-record");
    }
  };
}

/* Toque inmediato (botón "Probar campana" y respaldo en primer plano). */
function sonarCampana() {
  const ctx = AUDIO.ctx;
  if (ctx && AUDIO.buffer && ctx.state === "running") {
    const src = ctx.createBufferSource();
    src.buffer = AUDIO.buffer;
    src.connect(ctx.destination);
    try { src.start(); } catch (_) { }
  } else {
    try { campana.currentTime = 0; campana.play().catch(() => { }); } catch (_) { }
  }
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
/* --- Ciclo de vida: volver a foco y estar por irse ------------------------- */
function alVolverAFoco() {
  if (S.sesion) pedirWakeLock();
  resincronizarAudio();
  tickTimers(true);
  buscarActualizacion();
  if (!S.cargado) return;
  // Redibujar: si un bloque terminó estando afuera, el botón tiene que
  // reflejarlo y no quedar con el estado con el que se dejó la pantalla.
  if (vistaActual === "entreno" && S.sesion) renderPasoSesion();
  else if (vistaActual === "inicio") renderInicio();
}

/* Antes de que el sistema descarte la pestaña: guardar sin retardo. */
function alIrseAlFondo() {
  if (S.sesion) guardarSesion({ diferido: false });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") alVolverAFoco();
  else alIrseAlFondo();
});
window.addEventListener("pagehide", alIrseAlFondo);
document.addEventListener("freeze", alIrseAlFondo);
document.addEventListener("resume", alVolverAFoco);

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
  if (!s) { frenarTickeo(); pintarBarraDescanso(); return; }
  const ahora = Date.now();

  for (const clave of ["timer", "descanso"]) {
    const t = s[clave];
    if (!t) continue;
    const resta = (t.fin - ahora) / 1000;
    /* `sono` solo se marca cuando la campana sonó de verdad:
       - si el nodo agendado disparó, `campanaYaSono` lo confirma;
       - si sigue esperando y el contexto corre, se le da margen;
       - si no, se toca ahora. Estando afuera el tick no corre, así que al
         volver esto se ejecuta y suena en el acto lo que venció mientras tanto. */
    if (resta <= 0 && !t.sono) {
      if (campanaYaSono(clave)) {
        t.sono = true;
        vibrar("confirmar");
        cancelarCampana(clave);
        guardarSesion();
      } else if (!campanaEnEspera(clave) || resta <= -0.6) {
        t.sono = true;
        cancelarCampana(clave);
        sonarCampana();
        guardarSesion();
      }
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
  pintarBarraDescanso();
  if (vistaActual !== "entreno") pintarBarraSesion();   // el reloj del banner corre
}

function ponerTimer(seg, etiqueta) {
  const dur = durT(seg);
  const fin = Date.now() + dur * 1000;
  S.sesion.timer = { fin, dur, etiqueta, sono: false, agendada: agendarCampana("timer", fin) };
  guardarSesion();
  arrancarTickeo();
  renderPasoSesion();
}

function ponerDescanso(segundos) {
  const dur = segundos ?? durT(S.config.descansoSeg || 90);
  const fin = Date.now() + dur * 1000;
  S.sesion.descanso = { fin, dur, sono: false, agendada: agendarCampana("descanso", fin) };
  guardarSesion();
  arrancarTickeo();
  pintarBarraDescanso();
}

/* Corre el final del descanso sin perder el agendado de la campana. */
function ajustarDescanso(deltaSeg) {
  const d = S.sesion?.descanso;
  if (!d) return;
  const restaba = Math.max(0, (d.fin - Date.now()) / 1000);
  const nueva = Math.max(1, restaba + deltaSeg);
  d.fin = Date.now() + nueva * 1000;
  d.dur = Math.max(d.dur, nueva);
  d.sono = false;
  d.agendada = agendarCampana("descanso", d.fin);
  vibrar("leve");
  guardarSesion();
  pintarBarraDescanso();
  renderPasoSesion();
}

function reiniciarDescanso() {
  cancelarCampana("descanso");
  ponerDescanso();
  vibrar("leve");
  renderPasoSesion();
}

function saltarDescanso() {
  const previo = S.sesion?.descanso ? { ...S.sesion.descanso } : null;
  cancelarCampana("descanso");
  if (S.sesion) S.sesion.descanso = null;
  vibrar("leve");
  guardarSesion();
  pintarBarraDescanso();
  renderPasoSesion();
  if (previo) ofrecerDeshacer("Descanso salteado", () => {
    if (!S.sesion) return;
    S.sesion.descanso = { ...previo, agendada: agendarCampana("descanso", previo.fin) };
    guardarSesion();
    arrancarTickeo();
    pintarBarraDescanso();
    renderPasoSesion();
  });
}

/* ==========================================================================
   BARRA FLOTANTE DE DESCANSO — visible en cualquier pantalla mientras corre
   ========================================================================== */
function pintarBarraDescanso() {
  const barra = $("#barra-descanso");
  if (!barra) return;
  const s = S.sesion;
  // En la pantalla de entrenamiento el temporizador de bloque ya tiene su
  // anillo grande; la barra flotante es para el descanso entre series.
  const t = s?.descanso || (vistaActual !== "entreno" ? s?.timer : null);
  if (!t) { barra.classList.add("oculta"); return; }

  const resta = (t.fin - Date.now()) / 1000;
  const esDescanso = t === s.descanso;
  barra.classList.remove("oculta");
  barra.classList.toggle("fin", resta <= 0);
  barra.classList.toggle("late", resta > 0 && resta <= 3);
  barra.classList.toggle("bd-bloque", !esDescanso);
  $("#bd-num").textContent = fmtCrono(resta);
  $("#bd-etiqueta").textContent = resta <= 0
    ? "¡Dale!" : (esDescanso ? "Descanso" : (t.etiqueta || "En curso"));
  $("#bd-ajustes")?.classList.toggle("oculta", !esDescanso);
}

/* ==========================================================================
   SESIÓN — armado, persistencia, reanudación
   ========================================================================== */
/* La sesión en curso vive en FIRESTORE, dentro del documento del día, para que
   se pueda retomar desde cualquier dispositivo y en cualquier momento.
   localStorage queda solo como caché de arranque rápido. */
function limpiarSesionLocal() { localStorage.removeItem("sesionActiva"); }

/* La copia local que SÍ se lee: es el respaldo de arranque para cuando
   Firestore todavía no repartió los datos. */
function sesionLocalGuardada() {
  try {
    const s = JSON.parse(localStorage.getItem("sesionActiva") || "null");
    return s && s.rutinaId && s.fecha ? s : null;
  } catch (_) { return null; }
}

/* Lo que se persiste de la sesión. `cola` y `prMax` no van: se regeneran.
   Los temporizadores SÍ van, con su instante absoluto, para que un descanso o
   un bloque de 7 minutos sobrevivan a una recarga. */
function sesionParaGuardar(s) {
  const t = (x) => (x ? { fin: x.fin, dur: x.dur, etiqueta: x.etiqueta || null, sono: !!x.sono } : null);
  return {
    abierta: true, rutinaId: s.rutinaId, fecha: s.fecha,
    esRecuperacion: !!s.esRecuperacion, fechaOriginal: s.fechaOriginal || null,
    esPrueba: !!s.esPrueba, inicio: s.inicio, paso: s.paso,
    calorHecho: s.calorHecho || {}, pesoActual: s.pesoActual || {},
    repsActual: s.repsActual || {}, tocada: Date.now(),
    timer: t(s.timer), descanso: t(s.descanso),
    // El día real en que se está entrenando, que puede no ser el día que cubre
    // (una pendiente que se recupera, o una sesión que se adelanta).
    hechoEl: s.hechoEl || s.fecha,
  };
}

/* Autoguardado. Por defecto va al instante: el paso, los pesos y las
   repeticiones no se pueden perder si el sistema descarta la pestaña. El
   retardo queda solo para lo que no duele perder, como el tick del timer. */
let guardarSesionTimer = null;
function guardarSesion({ diferido = false } = {}) {
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
  if (diferido) guardarSesionTimer = setTimeout(escribirla, 1200);
  else escribirla();
}

/* Cualquier día con una sesión abierta, sin importar la fecha. */
function diaConSesionAbierta() {
  for (const [fecha, reg] of S.dias) {
    if (reg?.sesion?.abierta) return { fecha, reg };
  }
  return null;
}

/* Rehidrata una sesión guardada a la forma que usa la app. Los temporizadores
   se recalculan contra su instante absoluto: si vencieron mientras la app
   estaba cerrada, quedan vencidos y el tick los resuelve. */
function sesionDesdeRegistro(fecha, reg) {
  const g = reg.sesion;
  const revivir = (x) => (x && x.fin ? { ...x, agendada: false } : null);
  return {
    fecha, rutinaId: g.rutinaId,
    esRecuperacion: !!g.esRecuperacion, fechaOriginal: g.fechaOriginal || null,
    hechoEl: g.hechoEl || fecha,
    esPrueba: !!g.esPrueba, inicio: g.inicio, paso: g.paso || 0,
    cola: armarCola(g.rutinaId),
    calorHecho: g.calorHecho || {}, pesoActual: g.pesoActual || {},
    repsActual: g.repsActual || {},
    vueltas: reg.vueltas || (g.rutinaId === "intervalos" ? [0, 0, 0, 0] : null),
    timer: revivir(g.timer), descanso: revivir(g.descanso),
    prMax: maximosHistoricos(),
  };
}

/* Vuelve a agendar la campana de los temporizadores que siguen corriendo. */
function reagendarTemporizadores() {
  for (const clave of ["timer", "descanso"]) {
    const t = S.sesion?.[clave];
    if (t && !t.sono && t.fin > Date.now()) t.agendada = agendarCampana(clave, t.fin);
  }
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

/* Qué sesiones se pueden cubrir hoy: la de hoy, las pendientes de la semana y
   las próximas que se pueden adelantar. Adelantar NO es una falta: no consume
   la recuperación semanal ni el escudo. */
function sesionesCubribles() {
  const hoy = hoyISO();
  const opciones = [];
  const plan = planDelDia(hoy);

  if (plan.tipo === "entreno" && !sesionRegistrada(hoy)) {
    opciones.push({ clave: "hoy", cubre: hoy, rutinaId: plan.rutina, titulo: "La de hoy", dato: RUTINAS[plan.rutina].nombre });
  }
  for (const p of pendientesDeRecuperar()) {
    opciones.push({
      clave: `rec-${p.fecha}`, cubre: p.fecha, rutinaId: p.rutinaId, esRecuperacion: true,
      titulo: `Recuperar la del ${DIAS_NOMBRE[diaSemanaDe(p.fecha)]}`, dato: RUTINAS[p.rutinaId].nombre,
    });
  }
  // Próximas de la semana, para adelantar
  const domingo = domingoDe(hoy);
  for (let f = sumarDias(hoy, 1); f <= domingo; f = sumarDias(f, 1)) {
    const p = planDelDia(f);
    if (p.tipo !== "entreno" || sesionRegistrada(f)) continue;
    opciones.push({
      clave: `ade-${f}`, cubre: f, rutinaId: p.rutina, adelanta: true,
      titulo: `Adelantar la del ${DIAS_NOMBRE[diaSemanaDe(f)]}`, dato: RUTINAS[p.rutina].nombre,
    });
  }
  // Siempre queda poder entrenar suelto, sin cubrir nada del plan
  opciones.push({
    clave: "suelta", cubre: hoy, rutinaId: plan.rutina || "musculacion",
    titulo: "Un entrenamiento suelto", dato: "No cubre ningún día del plan",
  });
  return opciones;
}

/* Los ejercicios que tocan, con el peso de la vez pasada: saber a qué vas. */
function vistaPreviaRutina(rutinaId) {
  const lista = rutinaId === "intervalos"
    ? INTERVALOS.circuito
    : MUSCULACION.bloques.flatMap((b) => b.ejercicios);
  return `
    <div class="previa-lista">
      ${lista.map((e) => {
        const previa = laVezPasada(e.id);
        const dato = previa
          ? `${fmtNumero(previa.peso, "carga")} kg × ${previa.reps}`
          : (e.peso ? `${fmtNumero(e.peso, "carga")} kg` : `${e.series || 4} × ${e.reps}`);
        return `
          <div class="previa-fila">
            <img src="img/ejercicios/${e.img}" alt="">
            <span class="previa-nombre">${esc(e.nombre)}</span>
            <span class="previa-dato num">${esc(dato)}</span>
          </div>`;
      }).join("")}
    </div>`;
}

/* UNA sola hoja: la rutina de hoy ya elegida, la vista previa y la cámara.
   El caso común es un toque y la cámara; lo demás son enlaces chicos abajo. */
function pasoElegirRutina(ctx) {
  const r = RUTINAS[ctx.rutinaId];
  const esHoy = ctx.fecha === hoyISO();
  const otras = sesionesCubribles().filter((o) => o.cubre !== ctx.fecha || o.rutinaId !== ctx.rutinaId);
  const otraRutina = ctx.rutinaId === "musculacion" ? "intervalos" : "musculacion";

  abrirHoja(`
    <h3>Registrar entrenamiento</h3>
    <div class="registro-rutina">
      <div class="etiqueta">${esHoy ? "Hoy" : esc(fmtFechaLarga(ctx.fecha))}</div>
      <div class="registro-nombre">${esc(r.nombre)}</div>
      <div class="dato">${esc(resumenRutina(ctx.rutinaId))}</div>
    </div>
    ${ctx.esRecuperacion ? `<p class="texto-2">Recuperás la sesión del
      ${esc(fmtFechaLarga(ctx.fechaOriginal || ctx.fecha))}. No gasta el escudo.</p>` : ""}
    ${ctx.adelanta ? `<p class="texto-2">Adelantás la sesión del
      ${esc(fmtFechaLarga(ctx.fecha))}. Adelantar no es una falta.</p>` : ""}

    <div class="foto-zona oculta" id="reg-foto-zona"></div>
    <input id="reg-foto-camara" type="file" accept="image/*" capture="environment" hidden>
    <input id="reg-foto-galeria" type="file" accept="image/*" hidden>
    <div class="hoja-acciones">
      <button id="reg-camara" class="btn btn-rojo btn-gigante">📸 Sacar la foto y empezar</button>
      <button id="reg-empezar" class="btn btn-primario btn-grande oculta">Empezar entrenamiento</button>
    </div>

    ${vistaPreviaRutina(ctx.rutinaId)}

    <div class="registro-enlaces">
      <button id="reg-galeria" class="btn btn-texto">Elegir la foto de la galería</button>
      <button id="reg-cambiar" class="btn btn-texto">Cambiar a ${esc(RUTINAS[otraRutina].nombre)}</button>
      ${otras.map((o) => `<button class="btn btn-texto" data-cubre="${o.clave}">${esc(o.titulo)}</button>`).join("")}
      <button id="reg-caminata" class="btn btn-texto">Registrar una caminata</button>
      <button id="reg-sin-foto" class="btn btn-texto">Empezar sin foto</button>
    </div>`);

  let fotoLista = null;
  const zona = $("#reg-foto-zona");

  const tomar = async (input) => {
    const file = input.files?.[0];
    if (!file) return;
    zona.classList.remove("oculta");
    zona.textContent = "Comprimiendo…";
    try {
      fotoLista = await comprimirFoto(file);
      zona.innerHTML = `<img src="${fotoLista}" alt="Foto del gimnasio">`;
      $("#reg-empezar").classList.remove("oculta");
      $("#reg-camara").textContent = "Sacar otra";
      vibrar("confirmar");
    } catch (_) {
      zona.textContent = "No se pudo procesar la foto. Probá con la galería.";
      anotarProblema("no se pudo comprimir la foto del gimnasio");
    }
  };
  $("#reg-foto-camara").onchange = (e) => tomar(e.target);
  $("#reg-foto-galeria").onchange = (e) => tomar(e.target);
  $("#reg-camara").onclick = () => $("#reg-foto-camara").click();
  $("#reg-galeria").onclick = () => $("#reg-foto-galeria").click();

  const arrancar = async (ev, foto) => {
    const ok = await iniciarEntrenamiento({ ...ctx, foto, boton: ev.currentTarget });
    if (ok) cerrarHoja(true);
  };
  $("#reg-empezar").onclick = (ev) => arrancar(ev, fotoLista);
  $("#reg-sin-foto").onclick = async (ev) => {
    await arrancar(ev, null);
    toast("Sin foto por ahora. La podés agregar después desde el calendario.", "", 6000);
  };
  $("#reg-caminata").onclick = () => hojaCaminata();
  $("#reg-cambiar").onclick = () => pasoElegirRutina({ ...ctx, rutinaId: otraRutina });
  $$("#hoja-contenido [data-cubre]").forEach((b) => {
    b.onclick = () => {
      const o = sesionesCubribles().find((x) => x.clave === b.dataset.cubre);
      if (!o) return;
      pasoElegirRutina({
        fecha: o.cubre, rutinaId: o.rutinaId,
        esRecuperacion: !!o.esRecuperacion, fechaOriginal: o.esRecuperacion ? o.cubre : null,
        adelanta: !!o.adelanta,
      });
    };
  });
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
    hechoEl: hoyISO(),
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
  // Si cubre un día que no es hoy, queda constancia de cuándo se hizo de verdad.
  if (fecha !== S.sesion.hechoEl) cambios.hechoEl = S.sesion.hechoEl;

  if (foto) {
    cambios.tieneFoto = true;
    cambios.motivoSinFoto = null;
    cambios.fotoAgregadaEl = fecha;      // sacada el mismo día: sin asterisco
  } else if (!previo.tieneFoto) {
    cambios.tieneFoto = false;
  }

  const ok = await guardarDia(fecha, cambios, { queHacia: "el inicio del entrenamiento", boton });
  if (!ok) { S.sesion = null; return false; }

  // La foto no puede frenar el arranque: si falla, se anota y se sigue.
  if (foto) {
    escribir("la foto del día",
      () => setDoc(refs.diaMedia(fecha, "foto"), { data: foto, hora: inicio }))
      .then((okFoto) => { if (!okFoto) anotarProblema("la foto del gimnasio no se guardó"); });
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
  let reg = S.dias.get(fecha);
  // Si Firestore todavía no repartió los datos, se arranca con la copia local
  // y el snapshot la corrige apenas llega.
  if (!reg?.sesion?.abierta) {
    const local = sesionLocalGuardada();
    if (local && local.fecha === fecha) {
      reg = { ...(reg || {}), sesion: sesionParaGuardar(local), vueltas: local.vueltas };
      logAuth("sesión retomada desde la copia local");
    } else return false;
  }
  S.sesion = sesionDesdeRegistro(fecha, reg);
  reagendarTemporizadores();
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
    // Se mide contra el día en que se entrenó de verdad, no contra el que
    // cubre: recuperar el lunes un miércoles no es una sesión vieja.
    const dia = reg?.sesion?.hechoEl || fecha;
    if (reg?.sesion?.abierta && dia < hoy) await cerrarSesionAutomatica(fecha);
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
    guardarSesion();
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
  pintarBarraRutina();
  tickTimers(true);
}

/* ==========================================================================
   BARRA DE LA RUTINA — al pie, siempre visible durante la sesión
   ========================================================================== */
function estadoDelPaso(s, p) {
  if (p.t !== "ej") return s.cola.indexOf(p) < s.paso ? "hecho" : "pendiente";
  const hechas = ((S.dias.get(s.fecha)?.series || {})[p.id] || []).filter((x) => x?.hecha).length;
  const e = ejercicioPorId(p.id);
  if (hechas >= (e?.series || 4)) return "hecho";
  if ((s.salteados || []).includes(p.id)) return "salteado";
  return "pendiente";
}

function pintarBarraRutina() {
  const s = S.sesion;
  const barra = $("#rutina-barra");
  if (!barra || !s) return;
  const puntos = s.cola.map((p, i) => {
    const est = i === s.paso ? "actual" : estadoDelPaso(s, p);
    return `<i class="rb-punto rb-${est}"></i>`;
  }).join("");
  $("#rb-puntos").innerHTML = puntos;
  const hechos = s.cola.filter((p, i) => i !== s.paso && estadoDelPaso(s, p) === "hecho").length;
  $("#rb-texto").textContent = `${dondeVaLaSesion(s)} · ${hechos + 1} de ${s.cola.length}`;
}

function panelRutinaAbierto() {
  return !$("#rutina-panel")?.classList.contains("oculta");
}
function cerrarPanelRutina() {
  const p = $("#rutina-panel");
  if (!p) return;
  p.classList.remove("visible");
  setTimeout(() => p.classList.add("oculta"), movReducido() ? 0 : 300);
}

/* Panel a pantalla completa con la rutina entera: saltar, saltear y retomar. */
function abrirPanelRutina() {
  const s = S.sesion;
  if (!s) return;
  const panel = $("#rutina-panel");
  const reg = S.dias.get(s.fecha) || {};
  const vol = volumenSesion({ ...reg, rutinaId: s.rutinaId });
  const dur = (Date.now() - s.inicio) / 1000;
  const faltan = s.cola.filter((p, i) => i !== s.paso && estadoDelPaso(s, p) !== "hecho").length;

  const filas = s.cola.map((p, i) => {
    const est = i === s.paso ? "actual" : estadoDelPaso(s, p);
    const e = p.t === "ej" ? ejercicioPorId(p.id) : null;
    const ss = e ? (reg.series?.[e.id] || []).filter((x) => x?.hecha) : [];
    const titulo = e ? e.nombre
      : p.t === "bloque" ? `Bloque ${s.cola.filter((x) => x.t === "bloque").indexOf(p) + 1} · ${p.bloque === "cinta" ? "Cinta" : "Circuito"}`
      : p.t === "calor" || p.t === "movilidad" ? "Entrada en calor"
      : p.t === "cinta-cierre" ? "Cinta de cierre" : "Parte de cierre";
    const dato = e
      ? (ss.length ? `${ss.length} × ${fmtNumero(ss[ss.length - 1].peso, "carga")} kg` : `${e.series} × ${e.reps}`)
      : "";
    return `
      <button class="rp-fila rp-${est}" data-paso="${i}">
        ${e ? `<img src="img/ejercicios/${e.img}" alt="">` : `<span class="rp-sin-img"></span>`}
        <span class="rp-cuerpo">
          <span class="rp-nombre">${esc(titulo)}</span>
          <span class="rp-dato">${esc(dato)}</span>
        </span>
        <span class="rp-estado">${est === "hecho" ? "✅" : est === "salteado" ? "↩" : est === "actual" ? "●" : ""}</span>
      </button>`;
  }).join("");

  panel.innerHTML = `
    <div class="rp-cabecera">
      <div class="rp-resumen">
        <span><b class="num">${fmtDuracion(dur)}</b><small>tiempo</small></span>
        <span><b class="num">${fmtKg(vol)}</b><small>kg movidos</small></span>
        <span><b class="num">${faltan}</b><small>faltan</small></span>
      </div>
      <button id="rp-cerrar" class="btn btn-borde btn-medio">Cerrar</button>
    </div>
    <div class="rp-lista">${filas}</div>`;

  panel.classList.remove("oculta");
  requestAnimationFrame(() => panel.classList.add("visible"));
  ponerRedHistorial();

  $("#rp-cerrar").onclick = cerrarPanelRutina;
  panel.querySelectorAll("[data-paso]").forEach((b) => {
    b.onclick = () => {
      // Saltar a cualquier paso: retomar uno salteado o reabrir uno terminado.
      S.sesion.paso = Number(b.dataset.paso);
      S.sesion.timer = null;
      guardarSesion();
      cerrarPanelRutina();
      renderPasoSesion();
    };
  });
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

  // El récord ya está calculado al empezar la sesión: mostrarlo es gratis.
  const record = s.prMax?.[id];
  const vaARomper = record != null && s.pesoActual[id] > record;
  const completo = hechas >= e.series;

  cont.innerHTML = `
    <div class="paso-indicador">Ejercicio ${numEj} de ${totalEj}</div>
    <div class="ej-tarjeta">
      <img class="ej-img" src="img/ejercicios/${e.img}" alt="">
      <div class="ej-nombre">${esc(e.nombre)}</div>
      ${e.subtitulo ? `<div class="ej-sub">${esc(e.subtitulo)} · ${e.series}×${e.reps}</div>`
        : `<div class="ej-sub">${e.series}×${e.reps}</div>`}
      <ul class="ej-cues">${(e.cues || []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
      <div class="ej-referencias">
        ${previa ? `<div class="ej-ref">
          <span class="ej-ref-etiqueta">La vez pasada</span>
          <b class="num">${fmtNumero(previa.peso, "carga")} kg × ${previa.reps}</b></div>` : ""}
        ${record != null ? `<div class="ej-ref ${vaARomper ? "ej-ref-cerca" : ""}">
          <span class="ej-ref-etiqueta">Tu récord</span>
          <b class="num">${fmtNumero(record, "carga")} kg</b></div>` : ""}
      </div>
      ${sugerencia ? `<div class="ej-nota-guardada">${esc(sugerencia)}</div>` : ""}
      ${notaPersistente ? `<div class="ej-nota-guardada">Nota: ${esc(notaPersistente)}</div>` : ""}

      <div class="peso-control">
        <button class="btn-paso" id="peso-menos" aria-label="Bajar peso">−</button>
        <input class="peso-input" id="peso-input" type="text" inputmode="decimal" value="${fmtNumero(s.pesoActual[id], "carga")}">
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

      ${completo ? `
      <div class="entreno-pie">
        <button id="btn-ej-sig" class="btn btn-rojo btn-gigante">Siguiente ejercicio</button>
      </div>`
      : `
      <div class="entreno-pie">
        <button id="btn-marcar" class="btn-completar">
          <span class="bc-titulo">✓ &nbsp;MARCAR SERIE</span>
          <span class="bc-dato">Quedan ${e.series - hechas} de ${e.series}</span>
        </button>
        <button id="btn-marcar-todas" class="btn-completar btn-completar-borde">
          <span class="bc-titulo">✓✓ &nbsp;MARCAR LAS ${e.series} COMPLETAS</span>
        </button>
        <button id="btn-ej-sig" class="btn btn-rojo btn-grande">Siguiente ejercicio</button>
      </div>`}

      <div class="paso-indicador">¿Costaron las últimas dos? (opcional)</div>
      <div class="esfuerzo-botones">
        ${[["sobrado", "Sobrado"], ["justo", "Justo"], ["roto", "Se rompió"]].map(([v, t]) =>
          `<button data-esf="${v}" class="btn btn-borde ${reg.esfuerzo?.[id] === v ? "sel" : ""}">${t}</button>`).join("")}
      </div>

      <div class="ej-acciones">
        <button id="btn-nota" class="btn btn-borde">Nota ${notaPersistente ? "✓" : ""}</button>
        <button id="btn-ascenso" class="btn btn-borde ${marcadoAscenso ? "ej-accion-activa" : ""}">
          ${marcadoAscenso ? "Marcado para ascenso" : "Marcar para ascenso"}</button>
        <button id="btn-ocupada" class="btn btn-borde">Máquina ocupada</button>
        ${id.startsWith("prensa") ? `<button id="btn-discos" class="btn btn-borde">Discos</button>` : `<span></span>`}
      </div>
    </div>`;

  const inputPeso = $("#peso-input");
  const cambiarPeso = (delta) => {
    const v = Math.max(0, (leerNumero(inputPeso, "carga") ?? 0) + delta);
    s.pesoActual[id] = Math.round(v * 10) / 10;
    inputPeso.value = fmtNumero(s.pesoActual[id], "carga");
    // El récord se ilumina apenas el peso elegido lo supera, antes de marcar.
    cont.querySelector(".ej-ref:last-child")
      ?.classList.toggle("ej-ref-cerca", record != null && s.pesoActual[id] > record);
    guardarSesion();
  };
  $("#peso-menos").onclick = () => cambiarPeso(-e.pesoPaso);
  $("#peso-mas").onclick = () => cambiarPeso(e.pesoPaso);
  inputPeso.onchange = () => cambiarPeso(0);

  $("#reps-menos").onclick = () => { s.repsActual[id] = Math.max(1, s.repsActual[id] - 1); $("#reps-num").textContent = s.repsActual[id]; guardarSesion(); };
  $("#reps-mas").onclick = () => { s.repsActual[id]++; $("#reps-num").textContent = s.repsActual[id]; guardarSesion(); };

  /* Guarda una lista de series y devuelve una función que restaura la anterior. */
  const escribirSeries = async (nuevas, boton) => {
    const antes = JSON.parse(JSON.stringify(series));
    const ok = await guardarDia(s.fecha,
      { series: { ...(reg.series || {}), [id]: nuevas.filter(Boolean) } },
      { queHacia: "la serie", boton });
    if (!ok) return null;
    guardarSesion();
    renderPasoSesion();
    return async () => {
      await guardarDia(s.fecha, { series: { ...(reg.series || {}), [id]: antes } },
        { queHacia: "la serie" });
      s.prMax = maximosHistoricos();
      renderPasoSesion();
    };
  };

  const celebrarRecord = () => {
    const marcaPrevia = s.prMax[id];
    if (!s.esPrueba && marcaPrevia !== undefined && s.pesoActual[id] > marcaPrevia) {
      s.prMax[id] = s.pesoActual[id];
      bannerRecord(sargento("record", {
        ejercicio: e.nombre, peso: fmtNumero(s.pesoActual[id], "carga"),
      }));
    } else if (marcaPrevia === undefined) {
      s.prMax[id] = s.pesoActual[id];
    }
  };

  /* Tocar una serie ya marcada la desmarca. */
  cont.querySelectorAll("[data-serie]").forEach((b) => {
    b.onclick = async () => {
      const i = Number(b.dataset.serie);
      if (!series[i]?.hecha) { marcarUnaSerie(b); return; }
      const nuevas = [...series];
      nuevas[i] = null;
      vibrar("leve");
      await escribirSeries(nuevas, b);
    };
  });

  /* Marcar una serie: valida el peso, marca, arranca el descanso y ofrece deshacer. */
  async function marcarUnaSerie(boton) {
    if (!await pesoRazonable(id, e, s.pesoActual[id], s.repsActual[id])) return;
    const nuevas = [...series];
    const libre = nuevas.findIndex((x) => !x?.hecha);
    const i = libre === -1 ? nuevas.length : libre;
    nuevas[i] = { peso: s.pesoActual[id], reps: s.repsActual[id], hecha: true };
    const esUltima = nuevas.filter((x) => x?.hecha).length >= e.series;
    vibrar(esUltima ? "confirmar" : "leve");
    celebrarRecord();
    ponerDescanso();
    const revertir = await escribirSeries(nuevas, boton);
    if (revertir) ofrecerDeshacer(`Serie ${i + 1} marcada`, async () => {
      cancelarCampana("descanso");
      s.descanso = null;
      await revertir();
    });
  }

  const bMarcar = $("#btn-marcar");
  if (bMarcar) bMarcar.onclick = () => marcarUnaSerie(bMarcar);

  /* Marcar todas de una: para cuando terminé y me olvidé de ir marcando. */
  const bTodas = $("#btn-marcar-todas");
  if (bTodas) bTodas.onclick = async () => {
    if (!await pesoRazonable(id, e, s.pesoActual[id], s.repsActual[id])) return;
    const nuevas = Array.from({ length: e.series }, (_, i) => series[i]?.hecha ? series[i]
      : { peso: s.pesoActual[id], reps: s.repsActual[id], hecha: true });
    vibrar("confirmar");
    celebrarRecord();
    const revertir = await escribirSeries(nuevas, bTodas);
    if (revertir) ofrecerDeshacer(`${e.nombre}: ${e.series} series marcadas`, revertir);
  };

  cont.querySelectorAll("[data-esf]").forEach((b) => {
    b.onclick = async () => {
      // Volver a tocar el mismo lo desmarca: es opcional de verdad.
      const nuevo = reg.esfuerzo?.[id] === b.dataset.esf ? null : b.dataset.esf;
      await guardarDia(s.fecha, { esfuerzo: { ...(reg.esfuerzo || {}), [id]: nuevo } });
      vibrar("leve");
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
  $("#btn-ocupada").onclick = () => saltearEjercicio();
  const discos = $("#btn-discos");
  if (discos) discos.onclick = () => hojaDiscos(leerNumero(inputPeso, "carga") || 0);

  // El esfuerzo dejó de bloquear: "Siguiente" avanza siempre.
  $("#btn-ej-sig").onclick = () => avanzarPaso();
}

/* Saltear manda el ejercicio al final de la cola, nunca lo pierde. */
function saltearEjercicio() {
  const s = S.sesion;
  const cola = s.cola;
  const actual = cola[s.paso];
  if (!actual || actual.t !== "ej") return;
  const posOriginal = s.paso;
  cola.splice(s.paso, 1);
  let pos = cola.findIndex((p) => p.t === "cinta-cierre");
  if (pos < 0) pos = cola.length;
  cola.splice(pos, 0, actual);
  s.timer = null; s.descanso = null;
  s.salteados = [...new Set([...(s.salteados || []), actual.id])];
  guardarSesion();
  renderPasoSesion();
  ofrecerDeshacer(`${nombreEjercicio(actual.id)} salteado`, () => {
    const i = cola.findIndex((p) => p.t === "ej" && p.id === actual.id);
    if (i >= 0) cola.splice(i, 1);
    cola.splice(posOriginal, 0, actual);
    s.paso = posOriginal;
    s.salteados = (s.salteados || []).filter((x) => x !== actual.id);
    guardarSesion();
    renderPasoSesion();
  });
}

/* ==========================================================================
   PESOS MAL TIPEADOS — el error que más ensucia récords, volumen y gráficos
   ========================================================================== */
function pesoRazonable(id, e, peso, reps) {
  return new Promise((resolver) => {
    const previa = laVezPasada(id);
    const raroPeso = previa && previa.peso > 0 && peso > 0 &&
      (peso > previa.peso * 2 || peso < previa.peso / 2);
    const raroReps = reps > e.reps * 2;
    if (!raroPeso && !raroReps) return resolver(true);

    const motivo = raroPeso
      ? `¿${fmtNumero(peso, "carga")} kg? La vez pasada fueron ${fmtNumero(previa.peso, "carga")}.`
      : `¿${reps} repeticiones? La rutina dice ${e.reps}.`;
    abrirHoja(`
      <h3>Revisá el número</h3>
      <p class="texto-2">${esc(motivo)} ¿Está bien?</p>
      <div class="hoja-acciones">
        <button id="pr-si" class="btn btn-primario btn-grande">Sí, está bien</button>
        <button id="pr-no" class="btn btn-borde btn-grande">Corregir</button>
      </div>`, { onCerrar: () => resolver(false) });
    $("#pr-si").onclick = () => { cerrarHoja(true); resolver(true); };
    $("#pr-no").onclick = () => { cerrarHoja(true); resolver(false); };
  });
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
      <input id="discos-total" type="text" inputmode="decimal" value="${pesoInicial ? fmtNumero(pesoInicial, "carga") : ""}"></div>
    <div id="discos-out" class="discos-resultado"></div>`);
  const calcular = () => {
    const total = leerNumero($("#discos-total"), "carga") || 0;
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
        <button class="btn-paso" id="v-menos1" aria-label="Restar una vuelta">−1</button>
        <button class="btn-paso" id="v-menos" aria-label="Restar media vuelta">−½</button>
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
    $("#v-menos1").onclick = () => cambiarV(-1);
    $("#v-menos").onclick = () => cambiarV(-0.5);
    $("#v-media").onclick = () => cambiarV(0.5);
    $("#v-mas").onclick = () => cambiarV(1);
  }
  const ir = $("#btn-bloque-ir");
  if (ir) ir.onclick = () => ponerTimer(bloqueDef.duracionSeg, bloqueDef.nombre);
  const sig = $("#btn-bloque-sig");
  if (sig) sig.onclick = () => {
    const pasoPrevio = s.paso;
    const timerPrevio = s.timer ? { ...s.timer } : null;
    avanzarPaso();
    ofrecerDeshacer(`Bloque ${numBloque} terminado`, () => {
      s.paso = pasoPrevio;
      s.timer = timerPrevio;
      if (timerPrevio && !timerPrevio.sono) reagendarTemporizadores();
      guardarSesion();
      renderPasoSesion();
    });
  };
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
    const sesionPrevia = JSON.parse(JSON.stringify(s));
    const ok = await guardarDia(s.fecha, {
      fin: Date.now(),
      comentario: $("#cierre-comentario").value.trim(),
      sesion: { abierta: false },
      cerradaAutomatica: false,
    }, { queHacia: "el cierre del entrenamiento", boton: ev.currentTarget });
    if (!ok) return;
    const datos = { vol, dur: durSeg, comparacion, esPrueba: s.esPrueba };
    const fecha = s.fecha;
    S.sesion = null;
    limpiarSesionLocal();
    soltarWakeLock();
    frenarTickeo();
    clearTimeout(cierreAutoTimer);
    momentoCierre({
      ...datos,
      alCerrar: () => {
        irA("inicio", true);
        ofrecerDeshacer("Sesión cerrada", async () => {
          await guardarDia(fecha, { fin: null, sesion: sesionParaGuardar(sesionPrevia) },
            { queHacia: "la reapertura" });
          S.sesion = sesionPrevia;
          S.sesion.cola = armarCola(sesionPrevia.rutinaId);
          S.sesion.prMax = maximosHistoricos();
          reagendarTemporizadores();
          pedirWakeLock();
          arrancarTickeo();
          irA("entreno");
        });
      },
    });
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
    if (esFeriado(iso)) cls += " d-feriado";
    // La gota no reemplaza el color del día: un día puede ser verde y tenerla.
    const gota = cumplioAgua(iso) ? `<i class="cal-gota" title="Objetivo de agua cumplido"></i>` : "";
    const celda = el("button", `cal-dia ${cls} ${iso === hoy ? "d-hoy" : ""}`,
      `${d}${gota}`);
    if (e === "previo") celda.disabled = true;
    // Siempre el detalle: es desde donde se arregla cualquier cosa del día.
    else celda.onclick = () => hojaDetalleDia(iso);
    grilla.appendChild(celda);
  }
}

function renderHeatmap() {
  const hoy = hoyISO();
  const piso = pisoFecha();
  // Arranca en la semana en que empezó a usar la app: antes no hay historia
  // que mostrar, y un año de puntos grises solo ensucia.
  const inicio = lunesDe(piso);
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
  else if (registrado && reg?.rutinaId) acciones.push(`<button id="dd-reabrir" class="btn btn-borde btn-grande">Reabrir y seguir cargando series</button>`);
  if (registrado) acciones.push(`<button id="dd-ficha" class="btn btn-borde btn-grande">Ver la ficha completa</button>`);
  if (registrado && reg?.rutinaId) acciones.push(`<button id="dd-series" class="btn btn-borde btn-grande">Corregir pesos y repeticiones</button>`);
  if (faltaFoto) acciones.push(`<button id="dd-foto" class="btn btn-borde btn-grande">Agregar la foto</button>`);
  if (faltaParte) acciones.push(`<button id="dd-parte" class="btn btn-borde btn-grande">Completar hambre y cansancio</button>`);
  if (!registrado && estado !== "causa-mayor" && fecha <= hoy) {
    acciones.push(`<button id="dd-hecho" class="btn btn-primario btn-grande">Marcar como hecho</button>`);
    acciones.push(`<button id="dd-retro" class="btn btn-borde btn-grande">Cargar los pesos que hice</button>`);
  }
  if (plan.tipo === "descanso" && fecha <= hoy && !esFeriado(fecha)) {
    acciones.push(`<button id="dd-caminata" class="btn btn-borde btn-grande">${reg?.caminata ? "Editar" : "Registrar"} caminata</button>`);
  }

  // El parte de la semana se consulta desde cualquier día de una semana cerrada.
  if (lunesDe(fecha) < lunesDe(hoy)) {
    acciones.push(`<button id="dd-parte-semana" class="btn btn-borde btn-grande">Ver el parte de esa semana</button>`);
  }

  /* Feriado y causa mayor se marcan en cualquier día, pasado o futuro, y se
     desmarcan. Bajan el objetivo de esa semana en uno. */
  const esFer = esFeriado(fecha);
  const marcas = [];
  if (esFeriadoDeArchivo(fecha)) {
    marcas.push(`<p class="dato">Feriado fijo de rutinas.js: se saca desde ese archivo.</p>`);
  } else {
    marcas.push(`<button id="dd-feriado" class="btn btn-borde btn-grande">${
      esFer ? "Quitar el feriado" : "Marcar como feriado"}</button>`);
  }
  if (estado === "causa-mayor") {
    marcas.push(`<button id="dd-quitar-causa" class="btn btn-borde btn-grande">Quitar la causa mayor</button>`);
  } else if (!esFer && !registrado) {
    marcas.push(`<button id="dd-causa" class="btn btn-borde btn-grande">Marcar como causa mayor</button>`);
  }

  abrirHoja(`
    <h3 style="text-transform:capitalize">${fmtFechaLarga(fecha)}</h3>
    ${cuerpo}
    ${acciones.length ? `<div class="hoja-acciones">${acciones.join("")}</div>` : ""}
    ${marcas.length ? `<div class="paso-indicador">Marcar el día</div>
      <div class="hoja-acciones" style="margin-top:0">${marcas.join("")}</div>` : ""}`);

  const on = (id, fn) => { const b = $(`#${id}`); if (b) b.onclick = fn; };

  on("dd-parte-semana", () => hojaParteSemanal(lunesDe(fecha)));
  on("dd-feriado", (ev) => alternarFeriado(fecha, ev.currentTarget));
  on("dd-causa", () => hojaCausaMayor(fecha, escudoDisponible(fecha.slice(0, 7))));
  on("dd-quitar-causa", async (ev) => {
    const antes = { ...(S.dias.get(fecha) || {}) };
    const ok = await guardarDia(fecha, {
      estado: null, causaMayor: null, tipo: planDelDia(fecha).tipo,
    }, { queHacia: "la causa mayor", boton: ev.currentTarget });
    if (!ok) return;
    cerrarHoja(true);
    await procesarSemanasCerradas();
    refrescarVistaActual();
    ofrecerDeshacer("Causa mayor quitada", async () => {
      await guardarDia(fecha, { estado: antes.estado, causaMayor: antes.causaMayor || null },
        { queHacia: "la causa mayor" });
      await procesarSemanasCerradas();
      refrescarVistaActual();
    });
  });

  on("dd-retomar", () => { cerrarHoja(true); retomarSesion(fecha); });
  /* Una sesión ya cerrada se reabre: se le vuelven a cargar series y se cierra
     de nuevo con "Terminar". El día sigue contando igual mientras tanto. */
  on("dd-reabrir", async (ev) => {
    const ok = await guardarDia(fecha, {
      fin: null,
      sesion: {
        abierta: true, rutinaId: reg.rutinaId, fecha,
        esRecuperacion: reg.estado === "recuperada", fechaOriginal: reg.recuperaDe || null,
        esPrueba: !!reg.esPrueba, inicio: reg.inicio || Date.now(), paso: 0,
        calorHecho: {}, pesoActual: {}, repsActual: {},
        timer: null, descanso: null, tocada: Date.now(),
        hechoEl: hoyISO(),
      },
      cerradaAutomatica: false,
    }, { queHacia: "la reapertura", boton: ev.currentTarget });
    if (!ok) return;
    cerrarHoja(true);
    retomarSesion(fecha);
  });
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

/* Marcar o desmarcar un feriado. Recalcula la racha al instante. */
async function alternarFeriado(fecha, boton) {
  const feriados = { ...(S.config.feriados || {}) };
  const estaba = !!feriados[fecha];
  if (estaba) delete feriados[fecha];
  else feriados[fecha] = true;

  const ok = await guardarConfig({ feriados }, { queHacia: "el feriado", boton });
  if (!ok) return;
  cerrarHoja(true);
  await procesarSemanasCerradas();
  refrescarVistaActual();
  ofrecerDeshacer(estaba ? "Feriado quitado" : "Día marcado como feriado", async () => {
    const vuelta = { ...(S.config.feriados || {}) };
    if (estaba) vuelta[fecha] = true; else delete vuelta[fecha];
    await guardarConfig({ feriados: vuelta }, { queHacia: "el feriado" });
    await procesarSemanasCerradas();
    refrescarVistaActual();
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
          ${[0, 1, 2, 3].map((i) => `<input data-ed-v="${i}" type="text" inputmode="decimal"
            value="${fmtNumero(v[i] || 0, "carga")}">`).join("")}
        </div></div>
      <div class="hoja-acciones">
        <button id="ed-guardar" class="btn btn-primario btn-grande">Guardar</button>
      </div>`);
    $("#ed-guardar").onclick = async (ev) => {
      const vueltas = $$("[data-ed-v]").map((i) => leerNumero(i, "carga") || 0);
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
  // Copia de trabajo: se edita acá y recién al guardar se escribe.
  const series = JSON.parse(JSON.stringify(reg.series || {}));

  const pintar = (primera) => {
    const filas = ejercicios.map((e) => {
      const ss = series[e.id] || [];
      return `
        <div class="ed-ejercicio">
          <div class="ficha-nombre">${esc(e.nombre)}</div>
          ${ss.length ? ss.map((x, i) => `
            <div class="ed-serie">
              <span class="dato">Serie ${i + 1}</span>
              <input data-ed="${e.id}" data-i="${i}" data-campo="peso" type="text"
                inputmode="decimal" value="${fmtNumero(x?.peso, "carga")}" aria-label="Peso">
              <span class="dato">kg ×</span>
              <input data-ed="${e.id}" data-i="${i}" data-campo="reps" type="text"
                inputmode="numeric" value="${x?.reps ?? ""}" aria-label="Repeticiones">
              <button class="btn-icono" data-quitar="${e.id}:${i}" aria-label="Quitar esta serie">✕</button>
            </div>`).join("") : `<p class="dato">Sin series ese día.</p>`}
          <button class="btn btn-texto" data-sumar="${e.id}">+ Agregar serie</button>
        </div>`;
    }).join("");

    const html = `
      <h3>Corregir series</h3>
      <p class="texto-2">${esc(fmtFechaLarga(fecha))}. Al guardar se recalculan
      los récords, el volumen y las estadísticas.</p>
      ${filas}
      <div class="hoja-acciones">
        <button id="ed-guardar" class="btn btn-primario btn-grande">Guardar cambios</button>
      </div>`;
    if (primera) abrirHoja(html); else $("#hoja-contenido").innerHTML = html;
    enganchar();
  };

  /* Lee lo tipeado a la copia de trabajo, para no perderlo al repintar. */
  const absorber = () => {
    for (const inp of $$("#hoja-contenido [data-ed]")) {
      const id = inp.dataset.ed, i = Number(inp.dataset.i);
      if (!series[id]?.[i]) continue;
      const campo = inp.dataset.campo;
      const valor = leerNumero(inp, campo === "reps" ? "ml" : "carga");
      if (valor != null) series[id][i][campo] = valor;
    }
  };

  const enganchar = () => {
    $$("#hoja-contenido [data-quitar]").forEach((b) => {
      b.onclick = () => {
        absorber();
        const [id, i] = b.dataset.quitar.split(":");
        series[id].splice(Number(i), 1);
        if (!series[id].length) delete series[id];
        vibrar("leve");
        pintar(false);
      };
    });
    $$("#hoja-contenido [data-sumar]").forEach((b) => {
      b.onclick = () => {
        absorber();
        const id = b.dataset.sumar;
        const e = ejercicioPorId(id);
        const ultima = (series[id] || [])[(series[id] || []).length - 1];
        series[id] = [...(series[id] || []), {
          peso: ultima?.peso ?? laVezPasada(id)?.peso ?? e.pesoSugerido ?? 0,
          reps: ultima?.reps ?? e.reps, hecha: true,
        }];
        vibrar("leve");
        pintar(false);
      };
    });
    $("#ed-guardar").onclick = guardar;
  };

  const guardar = async (ev) => {
    absorber();
    const ok = await guardarDia(fecha, { series },
      { queHacia: "las series", boton: ev.currentTarget });
    if (!ok) return;
    // Si hay una sesión en curso, sus récords quedaron viejos tras la edición.
    if (S.sesion) S.sesion.prMax = maximosHistoricos();
    cerrarHoja(true);
    refrescarVistaActual();
    toast("Series corregidas.");
  };

  pintar(true);
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
        <input data-retro-ej="${e.id}" type="text" inputmode="decimal"
          value="${fmtNumero(previa?.peso ?? e.pesoSugerido, "carga")}"></div>`;
    }).join("");
  } else {
    campos = `<div class="campo"><label>Vueltas por bloque (4 bloques)</label>
      <div class="retro-vueltas">
        ${[0, 1, 2, 3].map((i) => `<input data-retro-v="${i}" type="text" inputmode="decimal" value="3">`).join("")}
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
        const peso = leerNumero(inp, "carga");
        if (peso == null) return;
        const e = ejercicioPorId(inp.dataset.retroEj);
        dia.series[e.id] = Array.from({ length: e.series }, () => ({ peso, reps: e.reps, hecha: true }));
      });
    } else {
      dia.vueltas = $$("[data-retro-v]").map((inp) => leerNumero(inp, "carga") || 0);
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
    <div class="ficha-seccion">Foto del día</div>
    ${reg.tieneFoto
      ? `<div id="ficha-foto" class="dato">Cargando…</div>`
      : `<p class="vacio-direccion">Este día quedó sin foto.</p>`}
    <div class="ficha-acciones">
      <button id="fic-series" class="btn btn-borde btn-grande">Corregir pesos y repeticiones</button>
      <button id="fic-parte" class="btn btn-borde btn-grande">Completar hambre, cansancio y comentario</button>
      ${reg.tieneFoto ? "" : `<button id="fic-foto" class="btn btn-borde btn-grande">Agregar la foto</button>`}
    </div>
  `, { desde: desdeEl });

  $("#fic-series").onclick = () => hojaEditarSeries(fecha);
  $("#fic-parte").onclick = () => hojaCompletarCierre(fecha);
  const bFoto = $("#fic-foto");
  if (bFoto) bFoto.onclick = () => hojaAgregarFoto(fecha);

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
      } else if (caja) caja.textContent = "La foto no está en este dispositivo todavía. Volvé a entrar con conexión.";
    });
  }
}

/* La escala del 1 al 5 se ve entera con el valor marcado, no como número suelto.
   Si quedó vacía (sesión cerrada sola), se muestra el hueco, no se esconde. */
function escalaHTML(nombre, valor) {
  const puntos = [1, 2, 3, 4, 5].map((n) =>
    `<span class="esc-punto ${valor === n ? "sel" : ""}">${n}</span>`).join("");
  return `
    <div class="ficha-escala ${valor ? "" : "vacia"}">
      <span class="dato">${nombre}</span>
      <span class="esc-puntos">${puntos}</span>
      ${valor ? "" : `<span class="dato">sin cargar</span>`}
    </div>`;
}

function indicadoresDiaHTML(fecha) {
  const reg = S.dias.get(fecha);
  const registrado = sesionRegistrada(fecha);
  const pesaje = S.pesajes.get(fecha);
  const objetivo = S.config.aguaObjetivoMl || 2000;
  const ml = reg?.aguaMl || 0;

  return `
    <div class="ficha-seccion">Cómo estuviste</div>
    ${escalaHTML("Hambre", reg?.hambre)}
    ${escalaHTML("Cansancio", reg?.cansancio)}
    <div class="dia-detalle-fila"><span>Agua del día</span>
      <span class="num">${fmtNumero(ml / 1000, "carga")} de ${fmtNumero(objetivo / 1000, "carga")} L</span></div>
    ${pesaje ? `<div class="dia-detalle-fila"><span>Peso corporal</span>
      <span class="num">${fmtNumero(pesaje.pesoKg, "peso")} kg</span></div>` : ""}
    ${reg?.comentario ? `<p class="mt">${esc(reg.comentario)}</p>`
      : (registrado ? `<p class="dato mt">No dejaste comentario. Se puede agregar con "Completar".</p>` : "")}`;
}

/* ==========================================================================
   PROGRESO — dos secciones independientes, cada una con su lugar en la barra
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
  const cont = $("#progreso-peso");
  const lista = pesajesOrdenados();
  const objetivo = S.config.pesoObjetivo;
  const ultimo = lista[lista.length - 1];
  const tendencia = lista.length ? tendenciaEn(lista, lista.length - 1) : null;
  /* El pesaje es de los lunes, pero el aviso insiste todos los días hasta que
     lo carga. Una vez cargado en la semana, no se vuelve a pedir. */
  const lunes = lunesDe(hoyISO());
  const pesadoEstaSemana = [...S.pesajes.keys()].some((f) => f >= lunes && f <= hoyISO());

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
    ${!pesadoEstaSemana ? `<p class="vacio-direccion">${
      diaSemanaDe(hoyISO()) === CONFIG.pesajeDia
        ? "Hoy es lunes: día de pesaje."
        : "Todavía no te pesaste esta semana. Subite a la balanza y seguimos midiendo."}</p>` : ""}
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
      <input id="pes-kg" type="text" inputmode="decimal" placeholder="84,250"
        value="${fmtNumero(previo?.pesoKg, "peso")}"></div>
    ${["balanza", "espejo"].map((cual) => `
    <div class="campo"><label>Foto de la ${cual === "balanza" ? "balanza" : "del espejo"}</label>
      <div class="foto-zona" id="pes-${cual}-zona">${previo?.[cual === "balanza" ? "tieneBalanza" : "tieneEspejo"]
        ? "Foto ya guardada · tocá para cambiar" : "Sin foto"}</div>
      <input id="pes-${cual}-camara" type="file" accept="image/*" capture="environment" hidden>
      <input id="pes-${cual}-galeria" type="file" accept="image/*" hidden>
      <div class="foto-botones">
        <button id="pes-${cual}-btn-camara" class="btn btn-borde btn-medio">Sacar foto</button>
        <button id="pes-${cual}-btn-galeria" class="btn btn-borde btn-medio">Elegir de galería</button>
      </div></div>`).join("")}
    <div class="hoja-acciones">
      <button id="pes-guardar" class="btn btn-primario btn-grande">Guardar pesaje</button>
    </div>`);

  const fotos = {};
  for (const cual of ["balanza", "espejo"]) {
    const zona = $(`#pes-${cual}-zona`);
    const tomar = async (ev) => {
      const f = ev.target.files?.[0];
      if (!f) return;
      zona.textContent = "Comprimiendo…";
      try {
        fotos[cual] = await comprimirFoto(f);
        zona.innerHTML = `<img src="${fotos[cual]}" alt="">`;
      } catch (_) { zona.textContent = "No se pudo procesar"; }
    };
    $(`#pes-${cual}-camara`).onchange = tomar;
    $(`#pes-${cual}-galeria`).onchange = tomar;
    $(`#pes-${cual}-btn-camara`).onclick = () => $(`#pes-${cual}-camara`).click();
    $(`#pes-${cual}-btn-galeria`).onclick = () => $(`#pes-${cual}-galeria`).click();
    zona.onclick = () => $(`#pes-${cual}-galeria`).click();
  }

  $("#pes-guardar").onclick = async (ev) => {
    const kg = leerNumero($("#pes-kg"), "peso");
    if (!kg) { $("#pes-kg").focus(); toast("Falta el peso.", "toast-alerta"); return; }
    const data = {
      fecha: hoy, pesoKg: kg, hora: Date.now(),
      tieneBalanza: !!(fotos.balanza || previo?.tieneBalanza),
      tieneEspejo: !!(fotos.espejo || previo?.tieneEspejo),
    };
    const ok = await escribir("el pesaje",
      () => setDoc(refs.pesaje(hoy), data, { merge: true }), ev.currentTarget);
    if (!ok) return;
    if (fotos.balanza) await escribir("la foto de la balanza",
      () => setDoc(refs.pesajeMedia(hoy, "balanza"), { data: fotos.balanza, hora: Date.now() }));
    if (fotos.espejo) await escribir("la foto del espejo",
      () => setDoc(refs.pesajeMedia(hoy, "espejo"), { data: fotos.espejo, hora: Date.now() }));
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

/* ==========================================================================
   EL PARTE DEL DOMINGO — el resumen de la semana que se cerró
   ========================================================================== */
function hojaParteSemanal(lunes) {
  const r = resumenSemana(lunes);
  const domingo = r.domingo;
  let volumen = 0, agua = 0, diasConAgua = 0;
  for (let i = 0; i < 7; i++) {
    const f = sumarDias(lunes, i);
    const reg = regReal(f);
    if (reg && sesionRegistrada(f)) volumen += volumenSesion(reg);
    const ml = S.dias.get(f)?.aguaMl || 0;
    if (ml) { agua += ml; diasConAgua++; }
  }
  const pesajes = pesajesOrdenados().filter((p) => p.fecha >= lunes && p.fecha <= domingo);
  const peso = pesajes[pesajes.length - 1];
  const { racha } = calcularRacha();

  const veredicto = r.completa
    ? (r.mencionHonor ? sargento("mencionHonor") : sargento("yaEntreno", { resumen: "" }))
    : (r.neutra ? "Semana sin días de entreno. La racha quedó como estaba."
      : sargento("bajoRango", { rango: rangoSiFalla(racha).nombre }));

  abrirHoja(`
    <h3>Parte de la semana</h3>
    <p class="texto-2">Del ${fmtFechaCorta(lunes)} al ${fmtFechaCorta(domingo)}</p>
    <div class="peso-resumen">
      <div class="peso-tarjeta"><strong class="num">${r.sesiones}/${r.objetivo}</strong><span>Sesiones</span></div>
      <div class="peso-tarjeta"><strong class="num">${fmtNumero(volumen, "ml")}</strong><span>kg movidos</span></div>
      <div class="peso-tarjeta"><strong class="num">${diasConAgua ? fmtLitros(Math.round(agua / diasConAgua)) : "—"}</strong><span>L de agua / día</span></div>
    </div>
    <div class="dia-detalle-fila"><span>Días con el agua cumplida</span><span class="num">${r.diasAgua} de 7</span></div>
    <div class="dia-detalle-fila"><span>Caminatas en descanso</span><span class="num">${r.caminatas}</span></div>
    ${peso ? `<div class="dia-detalle-fila"><span>Peso</span><span class="num">${fmtNumero(peso.pesoKg, "peso")} kg</span></div>` : ""}
    ${r.feriados ? `<div class="dia-detalle-fila"><span>Feriados</span><span class="num">${r.feriados}</span></div>` : ""}
    ${r.causasMayores ? `<div class="dia-detalle-fila"><span>Causa mayor</span><span class="num">${r.causasMayores}</span></div>` : ""}
    ${r.mencionHonor ? `<div class="dia-detalle-fila"><span>Mención de honor</span><span>🏅 sí</span></div>` : ""}
    <p class="mt">${esc(veredicto)}</p>`);
}

/* ==========================================================================
   VOLUMEN POR GRUPO MUSCULAR — lo que muestra si algo se está descuidando
   --------------------------------------------------------------------------
   Cuenta las dos rutinas. Las mancuernas del circuito de lunes y jueves entran
   con peso × repeticiones, y los `porLado` cuentan doble porque se hacen con
   los dos brazos (el curl y la patada de tríceps).
   ========================================================================== */
const GRUPOS = ["piernas", "espalda", "pecho", "brazos", "hombros"];

function volumenPorGrupo(desde, hasta) {
  const total = {};
  for (const f of [...S.dias.keys()].sort()) {
    if (f < desde || f > hasta) continue;
    const reg = regReal(f);
    if (!reg || !sesionRegistrada(f)) continue;

    if (reg.series) {
      for (const [id, ss] of Object.entries(reg.series)) {
        const g = ejercicioPorId(id)?.grupo;
        if (!g) continue;
        for (const x of ss || []) {
          if (x?.hecha) total[g] = (total[g] || 0) + (x.peso || 0) * (x.reps || 0);
        }
      }
    }
    if (reg.rutinaId === "intervalos" && reg.vueltas) {
      const vueltas = reg.vueltas.reduce((a, b) => a + (b || 0), 0);
      for (const e of INTERVALOS.circuito) {
        if (!e.peso || !e.grupo) continue;
        total[e.grupo] = (total[e.grupo] || 0) +
          vueltas * e.peso * e.reps * (e.porLado ? 2 : 1);
      }
    }
  }
  return total;
}

function barrasPorGrupoHTML(desde, hasta) {
  const total = volumenPorGrupo(desde, hasta);
  const max = Math.max(1, ...Object.values(total));
  const conDatos = GRUPOS.filter((g) => total[g]);
  if (!conDatos.length) {
    return `<p class="vacio-direccion">Todavía no hay volumen para repartir.
      Después de la primera semana esto muestra qué grupo estás descuidando.</p>`;
  }
  return `<div class="grupos">
    ${GRUPOS.map((g) => {
      const kg = total[g] || 0;
      return `
        <div class="grupo-fila">
          <span class="grupo-nombre">${g}</span>
          <span class="grupo-barra"><i style="width:${Math.round((kg / max) * 100)}%"></i></span>
          <span class="grupo-kg num">${fmtNumero(Math.round(kg), "ml")}</span>
        </div>`;
    }).join("")}
  </div>`;
}

/* Kilos movidos por semana, contando las dos rutinas. */
function volumenPorSemana() {
  const porSemana = new Map();
  for (const f of [...S.dias.keys()].sort()) {
    const reg = regReal(f);
    if (!reg || !sesionRegistrada(f)) continue;
    const vol = volumenSesion(reg);
    if (!vol) continue;
    const c = claveSemana(f);
    porSemana.set(c, (porSemana.get(c) || 0) + vol);
  }
  return [...porSemana.entries()].map(([clave, kg]) => ({ clave, kg }));
}

function renderHistorial() {
  const cont = $("#progreso-entreno");
  const ejercicios = [...MUSCULACION.bloques.flatMap((b) => b.ejercicios), ...INTERVALOS.circuito];
  const sel = localStorage.getItem("histEj") || "prensa-pos1";

  const semanas = volumenPorSemana();
  const totalKg = semanas.reduce((a, s) => a + s.kg, 0);
  const sesiones = [...S.dias.keys()].filter((f) => sesionRegistrada(f)).length;

  cont.innerHTML = `
    <div class="peso-resumen">
      <div class="peso-tarjeta"><strong class="num">${fmtNumero(sesiones, "ml")}</strong><span>Sesiones</span></div>
      <div class="peso-tarjeta"><strong class="num">${fmtNumero(Math.round(totalKg / 1000), "ml")}</strong><span>Toneladas</span></div>
      <div class="peso-tarjeta"><strong class="num">${fmtNumero(semanas.length ? Math.round(totalKg / semanas.length) : 0, "ml")}</strong><span>kg / semana</span></div>
    </div>
    <div class="seccion-titulo">Esta semana, por grupo</div>
    ${barrasPorGrupoHTML(lunesDe(hoyISO()), domingoDe(hoyISO()))}
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
  const conRecord = ejercicios.filter((e) => max[e.id]);
  caja.innerHTML = conRecord.map((e) => `
    <button class="pr-fila" data-pr="${e.id}"><span>${esc(e.nombre)}</span>
      <strong class="num">${fmtNumero(max[e.id].peso, "carga")} kg
        <span class="dato" style="font-weight:400">· ${fmtFechaCorta(max[e.id].fecha)}</span></strong></button>`).join("")
    || `<p class="vacio-direccion">Todavía no hay récords. El primero cae esta semana.</p>`;
  caja.querySelectorAll("[data-pr]").forEach((b) => {
    b.onclick = () => hojaEjercicio(b.dataset.pr, max[b.dataset.pr]);
  });
}

/* Ficha de un ejercicio: el dibujo, las indicaciones y su historial. */
function hojaEjercicio(id, record) {
  const e = ejercicioPorId(id);
  if (!e) return;
  const puntos = progresionDe(id);
  const previa = laVezPasada(id);

  abrirHoja(`
    <h3>${esc(e.nombre)}</h3>
    ${e.subtitulo ? `<p class="texto-2">${esc(e.subtitulo)}</p>` : ""}
    <img class="ej-img ej-img-clara" src="img/ejercicios/${e.img}" alt="">
    ${record ? `<div class="dia-detalle-fila"><span>Récord</span>
      <span class="num">${fmtNumero(record.peso, "carga")} kg · ${fmtFechaLarga(record.fecha)}</span></div>` : ""}
    ${previa ? `<div class="dia-detalle-fila"><span>La vez pasada</span>
      <span class="num">${fmtNumero(previa.peso, "carga")} kg × ${previa.reps}</span></div>` : ""}
    <div class="dia-detalle-fila"><span>Plan</span>
      <span class="num">${e.series ? `${e.series} × ${e.reps}` : `${e.reps} reps`}${
        e.peso ? ` · ${fmtNumero(e.peso, "carga")} kg${e.porLado ? " por lado" : ""}` : ""}</span></div>
    ${(e.cues || []).length ? `<div class="ficha-seccion">Cómo se hace</div>
      <ul class="ficha-cues">${e.cues.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
    <div class="ficha-seccion">Historial</div>
    ${puntos.length >= 2
      ? `<canvas id="ej-canvas" class="grafico"></canvas>`
      : `<p class="vacio-direccion">Con dos sesiones de este ejercicio aparece la curva.</p>`}`);

  if (puntos.length >= 2) {
    requestAnimationFrame(() => dibujarGraficoPeso($("#ej-canvas"), puntos, null));
  }
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
/* El `load` de una <img> avisa que el archivo llegó, pero NO que los píxeles
   estén listos para dibujar: con WebP el canvas salía en blanco y el PDF sin
   dibujos. `decode()` sí garantiza que la imagen está descodificada. Se espera
   eso antes de dibujar, con `load` de respaldo para navegadores viejos. */
const cacheJPEG = new Map();

async function imagenJPEG(nombre) {
  if (cacheJPEG.has(nombre)) return cacheJPEG.get(nombre);
  try {
    const img = new Image();
    img.src = `img/ejercicios/${nombre}`;
    if (img.decode) {
      await img.decode();
    } else {
      await new Promise((ok, mal) => { img.onload = ok; img.onerror = mal; });
    }
    const ancho = img.naturalWidth, alto = img.naturalHeight;
    if (!ancho || !alto) throw new Error("imagen sin dimensiones");

    const canvas = document.createElement("canvas");
    canvas.width = ancho; canvas.height = alto;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";                 // el JPEG no tiene transparencia
    ctx.fillRect(0, 0, ancho, alto);
    ctx.drawImage(img, 0, 0);

    const data = canvas.toDataURL("image/jpeg", 0.85);
    if (!data.startsWith("data:image/jpeg")) throw new Error("el canvas no dio JPEG");
    const out = { data, w: ancho, h: alto };
    cacheJPEG.set(nombre, out);
    return out;
  } catch (e) {
    console.warn("no se pudo convertir", nombre, e);
    return null;
  }
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
   AJUSTES — cuenta, diagnóstico, bitácora y copia de seguridad
   ========================================================================== */

/* ==========================================================================
   COPIA DE SEGURIDAD — sin las fotos, que pesan demasiado
   ========================================================================== */
function exportarCopia() {
  const copia = {
    version: 1, exportado: Date.now(), rutinasVersion: RUTINAS_VERSION,
    config: S.config || {},
    dias: Object.fromEntries(S.dias),
    pesajes: Object.fromEntries(S.pesajes),
    semanas: Object.fromEntries(S.semanas),
  };
  const blob = new Blob([JSON.stringify(copia, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mi-entrenador-${hoyISO()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`Copia de ${S.dias.size} días descargada.`, "toast-record");
}

async function importarCopia(file, boton) {
  let datos;
  try {
    datos = JSON.parse(await file.text());
  } catch (_) {
    toast("Ese archivo no es una copia válida.", "toast-alerta");
    return;
  }
  if (!datos?.dias || !datos?.config) {
    toast("Al archivo le faltan los días o la configuración.", "toast-alerta");
    return;
  }
  const nDias = Object.keys(datos.dias).length;
  abrirHoja(`
    <h3>¿Importar la copia?</h3>
    <p class="texto-2">Trae ${nDias} días, ${Object.keys(datos.pesajes || {}).length} pesajes
    y la configuración. Lo que tengas cargado con las mismas fechas se
    reemplaza. Las fotos no viajan en la copia y se conservan las actuales.</p>
    <div class="hoja-acciones">
      <button id="imp-si" class="btn btn-rojo btn-grande">Importar</button>
      <button id="imp-no" class="btn btn-borde btn-grande">Cancelar</button>
    </div>`);
  $("#imp-no").onclick = () => cerrarHoja(true);
  $("#imp-si").onclick = async (ev) => {
    ev.currentTarget.disabled = true;
    let fallos = 0;
    for (const [fecha, dia] of Object.entries(datos.dias)) {
      // La foto es del dispositivo, no de la copia: no se pisa.
      const { tieneFoto, ...resto } = dia;
      if (!await guardarDia(fecha, resto, { queHacia: `el día ${fecha}` })) fallos++;
    }
    for (const [fecha, p] of Object.entries(datos.pesajes || {})) {
      const ok = await escribir(`el pesaje ${fecha}`,
        () => setDoc(refs.pesaje(fecha), p, { merge: true }));
      if (!ok) fallos++;
    }
    for (const [clave, s] of Object.entries(datos.semanas || {})) {
      await escribir(`la semana ${clave}`, () => setDoc(refs.semana(clave), s, { merge: true }));
    }
    const { seedCargada, ...conf } = datos.config;
    await guardarConfig(conf, { queHacia: "la configuración" });
    cerrarHoja(true);
    toast(fallos ? `Importado con ${fallos} errores. Mirá la bitácora.` : "Copia importada.",
      fallos ? "toast-alerta" : "toast-record", 7000);
    if (fallos) anotarProblema(`importación con ${fallos} errores`);
    await procesarSemanasCerradas();
    refrescarVistaActual();
  };
}

function renderAjustes() {
  const cont = $("#ajustes-contenido");
  const problemas = leerBitacora();
  cont.innerHTML = `
    <div class="seccion-titulo">Cuenta</div>
    <div class="config-fila"><span>${esc(S.user?.email || "")}</span>
      <button id="cfg-salir" class="btn btn-texto">Cerrar sesión</button></div>
    <div class="config-fila"><span>Diagnóstico de sesión<small>Últimos movimientos del login</small></span>
      <button id="cfg-diag" class="btn btn-texto">Ver</button></div>
    <div id="cfg-diag-caja" class="oculta"></div>

    <div class="seccion-titulo">Bitácora de problemas</div>
    <p class="dato">Entrenando no vas a poder anotar qué falló. Dejalo acá en dos
    segundos y después lo vemos.</p>
    <div class="hoja-acciones" style="margin-top:8px">
      <button id="cfg-anotar" class="btn btn-borde btn-grande">Anotar un problema</button>
      ${problemas.length ? `<button id="cfg-bitacora" class="btn btn-borde btn-grande">Ver las ${problemas.length} anotaciones</button>` : ""}
    </div>
    <div id="cfg-bitacora-caja" class="oculta"></div>

    <div class="seccion-titulo">Copia de seguridad</div>
    <p class="dato">Días, pesajes, semanas y configuración. Sin las fotos, que
    pesan demasiado.</p>
    <div class="hoja-acciones" style="margin-top:8px">
      <button id="cfg-exportar" class="btn btn-borde btn-grande">Exportar a un archivo</button>
      <button id="cfg-importar" class="btn btn-borde btn-grande">Importar desde un archivo</button>
      <input id="cfg-importar-archivo" type="file" accept="application/json,.json" hidden>
    </div>

    <p class="dato centrado mt">Rutinas v${RUTINAS_VERSION} · fecha de inicio ${fmtFechaCorta(pisoFecha())}
      <br>Día calendario según ${TZ} · hoy es ${hoyISO()}</p>`;

  $("#cfg-exportar").onclick = () => exportarCopia();
  $("#cfg-importar").onclick = () => $("#cfg-importar-archivo").click();
  $("#cfg-importar-archivo").onchange = (ev) => {
    const f = ev.target.files?.[0];
    if (f) importarCopia(f);
  };

  $("#cfg-anotar").onclick = () => hojaAnotarProblema();
  const bBit = $("#cfg-bitacora");
  if (bBit) bBit.onclick = () => {
    const caja = $("#cfg-bitacora-caja");
    if (!caja.classList.contains("oculta")) { caja.classList.add("oculta"); return; }
    caja.innerHTML = `
      <div class="bitacora">
        ${problemas.slice().reverse().map((p) => `
          <div class="bitacora-item">
            <div class="dato">${fmtFechaCorta(isoDeInstante(p.hora))} ${fmtHora(p.hora)} · ${esc(p.pantalla || "?")}${p.automatico ? " · automático" : ""}</div>
            <div>${esc(p.texto)}</div>
          </div>`).join("")}
      </div>
      <button id="cfg-bitacora-borrar" class="btn btn-texto" style="width:100%">Borrar todas</button>`;
    caja.classList.remove("oculta");
    $("#cfg-bitacora-borrar").onclick = () => { borrarBitacora(); renderAjustes(); };
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
$("#btn-ajustes").addEventListener("click", () => irA("ajustes"));
$("#rutina-barra").addEventListener("click", abrirPanelRutina);
$("#bd-menos").addEventListener("click", () => ajustarDescanso(-15));
$("#bd-mas").addEventListener("click", () => ajustarDescanso(15));
$("#bd-reiniciar").addEventListener("click", reiniciarDescanso);
$("#bd-saltar").addEventListener("click", () => {
  // En un temporizador de bloque, "Saltar" corta ese bloque, no el descanso.
  if (S.sesion?.descanso) saltarDescanso();
  else if (S.sesion?.timer) { cancelarCampana("timer"); S.sesion.timer = null; guardarSesion(); renderPasoSesion(); pintarBarraDescanso(); }
});
$("#tab-mas").addEventListener("click", () => { vibrar("leve"); hojaMas(); });
$$(".tab").forEach((t) => t.addEventListener("click", () => irA(t.dataset.tab)));
$("#cal-prev").addEventListener("click", () => {
  const b = parseISO(S.calMes); S.calMes = fmtISO(new Date(b.getFullYear(), b.getMonth() - 1, 1));
  renderCalendario();
});
$("#cal-sig").addEventListener("click", () => {
  const b = parseISO(S.calMes); S.calMes = fmtISO(new Date(b.getFullYear(), b.getMonth() + 1, 1));
  renderCalendario();
});

/* ==========================================================================
   ACTUALIZACIÓN — que no haga falta borrar la caché nunca más
   --------------------------------------------------------------------------
   El service worker nuevo se queda esperando (ya no hace skipWaiting solo).
   La app avisa con una franja, y recién al tocar "Actualizar" toma el control
   y recarga. Si hay un entrenamiento abierto, el aviso espera: nunca se
   actualiza en medio de una sesión.
   ========================================================================== */
let registroSW = null;
let swEsperando = null;
let recargandoPorSW = false;

function pintarAvisoVersion() {
  const caja = $("#aviso-version");
  if (!caja) return;
  // Con una sesión abierta el aviso no aparece: se muestra al cerrarla.
  caja.classList.toggle("oculta", !swEsperando || !!S.sesion);
}

function aplicarActualizacion() {
  if (!swEsperando) return;
  swEsperando.postMessage({ tipo: "tomarControl" });
}

function buscarActualizacion() {
  if (!registroSW) return;
  registroSW.update().catch(() => { });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      registroSW = await navigator.serviceWorker.register("sw.js");
    } catch (_) { return; }

    const revisar = () => {
      const nuevo = registroSW.waiting;
      // Solo avisa si ya había un worker controlando: en la primera visita no
      // hay nada que actualizar.
      if (nuevo && navigator.serviceWorker.controller) {
        swEsperando = nuevo;
        pintarAvisoVersion();
      }
    };
    revisar();
    registroSW.addEventListener("updatefound", () => {
      const nuevo = registroSW.installing;
      if (!nuevo) return;
      nuevo.addEventListener("statechange", () => { if (nuevo.state === "installed") revisar(); });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (recargandoPorSW) return;
      recargandoPorSW = true;
      location.reload();
    });

    const btn = $("#aviso-version-btn");
    if (btn) btn.onclick = () => {
      btn.disabled = true;
      btn.textContent = "Actualizando…";
      aplicarActualizacion();
    };
  });
}

/* Si vuelve la conexión estando en el login, se reintenta armar el botón. */
window.addEventListener("online", () => {
  logAuth("volvió la conexión");
  if (vistaActual === "login") { $("#login-aviso").classList.add("oculta"); prepararGoogle(); }
  // Estábamos esperando red con una sesión conocida: se recarga para retomarla.
  if ($("#espera-sin-red")) location.reload();
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
