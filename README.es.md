# gentle-shell-minimax-usage

[Read in English](README.md)

Muestra la cuota de tu MiniMax Token Plan dentro de Gentle Shell para Pi, y tu
consumo local de MiniMax dentro del propio Pi. Registra una fuente
`gentle-pi:usage-source/v1` para el proveedor `minimax` y solo devuelve datos;
Gentle Shell dibuja los medidores, los umbrales y las cuentas regresivas.

## Instalación

```sh
pi install npm:gentle-shell-minimax-usage
```

Eso es todo. Instala **sin versión**: Pi sigue el tag `latest` y te avisa cuando
hay una versión nueva (`pi list` muestra tus paquetes y
`pi update --extensions` instala los pendientes). Para fijar una versión a
propósito, agrega `@<versión>`; Pi nunca avisa de actualizaciones de un paquete
fijado.

¿Sin Gentle Shell? También funciona: mira [Sin Gentle Shell](#sin-gentle-shell).
¿Vienes de la 0.4.0 o quieres instalar a mano? Mira
[Más opciones de instalación](#más-opciones-de-instalación).

## Qué obtienes

Con un modelo `minimax/*` activo, Alt+U (y el grupo Usage de la barra lateral)
muestra dos filas `general`:

- `5h`: porcentaje usado en la ventana actual de 5 horas y cuándo se reinicia.
- `week`: porcentaje usado en la ventana semanal actual y cuándo se reinicia.

La barra del pie muestra solo la ventana `5h`: cada ventana es un límite
propio, y el pie dibuja la primera.

Los datos salen de `GET https://api.minimax.io/v1/token_plan/remains`, con la
ruta antigua del Coding Plan como respaldo. Gentle Shell aporta la API key, así
que en ese modo esta extensión nunca lee credenciales.

## Comandos

Dos comandos funcionan en cualquier Pi, con o sin Gentle Shell. Ambos se abren
en una ventana flotante sobre la conversación, salvo `/minimax:details`, que
ocupa toda el área interactiva.

### `/minimax:usage`

El panel de cuota, el mismo que dibuja Gentle Shell: las ventanas `5h` y
semanal con sus medidores, el porcentaje usado y la cuenta regresiva hasta el
reinicio. `r` consulta de nuevo, `esc` (o `q`) lo cierra.

Sin plan (una API key de pago por uso no tiene ventanas del M Plan) el panel lo
dice en vez de dibujar un medidor al 0%, y apunta a `/minimax:details`.

### `/minimax:details`

Tu consumo, a pantalla completa, en tres pestañas:

- `Overview`: las cifras principales (LLM, cache hit, promedio diario, costo),
  lo gastado por modelo y los totales acumulados.
- `Trend`: el gráfico de columnas diario, apilado por modelo, con la leyenda de
  modelos.
- `Heatmap`: el mapa de calor día de la semana × semana sobre todo el historial
  local, con su escala de color y la escala de peso `poco ░▒▓█ mucho`.

`Tab` / `Shift+Tab` cambian de pestaña, `1` a `3` saltan directo a una,
`↑`/`↓` (o `j`/`k`) desplazan, `r` vuelve a leer el historial y `esc` lo cierra.

Las cifras salen del **historial local de sesiones de Pi**, no de la cuenta de
MiniMax: la extensión lee `<agent-dir>/sessions/**/*.jsonl` y suma el uso
numérico de los mensajes del asistente `minimax`. La lectura es de solo lectura,
no necesita credenciales ni red, y nunca toca el contenido de los mensajes. Por
eso la vista muestra lo que Pi hizo en esta máquina; la consola de MiniMax suma
tus otras máquinas y herramientas.

Define `MINIMAX_DETAILS=off` para apagar el registro: el comando entonces no lee
nada y lo dice.

## Sin Gentle Shell

El medidor también funciona en la línea de estado propia de Pi. Define
`MINIMAX_USAGE_MODE` para elegir el comportamiento:

| `MINIMAX_USAGE_MODE` | Registra la fuente del shell | Escribe el estado de Pi            |
| -------------------- | ---------------------------- | ---------------------------------- |
| `auto` (por defecto) | sí                           | solo si no se detectó Gentle Shell |
| `status`             | sí                           | siempre (fuerza el segmento)       |
| `shell`              | sí                           | nunca                              |
| `off`                | no                           | no                                 |

`off` apaga la extensión por completo: sin fuente, sin estado y sin comandos.

Con la superficie de estado activa, el pie de Pi muestra un segmento
`minimax-usage`:

```
MM 5h 55% · week 6%
```

Si falta la key se muestra `MM: sin API key`; una consulta sin datos muestra
`MM: sin datos`. El estado se refresca al iniciar la sesión y cada vez que el
agente se detiene, con su propio timeout de 10 segundos. Cuando el registro de
npm tiene una versión más nueva, el segmento agrega `· new 0.6.0`; la
comprobación se hace una vez por hora y nunca bloquea el estado.

La ruta independiente resuelve la API key en este orden:

1. `MINIMAX_API_KEY` del entorno.
2. `minimax.key` dentro de `~/.pi/agent/auth.json` (o `$PI_CODING_AGENT_DIR/auth.json`).

La lectura de `auth.json` es estrictamente de solo lectura: la extensión nunca
lo escribe y nunca registra la key.

La detección del shell es una heurística: busca el paquete `gentle-pi`
instalado (bajo `$PI_CODING_AGENT_DIR` o `~/.pi/agent`, `$PI_PACKAGE_DIR`, o
`~/.pi/npm`), y un paquete instalado no garantiza que el shell esté corriendo.
`MINIMAX_USAGE_MODE` es la salida de emergencia.

## Más opciones de instalación

### Vienes de la 0.4.0

El comando con versión fija del README antiguo te deja en la 0.4.0 sin aviso de
actualizaciones. Quítale la versión:

```sh
pi remove npm:gentle-shell-minimax-usage
pi install npm:gentle-shell-minimax-usage
```

### Instalación manual (sin registro)

Genera el tarball y descomprímelo en un subdirectorio de extensiones de Pi:

```sh
npm pack
mkdir -p ~/.pi/agent/extensions/minimax-usage
tar -xzf gentle-shell-minimax-usage-<versión>.tgz -C ~/.pi/agent/extensions/minimax-usage --strip-components=1
```

Pi carga los subdirectorios de un nivel de `~/.pi/agent/extensions/` que tengan
un `package.json` con un manifiesto `pi.extensions`. Reinicia Pi tras
descomprimir. No conserves esta copia una vez instalado el paquete de npm: dos
extensiones registrarían el mismo proveedor.

## Desarrollo

```sh
npm install
npm test
npm run typecheck
npm run preview
```

Las pruebas corren en Node 24 con `--experimental-strip-types` y no necesitan
red. `npm run preview` pinta ambas vistas como texto plano, sin terminal: la
vista de consumo desde el historial local de sesiones y el panel de cuota desde
el endpoint real. Es la forma más rápida de ver qué mostrarán los comandos.

## Límites conocidos

- El medidor aparece solo mientras un modelo `minimax/*` está activo.
- El endpoint no informa el nivel del plan, así que no se muestra su nombre.
- El M Plan no tiene cuota mensual: tiene una ventana de 5 horas y una semanal.
  Las cifras mensuales de la consola de MiniMax son consumo, no un límite.
- `/minimax:details` cuenta el historial local de Pi, así que no coincide con
  las cifras de toda la cuenta en la consola de MiniMax.
- La tasa de cache hit es nuestra (`cacheRead / (input + cacheRead + cacheWrite)`),
  no el cálculo propio de MiniMax.
- El aviso de versión vive en el código instalado: un paquete con versión fija
  conserva el código con el que se instaló y nunca se entera de una nueva.
