# Bomber

Juego de bombas multijugador para el navegador. Sin servidor propio: se publica tal cual en GitHub Pages y las partidas viajan directamente entre los navegadores de los jugadores.

## Qué incluye

- **Cinco modos de juego**
  - **Clásico**: el último en pie gana la ronda; gana la partida quien llegue antes al número de rondas fijado. Si la ronda se alarga, empieza la muerte súbita y caen bloques de acero en espiral.
  - **Equipos**: rojos contra azules, con fuego amigo opcional.
  - **Caos**: reaparición a los 3 s; puntúa cada derribo y resta cada autoeliminación.
  - **Botín**: recoge monedas; al caer sueltas la mitad.
  - **Zona**: suma puntos quedándote solo en una zona que cambia de sitio cada 20 s.
- **Seis habilidades activas** (una por jugador, con recarga): Impulso, Barrera, Constructor, Fantasma, Detonador y Escarcha.
- **Ocho potenciadores**: bomba extra, más fuego, velocidad, patada, bomba perforante, escudo, fuego total y la maldición (seis efectos negativos que se contagian por contacto).
- **Cinco mapas** con su propia estética (Clásico, Fortaleza, Cruce, Laberinto y Volcán) y opción aleatoria.
- **Multijugador hasta 8 jugadores**:
  - Salas **públicas** (aparecen en la lista y en la partida rápida) y **privadas** (código de 5 caracteres y enlace de invitación).
  - **Sala de espera** con chat, estado «listo», elección de color, habilidad y equipo, ajustes de la partida en vivo, bots y expulsión de jugadores.
  - Entrada **a mitad de partida**: como jugador en los modos con reaparición y como espectador en el resto.
- **Bots** con tres niveles de dificultad, para rellenar huecos o practicar sin conexión.
- **Controles** de teclado, mando y táctiles (joystick y botones) en el móvil.
- Gráficos y sonido generados por código: no hay imágenes ni audios externos.

## Publicarlo en GitHub Pages

1. Crea un repositorio (por ejemplo, `Bomber`) y sube el **contenido de esta carpeta** a la rama `main`:

   ```bash
   cd bomber
   git init
   git add .
   git commit -m "Bomber"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/Bomber.git
   git push -u origin main
   ```

2. En el repositorio, ve a **Settings → Pages**.
3. En **Build and deployment**, elige **Source: Deploy from a branch**, rama `main` y carpeta `/ (root)`. Guarda.
4. En uno o dos minutos estará disponible en `https://TU_USUARIO.github.io/Bomber/`.

No hay paso de compilación. El archivo `.nojekyll` evita que GitHub procese el sitio con Jekyll.

> **Recomendado:** revisa `appId` en `js/config.js`. Es el prefijo de todas las salas: las instancias con el mismo `appId` comparten la lista de salas públicas. Si lo cambias, cambia también la versión (`-v1`) cuando hagas cambios incompatibles en el protocolo.

## Probarlo en local

Los módulos de JavaScript no se cargan abriendo `index.html` con doble clic; hace falta un servidor:

```bash
python3 -m http.server 8080      # o bien: npm run dev
```

Abre `http://localhost:8080`. La práctica contra bots funciona sin conexión. Para el multijugador basta con abrir dos ventanas (una de ellas de incógnito), ya que se usa el servidor público de PeerJS.

Si prefieres que todo ocurra en tu máquina, arranca un servidor de señalización local:

```bash
npm install
npm run peer                     # señalización PeerJS en el puerto 9000
# y abre: http://localhost:8080/?peerhost=localhost&peerport=9000
```

Parámetros útiles en la URL:

| Parámetro | Efecto |
| --- | --- |
| `?peerhost=…&peerport=…` | Usa otro servidor de señalización PeerJS. |
| `?lag=80` | Retrasa 80 ms cada mensaje enviado, para probar la predicción con latencia. |
| `?debug=1` | Expone `window.__bomber` (sala y partida) en la consola. |

## Cómo funciona el multijugador

GitHub Pages solo sirve archivos estáticos, así que Bomber usa **WebRTC** entre navegadores:

- **Emparejamiento.** [PeerJS](https://peerjs.com) y su servidor público gratuito (`0.peerjs.com`) solo sirven para que los navegadores se encuentren. Después, los datos viajan directamente entre jugadores. PeerJS incluye servidores STUN y TURN por defecto.
- **Salas.** Una sala privada es un identificador `appId-prv-CÓDIGO`. Las públicas ocupan uno de 12 huecos fijos (`appId-pub-N`, que el jugador ve como `P1`…`P12`). La lista de salas consulta esos huecos y muestra cada sala en cuanto responde.
- **Anfitrión autoritativo.** Quien crea la sala ejecuta la simulación completa (bombas, explosiones, potenciadores, habilidades, bots y reglas del modo) a 30 ticks por segundo, con un reloj basado en un Web Worker para que la partida no se frene si su pestaña queda en segundo plano. Los demás solo envían su entrada (dirección, bomba y habilidad, 30 veces por segundo) y reciben instantáneas del mundo 15 veces por segundo, con unos 300 bytes cada una.
- **Cliente fluido.** Cada cliente predice el movimiento de su propio personaje con el mismo código de movimiento que el anfitrión y lo reconcilia con las instantáneas. El resto de jugadores se interpola. En las pruebas con 100 ms de retardo añadido, la corrección máxima fue de 0,004 casillas.
- **Información oculta.** Los potenciadores que hay dentro de cada bloque nunca salen del anfitrión hasta que el bloque se destruye, así que no se pueden revelar inspeccionando el tráfico.
- **Validación.** El anfitrión valida y acota todo lo que recibe (tipos, rangos, números de secuencia, longitud de nombres y mensajes), limita los mensajes por segundo de cada conexión y el ritmo del chat. Los textos de otros jugadores se pintan siempre como texto, nunca como HTML.

### Limitaciones conocidas

- Si el anfitrión cierra la pestaña, la sala se cierra para todos.
- Al ser autoritativo, el anfitrión podría alterar su propia partida; el modelo confía en quien crea la sala.
- La expulsión bloquea el identificador de conexión del jugador; si recarga la página obtiene uno nuevo. Para una comunidad grande convendría una sala privada nueva.
- En redes muy restrictivas (NAT simétrico en ambos extremos) puede no bastar con el TURN público de PeerJS. Puedes añadir el tuyo en `js/config.js`:

  ```js
  peer: { config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'turn:mi-turn.example.com:3478', username: 'u', credential: 'p' }] } },
  ```

- El servidor público de PeerJS tarda unos segundos en confirmar que un hueco público está vacío; las salas que existen aparecen en menos de un segundo.

## Estructura

```
index.html          Pantallas y diálogos
css/style.css       Estilos (incluye la adaptación a móvil)
js/config.js        Configuración de red (appId, huecos públicos, PeerJS/TURN)
js/data.js          Reglas, potenciadores, habilidades, modos, mapas y temas
js/move.js          Movimiento en rejilla compartido por anfitrión y cliente
js/sim.js           Simulación autoritativa e instantáneas
js/danger.js        Cálculo de explosiones futuras (bots y reapariciones)
js/bots.js          IA de los bots
js/net.js           Conexiones PeerJS y lista de salas públicas
js/session.js       Sala de espera y partida (anfitrión y cliente)
js/game.js          Cliente de partida: predicción, interpolación, efectos y HUD
js/render.js        Dibujo en canvas
js/input.js         Teclado, mando y controles táctiles
js/audio.js         Efectos y música sintetizados con WebAudio
js/icons.js         Iconos SVG
js/main.js          Menús y flujo de la aplicación
tests/sim.test.mjs  Partidas completas entre bots en todos los modos y mapas
tools/peer-server.mjs  Servidor de señalización local para pruebas
```

## Personalizar

- **Mapas:** en `js/data.js`, cada mapa es una cuadrícula de 17 × 13 caracteres (`#` muro, `+` posible bloque, `.` suelo siempre libre), con una densidad de bloques y un tema de color. Los puntos de aparición son comunes a todos los mapas (`SPAWNS`) y sus alrededores se despejan solos.
- **Reglas:** `RULES` en `js/data.js` (mecha, alcance, velocidades, duración de efectos…). Las probabilidades de cada potenciador están en `ITEMS`.
- **Habilidades:** nombre, descripción y recarga en `ABILITIES`; su efecto, en `useAbility()` de `js/sim.js`.

## Pruebas

```bash
npm test
```

Juega partidas completas solo con bots en los cinco modos y los cinco mapas (más el aleatorio), con entre 2 y 8 jugadores y las tres dificultades, y comprueba en cada tick que nadie atraviesa muros y que el estado es coherente.

## Licencias de terceros

- [PeerJS](https://github.com/peers/peerjs) (MIT), en `vendor/`.
- Tipografías [Bungee](https://fonts.google.com/specimen/Bungee) y [Rubik](https://fonts.google.com/specimen/Rubik) (SIL Open Font License), en `fonts/`.
