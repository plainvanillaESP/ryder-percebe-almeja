# 🏌️ Ryder Percebe vs Almeja

App web para apostar y llevar el marcador de una Ryder de golf entre 8 amigos, en dos equipos: **Percebe** (Gaspi, Bruno, Richi, Frutos) y **Almeja** (Sainz, Cueto, Gete, José). Móvil primero, funciona en GitHub Pages.

- Login por jugador con contraseña propia.
- Cálculo de hándicaps con reglas WHS (Course Handicap + porcentajes de juego por formato).
- Apuestas de dinero a cada partido (sistema **parimutuel**: el bote de los perdedores se reparte entre los acertantes).
- Marcador Ryder en vivo y clasificación de la bolsa.

---

## Dos modos de funcionamiento

- **Local** (por defecto, sin tocar nada): todo se guarda en el móvil que lo abre. Perfecto para probar. **No** se comparte entre personas.
- **Nube** (recomendado para los 8): con Firebase, todos comparten apuestas y resultados en tiempo real. Solo hay que pegar 4-6 claves en `config.js`.

En la app verás abajo una etiqueta que indica el modo activo.

---

## 1) Subir a GitHub Pages (2 minutos)

**Opción A — línea de comandos** (tienes `git` y `gh` instalados):

```bash
cd ryder-percebe-almeja
git init
git add .
git commit -m "Ryder Percebe vs Almeja"
gh repo create ryder-percebe-almeja --public --source=. --push
gh api -X POST repos/{owner}/ryder-percebe-almeja/pages -f "source[branch]=main" -f "source[path]=/"
```

Si no usas `gh`, crea el repo a mano en github.com, y luego:

```bash
git remote add origin https://github.com/TU_USUARIO/ryder-percebe-almeja.git
git push -u origin main
```

Después: **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**. En ~1 min tendrás la URL `https://TU_USUARIO.github.io/ryder-percebe-almeja/`.

**Opción B — sin terminal:** crea un repo nuevo en github.com, pulsa *uploading an existing file*, arrastra **todos** los archivos de esta carpeta (incluido `.nojekyll`), commit, y activa Pages igual que arriba.

---

## 2) Activar el modo nube con Firebase (5 minutos, gratis)

1. Entra en <https://console.firebase.google.com> → **Add project** (pon el nombre que quieras, puedes desactivar Analytics).
2. Dentro del proyecto: **Build → Firestore Database → Create database → modo producción → región europe-west**.
3. En **Firestore → Rules**, pega esto y publica:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /tournaments/{doc} {
         allow read, write: if true;
       }
     }
   }
   ```

4. Rueda dentada **⚙ Project settings → General**, baja a *Your apps*, pulsa el icono **</>** (Web), registra la app y copia el objeto `firebaseConfig`.
5. Pega esos valores en `config.js`, en el bloque `firebase: { ... }`. Guarda, haz `git commit` + `git push`, y listo: ahora todos comparten datos.

> Nota de seguridad: es una app entre amigos. Las claves de Firebase web son públicas por diseño (van en el HTML); la protección real son las reglas. Las de arriba dejan leer/escribir a cualquiera que tenga la URL. Para 8 colegas apostando cañas es suficiente; si quieres cerrarlo más, se puede añadir autenticación después.

---

## 3) Cómo se usa

- **Entrar:** cada uno toca su nombre. La primera vez crea su contraseña; después la escribe.
- **Hándicaps:** cada jugador mete su *hándicap índice*. El admin fija Slope, Course Rating y Par del campo. La app calcula el Course Handicap y la ventaja de cada partido según el formato (scramble 2 jug. = 35 % bajo + 15 % alto; individual = 100 %).
- **Apostar:** abre un partido, elige Percebe o Almeja, pon el importe y apuesta. Puedes actualizar tu apuesta hasta que se cierre el partido.
- **Resultados (admin):** en cada partido, el admin marca ganador/empate y opcionalmente el marcador (ej. `3&2`). Al instante se recalculan el marcador Ryder y la bolsa.
- **Bolsa:** clasificación de quién gana/pierde dinero y detalle por partido.

El **Día 1** (scramble) ya viene definido. El **Día 2** (individual) lo asigna el admin en la pestaña **Admin** cuando esté claro.

---

## Personalizar

Todo lo editable a mano está en **`config.js`**: jugadores, equipos, admins, campo, porcentajes de juego y partidos. Si cambias jugadores o partidos del día 1 **después** de haber usado la app, usa el botón **Reiniciar torneo** (pestaña Admin) para regenerar con la nueva config (mantiene usuarios y contraseñas).

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | Punto de entrada |
| `config.js` | **Lo único que editas**: datos y claves |
| `app.js` | Lógica (golf WHS, apuestas, sincronización) |
| `styles.css` | Diseño |
| `manifest.webmanifest` | Para "añadir a pantalla de inicio" |
| `.nojekyll` | Necesario para que GitHub Pages sirva bien los archivos |
