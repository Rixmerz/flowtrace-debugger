# Caracterización con trazas

Un test de caracterización (golden master) fija lo que el código *hace* hoy,
para poder comprobar un refactor contra eso. Con FlowTrace lo que se fija es
una traza: grabas una antes del cambio, otra después, y comparas el
comportamiento.

`flowtrace diff` (CLI) y `trace_behavior_diff` (herramienta MCP) hacen la
comparación; es el mismo código. El antiguo `trace_diff` solo compara qué
métodos corrieron y su duración media: no ve argumentos, resultados ni errores.

## Flujo de trabajo

```bash
# 1. Graba la base en la revisión buena y versiónala.
flowtrace run -- python checkout.py          # escribe .flowtrace/<timestamp>.jsonl
mkdir -p characterisation
cp .flowtrace/<timestamp>.jsonl characterisation/checkout.jsonl

# 2. Tras el cambio, graba otra vez y compara.
flowtrace run -- python checkout.py
flowtrace diff characterisation/checkout.jsonl .flowtrace/<nuevo-timestamp>.jsonl
echo $?        # 0 igual, 1 distinto, 2 error de uso / E/S o comparación incompleta
```

Ejecuta el programa con una entrada fija y define un prefijo de paquete
(`flowtrace init` lo detecta) para que la traza contenga tu código y no los
frameworks.

Opciones: `--ignore-method <glob>` y `--ignore-key <clave>` (repetibles),
`--ignore-order`, `--no-error-msg`, `--limit N` (ejemplos por categoría, 10 por
defecto; los conteos son siempre exactos), `--json` (el mismo objeto que
devuelve la herramienta MCP).

## Qué se compara

Cada traza se pliega en un árbol de llamadas. La identidad de una llamada es
`lang|módulo|clase|método`; su contenido son `args`, `result` normalizados y el
tipo de error (y su mensaje, salvo `--no-error-msg`). Las listas de hermanas se
alinean con LCS, así una llamada insertada no desplaza todas las siguientes. El
veredicto es `same` o `different`, con conteos exactos de:

- `calls_added`, `calls_removed`, `calls_reordered`
- `args_changed` y `result_changed` (mismos argumentos, otra respuesta)
- `error_changed` (aparece, desaparece o cambia de tipo), `error_msg_changed`
- `count_changed`: cantidad de llamadas por método

Cada ejemplo trae la ruta de llamadas desde la raíz y solo las claves que
difieren.

## Qué se ignora o normaliza por defecto

- Se ignoran: `ts`, `duration_ns`, `trace_id`, `span_id`, `parent_id`,
  `thread`, `file`, `line`, `visibility`, `depth` y los stacks de error.
- `<redacted>` es igual a `<redacted>`.
- Los hashes de identidad (`Foo@1a2b3c`) y las direcciones de memoria
  (`0x7f3a9c0e1d40`, `<Foo object at 0x...>` de Python) se reemplazan por un
  marcador. Constantes hex cortas como `0xff` se comparan tal cual.
- El orden de claves dentro de args/result no importa.

## Cómo añadir ignores

Lo volátil que la captura no redacta (ids generados, fechas) aparecerá como
diferencia. Nómbralo:

```bash
flowtrace diff base.jsonl ahora.jsonl --ignore-key created_at --ignore-key 'result.order.id' \
  --ignore-method 'app.Logger.*'
```

- Una clave sola (`created_at`, `*_at`) calza a cualquier profundidad. Una ruta
  anclada en `args.` o `result.` calza exactamente ahí; `*` es un segmento.
- Los globs de `--ignore-method` se aplican a `módulo.clase.método`; la llamada
  que calza se descarta junto con todo lo que llama.

Para dejarlos fijos, pon un `characterisation.json` **junto a la traza base**
(se versiona con ella y llega a CI) o en `.flowtrace/` (solo local, porque
`flowtrace init` ignora ese directorio en git):

```json
{ "ignoreKeys": ["created_at", "result.order.id"],
  "ignoreMethods": ["app.Logger.*"],
  "ignoreOrder": false, "compareErrorMsg": true }
```

Las banderas se suman a las listas del archivo. Una clave desconocida en el
archivo es un error (salida 2): un typo no debilita la comparación en silencio.

## Valores truncados

Un valor cortado por la captura es `<truncated:{prefijo}...>`. Dos así se
comparan solo por el prefijo conservado: prefijos iguales cuentan como iguales,
pero se informa (`truncated_values` y un aviso) porque lo que sigue nunca se
vio. Las diferencias dentro del prefijo se reportan con la marca `truncated`.
Sube `max-arg-length` (0 = sin truncar) si los valores grandes importan.

## Límites

- **Hilos y async.** El orden entre hilos o tareas es planificación, no
  comportamiento. Si las trazas abarcan varios hilos y hay llamadas
  añadidas/quitadas/reordenadas, la salida lo avisa. Usa `--ignore-order` en
  esos flujos: las hermanas se comparan como conjunto sin orden (un cambio real
  dentro de una lista permutada se sigue reportando). Por defecto el orden es
  estricto.
- **Entre procesos.** Cada archivo es la traza de un proceso. Une antes los
  archivos de una petición si quieres comparar a través de un salto; si no, cada
  proceso se compara solo, y un span cuyo padre no está en el archivo es raíz.
- **Capas distintas.** Una traza de Node y una de Python del mismo programa
  tienen formas distintas (funciones anidadas, por ejemplo). Compara lo
  equivalente.
- **Tamaño.** El trabajo está acotado: pasado `--max-spans` (2.000.000 por
  defecto) o el presupuesto de alineación, la salida dice `truncated` /
  `complete: false`. Una comparación incompleta nunca sale con 0: un "igual" no
  demostrado no debe pasar una puerta de CI. Los conteos por método siguen
  cubriendo todo.
- Una traza de caracterización solo fija los caminos que tu ejecución recorrió.
