/* ============================================================================
   MI ENTRENADOR — Los textos del sargento
   ----------------------------------------------------------------------------
   Este archivo se edita a mano. Sin IA, sin red: la app elige una variante
   y la rota para que no se repita.

   Variables disponibles (la app las reemplaza):
     {dia}        nombre del día ("martes")
     {rutina}     nombre de la rutina del día ("Musculación")
     {racha}      semanas de racha ("3")
     {rango}      rango actual ("Cabo Primero")
     {rangoAbajo} rango al que bajaría si falla ("Cabo")
     {pendiente}  rutina pendiente de recuperar ("Intervalos")
     {ejercicio}  nombre de ejercicio ("Prensa · Posición 1")
     {peso}       peso en kg ("65")
     {resumen}    resumen corto de la sesión hecha

   No todas las variables aplican a todas las situaciones: usá las que
   figuran en las variantes existentes de cada grupo.
   ========================================================================== */

const MENSAJES = {

  /* Día de entreno, todavía no fue, antes del mediodía */
  aunNoEntreno: [
    "Hoy es {dia}. {rutina}. ¿A qué hora vas?",
    "{rutina} te espera. Definí la hora y cumplila.",
    "Día de {rutina}. El plan ya está hecho, solo falta que aparezcas.",
    "Hoy toca {rutina}. Arrancá temprano y te sacás el tema de encima.",
    "{dia}: {rutina}. Vos ya sabés qué hay que hacer.",
  ],

  /* Pasó el mediodía y no entrenó */
  pasoMediodia: [
    "Son las 12 y seguís en casa. La prensa no se levanta sola.",
    "Mediodía y sin entrenar. Tu objetivo no se mueve solo.",
    "Ya es mediodía. {rutina} sigue pendiente y el día se achica.",
    "Las 12 pasaron. Cada hora que dejás correr la hacés más cuesta arriba.",
    "Mitad del día y cero registro. ¿Cuál es el plan, soldado?",
  ],

  /* Pasó la tarde (20 h) y no entrenó */
  pasoTarde: [
    "Son las 20 y no fuiste. Tu racha de {racha} semanas está en juego. Movete.",
    "Se está haciendo de noche y {rutina} sigue sin hacerse. Todavía llegás.",
    "Las 20 y nada. Si hoy no vas, mañana lo lamentás el doble.",
    "Última llamada: el gimnasio cierra y tu racha no se defiende sola.",
    "A esta hora ya deberías estar duchado y con la sesión cargada. Andá ahora.",
  ],

  /* Ya entrenó hoy */
  yaEntreno: [
    "Bien Fran, hoy ya entrenaste. {resumen}",
    "Cumplido. {resumen} Mañana más.",
    "Eso es presentarse. {resumen}",
    "Sesión hecha y anotada. {resumen} Así se sostiene una racha.",
    "Trabajo terminado: {resumen} Ahora comé bien y descansá.",
  ],

  /* Día de descanso */
  descanso: [
    "Hoy es tu día de descanso. Relajá que te lo merecés.",
    "Descanso. El músculo crece hoy, no ayer. Aprovechalo.",
    "Día libre de fierros. Si querés sumar, una caminata no viene mal.",
    "Hoy no hay rutina. Dormí, comé bien y dejá que el cuerpo haga lo suyo.",
    "Descanso programado. Esto también es parte del plan, no es un premio.",
  ],

  /* Registró una caminata en día de descanso */
  caminataRegistrada: [
    "Caminata anotada. Extra que suma para la mención de honor.",
    "Día de descanso y saliste a caminar igual. Eso es actitud.",
    "Caminata registrada. Nadie te la pidió y la hiciste: bien ahí.",
    "Piernas en movimiento hasta en el día libre. Anotado.",
    "Sumaste caminata en tu descanso. Detalle de soldado serio.",
  ],

  /* Racha en riesgo (semana por vencerse con sesiones pendientes) */
  rachaEnRiesgo: [
    "Tu racha de {racha} semanas está en riesgo. Si fallás, bajás a {rangoAbajo}.",
    "Ojo: la semana se termina y te faltan sesiones. No regales lo que costó {racha} semanas.",
    "Estás a un descuido de perder el rango de {rango}. Cerrá la semana.",
    "La racha no se pierde en un día malo, se pierde en un domingo sin reaccionar. Reaccioná.",
    "{racha} semanas construidas y las estás dejando al borde. Todavía estás a tiempo.",
  ],

  /* Subió de rango */
  subioRango: [
    "Cuarta semana seguida. Sos {rango}. No aflojes ahora.",
    "Ascenso ganado: {rango}. Esto no se regala, se sostiene.",
    "Nuevo rango: {rango}. El uniforme pesa más, el estándar también.",
    "{racha} semanas sin fallar. {rango}. Firme y de frente.",
    "Subiste a {rango}. Ahora demostrá que no fue casualidad.",
  ],

  /* Bajó de rango */
  bajoRango: [
    "Semana incompleta. Bajaste a {rango}. Se recupera trabajando, no lamentándose.",
    "Perdiste un escalón: ahora sos {rango}. La semana que viene se arregla.",
    "Bajaste a {rango}. Dolió, anotalo y que no se repita.",
    "El rango se paga con constancia. Hoy: {rango}. Mañana depende de vos.",
    "Retrocediste a {rango}. Un tropiezo no es caída, pero dos sí. A trabajar.",
  ],

  /* Récord personal */
  record: [
    "Récord en {ejercicio}: {peso} kg. Eso es progreso de verdad.",
    "{peso} kg en {ejercicio}. Nunca habías movido tanto. Anotado con honores.",
    "Nuevo máximo: {ejercicio} a {peso} kg. Así se sube, kilo a kilo.",
    "Rompiste tu marca en {ejercicio}: {peso} kg. El de hace un mes no te levantaba esto.",
    "{ejercicio}: {peso} kg. Récord personal. Mañana ese será tu piso.",
  ],

  /* Tiene una sesión pendiente de recuperar */
  pendienteRecuperar: [
    "Tenés {pendiente} pendiente. Recuperala antes del domingo y la semana sigue intacta.",
    "{pendiente} quedó colgada. Todavía la podés levantar: cualquier día hasta el domingo.",
    "Debés una: {pendiente}. Saldala y la racha ni se entera.",
    "Sesión pendiente: {pendiente}. Una recuperación por semana, usala bien.",
    "{pendiente} sin hacer. El domingo a la noche es el límite, no lo estires.",
  ],

  /* Usó el escudo del mes */
  escudoUsado: [
    "Escudo usado. La racha se congela: no bajás, pero tampoco subís. Uno por mes, ya no hay más.",
    "Semana salvada con escudo. Era para esto, pero ojo: hasta el mes que viene no hay otro.",
    "Escudo aplicado. La racha aguanta congelada. Que no se haga costumbre.",
    "Usaste tu escudo del mes. Quedaste cubierto, pero la semana que viene se rinde completa.",
    "Escudo puesto: racha protegida, ascenso en pausa. El mes que viene se repone.",
  ],

  /* Mes perfecto: 4 semanas completas consecutivas */
  mesPerfecto: [
    "Mes perfecto: 4 semanas completas al hilo. Esto ya es disciplina, no motivación.",
    "Cuatro de cuatro. Mes perfecto. Muy pocos sostienen esto: vos sí.",
    "Mes perfecto cerrado. Mirá la foto de hace un mes y decime si no valió la pena.",
    "Un mes entero sin fallar una semana. Perfecto de punta a punta.",
    "Mes perfecto en el registro. El año se construye de a meses así.",
  ],

  /* Mes de hierro: 4 semanas completas sin recuperación ni escudo */
  mesHierro: [
    "Mes de hierro: cuatro semanas sin recuperar ni escudar nada. Cada sesión en su día. Impecable.",
    "Ni una recuperación, ni un escudo, ni una excusa. Mes de hierro.",
    "Mes de hierro cerrado. Fuiste cuando había que ir, todas las veces.",
    "Cuatro semanas a horario, sin comodines. Eso es hierro del bueno.",
    "Mes de hierro. El calendario quedó verde sin ayuda de nadie.",
  ],

  /* Semana con mención de honor: completa + caminata en descanso */
  mencionHonor: [
    "Semana completa y encima caminaste en tu día libre. Mención de honor.",
    "Mención de honor: hiciste todo y sumaste caminata. Eso es ir por más.",
    "Semana cerrada con mención de honor. Lo obligatorio y lo extra.",
    "Cuatro sesiones más caminata de yapa. Mención de honor bien ganada.",
    "Mención de honor esta semana. Cuando sobra actitud, se nota en los detalles.",
  ],

};
