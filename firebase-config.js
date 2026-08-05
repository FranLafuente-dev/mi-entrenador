/* ============================================================================
   FIREBASE — credenciales del proyecto
   ----------------------------------------------------------------------------
   Pegá acá el objeto firebaseConfig de tu proyecto:
   Firebase Console → Project settings → General → Your apps → SDK setup.
   Es el MISMO proyecto que usa Mis Finanzas: esta app solo escribe en la
   colección "entrenador", no toca nada más.
   ========================================================================== */

export const firebaseConfig = {
  apiKey: "AIzaSyCVlW4tvjTPrZ48_PM4sirT1uRTOP5THKI",
  authDomain: "mis-finanzas-d65e0.firebaseapp.com",
  projectId: "mis-finanzas-d65e0",
  storageBucket: "mis-finanzas-d65e0.firebasestorage.app",
  messagingSenderId: "249017917046",
  appId: "1:249017917046:web:198ad17d39b88eae86c957",
  measurementId: "G-GD4BBRKB8W",
};

/* ----------------------------------------------------------------------------
   CLIENT ID DE GOOGLE — necesario para entrar desde el iPhone.

   La app ya no usa el flujo de redirect de Firebase (Safari lo rompe: ese
   flujo pasa por un iframe contra mis-finanzas-d65e0.firebaseapp.com, que es
   un dominio distinto al que sirve la app, y Safari particiona ese
   almacenamiento). En su lugar pide el ID token a Google Identity Services,
   que no usa iframes entre dominios, y se lo entrega a Firebase.

   Para eso hace falta el Client ID del cliente OAuth web del proyecto:

     1. https://console.cloud.google.com/apis/credentials
     2. Proyecto "mis-finanzas-d65e0", arriba a la izquierda.
     3. En "OAuth 2.0 Client IDs" abrí el que dice
        "Web client (auto created by Google Service)".
     4. Copiá el "Client ID" (termina en .apps.googleusercontent.com)
        y pegalo acá abajo.
     5. En esa misma pantalla, en "Authorized JavaScript origins",
        agregá:  https://franlafuente-dev.github.io
        y guardá. Sin eso Google rechaza el pedido.

   Empieza con el número del proyecto: 249017917046-....              */
export const googleClientId = "PEGAR-CLIENT-ID.apps.googleusercontent.com";
