# Mocklab

Mocklab is a library for creating codeless, file-based mock API server powered by Node.js. Mock any HTTP/HTTPS or REST dependency without writing a single line of code — just drop files into a folder and Mocklab turns them into live endpoints, with routes, HTTP methods, status codes, and response delays all driven by filenames.

Match requests by path, query parameters, exact parameter values, or wildcards, and switch between scenarios on the fly using overlays — no restart required. 

A built-in web Control Panel gives you a real-time request log, request/response inspection, overlay switching, and the ability to create new mocks straight from the dashboard. See the README for the full file-naming convention and routing rules.

## Install

1. Install node.js https://nodejs.org/en/download.

2. Create node.js project.
```
npm init
```

3. Install Mocklab in your project.
```
npm install mocklab --save-dev
```

4. Add script to your package.json
```json
  "scripts": {
    "mock": "mocklab"
  }
```

5. Create mocks folder.
```
mkdir mocks
```

## Configure (Optional)

Create mock.conf
```json
{
  "host": "localhost",
  "port": 3232,
  "overlay": "test",
  "historyLimit": 100,
  "controlPanel": true,
  "skipDisplayFor": ["/favicon.ico", "/apple-touch-icon.png", "/apple-touch-icon-precomposed.png"]
}
```
Configuration options:

- `host` - Server host (default: localhost)
- `port` - Server port (default: 3232)
- `overlay` - Active overlay name (default: none)
- `historyLimit` - Number of requests to keep in history (default: `100`)
- `controlPanel` - Enable the web Control Panel (default: `true`). Set to `false` to turn it off.
- `https` - Serve over HTTPS (default: HTTP). Provide `key` and `cert` file paths.
- `skipDisplayFor` - List of request paths to exclude from the console log and Control Panel history (default: `[]`). Paths are matched exactly, without query string, e.g. `/favicon.ico`. The request is still handled normally — it's just not logged/displayed.

If `mock.conf` doesn't exist, defaults to `localhost:3232` with no overlay.

#### Command Line Arguments

`host`, `port`, `overlay`, `historyLimit` and `controlPanel` can also be passed as `--key=value` command line arguments. Values passed on the command line take priority over `mock.conf`:

```
npx mocklab --host=localhost --port=8080 --overlay=error-overlay --historyLimit=50 --controlPanel=false
```

When running through an npm script, add `--` before the arguments so npm forwards them to Mocklab:

```
npm run mock -- --host=localhost --port=8080 --overlay=error-overlay
```

#### HTTPS

To run the mock server (and Control Panel) over HTTPS, add an `https` block with paths to your TLS key and certificate:

```json
{
  "https": {
    "key": "./certs/key.pem",
    "cert": "./certs/cert.pem"
  }
}
```

Paths are resolved relative to the project root. If the key/cert can't be read, Mocklab logs a warning and falls back to HTTP.

You can generate a self-signed certificate for local development with:

```
openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/key.pem -out certs/cert.pem -days 365 -subj "/CN=localhost"
```

## Run Server

```
npm run mock
```

## Run with Docker Compose

You can run Mocklab in Docker without installing Node.js on your machine. Create `mocks` and `overlays` folders next to your `docker-compose.yml`:

```
mkdir mocks overlays
```

> **Note:** inside a container the server must listen on `0.0.0.0` instead of the default `localhost`, otherwise it won't be reachable from your machine. That's why both examples pass `--host=0.0.0.0`. The Control Panel always runs on the next port after the server port, so both ports are published.

#### Example 1: Default settings

Runs on the default port `3232` with the Control Panel on `3233`:

```yaml
name: mocklab
services:
  server:
    image: node:20-alpine
    working_dir: /app
    volumes:
      - ./mocks:/app/mocks
      - ./overlays:/app/overlays
    ports:
      - "3232:3232"
      - "3233:3233"
    command: sh -c "npm install mocklab && npx mocklab --host=0.0.0.0"
```

Start it with:

```
docker compose up
```

Mocks are available at `http://localhost:3232` and the Control Panel at `http://localhost:3233`. Files added to `mocks` and `overlays` on your machine are picked up by the container through the volume mounts.

#### Example 2: With CLI arguments

Any of the supported CLI arguments can be appended to the `command`. This example runs on port `8080` with the `error-overlay` overlay active, a history limit of `50` and the Control Panel disabled:

```yaml
name: mocklab
services:
  server:
    image: node:20-alpine
    working_dir: /app
    volumes:
      - ./mocks:/app/mocks
      - ./overlays:/app/overlays
    ports:
      - "8080:8080"
    command: sh -c "npm install mocklab && npx mocklab --host=0.0.0.0 --port=8080 --overlay=error-overlay --historyLimit=50 --controlPanel=false"
```

If you keep the Control Panel enabled, also publish the next port (`"8081:8081"` in this example).

You can also use a `mock.conf` instead of CLI arguments by mounting it into the container: `- ./mock.conf:/app/mock.conf`. CLI arguments take priority over `mock.conf` values.

## How to Use

#### File Naming Convention

Filename determines the response behavior:\
`{name}-[method-{method}]-[delay{delay(ms)}]-[status-{code}]-[sequence-{number}].json`

Name before file extension is used for url:\
`auth.json` → `/auth`

When a file is placed inside a folder, the folder name becomes the first segment of the URL:\
`signin/email.json` → `/signin/email`

Use `index` to define response for parent segment of URL:\
`signin/index.json` → `/signin`

That's how you can't have response for both segments of URL:\
`signin/index.json` → `/signin`\
`signin/email.json` → `/signin/email`

#### Wildcard

Use [*] as filename to define wildcard:\
`signup/[*].json` → `/signin/email`\
`signup/[*].json` → `/signin/oauth`

#### Get params

Use [id] as filename to respond to specific get params:\
`signup/[email].json` → `/signin/?email` (With any value).\
`signup/[oauth].json` → `/signin/?oauth` (With any value).

#### Get params with specific value

Use [id=value] as filename to respond to get params with specific values:\
`signup/[id=1].json` → `/signin/?id=1`\
`signup/[id=2].json` → `/signin/?id=2` 

#### HTTP method

Add `method-{method-name}` to filename to define URL method:\
`auth-method-post.json`  → `/auth.json` will response only to `POST` requests.\
\
Supported HTTP methods:

- `GET` (default if no method specified)
- `POST`
- `PUT`
- `DELETE`
- `PATCH`

#### HTTP Status Code

Add `status-{status-code}` to filename to define HTTP Status code:
`auth-status-404.json`  → `/auth.json` will respond with a 404 status.

- Status: Must be valid HTTP status (100-599) - invalid values default to 200.

#### Response delay

Add `delay-{delay-ms}` to filename, to define response delay:
`auth-delay-2000.json`  → `/auth.json` will respond after 2s delay.

- Delay: Maximum 10 minutes (600000ms) - longer values are capped.

#### Sequenced responses

Add `sequence-{number}` to a group of otherwise-identical mocks to rotate through them on successive requests to the same endpoint:\
`auth-sequence-1.json` → 1st request to `/auth`\
`auth-sequence-2.json` → 2nd request to `/auth`

After the last file in the sequence is served, the rotation wraps back to `sequence-1`. Sequence order is based on the number in the filename, not creation order or method/delay/status.

Sequencing composes with method, delay, status, query-param, index, and wildcard matching — the rotation is scoped to whichever group of files matches the same route:\
`auth-method-post-sequence-1.json` / `auth-method-post-sequence-2.json` → rotates only for `POST /auth`\
`[id=1]-sequence-1.json` / `[id=1]-sequence-2.json` → rotates only for `?id=1`

#### Disable/Enable mocks

Use underscore prefix for templates or inactive mocks:\
`_auth-error-template.json`

#### Examples

- `auth.json` → GET /auth returns immediately with status 200
- `auth-method-post.json` → POST /auth returns with status 200
- `auth-delay-500.json` → GET /auth waits 500ms, returns status 200
- `auth-status-404.json` → GET /auth returns immediately with status 404
- `auth-method-post-delay-500.json` → POST /auth waits 500ms, returns status 200
- `auth-method-post-delay-500-status-201`.json → POST /auth waits 500ms, returns status 201
- `auth-delay-1000-status-201.json` → GET /auth waits 1s, returns status 201

#### Priority

For URL `GET /signup` (no query params):
1. Priority 1: `mocks/signup/index.json` (exact match)
2. Priority 2: `mocks/signup.json` (file match)

For URL `GET /signup/test` (path segment):
1. Priority 1: `mocks/signup/test/index.json`.
2. Priority 2: `mocks/signup/test.json`.
3. Priority 3: `mocks/signup/[*].json` (wildcard).

For URL `GET /signup?id` (query param):
1. Priority 2: `mocks/signup/[id].json` (any id value) ← Uses this.
2. Priority 3: `mocks/signup/index.json` (fallback).

For URL `GET /signup?id=5` (with specific query param value):
1. Priority 1: `mocks/signup/[id=5].json` (exact param value match) ← Uses this if exists.
2. Priority 2: `mocks/signup/[id].json` (param name match, any value).
3. Priority 3: `mocks/signup/index.json` (fallback).
4. Priority 4: `mocks/signup.json` (file fallback).

## Overlays

Overlays allow you to override specific mocks for different testing scenarios without modifying your main mock files.

#### How overlays work:

1. Create an `overlays/` folder next to your `mocks/` folder.
2. Inside `overlays/`, create subfolders for each scenario (e.g., user-error, test, auth-error)
3. Add mock files with the same structure as your `mocks/` folder.
4. Activate an overlay via command line or config or Control Panel.

## Supported File Formats

| Extension | Content-Type |
| --------- | ------------------------ |
| json      | application/json         |
| xml       | application/xml          |
| html      | text/html                |
| txt       | text/plain               |
| csv       | text/csv                 |
| js        | application/javascript   |
| css       | text/css                 |
| png       | image/png                |
| jpg       | image/jpeg               |
| jpeg      | image/jpeg               |
| gif       | image/gif                |
| pdf       | application/pdf          |
| ico       | image/x-icon             |

#### Usage:

```
npm run mock -- --overlay=user-error
```
For url `GET /auth` mock server will check:
1. `overlays/user-error/auth.json` 
2. `mocks/auth.json`

# Control Panel

Mocklab ships with a web-based Control Panel that starts automatically alongside the mock server. It listens on the next port after the mocklab port — so if mocklab runs on 3333, the Control Panel is available at http://localhost:3334.

<img width="1074" height="703" alt="mocklab-controlpanel" src="https://github.com/user-attachments/assets/eba3c8e4-324e-4616-a706-0c577e0f11db" />

From the panel you can:

- Switch overlays without restart.
- Filter overlays by name when the list is long.
- Watch requests in real time.
- Inspect request details.
- Filter the history by HTTP method or by typing a search query to match the URI.
- Clear the history.
- Add mocks if file missed.

