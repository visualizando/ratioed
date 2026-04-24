# ratioed

ratioed es una página estática que toma la URL de un tuit público, consulta sus métricas y devuelve una lectura rápida de clima social: si el posteo está siendo más bancado, más criticado o si la muestra todavía es insuficiente.

Además del veredicto, la app puede:

- mostrar el tuit original con sus métricas públicas,
- compartir el resultado por X o WhatsApp,
- generar una imagen descargable del análisis,
- persistir la URL analizada en la query string para compartir el estado.

## Cómo funciona el cálculo

El cálculo vive en `computeRatioMetrics()` dentro de [app.js](./app.js) y parte de cuatro señales públicas del tuit:

- replies
- quotes
- retweets
- likes

Antes de operar, todos los valores se normalizan a enteros positivos. Si una métrica no existe, no es numérica o es menor o igual a cero, se toma como `0`.

### Ponderaciones

La app separa las interacciones en dos grupos:

- oposición: replies y quote tweets
- apoyo: retweets y likes

Las ponderaciones actuales son:

- `reply = 2` puntos de oposición
- `quote = 3` puntos de oposición
- `retweet = 1` punto de apoyo
- `like = 0.1` punto de apoyo

En fórmula:

```text
opposition = (replies * 2) + (quotes * 3)
support = retweets + (likes * 0.1)
sample = support + opposition
sentimentScore = round(((support - opposition) / sample) * 100)
```

### Interpretación del score

El `sentimentScore` queda en un rango de `-100` a `100`:

- valores negativos: predominan crítica, respuestas y citas
- valores positivos: predominan difusión, retuits y likes
- valores cercanos a cero: el balance está dividido

### Umbrales de veredicto

La app define primero dos casos especiales:

- `sample === 0`: `Sin muestra`
- `sample < 10`: `Zona gris`

Cuando la muestra alcanza al menos `10` puntos ponderados, se usa esta escala:

| Rango de score | Veredicto | Label UI |
| --- | --- | --- |
| `<= -75` | `ratioed` | `Lo remil bardean` |
| `<= -50` | `ratioed` | `Lo recontra bardean` |
| `<= -25` | `ratioed` | `Lo re bardean` |
| `< -10` | `ratioed` | `Lo bardean` |
| `> -10` y `< 10` | `neutral` | `Quedó dividido` |
| `> 10` | `safe` | `Banca` |
| `>= 25` | `safe` | `Re banca` |
| `>= 50` | `safe` | `Recontra banca` |
| `>= 75` | `safe` | `Remil banca` |

El marcador visual del eje se calcula convirtiendo ese score a un porcentaje entre `0` y `100`:

```text
markerPct = (sentimentScore + 100) / 2
```

## Fuente de datos

La app obtiene los datos desde la API pública de fxtwitter:

```text
https://api.fxtwitter.com/{usuario}/status/{id}
```

El flujo es:

1. se valida que la URL pertenezca a `x.com` o `twitter.com`,
2. se extraen `username` e `id` del tuit,
3. se consulta la API de fxtwitter,
4. se calculan las métricas ponderadas,
5. se renderiza el resultado en pantalla.

Limitaciones importantes:

- solo funciona con tuits públicos,
- depende de la disponibilidad de fxtwitter,
- no interpreta contexto, ironía, sarcasmo ni contenido del texto,
- el score es una heurística de interacción, no una clasificación semántica.

## Librerías y recursos usados

Este proyecto no usa bundler ni dependencias instaladas por npm. Todo corre como sitio estático con HTML, CSS y JavaScript plano, cargando algunos recursos por CDN.

### UI y estilos

- [Bulma 1.0.2](https://bulma.io/): base de layout y componentes visuales.
- [Google Fonts](https://fonts.google.com/): `IBM Plex Sans` e `IBM Plex Mono`.
- [styles.css](./styles.css): estilos propios del proyecto.

### Exportación de imagen

- [html-to-image 1.11.11](https://github.com/bubkoo/html-to-image): convierte el nodo del resultado en un PNG descargable desde el navegador.

### APIs del navegador

- `fetch`: consulta de datos a fxtwitter.
- `URL` y `URLSearchParams`: parseo del link del tuit y sincronización de la query string.
- `history.replaceState`: actualización de la URL de la app sin recargar.
- `navigator.clipboard.writeText`: copia del enlace compartible.
- `window.open`: apertura de intents para compartir.

## Estructura del proyecto

- [index.html](./index.html): estructura de la interfaz, modales y assets externos.
- [app.js](./app.js): parseo de URLs, fetch de datos, cálculo del índice, render y acciones de compartir/exportar.
- [styles.css](./styles.css): look and feel de la experiencia.
- [CNAME](./CNAME): dominio custom para el deploy estático.

## Desarrollo local

Como es un sitio estático, alcanza con servir la carpeta con cualquier servidor HTTP simple.

Ejemplos:

```bash
python3 -m http.server 8000
```

o

```bash
npx serve .
```

Después abrí `http://localhost:8000` o el puerto que corresponda.

## Criterio de diseño

La lectura que hace ratioed no intenta responder si un tuit “tiene razón” o si el engagement es “bueno”. Solo ordena señales públicas de interacción para responder una pregunta concreta: si el clima visible parece más de banca o más de bardeo.
