/* =====================================================================
   CONFIGURACIÓN  ·  Ryder Percebe vs Almeja
   ---------------------------------------------------------------------
   Edita SOLO este archivo para poner tus datos. No hace falta tocar nada más.
   ===================================================================== */

window.RYDER_CONFIG = {

  /* ---------------------------------------------------------------
     1) FIREBASE  (multijugador real, sincronizado entre los 8 móviles)
     ---------------------------------------------------------------
     Si dejas apiKey como "" la app funciona en LOCAL (solo en tu móvil,
     perfecto para probar). Para que TODOS compartan apuestas y resultados,
     crea un proyecto Firebase gratis y pega aquí las claves.
     Pasos detallados en el README.md.
  */
  firebase: {
    apiKey: "",                 // <-- pega aquí tus claves de Firebase
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
  },

  /* Nombre del "torneo" — sirve de clave del documento en Firestore.
     Si algún día quieres empezar de cero, cambia esto. */
  tournamentId: "ryder-2026",

  /* Moneda para las apuestas */
  currency: "€",

  /* ---------------------------------------------------------------
     2) ADMINS  (pueden editar campo, definir el día 2 y meter resultados)
     --------------------------------------------------------------- */
  admins: ["frutos"],

  /* ---------------------------------------------------------------
     3) EQUIPOS Y JUGADORES
     --------------------------------------------------------------- */
  teams: {
    percebe: { name: "Percebe", players: ["gaspi", "bruno", "richi", "frutos"] },
    almeja:  { name: "Almeja",  players: ["sainz", "cueto", "gete", "jose"] }
  },

  players: {
    gaspi:  { name: "Gaspi",  team: "percebe" },
    bruno:  { name: "Bruno",  team: "percebe" },
    richi:  { name: "Richi",  team: "percebe" },
    frutos: { name: "Frutos", team: "percebe" },
    sainz:  { name: "Sainz",  team: "almeja" },
    cueto:  { name: "Cueto",  team: "almeja" },
    gete:   { name: "Gete",   team: "almeja" },
    jose:   { name: "José",   team: "almeja" }
  },

  /* ---------------------------------------------------------------
     4) CAMPO  (valores por defecto — luego editables en la pestaña Hándicaps)
     --------------------------------------------------------------- */
  course: {
    slope: 113,        // Slope del campo (113 = neutro)
    courseRating: 72,  // Course Rating (opcional; deja igual al par si no lo sabes)
    par: 72
  },

  /* ---------------------------------------------------------------
     5) HÁNDICAP DE JUEGO (World Handicap System)
        Porcentajes de juego según formato. Editables en Hándicaps.
     --------------------------------------------------------------- */
  allowances: {
    scrambleLow: 0.35,   // 35 % del hándicap más bajo de la pareja
    scrambleHigh: 0.15,  // 15 % del más alto
    singles: 1.00        // 100 % en individual match-play
  },

  /* ---------------------------------------------------------------
     6) PARTIDOS
     --------------------------------------------------------------- */
  matches: [
    // ---- DÍA 1 · SCRAMBLE POR PAREJAS ----
    {
      id: "d1p1", day: 1, format: "scramble", label: "Partido 1 · Scramble",
      a: ["gaspi", "richi"],   // Percebe
      b: ["cueto", "jose"]     // Almeja
    },
    {
      id: "d1p2", day: 1, format: "scramble", label: "Partido 2 · Scramble",
      a: ["bruno", "frutos"],  // Percebe
      b: ["gete", "sainz"]     // Almeja
    },

    // ---- DÍA 2 · INDIVIDUAL (por definir; el admin asigna jugadores) ----
    { id: "d2p1", day: 2, format: "singles", label: "Individual 1", a: [], b: [] },
    { id: "d2p2", day: 2, format: "singles", label: "Individual 2", a: [], b: [] },
    { id: "d2p3", day: 2, format: "singles", label: "Individual 3", a: [], b: [] },
    { id: "d2p4", day: 2, format: "singles", label: "Individual 4", a: [], b: [] }
  ]
};
