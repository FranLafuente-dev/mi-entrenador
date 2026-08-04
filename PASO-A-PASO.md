# Mi Entrenador — Paso a paso para dejarla funcionando

Tiempo total estimado: una hora tuya, más lo que tarde Claude Code en construir.

---

## Fase 1 — Preparar la carpeta (5 min)

1. Creá la carpeta `C:\Mi Entrenador`.
2. Descomprimí ahí adentro `mi-entrenador-assets.zip`. Te tiene que quedar así:

```
C:\Mi Entrenador\
   img\ejercicios\   (20 imágenes .webp)
   rutinas.js
   campana.mp3
   PROMPT.md
   PASO-A-PASO.md
```

3. Abrí `campana.mp3` y escuchala. Si no te gusta cómo suena, decime y te la cambio antes de seguir.

---

## Fase 2 — Repositorio en GitHub (10 min)

4. Entrá a **github.com** → botón **New** (arriba a la derecha, en verde).
5. Repository name: `mi-entrenador`
6. Visibilidad: **Public**. Es obligatorio para que GitHub Pages sea gratis.
7. **No** marques "Add a README file". La carpeta ya tiene contenido.
8. **Create repository**.
9. Abrí PowerShell dentro de `C:\Mi Entrenador` (clic derecho en la carpeta con Shift → "Abrir ventana de PowerShell aquí") y corré, una línea por vez:

```powershell
git init
git branch -M main
git add .
git commit -m "Assets y rutinas"
git remote add origin https://github.com/franlafuente-dev/mi-entrenador.git
git push -u origin main
```

10. Recargá la página del repo en GitHub. Tenés que ver la carpeta `img` y los archivos.

---

## Fase 3 — Firebase (10 min)

11. Entrá a **console.firebase.google.com** y abrí el proyecto que ya usás para Mis Finanzas.
12. **Firestore Database → Rules.** Copiá TODO lo que dice y guardalo en un `.txt` en el escritorio. **Este backup no es opcional.** Si algo sale mal con las reglas, es lo único que te devuelve Mis Finanzas.
13. **Authentication → Sign-in method:** verificá que Google esté habilitado. Ya debería estarlo.
14. **Authentication → Settings → Authorized domains:** tiene que estar `franlafuente-dev.github.io`. Si ya está, no toques nada.
15. **Project settings → General → Your apps:** buscá la app web que ya tenés y copiá el objeto `firebaseConfig` (apiKey, authDomain, projectId, etc.). Lo vas a necesitar en la fase 5.

---

## Fase 4 — Construcción con Claude Code (lo que tarde)

16. Abrí Claude Code en `C:\Mi Entrenador`.
17. Verificá el modelo con `/model`. Tiene que decir **Opus 5**. Si no, `/model claude-opus-5`.
18. Pegá el contenido completo de `PROMPT.md`.
19. Dejalo trabajar. Va a ir mostrando por partes: estructura, inicio, sesión de entrenamiento, resto. Si algo no te gusta, decíselo ahí mismo antes de que siga.

---

## Fase 5 — Conectar Firebase (5 min)

20. Abrí `firebase-config.js` y pegá el objeto que copiaste en el paso 15.
21. Abrí el archivo `REGLAS-A-AGREGAR.txt` que generó Claude Code.
22. Volvé a **Firestore → Rules**. **Agregá** ese bloque adentro del `match /databases/{database}/documents` que ya existe, sin borrar ni modificar nada de lo que hay. Publish.
23. Probá que Mis Finanzas siga funcionando antes de seguir. Abrila y cargá un gasto de prueba.

---

## Fase 6 — Publicar (5 min)

24. En PowerShell:

```powershell
git add .
git commit -m "App v1"
git push
```

25. En GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: main / (root) → Save.**
26. Esperá dos minutos. La app va a estar en:
    `https://franlafuente-dev.github.io/mi-entrenador`

---

## Fase 7 — Instalar en el iPhone y el iPad (10 min)

27. Abrí esa URL **en Safari** (no en Chrome, no desde WhatsApp).
28. Botón compartir → **Agregar a pantalla de inicio**.
29. Abrila desde el ícono, no desde Safari. Entrá con tu cuenta de Google.
30. Repetí en el otro dispositivo.
31. **Probá la sincronización:** cargá un vaso de agua en el iPhone y fijate que aparezca en el iPad.

---

## Fase 8 — El Atajo del aviso (5 min)

32. App **Atajos** → pestaña **Automatización** → **+** → **Hora del día**.
33. Hora: **12:00**. Repetir: **Diariamente**. Siguiente.
34. **Ejecutar inmediatamente**, con las notificaciones al ejecutar activadas.
35. Agregá dos acciones: **Mostrar notificación** con el texto que quieras (*"¿Ya entrenaste?"*) y **Abrir app** → Mi Entrenador.
36. Listo. Podés hacer un segundo atajo a las 20:00 con un texto más duro.

---

## Fase 9 — Semana de prueba

37. Usala una semana entera sin tocar nada.
38. Anotá todo lo que moleste: botones que quedan lejos, pasos de más, textos del sargento que no pegan.
39. Volvés al chat con esa lista y ajustamos.

---

## Si algo se rompe

- **La app carga en blanco:** abrí la consola del navegador en la compu (F12). Casi siempre es `firebase-config.js` mal pegado.
- **No entra con Google:** falta `franlafuente-dev.github.io` en Authorized domains (paso 14).
- **Guarda pero no sincroniza:** las reglas del paso 22 quedaron mal. Revisá que el bloque esté adentro del `match` correcto.
- **La campana no suena en el iPhone:** verificá que el interruptor de silencio esté desactivado y que hayas tocado "Empezar entrenamiento" antes (ahí se desbloquea el audio).
- **Mis Finanzas dejó de funcionar:** restaurá el backup de reglas del paso 12 y avisame.
